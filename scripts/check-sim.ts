import { overlaps, itemAabb } from '../src/geometry';
import { starterPlant } from '../src/starter';
import { step, type Dynamics } from '../src/sim';
import type { PlacedItem } from '../src/types';

const plant = starterPlant();
const boxes = plant.items.map((item) => ({ item, box: itemAabb(item) }));
for (let i = 0; i < boxes.length; i += 1) {
  for (let j = i + 1; j < boxes.length; j += 1) {
    if (overlaps(boxes[i].box, boxes[j].box, 0.15)) {
      throw new Error(`Starter overlap: ${boxes[i].item.name} and ${boxes[j].item.name}`);
    }
  }
}

function settle(items: PlacedItem[], steps = 10, start = 0): { dyn: Dynamics; snap: ReturnType<typeof step>['snap'] } {
  let dyn: Dynamics = {};
  let snap = step(items, plant.connections, dyn, 0.25, start).snap;
  dyn = {};
  for (let i = 0; i < steps; i += 1) {
    const result = step(items, plant.connections, dyn, 0.5, start + i * 0.5);
    dyn = result.dyn;
    snap = result.snap;
  }
  return { dyn, snap };
}

const pump = plant.items.find((item) => item.kind === 'finished-pump');
const intake = plant.items.find((item) => item.kind === 'intake');
const screen = plant.items.find((item) => item.kind === 'bar-screen');
const clarifier = plant.items.find((item) => item.kind === 'sedimentation');
const filter = plant.items.find((item) => item.kind === 'filtration');
const contact = plant.items.find((item) => item.kind === 'disinfection');
const valve = plant.items.find((item) => item.kind === 'valve');
const dosing = plant.items.find((item) => item.kind === 'chemical-dosing');
const clearwell = plant.items.find((item) => item.kind === 'clearwell');
if (!pump || !intake || !screen || !clarifier || !filter || !contact || !valve || !dosing || !clearwell) {
  throw new Error('Starter is missing a unit');
}

const healthy = settle(plant.items);
const flow = healthy.snap.byId[pump.id].viz.flow;
const turb = healthy.snap.byId[filter.id].viz.turbidity;
const chlorine = healthy.snap.byId[contact.id].viz.chlorine;
const opcTags = healthy.snap.byId[pump.id].opc.map((item) => item.tag);
console.log('pump flow', flow.toFixed(1));
console.log('filter NTU', turb.toFixed(3), 'chlorine', chlorine.toFixed(3));
console.log('pump opc', healthy.snap.byId[pump.id].opc.map((item) => `${item.displayName}=${item.value}${item.unit} ${item.quality}`).join(' | '));

if (flow < 350) throw new Error(`Expected a running plant to discharge well above 350 m³/h, got ${flow}`);
if (turb > 0.3) throw new Error(`Filtered turbidity should be under 0.3 NTU, got ${turb}`);
if (chlorine < 0.6) throw new Error(`Chlorine residual should be healthy, got ${chlorine}`);
for (const tag of ['State', 'Speed', 'Flow', 'DischargePressure', 'Setpoint']) {
  if (!opcTags.includes(tag)) throw new Error(`Pump is missing OPC tag ${tag}`);
}
const flowItem = healthy.snap.byId[pump.id].opc.find((item) => item.tag === 'Flow');
if (!flowItem?.nodeId.startsWith('ns=2;s=WTP.')) throw new Error('Node id is not OPC-style');

const stoppedItems = plant.items.map((item) => (item.id === pump.id ? { ...item, state: 'standby' as const } : item));
const stopped = settle(stoppedItems, 12);
const stoppedFlow = stopped.snap.byId[pump.id].viz.flow;
const stoppedQuality = stopped.snap.byId[pump.id].opc.find((item) => item.tag === 'Flow')?.quality;
console.log('stopped flow', stoppedFlow.toFixed(2), stoppedQuality);
if (stoppedFlow > 5) throw new Error('Stop did not halt the pump');
if (stoppedQuality !== 'Uncertain') throw new Error(`Standby quality should be Uncertain, got ${stoppedQuality}`);

const slowItems = plant.items.map((item) => (item.id === pump.id ? { ...item, setpoint: 40 } : item));
const slow = settle(slowItems, 12);
const slowFlow = slow.snap.byId[pump.id].viz.flow;
console.log('40% speed flow', slowFlow.toFixed(1));
if (!(slowFlow > 80 && slowFlow < flow * 0.6)) throw new Error(`Speed setpoint did not scale flow (${slowFlow} vs ${flow})`);

const pinched = plant.items.map((item) => (item.id === valve.id ? { ...item, setpoint: 15 } : item));
const pinchedRun = settle(pinched, 12);
const pinchedFlow = pinchedRun.snap.byId[pump.id].viz.flow;
const pinchedPressure = pinchedRun.snap.byId[pump.id].viz.pressure;
console.log('pinched valve flow', pinchedFlow.toFixed(1), 'pressure', pinchedPressure.toFixed(2));
if (pinchedFlow > flow * 0.4) throw new Error('Downstream valve did not restrict pump flow');
if (pinchedPressure <= healthy.snap.byId[pump.id].viz.pressure) throw new Error('Deadhead should raise discharge pressure');

const lowIntake = plant.items.map((item) => (item.id === intake.id ? { ...item, setpoint: 120 } : item));
const low = settle(lowIntake, 12);
console.log('screen flow at intake 120', low.snap.byId[screen.id].viz.flow.toFixed(1));
if (low.snap.byId[screen.id].viz.flow > 180) throw new Error('Upstream setpoint did not limit downstream flow');

const noChem = plant.items.map((item) => (item.id === dosing.id ? { ...item, state: 'standby' as const } : item));
const dirty = settle(noChem, 14);
const dirtyTurb = dirty.snap.byId[clarifier.id].viz.turbidity;
const cleanTurb = healthy.snap.byId[clarifier.id].viz.turbidity;
console.log('clarifier NTU with alum', cleanTurb.toFixed(2), 'without', dirtyTurb.toFixed(2));
if (dirtyTurb < cleanTurb + 1) throw new Error('Stopping alum should worsen clarifier turbidity');

const levelBefore = healthy.dyn[clearwell.id].level;
const levelAfter = stopped.dyn[clearwell.id].level;
console.log('clearwell level running', levelBefore.toFixed(2), 'pump stopped', levelAfter.toFixed(2));
if (levelAfter <= levelBefore + 0.05) throw new Error('Clearwell should fill when the pump stops');

console.log('simulation checks passed');

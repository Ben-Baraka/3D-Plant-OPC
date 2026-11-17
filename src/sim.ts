import { catalogEntry } from './catalog';
import { FOOTPRINT, classifyEdge } from './geometry';
import type {
  FlowConnection,
  LiveSnapshot,
  OpState,
  OpcItem,
  OpcQuality,
  PlacedItem,
  UnitViz,
} from './types';

/** Inventories move faster than real basins so level changes show up while you watch. */
const STORAGE_TIMESCALE = 48;

interface Dyn {
  flowIn: number;
  flow: number;
  outflow: number;
  turbidity: number;
  chlorine: number;
  level: number;
  dp: number;
  pressure: number;
  speed: number;
  position: number;
  mixer: number;
  pH: number;
  sludgeFlow: number;
  blanket: number;
  velocity: number;
  chemFlow: number;
  chemLevel: number;
  loading: number;
  dose: number;
  ready: boolean;
}

interface Targets {
  flowIn: number;
  flowOut: number;
  outflow: number;
  turbidity: number;
  chlorine: number;
  dp: number;
  pressure: number;
  speed: number;
  position: number;
  mixer: number;
  pH: number;
  sludgeFlow: number;
  blanket: number;
  velocity: number;
  chemFlow: number;
  dose: number;
  loading: number;
  influent: number;
}

export type Dynamics = Record<string, Dyn>;

function emptyTargets(): Targets {
  return {
    flowIn: 0,
    flowOut: 0,
    outflow: 0,
    turbidity: 0,
    chlorine: 0,
    dp: 0,
    pressure: 0,
    speed: 0,
    position: 0,
    mixer: 0,
    pH: 7.2,
    sludgeFlow: 0,
    blanket: 30,
    velocity: 0,
    chemFlow: 0,
    dose: 0,
    loading: 0,
    influent: 0,
  };
}

function initialDyn(item: PlacedItem): Dyn {
  return {
    flowIn: 0,
    flow: 0,
    outflow: 0,
    turbidity: item.kind === 'intake' ? 10 : 0.2,
    chlorine: 0,
    level: item.kind === 'clearwell' ? 3.2 : item.kind === 'intake' ? 1.45 : 0,
    dp: 0,
    pressure: 0,
    speed: 0,
    position: 0,
    mixer: 0,
    pH: 7.2,
    sludgeFlow: 0,
    blanket: 34,
    velocity: 0,
    chemFlow: 0,
    chemLevel: 78,
    loading: item.kind === 'filtration' ? 18 : 0,
    dose: 0,
    ready: false,
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    h = Math.imul(h ^ text.charCodeAt(index), 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

function wobble(seed: string, time: number, amplitude: number): number {
  const n = hash(seed);
  return amplitude * (Math.sin(time * 1.37 + n * 12.2) + 0.35 * Math.sin(time * 3.05 + n * 5.1));
}

function approach(current: number, target: number, dt: number, tau: number, snapToTarget: boolean): number {
  if (snapToTarget) return target;
  const k = 1 - Math.exp(-dt / Math.max(0.05, tau));
  return current + (target - current) * k;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function openingOf(item: PlacedItem): number {
  if (item.state !== 'running') return 0;
  return clamp(item.setpoint / 100, 0, 1);
}

interface Graph {
  order: string[];
  waterIn: Record<string, string[]>;
  waterOut: Record<string, string[]>;
}

function buildGraph(items: PlacedItem[], connections: FlowConnection[]): Graph {
  const map = new Map(items.map((item) => [item.id, item]));
  const waterIn: Record<string, string[]> = {};
  const waterOut: Record<string, string[]> = {};
  for (const item of items) {
    waterIn[item.id] = [];
    waterOut[item.id] = [];
  }
  for (const connection of connections) {
    const from = map.get(connection.fromId);
    const to = map.get(connection.toId);
    if (!from || !to) continue;
    if (classifyEdge(from, to) !== 'water') continue;
    waterOut[from.id].push(to.id);
    waterIn[to.id].push(from.id);
  }
  const indegree = new Map(items.map((item) => [item.id, waterIn[item.id].length]));
  const queue = items.filter((item) => indegree.get(item.id) === 0).map((item) => item.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    order.push(id);
    for (const next of waterOut[id]) {
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  for (const item of items) {
    if (!order.includes(item.id)) order.push(item.id);
  }
  return { order, waterIn, waterOut };
}

function rawTurbidity(time: number): number {
  return 10.4 + 2.6 * Math.sin(time / 48) + 0.8 * Math.sin(time / 11);
}

function dischargeRestriction(
  pumpId: string,
  graph: Graph,
  map: Map<string, PlacedItem>,
): { factor: number; marked: string[] } {
  let factor = 1;
  let current = pumpId;
  const marked: string[] = [];
  const seen = new Set([pumpId]);
  for (let hop = 0; hop < 4; hop += 1) {
    const nextIds = graph.waterOut[current] ?? [];
    if (nextIds.length !== 1) break;
    const next = map.get(nextIds[0]);
    if (!next || seen.has(next.id)) break;
    if (next.kind !== 'valve' && next.kind !== 'pipe') break;
    factor *= openingOf(next);
    marked.push(next.id);
    seen.add(next.id);
    current = next.id;
  }
  return { factor, marked };
}

function clearwellLevelAhead(
  id: string,
  graph: Graph,
  dyn: Dynamics,
  map: Map<string, PlacedItem>,
  depth = 0,
): number | null {
  if (depth > 4) return null;
  for (const upstreamId of graph.waterIn[id] ?? []) {
    const upstream = map.get(upstreamId);
    if (!upstream) continue;
    if (upstream.kind === 'clearwell') return dyn[upstreamId]?.level ?? 3.2;
    const nested = clearwellLevelAhead(upstreamId, graph, dyn, map, depth + 1);
    if (nested != null) return nested;
  }
  return null;
}

function levelFactor(level: number | null): number {
  if (level == null) return 1;
  if (level >= 0.55) return 1;
  return clamp((level - 0.15) / 0.4, 0, 1);
}

function passFactor(item: PlacedItem, markedOpen: Set<string>, suction: number): number {
  if (markedOpen.has(item.id)) {
    if (item.state !== 'running') return 0;
    return 1;
  }
  if (item.state === 'fault') {
    if (item.kind === 'bar-screen') return 0.42;
    return 0;
  }
  if (item.state === 'standby') return 0;
  switch (item.kind) {
    case 'valve':
    case 'pipe':
    case 'filtration':
    case 'clearwell':
      return clamp(item.setpoint / 100, 0, 1);
    case 'finished-pump':
      return clamp(item.setpoint / 100, 0, 1) * suction;
    case 'bar-screen':
      return 0.985;
    case 'intake':
      return 1;
    default:
      return 0.995;
  }
}

function pipeVelocity(flow: number): number {
  const area = Math.PI * 0.2 * 0.2;
  return flow / 3600 / area;
}

function unitTargets(
  item: PlacedItem,
  input: { flowIn: number; turbIn: number; clIn: number; pin: number; dose: number; suction: number },
  dyn: Dyn,
  markedOpen: Set<string>,
  pumpRestriction: number,
): Targets {
  const targets = emptyTargets();
  const running = item.state === 'running';
  targets.flowIn = input.flowIn;
  targets.dose = input.dose;
  targets.influent = input.turbIn;
  targets.loading = dyn.loading;

  if (item.kind === 'intake') {
    const generated = running ? Math.max(0, item.setpoint) : 0;
    targets.flowIn = generated;
    targets.flowOut = generated;
    targets.turbidity = rawTurbidity(0);
    targets.chlorine = 0;
    targets.pressure = running ? 0.18 : 0;
    targets.speed = running ? item.setpoint : 0;
    return targets;
  }

  if (item.kind === 'chemical-dosing' || item.kind === 'sludge') {
    return targets;
  }

  let factor = passFactor(item, markedOpen, input.suction);
  if (item.kind === 'finished-pump') factor *= pumpRestriction;
  targets.flowOut = input.flowIn * factor;
  targets.turbidity = input.turbIn;
  targets.chlorine = input.clIn;
  targets.pressure = Math.max(0, input.pin - (input.flowIn / 500) ** 2 * 0.05);

  if (item.kind === 'bar-screen') {
    const rake = running ? item.setpoint : 0;
    const blind = item.state === 'fault' ? 2.5 : 0.32 + (1 - rake / 100) * 0.9;
    targets.dp = 4 + (targets.flowOut / 450) ** 2 * 24 * blind;
    targets.speed = rake;
    targets.turbidity = input.turbIn * 0.97;
    targets.position = rake;
  }

  if (item.kind === 'coagulation') {
    targets.mixer = running ? item.setpoint : 0;
    targets.speed = targets.mixer;
    targets.turbidity = input.turbIn * (running ? 0.96 : 1);
    targets.pH = 7.38 - Math.min(input.dose, 30) * 0.018;
  }

  if (item.kind === 'flocculation') {
    targets.mixer = running ? item.setpoint : 0;
    targets.speed = targets.mixer;
    const grown = running && input.dose >= 1;
    targets.turbidity = input.turbIn * (grown ? 0.9 : 0.98);
  }

  if (item.kind === 'sedimentation') {
    let remain = 0.9;
    if (running) {
      if (input.dose >= 4) remain = 0.14;
      else if (input.dose >= 1) remain = 0.3;
      else remain = 0.52;
    }
    if (item.state === 'fault') remain = 0.8;
    targets.turbidity = Math.max(0.2, input.turbIn * remain);
    const removed = Math.max(0, input.turbIn - targets.turbidity);
    targets.sludgeFlow = running ? input.flowIn * 0.012 * (0.4 + removed / 12) * (item.setpoint / 100) : 0;
    targets.blanket = running ? 22 + (1 - item.setpoint / 100) * 55 : 18;
    targets.position = item.setpoint;
  }

  if (item.kind === 'filtration') {
    const leak = 0.045 + (dyn.loading / 100) * 0.22;
    if (item.state === 'fault') targets.turbidity = input.turbIn * 0.62;
    else if (!running) targets.turbidity = input.turbIn * 0.75;
    else targets.turbidity = Math.max(0.05, input.turbIn * leak);
    const flowForDp = Math.max(targets.flowOut, running ? input.flowIn * 0.15 : 0);
    targets.dp = (item.state === 'fault' ? 68 : 7) + dyn.loading * 0.42 + (flowForDp / 480) ** 2 * 11;
    targets.position = running ? item.setpoint : 0;
  }

  if (item.kind === 'disinfection') {
    const demand = 0.32 + Math.max(0, input.turbIn) * 0.07;
    targets.chlorine = running ? Math.max(0, item.setpoint - demand) : input.clIn * 0.2;
    targets.dose = running ? item.setpoint : 0;
    targets.turbidity = input.turbIn;
  }

  if (item.kind === 'clearwell') {
    targets.chlorine = input.clIn * (running ? 0.97 : 0.9);
    targets.turbidity = input.turbIn;
    targets.position = running ? item.setpoint : 0;
    targets.flowOut = input.flowIn * (running ? clamp(item.setpoint / 100, 0, 1) : 0);
  }

  if (item.kind === 'finished-pump') {
    const speed = running ? item.setpoint : 0;
    targets.speed = speed;
    targets.position = speed;
    const speedF = speed / 100;
    const shutoff = speedF ** 2 * 6.5;
    const friction = (targets.flowOut / 520) * 1.7;
    targets.pressure = running && speedF > 0 ? Math.max(0, shutoff - friction) : 0;
    if (pumpRestriction < 0.98 && running) {
      targets.pressure = Math.min(8.5, targets.pressure + (1 - pumpRestriction) * 1.6);
    }
  }

  if (item.kind === 'valve') {
    const position = item.state === 'running' ? item.setpoint : 0;
    targets.position = position;
    targets.speed = position;
    const closed = 1 - clamp(position / 100, 0, 1);
    targets.dp = (input.flowIn / 450) ** 2 * (6 + closed * 110);
    targets.pressure = Math.max(0, input.pin - targets.dp / 100);
    if (!markedOpen.has(item.id)) {
      targets.flowOut = input.flowIn * (item.state === 'running' ? clamp(position / 100, 0, 1) : 0);
    }
  }

  if (item.kind === 'pipe') {
    const open = item.state === 'running' ? clamp(item.setpoint / 100, 0, 1) : 0;
    targets.position = open * 100;
    targets.velocity = pipeVelocity(targets.flowOut);
    targets.pressure = Math.max(0, input.pin * (0.55 + 0.45 * open) - (targets.flowOut / 600) ** 2 * 0.15);
    targets.dp = (input.flowIn / 500) ** 2 * (1 - open) * 40;
  }

  return targets;
}

function smoothDyn(dyn: Dyn, targets: Targets, dt: number, init: boolean): void {
  dyn.flowIn = approach(dyn.flowIn, targets.flowIn, dt, 1.1, init);
  dyn.flow = approach(dyn.flow, targets.flowOut, dt, 1.15, init);
  dyn.outflow = approach(dyn.outflow, targets.outflow, dt, 1.15, init);
  dyn.turbidity = approach(dyn.turbidity, targets.turbidity, dt, 2.2, init);
  dyn.chlorine = approach(dyn.chlorine, targets.chlorine, dt, 1.8, init);
  dyn.dp = approach(dyn.dp, targets.dp, dt, 1.4, init);
  dyn.pressure = approach(dyn.pressure, targets.pressure, dt, 1.0, init);
  dyn.speed = approach(dyn.speed, targets.speed, dt, 0.7, init);
  dyn.position = approach(dyn.position, targets.position, dt, 0.65, init);
  dyn.mixer = approach(dyn.mixer, targets.mixer, dt, 0.7, init);
  dyn.pH = approach(dyn.pH, targets.pH, dt, 2, init);
  dyn.sludgeFlow = approach(dyn.sludgeFlow, targets.sludgeFlow, dt, 1.4, init);
  dyn.blanket = approach(dyn.blanket, targets.blanket, dt, 2.5, init);
  dyn.velocity = approach(dyn.velocity, targets.velocity, dt, 1.1, init);
  dyn.chemFlow = approach(dyn.chemFlow, targets.chemFlow, dt, 1.1, init);
  dyn.dose = approach(dyn.dose, targets.dose, dt, 1.2, init);
  dyn.loading = targets.loading;
}

function qualityFor(state: OpState, alarm: boolean): OpcQuality {
  if (state === 'fault') return 'Bad';
  if (state === 'standby' || alarm) return 'Uncertain';
  return 'Good';
}

function row(
  item: PlacedItem,
  tag: string,
  displayName: string,
  value: number | string | boolean,
  unit: string,
  digits: number,
  quality: OpcQuality,
  timestamp: number,
): OpcItem {
  const rounded = typeof value === 'number' ? Number(value.toFixed(digits)) : value;
  return {
    nodeId: `ns=2;s=WTP.${item.id}.${tag}`,
    displayName,
    value: rounded,
    unit,
    quality,
    timestamp,
    digits,
    tag,
  };
}

function stateLabel(state: OpState): string {
  if (state === 'running') return 'Running';
  if (state === 'standby') return 'Standby';
  return 'Fault';
}

function setpointRow(item: PlacedItem, quality: OpcQuality, timestamp: number): OpcItem {
  const spec = catalogEntry(item.kind).setpoint;
  const digits = spec.step < 1 ? 1 : 0;
  return row(item, 'Setpoint', spec.label, item.setpoint, spec.unit, digits, quality, timestamp);
}

function buildOpc(item: PlacedItem, viz: UnitViz, timestamp: number): OpcItem[] {
  const stateQuality: OpcQuality = item.state === 'fault' ? 'Bad' : 'Good';
  const commandQuality: OpcQuality = 'Good';
  const base = qualityFor(item.state, false);
  const items: OpcItem[] = [row(item, 'State', 'Operating state', stateLabel(item.state), '', 0, stateQuality, timestamp)];

  const alarmed = (condition: boolean) => qualityFor(item.state, condition);

  switch (item.kind) {
    case 'intake':
      items.push(
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        setpointRow(item, commandQuality, timestamp),
        row(item, 'ChannelLevel', 'Channel level', viz.level, 'm', 2, base, timestamp),
        row(item, 'Turbidity', 'Raw turbidity', viz.turbidity, 'NTU', 2, base, timestamp),
      );
      break;
    case 'bar-screen':
      items.push(
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'DifferentialPressure', 'Differential pressure', viz.dp, 'kPa', 1, alarmed(viz.dp > 48), timestamp),
        row(item, 'RakeSpeed', 'Rake speed', viz.speed, '%', 0, base, timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'coagulation':
      items.push(
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'MixerSpeed', 'Mixer speed', viz.mixer, 'rpm', 0, base, timestamp),
        row(item, 'DoseReceived', 'Dose received', viz.dose, 'mg/L', 1, base, timestamp),
        row(item, 'pH', 'pH', viz.pH, '', 2, base, timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'flocculation':
      items.push(
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'MixerSpeed', 'Mixer speed', viz.mixer, 'rpm', 0, base, timestamp),
        row(item, 'Turbidity', 'Turbidity', viz.turbidity, 'NTU', 2, base, timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'sedimentation':
      items.push(
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'Turbidity', 'Effluent turbidity', viz.turbidity, 'NTU', 2, alarmed(viz.turbidity > 3), timestamp),
        row(item, 'BlanketLevel', 'Sludge blanket', viz.blanket, '%', 0, alarmed(viz.blanket > 75), timestamp),
        row(item, 'SludgeFlow', 'Sludge flow', viz.sludgeFlow, 'm³/h', 2, base, timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'filtration':
      items.push(
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'Turbidity', 'Effluent turbidity', viz.turbidity, 'NTU', 2, alarmed(viz.turbidity > 0.3), timestamp),
        row(item, 'DifferentialPressure', 'Differential pressure', viz.dp, 'kPa', 1, alarmed(viz.dp > 55), timestamp),
        row(item, 'Loading', 'Media loading', viz.loading, '%', 0, alarmed(viz.loading > 80), timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'disinfection':
      items.push(
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'ChlorineResidual', 'Chlorine residual', viz.chlorine, 'mg/L', 2, alarmed(item.state === 'running' && (viz.chlorine < 0.2 || viz.chlorine > 4)), timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'clearwell':
      items.push(
        row(item, 'Inflow', 'Inflow', viz.flowIn, 'm³/h', 1, base, timestamp),
        row(item, 'Outflow', 'Outflow', viz.outflow, 'm³/h', 1, base, timestamp),
        row(item, 'Level', 'Level', viz.level, 'm', 2, alarmed(viz.level < 0.6 || viz.level > 4.7), timestamp),
        row(item, 'ChlorineResidual', 'Chlorine residual', viz.chlorine, 'mg/L', 2, alarmed(viz.chlorine < 0.2), timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'finished-pump':
      items.push(
        row(item, 'Speed', 'Speed', viz.speed, '%', 1, base, timestamp),
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'DischargePressure', 'Discharge pressure', viz.pressure, 'bar', 2, alarmed(viz.pressure > 7.2), timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'chemical-dosing':
      items.push(
        setpointRow(item, commandQuality, timestamp),
        row(item, 'ChemicalFlow', 'Chemical flow', viz.chemFlow, 'L/h', 1, base, timestamp),
        row(item, 'TankLevel', 'Tank level', viz.chemLevel, '%', 1, alarmed(viz.chemLevel < 12), timestamp),
        row(item, 'DoseDelivered', 'Dose delivered', viz.dose, 'mg/L', 1, base, timestamp),
      );
      break;
    case 'sludge':
      items.push(
        row(item, 'SludgeFlow', 'Sludge flow', viz.sludgeFlow, 'm³/h', 2, base, timestamp),
        row(item, 'ThickenerLevel', 'Thickener level', viz.blanket, '%', 0, base, timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'valve':
      items.push(
        row(item, 'Position', 'Position', viz.position, '%', 1, base, timestamp),
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'DifferentialPressure', 'Differential pressure', viz.dp, 'kPa', 1, alarmed(viz.dp > 60), timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    case 'pipe':
      items.push(
        row(item, 'Flow', 'Flow', viz.flow, 'm³/h', 1, base, timestamp),
        row(item, 'Velocity', 'Velocity', viz.velocity, 'm/s', 2, base, timestamp),
        row(item, 'LinePressure', 'Line pressure', viz.pressure, 'bar', 2, base, timestamp),
        setpointRow(item, commandQuality, timestamp),
      );
      break;
    default:
      break;
  }
  return items;
}

function present(item: PlacedItem, dyn: Dyn, time: number): UnitViz {
  const calm = Math.abs(dyn.flow) < 0.8 && Math.abs(dyn.flowIn) < 0.8;
  const flowW = calm ? 0 : wobble(item.id + 'flow', time, 0.55);
  const turbAmp = dyn.turbidity > 2 ? 0.06 : 0.012;
  return {
    flowIn: Math.max(0, dyn.flowIn + (calm ? 0 : wobble(item.id + 'fin', time, 0.35))),
    flow: Math.max(0, dyn.flow + flowW),
    outflow: Math.max(0, dyn.outflow + (Math.abs(dyn.outflow) < 0.8 ? 0 : wobble(item.id + 'out', time, 0.35))),
    turbidity: Math.max(0, dyn.turbidity + wobble(item.id + 'turb', time, turbAmp)),
    chlorine: Math.max(0, dyn.chlorine + wobble(item.id + 'cl', time, dyn.chlorine > 0.05 ? 0.008 : 0)),
    level: item.kind === 'clearwell' || item.kind === 'intake' ? Math.max(0, dyn.level + wobble(item.id + 'lvl', time, 0.006)) : dyn.level,
    dp: Math.max(0, dyn.dp + wobble(item.id + 'dp', time, dyn.dp > 1 ? 0.25 : 0)),
    pressure: Math.max(0, dyn.pressure + wobble(item.id + 'p', time, dyn.pressure > 0.2 ? 0.015 : 0)),
    speed: Math.max(0, dyn.speed + wobble(item.id + 'spd', time, dyn.speed > 1 ? 0.15 : 0)),
    position: clamp(dyn.position + wobble(item.id + 'pos', time, dyn.position > 1 ? 0.12 : 0), 0, 100),
    mixer: Math.max(0, dyn.mixer),
    pH: dyn.pH + wobble(item.id + 'ph', time, 0.01),
    sludgeFlow: Math.max(0, dyn.sludgeFlow + wobble(item.id + 'sl', time, dyn.sludgeFlow > 0.2 ? 0.02 : 0)),
    blanket: clamp(dyn.blanket, 0, 100),
    velocity: Math.max(0, dyn.velocity),
    chemFlow: Math.max(0, dyn.chemFlow + wobble(item.id + 'cf', time, dyn.chemFlow > 1 ? 0.2 : 0)),
    chemLevel: clamp(dyn.chemLevel, 0, 100),
    loading: clamp(dyn.loading, 0, 100),
    dose: Math.max(0, dyn.dose),
  };
}

export function emptySnapshot(): LiveSnapshot {
  return { time: 0, byId: {} };
}

export function step(items: PlacedItem[], connections: FlowConnection[], previous: Dynamics, dt: number, time: number): { dyn: Dynamics; snap: LiveSnapshot } {
  const dyn: Dynamics = {};
  for (const item of items) dyn[item.id] = previous[item.id] ? { ...previous[item.id] } : initialDyn(item);

  const map = new Map(items.map((item) => [item.id, item]));
  const graph = buildGraph(items, connections);
  const markedOpen = new Set<string>();
  const pumpFactor: Record<string, number> = {};
  for (const item of items) {
    if (item.kind !== 'finished-pump') continue;
    const restriction = dischargeRestriction(item.id, graph, map);
    pumpFactor[item.id] = restriction.factor;
    for (const id of restriction.marked) markedOpen.add(id);
  }

  const doseAt: Record<string, number> = {};
  for (const connection of connections) {
    const from = map.get(connection.fromId);
    const to = map.get(connection.toId);
    if (!from || !to || from.kind !== 'chemical-dosing') continue;
    if (from.state !== 'running') continue;
    const tank = dyn[from.id]?.chemLevel ?? 0;
    if (tank < 4) continue;
    const delivered = from.setpoint * (tank < 12 ? tank / 12 : 1);
    doseAt[to.id] = (doseAt[to.id] ?? 0) + delivered;
  }

  const targets: Record<string, Targets> = {};
  const turbNow = rawTurbidity(time);

  for (const id of graph.order) {
    const item = map.get(id);
    if (!item) continue;
    const ups = graph.waterIn[id] ?? [];
    let flowIn = 0;
    let turbIn = turbNow;
    let clIn = 0;
    let pin = 0.2;
    let carriedDose = doseAt[id] ?? 0;
    if (ups.length > 0) {
      let turbSum = 0;
      let clSum = 0;
      let pSum = 0;
      let doseSum = 0;
      let weight = 0;
      for (const upstreamId of ups) {
        const shareCount = Math.max(1, graph.waterOut[upstreamId]?.length ?? 1);
        const upstreamFlow = (targets[upstreamId]?.flowOut ?? 0) / shareCount;
        flowIn += upstreamFlow;
        turbSum += (targets[upstreamId]?.turbidity ?? turbNow) * upstreamFlow;
        clSum += (targets[upstreamId]?.chlorine ?? 0) * upstreamFlow;
        pSum += (targets[upstreamId]?.pressure ?? 0.2) * upstreamFlow;
        doseSum += (targets[upstreamId]?.dose ?? 0) * upstreamFlow;
        weight += upstreamFlow;
      }
      if (weight > 0.05) {
        turbIn = turbSum / weight;
        clIn = clSum / weight;
        pin = pSum / weight;
        carriedDose += doseSum / weight;
      }
    }

    const suction = levelFactor(clearwellLevelAhead(id, graph, dyn, map));
    const next = unitTargets(
      item,
      { flowIn, turbIn, clIn, pin, dose: carriedDose, suction },
      dyn[id],
      markedOpen,
      pumpFactor[id] ?? 1,
    );
    if (item.kind === 'intake') next.turbidity = turbNow;
    targets[id] = next;
  }

  for (const item of items) {
    if (item.kind !== 'sludge') continue;
    let produced = 0;
    for (const connection of connections) {
      if (connection.toId !== item.id) continue;
      produced += targets[connection.fromId]?.sludgeFlow ?? dyn[connection.fromId]?.sludgeFlow ?? 0;
    }
    const next = emptyTargets();
    const running = item.state === 'running';
    next.sludgeFlow = running ? produced * clamp(item.setpoint / 100, 0, 1) : 0;
    next.flowOut = next.sludgeFlow;
    next.blanket = running ? clamp(28 + produced * 4 - item.setpoint * 0.15, 15, 90) : 20;
    next.position = item.setpoint;
    targets[item.id] = next;
  }

  for (const item of items) {
    if (item.kind !== 'chemical-dosing') continue;
    let water = 0;
    for (const connection of connections) {
      if (connection.fromId !== item.id) continue;
      const downstream = targets[connection.toId];
      water += downstream?.flowOut ?? downstream?.flowIn ?? 0;
    }
    const running = item.state === 'running';
    const tank = dyn[item.id].chemLevel;
    const dose = running && tank >= 4 ? item.setpoint * (tank < 12 ? tank / 12 : 1) : 0;
    const chemFlow = running ? (dose * water) / 100 : 0;
    const next = emptyTargets();
    next.dose = dose;
    next.chemFlow = chemFlow;
    next.flowOut = 0;
    next.position = item.setpoint;
    targets[item.id] = next;

    if (dyn[item.id].ready) {
      const drop = (chemFlow / 600) * (dt / 3600) * 100 * STORAGE_TIMESCALE;
      dyn[item.id].chemLevel -= drop;
      if (!running) dyn[item.id].chemLevel += 0.35 * dt;
    }
    dyn[item.id].chemLevel = clamp(dyn[item.id].chemLevel, 0, 100);
  }

  for (const item of items) {
    if (item.kind !== 'filtration') continue;
    const target = targets[item.id];
    if (!target) continue;
    const running = item.state === 'running' && target.flowOut > 1;
    if (dyn[item.id].ready) {
      if (running) {
        const rise = (Math.max(0.4, target.influent) / 8) * (target.flowOut / 500) * (dt / 3600) * STORAGE_TIMESCALE * 4;
        dyn[item.id].loading += rise;
      } else {
        dyn[item.id].loading -= 10 * (dt / 3600) * STORAGE_TIMESCALE;
      }
    }
    dyn[item.id].loading = clamp(dyn[item.id].loading, 8, 100);
    target.loading = dyn[item.id].loading;
    const leak = 0.045 + (dyn[item.id].loading / 100) * 0.22;
    if (item.state === 'running') {
      target.turbidity = Math.max(0.05, target.influent * leak);
      target.dp = 7 + dyn[item.id].loading * 0.42 + (target.flowOut / 480) ** 2 * 11;
    }
  }

  for (const item of items) {
    if (item.kind !== 'clearwell') continue;
    const target = targets[item.id];
    if (!target) continue;
    const downstream = graph.waterOut[item.id] ?? [];
    let draw = 0;
    if (downstream.length === 0) draw = target.flowOut;
    else {
      for (const id of downstream) draw += targets[id]?.flowOut ?? 0;
    }
    target.outflow = draw;
    const area = FOOTPRINT.clearwell.w * FOOTPRINT.clearwell.d * 0.82;
    if (dyn[item.id].ready) {
      dyn[item.id].level += ((target.flowIn - draw) / area) * (dt / 3600) * STORAGE_TIMESCALE;
    }
    dyn[item.id].level = clamp(dyn[item.id].level, 0.15, 5);
  }

  for (const item of items) {
    const target = targets[item.id] ?? emptyTargets();
    if (item.kind === 'intake') {
      const levelTarget = item.state === 'running' ? 1.25 + Math.min(item.setpoint, 1500) / 1400 : 0.7;
      dyn[item.id].level = approach(dyn[item.id].level, levelTarget, dt, 1.6, !dyn[item.id].ready);
    }
    const init = !dyn[item.id].ready;
    smoothDyn(dyn[item.id], target, dt, init);
    dyn[item.id].ready = true;
  }

  const byId: LiveSnapshot['byId'] = {};
  const timestamp = Date.now();
  for (const item of items) {
    const viz = present(item, dyn[item.id], time);
    byId[item.id] = { viz, opc: buildOpc(item, viz, timestamp) };
  }
  return { dyn, snap: { time, byId } };
}

export function badgeText(item: PlacedItem, viz: UnitViz | undefined): string {
  if (!viz) return '';
  if (item.kind === 'clearwell') return `${viz.level.toFixed(2)} m`;
  if (item.kind === 'chemical-dosing') return `${viz.chemFlow.toFixed(0)} L/h`;
  if (item.kind === 'sludge') return `${viz.sludgeFlow.toFixed(1)} m³/h`;
  if (item.kind === 'valve') return `${viz.position.toFixed(0)}%`;
  if (item.kind === 'disinfection') return `${viz.chlorine.toFixed(2)} mg/L`;
  if (item.kind === 'filtration' || item.kind === 'sedimentation') return `${viz.turbidity.toFixed(2)} NTU`;
  return `${viz.flow.toFixed(0)} m³/h`;
}

export function plantHeadline(items: PlacedItem[], snap: LiveSnapshot): { flow: number; turbidity: number; chlorine: number } | null {
  if (items.length === 0) return null;
  const pump = items.find((item) => item.kind === 'finished-pump');
  const filter = items.find((item) => item.kind === 'filtration');
  const contact = items.find((item) => item.kind === 'disinfection');
  const clearwell = items.find((item) => item.kind === 'clearwell');
  const end = items.find((item) => item.kind === 'pipe' && item.name.toLowerCase().includes('distribution')) ?? pump;
  const flow = (end && snap.byId[end.id]?.viz.flow) || (pump && snap.byId[pump.id]?.viz.flow) || 0;
  const turbidity = (filter && snap.byId[filter.id]?.viz.turbidity) || 0;
  const chlorine =
    (contact && snap.byId[contact.id]?.viz.chlorine) || (clearwell && snap.byId[clearwell.id]?.viz.chlorine) || 0;
  return { flow, turbidity, chlorine };
}

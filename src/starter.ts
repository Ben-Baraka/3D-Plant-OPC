import { catalogEntry } from './catalog';
import { FOOTPRINT } from './geometry';
import type { ComponentKind, FlowConnection, PlacedItem } from './types';

const MAIN_Y = 16;
const GAP = 2;

const TRAIN: { kind: ComponentKind; id: string; name: string }[] = [
  { kind: 'intake', id: 'intake-1', name: 'Raw water intake' },
  { kind: 'pipe', id: 'pipe-1', name: 'Raw water main' },
  { kind: 'bar-screen', id: 'bar-screen-1', name: 'Bar screen' },
  { kind: 'coagulation', id: 'coagulation-1', name: 'Rapid mix' },
  { kind: 'flocculation', id: 'flocculation-1', name: 'Flocculation' },
  { kind: 'sedimentation', id: 'sedimentation-1', name: 'Sedimentation' },
  { kind: 'filtration', id: 'filtration-1', name: 'Filters' },
  { kind: 'disinfection', id: 'disinfection-1', name: 'Chlorine contact' },
  { kind: 'clearwell', id: 'clearwell-1', name: 'Clearwell' },
  { kind: 'finished-pump', id: 'finished-pump-1', name: 'High service pump' },
  { kind: 'valve', id: 'valve-1', name: 'Finished water valve' },
  { kind: 'pipe', id: 'pipe-2', name: 'Distribution main' },
];

export interface PlantLayout {
  items: PlacedItem[];
  connections: FlowConnection[];
  seq: number;
}

function placed(kind: ComponentKind, id: string, name: string, x: number, y: number, rotation = 0): PlacedItem {
  return {
    id,
    kind,
    name,
    x,
    y,
    rotation,
    state: 'running',
    setpoint: catalogEntry(kind).setpoint.default,
  };
}

/** A conventional surface-water train, plus alum feed and a sludge thickener. */
export function starterPlant(): PlantLayout {
  const items: PlacedItem[] = [];
  let cursor = 2;
  for (const unit of TRAIN) {
    const width = FOOTPRINT[unit.kind].w;
    items.push(placed(unit.kind, unit.id, unit.name, cursor + width / 2, MAIN_Y));
    cursor += width + GAP;
  }

  const rapidMix = items.find((item) => item.id === 'coagulation-1');
  const clarifier = items.find((item) => item.id === 'sedimentation-1');
  if (!rapidMix || !clarifier) throw new Error('Starter train is missing a basin');

  const chem = FOOTPRINT['chemical-dosing'];
  const sludge = FOOTPRINT.sludge;
  items.push(
    placed(
      'chemical-dosing',
      'chemical-dosing-1',
      'Alum dosing',
      rapidMix.x,
      MAIN_Y + FOOTPRINT.coagulation.d / 2 + GAP + chem.d / 2,
      -90,
    ),
  );
  items.push(
    placed(
      'sludge',
      'sludge-1',
      'Sludge thickener',
      clarifier.x,
      MAIN_Y + FOOTPRINT.sedimentation.d / 2 + GAP + sludge.d / 2,
      90,
    ),
  );

  const connections: FlowConnection[] = [];
  for (let index = 0; index < TRAIN.length - 1; index += 1) {
    connections.push({
      id: `link-${index + 1}`,
      fromId: TRAIN[index].id,
      toId: TRAIN[index + 1].id,
    });
  }
  connections.push(
    { id: 'link-chem', fromId: 'chemical-dosing-1', toId: 'coagulation-1' },
    { id: 'link-sludge', fromId: 'sedimentation-1', toId: 'sludge-1' },
  );

  return { items, connections, seq: 100 };
}

export const STARTER_NAME = 'Conventional 520 m³/h train';

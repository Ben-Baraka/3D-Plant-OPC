import type { ComponentKind, SetpointSpec } from './types';

export interface CatalogEntry {
  kind: ComponentKind;
  name: string;
  group: 'Preliminary' | 'Treatment' | 'Finished water' | 'Support';
  summary: string;
  setpoint: SetpointSpec;
  note: string;
}

export const CATALOG: CatalogEntry[] = [
  {
    kind: 'intake',
    name: 'Intake',
    group: 'Preliminary',
    summary: 'Raw-water withdrawal',
    setpoint: { label: 'Flow setpoint', unit: 'm³/h', min: 0, max: 2000, step: 10, default: 520 },
    note: 'Sets the flow available to everything downstream.',
  },
  {
    kind: 'bar-screen',
    name: 'Bar screen',
    group: 'Preliminary',
    summary: 'Coarse debris removal',
    setpoint: { label: 'Rake speed', unit: '%', min: 0, max: 100, step: 1, default: 70 },
    note: 'A faster rake lowers differential pressure. A fault blinds the screen.',
  },
  {
    kind: 'coagulation',
    name: 'Coagulation',
    group: 'Treatment',
    summary: 'Rapid mix',
    setpoint: { label: 'Mixer speed', unit: 'rpm', min: 0, max: 120, step: 1, default: 45 },
    note: 'Dose received comes from a chemical-dosing unit linked into this basin.',
  },
  {
    kind: 'flocculation',
    name: 'Flocculation',
    group: 'Treatment',
    summary: 'Slow mix and floc growth',
    setpoint: { label: 'Mixer speed', unit: 'rpm', min: 0, max: 60, step: 1, default: 16 },
    note: 'Works with upstream coagulant dose. Stopping it leaves turbidity high.',
  },
  {
    kind: 'sedimentation',
    name: 'Sedimentation',
    group: 'Treatment',
    summary: 'Clarifier',
    setpoint: { label: 'Sludge withdrawal', unit: '%', min: 0, max: 100, step: 1, default: 50 },
    note: 'Effluent turbidity drops when coagulant is being fed. Withdrawal sets the blanket.',
  },
  {
    kind: 'filtration',
    name: 'Filtration',
    group: 'Treatment',
    summary: 'Granular media filters',
    setpoint: { label: 'Flow limit', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    note: 'Effluent turbidity should sit near 0.1 NTU while the filter is running.',
  },
  {
    kind: 'disinfection',
    name: 'Disinfection',
    group: 'Treatment',
    summary: 'Chlorine contact',
    setpoint: { label: 'Chlorine dose', unit: 'mg/L', min: 0, max: 5, step: 0.1, default: 1.6 },
    note: 'Residual follows the dose minus chlorine demand from the water.',
  },
  {
    kind: 'clearwell',
    name: 'Clearwell',
    group: 'Finished water',
    summary: 'Finished-water storage',
    setpoint: { label: 'Outlet opening', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    note: 'Level rises when inflow exceeds what the high-service pump is drawing. Storage is time-scaled so the change is visible.',
  },
  {
    kind: 'finished-pump',
    name: 'Finished-water pump',
    group: 'Finished water',
    summary: 'High-service pump',
    setpoint: { label: 'Speed setpoint', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    note: 'Speed sets discharge flow. A valve downstream deadheads the pump and cuts flow.',
  },
  {
    kind: 'valve',
    name: 'Valve',
    group: 'Finished water',
    summary: 'Isolation or control valve',
    setpoint: { label: 'Position setpoint', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    note: 'Closing a valve on the pump discharge reduces plant outflow and raises pump pressure.',
  },
  {
    kind: 'pipe',
    name: 'Pipe run',
    group: 'Finished water',
    summary: 'Straight pipe spool',
    setpoint: { label: 'Opening', unit: '%', min: 0, max: 100, step: 1, default: 100 },
    note: 'Carries upstream flow. Velocity assumes a 400 mm main.',
  },
  {
    kind: 'chemical-dosing',
    name: 'Chemical dosing',
    group: 'Support',
    summary: 'Metering pump and tote',
    setpoint: { label: 'Dose setpoint', unit: 'mg/L', min: 0, max: 40, step: 0.5, default: 12 },
    note: 'Link it into coagulation. Dose improves settling. Chemical flow follows plant flow.',
  },
  {
    kind: 'sludge',
    name: 'Sludge handling',
    group: 'Support',
    summary: 'Gravity thickener',
    setpoint: { label: 'Withdrawal', unit: '%', min: 0, max: 100, step: 1, default: 55 },
    note: 'Feed it from sedimentation. Sludge flow tracks clarifier production.',
  },
];

const BY_KIND = new Map(CATALOG.map((entry) => [entry.kind, entry]));

export function catalogEntry(kind: ComponentKind): CatalogEntry {
  const entry = BY_KIND.get(kind);
  if (!entry) throw new Error(`Unknown component: ${kind}`);
  return entry;
}

export const CATALOG_GROUPS = ['Preliminary', 'Treatment', 'Finished water', 'Support'] as const;

export const ALL_KINDS: ComponentKind[] = CATALOG.map((entry) => entry.kind);

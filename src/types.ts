export type ComponentKind =
  | 'intake'
  | 'bar-screen'
  | 'coagulation'
  | 'flocculation'
  | 'sedimentation'
  | 'filtration'
  | 'disinfection'
  | 'clearwell'
  | 'finished-pump'
  | 'chemical-dosing'
  | 'sludge'
  | 'valve'
  | 'pipe';

export type OpState = 'running' | 'standby' | 'fault';

export type OpcQuality = 'Good' | 'Uncertain' | 'Bad';

export interface OpcItem {
  nodeId: string;
  displayName: string;
  value: number | string | boolean;
  unit: string;
  quality: OpcQuality;
  timestamp: number;
  digits: number;
  tag: string;
}

export interface PlacedItem {
  id: string;
  kind: ComponentKind;
  name: string;
  x: number;
  y: number;
  rotation: number;
  state: OpState;
  setpoint: number;
}

export interface FlowConnection {
  id: string;
  fromId: string;
  toId: string;
}

export type Selection =
  | { type: 'item'; id: string }
  | { type: 'connection'; id: string }
  | null;

export type ToolMode = 'select' | 'connect';

export type ViewMode = '2d' | '3d';

export interface SetpointSpec {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface Footprint {
  w: number;
  d: number;
  h: number;
}

export interface UnitViz {
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
}

export interface UnitLive {
  opc: OpcItem[];
  viz: UnitViz;
}

export interface LiveSnapshot {
  time: number;
  byId: Record<string, UnitLive>;
}

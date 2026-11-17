export const PALETTE = {
  ink: '#1a3644',
  inkSoft: '#3d5c6c',
  water: '#2d7fbe',
  waterDeep: '#1c568c',
  waterLite: '#d5ebf6',
  concrete: '#d5d8dc',
  concreteDark: '#b7bcc2',
  steel: '#8ea0ad',
  steelDark: '#5c6c78',
  paint: '#2c6e8a',
  paintDark: '#1d4e66',
  alum: '#d89a2b',
  alumDeep: '#a87418',
  sludge: '#6d4c34',
  sludgeLite: '#c4a588',
  sand: '#c2b48a',
  good: '#1f9d57',
  warn: '#c7860a',
  bad: '#d24b3e',
  select: '#e3a008',
};

export function hexNum(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

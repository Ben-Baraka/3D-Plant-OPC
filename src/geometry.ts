import type { ComponentKind, FlowConnection, Footprint, PlacedItem } from './types';

export const FOOTPRINT: Record<ComponentKind, Footprint> = {
  intake: { w: 7, d: 4.6, h: 1.8 },
  'bar-screen': { w: 3.4, d: 4.2, h: 2.5 },
  coagulation: { w: 5.2, d: 5.2, h: 3.8 },
  flocculation: { w: 8.2, d: 5.2, h: 3.3 },
  sedimentation: { w: 12.5, d: 6.4, h: 3.6 },
  filtration: { w: 8.4, d: 6.2, h: 3.4 },
  disinfection: { w: 11.2, d: 4.4, h: 2.9 },
  clearwell: { w: 11, d: 8.2, h: 3.3 },
  'finished-pump': { w: 3.6, d: 2.4, h: 2.0 },
  'chemical-dosing': { w: 2.8, d: 2.4, h: 2.5 },
  sludge: { w: 5.6, d: 5.6, h: 2.8 },
  valve: { w: 2.0, d: 1.3, h: 1.5 },
  pipe: { w: 6.5, d: 0.9, h: 0.8 },
};

export type EdgeKind = 'water' | 'chemical' | 'sludge';

export function snap(value: number, step = 0.5): number {
  return Math.round(value / step) * step;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function itemAabb(item: PlacedItem): { x: number; y: number; w: number; d: number } {
  const footprint = FOOTPRINT[item.kind];
  const theta = (item.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const w = footprint.w * c + footprint.d * s;
  const d = footprint.w * s + footprint.d * c;
  return { x: item.x - w / 2, y: item.y - d / 2, w, d };
}

export function siteBounds(items: PlacedItem[], pad = 8): { x: number; y: number; w: number; h: number } {
  if (items.length === 0) return { x: -8, y: -10, w: 70, h: 48 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    const box = itemAabb(item);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.d);
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/** Outlet is local +X. Positive rotation is clockwise on the plan (y down). */
export function portPosition(item: PlacedItem, end: 'in' | 'out'): { x: number; y: number } {
  const { w } = FOOTPRINT[item.kind];
  const localX = end === 'out' ? w / 2 : -w / 2;
  const theta = (item.rotation * Math.PI) / 180;
  return {
    x: item.x + localX * Math.cos(theta),
    y: item.y + localX * Math.sin(theta),
  };
}

export function classifyEdge(a: PlacedItem, b: PlacedItem): EdgeKind {
  if (a.kind === 'chemical-dosing' || b.kind === 'chemical-dosing') return 'chemical';
  if (a.kind === 'sludge' || b.kind === 'sludge') return 'sludge';
  return 'water';
}

export function connectionEndpoints(
  from: PlacedItem,
  to: PlacedItem,
): { x1: number; y1: number; x2: number; y2: number; kind: EdgeKind } {
  const kind = classifyEdge(from, to);
  if (kind === 'chemical') {
    const dosing = from.kind === 'chemical-dosing' ? from : to;
    const other = dosing === from ? to : from;
    const port = portPosition(dosing, 'out');
    return { x1: port.x, y1: port.y, x2: other.x, y2: other.y, kind };
  }
  if (kind === 'sludge') {
    const sludge = to.kind === 'sludge' ? to : from;
    const other = sludge === to ? from : to;
    const port = portPosition(sludge, 'in');
    return { x1: other.x, y1: other.y, x2: port.x, y2: port.y, kind };
  }
  const start = portPosition(from, 'out');
  const end = portPosition(to, 'in');
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind };
}

export function normalizeLink(upstream: PlacedItem, downstream: PlacedItem): { fromId: string; toId: string } {
  if (upstream.kind === 'sludge' && downstream.kind !== 'sludge') {
    return { fromId: downstream.id, toId: upstream.id };
  }
  if (downstream.kind === 'chemical-dosing' && upstream.kind !== 'chemical-dosing') {
    return { fromId: downstream.id, toId: upstream.id };
  }
  return { fromId: upstream.id, toId: downstream.id };
}

export interface TrainView {
  chain: PlacedItem[];
  sides: { from: PlacedItem; to: PlacedItem; kind: EdgeKind }[];
}

export function mainTrain(items: PlacedItem[], connections: FlowConnection[]): TrainView {
  const map = new Map(items.map((item) => [item.id, item]));
  const water = connections.filter((connection) => {
    const from = map.get(connection.fromId);
    const to = map.get(connection.toId);
    return from && to && classifyEdge(from, to) === 'water';
  });
  const indegree = new Map(items.map((item) => [item.id, 0]));
  for (const connection of water) {
    indegree.set(connection.toId, (indegree.get(connection.toId) ?? 0) + 1);
  }
  let sources = items.filter(
    (item) =>
      (indegree.get(item.id) ?? 0) === 0 && item.kind !== 'chemical-dosing' && item.kind !== 'sludge',
  );
  if (sources.length === 0) sources = items.filter((item) => item.kind !== 'chemical-dosing' && item.kind !== 'sludge');

  let best: string[] = [];
  const walk = (id: string, path: string[], seen: Set<string>) => {
    const next = water.filter((connection) => connection.fromId === id && !seen.has(connection.toId));
    if (next.length === 0) {
      if (path.length > best.length) best = path.slice();
      return;
    }
    for (const connection of next) {
      seen.add(connection.toId);
      path.push(connection.toId);
      walk(connection.toId, path, seen);
      path.pop();
      seen.delete(connection.toId);
    }
  };
  for (const source of sources) walk(source.id, [source.id], new Set([source.id]));

  const sides = connections.flatMap((connection) => {
    const from = map.get(connection.fromId);
    const to = map.get(connection.toId);
    if (!from || !to) return [];
    const kind = classifyEdge(from, to);
    if (kind === 'water') return [];
    return [{ from, to, kind }];
  });

  return {
    chain: best.flatMap((id) => {
      const item = map.get(id);
      return item ? [item] : [];
    }),
    sides,
  };
}

export function overlaps(a: { x: number; y: number; w: number; d: number }, b: { x: number; y: number; w: number; d: number }, gap = 0.2): boolean {
  return a.x + a.w > b.x + gap && b.x + b.w > a.x + gap && a.y + a.d > b.y + gap && b.y + b.d > a.y + gap;
}

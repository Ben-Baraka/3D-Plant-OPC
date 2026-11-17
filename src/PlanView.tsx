import { useEffect, useRef, useState } from 'react';
import { FOOTPRINT, connectionEndpoints, itemAabb, siteBounds } from './geometry';
import { badgeText } from './sim';
import { SymbolGraphic } from './symbols';
import { usePlant } from './store';
import type { ComponentKind, PlacedItem } from './types';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fitView(items: PlacedItem[], aspect: number): ViewBox {
  const bounds = siteBounds(items, 7);
  let { x, y, w, h } = bounds;
  const current = w / h;
  if (current < aspect) {
    const next = h * aspect;
    x -= (next - w) / 2;
    w = next;
  } else {
    const next = w / aspect;
    y -= (next - h) / 2;
    h = next;
  }
  return { x, y, w, h };
}

export function PlanView({ active }: { active: boolean }) {
  const {
    items,
    connections,
    selection,
    placeKind,
    tool,
    connectFrom,
    live,
    fitToken,
    selectItem,
    selectConnection,
    placeAt,
    moveItem,
    connectClick,
    chooseConnect,
  } = usePlant();
  const svgRef = useRef<SVGSVGElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [view, setView] = useState<ViewBox>({ x: -8, y: -10, w: 70, h: 48 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<
    | { mode: 'item'; id: string; dx: number; dy: number }
    | { mode: 'pan'; px: number; py: number; vx: number; vy: number }
    | { mode: 'place'; px: number; py: number; wx: number; wy: number; moved: boolean }
    | null
  >(null);

  const worldFromEvent = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const mapped = point.matrixTransform(matrix.inverse());
    return { x: mapped.x, y: mapped.y };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const apply = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      setView(fitView(itemsRef.current, rect.width / rect.height));
    };
    apply();
    const observer = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 20) return;
      setView((current) => {
        const aspect = rect.width / rect.height;
        const h = current.w / aspect;
        const cy = current.y + current.h / 2;
        return { ...current, h, y: cy - h / 2 };
      });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [fitToken]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const world = worldFromEvent(event);
      const factor = event.deltaY > 0 ? 1.08 : 0.92;
      setView((current) => {
        const nextW = Math.min(420, Math.max(14, current.w * factor));
        const nextH = current.h * (nextW / current.w);
        const kx = (world.x - current.x) / current.w;
        const ky = (world.y - current.y) / current.h;
        return { x: world.x - kx * nextW, y: world.y - ky * nextH, w: nextW, h: nextH };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const selectedItem = selection?.type === 'item' ? selection.id : null;
  const selectedLink = selection?.type === 'connection' ? selection.id : null;

  return (
    <div className={`plan-wrap ${placeKind ? 'is-placing' : ''} ${tool === 'connect' ? 'is-connecting' : ''}`} hidden={!active}>
      <svg
        ref={svgRef}
        className="plan"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        data-testid="plan"
        onPointerDown={(event) => {
          if (event.button === 1 || event.button === 2 || event.altKey) {
            drag.current = { mode: 'pan', px: event.clientX, py: event.clientY, vx: view.x, vy: view.y };
            (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
            return;
          }
          if (event.button !== 0) return;
          const world = worldFromEvent(event);
          if (placeKind) {
            drag.current = { mode: 'place', px: event.clientX, py: event.clientY, wx: world.x, wy: world.y, moved: false };
          } else if (tool === 'connect') {
            drag.current = null;
          } else {
            drag.current = { mode: 'pan', px: event.clientX, py: event.clientY, vx: view.x, vy: view.y };
          }
          (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          if (current.mode === 'item') {
            const world = worldFromEvent(event);
            moveItem(current.id, world.x - current.dx, world.y - current.dy);
            return;
          }
          const moved = Math.hypot(event.clientX - current.px, event.clientY - current.py);
          if (current.mode === 'place') {
            if (moved > 4) {
              current.moved = true;
              drag.current = { mode: 'pan', px: current.px, py: current.py, vx: view.x, vy: view.y };
            }
            return;
          }
          const svg = svgRef.current;
          if (!svg) return;
          const rect = svg.getBoundingClientRect();
          const scale = view.w / rect.width;
          setView((box) => ({
            ...box,
            x: current.vx - (event.clientX - current.px) * scale,
            y: current.vy - (event.clientY - current.py) * scale,
          }));
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          drag.current = null;
          if (!current) return;
          if (current.mode === 'place' && !current.moved && placeKind) {
            placeAt(placeKind, current.wx, current.wy);
            return;
          }
          if (current.mode === 'pan' && tool === 'select' && !placeKind) {
            const moved = Math.hypot(event.clientX - current.px, event.clientY - current.py);
            if (moved < 4) selectItem(null);
          }
        }}
        onClick={(event) => {
          if (tool !== 'connect' || event.target !== event.currentTarget) return;
          if (connectFrom) chooseConnect();
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <defs>
          <pattern id="grid-minor" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#d5e1e8" strokeWidth="0.03" />
          </pattern>
          <pattern id="grid-major" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#b7c9d4" strokeWidth="0.06" />
          </pattern>
        </defs>
        <rect x={view.x - 50} y={view.y - 50} width={view.w + 100} height={view.h + 100} fill="#e7eef2" />
        <rect x={view.x - 50} y={view.y - 50} width={view.w + 100} height={view.h + 100} fill="url(#grid-minor)" />
        <rect x={view.x - 50} y={view.y - 50} width={view.w + 100} height={view.h + 100} fill="url(#grid-major)" />

        {connections.map((connection) => {
          const from = items.find((item) => item.id === connection.fromId);
          const to = items.find((item) => item.id === connection.toId);
          if (!from || !to) return null;
          const ends = connectionEndpoints(from, to);
          const kind = ends.kind;
          const viz = live.byId[from.id]?.viz;
          const flow = kind === 'chemical' ? viz?.chemFlow ?? 0 : kind === 'sludge' ? viz?.sludgeFlow ?? 0 : viz?.flow ?? 0;
          const activeFlow = flow > 1.5;
          const angle = (Math.atan2(ends.y2 - ends.y1, ends.x2 - ends.x1) * 180) / Math.PI;
          const mid = { x: (ends.x1 + ends.x2) / 2, y: (ends.y1 + ends.y2) / 2 };
          const color = kind === 'chemical' ? '#b7831d' : kind === 'sludge' ? '#6d4c34' : activeFlow ? '#1f6fa8' : '#8aa0ae';
          const selected = selectedLink === connection.id;
          return (
            <g key={connection.id} data-connection-id={connection.id}>
              <line
                x1={ends.x1}
                y1={ends.y1}
                x2={ends.x2}
                y2={ends.y2}
                stroke="transparent"
                strokeWidth={1.4}
                style={{ cursor: 'pointer' }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (tool === 'connect') return;
                  selectConnection(connection.id);
                }}
              />
              <line
                x1={ends.x1}
                y1={ends.y1}
                x2={ends.x2}
                y2={ends.y2}
                stroke={selected ? '#e3a008' : color}
                strokeWidth={selected ? 2.4 : 1.7}
                strokeDasharray={kind === 'water' && activeFlow ? '0.55 0.38' : kind === 'water' ? undefined : '0.28 0.22'}
                className={kind === 'water' && activeFlow ? 'pipe-flow' : undefined}
                style={activeFlow ? { animationDuration: `${Math.max(0.45, 1.8 - Math.min(flow, 700) / 500)}s` } : undefined}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              <polygon
                points="-0.16,-0.22 0.42,0 -0.16,0.22"
                fill={selected ? '#e3a008' : color}
                transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}
                pointerEvents="none"
              />
            </g>
          );
        })}

        {items.map((item) => {
          const selected = selectedItem === item.id;
          const armed = connectFrom === item.id;
          return (
            <g
              key={item.id}
              data-item-id={item.id}
              data-testid={`unit-${item.id}`}
              transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
              className={`unit-symbol is-${item.state} ${selected ? 'is-selected' : ''} ${armed ? 'is-armed' : ''}`}
              onPointerEnter={() => setHover(item.id)}
              onPointerLeave={() => setHover((current) => (current === item.id ? null : current))}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                if (tool === 'connect') {
                  connectClick(item.id);
                  return;
                }
                selectItem(item.id);
                const world = worldFromEvent(event);
                drag.current = { mode: 'item', id: item.id, dx: world.x - item.x, dy: world.y - item.y };
                svgRef.current?.setPointerCapture(event.pointerId);
              }}
            >
              <title>{item.name}</title>
              <SymbolGraphic kind={item.kind} />
              {(selected || armed) && <SelectionHalo kind={item.kind} armed={armed} />}
              {item.state === 'fault' && (
                <polygon
                  points={`${FOOTPRINT[item.kind].w / 2 - 0.05},${-FOOTPRINT[item.kind].d / 2} ${FOOTPRINT[item.kind].w / 2 + 0.45},${-FOOTPRINT[item.kind].d / 2} ${FOOTPRINT[item.kind].w / 2 + 0.2},${-FOOTPRINT[item.kind].d / 2 + 0.55}`}
                  fill="#d24b3e"
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="plan-labels" aria-hidden="true">
        {planLabels(items, svgRef.current, view, selectedItem, hover).map((label) => (
          <div
            key={label.id}
            className={`plan-label ${label.focused ? 'is-selected' : ''}`}
            style={{ left: label.left, top: label.top }}
          >
            <span>{label.name}</span>
            {label.focused && <span>{badgeText(label.item, live.byId[label.id]?.viz)}</span>}
          </div>
        ))}
      </div>
      <div className="plan-hud">
        <span className="north">N</span>
        <ScaleBar view={view} svg={svgRef.current} />
      </div>
    </div>
  );
}

function SelectionHalo({ kind, armed }: { kind: ComponentKind; armed: boolean }) {
  const { w, d } = FOOTPRINT[kind];
  return (
    <rect
      x={-w / 2 - 0.28}
      y={-d / 2 - 0.28}
      width={w + 0.56}
      height={d + 0.56}
      fill="none"
      stroke={armed ? '#178f86' : '#e3a008'}
      strokeWidth={2}
      strokeDasharray={armed ? '5 4' : undefined}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

function planLabels(
  items: PlacedItem[],
  svg: SVGSVGElement | null,
  view: ViewBox,
  selectedId: string | null,
  hoverId: string | null,
): { id: string; name: string; left: number; top: number; focused: boolean; item: PlacedItem }[] {
  if (!svg) return [];
  const matrix = svg.getScreenCTM();
  if (!matrix) return [];
  const host = svg.getBoundingClientRect();
  const pixelsPerMeter = host.width / Math.max(view.w, 1);
  const labels: { id: string; name: string; left: number; top: number; focused: boolean; item: PlacedItem }[] = [];
  let lastLeft = -1e9;
  let shown = 0;
  const ordered = [...items].sort((a, b) => a.x - b.x || a.y - b.y);
  for (const item of ordered) {
    const point = svg.createSVGPoint();
    point.x = item.x;
    point.y = item.y;
    const screen = point.matrixTransform(matrix);
    const box = itemAabb(item);
    const left = screen.x - host.left;
    const centerY = screen.y - host.top;
    const halfH = (box.d * pixelsPerMeter) / 2;
    const focused = item.id === selectedId || item.id === hoverId;
    if (!focused && left - lastLeft < 64) continue;
    const above = shown % 2 === 1;
    shown += 1;
    lastLeft = left;
    const top = above ? centerY - halfH - 18 : centerY + halfH + 4;
    labels.push({ id: item.id, name: item.name, left, top, focused, item });
  }
  return labels;
}

function ScaleBar({ view, svg }: { view: ViewBox; svg: SVGSVGElement | null }) {
  const width = svg?.clientWidth ?? 800;
  const ppm = width / view.w;
  const raw = 120 / Math.max(ppm, 0.001);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const meters = n < 1.5 ? pow : n < 3.5 ? 2 * pow : n < 7.5 ? 5 * pow : 10 * pow;
  const px = meters * ppm;
  return (
    <div className="scalebar">
      <span style={{ width: px }} />
      <em>{meters >= 1 ? `${meters} m` : `${meters * 100} cm`}</em>
    </div>
  );
}

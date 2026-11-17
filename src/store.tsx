import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ALL_KINDS, catalogEntry } from './catalog';
import { normalizeLink, snap } from './geometry';
import { emptySnapshot, step, type Dynamics } from './sim';
import { starterPlant } from './starter';
import type {
  ComponentKind,
  FlowConnection,
  LiveSnapshot,
  OpState,
  PlacedItem,
  Selection,
  ToolMode,
  ViewMode,
} from './types';

const STORAGE_KEY = 'plantworks.layout.v1';

interface Persisted {
  v: 1;
  items: PlacedItem[];
  connections: FlowConnection[];
  seq: number;
}

function isKind(value: string): value is ComponentKind {
  return (ALL_KINDS as string[]).includes(value);
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items) || !Array.isArray(parsed.connections)) return null;
    const items = parsed.items.filter(
      (item) => item && isKind(item.kind) && typeof item.id === 'string' && Number.isFinite(item.x) && Number.isFinite(item.y),
    );
    const ids = new Set(items.map((item) => item.id));
    const connections = parsed.connections.filter(
      (connection) => connection && ids.has(connection.fromId) && ids.has(connection.toId) && connection.fromId !== connection.toId,
    );
    return { v: 1, items, connections, seq: Math.max(100, Number(parsed.seq) || 100) };
  } catch {
    return null;
  }
}

interface PlantContextValue {
  items: PlacedItem[];
  connections: FlowConnection[];
  selection: Selection;
  tool: ToolMode;
  placeKind: ComponentKind | null;
  view: ViewMode;
  connectFrom: string | null;
  status: string | null;
  live: LiveSnapshot;
  fitToken: number;
  setView: (view: ViewMode) => void;
  chooseSelect: () => void;
  chooseConnect: () => void;
  armPlace: (kind: ComponentKind) => void;
  selectItem: (id: string | null) => void;
  selectConnection: (id: string) => void;
  placeAt: (kind: ComponentKind, x: number, y: number) => void;
  moveItem: (id: string, x: number, y: number) => void;
  rotateSelection: (degrees: number) => void;
  deleteSelection: () => void;
  setOpState: (id: string, state: OpState) => void;
  setSetpoint: (id: string, value: number) => void;
  connectClick: (id: string) => void;
  cancelPending: () => void;
  loadStarter: () => void;
  clearPlant: () => void;
  requestFit: () => void;
}

const PlantContext = createContext<PlantContextValue | null>(null);

export function PlantProvider({ children }: { children: ReactNode }) {
  const saved = useRef(loadPersisted());
  const [items, setItems] = useState<PlacedItem[]>(saved.current?.items ?? []);
  const [connections, setConnections] = useState<FlowConnection[]>(saved.current?.connections ?? []);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<ToolMode>('select');
  const [placeKind, setPlaceKind] = useState<ComponentKind | null>(null);
  const [view, setView] = useState<ViewMode>('2d');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [live, setLive] = useState<LiveSnapshot>(emptySnapshot());
  const [fitToken, setFitToken] = useState(1);
  const seq = useRef(saved.current?.seq ?? 100);
  const itemsRef = useRef(items);
  const connectionsRef = useRef(connections);
  const selectionRef = useRef(selection);
  const connectFromRef = useRef(connectFrom);
  const dyn = useRef<Dynamics>({});
  itemsRef.current = items;
  connectionsRef.current = connections;
  selectionRef.current = selection;
  connectFromRef.current = connectFrom;

  const note = useCallback((message: string) => {
    setStatus(message);
  }, []);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 2800);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    const payload: Persisted = { v: 1, items, connections, seq: seq.current };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota */
    }
  }, [items, connections]);

  useEffect(() => {
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      const result = step(itemsRef.current, connectionsRef.current, dyn.current, dt, now / 1000);
      dyn.current = result.dyn;
      setLive(result.snap);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, []);

  const chooseSelect = useCallback(() => {
    setTool('select');
    setPlaceKind(null);
    setConnectFrom(null);
  }, []);

  const chooseConnect = useCallback(() => {
    setTool('connect');
    setPlaceKind(null);
    setConnectFrom(null);
    note('Click the upstream unit, then the downstream unit');
  }, [note]);

  const armPlace = useCallback((kind: ComponentKind) => {
    setPlaceKind(kind);
    setTool('select');
    setConnectFrom(null);
    note(`Placing ${catalogEntry(kind).name}. Click the plan.`);
  }, [note]);

  const selectItem = useCallback((id: string | null) => {
    setSelection(id ? { type: 'item', id } : null);
  }, []);

  const selectConnection = useCallback((id: string) => {
    setSelection({ type: 'connection', id });
  }, []);

  const placeAt = useCallback((kind: ComponentKind, x: number, y: number) => {
    const id = `${kind}-${seq.current}`;
    seq.current += 1;
    const same = itemsRef.current.filter((item) => item.kind === kind).length;
    const entry = catalogEntry(kind);
    const item: PlacedItem = {
      id,
      kind,
      name: same === 0 ? entry.name : `${entry.name} ${same + 1}`,
      x: snap(x),
      y: snap(y),
      rotation: 0,
      state: 'running',
      setpoint: entry.setpoint.default,
    };
    setItems((current) => [...current, item]);
    setSelection({ type: 'item', id });
    note(`Placed ${item.name}`);
  }, [note]);

  const moveItem = useCallback((id: string, x: number, y: number) => {
    const nx = snap(Math.min(400, Math.max(-400, x)));
    const ny = snap(Math.min(400, Math.max(-400, y)));
    setItems((current) => current.map((item) => (item.id === id ? { ...item, x: nx, y: ny } : item)));
  }, []);

  const rotateSelection = useCallback((degrees: number) => {
    const current = selectionRef.current;
    if (!current || current.type !== 'item') return;
    setItems((itemsNow) =>
      itemsNow.map((item) =>
        item.id === current.id ? { ...item, rotation: (item.rotation + degrees + 360) % 360 } : item,
      ),
    );
  }, []);

  const deleteSelection = useCallback(() => {
    const current = selectionRef.current;
    if (!current) return;
    if (current.type === 'item') {
      setItems((itemsNow) => itemsNow.filter((item) => item.id !== current.id));
      setConnections((links) => links.filter((link) => link.fromId !== current.id && link.toId !== current.id));
      note('Unit removed');
    } else {
      setConnections((links) => links.filter((link) => link.id !== current.id));
      note('Connection removed');
    }
    setSelection(null);
  }, [note]);

  const setOpState = useCallback((id: string, state: OpState) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, state } : item)));
  }, []);

  const setSetpoint = useCallback((id: string, value: number) => {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const spec = catalogEntry(item.kind).setpoint;
        const next = Math.min(spec.max, Math.max(spec.min, value));
        return { ...item, setpoint: next };
      }),
    );
  }, []);

  const connectClick = useCallback((id: string) => {
    const fromId = connectFromRef.current;
    if (!fromId) {
      setConnectFrom(id);
      const item = itemsRef.current.find((entry) => entry.id === id);
      note(item ? `${item.name} selected. Click the downstream unit.` : 'Click the downstream unit');
      return;
    }
    if (fromId === id) {
      note('Pick a different unit');
      return;
    }
    const from = itemsRef.current.find((entry) => entry.id === fromId);
    const to = itemsRef.current.find((entry) => entry.id === id);
    if (!from || !to) {
      setConnectFrom(null);
      return;
    }
    const link = normalizeLink(from, to);
    const exists = connectionsRef.current.some(
      (connection) =>
        (connection.fromId === link.fromId && connection.toId === link.toId) ||
        (connection.fromId === link.toId && connection.toId === link.fromId),
    );
    if (exists) {
      note('Those units are already linked');
      setConnectFrom(null);
      return;
    }
    const connection: FlowConnection = { id: `link-${seq.current}`, ...link };
    seq.current += 1;
    setConnections((current) => [...current, connection]);
    setSelection({ type: 'connection', id: connection.id });
    setConnectFrom(null);
    const source = itemsRef.current.find((entry) => entry.id === link.fromId);
    const dest = itemsRef.current.find((entry) => entry.id === link.toId);
    note(`Linked ${source?.name ?? 'unit'} → ${dest?.name ?? 'unit'}`);
  }, [note]);

  const cancelPending = useCallback(() => {
    setPlaceKind(null);
    setConnectFrom(null);
    setTool('select');
    setSelection(null);
  }, []);

  const loadStarter = useCallback(() => {
    const plant = starterPlant();
    dyn.current = {};
    seq.current = plant.seq;
    setItems(plant.items);
    setConnections(plant.connections);
    setSelection(null);
    setConnectFrom(null);
    setPlaceKind(null);
    setTool('select');
    setFitToken((token) => token + 1);
    note('Loaded the conventional treatment train');
  }, [note]);

  const clearPlant = useCallback(() => {
    dyn.current = {};
    setItems([]);
    setConnections([]);
    setSelection(null);
    setConnectFrom(null);
    setPlaceKind(null);
    setFitToken((token) => token + 1);
    note('Layout cleared');
  }, [note]);

  const requestFit = useCallback(() => setFitToken((token) => token + 1), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'Escape') {
        setPlaceKind(null);
        setConnectFrom(null);
        setTool('select');
        setSelection(null);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'r' || event.key === 'R') {
        rotateSelection(event.shiftKey ? -90 : 90);
      } else if (event.key === '[') {
        rotateSelection(-15);
      } else if (event.key === ']') {
        rotateSelection(15);
      } else if (event.key === 'f' || event.key === 'F') {
        requestFit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelection, requestFit, rotateSelection]);

  const value = useMemo<PlantContextValue>(
    () => ({
      items,
      connections,
      selection,
      tool,
      placeKind,
      view,
      connectFrom,
      status,
      live,
      fitToken,
      setView,
      chooseSelect,
      chooseConnect,
      armPlace,
      selectItem,
      selectConnection,
      placeAt,
      moveItem,
      rotateSelection,
      deleteSelection,
      setOpState,
      setSetpoint,
      connectClick,
      cancelPending,
      loadStarter,
      clearPlant,
      requestFit,
    }),
    [
      items,
      connections,
      selection,
      tool,
      placeKind,
      view,
      connectFrom,
      status,
      live,
      fitToken,
      chooseSelect,
      chooseConnect,
      armPlace,
      selectItem,
      selectConnection,
      placeAt,
      moveItem,
      rotateSelection,
      deleteSelection,
      setOpState,
      setSetpoint,
      connectClick,
      cancelPending,
      loadStarter,
      clearPlant,
      requestFit,
    ],
  );

  return <PlantContext.Provider value={value}>{children}</PlantContext.Provider>;
}

export function usePlant(): PlantContextValue {
  const value = useContext(PlantContext);
  if (!value) throw new Error('usePlant must be used inside PlantProvider');
  return value;
}

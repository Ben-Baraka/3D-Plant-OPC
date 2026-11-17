import { useState } from 'react';
import { CATALOG, CATALOG_GROUPS, catalogEntry } from './catalog';
import { FOOTPRINT, classifyEdge, mainTrain } from './geometry';
import { plantHeadline } from './sim';
import { STARTER_NAME } from './starter';
import { usePlant } from './store';
import { SymbolGraphic } from './symbols';
import type { OpcItem, OpState } from './types';

export function Header() {
  const { view, setView, tool, chooseSelect, chooseConnect, loadStarter, clearPlant, items, requestFit, live } = usePlant();
  const [dialog, setDialog] = useState<null | { message: string; confirm: string; run: () => void }>(null);
  const headline = plantHeadline(items, live);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <div>
          <strong>Plantworks</strong>
          <em>Water plant layout · live OPC</em>
        </div>
      </div>
      <div className="segmented" role="group" aria-label="View">
        <button type="button" className={view === '2d' ? 'is-on' : ''} data-testid="view-2d" onClick={() => setView('2d')}>
          2D plan
        </button>
        <button type="button" className={view === '3d' ? 'is-on' : ''} data-testid="view-3d" onClick={() => setView('3d')}>
          3D
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Tool">
        <button type="button" className={tool === 'select' ? 'is-on' : ''} data-testid="tool-select" onClick={chooseSelect}>
          Select
        </button>
        <button type="button" className={tool === 'connect' ? 'is-on' : ''} data-testid="tool-connect" onClick={chooseConnect}>
          Connect flow
        </button>
      </div>
      <button type="button" onClick={requestFit}>
        Frame
      </button>
      <div className="headline" data-testid="headline">
        {headline ? (
          <>
            <span>Finished {headline.flow.toFixed(0)} m³/h</span>
            <span>Turbidity {headline.turbidity.toFixed(2)} NTU</span>
            <span>Cl₂ {headline.chlorine.toFixed(2)} mg/L</span>
          </>
        ) : (
          <span>No flow yet</span>
        )}
      </div>
      <div className="top-actions">
        <button
          type="button"
          className="primary"
          data-testid="load-starter"
          onClick={() => {
            if (items.length === 0) {
              loadStarter();
              return;
            }
            setDialog({
              message: `Replace this layout with the ${STARTER_NAME}?`,
              confirm: 'Load starter',
              run: loadStarter,
            });
          }}
        >
          Load starter
        </button>
        <button
          type="button"
          data-testid="clear-layout"
          disabled={items.length === 0}
          onClick={() =>
            setDialog({
              message: 'Remove every unit and connection from the site?',
              confirm: 'Clear layout',
              run: clearPlant,
            })
          }
        >
          Clear
        </button>
      </div>
      {dialog && (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="modal">
            <p>{dialog.message}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                data-testid="confirm-action"
                onClick={() => {
                  dialog.run();
                  setDialog(null);
                }}
              >
                {dialog.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export function Catalog() {
  const { placeKind, armPlace } = usePlant();
  return (
    <aside className="catalog">
      <div className="panel-head">
        <h2>Catalog</h2>
        <p>Click a unit, then click the plan to place it.</p>
      </div>
      <div className="catalog-scroll">
        {CATALOG_GROUPS.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            {CATALOG.filter((entry) => entry.group === group).map((entry) => (
              <button
                key={entry.kind}
                type="button"
                className={placeKind === entry.kind ? 'catalog-item is-on' : 'catalog-item'}
                data-testid={`catalog-${entry.kind}`}
                title={entry.summary}
                onClick={() => armPlace(entry.kind)}
              >
                <svg viewBox="-3.2 -3.2 6.4 6.4" className="thumb" aria-hidden="true">
                  <g transform={`scale(${5.2 / Math.max(FOOTPRINT[entry.kind].w, FOOTPRINT[entry.kind].d)})`}>
                    <SymbolGraphic kind={entry.kind} />
                  </g>
                </svg>
                <span>
                  <strong>{entry.name}</strong>
                  <small>{entry.summary}</small>
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
      <div className="help">
        <p>Drag to move. R rotates 90°. [ ] rotates 15°. Delete removes. Wheel zooms, drag empty space to pan. F frames the site.</p>
      </div>
    </aside>
  );
}

export function Inspector() {
  const { items, connections, selection, setOpState, setSetpoint, rotateSelection, deleteSelection } = usePlant();
  const { live } = usePlant();

  if (!selection) {
    return (
      <aside className="inspector">
        <div className="panel-head">
          <h2>OPC</h2>
          <p>Select a unit to read its items and operate it.</p>
        </div>
        <div className="inspector-empty">
          <p>Each placed unit publishes OPC-style items on a local timer. Nothing here talks to a PLC.</p>
        </div>
      </aside>
    );
  }

  if (selection.type === 'connection') {
    const connection = connections.find((entry) => entry.id === selection.id);
    const from = items.find((item) => item.id === connection?.fromId);
    const to = items.find((item) => item.id === connection?.toId);
    const kind = from && to ? classifyEdge(from, to) : 'water';
    const viz = from ? live.byId[from.id]?.viz : undefined;
    const flow = kind === 'chemical' ? viz?.chemFlow : kind === 'sludge' ? viz?.sludgeFlow : viz?.flow;
    return (
      <aside className="inspector">
        <div className="panel-head">
          <h2>Process link</h2>
          <p>
            {from?.name ?? 'Unit'} → {to?.name ?? 'Unit'}
          </p>
        </div>
        <div className="inspector-body">
          <p className="note">
            {kind === 'chemical' ? 'Chemical feed' : kind === 'sludge' ? 'Sludge line' : 'Water main'} ·{' '}
            {(flow ?? 0).toFixed(1)} {kind === 'chemical' ? 'L/h' : 'm³/h'}
          </p>
          <button type="button" className="danger" onClick={deleteSelection}>
            Delete connection
          </button>
        </div>
      </aside>
    );
  }

  const item = items.find((entry) => entry.id === selection.id);
  if (!item) {
    return (
      <aside className="inspector">
        <div className="panel-head">
          <h2>OPC</h2>
        </div>
      </aside>
    );
  }
  const entry = catalogEntry(item.kind);
  const opc = live.byId[item.id]?.opc ?? [];
  const digits = entry.setpoint.step < 1 ? 1 : 0;

  return (
    <aside className="inspector">
      <div className="panel-head">
        <h2>{item.name}</h2>
        <p>
          {entry.name} · <span className="node">ns=2;s=WTP.{item.id}</span>
        </p>
      </div>
      <div className="inspector-body">
        <div className="state-switch" role="group" aria-label="Operating state">
          {(['running', 'standby', 'fault'] as OpState[]).map((state) => (
            <button
              key={state}
              type="button"
              className={item.state === state ? `is-on is-${state}` : ''}
              data-testid={`state-${state}`}
              aria-pressed={item.state === state}
              onClick={() => setOpState(item.id, state)}
            >
              {state === 'running' ? 'Start' : state === 'standby' ? 'Stop' : 'Fault'}
            </button>
          ))}
        </div>
        <label className="setpoint">
          <span>
            {entry.setpoint.label}
            <strong data-testid="setpoint-read">
              {item.setpoint.toFixed(digits)} {entry.setpoint.unit}
            </strong>
          </span>
          <input
            type="range"
            min={entry.setpoint.min}
            max={entry.setpoint.max}
            step={entry.setpoint.step}
            value={item.setpoint}
            data-testid="setpoint"
            onChange={(event) => setSetpoint(item.id, Number(event.target.value))}
          />
        </label>
        <p className="note">{entry.note}</p>
        <div className="opc-list" data-testid="opc-list">
          {opc.map((point) => (
            <OpcRow key={point.tag} point={point} />
          ))}
        </div>
        <div className="inspector-actions">
          <button type="button" onClick={() => rotateSelection(90)}>
            Rotate 90°
          </button>
          <button type="button" onClick={() => rotateSelection(15)}>
            15°
          </button>
          <button type="button" className="danger" data-testid="delete-selected" onClick={deleteSelection}>
            Delete
          </button>
        </div>
      </div>
    </aside>
  );
}

function OpcRow({ point }: { point: OpcItem }) {
  const time = new Date(point.timestamp);
  const stamp = `${time.toLocaleTimeString([], { hour12: false })}.${String(time.getMilliseconds()).padStart(3, '0')}`;
  const shown = typeof point.value === 'number' ? point.value.toFixed(point.digits) : String(point.value);
  return (
    <article className="opc-row">
      <header>
        <strong>{point.displayName}</strong>
        <span data-testid={`opc-${point.tag}`}>
          {shown}
          {point.unit ? <em> {point.unit}</em> : null}
        </span>
      </header>
      <code title={point.nodeId}>{point.nodeId}</code>
      <footer>
        <span className={`quality is-${point.quality.toLowerCase()}`} data-testid={`quality-${point.tag}`}>
          {point.quality}
        </span>
        <time dateTime={time.toISOString()}>{stamp}</time>
      </footer>
    </article>
  );
}

export function TrainBar() {
  const { items, connections, selectItem, selection, status, placeKind, tool, connectFrom } = usePlant();
  const train = mainTrain(items, connections);
  const selectedId = selection?.type === 'item' ? selection.id : null;
  const placing = placeKind ? catalogEntry(placeKind).name : null;
  const fromName = connectFrom ? items.find((item) => item.id === connectFrom)?.name : null;

  return (
    <footer className="trainbar">
      <div className="train" data-testid="train">
        <span className="train-label">Process train</span>
        {train.chain.length === 0 ? (
          <em>Link units from intake toward finished water.</em>
        ) : (
          <div className="chips">
            {train.chain.map((item, index) => (
              <span key={item.id} className="chip-wrap">
                {index > 0 && <span className="arrow">→</span>}
                <button
                  type="button"
                  className={selectedId === item.id ? 'chip is-on' : 'chip'}
                  onClick={() => selectItem(item.id)}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </div>
        )}
        {train.sides.length > 0 && (
          <div className="sides">
            {train.sides.map((side) => (
              <span key={`${side.from.id}-${side.to.id}`}>
                {side.kind === 'chemical' ? `${side.from.name} feeds ${side.to.name}` : `${side.from.name} to ${side.to.name}`}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="train-status">
        {placing && <span className="banner">Placing {placing}</span>}
        {tool === 'connect' && <span className="banner">{fromName ? `From ${fromName} — click downstream` : 'Click upstream, then downstream'}</span>}
        {status && <span data-testid="status">{status}</span>}
        <span className="live">
          <i /> Local OPC · 4 Hz
        </span>
      </div>
    </footer>
  );
}

export function EmptyState() {
  const { items, loadStarter } = usePlant();
  if (items.length > 0) return null;
  return (
    <div className="empty">
      <div className="empty-card">
        <h2>The site is empty</h2>
        <p>Lay out a water treatment plant in plan, then switch the same layout into 3D. Every unit carries simulated OPC process data.</p>
        <button type="button" className="primary" onClick={loadStarter}>
          Load starter plant
        </button>
      </div>
    </div>
  );
}

# Plantworks

A local workspace for laying out a water treatment plant in plan, switching that same layout into 3D, and watching every placed unit publish simulated OPC process data.

There is no login and no backend. The simulation runs in the browser on a timer.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (by default [http://127.0.0.1:5173](http://127.0.0.1:5173)).

```bash
npm run check   # hydraulic simulation checks
npm run build   # typecheck and production bundle
```

## What you can do

- Place, move, rotate, and delete treatment units from the catalog: intake, bar screen, coagulation, flocculation, sedimentation, filtration, disinfection, clearwell, finished-water pump, chemical dosing, sludge handling, valve, and pipe run.
- Connect flow from upstream to downstream. The process train is drawn in the 2D plan and as pipes in the 3D view.
- Load a conventional 520 m³/h starter train, or clear the site.
- Select a unit to read OPC-style items (node id, display name, value, unit, quality, timestamp) and to start, stop, fault, or change its setpoint. The simulation follows upstream flow and that operating state.

Tank and clearwell levels are time-scaled so storage changes are visible while you watch. Flows, doses, and residuals are in ordinary engineering units.

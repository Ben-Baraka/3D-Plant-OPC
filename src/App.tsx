import { Header, Catalog, Inspector, TrainBar, EmptyState } from './ui';
import { PlanView } from './PlanView';
import { SceneView } from './SceneView';
import { PlantProvider, usePlant } from './store';

function Workspace() {
  const { view } = usePlant();
  return (
    <div className="app">
      <Header />
      <div className="workspace">
        <Catalog />
        <main className="stage">
          <PlanView active={view === '2d'} />
          <SceneView active={view === '3d'} />
          <EmptyState />
        </main>
        <Inspector />
      </div>
      <TrainBar />
    </div>
  );
}

export function App() {
  return (
    <PlantProvider>
      <Workspace />
    </PlantProvider>
  );
}

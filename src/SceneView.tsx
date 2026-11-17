import { useEffect, useRef } from 'react';
import { PlantScene, type SceneHandlers } from './scene';
import { usePlant } from './store';

export function SceneView({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PlantScene | null>(null);
  const {
    items,
    connections,
    selection,
    fitToken,
    live,
    selectItem,
    selectConnection,
    placeAt,
    moveItem,
    connectClick,
    placeKind,
    tool,
  } = usePlant();
  const handlers = useRef<SceneHandlers>({
    getPlaceKind: () => null,
    getTool: () => 'select',
    onSelectItem: () => undefined,
    onSelectConnection: () => undefined,
    onPlace: () => undefined,
    onMove: () => undefined,
    onConnect: () => undefined,
  });
  handlers.current = {
    getPlaceKind: () => placeKind,
    getTool: () => tool,
    onSelectItem: selectItem,
    onSelectConnection: selectConnection,
    onPlace: placeAt,
    onMove: moveItem,
    onConnect: connectClick,
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new PlantScene(host, {
      getPlaceKind: () => handlers.current.getPlaceKind(),
      getTool: () => handlers.current.getTool(),
      onSelectItem: (id) => handlers.current.onSelectItem(id),
      onSelectConnection: (id) => handlers.current.onSelectConnection(id),
      onPlace: (kind, x, y) => handlers.current.onPlace(kind, x, y),
      onMove: (id, x, y) => handlers.current.onMove(id, x, y),
      onConnect: (id) => handlers.current.onConnect(id),
    });
    sceneRef.current = scene;
    const observer = new ResizeObserver(() => scene.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setLayout(items, connections, selection);
  }, [items, connections, selection]);

  useEffect(() => {
    sceneRef.current?.setLive(live);
  }, [live]);

  useEffect(() => {
    sceneRef.current?.setActive(active);
    if (active) sceneRef.current?.resize();
  }, [active]);

  useEffect(() => {
    sceneRef.current?.frame(items);
    // Frame when the user asks, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  return <div ref={hostRef} className="scene-host" data-testid="scene" hidden={!active} />;
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { connectionEndpoints, siteBounds, type EdgeKind } from './geometry';
import { PIPE_COLORS, buildUnit, waterTint } from './meshes';
import type { FlowConnection, LiveSnapshot, PlacedItem, Selection } from './types';

export interface SceneHandlers {
  getPlaceKind: () => PlacedItem['kind'] | null;
  getTool: () => 'select' | 'connect';
  onSelectItem: (id: string | null) => void;
  onSelectConnection: (id: string) => void;
  onPlace: (kind: PlacedItem['kind'], x: number, y: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (id: string) => void;
}

interface PipeVisual {
  id: string;
  kind: EdgeKind;
  curve: THREE.CatmullRomCurve3;
  droplets: THREE.Mesh[];
  flow: number;
}

const PAD_Y = 0.12;

export class PlantScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private pad: THREE.Mesh;
  private ring: THREE.Mesh;
  private equipment = new THREE.Group();
  private pipes = new THREE.Group();
  private units = new Map<string, THREE.Group>();
  private pipeVisuals: PipeVisual[] = [];
  private handlers: SceneHandlers;
  private live: LiveSnapshot = { time: 0, byId: {} };
  private items: PlacedItem[] = [];
  private layoutConnections: FlowConnection[] = [];
  private frameId = 0;
  private disposed = false;
  private reduceMotion = false;
  private dragging: { id: string; offsetX: number; offsetZ: number } | null = null;
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pointer = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private active = true;

  constructor(
    private host: HTMLElement,
    handlers: SceneHandlers,
  ) {
    this.handlers = handlers;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#c5d5df');
    this.scene.fog = new THREE.Fog('#c5d5df', 90, 320);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800);
    this.camera.position.set(18, 36, 58);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 280;
    this.controls.target.set(40, 0, 16);

    this.scene.add(new THREE.HemisphereLight('#f7fbff', '#6d7568', 0.92));
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.22));
    this.sun = new THREE.DirectionalLight('#fff4e4', 1.45);
    this.sun.position.set(50, 70, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const shadow = this.sun.shadow.camera;
    shadow.near = 1;
    shadow.far = 280;
    shadow.left = -140;
    shadow.right = 140;
    shadow.top = 140;
    shadow.bottom = -140;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const yard = new THREE.Mesh(
      new THREE.CircleGeometry(220, 48),
      new THREE.MeshStandardMaterial({ color: '#6f7d72', roughness: 1 }),
    );
    yard.rotation.x = -Math.PI / 2;
    yard.receiveShadow = true;
    this.scene.add(yard);
    const grid = new THREE.GridHelper(220, 44, '#9aaba4', '#c5d0c8');
    grid.position.y = 0.01;
    this.scene.add(grid);

    this.pad = new THREE.Mesh(
      new THREE.BoxGeometry(40, PAD_Y, 30),
      new THREE.MeshStandardMaterial({ color: '#d0d4d8', roughness: 0.92 }),
    );
    this.pad.position.y = PAD_Y / 2;
    this.pad.receiveShadow = true;
    this.scene.add(this.pad);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40),
      new THREE.MeshBasicMaterial({ color: '#e3a008', side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = PAD_Y + 0.04;
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.scene.add(this.equipment);
    this.scene.add(this.pipes);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown, true);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

    this.resize();
    this.animate();
  }

  setHandlers(handlers: SceneHandlers): void {
    this.handlers = handlers;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.resize();
  }

  setLive(snapshot: LiveSnapshot): void {
    this.live = snapshot;
  }

  resize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  frame(items: PlacedItem[]): void {
    const bounds = siteBounds(items, 4);
    const cx = bounds.x + bounds.w / 2;
    const cz = bounds.y + bounds.h / 2;
    const span = Math.max(bounds.w, bounds.h, 20);
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx + span * 0.05, span * 0.62, cz + span * 0.78);
    this.controls.update();
    this.sun.position.set(cx + span * 0.4, span * 0.9, cz + span * 0.25);
    this.sun.target.position.set(cx, 0, cz);
    const shadow = this.sun.shadow.camera;
    const reach = span * 0.85;
    shadow.left = -reach;
    shadow.right = reach;
    shadow.top = reach;
    shadow.bottom = -reach;
    shadow.updateProjectionMatrix();
  }

  setLayout(items: PlacedItem[], connections: FlowConnection[], selection: Selection): void {
    this.items = items;
    this.layoutConnections = connections;
    const seen = new Set(items.map((item) => item.id));
    for (const [id, group] of this.units) {
      if (seen.has(id)) continue;
      this.equipment.remove(group);
      disposeTree(group);
      this.units.delete(id);
    }
    for (const item of items) {
      let group = this.units.get(item.id);
      if (!group || group.userData.kind !== item.kind || group.userData.labelName !== item.name) {
        if (group) {
          this.equipment.remove(group);
          disposeTree(group);
        }
        const built = buildUnit(item.kind, item.name);
        group = built.group;
        group.userData.kind = item.kind;
        group.userData.itemId = item.id;
        group.userData.labelName = item.name;
        group.userData.beacon = built.beacon;
        this.equipment.add(group);
        this.units.set(item.id, group);
      }
      group.position.set(item.x, PAD_Y, item.y);
      group.rotation.y = (-item.rotation * Math.PI) / 180;
      const beaconMesh = group.userData.beacon as THREE.Mesh | undefined;
      if (beaconMesh && beaconMesh.material instanceof THREE.MeshStandardMaterial) {
        const color = item.state === 'fault' ? '#d24b3e' : item.state === 'standby' ? '#c7860a' : '#1f9d57';
        beaconMesh.material.color.set(color);
        beaconMesh.material.emissive.set(color);
      }
    }

    this.rebuildPipes(items, connections, selection);
    this.updatePad(items);
    this.updateRing(items, selection);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown, true);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private updatePad(items: PlacedItem[]): void {
    const bounds = siteBounds(items, 6);
    this.pad.geometry.dispose();
    this.pad.geometry = new THREE.BoxGeometry(Math.max(24, bounds.w), PAD_Y, Math.max(18, bounds.h));
    this.pad.position.set(bounds.x + bounds.w / 2, PAD_Y / 2, bounds.y + bounds.h / 2);
  }

  private updateRing(items: PlacedItem[], selection: Selection): void {
    if (!selection || selection.type !== 'item') {
      this.ring.visible = false;
      return;
    }
    const item = items.find((entry) => entry.id === selection.id);
    if (!item) {
      this.ring.visible = false;
      return;
    }
    const group = this.units.get(item.id);
    const span = group ? new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()) : new THREE.Vector3(4, 1, 4);
    const radius = Math.max(span.x, span.z) * 0.58 + 0.4;
    this.ring.scale.set(radius, radius, radius);
    this.ring.position.set(item.x, PAD_Y + 0.05, item.y);
    this.ring.visible = true;
  }

  private rebuildPipes(items: PlacedItem[], connections: FlowConnection[], selection: Selection): void {
    for (const child of [...this.pipes.children]) {
      this.pipes.remove(child);
      disposeTree(child);
    }
    this.pipeVisuals = [];
    const map = new Map(items.map((item) => [item.id, item]));
    for (const connection of connections) {
      const from = map.get(connection.fromId);
      const to = map.get(connection.toId);
      if (!from || !to) continue;
      const ends = connectionEndpoints(from, to);
      const distance = Math.hypot(ends.x2 - ends.x1, ends.y2 - ends.y1);
      if (distance < 0.35) continue;
      const y = PAD_Y + 0.28;
      const lift = Math.min(1.1, distance * 0.07);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ends.x1, y, ends.y1),
        new THREE.Vector3((ends.x1 + ends.x2) / 2, y + lift, (ends.y1 + ends.y2) / 2),
        new THREE.Vector3(ends.x2, y, ends.y2),
      ]);
      const radius = ends.kind === 'chemical' ? 0.05 : ends.kind === 'sludge' ? 0.09 : 0.14;
      const geometry = new THREE.TubeGeometry(curve, 28, radius, 8, false);
      const material = new THREE.MeshStandardMaterial({
        color: PIPE_COLORS[ends.kind],
        roughness: 0.38,
        metalness: ends.kind === 'water' ? 0.45 : 0.15,
      });
      if (selection?.type === 'connection' && selection.id === connection.id) {
        material.emissive = new THREE.Color('#e3a008');
        material.emissiveIntensity = 0.45;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.userData.connectionId = connection.id;
      this.pipes.add(mesh);

      const hit = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 18, Math.max(0.38, radius * 2.4), 6, false),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.userData.connectionId = connection.id;
      this.pipes.add(hit);

      const droplets: THREE.Mesh[] = [];
      if (ends.kind === 'water') {
        for (let index = 0; index < 3; index += 1) {
          const drop = new THREE.Mesh(
            new THREE.SphereGeometry(0.11, 10, 10),
            new THREE.MeshStandardMaterial({ color: '#e7f6ff', emissive: '#9fd4f5', emissiveIntensity: 0.35, roughness: 0.2 }),
          );
          drop.castShadow = false;
          drop.visible = false;
          drop.userData.phase = index / 3;
          this.pipes.add(drop);
          droplets.push(drop);
        }
      }
      this.pipeVisuals.push({ id: connection.id, kind: ends.kind, curve, droplets, flow: 0 });
    }
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    if (!this.active) return;
    const time = performance.now() / 1000;
    for (const [id, group] of this.units) {
      const viz = this.live.byId[id]?.viz;
      const waters = (group.userData.waters as THREE.Mesh[] | undefined) ?? [];
      if (!viz) continue;
      const color = waterTint(group.userData.kind as PlacedItem['kind'], viz.turbidity, viz.chlorine);
      for (const water of waters) {
        if (water.userData.role !== 'process-water') continue;
        if (water.material instanceof THREE.MeshStandardMaterial) water.material.color.copy(color);
      }
    }
    for (const pipe of this.pipeVisuals) {
      const fromId = this.connectionFrom(pipe.id);
      const viz = fromId ? this.live.byId[fromId]?.viz : undefined;
      const flow = pipe.kind === 'chemical' ? viz?.chemFlow ?? 0 : pipe.kind === 'sludge' ? viz?.sludgeFlow ?? 0 : viz?.flow ?? 0;
      pipe.flow = flow;
      const moving = flow > 1.5;
      pipe.droplets.forEach((drop, index) => {
        drop.visible = moving;
        if (!moving) return;
        const phase = (drop.userData.phase as number) ?? index / 3;
        const speed = this.reduceMotion ? 0 : 0.05 + Math.min(flow, 800) / 1400;
        const t = (phase + time * speed) % 1;
        drop.position.copy(pipe.curve.getPointAt(t));
      });
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private connectionFrom(id: string): string | null {
    return this.layoutConnections.find((entry) => entry.id === id)?.fromId ?? null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const hit = this.pick(event);
    const placeKind = this.handlers.getPlaceKind();
    if (this.handlers.getTool() === 'connect') {
      if (hit?.itemId) {
        event.stopPropagation();
        event.preventDefault();
        this.handlers.onConnect(hit.itemId);
      }
      return;
    }
    if (hit?.itemId) {
      event.stopPropagation();
      event.preventDefault();
      this.handlers.onSelectItem(hit.itemId);
      const point = this.groundPoint(event);
      const item = this.items.find((entry) => entry.id === hit.itemId);
      if (point && item && !placeKind) {
        this.dragging = { id: item.id, offsetX: item.x - point.x, offsetZ: item.y - point.z };
        this.controls.enabled = false;
      }
      return;
    }
    if (hit?.connectionId && !placeKind) {
      event.stopPropagation();
      event.preventDefault();
      this.handlers.onSelectConnection(hit.connectionId);
      return;
    }
    const point = this.groundPoint(event);
    if (placeKind && point) {
      event.stopPropagation();
      event.preventDefault();
      this.handlers.onPlace(placeKind, point.x, point.z);
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const point = this.groundPoint(event);
    if (!point) return;
    this.handlers.onMove(this.dragging.id, point.x + this.dragging.offsetX, point.z + this.dragging.offsetZ);
  };

  private onPointerUp = (): void => {
    this.dragging = null;
    this.controls.enabled = true;
  };

  private pick(event: PointerEvent): { itemId?: string; connectionId?: string } | null {
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.equipment.children, ...this.pipes.children], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (typeof node.userData.itemId === 'string') return { itemId: node.userData.itemId };
        if (typeof node.userData.connectionId === 'string') return { connectionId: node.userData.connectionId };
        node = node.parent;
      }
    }
    return null;
  }

  private groundPoint(event: PointerEvent): THREE.Vector3 | null {
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.ground, point);
    return hit ? point : null;
  }

  private setPointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => disposeMaterial(entry));
    } else if (material) disposeMaterial(material);
  });
}

function disposeMaterial(material: THREE.Material): void {
  if (material.userData.shared) return;
  const textured = material as THREE.MeshStandardMaterial;
  if (textured.map) textured.map.dispose();
  material.dispose();
}

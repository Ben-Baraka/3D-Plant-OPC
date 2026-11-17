import * as THREE from 'three';
import { FOOTPRINT } from './geometry';
import { PALETTE, hexNum } from './palette';
import type { ComponentKind } from './types';

const staticMaterials = new Map<string, THREE.MeshStandardMaterial>();

function mat(hex: string, rough = 0.72, metal = 0.08): THREE.MeshStandardMaterial {
  const key = `${hex}-${rough}-${metal}`;
  const cached = staticMaterials.get(key);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({
    color: hexNum(hex),
    roughness: rough,
    metalness: metal,
  });
  material.userData.shared = true;
  staticMaterials.set(key, material);
  return material;
}

export interface BuiltUnit {
  group: THREE.Group;
  waters: THREE.Mesh[];
  beacon: THREE.Mesh;
}

function addBox(
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  hex: string,
  x: number,
  y: number,
  z: number,
  rough = 0.8,
  metal = 0.04,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex, rough, metal));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addCyl(
  group: THREE.Group,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  hex: string,
  x: number,
  y: number,
  z: number,
  axis: 'x' | 'y' | 'z' = 'y',
  rough = 0.55,
  metal = 0.35,
  segments = 20,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), mat(hex, rough, metal));
  mesh.position.set(x, y, z);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addWater(group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: hexNum(PALETTE.water),
    transparent: true,
    opacity: 0.72,
    roughness: 0.12,
    metalness: 0.04,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.role = 'process-water';
  group.add(mesh);
  return mesh;
}

function channel(group: THREE.Group, w: number, d: number, wall: number, h: number): void {
  addBox(group, w, 0.16, d, PALETTE.concreteDark, 0, 0.08, 0);
  addBox(group, wall, h, d, PALETTE.concrete, -w / 2 + wall / 2, h / 2, 0);
  addBox(group, wall, h, d, PALETTE.concrete, w / 2 - wall / 2, h / 2, 0);
  addBox(group, w, h, wall, PALETTE.concrete, 0, h / 2, -d / 2 + wall / 2);
}

function beacon(group: THREE.Group, height: number): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: hexNum(PALETTE.good),
    emissive: hexNum('#145c32'),
    emissiveIntensity: 0.7,
    roughness: 0.4,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14), material);
  mesh.position.set(0, height + 0.28, 0);
  mesh.castShadow = false;
  group.add(mesh);
  return mesh;
}

function labelSprite(name: string, height: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Sprite();
  context.fillStyle = 'rgba(16, 28, 34, 0.78)';
  context.fillRect(8, 16, 496, 64);
  context.fillStyle = '#f4f8fa';
  context.font = '600 36px Barlow, Segoe UI, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const text = name.length > 26 ? `${name.slice(0, 25)}…` : name;
  context.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(6.6, 1.25, 1);
  sprite.position.y = height + 0.95;
  sprite.renderOrder = 4;
  return sprite;
}

function buildIntake(group: THREE.Group, waters: THREE.Mesh[]): void {
  const { w, d, h } = FOOTPRINT.intake;
  channel(group, w, d, 0.28, h);
  addBox(group, 0.12, h * 0.85, d - 0.5, PALETTE.steelDark, -w / 2 + 0.7, h * 0.45, 0, 0.4, 0.5);
  waters.push(addWater(group, w - 0.7, 0.55, d - 0.7, 0.15, 0.48, 0));
}

function buildScreen(group: THREE.Group): void {
  const { w, d, h } = FOOTPRINT['bar-screen'];
  channel(group, w, d, 0.22, h * 0.72);
  addBox(group, w - 0.2, 0.16, 0.16, PALETTE.steel, 0, h * 0.78, -d / 2 + 0.45, 0.35, 0.6);
  addBox(group, w - 0.2, 0.16, 0.16, PALETTE.steel, 0, h * 0.78, d / 2 - 0.45, 0.35, 0.6);
  const bars = 7;
  for (let index = 0; index < bars; index += 1) {
    const z = -d / 2 + 0.55 + index * ((d - 1.1) / (bars - 1));
    addBox(group, 0.08, h * 0.7, 0.08, PALETTE.steelDark, 0.1, h * 0.4, z, 0.3, 0.7);
  }
}

function buildCoagulation(group: THREE.Group, waters: THREE.Mesh[]): void {
  const { h } = FOOTPRINT.coagulation;
  const radius = 2.35;
  addCyl(group, radius, radius, h, PALETTE.concrete, 0, h / 2, 0, 'y', 0.86, 0.02, 28);
  addCyl(group, radius + 0.08, radius + 0.08, 0.16, PALETTE.concreteDark, 0, h, 0, 'y', 0.8, 0.05, 28);
  const water = addCyl(group, radius - 0.18, radius - 0.18, 0.22, PALETTE.water, 0, h * 0.72, 0, 'y', 0.12, 0.02, 28);
  water.material = new THREE.MeshStandardMaterial({
    color: hexNum(PALETTE.water),
    transparent: true,
    opacity: 0.72,
    roughness: 0.12,
    depthWrite: false,
  });
  water.userData.role = 'process-water';
  waters.push(water);
  addCyl(group, 0.08, 0.08, h * 0.7, PALETTE.steelDark, 0, h * 0.55, 0, 'y', 0.3, 0.7);
  addBox(group, 1.5, 0.08, 0.18, PALETTE.paint, 0, h * 0.42, 0, 0.45, 0.3);
  addBox(group, 0.18, 0.08, 1.5, PALETTE.paint, 0, h * 0.42, 0, 0.45, 0.3);
}

function buildFloc(group: THREE.Group, waters: THREE.Mesh[]): void {
  const { w, d, h } = FOOTPRINT.flocculation;
  addBox(group, w, 0.18, d, PALETTE.concreteDark, 0, 0.09, 0);
  addBox(group, 0.2, h, d, PALETTE.concrete, -w / 2 + 0.1, h / 2, 0);
  addBox(group, 0.2, h, d, PALETTE.concrete, w / 2 - 0.1, h / 2, 0);
  addBox(group, w, h, 0.2, PALETTE.concrete, 0, h / 2, -d / 2 + 0.1);
  addBox(group, w, h, 0.2, PALETTE.concrete, 0, h / 2, d / 2 - 0.1);
  for (let index = 0; index < 3; index += 1) {
    const x = -w / 2 + 2 + index * 2.1;
    const z = index % 2 === 0 ? -0.35 : 0.35;
    addBox(group, 0.12, h * 0.78, d * 0.62, PALETTE.concreteDark, x, h * 0.4, z);
  }
  waters.push(addWater(group, w - 0.55, 0.35, d - 0.55, 0, h * 0.62, 0));
}

function buildSed(group: THREE.Group, waters: THREE.Mesh[]): void {
  const { w, d, h } = FOOTPRINT.sedimentation;
  addBox(group, w, 0.2, d, PALETTE.concreteDark, 0, 0.1, 0);
  addBox(group, 0.22, h, d, PALETTE.concrete, -w / 2 + 0.11, h / 2, 0);
  addBox(group, 0.22, h, d, PALETTE.concrete, w / 2 - 0.11, h / 2, 0);
  addBox(group, w, h, 0.22, PALETTE.concrete, 0, h / 2, -d / 2 + 0.11);
  addBox(group, w, h, 0.22, PALETTE.concrete, 0, h / 2, d / 2 - 0.11);
  addBox(group, 1.1, h * 0.45, d - 0.6, PALETTE.concreteDark, w / 2 - 1.1, h * 0.28, 0);
  waters.push(addWater(group, w - 0.7, 0.42, d - 0.7, -0.2, h * 0.58, 0));
  addBox(group, w * 0.55, 0.1, 0.35, PALETTE.paint, 0.4, h + 0.08, 0, 0.5, 0.2);
}

function buildFilter(group: THREE.Group, waters: THREE.Mesh[]): void {
  const { w, d, h } = FOOTPRINT.filtration;
  addBox(group, w, h * 0.55, d, PALETTE.concrete, 0, h * 0.28, 0);
  addBox(group, w - 0.3, 0.35, d - 0.4, PALETTE.sand, 0, h * 0.5, 0, 0.95, 0);
  for (let index = 0; index < 3; index += 1) {
    const x = -w / 2 + (index + 1) * (w / 4);
    addBox(group, 0.1, h * 0.7, d - 0.3, PALETTE.concreteDark, x, h * 0.45, 0);
  }
  waters.push(addWater(group, w - 0.45, 0.28, d - 0.5, 0, h * 0.72, 0));
  addCyl(group, 0.16, 0.16, w * 0.8, PALETTE.steel, 0, h * 0.25, d / 2 + 0.05, 'x', 0.35, 0.6);
}

function buildContact(group: THREE.Group, waters: THREE.Mesh[]): void {
  const { w, d, h } = FOOTPRINT.disinfection;
  addBox(group, w, 0.18, d, PALETTE.concreteDark, 0, 0.09, 0);
  addBox(group, 0.18, h, d, PALETTE.concrete, -w / 2 + 0.09, h / 2, 0);
  addBox(group, 0.18, h, d, PALETTE.concrete, w / 2 - 0.09, h / 2, 0);
  addBox(group, w, h, 0.18, PALETTE.concrete, 0, h / 2, -d / 2 + 0.09);
  addBox(group, w, h, 0.18, PALETTE.concrete, 0, h / 2, d / 2 - 0.09);
  addBox(group, 0.12, h * 0.75, d * 0.7, PALETTE.concreteDark, -w * 0.18, h * 0.4, -d * 0.12);
  addBox(group, 0.12, h * 0.75, d * 0.7, PALETTE.concreteDark, w * 0.16, h * 0.4, d * 0.12);
  waters.push(addWater(group, w - 0.5, 0.36, d - 0.5, 0, h * 0.55, 0));
}

function buildClearwell(group: THREE.Group, waters: THREE.Mesh[]): void {
  const { w, d, h } = FOOTPRINT.clearwell;
  addBox(group, w, h * 0.72, d, PALETTE.concrete, 0, h * 0.36, 0);
  waters.push(addWater(group, w - 0.8, 0.3, d - 0.8, 0, h * 0.62, 0));
  const deck = addBox(group, w + 0.1, 0.12, d + 0.1, PALETTE.concreteDark, 0, h * 0.78, 0);
  deck.material = mat(PALETTE.concreteDark, 0.9, 0);
  addCyl(group, 0.45, 0.45, 0.2, PALETTE.steel, -w * 0.2, h * 0.9, -d * 0.15, 'y', 0.4, 0.5);
  addBox(group, 0.7, 0.35, 0.7, PALETTE.paint, w * 0.22, h * 0.95, d * 0.18, 0.5, 0.25);
}

function buildPump(group: THREE.Group): void {
  const { h } = FOOTPRINT['finished-pump'];
  addBox(group, 3.2, 0.16, 2.05, PALETTE.concreteDark, 0, 0.08, 0);
  addCyl(group, 0.55, 0.55, 1.15, PALETTE.paint, -0.15, 0.75, 0, 'x', 0.4, 0.35);
  addCyl(group, 0.62, 0.48, 0.45, PALETTE.paintDark, 0.55, 0.75, 0, 'x', 0.4, 0.3);
  addCyl(group, 0.32, 0.32, 1.05, PALETTE.steel, -1.15, 0.72, 0, 'x', 0.28, 0.75);
  addBox(group, 0.7, 0.55, 0.7, PALETTE.steelDark, -1.15, 1.15, 0, 0.35, 0.6);
  addCyl(group, 0.14, 0.14, 0.7, PALETTE.steel, 1.15, 0.72, 0, 'x', 0.3, 0.7);
  addCyl(group, 0.14, 0.14, 0.55, PALETTE.steel, -0.15, 0.72, 0.7, 'z', 0.3, 0.7);
  void h;
}

function buildChemical(group: THREE.Group): void {
  const { h } = FOOTPRINT['chemical-dosing'];
  addBox(group, 1.5, 1.35, 1.35, PALETTE.alum,  -0.35, 0.75, 0, 0.55, 0.05);
  const liquid = addBox(group, 1.32, 0.7, 1.18, PALETTE.alumDeep, -0.35, 0.7, 0, 0.3, 0.02);
  liquid.userData.role = 'chemical';
  addBox(group, 0.7, 0.5, 0.55, PALETTE.steel, 0.85, 0.4, 0, 0.35, 0.55);
  addCyl(group, 0.06, 0.06, 1.1, PALETTE.alumDeep, 0.35, 0.55, 0, 'x', 0.4, 0.2);
  addBox(group, 1.7, 0.08, 1.5, PALETTE.concreteDark, 0, 0.04, 0);
  void h;
}

function buildSludge(group: THREE.Group): void {
  const h = 2.5;
  const radius = 2.55;
  addCyl(group, radius, radius, h, PALETTE.sludge, 0, h / 2, 0, 'y', 0.85, 0.04, 28);
  const surface = addCyl(group, radius - 0.16, radius - 0.16, 0.16, PALETTE.sludgeLite, 0, h * 0.78, 0, 'y', 0.4, 0.05, 28);
  surface.userData.role = 'sludge';
  addBox(group, radius * 2.05, 0.12, 0.28, PALETTE.steel, 0, h + 0.15, 0, 0.35, 0.55);
  addBox(group, 0.1, 0.1, radius * 1.7, PALETTE.steelDark, 0, h * 0.45, 0, 0.35, 0.5);
  addCyl(group, 0.18, 0.18, h * 0.7, PALETTE.steelDark, 0, h * 0.4, 0, 'y', 0.3, 0.6);
}

function buildValve(group: THREE.Group): void {
  addCyl(group, 0.16, 0.16, 1.7, PALETTE.steel, 0, 0.42, 0, 'x', 0.28, 0.7);
  addCyl(group, 0.28, 0.12, 0.38, PALETTE.paint, -0.18, 0.42, 0, 'x', 0.4, 0.4);
  addCyl(group, 0.12, 0.28, 0.38, PALETTE.paint, 0.18, 0.42, 0, 'x', 0.4, 0.4);
  addCyl(group, 0.06, 0.06, 0.45, PALETTE.steelDark, 0, 0.85, 0, 'y', 0.3, 0.6);
  const wheel = addCyl(group, 0.22, 0.22, 0.06, PALETTE.alum, 0, 1.12, 0, 'y', 0.4, 0.5);
  wheel.scale.set(1, 0.35, 1);
}

function buildPipe(group: THREE.Group): void {
  const { w } = FOOTPRINT.pipe;
  addCyl(group, 0.2, 0.2, w - 0.2, PALETTE.steel, 0, 0.36, 0, 'x', 0.32, 0.62, 18);
  addCyl(group, 0.32, 0.32, 0.08, PALETTE.steelDark, -w / 2 + 0.08, 0.36, 0, 'x', 0.4, 0.5, 18);
  addCyl(group, 0.32, 0.32, 0.08, PALETTE.steelDark, w / 2 - 0.08, 0.36, 0, 'x', 0.4, 0.5, 18);
}

export function buildUnit(kind: ComponentKind, name: string): BuiltUnit {
  const group = new THREE.Group();
  const waters: THREE.Mesh[] = [];
  switch (kind) {
    case 'intake':
      buildIntake(group, waters);
      break;
    case 'bar-screen':
      buildScreen(group);
      break;
    case 'coagulation':
      buildCoagulation(group, waters);
      break;
    case 'flocculation':
      buildFloc(group, waters);
      break;
    case 'sedimentation':
      buildSed(group, waters);
      break;
    case 'filtration':
      buildFilter(group, waters);
      break;
    case 'disinfection':
      buildContact(group, waters);
      break;
    case 'clearwell':
      buildClearwell(group, waters);
      break;
    case 'finished-pump':
      buildPump(group);
      break;
    case 'chemical-dosing':
      buildChemical(group);
      break;
    case 'sludge':
      buildSludge(group);
      break;
    case 'valve':
      buildValve(group);
      break;
    case 'pipe':
      buildPipe(group);
      break;
    default:
      break;
  }
  const foot = FOOTPRINT[kind];
  const light = beacon(group, foot.h);
  group.add(labelSprite(name, foot.h));
  group.userData.waters = waters;
  return { group, waters, beacon: light };
}

export function waterTint(kind: ComponentKind, turbidity: number, chlorine: number): THREE.Color {
  const muddy = clamp01(turbidity / 18);
  const base = new THREE.Color(kind === 'disinfection' || chlorine > 0.4 ? '#2a8f78' : PALETTE.water);
  if (chlorine > 0.3) base.lerp(new THREE.Color('#1f8f72'), clamp01(chlorine / 3) * 0.55);
  base.lerp(new THREE.Color('#7a5a32'), muddy * 0.8);
  return base;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export const PIPE_COLORS: Record<'water' | 'chemical' | 'sludge', number> = {
  water: hexNum('#3d7ea8'),
  chemical: hexNum(PALETTE.alum),
  sludge: hexNum(PALETTE.sludge),
};

import {
  BoxGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, PlaneGeometry,
  Shape, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, ShaderMaterial,
  InstancedMesh, Object3D, DoubleSide, SphereGeometry,
} from '@iwsdk/core';
import type { BoardPieceType, Mission, Shape as BoatShape } from '../game/types';

// Deterministic, Y-up, meters. Board origin is centre; grid south is +Z.
export const CELL = 0.055;
export const palette = { paper: 0xf3e8ce, sand: 0xd7b976, rock: 0x718183, teal: 0x268b8e, ink: 0x26484e, ochre: 0xc7863f, sail: 0xfffbec, red: 0xd9564c };
const material = (color: number) => new MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 });
const paper = material(palette.paper), sand = material(palette.sand), rock = material(palette.rock);
const teal = material(palette.teal), ink = material(palette.ink), ochre = material(palette.ochre), sail = material(palette.sail);
function mesh(name: string, geometry: ConstructorParameters<typeof Mesh>[0], mat: MeshStandardMaterial | ShaderMaterial) {
  const m = new Mesh(geometry, mat); m.name = name; return m;
}
function box(name: string, w: number, h: number, d: number, mat: MeshStandardMaterial, x = 0, y = h / 2, z = 0) {
  const m = mesh(name, new BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m;
}
export function cellPosition(mission: Mission, x: number, y: number) {
  return { x: (x - (mission.width - 1) / 2) * CELL, z: (y - (mission.height - 1) / 2) * CELL };
}
export function createPiece(piece: BoardPieceType) {
  const g = new Group(); g.name = `${piece} channel`;
  const bed = mesh('Rounded channel bed', new CylinderGeometry(0.026, 0.023, 0.008, 12), paper);
  bed.position.y = 0.004; g.add(bed);
  g.add(box('North waterway', 0.017, 0.002, 0.027, teal, 0, 0.009, -0.012));
  if (piece === 'bend') g.add(box('East waterway', 0.027, 0.002, 0.017, teal, 0.012, 0.009, 0));
  else g.add(box('South waterway', 0.017, 0.002, 0.027, teal, 0, 0.009, 0.012));
  if (piece === 'cross') {
    // A crossing: the east-west channel plus a stone pier at each corner, so it reads apart from player pieces.
    g.add(box('East-west waterway', 0.051, 0.002, 0.017, teal, 0, 0.0095, 0));
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(box('Crossing pier', 0.007, 0.01, 0.007, ink, px * 0.017, 0.011, pz * 0.017));
  }
  if (piece === 'lock') {
    g.add(box('Lock gate', 0.027, 0.012, 0.005, ochre, 0, 0.014, 0));
    for (let i = 0; i < 3; i++) g.add(box(`Wait ${i + 1}`, 0.004, 0.003, 0.007, ink, 0.02, 0.01, (i - 1) * 0.009));
  }
  return g;
}
export function createCell() {
  const g = new Group(); g.name = 'Build square';
  g.add(box('Poke surface', CELL * 0.91, 0.003, CELL * 0.91, material(0x8dc8bc)));
  g.add(box('Build cross horizontal', 0.016, 0.001, 0.002, paper, 0, 0.004));
  g.add(box('Build cross vertical', 0.002, 0.001, 0.016, paper, 0, 0.004));
  return g;
}
export function createEmblem(shape: BoatShape) {
  const geo = shape === 'circle' || shape === 'triangle'
    ? new CylinderGeometry(0.0075, 0.0075, 0.002, shape === 'circle' ? 20 : 3)
    : new BoxGeometry(0.012, 0.002, 0.012);
  const m = mesh(`${shape} emblem`, geo, ink);
  if (shape === 'diamond') m.rotation.y = Math.PI / 4;
  return m;
}
export function createBoat(shape: BoatShape) {
  const g = new Group(); g.name = `${shape} letter boat`;
  const outline = new Shape(); outline.moveTo(-0.009, -0.013);
  outline.quadraticCurveTo(-0.012, 0.008, 0, 0.021);
  outline.quadraticCurveTo(0.012, 0.008, 0.009, -0.013); outline.closePath();
  const hull = mesh('Hull', new ExtrudeGeometry(outline, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, steps: 1, curveSegments: 5 }), ochre);
  hull.rotation.x = -Math.PI / 2; hull.position.y = 0.003; g.add(hull);
  g.add(box('Mast', 0.002, 0.037, 0.002, ink, 0, 0.024));
  const cloth = new Shape(); cloth.moveTo(0, 0); cloth.lineTo(0, 0.026); cloth.lineTo(0.018, 0.003); cloth.closePath();
  const sailMat = sail.clone(); sailMat.side = DoubleSide;
  const sailMesh = mesh('White sail', new ExtrudeGeometry(cloth, { depth: 0.001, bevelEnabled: false }), sailMat);
  sailMesh.position.set(0.001, 0.013, 0); g.add(sailMesh);
  const symbol = createEmblem(shape); symbol.rotation.x = Math.PI / 2; symbol.position.set(0.008, 0.023, 0.0015); g.add(symbol);
  return g;
}
export function createDial() {
  const g = new Group(); g.name = 'Tide dial';
  const ring = mesh('Pinch ring', new TorusGeometry(0.028, 0.006, 8, 32), ochre); ring.rotation.x = Math.PI / 2; ring.position.y = 0.012; g.add(ring);
  g.add(box('Dial pointer', 0.008, 0.007, 0.014, paper, 0, 0.012, -0.028)); return g;
}
export function createHandle() {
  const g = new Group(); g.name = 'Move board'; g.add(box('Handle', 0.072, 0.008, 0.026, ochre)); return g;
}
export function createHandJoints() {
  const g = new Group(); g.name = 'Local hand joints';
  const joints = new InstancedMesh(new SphereGeometry(0.006, 6, 4), paper, 25);
  joints.name = 'Tracked joints'; g.add(joints); return g;
}
export function createFailureMarker() {
  const g = new Group(); g.name = 'Failure marker';
  const red = material(palette.red); red.emissive.setHex(0x5e0804);
  const a = box('Cross left', 0.038, 0.007, 0.007, red); a.rotation.y = Math.PI / 4;
  const b = a.clone(); b.name = 'Cross right'; b.rotation.y = -Math.PI / 4; g.add(a, b); return g;
}
export function createBoard(mission: Mission) {
  const root = new Group(); root.name = `Archipelago ${mission.id}`;
  root.add(box('Paper base', mission.width * CELL + 0.024, 0.015, mission.height * CELL + 0.024, paper, 0, -0.016));
  const waterMaterial = new ShaderMaterial({
    uniforms: { time: { value: 0 } }, transparent: true,
    vertexShader: 'uniform float time; varying vec2 vUv; void main(){vUv=uv;vec3 p=position;p.z+=sin(p.x*100.0+time)*0.0004;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}',
    fragmentShader: 'varying vec2 vUv; uniform float time; void main(){float wave=sin((vUv.x+vUv.y)*75.0-time)*0.025;gl_FragColor=vec4(0.13+wave,0.49+wave,0.5+wave,0.93);}',
  });
  const water = mesh('Water', new PlaneGeometry(mission.width * CELL + 0.01, mission.height * CELL + 0.01, 8, 8), waterMaterial);
  water.rotation.x = -Math.PI / 2; root.add(water);
  const rocks: { x: number; z: number }[] = [];
  mission.grid.forEach((row, y) => [...row].forEach((char, x) => { if (char === '#') rocks.push(cellPosition(mission, x, y)); }));
  if (rocks.length) {
    const islands = new InstancedMesh(new CylinderGeometry(0.027, 0.029, 0.026, 8), rock, rocks.length); islands.name = 'Slate islands';
    const t = new Object3D(); rocks.forEach((p, i) => { t.position.set(p.x, 0.009, p.z); t.updateMatrix(); islands.setMatrixAt(i, t.matrix); }); root.add(islands);
  }
  for (const p of mission.fixed) {
    const channel = createPiece(p.piece); channel.name = `Fixed ${p.x} ${p.y}`;
    const c = cellPosition(mission, p.x, p.y); channel.position.set(c.x, 0.001, c.z); channel.rotation.y = -p.rot * Math.PI / 2; root.add(channel);
  }
  mission.bars.forEach((bar, i) => {
    const c = cellPosition(mission, bar.x, bar.y);
    root.add(box(`Bar ${i}`, CELL * 0.92, 0.008, CELL * 0.92, sand, c.x, 0.003, c.z));
  });
  for (const h of mission.harbors) {
    const c = cellPosition(mission, h.x, h.y); root.add(box(`Harbor ${h.id}`, 0.044, 0.006, 0.044, ochre, c.x, 0.003, c.z));
  }
  mission.docks.forEach((dock, i) => {
    const c = cellPosition(mission, dock.x, dock.y);
    const village = new Group(); village.name = `Village ${i}`; village.position.set(c.x, 0.003, c.z);
    village.add(box('Dock', 0.048, 0.009, 0.045, paper));
    const emblem = createEmblem(dock.shape); emblem.position.set(0, 0.01, 0.012); village.add(emblem);
    const homes = new InstancedMesh(new BoxGeometry(0.01, 0.012, 0.01), paper, 3); homes.name = 'Homes';
    const roofs = new InstancedMesh(new ConeGeometry(0.009, 0.008, 4), ochre, 3); roofs.name = 'Ochre roofs';
    const lights = new InstancedMesh(new BoxGeometry(0.004, 0.004, 0.001), ink, 3); lights.name = 'Windows';
    const t = new Object3D();
    for (let j = 0; j < 3; j++) {
      t.position.set((j - 1) * 0.014, 0.016, -0.009); t.rotation.set(0, 0, 0); t.updateMatrix(); homes.setMatrixAt(j, t.matrix);
      t.position.y = 0.026; t.rotation.y = Math.PI / 4; t.updateMatrix(); roofs.setMatrixAt(j, t.matrix);
      t.position.set((j - 1) * 0.014, 0.016, -0.0035); t.rotation.y = 0; t.updateMatrix(); lights.setMatrixAt(j, t.matrix);
    }
    village.add(homes, roofs, lights); root.add(village);
  });
  return root;
}

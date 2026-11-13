import * as THREE from 'three';
import type { HullParams } from '../sim/params';
import { camoTex, treadTex } from './textures';

export interface TankMats {
  paint: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial; // darker shade of the paint
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
}

export function makeMats(color: number, seed = 1): TankMats {
  const c = new THREE.Color(color);
  const camo = camoTex(color, seed);
  camo.repeat.set(0.4, 0.4); // model coordinates are metres; one pattern tile covers 2.5 m
  return {
    paint: new THREE.MeshStandardMaterial({ color: 0xffffff, map: camo, roughness: 0.6, metalness: 0.15 }),
    trim: new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.62), roughness: 0.6, metalness: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1f2227, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8b9199, roughness: 0.35, metalness: 0.8 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x66d9ff, emissiveIntensity: 1.4 }),
  };
}

// Side silhouette (u = forward, v = up) pushed out across the width.
function profile(points: [number, number][], width: number, mat: THREE.Material, bevel = 0.04): THREE.Mesh {
  const shape = new THREE.Shape();
  points.forEach(([u, v], i) => (i ? shape.lineTo(u, v) : shape.moveTo(u, v)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(Math.PI / 2); // u now points towards -z, the tank's front
  return new THREE.Mesh(geo, mat);
}

// Top-down outline (x = right, f = forward) pushed up to a height.
function slab(points: [number, number][], y0: number, height: number, mat: THREE.Material, bevel = 0.04): THREE.Mesh {
  const shape = new THREE.Shape();
  points.forEach(([x, f], i) => (i ? shape.lineTo(x, f) : shape.moveTo(x, f)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2); // forward -> -z, extrusion -> up
  geo.translate(0, y0 + bevel, 0);
  return new THREE.Mesh(geo, mat);
}

const box = (w: number, h: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  return m;
};
const tube = (r: number, len: number, mat: THREE.Material, x: number, y: number, zFront: number, r2 = r, seg = 12) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  m.rotation.x = Math.PI / 2; // +y end (radius r2) faces forward
  m.rotation.z = Math.PI;
  m.position.set(x, y, zFront + len / 2);
  return m;
};

export interface Running { tread: THREE.Texture; wheels: THREE.Object3D[]; wheelR: number }

function track(H: number, L: number, w: number, x: number, wheels: number, wheelR: number, m: TankMats, group: THREE.Group): Running {
  const top = H * 0.25, bottom = -H - 0.3, r = (top - bottom) / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pts.push([L - r * 0.9 + Math.cos(a) * r * 0.9, (top + bottom) / 2 + Math.sin(a) * r]); }
  for (let i = 0; i <= 8; i++) { const a = Math.PI / 2 + (i / 8) * Math.PI; pts.push([-L + r * 0.9 + Math.cos(a) * r * 0.9, (top + bottom) / 2 + Math.sin(a) * r]); }
  // Each track gets its own copy of the tread texture so the two sides can scroll at different speeds.
  const tread = treadTex();
  tread.repeat.set(1 / 0.7, 1 / 0.5);
  const belt = profile(pts, w, new THREE.MeshStandardMaterial({ map: tread, roughness: 0.95 }), 0.03);
  belt.position.x = x;
  group.add(belt);
  const list: THREE.Object3D[] = [];
  for (let i = 0; i < wheels; i++) {
    const f = wheels > 1 ? i / (wheels - 1) : 0.5;
    const wz = -(-L + r + f * (2 * L - 2 * r));
    const axle = new THREE.Group();
    axle.position.set(x, bottom + wheelR + 0.06, wz);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, w + 0.06, 14), m.metal);
    wheel.rotation.z = Math.PI / 2;
    axle.add(wheel);
    // Off-centre lugs so the turning is visible.
    for (const a of [0, 2.1, 4.2]) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, wheelR * 0.35, wheelR * 0.35), m.dark);
      lug.position.set(0, Math.cos(a) * wheelR * 0.55, Math.sin(a) * wheelR * 0.55);
      axle.add(lug);
    }
    group.add(axle);
    list.push(axle);
  }
  return { tread, wheels: list, wheelR };
}

export function buildHull(h: HullParams, m: TankMats): { group: THREE.Group; left: Running; right: Running } {
  const g = new THREE.Group();
  const run: Running[] = [];
  const W = h.halfW, H = h.halfH, L = h.halfL;
  const tw = 0.46;
  const bodyW = W * 2 - tw * 2 + 0.1;
  if (h.name === 'Dart') {
    // Low wedge with a long sloped nose and open running gear.
    g.add(profile([[-L, -H * 0.5], [-L, H * 0.75], [-L * 0.6, H * 1.05], [L * 0.1, H * 1.05], [L * 1.02, -H * 0.15], [L * 0.9, -H * 0.9], [-L * 0.9, -H * 0.9]], bodyW, m.paint));
    for (const s of [-1, 1]) {
      run.push(track(H, L * 0.98, tw, s * (W - tw / 2), 4, 0.3, m, g));
      g.add(box(tw + 0.08, 0.05, L * 0.9, m.trim, s * (W - tw / 2), H * 0.3, L * 0.5)); // rear mudguard
      g.add(box(0.14, 0.1, 0.06, m.glow, s * bodyW * 0.3, H * 0.15, -L * 0.83)); // headlights
    }
    g.add(box(bodyW * 0.55, 0.08, L * 0.45, m.dark, 0, H * 1.02, L * 0.58)); // engine grille
    g.add(profile([[-L * 0.95, H * 1.05], [-L * 0.95, H * 1.5], [-L * 0.7, H * 1.05]], 0.08, m.trim, 0.01).translateX(bodyW * 0.42)); // tail fins
    g.add(profile([[-L * 0.95, H * 1.05], [-L * 0.95, H * 1.5], [-L * 0.7, H * 1.05]], 0.08, m.trim, 0.01).translateX(-bodyW * 0.42));
  } else if (h.name === 'Ranger') {
    // Boxy all-rounder: stepped glacis, full-length fenders, stowage on the back.
    g.add(profile([[-L, -H * 0.5], [-L, H * 0.9], [-L * 0.82, H * 1.1], [L * 0.45, H * 1.1], [L * 0.95, H * 0.3], [L, -H * 0.4], [L * 0.85, -H], [-L * 0.9, -H]], bodyW, m.paint));
    for (const s of [-1, 1]) {
      run.push(track(H, L, tw, s * (W - tw / 2), 5, 0.27, m, g));
      g.add(box(tw + 0.1, 0.06, L * 1.9, m.trim, s * (W - tw / 2), H * 0.32, 0)); // fender
      g.add(box(0.16, 0.12, 0.06, m.glow, s * bodyW * 0.32, H * 0.55, -L * 0.8));
      g.add(box(0.3, 0.3, 0.7, m.trim, s * (bodyW / 2 - 0.2), H * 1.1 + 0.15, L * 0.6)); // stowage boxes
    }
    g.add(box(bodyW * 0.5, 0.07, L * 0.4, m.dark, 0, H * 1.1, L * 0.55));
    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.6, 6), m.dark);
    aerial.position.set(-bodyW * 0.4, H * 1.1 + 0.8, L * 0.85);
    g.add(aerial);
  } else {
    // Tall slab-sided brick with armoured skirts over the tracks and twin exhausts.
    g.add(profile([[-L, -H * 0.6], [-L, H], [-L * 0.9, H * 1.15], [L * 0.7, H * 1.15], [L, H * 0.6], [L, -H * 0.5], [L * 0.88, -H], [-L * 0.92, -H]], bodyW, m.paint));
    for (const s of [-1, 1]) {
      run.push(track(H, L, tw + 0.08, s * (W - tw / 2 - 0.04), 6, 0.26, m, g));
      g.add(profile([[-L * 0.98, -H * 0.55], [-L * 0.98, H * 0.45], [L * 0.8, H * 0.45], [L * 0.98, H * 0.05], [L * 0.9, -H * 0.55]], 0.1, m.trim, 0.02).translateX(s * (W + 0.02))); // skirt
      g.add(box(0.2, 0.16, 0.06, m.glow, s * bodyW * 0.33, H * 0.75, -L * 0.97));
      g.add(tube(0.09, 0.9, m.metal, s * (bodyW / 2 - 0.15), H * 1.15 + 0.12, L * 0.15)); // exhausts along the deck
    }
    g.add(box(bodyW * 0.6, 0.1, L * 0.5, m.dark, 0, H * 1.15, L * 0.6));
    g.add(box(bodyW * 0.9, 0.18, 0.12, m.trim, 0, H * 0.2, -L * 1.0)); // front tow bar
  }
  return { group: g, left: run[0], right: run[1] };
}

// Turret group origin sits on the hull roof at the turret ring; -z is the muzzle direction.
// reach = distance from the ring to the muzzle, matched to where the simulation fires from.
export function buildTurret(gun: string, size: number, reach: number, m: TankMats): { group: THREE.Group; barrel: THREE.Group; muzzle: THREE.Object3D; charge: THREE.Mesh | null } {
  const g = new THREE.Group();
  const barrel = new THREE.Group(); // slides back on firing
  g.add(barrel);
  const s = size;
  const muzzle = new THREE.Object3D();
  let charge: THREE.Mesh | null = null;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.6, s * 0.66, 0.08, 16), m.dark);
  ring.position.y = 0.04;
  g.add(ring);
  if (gun === 'Ember') {
    // Squat housing between two fuel bottles, feeding a flared nozzle with a pilot light.
    g.add(slab([[-s * 0.45, -s * 0.5], [-s * 0.5, s * 0.5], [s * 0.5, s * 0.5], [s * 0.45, -s * 0.5]], 0.08, 0.4, m.paint));
    for (const sx of [-1, 1]) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, s * 1.1, 12), m.metal);
      bottle.rotation.x = Math.PI / 2;
      bottle.position.set(sx * s * 0.62, 0.3, s * 0.1);
      g.add(bottle);
      g.add(box(0.37, 0.37, 0.09, m.trim, sx * s * 0.62, 0.3, -s * 0.2), box(0.37, 0.37, 0.09, m.trim, sx * s * 0.62, 0.3, s * 0.4));
    }
    const len = Math.max(0.5, reach - s * 0.5);
    barrel.add(tube(0.09, len * 0.7, m.dark, 0, 0.28, -(s * 0.5 + len * 0.7)));
    barrel.add(tube(0.1, len * 0.3, m.metal, 0, 0.28, -reach, 0.24)); // flared mouth
    barrel.add(box(0.07, 0.07, 0.07, m.glow, 0, 0.12, -reach + 0.05)); // pilot light
    muzzle.position.set(0, 0.28, -reach);
  } else if (gun === 'Frost') {
    // Lagged cryo tank across the back, a ribbed feed pipe, and a wide frosted horn.
    g.add(slab([[-s * 0.4, -s * 0.55], [-s * 0.5, s * 0.3], [s * 0.5, s * 0.3], [s * 0.4, -s * 0.55]], 0.08, 0.36, m.paint));
    const tankMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, s * 0.75, 4, 12), m.metal);
    tankMesh.rotation.z = Math.PI / 2;
    tankMesh.position.set(0, 0.42, s * 0.55);
    g.add(tankMesh);
    for (const sx of [-1, 0, 1]) g.add(box(0.07, 0.56, 0.56, m.trim, sx * s * 0.3, 0.42, s * 0.55));
    const len = Math.max(0.5, reach - s * 0.5);
    barrel.add(tube(0.1, len * 0.75, m.metal, 0, 0.28, -(s * 0.5 + len * 0.75)));
    for (let i = 0; i < 5; i++) barrel.add(tube(0.14, 0.05, m.glow, 0, 0.28, -(s * 0.6 + (i / 5) * len * 0.7)));
    barrel.add(tube(0.11, len * 0.25, m.paint, 0, 0.28, -reach, 0.3)); // horn
    muzzle.position.set(0, 0.28, -reach);
  } else if (gun === 'Lance') {
    // Narrow body, two long rails with coil rings, counterweight at the back.
    g.add(slab([[-s * 0.32, -s * 0.75], [-s * 0.42, s * 0.2], [-s * 0.22, s * 0.8], [s * 0.22, s * 0.8], [s * 0.42, s * 0.2], [s * 0.32, -s * 0.75]], 0.08, 0.42, m.paint));
    g.add(box(s * 0.8, 0.3, s * 0.4, m.trim, 0, 0.3, s * 0.85));
    const len = reach - s * 0.7;
    for (const sx of [-1, 1]) barrel.add(box(0.07, 0.1, len, m.metal, sx * 0.11, 0.3, -(s * 0.7 + len / 2)));
    for (let i = 0; i < 4; i++) barrel.add(box(0.36, 0.26, 0.1, i % 2 ? m.dark : m.glow, 0, 0.3, -(s * 0.9 + (i / 3) * (len - s * 0.5))));
    charge = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.9 }));
    charge.position.set(0, 0.3, -reach);
    charge.visible = false;
    g.add(charge);
    muzzle.position.set(0, 0.3, -reach);
  } else if (gun === 'Pulse') {
    // Wide flat housing, two short barrels side by side with lit tips, vents on top.
    g.add(slab([[-s * 0.7, -s * 0.55], [-s * 0.7, s * 0.35], [-s * 0.45, s * 0.7], [s * 0.45, s * 0.7], [s * 0.7, s * 0.35], [s * 0.7, -s * 0.55]], 0.08, 0.36, m.paint));
    const len = Math.max(0.5, reach - s * 0.65);
    for (const sx of [-1, 1]) {
      barrel.add(tube(0.1, len, m.metal, sx * s * 0.3, 0.26, -(s * 0.65 + len)));
      barrel.add(tube(0.13, 0.16, m.glow, sx * s * 0.3, 0.26, -(s * 0.65 + len)));
      g.add(box(s * 0.3, 0.05, s * 0.5, m.dark, sx * s * 0.32, 0.45, -s * 0.05));
    }
    g.add(box(s * 0.5, 0.2, s * 0.3, m.trim, 0, 0.3, s * 0.75));
    muzzle.position.set(0, 0.26, -reach);
  } else {
    // Slug: rounded six-sided turret, one stout barrel with a muzzle brake, hatch on top.
    g.add(slab([[-s * 0.5, -s * 0.6], [-s * 0.62, 0], [-s * 0.45, s * 0.7], [s * 0.45, s * 0.7], [s * 0.62, 0], [s * 0.5, -s * 0.6]], 0.08, 0.46, m.paint, 0.07));
    g.add(box(s * 0.5, 0.3, 0.3, m.trim, 0, 0.3, -s * 0.6)); // mantlet
    const len = reach - s * 0.6;
    barrel.add(tube(0.1, len, m.dark, 0, 0.3, -(s * 0.6 + len), 0.085));
    barrel.add(tube(0.15, 0.28, m.metal, 0, 0.3, -reach));
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.2, s * 0.2, 0.06, 12), m.trim);
    hatch.position.set(s * 0.18, 0.55, s * 0.2);
    g.add(hatch);
    muzzle.position.set(0, 0.3, -reach);
  }
  g.add(muzzle);
  return { group: g, barrel, muzzle, charge };
}

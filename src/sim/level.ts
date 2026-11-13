import { DEG } from './vec';

export interface Box {
  p: [number, number, number];
  h: [number, number, number];
  pitch?: number; // degrees about x, positive lifts the -z end
  yaw?: number;
  color: number;
  deco?: boolean; // drawn but has no collider
  ground?: boolean; // gets the metre grid
  label?: string;
}

// A slab you drive up heading -z, ending on a block of the same height.
function ramp(x: number, z: number, angle: number, length: number, width: number, deck: number, color: number): Box[] {
  const a = angle * DEG;
  const t = 0.25;
  const rise = Math.sin(a) * length;
  const run = Math.cos(a) * length;
  const cy = rise / 2 - Math.cos(a) * t;
  const cz = z - run / 2 - Math.sin(a) * t;
  return [
    { p: [x, cy, cz], h: [width / 2, t, length / 2], pitch: angle, color },
    { p: [x, rise / 2, z - run - deck / 2], h: [width / 2, rise / 2, deck / 2], color: 0x6b7480, label: `${angle}° · ${rise.toFixed(1)} m` },
  ];
}

function buildRange(): Box[] {
  const boxes: Box[] = [];
  boxes.push({ p: [0, -0.5, 0], h: [160, 0.5, 160], color: 0x8a9099, ground: true });

  // Distance marks along the straight, every 10 m.
  for (let d = 0; d <= 120; d += 10) {
    boxes.push({ p: [0, 0.006, -d], h: [4, 0.005, 0.12], color: d % 50 === 0 ? 0xf2c14e : 0xf4f4f4, deco: true, label: `${d} m` });
  }
  // Reference wall of 2 m blocks beside the straight.
  for (let i = 0; i < 60; i++) {
    boxes.push({ p: [6.5, 1, -1 - i * 2], h: [0.5, 1, 1], color: i % 2 ? 0x59616b : 0x7c8794 });
  }

  // Ramps of increasing steepness.
  [10, 20, 30, 40, 50].forEach((angle, i) => {
    boxes.push(...ramp(22 + i * 9, -10, angle, 12, 7, 10, 0x9aa7b5));
  });
  // Low ledges to drive off.
  boxes.push(...ramp(-16, -10, 15, 4, 7, 12, 0xa7b59a));
  boxes.push(...ramp(-25, -10, 15, 8, 7, 12, 0xa7b59a));
  boxes.push(...ramp(-34, -10, 20, 12, 7, 12, 0xa7b59a));

  // Kerbs of increasing height across a lane.
  [0.1, 0.2, 0.35, 0.5].forEach((hgt, i) => {
    boxes.push({ p: [-12, hgt / 2, 12 + i * 7], h: [3.5, hgt / 2, 0.4], color: 0xb59a9a, label: `${hgt} m` });
  });
  // Washboard bumps.
  for (let i = 0; i < 8; i++) {
    boxes.push({ p: [14, 0.02, 12 + i * 3], h: [3.5, 0.14, 0.7], pitch: i % 2 ? 8 : -8, color: 0x9a9ab5 });
  }
  // Pillars to weave between.
  for (let i = 0; i < 6; i++) {
    boxes.push({ p: [-45 + (i % 2) * 5, 1.5, 20 + i * 9], h: [0.8, 1.5, 0.8], color: 0x59616b });
  }
  return boxes;
}

// A free-standing slope: base edge centred on (x, z), climbing in direction yaw (0 = towards -z).
function slope(x: number, z: number, yaw: number, angle: number, rise: number, width: number, color: number): Box {
  const a = angle * DEG, y = yaw * DEG;
  const t = 0.25;
  const length = rise / Math.sin(a);
  const cz = -(Math.cos(a) * length) / 2 - Math.sin(a) * t;
  return {
    p: [x + cz * Math.sin(y), rise / 2 - Math.cos(a) * t, z + cz * Math.cos(y)],
    h: [width / 2, t, length / 2], pitch: angle, yaw, color,
  };
}

export interface Spot { x: number; y: number; z: number; yaw: number }
export interface GameMap {
  name: string;
  boxes: Box[];
  spawns: Spot[];
  targets: (Spot & { hull: string })[];
  crates: { x: number; y: number; z: number }[];
}

// Walled yard: a raised deck in the middle, a walkway down each side, cover in between.
// Everything is mirrored through the centre so no spawn is better than its opposite.
function buildYard(): Box[] {
  const boxes: Box[] = [];
  const stone = 0x7d8794, deck = 0x6b7480, rampC = 0xa7b59a, cover = 0x59616b;
  boxes.push({ p: [0, -0.5, 0], h: [62, 0.5, 62], color: 0x8a9099, ground: true });
  for (const s of [-1, 1]) {
    boxes.push({ p: [0, 2, s * 61], h: [62, 2, 1], color: stone });
    boxes.push({ p: [s * 61, 2, 0], h: [1, 2, 62], color: stone });
  }
  // Centre deck, 2.5 m up, reachable from all four sides.
  boxes.push({ p: [0, 1.25, 0], h: [10, 1.25, 10], color: deck });
  const run = 2.5 / Math.tan(20 * DEG);
  boxes.push(slope(0, 10 + run, 0, 20, 2.5, 6, rampC), slope(0, -10 - run, 180, 20, 2.5, 6, rampC));
  boxes.push(slope(10 + run, 0, 90, 20, 2.5, 6, rampC), slope(-10 - run, 0, -90, 20, 2.5, 6, rampC));
  boxes.push({ p: [5, 3.5, -5], h: [1, 1, 1], color: cover }, { p: [-5, 3.5, 5], h: [1, 1, 1], color: cover });
  // Side walkways, 2 m up, with a ramp at each end.
  const run2 = 2 / Math.tan(18 * DEG);
  for (const s of [-1, 1]) {
    boxes.push({ p: [s * 48, 1, 0], h: [5, 1, 22], color: deck });
    boxes.push(slope(s * 48, 22 + run2, 0, 18, 2, 8, rampC), slope(s * 48, -22 - run2, 180, 18, 2, 8, rampC));
  }
  // Cover, each piece with its mirror image.
  const pieces: [number, number, number, number, number][] = [
    [22, -32, 9, 1.5, 0.7], [-30, -20, 0.7, 1.5, 8], [34, -42, 2, 1.25, 2], [12, -46, 1.5, 1.25, 1.5],
    [-14, -36, 2, 1.25, 2], [-40, -42, 2.5, 1.25, 1.5], [26, -12, 1.5, 1.25, 3], [-24, -50, 4, 1.25, 0.7],
  ];
  for (const [x, z, hx, hy, hz] of pieces) {
    boxes.push({ p: [x, hy, z], h: [hx, hy, hz], color: cover }, { p: [-x, hy, -z], h: [hx, hy, hz], color: cover });
  }
  // Kickers to jump off.
  boxes.push(slope(-22, 10, 0, 15, 1, 5, rampC), slope(22, -10, 180, 15, 1, 5, rampC));
  return boxes;
}

const facing = (x: number, z: number): Spot => ({ x, y: 1.2, z, yaw: Math.atan2(x, z) / DEG });

export const MAPS: Record<string, GameMap> = {
  range: {
    name: 'range',
    boxes: buildRange(),
    spawns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ x: ((n % 5) - 2) * 5, y: 1.2, z: 6 + Math.floor(n / 5) * 7, yaw: 0 })),
    targets: [
      { hull: 'Dart', x: -9.5, y: 1.2, z: -15, yaw: 90 },
      { hull: 'Ranger', x: -9.5, y: 1.2, z: -25, yaw: 90 },
      { hull: 'Anvil', x: -9.5, y: 1.2, z: -35, yaw: 90 },
    ],
    crates: [0, 1, 2, 3, 4, 5].map((i) => ({ x: -14 + (i % 3) * 1.3, y: 0.6 + Math.floor(i / 3) * 1.2, z: -2 })),
  },
  yard: {
    name: 'yard',
    boxes: buildYard(),
    spawns: [facing(-50, -50), facing(50, 50), facing(50, -50), facing(-50, 50), facing(0, -54), facing(0, 54), facing(-36, 6), facing(36, -6)],
    targets: [
      { hull: 'Ranger', x: 0, y: 3.8, z: 0, yaw: 45 },
      { hull: 'Dart', x: -8, y: 1.2, z: -30, yaw: 90 },
      { hull: 'Anvil', x: 8, y: 1.2, z: 30, yaw: 90 },
    ],
    crates: [{ x: 6, y: 3.2, z: 6 }, { x: -6, y: 3.2, z: -6 }, { x: 30, y: 0.7, z: 30 }, { x: -30, y: 0.7, z: -30 }, { x: 31.3, y: 0.7, z: 30 }, { x: -31.3, y: 0.7, z: -30 }],
  },
};

import { DEG } from './vec';

export interface Box {
  p: [number, number, number];
  h: [number, number, number];
  pitch?: number; // degrees about x, positive lifts the -z end
  yaw?: number;
  color: number;
  deco?: boolean; // drawn but has no collider
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

export function buildLevel(): Box[] {
  const boxes: Box[] = [];
  boxes.push({ p: [0, -0.5, 0], h: [160, 0.5, 160], color: 0x8a9099 });

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

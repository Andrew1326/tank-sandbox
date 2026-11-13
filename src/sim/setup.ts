import type { HullParams } from './params';
import { SimWorld, CRATE, Crate } from './world';
import type { Tank } from './tank';

export const SPAWN = { x: 0, y: 1.2, z: 6 };

export function spawnPoint(n: number) {
  return { x: ((n % 5) - 2) * 5, y: 1.2, z: 6 + Math.floor(n / 5) * 7 };
}

export function addTargets(sim: SimWorld, hulls: Record<string, HullParams>): Tank[] {
  const spots: [string, number, number][] = [['Dart', -9.5, -15], ['Ranger', -9.5, -25], ['Anvil', -9.5, -35]];
  return spots.map(([name, x, z]) => {
    const t = sim.addTank(hulls[name], { x, y: 1.2, z }, 90);
    t.bot = true;
    return t;
  });
}

export function addCrates(sim: SimWorld): Crate[] {
  const out: Crate[] = [];
  for (let i = 0; i < 6; i++) {
    out.push(sim.addCrate({ x: -14 + (i % 3) * 1.3, y: 0.6 + Math.floor(i / 3) * 1.2, z: -2 }, CRATE.half, CRATE.mass));
  }
  return out;
}

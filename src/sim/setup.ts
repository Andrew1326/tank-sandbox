import type { HullParams } from './params';
import { SimWorld, CRATE, Crate } from './world';
import type { Tank } from './tank';

export function spawnPoint(sim: SimWorld, n: number, team = 0) {
  const list = sim.map.teamSpawns?.[team] ?? sim.map.spawns;
  return list[n % list.length];
}

export function addTargets(sim: SimWorld, hulls: Record<string, HullParams>): Tank[] {
  return sim.map.targets.map((s) => {
    const t = sim.addTank(hulls[s.hull], s, s.yaw);
    t.bot = true;
    return t;
  });
}

export function addCrates(sim: SimWorld): Crate[] {
  return sim.map.crates.map((p) => sim.addCrate(p, CRATE.half, CRATE.mass));
}

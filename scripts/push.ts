// Lean on a parked tank from standstill, then ram one and let go: push speed and slide.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
const names = Object.keys(HULLS);
console.log('steady push speed, m/s (pusher starts touching, target broadside / end-on)');
for (const a of names) {
  const row: string[] = [];
  for (const b of names) {
    const cell: string[] = [];
    for (const yaw of [90, 0]) {
      const gap = HULLS[a].halfL + (yaw === 90 ? HULLS[b].halfW : HULLS[b].halfL) + 0.3;
      const p = sim.addTank({ ...HULLS[a] }, { x: 100, y: 1.2, z: 100 }, 0);
      const t = sim.addTank({ ...HULLS[b] }, { x: 100, y: 1.2, z: 100 - gap }, yaw);
      const idx = sim.tanks.indexOf(p);
      for (let i = 0; i < 6 / STEP; i++) { const inp: any[] = []; inp[idx] = { ...noInput(), throttle: i > 60 ? 1 : 0 }; sim.step(inp); }
      cell.push(p.forwardSpeed.toFixed(2));
      sim.removeTank(p); sim.removeTank(t);
    }
    row.push(`${b} ${cell.join(' / ')}`);
  }
  console.log(`  ${a.padEnd(6)} pushes  ${row.join('   ')}`);
}
console.log('ram at full speed, throttle released on contact');
for (const [a, b] of [['Dart', 'Dart'], ['Dart', 'Ranger'], ['Dart', 'Anvil'], ['Ranger', 'Dart'], ['Ranger', 'Ranger'], ['Anvil', 'Dart'], ['Anvil', 'Ranger']]) {
  const p = sim.addTank({ ...HULLS[a] }, { x: 100, y: 1.2, z: 100 }, 0);
  const t = sim.addTank({ ...HULLS[b] }, { x: 100, y: 1.2, z: 75 }, 90);
  const idx = sim.tanks.indexOf(p);
  let hit = false, peak = 0, stopT = 0, time = 0, pMin = 99;
  const z0 = t.body.translation().z;
  for (let i = 0; i < 12 / STEP; i++) {
    const v = t.body.linvel(); const sp = Math.hypot(v.x, v.z);
    if (!hit && sp > 0.3) hit = true;
    const inp: any[] = []; inp[idx] = { ...noInput(), throttle: !hit && i > 60 ? 1 : 0 };
    sim.step(inp);
    if (hit) { time += STEP; peak = Math.max(peak, sp); if (sp > 0.1) stopT = time; pMin = Math.min(pMin, p.forwardSpeed); }
  }
  console.log(`  ${a.padEnd(6)} -> ${b.padEnd(6)} target peak ${peak.toFixed(2)} m/s, slides ${Math.abs(t.body.translation().z - z0).toFixed(2)} m over ${stopT.toFixed(2)} s; rammer rebound ${Math.min(0, pMin).toFixed(2)} m/s`);
  sim.removeTank(p); sim.removeTank(t);
}

// Ram a parked tank and a wall at full speed: how hard does the rammer bounce back?
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
const tiltOf = (t: any) => {
  const q = t.body.rotation();
  return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 57.3;
};
const cases: [string, string | null, boolean][] = [];
for (const a of Object.keys(HULLS)) { for (const b of Object.keys(HULLS)) cases.push([a, b, true]); cases.push([a, null, true]); }
cases.push(['Dart', 'Ranger', false], ['Dart', null, false]);

for (const [rammer, target, hold] of cases) {
  const r = sim.addTank({ ...HULLS[rammer] }, { x: target ? 100 : 6.5, y: 1.2, z: target ? 100 : 30 }, target ? 0 : 180);
  const t = target ? sim.addTank({ ...HULLS[target] }, { x: 100, y: 1.2, z: 80 }, 90) : null;
  const idx = sim.tanks.indexOf(r);
  let minV = 99, maxTilt = 0, tgtV = 0, hitAt = -1, time = 0;
  const run = (s: number, throttle: number) => {
    for (let i = 0; i < s / STEP; i++) {
      const a: any[] = []; a[idx] = { ...noInput(), throttle };
      const before = r.forwardSpeed;
      sim.step(a); time += STEP;
      if (hitAt < 0 && before > 2 && r.forwardSpeed < before - 1.5) hitAt = time;
      if (hitAt >= 0) {
        minV = Math.min(minV, r.forwardSpeed);
        maxTilt = Math.max(maxTilt, tiltOf(r));
        if (t) { const v = t.body.linvel(); tgtV = Math.max(tgtV, Math.hypot(v.x, v.z)); }
      }
    }
  };
  run(1, 0);
  // hold = keep the throttle down through the hit; otherwise let go just before it
  if (hold) run(5, 1); else { while (hitAt < 0 && time < 8) run(STEP, 1); run(2, 0); }
  console.log(`${rammer.padEnd(6)} -> ${(target ?? 'wall').padEnd(6)} ${hold ? 'throttle held' : 'released    '}  rebound ${minV.toFixed(2)} m/s  rammer tilt ${maxTilt.toFixed(0)}°  target pushed ${tgtV.toFixed(2)} m/s`);
  sim.removeTank(r); if (t) sim.removeTank(t);
}

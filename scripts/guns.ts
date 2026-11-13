// Each gun against each hull at 15 m: hits needed, time to destroy, and what the hit does physically.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS, GUNS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
const tiltOf = (t: any) => { const q = t.body.rotation(); return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 57.3; };
for (const g of Object.values(GUNS)) {
  const out: string[] = [];
  for (const name of Object.keys(HULLS)) {
    const shooter = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, g);
    const target = sim.addTank({ ...HULLS[name] }, { x: 100, y: 1.2, z: 85 }, 90);
    for (let i = 0; i < 1.5 / STEP; i++) sim.step();
    let t = 0, killed = -1, tilt = 0, kick = 0;
    for (let i = 0; i < 40 / STEP && killed < 0; i++) {
      shooter.input = { ...noInput(), fire: true };
      sim.step();
      t += STEP;
      tilt = Math.max(tilt, tiltOf(target));
      kick = Math.max(kick, Math.abs(shooter.forwardSpeed));
      if (sim.kills.length) killed = t;
      sim.kills.length = 0; sim.shots.length = 0;
    }
    out.push(`${name} ${killed.toFixed(1)} s (tilt ${tilt.toFixed(0)}°)`);
    if (name === 'Dart') out.push(`own kick ${kick.toFixed(2)} m/s`);
    sim.removeTank(shooter); sim.removeTank(target);
    sim.shells.length = 0;
  }
  const dps = g.damage / (g.reload + g.delay);
  console.log(`${g.name.padEnd(6)} ${g.kind.padEnd(10)} ${g.damage} dmg every ${(g.reload + g.delay).toFixed(2)} s = ${dps.toFixed(0)}/s, range ${g.range} m | destroys: ${out.join(', ')}`);
}

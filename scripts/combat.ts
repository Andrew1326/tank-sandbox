// Shoot a parked tank until it is destroyed, then watch it come back.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
for (const name of Object.keys(HULLS)) {
  const shooter = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0);
  const target = sim.addTank({ ...HULLS[name] }, { x: 100, y: 1.2, z: 85 }, 90);
  let shotsFired = 0, killedAt = -1, backAt = -1, shieldSeen = 0, hitsWhileShielded = 0, time = 0;
  for (let i = 0; i < 30 / STEP; i++) {
    shooter.input = { ...noInput(), fire: true };
    target.input = noInput();
    const hpBefore = target.hp, wasShielded = target.shield > 0;
    sim.step();
    time += STEP;
    if (killedAt < 0) shotsFired += sim.shots.length;
    if (sim.shots.length && wasShielded && target.hp < hpBefore) hitsWhileShielded++;
    sim.shots.length = 0;
    if (sim.kills.length && killedAt < 0) killedAt = time;
    sim.kills.length = 0;
    if (killedAt >= 0 && backAt < 0 && target.dead <= 0) { backAt = time; shieldSeen = target.shield; break; }
  }
  const p = target.body.translation();
  console.log(
    `${name.padEnd(7)} hp ${HULLS[name].hp}: destroyed after ${shotsFired} shots at ${killedAt.toFixed(2)} s, back after ${(backAt - killedAt).toFixed(2)} s ` +
      `at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) with hp ${target.hp} and ${shieldSeen.toFixed(1)} s shield; damaged while shielded: ${hitsWhileShielded}`,
  );
  sim.removeTank(shooter); sim.removeTank(target);
}

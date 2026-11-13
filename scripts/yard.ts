// Checks the yard map: every spawn is clear, every ramp can be climbed by every hull.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create('yard');
const tiltOf = (t: any) => { const q = t.body.rotation(); return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 57.3; };
const run = (t: any, s: number, input: object) => { for (let i = 0; i < s / STEP; i++) { t.input = { ...noInput(), ...input }; sim.step(); } };

const bad: string[] = [];
sim.map.spawns.forEach((sp, i) => {
  const t = sim.addTank({ ...HULLS.Anvil }, sp, sp.yaw);
  run(t, 2, {});
  const p = t.body.translation();
  const moved = Math.hypot(p.x - sp.x, p.z - sp.z);
  if (moved > 0.3 || tiltOf(t) > 3 || Math.abs(p.y - 0.83) > 0.1) bad.push(`spawn ${i} (moved ${moved.toFixed(2)} m, tilt ${tiltOf(t).toFixed(0)}°, y ${p.y.toFixed(2)})`);
  sim.removeTank(t);
});
console.log(`spawns: ${sim.map.spawns.length} checked, ${bad.length ? 'problems: ' + bad.join('; ') : 'all clear and level'}`);

// start point, heading, expected deck height
const climbs: [string, number, number, number, number][] = [
  ['centre from south', 0, 28, 0, 2.5], ['centre from north', 0, -28, 180, 2.5], ['centre from east', 28, 0, 90, 2.5], ['centre from west', -28, 0, -90, 2.5],
  ['east walkway from south', 48, 40, 0, 2], ['east walkway from north', 48, -40, 180, 2], ['west walkway from south', -48, 40, 0, 2], ['west walkway from north', -48, -40, 180, 2],
];
for (const name of Object.keys(HULLS)) {
  const out: string[] = [];
  for (const [label, x, z, yaw, deck] of climbs) {
    const t = sim.addTank({ ...HULLS[name] }, { x, y: 1.2, z }, yaw);
    run(t, 1, {});
    const rest = t.body.translation().y;
    let top = 0;
    for (let i = 0; i < 6 / STEP; i++) { t.input = { ...noInput(), throttle: 1 }; sim.step(); top = Math.max(top, t.body.translation().y - rest); }
    if (top < deck - 0.2) out.push(`${label} (reached ${top.toFixed(1)} of ${deck} m)`);
    sim.removeTank(t);
  }
  console.log(`${name.padEnd(7)} ramps: ${out.length ? 'FAILED ' + out.join('; ') : 'all 8 climbed'}`);
}

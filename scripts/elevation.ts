// Gun elevation: range of travel, speed, and whether it decides hits on targets above and below.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS, GUNS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
const run = (s: number) => { for (let i = 0; i < Math.round(s / STEP); i++) sim.step(); sim.shots.length = 0; sim.kills.length = 0; };
const deg = (r: number) => (r * 57.2958).toFixed(1);
{
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0);
  run(1);
  a.input = { ...noInput(), pitch: 1 }; run(0.25); const quarter = a.gunPitch; run(2); const top = a.gunPitch;
  a.input = { ...noInput(), pitch: -1 }; run(3); const bottom = a.gunPitch;
  a.input = { ...noInput(), center: true }; run(1);
  console.log(`travel: up to +${deg(top)}°, down to ${deg(bottom)}°, ${(Number(deg(quarter)) / 0.25).toFixed(0)} °/s; centring brings it back to ${deg(a.gunPitch)}°`);
  sim.removeTank(a);
}
// A target on the 6 m platform at the top of the 30° ramp, shooter on the ground in front of the ramp.
for (const [label, pitchFor] of [['gun level', 0], ['gun raised onto it', 1]] as [string, number][]) {
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 40, y: 1.2, z: 10 }, 0);
  const b = sim.addTank({ ...HULLS.Ranger }, { x: 40, y: 7.5, z: -25 }, 90);
  run(2);
  const dy = b.body.translation().y - a.body.translation().y, flat = 35;
  const want = Math.atan2(dy, flat);
  if (pitchFor) { a.input = { ...noInput(), pitch: 1 }; while (a.gunPitch < want - 0.005) sim.step(); }
  a.input = { ...noInput(), fire: true }; run(0.2); a.input = noInput(); run(0.2);
  console.log(`target ${dy.toFixed(1)} m higher at 35 m (needs +${deg(want)}°), ${label} (${deg(a.gunPitch)}°): ${b.hp < 270 ? 'HIT' : 'miss'}`);
  sim.removeTank(a); sim.removeTank(b);
}
for (const [label, lower] of [['gun level', 0], ['gun lowered onto it', 1]] as [string, number][]) {
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 40, y: 7.5, z: -24 }, 180);
  const b = sim.addTank({ ...HULLS.Ranger }, { x: 40, y: 1.2, z: 25 }, 90);
  run(2);
  const dy = b.body.translation().y - a.body.translation().y, flat = 49;
  const want = Math.atan2(dy, flat);
  if (lower) { a.input = { ...noInput(), pitch: -1 }; while (a.gunPitch > want + 0.005) sim.step(); }
  a.input = { ...noInput(), fire: true }; run(0.2); a.input = noInput(); run(0.2);
  console.log(`target ${(-dy).toFixed(1)} m lower at 49 m (needs ${deg(want)}°), ${label} (${deg(a.gunPitch)}°): ${b.hp < 270 ? 'HIT' : 'miss'}`);
  sim.removeTank(a); sim.removeTank(b);
}

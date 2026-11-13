// The scoped gun: snap shot, partial and full charge, and what the scope does to the tank.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS, GUNS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
const run = (s: number) => { for (let i = 0; i < Math.round(s / STEP); i++) sim.step(); };
const fresh = () => {
  for (const t of [...sim.tanks]) sim.removeTank(t);
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, GUNS.Hawk);
  const b = sim.addTank({ ...HULLS.Anvil }, { x: 100, y: 1.2, z: 40 }, 90);
  run(1.5);
  return { a, b };
};
for (const [label, hold] of [['tap (0.1 s)', 0.1], ['1 s in the scope', 1.3], ['half charge', 0.3 + 1.1], ['full charge', 0.3 + 2.3], ['held far too long', 6]] as [string, number][]) {
  const { a, b } = fresh();
  a.input = { ...noInput(), fire: true }; run(hold);
  const power = a.charge, scoped = a.scoped;
  a.input = noInput(); run(0.1);
  console.log(`${label.padEnd(18)} scoped ${String(scoped).padEnd(5)} charge ${(power * 100).toFixed(0).padStart(3)}%  damage ${(330 - b.hp).toFixed(0)} at 60 m`);
}
{
  const { a, b } = fresh();
  a.input = { ...noInput(), fire: true, throttle: 1, steer: 1, turret: 1 }; run(1.5);
  const moved = Math.hypot(a.body.translation().x - 100, a.body.translation().z - 100);
  const scopedTurn = a.turretVel * 57.3;
  a.input = noInput(); run(0.1);
  const afterShot = (() => { a.input = { ...noInput(), fire: true }; run(1); const h = a.hold; a.input = noInput(); return h; })();
  a.input = { ...noInput(), throttle: 1, turret: 1 }; run(1.5);
  console.log(`while scoped with drive keys held: moved ${moved.toFixed(2)} m, turret turns ${scopedTurn.toFixed(0)} °/s (${GUNS.Hawk.turretSpeed} normally)`);
  console.log(`right after a shot the scope stays down for the reload: held fire 1 s, hold counter ${afterShot.toFixed(2)}; unscoped it drives at ${a.forwardSpeed.toFixed(1)} m/s`);
  void b;
}
{
  for (const t of [...sim.tanks]) sim.removeTank(t);
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, GUNS.Hawk);
  const d = sim.addTank({ ...HULLS.Dart }, { x: 100, y: 1.2, z: 30 }, 90);
  run(1.5);
  a.input = { ...noInput(), fire: true }; run(2.6); a.input = noInput(); run(0.1);
  console.log(`full charge on a Dart (190 hp) at 70 m: ${d.dead > 0 ? 'destroyed in one shot' : `survives with ${d.hp.toFixed(0)} hp`}`);
}

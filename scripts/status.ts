// Flame, frost and piercing: what each does to its targets.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS, GUNS } from '../src/sim/params';
import { noInput, Tank } from '../src/sim/tank';

const sim = await SimWorld.create();
const settle = (s: number) => { for (let i = 0; i < s / STEP; i++) sim.step(); sim.kills.length = 0; sim.shots.length = 0; };
const clear = () => { for (const t of [...sim.tanks]) sim.removeTank(t); };
const fire = (t: Tank, on: boolean) => { t.input = { ...noInput(), fire: on }; };

// Ember: hold the flame on a Ranger for 2 s, then stop and watch it burn.
{
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, GUNS.Ember);
  const b = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 90 }, 90);
  settle(1.5);
  fire(a, true); settle(2);
  const hpAfterFlame = b.hp, heat = b.temp, fuel = a.energy;
  fire(a, false); settle(6);
  console.log(`Ember 2 s on a Ranger: ${(270 - hpAfterFlame).toFixed(0)} damage, heat ${heat.toFixed(2)}, fuel left ${(fuel * 100).toFixed(0)}%; then burned for another ${(hpAfterFlame - b.hp).toFixed(0)} with the flame off, heat now ${b.temp.toFixed(2)}`);
  fire(a, true);
  let t = 0; while (a.energy > 0 && t < 20) { sim.step(); t += STEP; }
  fire(a, false);
  let r = 0; while (a.energy < 1 && r < 20) { sim.step(); r += STEP; }
  console.log(`      a full tank lasts ${(t + 0).toFixed(1)} s from the ${(fuel * 100).toFixed(0)}% left... refill from empty takes ${r.toFixed(1)} s`);
  clear();
}
// Ember kills: time to destroy each hull with the flame held.
for (const name of Object.keys(HULLS)) {
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, GUNS.Ember);
  const b = sim.addTank({ ...HULLS[name] }, { x: 100, y: 1.2, z: 90 }, 90);
  settle(1.5);
  fire(a, true);
  let t = 0; while (b.dead <= 0 && t < 30) { sim.step(); t += STEP; }
  console.log(`      destroys ${name} in ${t.toFixed(1)} s (flame runs dry at 5 s, the fire finishes the job)`);
  sim.kills.length = 0; clear();
}
// Frost: chill a Dart, then let it try to drive and turn.
{
  const top = (frozen: boolean) => {
    const a = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, GUNS.Frost);
    const b = sim.addTank({ ...HULLS.Dart }, { x: 100, y: 1.2, z: 90 }, 90);
    settle(1.5);
    if (frozen) { fire(a, true); settle(2); fire(a, false); }
    const cold = b.temp, hp = b.hp;
    b.input = { ...noInput(), throttle: 1 }; settle(1.2);
    const v = b.forwardSpeed;
    b.input = { ...noInput(), steer: 1 }; settle(0.8);
    const w = b.yawRate;
    let thaw = 0; b.input = noInput(); while (b.temp < 0 && thaw < 20) { sim.step(); thaw += STEP; }
    clear();
    return { cold, v, w, thaw, dmg: 190 - hp };
  };
  const n = top(false), f = top(true);
  console.log(`Frost 2 s on a Dart: ${f.dmg.toFixed(0)} damage, chill ${f.cold.toFixed(2)}; speed after 1.2 s of throttle ${f.v.toFixed(1)} m/s (normally ${n.v.toFixed(1)}), turn rate ${f.w.toFixed(0)} °/s (normally ${n.w.toFixed(0)}); fully thawed ${f.thaw.toFixed(1)} s later`);
}
// Fire against ice: a frozen tank has to thaw before it burns.
{
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, GUNS.Frost);
  const e = sim.addTank({ ...HULLS.Ranger }, { x: 104, y: 1.2, z: 100 }, 12, undefined, GUNS.Ember);
  const b = sim.addTank({ ...HULLS.Anvil }, { x: 102, y: 1.2, z: 90 }, 90);
  settle(1.5);
  fire(a, true); settle(1.5); fire(a, false);
  const cold = b.temp;
  fire(e, true); settle(1.0);
  console.log(`Fire on ice: chilled to ${cold.toFixed(2)}, one second of flame brings it to ${b.temp.toFixed(2)}`);
  clear();
}
// Lance through a column of three Darts.
{
  const a = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, GUNS.Lance);
  const row = [85, 78, 71].map((z) => sim.addTank({ ...HULLS.Dart }, { x: 100, y: 1.2, z }, 90));
  const wallBehind = sim.addTank({ ...HULLS.Dart }, { x: 100, y: 1.2, z: 60 }, 90);
  settle(1.5);
  fire(a, true); settle(1.2); fire(a, false); settle(0.3);
  console.log(`Lance through a column: damage ${[...row, wallBehind].map((t) => (190 - t.hp).toFixed(0)).join(' / ')} to the 1st / 2nd / 3rd / 4th tank in line (190 hp each)`);
  clear();
  const slug = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0, undefined, GUNS.Slug);
  const row2 = [85, 78].map((z) => sim.addTank({ ...HULLS.Dart }, { x: 100, y: 1.2, z }, 90));
  settle(1.5); fire(slug, true); settle(0.3); fire(slug, false);
  console.log(`Slug at the same column: damage ${row2.map((t) => (190 - t.hp).toFixed(0)).join(' / ')} (does not pierce)`);
  clear();
}

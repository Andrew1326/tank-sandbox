// Plays out the flag rules on the yard: take, drop on death, return by a defender, timed return, capture.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS, GUNS } from '../src/sim/params';
import { noInput, Tank } from '../src/sim/tank';
import { rot, v3 } from '../src/sim/vec';

const sim = await SimWorld.create('yard');
const log: string[] = [];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const tick = () => { sim.step(); for (const e of sim.flagEvents) log.push(`${sim.time.toFixed(1)}s ${e.what} team-${e.team} flag by tank ${e.by}`); sim.flagEvents.length = 0; sim.kills.length = 0; sim.shots.length = 0; };
// Drive a tank to a point by steering at it; gives up after `limit` seconds.
function driveTo(t: Tank, x: number, z: number, limit = 40, reach = 2) {
  for (let i = 0; i < limit / STEP; i++) {
    const p = t.body.translation();
    if (Math.hypot(x - p.x, z - p.z) < reach) { t.input = noInput(); return true; }
    const f = rot(t.body.rotation(), v3(0, 0, -1));
    const err = wrap(Math.atan2(-(x - p.x), -(z - p.z)) - Math.atan2(-f.x, -f.z));
    t.input = { ...noInput(), throttle: Math.abs(err) < 1 ? 1 : 0, steer: Math.abs(err) > 0.1 ? Math.sign(err) : 0 };
    tick();
  }
  t.input = noInput();
  return false;
}
const route = (t: Tank, pts: [number, number][]) => pts.every(([x, z], i) => { const ok = driveTo(t, x, z, 40, i === pts.length - 1 ? 2.5 : 3); if (!ok) { const p = t.body.translation(); log.push(`  (stuck at ${p.x.toFixed(0)}, ${p.z.toFixed(0)} heading for ${x}, ${z})`); } return ok; });
const toFlag = () => route(a, [[36, -30], [36, 30], [8, 46], [0, 50]]);
const toBase = () => route(a, [[8, 46], [36, 30], [36, -30], [0, -50]]);
const wait = (s: number) => { for (let i = 0; i < s / STEP; i++) tick(); };

const a = sim.addTank({ ...HULLS.Dart }, { x: 6, y: 1.2, z: -40 }, 0); a.team = 1;       // amber runner
const d = sim.addTank({ ...HULLS.Ranger }, { x: 14, y: 1.2, z: 44 }, 0, undefined, GUNS.Lance); d.team = 2; // azure defender
wait(1);
const flag2 = sim.flags.find((f) => f.team === 2)!;
const checks: [string, boolean][] = [];

// 1. runner goes round the deck to the azure flag
toFlag();
checks.push(['runner takes the enemy flag', flag2.state === 1 && flag2.by === a.id]);
// 2. defender destroys the carrier: flag drops where it died
a.input = noInput();
for (let i = 0; i < 20 / STEP && a.dead <= 0; i++) {
  const p = d.body.translation(), q = a.body.translation();
  const f = rot(d.body.rotation(), v3(0, 0, -1));
  const err = wrap(Math.atan2(-(q.x - p.x), -(q.z - p.z)) - Math.atan2(-f.x, -f.z) - d.turretYaw);
  d.input = { ...noInput(), turret: Math.abs(err) > 0.02 ? Math.sign(err) : 0, fire: Math.abs(err) < 0.05 };
  tick();
}
d.input = noInput();
wait(0.1);
checks.push(['carrier destroyed, flag dropped on the spot', a.dead > 0 && flag2.state === 2]);
// 3. defender touches its own dropped flag: straight home
const dropAt = { ...flag2.p };
driveTo(d, dropAt.x, dropAt.z, 20, 2.5);
wait(0.2);
checks.push(['defender returns its flag by touching it', flag2.state === 0 && Math.abs(flag2.p.z - 50) < 0.1]);
// 4. runner respawns (at its start point), takes the flag again and brings it home
wait(5);
driveTo(d, 40, 30, 20);                         // defender moves out of the way
toFlag();
checks.push(['runner takes the flag a second time', flag2.state === 1]);
toBase();
wait(0.2);
checks.push(['capture scores a point for amber', sim.teamScore[1] === 1 && flag2.state === 0]);
// 5. timed return: take it, get destroyed by falling health, nobody touches it
a.place({ x: 0, y: 1.2, z: 48 }, 0);
wait(0.5);
a.place({ x: 8, y: 1.2, z: 40 }, 0);
wait(0.5);
a.hp = 0; a.dead = sim.params.respawnTime;
wait(1);
const dropped = flag2.state === 2;
wait(sim.params.flagReturn + 0.5);
checks.push(['dropped flag goes home by itself after the timer', dropped && flag2.state === 0]);
// 6. friendly fire is off
const mate = sim.addTank({ ...HULLS.Dart }, { x: 100, y: 1.2, z: 85 }, 90); mate.team = 2;
d.place({ x: 100, y: 1.2, z: 100 }, 0); d.turretYaw = 0;
wait(1);
d.input = { ...noInput(), fire: true };
wait(6);
checks.push(['teammates take no damage', mate.hp === mate.hull.hp]);

for (const l of log) console.log('  ' + l);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);

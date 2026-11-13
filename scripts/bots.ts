// Scripted players that fight each other through the real server.
// Usage: npx tsx scripts/bots.ts [bots=4] [seconds=90] [one-way lag ms=40]
import { SimWorld, STEP } from '../src/sim/world';
import RAPIER from '@dimforge/rapier3d-compat';
import { GUNS, HULLS } from '../src/sim/params';
import { noInput, Tank } from '../src/sim/tank';
import { NetClient } from '../src/net/client';
import { NET_PORT } from '../src/net/protocol';
import { rot, v3 } from '../src/sim/vec';

const count = Number(process.argv[2] ?? 4);
const seconds = Number(process.argv[3] ?? 90);
const lag = Number(process.argv[4] ?? 40);
const hullNames = Object.keys(HULLS);
const gunNames = Object.keys(GUNS);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOf = (t: Tank) => { const f = rot(t.body.rotation(), v3(0, 0, -1)); return Math.atan2(-f.x, -f.z); };

interface Bot {
  name: string; sim: SimWorld; net: NetClient;
  shots: number; hits: number; sumFix: number; n: number; worstFix: number; maxReplay: number;
  flippedFor: number; flips: number; deadTicks: number; stuckFor: number; mood: number; moodLeft: number;
  bad: string[];
  detour: { x: number; z: number } | null; detourLeft: number;
  plan: string; path: { x: number; z: number }[]; at: number;
  lastHp: number; hurtAgo: number; big: Record<string, { n: number; worst: number }>;
}

const bots: Bot[] = [];
for (let i = 0; i < count; i++) {
  const sim = await SimWorld.create();
  const hulls = Object.fromEntries(Object.entries(HULLS).map(([k, v]) => [k, { ...v }]));
  const hull = hullNames[i % hullNames.length], gun = gunNames[i % gunNames.length];
  const name = `${hull}-${gun}-${i + 1}`;
  const guns = Object.fromEntries(Object.entries(GUNS).map(([k, v]) => [k, { ...v }]));
  const net = new NetClient(`ws://localhost:${NET_PORT}`, sim, hulls, {}, guns, hull, gun, name);
  net.lagMs = lag;
  bots.push({ name, sim, net, shots: 0, hits: 0, sumFix: 0, n: 0, worstFix: 0, maxReplay: 0, flippedFor: 0, flips: 0, deadTicks: 0, stuckFor: 0, mood: 1, moodLeft: 0, bad: [], detour: null, detourLeft: 0, plan: '', path: [], at: 0, lastHp: 0, hurtAgo: 9, big: {} });
}

// A clear lane across the yard for Amber (north base to south base); Azure uses its mirror image.
const LANE = [{ x: 0, z: -38 }, { x: 36, z: -36 }, { x: 36, z: 30 }, { x: 8, z: 46 }, { x: 0, z: 50 }];
function lane(team: number, homeward: boolean) {
  const pts = team === 1 ? LANE : LANE.map((q) => ({ x: -q.x, z: -q.z }));
  return homeward ? [...pts].reverse().slice(1).concat(team === 1 ? { x: 0, z: -50 } : { x: 0, z: 50 }) : pts;
}

function think(bot: Bot) {
  const me = bot.net.me;
  const input = noInput();
  if (!me) return input;
  if (me.dead > 0) { bot.deadTicks++; bot.plan = ''; return input; }
  const p = me.body.translation();
  if (!Number.isFinite(p.x + p.y + p.z)) { if (!bot.bad.includes('NaN position')) bot.bad.push('NaN position'); return input; }

  const up = rot(me.body.rotation(), v3(0, 1, 0));
  bot.flippedFor = up.y < 0.3 ? bot.flippedFor + STEP : 0;
  if (bot.flippedFor > 1.5) { bot.net.command('upright'); bot.flips++; bot.flippedFor = 0; }

  const teams = bot.sim.teamPlay && me.team !== 0;
  const foes = bot.sim.tanks.filter((t) => t !== me && t.dead <= 0 && (teams ? t.team !== 0 && t.team !== me.team : !t.bot));
  const sees = (t: Tank) => {
    const q = t.body.translation();
    const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
    const l = Math.hypot(d.x, d.y, d.z);
    const hit = bot.sim.world.castRay(new RAPIER.Ray({ x: p.x, y: p.y + 0.8, z: p.z }, { x: d.x / l, y: d.y / l, z: d.z / l }), l, true, undefined, undefined, undefined, me.body);
    return !!hit && hit.collider.parent() === t.body;
  };
  let target: Tank | null = null, best = 1e9;
  for (const t of foes) {
    const q = t.body.translation();
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < best && d < me.gun.range && sees(t)) { best = d; target = t; }
  }

  // Where to go: the flag game if there is one, otherwise towards the nearest foe.
  let goal: { x: number; z: number } | null = null;
  if (teams) {
    const mine = bot.sim.flags.find((f) => f.team === me.team)!, theirs = bot.sim.flags.find((f) => f.team !== me.team)!;
    const base = bot.sim.map.bases!.find((b) => b.team === me.team)!;
    let plan = 'direct';
    if (theirs.state === 1 && theirs.by === me.id) { goal = base; plan = 'home'; }
    else if (mine.state === 2) goal = mine.p;
    else if (theirs.state === 0) { goal = theirs.p; plan = 'attack'; }
    else if (theirs.state === 2) goal = theirs.p;
    else goal = bot.sim.tanks.find((t) => t.id === theirs.by)?.body.translation() ?? base; // escort the carrier
    if (plan !== bot.plan) {
      bot.plan = plan;
      bot.path = plan === 'direct' ? [] : lane(me.team, plan === 'home');
      // Join the lane at its nearest point rather than driving back to the start.
      let bestD = 1e9;
      bot.path.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bestD) { bestD = d; bot.at = i; } });
    }
    if (bot.path.length) {
      while (bot.at < bot.path.length - 1 && Math.hypot(bot.path[bot.at].x - p.x, bot.path[bot.at].z - p.z) < 4) bot.at++;
      goal = bot.path[bot.at];
    }
  } else {
    let near = 1e9;
    for (const t of foes) { const q = t.body.translation(); const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < near) { near = d; goal = q; } }
  }
  bot.moodLeft -= STEP;
  if (bot.moodLeft <= 0) { bot.mood = Math.random() < 0.5 ? -1 : 1; bot.moodLeft = 2 + Math.random() * 3; }
  bot.detourLeft -= STEP;
  if (bot.detourLeft <= 0) bot.detour = null;
  const dest = bot.detour ?? goal;
  if (dest) {
    const dist = Math.hypot(dest.x - p.x, dest.z - p.z);
    const err = wrap(Math.atan2(-(dest.x - p.x), -(dest.z - p.z)) - yawOf(me));
    if (dist > 2) { input.steer = Math.abs(err) > 0.12 ? Math.sign(err) : 0; input.throttle = Math.abs(err) < 1.2 ? 1 : 0; }
  }
  // No path-finding: when pressed against something, back off and try a sideways detour.
  bot.stuckFor = input.throttle !== 0 && Math.abs(me.forwardSpeed) < 0.4 ? bot.stuckFor + STEP : 0;
  if (bot.stuckFor > 0.8) {
    input.throttle = -1; input.steer = bot.mood;
    if (bot.stuckFor > 1.8) {
      const a = yawOf(me) + bot.mood * (1.2 + Math.random());
      bot.detour = { x: p.x - Math.sin(a) * 14, z: p.z - Math.cos(a) * 14 };
      bot.detourLeft = 2.5; bot.stuckFor = 0;
    }
  }

  if (target) {
    const q = target.body.translation();
    const aimErr = wrap(Math.atan2(-(q.x - p.x), -(q.z - p.z)) - yawOf(me) - me.turretYaw);
    input.turret = Math.abs(aimErr) > 0.02 ? Math.sign(aimErr) : 0;
    // Raise or lower the gun to the target's height.
    const flat = Math.hypot(q.x - p.x, q.z - p.z);
    const lift = Math.atan2(q.y - p.y, flat) - me.gunPitch;
    input.pitch = Math.abs(lift) > 0.01 ? Math.sign(lift) : 0;
    // A sniper holds the shot until it is mostly charged, then lets go.
    input.fire = me.gun.kind === 'sniper' ? Math.abs(aimErr) < 0.1 && me.charge < 0.7 : Math.abs(aimErr) < 0.06;
  } else {
    input.center = true;
  }
  return input;
}

let elapsed = 0;
const timer = setInterval(() => {
  for (const bot of bots) {
    bot.net.sync();
    const input = think(bot);
    if (bot.net.id) {
      bot.net.sendInput(input);
      const me = bot.net.me;
      if (me) me.input = input;
      bot.sim.step();
      for (const s of bot.sim.shots) if (s.by === bot.net.id && s.k === 0) { bot.shots++; if (s.hit) bot.hits++; }
      bot.sim.shots.length = 0;
      bot.sim.kills.length = 0;
      if (me) {
        bot.sumFix += bot.net.correction; bot.n++;
        // Sort every large correction by what was going on at the time.
        bot.hurtAgo = me.hp < bot.lastHp ? 0 : bot.hurtAgo + STEP;
        bot.lastHp = me.hp;
        if (bot.net.correction > 0.25) {
          const p = me.body.translation();
          const near = bot.sim.tanks.some((t) => t !== me && Math.hypot(t.body.translation().x - p.x, t.body.translation().z - p.z) < 6);
          const why = me.dead > 0 || me.shield > 0 ? 'death/respawn' : bot.hurtAgo < 0.5 ? 'just hit' : near ? 'tank nearby' : 'other';
          const c = (bot.big[why] ??= { n: 0, worst: 0 });
          c.n++; c.worst = Math.max(c.worst, bot.net.correction);
          bot.net.correction = 0;
        }
        bot.worstFix = Math.max(bot.worstFix, bot.net.correction);
        bot.maxReplay = Math.max(bot.maxReplay, bot.net.replaySteps);
        const y = me.body.translation().y;
        if (y > 30 && !bot.bad.includes('launched above 30 m')) bot.bad.push('launched above 30 m');
      }
    }
  }
  elapsed += STEP;
  if (process.env.TRACE && Math.floor(elapsed / 5) !== Math.floor((elapsed - STEP) / 5)) console.log(`${elapsed.toFixed(0)}s ` + bots.map((b) => { const m = b.net.me; if (!m) return '-'; const q = m.body.translation(); return `T${m.team}(${q.x.toFixed(0)},${q.z.toFixed(0)}) ${b.plan}#${b.at}${b.detour ? '*' : ''} hp${m.hp}`; }).join(' | '));
  if (elapsed >= seconds) {
    clearInterval(timer);
    const score = bots[0].net.score;
    console.log(`${count} bots, ${seconds} s, ${lag} ms one-way lag (ping ${bots[0].net.ping.toFixed(0)} ms)`);
    console.log('name              kills deaths  shots  hit%  dead%  flips  mean fix  worst fix  replay  notes');
    for (const b of bots) {
      const row = score.find((r) => r.id === b.net.id);
      console.log(
        `${b.name.padEnd(17)} ${String(row?.k ?? '?').padStart(5)} ${String(row?.d ?? '?').padStart(6)} ${String(b.shots).padStart(6)} ` +
          `${(b.shots ? (b.hits / b.shots) * 100 : 0).toFixed(0).padStart(5)} ${((b.deadTicks / Math.max(1, b.n + b.deadTicks)) * 100).toFixed(0).padStart(6)} ${String(b.flips).padStart(6)} ` +
          `${((b.sumFix / Math.max(1, b.n)) * 100).toFixed(1).padStart(7)}cm ${(b.worstFix * 100).toFixed(0).padStart(8)}cm ${String(b.maxReplay).padStart(7)}  ${b.bad.join(', ') || '-'}`,
      );
    }
    const all: Record<string, { n: number; worst: number }> = {};
    for (const b of bots) for (const [why, c] of Object.entries(b.big)) { const a = (all[why] ??= { n: 0, worst: 0 }); a.n += c.n; a.worst = Math.max(a.worst, c.worst); }
    console.log('corrections over 25 cm: ' + (Object.entries(all).map(([why, c]) => `${why} ×${c.n} (worst ${(c.worst * 100).toFixed(0)} cm)`).join(', ') || 'none'));
    const ps = bots.reduce((a, b) => a + b.shots, 0), ph = bots.reduce((a, b) => a + b.hits, 0);
    const ss = bots.reduce((a, b) => a + b.net.serverShots, 0), sh = bots.reduce((a, b) => a + b.net.serverHits, 0);
    if (bots[0].sim.teamPlay) console.log(`flag game: Amber ${bots[0].sim.teamScore[1]} : ${bots[0].sim.teamScore[2]} Azure; captures by ${score.filter((r) => r.caps).map((r) => `${r.name} ×${r.caps}`).join(', ') || 'nobody'}`);
    console.log(`hits: clients predicted ${ph}/${ps} (${((ph / Math.max(1, ps)) * 100).toFixed(0)}%), server resolved ${sh}/${ss} (${((sh / Math.max(1, ss)) * 100).toFixed(0)}%)`);
    const k = score.reduce((a, r) => a + r.k, 0), d = score.reduce((a, r) => a + r.d, 0);
    console.log(`server totals: ${k} kills, ${d} deaths among players (difference = deaths by falling off or kills of targets)`);
    process.exit(0);
  }
}, 1000 / 60);

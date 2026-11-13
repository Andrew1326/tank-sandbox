// Scripted players that fight each other through the real server.
// Usage: npx tsx scripts/bots.ts [bots=4] [seconds=90] [one-way lag ms=40]
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput, Tank } from '../src/sim/tank';
import { NetClient } from '../src/net/client';
import { NET_PORT } from '../src/net/protocol';
import { rot, v3 } from '../src/sim/vec';

const count = Number(process.argv[2] ?? 4);
const seconds = Number(process.argv[3] ?? 90);
const lag = Number(process.argv[4] ?? 40);
const hullNames = Object.keys(HULLS);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOf = (t: Tank) => { const f = rot(t.body.rotation(), v3(0, 0, -1)); return Math.atan2(-f.x, -f.z); };

interface Bot {
  name: string; sim: SimWorld; net: NetClient;
  shots: number; hits: number; sumFix: number; n: number; worstFix: number; maxReplay: number;
  flippedFor: number; flips: number; deadTicks: number; stuckFor: number; mood: number; moodLeft: number;
  bad: string[];
  lastHp: number; hurtAgo: number; big: Record<string, { n: number; worst: number }>;
}

const bots: Bot[] = [];
for (let i = 0; i < count; i++) {
  const sim = await SimWorld.create();
  const hulls = Object.fromEntries(Object.entries(HULLS).map(([k, v]) => [k, { ...v }]));
  const name = `Bot${i + 1}-${hullNames[i % hullNames.length]}`;
  const net = new NetClient(`ws://localhost:${NET_PORT}`, sim, hulls, {}, hullNames[i % hullNames.length], name);
  net.lagMs = lag;
  bots.push({ name, sim, net, shots: 0, hits: 0, sumFix: 0, n: 0, worstFix: 0, maxReplay: 0, flippedFor: 0, flips: 0, deadTicks: 0, stuckFor: 0, mood: 1, moodLeft: 0, bad: [], lastHp: 0, hurtAgo: 9, big: {} });
}

function think(bot: Bot) {
  const me = bot.net.me;
  const input = noInput();
  if (!me) return input;
  if (me.dead > 0) { bot.deadTicks++; return input; }
  const p = me.body.translation();
  if (!Number.isFinite(p.x + p.y + p.z)) { if (!bot.bad.includes('NaN position')) bot.bad.push('NaN position'); return input; }

  const up = rot(me.body.rotation(), v3(0, 1, 0));
  bot.flippedFor = up.y < 0.3 ? bot.flippedFor + STEP : 0;
  if (bot.flippedFor > 1.5) { bot.net.command('upright'); bot.flips++; bot.flippedFor = 0; }

  // Fight other players first; shoot the parked targets only when alone.
  const alive = bot.sim.tanks.filter((t) => t !== me && t.dead <= 0);
  const pool = alive.filter((t) => !t.bot).length ? alive.filter((t) => !t.bot) : alive;
  let target: Tank | null = null, best = 1e9;
  for (const t of pool) {
    const q = t.body.translation();
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < best) { best = d; target = t; }
  }
  if (!target) return input;
  const q = target.body.translation();
  const bearing = Math.atan2(-(q.x - p.x), -(q.z - p.z));
  const hullErr = wrap(bearing - yawOf(me));

  // Close in, then circle; change direction now and then so it is not a duel of statues.
  bot.moodLeft -= STEP;
  if (bot.moodLeft <= 0) { bot.mood = Math.random() < 0.5 ? -1 : 1; bot.moodLeft = 2 + Math.random() * 3; }
  if (best > 22) { input.steer = Math.abs(hullErr) > 0.15 ? Math.sign(hullErr) : 0; input.throttle = Math.abs(hullErr) < 1.2 ? 1 : 0; }
  else if (best < 7) { input.throttle = -1; input.steer = bot.mood; }
  else { const side = wrap(hullErr - bot.mood * 1.2); input.steer = Math.abs(side) > 0.15 ? Math.sign(side) : 0; input.throttle = 1; }
  input.boost = best > 45;

  // Reverse out when pressed against something.
  bot.stuckFor = input.throttle !== 0 && Math.abs(me.forwardSpeed) < 0.4 ? bot.stuckFor + STEP : 0;
  if (bot.stuckFor > 1.2) { input.throttle = -input.throttle; input.steer = bot.mood; if (bot.stuckFor > 2.4) bot.stuckFor = 0; }

  const aimErr = wrap(bearing - yawOf(me) - me.turretYaw);
  input.turret = Math.abs(aimErr) > 0.02 ? Math.sign(aimErr) : 0;
  input.fire = Math.abs(aimErr) < 0.06 && best < 120;
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
      for (const s of bot.sim.shots) if (s.by === bot.net.id) { bot.shots++; if (s.hit) bot.hits++; }
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
  if (elapsed >= seconds) {
    clearInterval(timer);
    const score = bots[0].net.score;
    console.log(`${count} bots, ${seconds} s, ${lag} ms one-way lag (ping ${bots[0].net.ping.toFixed(0)} ms)`);
    console.log('name            kills deaths  shots  hit%  dead%  flips  mean fix  worst fix  replay  notes');
    for (const b of bots) {
      const row = score.find((r) => r.id === b.net.id);
      console.log(
        `${b.name.padEnd(15)} ${String(row?.k ?? '?').padStart(5)} ${String(row?.d ?? '?').padStart(6)} ${String(b.shots).padStart(6)} ` +
          `${(b.shots ? (b.hits / b.shots) * 100 : 0).toFixed(0).padStart(5)} ${((b.deadTicks / Math.max(1, b.n + b.deadTicks)) * 100).toFixed(0).padStart(6)} ${String(b.flips).padStart(6)} ` +
          `${((b.sumFix / Math.max(1, b.n)) * 100).toFixed(1).padStart(7)}cm ${(b.worstFix * 100).toFixed(0).padStart(8)}cm ${String(b.maxReplay).padStart(7)}  ${b.bad.join(', ') || '-'}`,
      );
    }
    const all: Record<string, { n: number; worst: number }> = {};
    for (const b of bots) for (const [why, c] of Object.entries(b.big)) { const a = (all[why] ??= { n: 0, worst: 0 }); a.n += c.n; a.worst = Math.max(a.worst, c.worst); }
    console.log('corrections over 25 cm: ' + (Object.entries(all).map(([why, c]) => `${why} ×${c.n} (worst ${(c.worst * 100).toFixed(0)} cm)`).join(', ') || 'none'));
    const ps = bots.reduce((a, b) => a + b.shots, 0), ph = bots.reduce((a, b) => a + b.hits, 0);
    const ss = bots.reduce((a, b) => a + b.net.serverShots, 0), sh = bots.reduce((a, b) => a + b.net.serverHits, 0);
    console.log(`hits: clients predicted ${ph}/${ps} (${((ph / Math.max(1, ps)) * 100).toFixed(0)}%), server resolved ${sh}/${ss} (${((sh / Math.max(1, ss)) * 100).toFixed(0)}%)`);
    const k = score.reduce((a, r) => a + r.k, 0), d = score.reduce((a, r) => a + r.d, 0);
    console.log(`server totals: ${k} kills, ${d} deaths among players (difference = deaths by falling off or kills of targets)`);
    process.exit(0);
  }
}, 1000 / 60);

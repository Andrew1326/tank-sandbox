// Connects a predicting client to a running server and reports how far prediction drifts.
// Usage: npx tsx scripts/nettest.ts [one-way lag ms]
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';
import { NetClient } from '../src/net/client';
import { NET_PORT } from '../src/net/protocol';

const lag = Number(process.argv[2] ?? 0);
const sim = await SimWorld.create();
const hulls = Object.fromEntries(Object.entries(HULLS).map(([k, v]) => [k, { ...v }]));
const net = new NetClient(`ws://localhost:${NET_PORT}`, sim, hulls, {}, 'Dart');
net.lagMs = lag;

const plan: [number, object][] = [
  [1.0, {}], [2.5, { throttle: 1 }], [1.5, { throttle: 1, steer: 1 }], [1.0, { throttle: -1 }], [1.5, { steer: -1, turret: 1 }], [1.0, {}],
];
let phase = 0, left = plan[0][0], sum = 0, n = 0, maxReplay = 0, moved = 0, prev: any = null;
const worst: number[] = plan.map(() => 0);
const timer = setInterval(() => {
  net.sync();
  if (net.me) { worst[phase] = Math.max(worst[phase], net.correction); sum += net.correction; n++; maxReplay = Math.max(maxReplay, net.replaySteps); }
  const input = { ...noInput(), ...plan[phase][1] };
  net.sendInput(input);
  const me = net.me;
  if (me) me.input = input;
  sim.step();
  sim.shots.length = 0;
  if (me) { const p = me.body.translation(); if (prev) moved += Math.hypot(p.x - prev.x, p.z - prev.z); prev = { ...p }; }
  left -= STEP;
  if (left <= 0) {
    phase++;
    if (phase >= plan.length) {
      clearInterval(timer);
      console.log(`lag ${lag} ms one-way · ping ${net.ping.toFixed(0)} ms · tanks seen ${sim.tanks.length} · drove ${moved.toFixed(1)} m`);
      console.log(`replayed up to ${maxReplay} ticks per snapshot · mean correction ${((sum / n) * 100).toFixed(2)} cm`);
      console.log('worst correction per phase (cm): ' + plan.map((p, i) => `${JSON.stringify(p[1])} ${(worst[i] * 100).toFixed(1)}`).join(' | '));
      process.exit(0);
    }
    left = plan[phase][0];
  }
}, 1000 / 60);

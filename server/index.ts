import { WebSocketServer, WebSocket } from 'ws';
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS, HullParams } from '../src/sim/params';
import { TankInput, ShotEvent, KillEvent, noInput, Tank } from '../src/sim/tank';
import { addCrates, addTargets, spawnPoint } from '../src/sim/setup';
import { ClientMsg, ServerMsg, ScoreRow, NET_PORT, SNAP_EVERY, cleanInput } from '../src/net/protocol';

interface Client {
  ws: WebSocket;
  tank: Tank;
  queue: { seq: number; input: TankInput }[];
  ack: number;
  last: TankInput;
  slot: number;
  name: string;
  k: number;
  d: number;
}

const sim = await SimWorld.create();
const hulls: Record<string, HullParams> = Object.fromEntries(Object.entries(HULLS).map(([k, v]) => [k, { ...v }]));
let targets = addTargets(sim, hulls);
addCrates(sim);

const clients = new Map<WebSocket, Client>();
let tick = 0;
let shots: ShotEvent[] = [];
let kills: KillEvent[] = [];
const cleanName = (n: unknown, id: number) => (typeof n === 'string' && n.trim() ? n.trim().slice(0, 16) : `Player ${id}`);
const send = (ws: WebSocket, m: ServerMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const freeSlot = () => { const used = new Set([...clients.values()].map((c) => c.slot)); let n = 0; while (used.has(n)) n++; return n; };

const wss = new WebSocketServer({ port: Number(process.env.PORT ?? NET_PORT) });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m: ClientMsg;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const c = clients.get(ws);
    if (m.t === 'hello') {
      if (c) return;
      const slot = freeSlot();
      const tank = sim.addTank(hulls[m.hull] ?? hulls.Dart, spawnPoint(slot), 0);
      clients.set(ws, { ws, tank, queue: [], ack: 0, last: noInput(), slot, name: cleanName(m.name, tank.id), k: 0, d: 0 });
      send(ws, { t: 'welcome', id: tank.id, sim: sim.params, hulls });
      console.log(`+ player ${tank.id} (${tank.hull.name}), ${clients.size} online`);
      return;
    }
    if (!c) return;
    if (m.t === 'in') {
      if (typeof m.seq === 'number' && c.queue.length < 120) c.queue.push({ seq: m.seq, input: cleanInput(m.i) });
    } else if (m.t === 'ping') {
      send(ws, { t: 'pong', c: m.c });
    } else if (m.t === 'cmd') {
      if (m.c === 'upright' && c.tank.dead <= 0) c.tank.upright();
      if (m.c === 'respawn' && c.tank.dead <= 0) c.tank.place(spawnPoint(c.slot), 0);
      if (m.c === 'targets') {
        for (const t of targets) sim.removeTank(t);
        targets = addTargets(sim, hulls);
      }
    } else if (m.t === 'hull') {
      if (!hulls[m.hull] || m.hull === c.tank.hull.name) return;
      const p = c.tank.body.translation();
      const id = c.tank.id;
      sim.removeTank(c.tank);
      c.tank = sim.addTank(hulls[m.hull], { x: p.x, y: p.y + 0.6, z: p.z }, 0, id);
      c.tank.home = spawnPoint(c.slot);
      c.tank.homeYaw = 0;
    } else if (m.t === 'tune') {
      // Sandbox convenience: anyone connected can retune the shared world.
      for (const [k, v] of Object.entries(m.sim ?? {})) if (k in sim.params && typeof v === typeof (sim.params as any)[k]) (sim.params as any)[k] = v;
      for (const name of Object.keys(hulls)) {
        for (const [k, v] of Object.entries(m.hulls?.[name] ?? {})) {
          if (k !== 'name' && k in hulls[name] && typeof v === 'number') (hulls[name] as any)[k] = v;
        }
      }
      for (const t of sim.tanks) t.applyMass();
      for (const other of clients.keys()) if (other !== ws) send(other, { t: 'tune', sim: sim.params, hulls });
    }
  });
  ws.on('close', () => {
    const c = clients.get(ws);
    if (!c) return;
    sim.removeTank(c.tank);
    clients.delete(ws);
    console.log(`- player ${c.tank.id}, ${clients.size} online`);
  });
});

function step() {
  for (const c of clients.values()) {
    // If inputs pile up, skip ahead so the player is never acting in the past.
    while (c.queue.length > 4) { const d = c.queue.shift()!; c.ack = d.seq; c.last = d.input; }
    const item = c.queue.shift();
    if (item) { c.ack = item.seq; c.last = item.input; }
    c.tank.input = c.last;
  }
  sim.step();
  shots.push(...sim.shots);
  sim.shots.length = 0;
  for (const k of sim.kills) {
    for (const c of clients.values()) {
      if (c.tank.id === k.by && k.by !== k.victim) c.k++;
      if (c.tank.id === k.victim) c.d++;
    }
  }
  kills.push(...sim.kills);
  sim.kills.length = 0;
  tick++;
  if (tick % SNAP_EVERY === 0 && clients.size > 0) {
    const world = sim.capture();
    const score: ScoreRow[] = [...clients.values()].map((c) => ({ id: c.tank.id, name: c.name, k: c.k, d: c.d }));
    for (const c of clients.values()) {
      send(c.ws, { t: 'snap', tick, ack: c.ack, players: clients.size, shots, kills, score, ...world });
    }
    shots = [];
    kills = [];
  }
}

let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc = Math.min(0.25, acc + (now - last) / 1000);
  last = now;
  while (acc >= STEP) { step(); acc -= STEP; }
}, 4);
console.log(`tank-sandbox server on ws://0.0.0.0:${process.env.PORT ?? NET_PORT}`);

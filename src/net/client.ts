import type { HullParams } from '../sim/params';
import type { KillEvent, ShotEvent, Tank, TankInput } from '../sim/tank';
import type { Crate, SimWorld } from '../sim/world';
import type { ClientMsg, ScoreRow, ServerMsg } from './protocol';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

export interface NetHooks {
  onAdd?: (t: Tank) => void;
  onRemove?: (t: Tank) => void;
  onCrate?: (c: Crate) => void;
  onShots?: (s: ShotEvent[]) => void;
  onKills?: (k: KillEvent[]) => void;
  onTune?: () => void;
  before?: () => void; // just before the world is rewound to a snapshot
  after?: () => void; // after it has been replayed back to now
}

// Runs the same simulation as the server ahead of it: our keys apply at once,
// and every snapshot rewinds the world and replays the keys the server has not seen yet.
export class NetClient {
  id = 0;
  connected = false;
  ping = 0;
  players = 0;
  lagMs = 0; // artificial one-way delay for testing
  replaySteps = 0;
  correction = 0; // metres our own tank moved when the last snapshot was applied
  worstCorrection = 0;
  score: ScoreRow[] = [];
  serverShots = 0; // our own shots as the server resolved them
  serverHits = 0;
  private kills: KillEvent[] = [];
  private ws: WebSocket;
  private seq = 0;
  private pending: { seq: number; input: TankInput }[] = [];
  private latest: Snap | null = null;
  private shots: ShotEvent[] = [];

  constructor(
    url: string,
    private sim: SimWorld,
    private hulls: Record<string, HullParams>,
    private hooks: NetHooks,
    hull: string,
    name: string,
  ) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.connected = true; this.send({ t: 'hello', hull, name }); };
    this.ws.onclose = () => { this.connected = false; };
    this.ws.onmessage = (e) => this.delayed(() => this.receive(JSON.parse(e.data as string)));
    setInterval(() => this.send({ t: 'ping', c: performance.now() }), 1000);
  }

  get me(): Tank | undefined {
    return this.sim.tanks.find((t) => t.id === this.id);
  }

  private delayed(fn: () => void) {
    if (this.lagMs > 0) setTimeout(fn, this.lagMs); else fn();
  }

  private send(m: ClientMsg) {
    this.delayed(() => { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); });
  }

  private receive(m: ServerMsg) {
    if (m.t === 'welcome') {
      this.id = m.id;
      this.applyTune(m);
    } else if (m.t === 'tune') {
      this.applyTune(m);
    } else if (m.t === 'pong') {
      this.ping = performance.now() - m.c;
    } else if (m.t === 'snap') {
      this.shots.push(...m.shots);
      this.kills.push(...m.kills);
      if (!this.latest || m.tick > this.latest.tick) this.latest = m;
    }
  }

  private applyTune(m: { sim: object; hulls: Record<string, object> }) {
    Object.assign(this.sim.params, m.sim);
    for (const k of Object.keys(this.hulls)) Object.assign(this.hulls[k], m.hulls[k]);
    for (const t of this.sim.tanks) t.applyMass();
    this.hooks.onTune?.();
  }

  // Call once per simulated tick, before stepping the local world.
  sendInput(input: TankInput) {
    this.seq++;
    this.pending.push({ seq: this.seq, input });
    if (this.pending.length > 240) this.pending.shift();
    this.send({ t: 'in', seq: this.seq, i: input });
  }

  // Call once per frame, before the tick loop.
  sync() {
    const snap = this.latest;
    if (!snap || !this.id) return;
    this.latest = null;
    for (const s of this.shots) if (s.by === this.id) { this.serverShots++; if (s.hit) this.serverHits++; }
    const others = this.shots.filter((s) => s.by !== this.id);
    this.shots = [];
    if (others.length) this.hooks.onShots?.(others);
    if (this.kills.length) this.hooks.onKills?.(this.kills);
    this.kills = [];
    this.score = snap.score;

    this.hooks.before?.();
    const was = this.me ? { ...this.me.body.translation() } : null;
    this.sim.restore(snap, this.hulls, this.hooks.onAdd, this.hooks.onRemove, this.hooks.onCrate);
    this.players = snap.players;
    this.pending = this.pending.filter((p) => p.seq > snap.ack);
    const me = this.me;
    for (const p of this.pending) {
      if (me) me.input = p.input;
      this.sim.step(undefined, true);
    }
    this.replaySteps = this.pending.length;
    if (was && me) {
      const now = me.body.translation();
      this.correction = Math.hypot(now.x - was.x, now.y - was.y, now.z - was.z);
      this.worstCorrection = Math.max(this.worstCorrection, this.correction);
    }
    this.hooks.after?.();
  }

  command(c: 'upright' | 'respawn' | 'targets') { this.send({ t: 'cmd', c }); }
  setHull(hull: string) { this.send({ t: 'hull', hull }); }
  tune() { this.send({ t: 'tune', sim: this.sim.params, hulls: this.hulls }); }
}

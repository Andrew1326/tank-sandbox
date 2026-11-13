import RAPIER from '@dimforge/rapier3d-compat';
import { MAPS, GameMap, Box } from './level';
import { GUNS, GunParams, HullParams, SimParams, defaultSim } from './params';
import { Tank, TankInput, TankState, ShotEvent, KillEvent, FlagEvent, Projectile, SimEvents, applyHit, noInput } from './tank';
import { V3, add, scale, len, norm, qMul, qYaw, qPitch, DEG } from './vec';

export const STEP = 1 / 60;
export const CRATE = { half: 0.6, mass: 250 };
export const FLAG_REACH = 3.2; // metres from a flag or base that counts as touching it

// state: 0 at base, 1 carried, 2 lying where it was dropped
export interface Flag { team: number; state: 0 | 1 | 2; by: number; p: V3; t: number }

export interface TankSnap { id: number; hull: string; gun: string; team: number; bot: boolean; s: TankState; in: TankInput }
export interface CrateSnap { p: V3; q: { x: number; y: number; z: number; w: number }; lv: V3; av: V3 }
export interface WorldSnap {
  tanks: TankSnap[];
  crates: CrateSnap[];
  shells: Projectile[];
  flags: Flag[];
  teamScore: number[];
}

export interface Crate {
  body: RAPIER.RigidBody;
  half: number;
  prevPos: V3;
  prevRot: { x: number; y: number; z: number; w: number };
}

export class SimWorld {
  world: RAPIER.World;
  params: SimParams = defaultSim();
  guns: Record<string, GunParams> = GUNS;
  map: GameMap = MAPS.range;
  private statics: RAPIER.Collider[] = [];
  get level(): Box[] { return this.map.boxes; }
  tanks: Tank[] = [];
  crates: Crate[] = [];
  shells: Projectile[] = [];
  flags: Flag[] = [];
  teamScore: number[] = [0, 0, 0];
  shots: ShotEvent[] = [];
  kills: KillEvent[] = [];
  flagEvents: FlagEvent[] = [];
  time = 0;

  static async create(map = 'range'): Promise<SimWorld> {
    await RAPIER.init();
    const w = new SimWorld();
    w.loadMap(map);
    return w;
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -this.params.gravity, z: 0 });
    this.world.timestep = STEP;
  }

  // Swap the static scenery; tanks and crates are left alone.
  loadMap(name: string) {
    this.map = MAPS[name] ?? MAPS.range;
    for (const c of this.statics) this.world.removeCollider(c, true);
    this.statics = [];
    for (const b of this.level) {
      if (b.deco) continue;
      const rotQ = qMul(qYaw((b.yaw ?? 0) * DEG), qPitch((b.pitch ?? 0) * DEG));
      const desc = RAPIER.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2])
        .setTranslation(b.p[0], b.p[1], b.p[2])
        .setRotation(rotQ)
        .setFriction(0.6);
      this.statics.push(this.world.createCollider(desc));
    }
    this.flags = (this.map.bases ?? []).map((b) => ({ team: b.team, state: 0, by: 0, p: { x: b.x, y: 0, z: b.z }, t: 0 }));
    this.teamScore = [0, 0, 0];
  }

  get teamPlay(): boolean { return this.flags.length > 0; }

  private nextId = 1;

  addTank(hull: HullParams, pos: V3, yawDeg: number, id?: number, gun: GunParams = this.guns.Slug): Tank {
    const t = new Tank(RAPIER, this.world, hull, gun, pos, yawDeg);
    t.id = id ?? this.nextId;
    this.nextId = Math.max(this.nextId, t.id) + 1;
    this.tanks.push(t);
    return t;
  }

  removeTank(t: Tank) {
    this.world.removeRigidBody(t.body);
    this.tanks = this.tanks.filter((x) => x !== t);
  }

  addCrate(pos: V3, half: number, mass: number): Crate {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half).setMass(mass).setFriction(0.7), body);
    const c = { body, half, prevPos: { ...pos }, prevRot: { x: 0, y: 0, z: 0, w: 1 } };
    this.crates.push(c);
    return c;
  }

  // Each tank runs on its own .input; an array here overrides them by position.
  // quiet = a replay step whose events must not be shown again.
  step(inputs?: (TankInput | undefined)[], quiet = false) {
    this.world.gravity = { x: 0, y: -this.params.gravity, z: 0 };
    for (const t of this.tanks) t.snapshot();
    for (const c of this.crates) {
      c.prevPos = { ...c.body.translation() };
      c.prevRot = { ...c.body.rotation() };
    }
    const ev: SimEvents = quiet
      ? { shots: [], kills: [], spawn: [], flags: [] }
      : { shots: this.shots, kills: this.kills, spawn: [], flags: this.flagEvents };
    this.tanks.forEach((t, i) => {
      if (inputs) t.input = inputs[i] ?? noInput();
      t.step(STEP, t.input, this.params, ev);
    });
    this.flyShells(ev);
    this.shells.push(...ev.spawn);
    this.world.step();
    this.updateFlags(ev);
    this.time += STEP;
  }

  private flyShells(ev: SimEvents) {
    const keep: Projectile[] = [];
    for (const s of this.shells) {
      const speed = len(s.v);
      const dir = norm(s.v);
      const owner = this.tanks.find((t) => t.id === s.by);
      const hit = this.world.castRay(new RAPIER.Ray(s.p, dir), speed * STEP, true, undefined, undefined, undefined, owner?.body);
      if (hit) {
        const body = hit.collider.parent();
        const gun = this.guns[s.gun];
        const at = add(s.p, scale(dir, hit.timeOfImpact));
        const struck = body && gun ? applyHit(this.params, gun, s.by, s.team, dir, at, body, ev) : false;
        ev.shots.push({ by: s.by, gun: s.gun, k: 2, from: at, to: at, hit: struck });
        continue;
      }
      s.p = add(s.p, scale(s.v, STEP));
      s.life -= STEP;
      if (s.life > 0) keep.push(s);
    }
    this.shells = keep;
  }

  private updateFlags(ev: SimEvents) {
    if (!this.flags.length) return;
    const near = (t: Tank, p: V3) => { const q = t.body.translation(); return Math.hypot(q.x - p.x, q.z - p.z) < FLAG_REACH; };
    const baseOf = (team: number) => { const b = this.map.bases!.find((x) => x.team === team)!; return { x: b.x, y: 0, z: b.z }; };
    for (const f of this.flags) {
      if (f.state === 1) {
        const carrier = this.tanks.find((t) => t.id === f.by);
        if (!carrier || carrier.dead > 0) {
          f.state = 2; f.t = this.params.flagReturn; f.by = 0;
          ev.flags.push({ what: 'dropped', team: f.team, by: carrier?.id ?? 0 });
          continue;
        }
        const q = carrier.body.translation();
        f.p = { x: q.x, y: q.y, z: q.z };
        const own = this.flags.find((x) => x.team === carrier.team);
        if (own && own.state === 0 && near(carrier, baseOf(carrier.team))) {
          this.teamScore[carrier.team]++;
          ev.flags.push({ what: 'captured', team: f.team, by: carrier.id });
          f.state = 0; f.by = 0; f.p = baseOf(f.team);
        }
        continue;
      }
      if (f.state === 2) {
        f.t -= STEP;
        if (f.t <= 0) { f.state = 0; f.p = baseOf(f.team); ev.flags.push({ what: 'returned', team: f.team, by: 0 }); continue; }
      }
      for (const t of this.tanks) {
        if (t.dead > 0 || t.team === 0 || !near(t, f.p)) continue;
        if (t.team !== f.team) {
          f.state = 1; f.by = t.id;
          ev.flags.push({ what: 'taken', team: f.team, by: t.id });
          break;
        }
        if (f.state === 2) {
          f.state = 0; f.p = baseOf(f.team);
          ev.flags.push({ what: 'returned', team: f.team, by: t.id });
          break;
        }
      }
    }
  }

  capture(): WorldSnap {
    return {
      tanks: this.tanks.map((t) => ({ id: t.id, hull: t.hull.name, gun: t.gun.name, team: t.team, bot: t.bot, s: t.getState(), in: t.input })),
      crates: this.crates.map((c) => ({
        p: { ...c.body.translation() }, q: { ...c.body.rotation() }, lv: { ...c.body.linvel() }, av: { ...c.body.angvel() },
      })),
      shells: this.shells.map((s) => ({ ...s, p: { ...s.p }, v: { ...s.v } })),
      flags: this.flags.map((f) => ({ ...f, p: { ...f.p } })),
      teamScore: [...this.teamScore],
    };
  }

  // Make this world match a snapshot, creating and dropping tanks as needed.
  restore(
    snap: WorldSnap,
    hulls: Record<string, HullParams>,
    onAdd?: (t: Tank) => void,
    onRemove?: (t: Tank) => void,
    onCrate?: (c: Crate) => void,
  ) {
    const seen = new Set<number>();
    for (const ts of snap.tanks) {
      seen.add(ts.id);
      let t = this.tanks.find((x) => x.id === ts.id);
      if (t && (t.hull.name !== ts.hull || t.gun.name !== ts.gun || t.team !== ts.team)) {
        onRemove?.(t);
        this.removeTank(t);
        t = undefined;
      }
      if (!t) {
        t = this.addTank(hulls[ts.hull], ts.s.p, 0, ts.id, this.guns[ts.gun]);
        t.bot = ts.bot;
        t.team = ts.team;
        t.setState(ts.s);
        t.snapshot();
        onAdd?.(t);
      } else {
        t.setState(ts.s);
      }
      t.input = ts.in;
    }
    for (const t of [...this.tanks]) {
      if (!seen.has(t.id)) {
        onRemove?.(t);
        this.removeTank(t);
      }
    }
    snap.crates.forEach((cs, i) => {
      let c = this.crates[i];
      if (!c) {
        c = this.addCrate(cs.p, CRATE.half, CRATE.mass);
        onCrate?.(c);
      }
      c.body.setTranslation(cs.p, true);
      c.body.setRotation(cs.q, true);
      c.body.setLinvel(cs.lv, true);
      c.body.setAngvel(cs.av, true);
    });
    this.shells = snap.shells.map((s) => ({ ...s, p: { ...s.p }, v: { ...s.v } }));
    this.flags = snap.flags.map((f) => ({ ...f, p: { ...f.p } }));
    this.teamScore = [...snap.teamScore];
  }
}

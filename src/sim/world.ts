import RAPIER from '@dimforge/rapier3d-compat';
import { buildLevel, Box } from './level';
import { HullParams, SimParams, defaultSim } from './params';
import { Tank, TankInput, TankState, ShotEvent, KillEvent, noInput } from './tank';
import { V3, qMul, qYaw, qPitch, DEG } from './vec';

export const STEP = 1 / 60;

export const CRATE = { half: 0.6, mass: 250 };

export interface TankSnap { id: number; hull: string; bot: boolean; s: TankState; in: TankInput }
export interface CrateSnap { p: V3; q: { x: number; y: number; z: number; w: number }; lv: V3; av: V3 }
export interface WorldSnap { tanks: TankSnap[]; crates: CrateSnap[] }

export interface Crate {
  body: RAPIER.RigidBody;
  half: number;
  prevPos: V3;
  prevRot: { x: number; y: number; z: number; w: number };
}

export class SimWorld {
  world: RAPIER.World;
  params: SimParams = defaultSim();
  level: Box[] = buildLevel();
  tanks: Tank[] = [];
  crates: Crate[] = [];
  shots: ShotEvent[] = [];
  kills: KillEvent[] = [];
  time = 0;

  static async create(): Promise<SimWorld> {
    await RAPIER.init();
    return new SimWorld();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -this.params.gravity, z: 0 });
    this.world.timestep = STEP;
    for (const b of this.level) {
      if (b.deco) continue;
      const rotQ = qMul(qYaw((b.yaw ?? 0) * DEG), qPitch((b.pitch ?? 0) * DEG));
      const desc = RAPIER.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2])
        .setTranslation(b.p[0], b.p[1], b.p[2])
        .setRotation(rotQ)
        .setFriction(0.6);
      this.world.createCollider(desc);
    }
  }

  private nextId = 1;

  addTank(hull: HullParams, pos: V3, yawDeg: number, id?: number): Tank {
    const t = new Tank(RAPIER, this.world, hull, pos, yawDeg);
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
  // quiet = a replay step whose shots must not be shown again.
  step(inputs?: (TankInput | undefined)[], quiet = false) {
    this.world.gravity = { x: 0, y: -this.params.gravity, z: 0 };
    for (const t of this.tanks) t.snapshot();
    for (const c of this.crates) {
      c.prevPos = { ...c.body.translation() };
      c.prevRot = { ...c.body.rotation() };
    }
    const ev = quiet ? { shots: [], kills: [] } : { shots: this.shots, kills: this.kills };
    this.tanks.forEach((t, i) => {
      if (inputs) t.input = inputs[i] ?? noInput();
      t.step(STEP, t.input, this.params, ev);
    });
    this.world.step();
    this.time += STEP;
  }

  capture(): WorldSnap {
    return {
      tanks: this.tanks.map((t) => ({ id: t.id, hull: t.hull.name, bot: t.bot, s: t.getState(), in: t.input })),
      crates: this.crates.map((c) => ({
        p: { ...c.body.translation() }, q: { ...c.body.rotation() }, lv: { ...c.body.linvel() }, av: { ...c.body.angvel() },
      })),
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
      if (t && t.hull.name !== ts.hull) {
        onRemove?.(t);
        this.removeTank(t);
        t = undefined;
      }
      if (!t) {
        t = this.addTank(hulls[ts.hull], ts.s.p, 0, ts.id);
        t.bot = ts.bot;
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
  }
}

import RAPIER from '@dimforge/rapier3d-compat';
import { buildLevel, Box } from './level';
import { HullParams, SimParams, defaultSim } from './params';
import { Tank, TankInput, ShotEvent, noInput } from './tank';
import { V3, qMul, qYaw, qPitch, DEG } from './vec';

export const STEP = 1 / 60;

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

  addTank(hull: HullParams, pos: V3, yawDeg: number): Tank {
    const t = new Tank(RAPIER, this.world, hull, pos, yawDeg);
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

  // inputs[i] drives tanks[i]; tanks without an entry hold still.
  step(inputs: (TankInput | undefined)[]) {
    this.world.gravity = { x: 0, y: -this.params.gravity, z: 0 };
    for (const t of this.tanks) t.snapshot();
    for (const c of this.crates) {
      c.prevPos = { ...c.body.translation() };
      c.prevRot = { ...c.body.rotation() };
    }
    this.tanks.forEach((t, i) => t.step(STEP, inputs[i] ?? noInput(), this.params, this.shots));
    this.world.step();
    this.time += STEP;
  }
}

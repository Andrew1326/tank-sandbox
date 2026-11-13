import type RAPIER from '@dimforge/rapier3d-compat';
import type { HullParams, SimParams } from './params';
import { V3, Q, v3, add, sub, scale, dot, cross, norm, rot, clamp, qMul, qYaw, DEG } from './vec';

export interface TankInput {
  throttle: number; // -1..1
  steer: number; // +1 = left
  turret: number; // +1 = left
  center: boolean;
  fire: boolean;
  boost?: boolean;
}

export const noInput = (): TankInput => ({ throttle: 0, steer: 0, turret: 0, center: false, fire: false });

export interface ShotEvent {
  by: number;
  from: V3;
  to: V3;
  hit: boolean;
}

// Everything needed to put a tank back exactly where the server says it is.
export interface TankState {
  p: V3; q: Q; lv: V3; av: V3;
  ty: number; tv: number; cd: number; pe: number; bo: number;
  lx: number; lz: number; pu: boolean;
}

export interface RayState {
  origin: V3;
  end: V3;
  grounded: boolean;
}

type Rapier = typeof RAPIER;

function pointVel(body: RAPIER.RigidBody, p: V3): V3 {
  const c = body.worldCom();
  return add(body.linvel(), cross(body.angvel(), sub(p, c)));
}

export class Tank {
  body: RAPIER.RigidBody;
  hull: HullParams;
  id = 0;
  bot = false;
  input: TankInput = noInput();
  turretYaw = 0;
  turretVel = 0;
  rays: RayState[] = [];
  grounded = 0;
  forwardSpeed = 0;
  sideSpeed = 0;
  yawRate = 0;
  slopeDeg = 0;
  boostLeft = 0;
  private lastVx = 0;
  private lastVz = 0;
  private shotHit = false;
  private pushed = false;
  private cooldown = 0;
  private pending = -1;

  prevPos: V3 = v3();
  prevRot: Q = { x: 0, y: 0, z: 0, w: 1 };
  prevTurret = 0;

  constructor(
    private R: Rapier,
    private world: RAPIER.World,
    hull: HullParams,
    pos: V3,
    yawDeg: number,
  ) {
    this.hull = hull;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(qYaw(yawDeg * DEG))
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(desc);
    const col = R.ColliderDesc.cuboid(hull.halfW, hull.halfH, hull.halfL).setDensity(0).setFriction(0.25).setRestitution(0.05);
    world.createCollider(col, this.body);
    const dome = R.ColliderDesc.cuboid(hull.halfW * 0.55, 0.25, hull.halfW * 0.6)
      .setTranslation(0, hull.halfH + 0.25, 0)
      .setDensity(0)
      .setFriction(0.25);
    world.createCollider(dome, this.body);
    this.body.userData = this;
    this.applyMass();
    this.snapshot();
  }

  applyMass() {
    const h = this.hull;
    const w = h.halfW * 2, t = h.halfH * 2, l = h.halfL * 2;
    const k = h.mass / 12;
    this.body.setAdditionalMassProperties(
      h.mass,
      { x: 0, y: h.comY, z: 0 },
      { x: k * (t * t + l * l) * h.stability, y: k * (w * w + l * l), z: k * (w * w + t * t) * h.stability },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
  }

  snapshot() {
    this.prevPos = { ...this.body.translation() };
    this.prevRot = { ...this.body.rotation() };
    this.prevTurret = this.turretYaw;
  }

  place(pos: V3, yawDeg: number) {
    this.body.setTranslation(pos, true);
    this.body.setRotation(qYaw(yawDeg * DEG), true);
    this.body.setLinvel(v3(), true);
    this.body.setAngvel(v3(), true);
    this.lastVx = this.lastVz = 0;
    this.snapshot();
  }

  getState(): TankState {
    const b = this.body;
    return {
      p: { ...b.translation() }, q: { ...b.rotation() }, lv: { ...b.linvel() }, av: { ...b.angvel() },
      ty: this.turretYaw, tv: this.turretVel, cd: this.cooldown, pe: this.pending, bo: this.boostLeft,
      lx: this.lastVx, lz: this.lastVz, pu: this.pushed,
    };
  }

  setState(s: TankState) {
    const b = this.body;
    b.setTranslation(s.p, true);
    b.setRotation(s.q, true);
    b.setLinvel(s.lv, true);
    b.setAngvel(s.av, true);
    this.turretYaw = s.ty; this.turretVel = s.tv; this.cooldown = s.cd; this.pending = s.pe; this.boostLeft = s.bo;
    this.lastVx = s.lx; this.lastVz = s.lz; this.pushed = s.pu;
    this.shotHit = false;
  }

  private touchingTank(): boolean {
    let found = false;
    for (let i = 0; i < this.body.numColliders(); i++) {
      this.world.contactPairsWith(this.body.collider(i), (other) => {
        if (other.parent()?.userData instanceof Tank) found = true;
      });
    }
    return found;
  }

  // Keep the heading, drop the tilt.
  upright() {
    const f = rot(this.body.rotation(), v3(0, 0, -1));
    const yaw = Math.atan2(-f.x, -f.z) / DEG;
    const p = this.body.translation();
    this.place({ x: p.x, y: p.y + 1.2, z: p.z }, yaw);
  }

  turretRotation(): Q {
    return qMul(this.body.rotation(), qYaw(this.turretYaw));
  }

  step(dt: number, input: TankInput, P: SimParams, shots: ShotEvent[]) {
    const b = this.body;
    const h = this.hull;
    const m = h.mass;
    b.setAngularDamping(P.angularDamping);
    if (input.boost) this.boostLeft = P.boostTime;
    this.boostLeft = Math.max(0, this.boostLeft - dt);
    const boosted = this.boostLeft > 0;
    const topSpeed = h.topSpeed * (boosted ? P.boostSpeed : 1);
    const accel = h.accel * (boosted ? P.boostAccel : 1);

    // A sudden shove from a collision is mostly soaked up; steady pushing is untouched.
    const v0 = b.linvel();
    const jx = v0.x - this.lastVx, jz = v0.z - this.lastVz;
    const gained = Math.hypot(v0.x, v0.z) > Math.hypot(this.lastVx, this.lastVz);
    // An idle tank that another tank leans on gives way: it resists with a small
    // hold plus drag, so it can be pushed slowly and slides to rest after a ram.
    const touching = this.touchingTank();
    const idle = input.throttle === 0 && input.steer === 0;
    if (!idle) this.pushed = false;
    else if (touching) this.pushed = true;
    else if (Math.hypot(v0.x, v0.z) < 0.15) this.pushed = false;
    if (!this.shotHit && P.shoveAbsorb > 0 && Math.hypot(jx, jz) > P.shoveThreshold && touching) {
      // The one that got hit keeps little of the jolt; the one that hit loses most of what it had left.
      const k = m * P.shoveAbsorb;
      if (gained) b.applyImpulse({ x: -jx * k, y: 0, z: -jz * k }, true);
      else b.applyImpulse({ x: -v0.x * k, y: 0, z: -v0.z * k }, true);
    }
    this.shotHit = false;

    const pos = b.translation();
    const q = b.rotation();
    const up = rot(q, v3(0, 1, 0));
    const fwd = rot(q, v3(0, 0, -1));
    const down = scale(up, -1);

    // Suspension: springs sized so the hull bounces at suspFreq whatever its mass.
    const count = P.raysPerSide * 2;
    const omega = 2 * Math.PI * P.suspFreq;
    const k = (m * omega * omega) / count;
    const c = (2 * P.suspDamping * m * omega) / count;
    const sag = P.gravity / (omega * omega);
    const restLen = h.halfH + P.clearance + sag;
    const maxLen = restLen + P.droop;
    const maxForce = (6 * m * P.gravity) / count;

    this.rays.length = 0;
    let grounded = 0;
    let sumP = v3(), sumN = v3(), sumGV = v3();
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < P.raysPerSide; i++) {
        const f = P.raysPerSide > 1 ? i / (P.raysPerSide - 1) : 0.5;
        const local = v3(side * (h.halfW - P.trackInset), 0, (f * 2 - 1) * h.halfL * 0.9);
        const origin = add(pos, rot(q, local));
        const hit = this.world.castRayAndGetNormal(new this.R.Ray(origin, down), maxLen, true, undefined, undefined, undefined, b);
        if (!hit) {
          this.rays.push({ origin, end: add(origin, scale(down, maxLen)), grounded: false });
          continue;
        }
        const dist = hit.timeOfImpact;
        const hp = add(origin, scale(down, dist));
        const other = hit.collider.parent();
        const otherDyn = other && other.isDynamic() ? other : null;
        const gv = otherDyn ? pointVel(otherDyn, hp) : v3();
        const closing = dot(sub(pointVel(b, hp), gv), down);
        const x = restLen - dist;
        const force = x > 0 ? clamp(k * x + c * closing, 0, maxForce) : 0;
        if (force > 0) {
          b.applyImpulseAtPoint(scale(up, force * dt), hp, true);
          if (otherDyn) otherDyn.applyImpulseAtPoint(scale(up, -force * dt), hp, true);
        }
        const touching = dist <= restLen + 0.06;
        if (touching) {
          grounded++;
          sumP = add(sumP, hp);
          sumN = add(sumN, hit.normal);
          sumGV = add(sumGV, gv);
        }
        this.rays.push({ origin, end: hp, grounded: touching });
      }
    }
    this.grounded = grounded;

    const lv = b.linvel();
    const av = b.angvel();
    this.yawRate = dot(av, up) / DEG;
    this.forwardSpeed = dot(lv, fwd);

    if (grounded > 0) {
      const n = norm(sumN);
      const slope = Math.acos(clamp(n.y, -1, 1)) / DEG;
      this.slopeDeg = slope;
      const grip = clamp((P.gripZeroDeg - slope) / Math.max(1e-3, P.gripZeroDeg - P.gripFullDeg), 0, 1);
      const s = (grounded / count) * grip;
      const gf = norm(sub(fwd, scale(n, dot(fwd, n))));
      const gr = cross(gf, n);
      const v = sub(lv, scale(sumGV, 1 / grounded));
      const vF = dot(v, gf);
      const vR = dot(v, gr);
      this.forwardSpeed = vF;
      this.sideSpeed = vR;

      // Tracks: chase a target speed, limited by the hull's accelerations.
      let dvF: number;
      if (input.throttle !== 0) {
        const target = input.throttle * topSpeed;
        const braking = vF * input.throttle < -0.3;
        const a = braking ? h.reverseAccel : accel;
        dvF = clamp(target - vF, -a * dt, a * dt);
      } else {
        const hold = this.pushed ? P.pushHold + P.pushDrag * Math.abs(vF) : h.coastDecel;
        dvF = clamp(-vF, -hold * dt, hold * dt);
      }
      const sideHold = this.pushed ? P.pushHold + P.pushDrag * Math.abs(vR) : h.lateralAccel;
      const dvR = clamp(-vR, -sideHold * dt, sideHold * dt);

      const com = b.worldCom();
      const pc = scale(sumP, 1 / grounded);
      const lift = dot(sub(com, pc), n);
      const pDrive = add(pc, scale(n, lift * (1 - P.driveHeight)));
      const pSide = add(pc, scale(n, lift * (1 - P.sideHeight)));
      b.applyImpulseAtPoint(scale(gf, m * dvF * s), pDrive, true);
      b.applyImpulseAtPoint(scale(gr, m * dvR * s), pSide, true);

      // Turning: same idea on the yaw rate.
      const w = dot(av, up);
      let targetW = input.steer * h.turnSpeed * DEG;
      if (P.invertSteerInReverse && vF < -0.5) targetW = -targetW;
      const sameWay = targetW !== 0 && w * targetW >= 0;
      const aW = (sameWay ? h.turnAccel : h.antiTurnAccel) * DEG * (this.pushed ? 0.25 : 1);
      const dW = clamp(targetW - w, -aW * dt, aW * dt);
      const iy = (m / 12) * ((h.halfW * 2) ** 2 + (h.halfL * 2) ** 2);
      b.applyTorqueImpulse(scale(up, iy * dW * s), true);
    } else {
      this.sideSpeed = 0;
    }

    // Turret
    const tSpeed = P.turretSpeed * DEG;
    let tTarget = input.turret * tSpeed;
    if (input.center && input.turret === 0) {
      const wrapped = Math.atan2(Math.sin(this.turretYaw), Math.cos(this.turretYaw));
      this.turretYaw = wrapped;
      tTarget = clamp(-wrapped / dt, -tSpeed, tSpeed);
    }
    const tA = P.turretAccel * DEG * dt;
    this.turretVel += clamp(tTarget - this.turretVel, -tA, tA);
    this.turretYaw += this.turretVel * dt;

    // Gun
    this.cooldown -= dt;
    if (input.fire && this.cooldown <= 0 && this.pending < 0) {
      this.pending = P.fireDelay;
      this.cooldown = P.reload + P.fireDelay;
    }
    if (this.pending >= 0) {
      this.pending -= dt;
      if (this.pending < 0) this.shoot(P, shots);
    }
    const v1 = b.linvel();
    this.lastVx = v1.x;
    this.lastVz = v1.z;
  }

  private shoot(P: SimParams, shots: ShotEvent[]) {
    const b = this.body;
    const h = this.hull;
    const q = b.rotation();
    const up = rot(q, v3(0, 1, 0));
    const dir = rot(this.turretRotation(), v3(0, 0, -1));
    const pivot = add(b.translation(), scale(up, h.halfH + 0.3));
    const muzzle = add(pivot, scale(dir, h.halfL * 1.05));
    // Vertical auto-aim: the flattest ray in the allowed fan that finds a tank wins.
    const cast = (d: V3) => this.world.castRay(new this.R.Ray(pivot, d), P.range, true, undefined, undefined, undefined, b);
    const isTank = (hit: ReturnType<typeof cast>) => !!hit && !!hit.collider.parent()?.isDynamic();
    let aim = dir;
    let hit = cast(dir);
    if (!isTank(hit)) {
      const steps = Math.ceil(Math.max(P.autoAimUp, P.autoAimDown));
      search: for (let i = 1; i <= steps; i++) {
        for (const sign of [-1, 1]) {
          if (i > (sign > 0 ? P.autoAimUp : P.autoAimDown)) continue;
          const a = sign * i * DEG;
          const d = norm(add(scale(dir, Math.cos(a)), scale(up, Math.sin(a))));
          const h2 = cast(d);
          if (isTank(h2)) { aim = d; hit = h2; break search; }
        }
      }
    }
    let end = add(pivot, scale(aim, P.range));
    let struck = false;
    if (hit) {
      end = add(pivot, scale(aim, hit.timeOfImpact));
      const other = hit.collider.parent();
      if (other && other.isDynamic()) {
        // Pull the push point towards the target's centre-of-mass height so a hit turns and shoves more than it tips.
        const oc = other.worldCom();
        const oUp = rot(other.rotation(), v3(0, 1, 0));
        const lift = dot(sub(end, oc), oUp);
        const at = sub(end, scale(oUp, lift * (1 - P.impactTilt)));
        other.applyImpulseAtPoint(scale(aim, P.impact), at, true);
        if (other.userData instanceof Tank) other.userData.shotHit = true;
        struck = true;
      }
    }
    b.applyImpulseAtPoint(scale(dir, -P.recoil), muzzle, true);
    shots.push({ by: this.id, from: muzzle, to: end, hit: struck });
  }
}

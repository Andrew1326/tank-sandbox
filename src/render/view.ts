import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SimWorld, Crate } from '../sim/world';
import type { Tank } from '../sim/tank';
import { DEG } from '../sim/vec';
import { TEAM_COLORS } from '../sim/level';
import { TankMats, buildHull, buildTurret, makeMats } from './models';

function gridTexture(): THREE.Texture {
  const size = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#868d96';
  g.fillRect(0, 0, size, size);
  const cell = size / 10;
  for (let i = 0; i <= 10; i++) {
    const major = i % 5 === 0;
    g.strokeStyle = major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
    g.lineWidth = major ? 5 : 2;
    g.beginPath();
    g.moveTo(i * cell, 0); g.lineTo(i * cell, size);
    g.moveTo(0, i * cell); g.lineTo(size, i * cell);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelSprite(text: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.font = '600 34px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 32);
  g.fillStyle = '#ffffff';
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(4, 1, 1);
  return sp;
}

const IDENTITY = new THREE.Quaternion();

interface TankView {
  tank: Tank;
  group: THREE.Group;
  turret: THREE.Group;
  offPos: THREE.Vector3; // leftover from the last network correction, fades out
  offQuat: THREE.Quaternion;
  shown: { pos: THREE.Vector3; quat: THREE.Quaternion } | null;
  mats: TankMats;
  charge: THREE.Mesh | null;
  color: number;
  bar: THREE.Sprite;
  barCanvas: HTMLCanvasElement;
  barKey: string;
  name: string;
}

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  camDist = 9;
  camHeight = 4.5;
  showRays = false;
  private tanks: TankView[] = [];
  private crates: { crate: Crate; mesh: THREE.Mesh }[] = [];
  private rayLines: THREE.LineSegments;
  private tracers: { line: THREE.Mesh; life: number; full: number }[] = [];
  private shellMeshes: THREE.Mesh[] = [];
  private flagViews: { team: number; group: THREE.Group }[] = [];
  private camYaw = 0;
  private camPos = new THREE.Vector3(0, 6, 12);
  private camReady = false;

  constructor(canvas: HTMLCanvasElement, private sim: SimWorld) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: location.search.includes('shot') });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0xbfd3e6);
    this.scene.fog = new THREE.Fog(0xbfd3e6, 120, 380);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777c85, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.far = 220;
    sc.updateProjectionMatrix();
    this.sun = sun;
    this.scene.add(sun, sun.target);

    this.buildLevel();

    this.rayLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
    );
    this.rayLines.frustumCulled = false;
    this.rayLines.renderOrder = 999;
    this.scene.add(this.rayLines);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private sun: THREE.DirectionalLight;
  private levelGroup = new THREE.Group();

  buildLevel() {
    this.scene.remove(this.levelGroup);
    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    const grid = gridTexture();
    for (const b of this.sim.level) {
      const isGround = !!b.ground;
      const mat = new THREE.MeshStandardMaterial({ color: isGround ? 0xffffff : b.color, roughness: 0.9 });
      if (isGround) {
        mat.map = grid;
        grid.repeat.set((b.h[0] * 2) / 10, (b.h[2] * 2) / 10);
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2), mat);
      mesh.position.set(b.p[0], b.p[1], b.p[2]);
      mesh.rotation.set((b.pitch ?? 0) * DEG, (b.yaw ?? 0) * DEG, 0, 'YXZ');
      mesh.receiveShadow = true;
      mesh.castShadow = !isGround && !b.deco;
      this.levelGroup.add(mesh);
      if (b.label) {
        const sp = labelSprite(b.label);
        sp.position.set(b.p[0] + (b.deco ? -5.5 : 0), b.p[1] + b.h[1] + (b.deco ? 0.8 : 1.4), b.p[2]);
        this.levelGroup.add(sp);
      }
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  addTank(tank: Tank, color: number, name = '') {
    const h = tank.hull;
    const mats = makeMats(color);
    const group = buildHull(h, mats);
    const roof = h.halfH * (h.name === 'Dart' ? 1.05 : h.name === 'Ranger' ? 1.1 : 1.15);
    const built = buildTurret(tank.gun.name, h.halfW * 0.92, h.halfL * 1.05, mats);
    const turret = built.group;
    turret.position.y = roof;
    group.add(turret);
    group.traverse((o) => { o.castShadow = true; });
    this.scene.add(group);
    const barCanvas = document.createElement('canvas');
    barCanvas.width = 256; barCanvas.height = 64;
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(barCanvas), depthTest: false, transparent: true }));
    bar.scale.set(3.2, 0.8, 1);
    bar.renderOrder = 998;
    this.scene.add(bar);
    this.tanks.push({ tank, group, turret, offPos: new THREE.Vector3(), offQuat: new THREE.Quaternion(), shown: null, mats, charge: built.charge, color, bar, barCanvas, barKey: '', name });
  }

  removeTank(tank: Tank) {
    const i = this.tanks.findIndex((t) => t.tank === tank);
    if (i < 0) return;
    this.scene.remove(this.tanks[i].group);
    this.scene.remove(this.tanks[i].bar);
    this.tanks.splice(i, 1);
  }

  addCrate(crate: Crate) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(crate.half * 2, crate.half * 2, crate.half * 2),
      new THREE.MeshStandardMaterial({ color: 0xc9a25b, roughness: 0.8 }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.crates.push({ crate, mesh });
  }

  setName(tank: Tank, name: string) {
    const tv = this.tanks.find((t) => t.tank === tank);
    if (tv) tv.name = name;
  }

  explode(at: { x: number; y: number; z: number }) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(at.x, at.y + 0.5, at.z);
    this.scene.add(mesh);
    this.blasts.push({ mesh, life: 0.6 });
  }

  private blasts: { mesh: THREE.Mesh; life: number }[] = [];

  private drawBar(tv: TankView) {
    const t = tv.tank;
    const frac = Math.max(0, t.hp / t.hull.hp);
    const key = `${tv.name}|${frac.toFixed(2)}|${t.dead > 0}`;
    if (key === tv.barKey) return;
    tv.barKey = key;
    const g = tv.barCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    if (tv.name) {
      g.font = '600 24px ui-monospace, Menlo, monospace';
      g.textAlign = 'center';
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.strokeText(tv.name, 128, 26);
      g.fillStyle = '#fff';
      g.fillText(tv.name, 128, 26);
    }
    if (t.dead <= 0) {
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(48, 40, 160, 14);
      g.fillStyle = frac > 0.5 ? '#58d26b' : frac > 0.25 ? '#e8c14a' : '#e25a4a';
      g.fillRect(50, 42, 156 * frac, 10);
    }
    (tv.bar.material.map as THREE.CanvasTexture).needsUpdate = true;
  }

  // Network corrections: remember where every tank is drawn, then turn the jump
  // into an offset that fades, so a correction never shows as a snap.
  beginCorrection() {
    for (const tv of this.tanks) tv.shown = { pos: tv.group.position.clone(), quat: tv.group.quaternion.clone() };
  }

  endCorrection() {
    for (const tv of this.tanks) {
      if (!tv.shown) continue;
      const p = tv.tank.body.translation(), r = tv.tank.body.rotation();
      tv.offPos.set(tv.shown.pos.x - p.x, tv.shown.pos.y - p.y, tv.shown.pos.z - p.z);
      tv.offQuat.copy(tv.shown.quat).multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
      if (tv.offPos.length() > 4) { tv.offPos.set(0, 0, 0); tv.offQuat.identity(); }
      // The replay ends on the present, so draw from it without re-interpolating the last replay step.
      tv.tank.snapshot();
      tv.shown = null;
    }
  }

  showShots(shots: { gun?: string; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; hit: boolean }[]) {
    for (const s of shots) {
      const from = new THREE.Vector3(s.from.x, s.from.y, s.from.z), to = new THREE.Vector3(s.to.x, s.to.y, s.to.z);
      const lance = s.gun === 'Lance';
      // A cylinder stretched between the two points: a thin tracer, or a fat beam for the Lance.
      const len = from.distanceTo(to);
      const r = lance ? 0.14 : 0.035;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, len, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: lance ? 0x9be8ff : s.hit ? 0xff9a4a : 0xfff2a8, transparent: true }),
      );
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      this.scene.add(mesh);
      this.tracers.push({ line: mesh, life: lance ? 0.6 : 0.25, full: lance ? 0.6 : 0.25 });
      const flash = new THREE.Mesh(new THREE.SphereGeometry(lance ? 0.5 : 0.32, 8, 6), new THREE.MeshBasicMaterial({ color: lance ? 0xcff5ff : 0xffd27a, transparent: true }));
      flash.position.copy(from);
      this.scene.add(flash);
      this.tracers.push({ line: flash, life: 0.09, full: 0.09 });
      if (s.hit) {
        const spark = new THREE.Mesh(new THREE.SphereGeometry(lance ? 0.7 : 0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true }));
        spark.position.copy(to);
        this.scene.add(spark);
        this.tracers.push({ line: spark, life: 0.15, full: 0.15 });
      }
    }
  }

  drainShots() {
    this.showShots(this.sim.shots);
    this.sim.shots.length = 0;
  }

  render(alpha: number, dt: number, follow: Tank | null) {
    const a = new THREE.Quaternion(), b = new THREE.Quaternion();
    for (const tv of this.tanks) {
      const t = tv.tank;
      const p = t.body.translation(), r = t.body.rotation();
      tv.group.position.set(
        t.prevPos.x + (p.x - t.prevPos.x) * alpha,
        t.prevPos.y + (p.y - t.prevPos.y) * alpha,
        t.prevPos.z + (p.z - t.prevPos.z) * alpha,
      );
      a.set(t.prevRot.x, t.prevRot.y, t.prevRot.z, t.prevRot.w);
      b.set(r.x, r.y, r.z, r.w);
      tv.group.quaternion.copy(a.slerp(b, alpha));
      const fade = Math.exp(-dt * 10);
      tv.offPos.multiplyScalar(fade);
      tv.offQuat.slerp(IDENTITY, 1 - fade);
      tv.group.position.add(tv.offPos);
      tv.group.quaternion.premultiply(tv.offQuat);
      tv.turret.rotation.y = t.prevTurret + (t.turretYaw - t.prevTurret) * alpha;
      // Wrecks go dark; a freshly respawned tank is see-through while protected.
      const wreck = t.dead > 0;
      tv.mats.paint.color.setHex(wreck ? 0x2b2b2b : tv.color);
      tv.mats.trim.color.setHex(wreck ? 0x1c1c1c : tv.color).multiplyScalar(wreck ? 1 : 0.62);
      tv.mats.glow.emissiveIntensity = wreck ? 0 : 1.4;
      for (const mat of [tv.mats.paint, tv.mats.trim]) { mat.transparent = t.shield > 0; mat.opacity = t.shield > 0 ? 0.45 : 1; }
      if (tv.charge) {
        const c = wreck ? 0 : t.charge;
        tv.charge.visible = c > 0;
        tv.charge.scale.setScalar(0.4 + c * 1.6);
      }
      this.drawBar(tv);
      tv.bar.position.set(tv.group.position.x, tv.group.position.y + t.hull.halfH + 2.1, tv.group.position.z);
      tv.bar.visible = t !== follow; // your own health is in the HUD
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const bl = this.blasts[i];
      bl.life -= dt;
      const k = 1 - bl.life / 0.6;
      bl.mesh.scale.setScalar(1 + k * 4);
      (bl.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
      if (bl.life <= 0) { this.scene.remove(bl.mesh); this.blasts.splice(i, 1); }
    }
    for (const cv of this.crates) {
      const c = cv.crate;
      const p = c.body.translation(), r = c.body.rotation();
      cv.mesh.position.set(
        c.prevPos.x + (p.x - c.prevPos.x) * alpha,
        c.prevPos.y + (p.y - c.prevPos.y) * alpha,
        c.prevPos.z + (p.z - c.prevPos.z) * alpha,
      );
      a.set(c.prevRot.x, c.prevRot.y, c.prevRot.z, c.prevRot.w);
      b.set(r.x, r.y, r.z, r.w);
      cv.mesh.quaternion.copy(a.slerp(b, alpha));
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      (tr.line.material as THREE.MeshBasicMaterial).opacity = Math.max(0, tr.life / tr.full);
      if (tr.life <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }

    // Bolts in flight
    const shells = this.sim.shells;
    while (this.shellMeshes.length < shells.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7dffb0 }));
      this.scene.add(m);
      this.shellMeshes.push(m);
    }
    this.shellMeshes.forEach((m, i) => {
      const sh = shells[i];
      m.visible = !!sh;
      if (sh) m.position.set(sh.p.x + sh.v.x * alpha / 60, sh.p.y + sh.v.y * alpha / 60, sh.p.z + sh.v.z * alpha / 60);
    });

    // Flags: on their pad, lying where dropped, or riding on the carrier
    const flags = this.sim.flags;
    if (this.flagViews.length !== flags.length) {
      for (const fv of this.flagViews) this.scene.remove(fv.group);
      this.flagViews = flags.map((f) => {
        const group = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 8), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.6, roughness: 0.4 }));
        pole.position.y = 2;
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.05), new THREE.MeshStandardMaterial({ color: TEAM_COLORS[f.team], emissive: TEAM_COLORS[f.team], emissiveIntensity: 0.35 }));
        cloth.position.set(0.78, 3.45, 0);
        group.add(pole, cloth);
        group.traverse((o) => { o.castShadow = true; });
        this.scene.add(group);
        return { team: f.team, group };
      });
    }
    flags.forEach((f, i) => {
      const g = this.flagViews[i].group;
      const carrier = f.state === 1 ? this.tanks.find((t) => t.tank.id === f.by) : null;
      if (carrier) g.position.copy(carrier.group.position).add(new THREE.Vector3(0, carrier.tank.hull.halfH + 0.2, carrier.tank.hull.halfL * 0.6).applyQuaternion(carrier.group.quaternion));
      else g.position.set(f.p.x, f.state === 2 ? Math.max(0, f.p.y - 0.8) : 0, f.p.z);
      g.rotation.z = f.state === 2 ? 0.35 : 0;
    });

    this.rayLines.visible = this.showRays;
    if (this.showRays) {
      const pos: number[] = [], col: number[] = [];
      for (const tv of this.tanks) {
        for (const r of tv.tank.rays) {
          pos.push(r.origin.x, r.origin.y, r.origin.z, r.end.x, r.end.y, r.end.z);
          const c = r.grounded ? [0.2, 1, 0.4] : [1, 0.3, 0.3];
          col.push(...c, ...c);
        }
      }
      this.rayLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.rayLines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }

    // Chase camera: sits behind the turret and eases after it.
    const fv = this.tanks.find((t) => t.tank === follow);
    if (fv) {
      const target = fv.group.position;
      const e = new THREE.Euler().setFromQuaternion(fv.group.quaternion, 'YXZ');
      const want = e.y + fv.turret.rotation.y;
      if (!this.camReady) this.camYaw = want;
      const diff = Math.atan2(Math.sin(want - this.camYaw), Math.cos(want - this.camYaw));
      this.camYaw += diff * (1 - Math.exp(-dt * 6));
      const desired = new THREE.Vector3(
        target.x + Math.sin(this.camYaw) * this.camDist,
        target.y + this.camHeight,
        target.z + Math.cos(this.camYaw) * this.camDist,
      );
      // Keep the camera on our side of walls: pull it in to just before whatever is in the way.
      const eye = new THREE.Vector3(target.x, target.y + 1.6, target.z);
      const to = desired.clone().sub(eye);
      const far = to.length();
      to.normalize();
      const blocked = this.sim.world.castRay(new RAPIER.Ray(eye, to), far, true, undefined, undefined, undefined, fv.tank.body);
      if (blocked && blocked.timeOfImpact < far) {
        desired.copy(eye).addScaledVector(to, Math.max(1.5, blocked.timeOfImpact - 0.6));
        this.camPos.copy(desired);
      }
      if (!this.camReady) this.camPos.copy(desired);
      this.camPos.lerp(desired, 1 - Math.exp(-dt * 8));
      this.camReady = true;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(target.x, target.y + 1.2, target.z);
      this.sun.position.set(target.x + 40, 70, target.z + 30);
      this.sun.target.position.copy(target);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

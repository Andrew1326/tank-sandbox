import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SimWorld, Crate } from '../sim/world';
import type { ShotEvent, Tank } from '../sim/tank';
import { DEG } from '../sim/vec';
import { TEAM_COLORS } from '../sim/level';
import { Running, TankMats, buildHull, buildTurret, makeMats } from './models';
import { coverTex, crateTex, deckTex, frostTex, gridTex, groundTex, metricBox, rampTex, skyTex, wallTex } from './textures';
import { Fx } from './fx';
import { Sound } from './audio';

const IDENTITY = new THREE.Quaternion();
const CHAR = new THREE.Color(0x4a3026), ICE = new THREE.Color(0xbfe6ff), HOT = new THREE.Color(0xffa030);
const V = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

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

interface TankView {
  tank: Tank;
  group: THREE.Group;
  turret: THREE.Group;
  barrel: THREE.Group;
  muzzle: THREE.Object3D;
  left: Running;
  right: Running;
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
  recoil: number; // 1 right after a shot, eases to 0
  dust: number; // timers that pace the particle streams
  smoke: number;
  marked: THREE.Vector3; // where the last track mark was laid
  wasShielded: boolean;
  ice: THREE.Mesh[]; // glaze that thickens as the tank freezes
  burn: number; // paces the flames on a burning hull
  laser: THREE.Mesh | null; // sight line shown while this tank is in its scope
}

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
  fx: Fx;
  sound = new Sound();
  camDist = 9;
  camHeight = 4.5;
  showRays = false;
  effects = true;
  scope = { on: false, charge: 0, damage: 0 }; // read by the page to draw the scope overlay
  private tanks: TankView[] = [];
  private crates: { crate: Crate; mesh: THREE.Mesh }[] = [];
  private rayLines: THREE.LineSegments;
  private beams: { mesh: THREE.Mesh; life: number; full: number }[] = [];
  private blobs: THREE.Mesh[] = []; // bolts in flight
  private flagViews: { team: number; group: THREE.Group; cloth: THREE.Mesh; base: Float32Array; beam: THREE.Mesh }[] = [];
  private camYaw = 0;
  private camPos = new THREE.Vector3(0, 6, 12);
  private camReady = false;
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private levelGroup = new THREE.Group();
  private mats: Record<string, THREE.Material>;
  private crateMat: THREE.Material;
  private clock = 0;
  private frost = frostTex();

  constructor(canvas: HTMLCanvasElement, private sim: SimWorld) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: location.search.includes('shot') });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.fog = new THREE.Fog(0xc8dcea, 120, 520);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    this.scene.add(this.sky);

    this.scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x6f6c60, 1.0));
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    const sc = sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.far = 220;
    sc.updateProjectionMatrix();
    this.sun = sun;
    this.scene.add(sun, sun.target);

    const std = (map: THREE.Texture, rough = 0.92, metal = 0) => new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal });
    this.mats = {
      ground: std(groundTex()), grid: std(gridTex()), wall: std(wallTex()),
      deck: std(deckTex(), 0.7, 0.35), ramp: std(rampTex(), 0.8, 0.2), cover: std(coverTex(), 0.8, 0.25),
    };
    this.crateMat = std(crateTex(), 0.85);
    this.fx = new Fx(this.scene);
    this.buildLevel();

    this.rayLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    this.rayLines.frustumCulled = false;
    this.rayLines.renderOrder = 999;
    this.scene.add(this.rayLines);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Which surface a level box gets, from the colour its map gave it.
  private surface(b: { color: number; pitch?: number; ground?: boolean; h: number[] }): [THREE.Material, number] {
    if (b.ground) return this.sim.map.name === 'range' ? [this.mats.grid, 10] : [this.mats.ground, 8];
    if (b.pitch) return [this.mats.ramp, 3];
    if (b.color === 0x6b7480) return [this.mats.deck, 2];
    if (b.color === 0x59616b || b.color === 0x7c8794) return [this.mats.cover, 2.5];
    return [this.mats.wall, 4];
  }

  buildLevel() {
    this.scene.remove(this.levelGroup);
    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    for (const b of this.sim.level) {
      let mesh: THREE.Mesh;
      if (b.deco) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.9, transparent: true, opacity: 0.85 }));
      } else {
        const [mat, tile] = this.surface(b);
        mesh = new THREE.Mesh(metricBox(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2, tile), mat);
        mesh.castShadow = !b.ground;
      }
      mesh.position.set(b.p[0], b.p[1], b.p[2]);
      mesh.rotation.set((b.pitch ?? 0) * DEG, (b.yaw ?? 0) * DEG, 0, 'YXZ');
      mesh.receiveShadow = true;
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
    const mats = makeMats(color, tank.id * 7 + 3);
    const hull = buildHull(h, mats);
    const group = hull.group;
    const roof = h.halfH * (h.name === 'Dart' ? 1.05 : h.name === 'Ranger' ? 1.1 : 1.15);
    const built = buildTurret(tank.gun.name, h.halfW * 0.92, h.halfL * 1.05, mats);
    const turret = built.group;
    turret.position.y = roof;
    group.add(turret);
    group.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    const glowColor: Record<string, number> = { Ember: 0xff7a1a, Frost: 0xcdf3ff, Pulse: 0x7dffb0, Hawk: 0xff5a3a };
    mats.glow.emissive.setHex(glowColor[tank.gun.name] ?? 0x66d9ff);
    // Ice shell: one block over the hull, one over the turret, invisible until chilled.
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xe6f6ff, map: this.frost, transparent: true, opacity: 0, roughness: 0.12, metalness: 0.05, emissive: 0x7fbfff, emissiveIntensity: 0.35, depthWrite: false });
    const iceHull = new THREE.Mesh(new THREE.BoxGeometry(h.halfW * 2 + 0.16, h.halfH * 2 + 0.45, h.halfL * 2 + 0.16), iceMat);
    iceHull.position.y = 0.02;
    const iceTurret = new THREE.Mesh(new THREE.BoxGeometry(h.halfW * 1.35, 0.62, h.halfW * 1.7), iceMat);
    iceTurret.position.y = 0.3;
    group.add(iceHull);
    turret.add(iceTurret);
    iceHull.visible = iceTurret.visible = false;
    this.scene.add(group);
    const barCanvas = document.createElement('canvas');
    barCanvas.width = 256; barCanvas.height = 64;
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(barCanvas), depthTest: false, transparent: true }));
    bar.scale.set(3.2, 0.8, 1);
    bar.renderOrder = 998;
    this.scene.add(bar);
    const p = tank.body.translation();
    this.tanks.push({
      tank, group, turret, barrel: built.barrel, muzzle: built.muzzle, left: hull.left, right: hull.right,
      offPos: new THREE.Vector3(), offQuat: new THREE.Quaternion(), shown: null, mats, charge: built.charge, color,
      bar, barCanvas, barKey: '', name, recoil: 0, dust: 0, smoke: 0, marked: V(p), wasShielded: false, ice: [iceHull, iceTurret], burn: 0, laser: null,
    });
  }

  removeTank(tank: Tank) {
    const i = this.tanks.findIndex((t) => t.tank === tank);
    if (i < 0) return;
    this.scene.remove(this.tanks[i].group);
    this.scene.remove(this.tanks[i].bar);
    if (this.tanks[i].laser) this.scene.remove(this.tanks[i].laser!);
    this.tanks.splice(i, 1);
  }

  addCrate(crate: Crate) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(crate.half * 2, crate.half * 2, crate.half * 2), this.crateMat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.crates.push({ crate, mesh });
  }

  setName(tank: Tank, name: string) {
    const tv = this.tanks.find((t) => t.tank === tank);
    if (tv) tv.name = name;
  }

  explode(at: { x: number; y: number; z: number }) {
    this.fx.explode(V(at), Math.max(0, at.y - 0.9));
    this.sound.explosion(at.x, at.z);
  }

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

  showShots(shots: ShotEvent[]) {
    for (const s of shots) {
      const from = V(s.from), to = V(s.to);
      const shooter = this.tanks.find((t) => t.tank.id === s.by);
      if (s.k !== 2) {
        // Leaving the barrel: flash, smoke, kick and bang.
        const dir = shooter ? new THREE.Vector3(0, 0, -1).applyQuaternion(shooter.turret.getWorldQuaternion(new THREE.Quaternion())) : to.clone().sub(from).normalize();
        const at = shooter ? shooter.muzzle.getWorldPosition(new THREE.Vector3()) : from;
        if (this.effects) this.fx.muzzle(at, dir, s.gun);
        if (shooter) shooter.recoil = 1;
        this.sound.shot(s.gun, from.x, from.z);
      }
      if (s.k === 0) {
        const lance = s.gun === 'Lance', hawk = s.gun === 'Hawk';
        const len = from.distanceTo(to);
        const r = lance ? 0.13 : hawk ? 0.04 + (s.power ?? 0) * 0.07 : 0.03;
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, len, 6, 1, true),
          new THREE.MeshBasicMaterial({ color: lance ? 0x9be8ff : hawk ? 0xffd9c2 : 0xfff2a8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        mesh.position.copy(from).add(to).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        this.scene.add(mesh);
        const life = lance ? 0.7 : hawk ? 0.45 : 0.14;
        this.beams.push({ mesh, life, full: life });
        if (hawk && this.effects) {
          // The round leaves a thin line of smoke hanging in the air.
          const n = Math.min(60, Math.floor(len / 3));
          for (let i = 1; i <= n; i++) this.fx.puff(from.clone().lerp(to, i / (n + 1)), { color: 0xd9d4cc, size: [0.2, 0.9], life: 0.9 + Math.random() * 0.6, alpha: 0.35, spread: 0.3, rise: 0.4 });
        }
        if (lance && this.effects) {
          // Curls of vapour left hanging along the beam.
          const n = Math.min(40, Math.floor(len / 2.5));
          for (let i = 1; i <= n; i++) this.fx.puff(from.clone().lerp(to, i / (n + 1)), { color: 0xa9ecff, size: [0.35, 1.1], life: 0.5 + Math.random() * 0.5, alpha: 0.5, glow: true, spread: 0.6 });
        }
      }
      if (s.k !== 1) {
        if (s.hit) { if (this.effects) this.fx.spark(to, s.gun); this.sound.hit(s.gun, to.x, to.z); }
        else if (this.effects && (s.k === 2 || from.distanceTo(to) < 290)) {
          // Hit scenery: a kick of dust.
          for (let i = 0; i < 4; i++) this.fx.puff(to, { color: 0x9a958a, size: [0.4, 1.6], life: 0.5 + Math.random() * 0.4, alpha: 0.5, spread: 3, rise: 1.5 });
        }
      }
    }
  }

  drainShots() {
    this.showShots(this.sim.shots);
    this.sim.shots.length = 0;
  }

  private animateTank(tv: TankView, dt: number, alpha: number, follow: Tank | null) {
    const t = tv.tank, h = t.hull;
    const wreck = t.dead > 0;
    const heat = wreck ? 0 : Math.max(0, t.temp), cold = wreck ? 0 : Math.max(0, -t.temp);
    // Hot metal: the paint chars and the whole tank glows from dull red towards orange.
    tv.mats.paint.color.setHex(wreck ? 0x2b2b2b : 0xffffff).lerp(CHAR, heat * 0.55).lerp(ICE, cold * 0.5);
    tv.mats.trim.color.setHex(wreck ? 0x1c1c1c : tv.color).multiplyScalar(wreck ? 1 : 0.62).lerp(CHAR, heat * 0.5).lerp(ICE, cold * 0.5);
    const flicker = 0.85 + Math.sin(this.clock * 23 + t.id) * 0.15;
    for (const mat of [tv.mats.paint, tv.mats.trim, tv.mats.metal, tv.mats.dark]) {
      if (heat > 0) { mat.emissive.setHex(0xff2a00).lerp(HOT, heat * heat); mat.emissiveIntensity = heat * 1.5 * flicker; }
      else if (cold > 0) { mat.emissive.setHex(0x5fb4ff); mat.emissiveIntensity = cold * 0.35; }
      else mat.emissiveIntensity = 0;
    }
    for (const m of tv.ice) { m.visible = cold > 0.02; (m.material as THREE.MeshStandardMaterial).opacity = Math.min(0.8, cold * 0.9); }
    tv.mats.glow.emissiveIntensity = wreck ? 0 : 1.4;
    for (const mat of [tv.mats.paint, tv.mats.trim]) { mat.transparent = t.shield > 0; mat.opacity = t.shield > 0 ? 0.55 + Math.sin(this.clock * 18) * 0.2 : 1; }
    if (tv.charge) {
      const c = wreck ? 0 : t.charge;
      tv.charge.visible = c > 0;
      tv.charge.scale.setScalar(0.4 + c * 1.6 + Math.sin(this.clock * 40) * 0.08);
    }
    this.drawBar(tv);
    tv.bar.position.set(tv.group.position.x, tv.group.position.y + h.halfH + 2.1, tv.group.position.z);
    tv.bar.visible = t !== follow; // your own health is in the HUD

    // In the scope: a thin sight line gives the sniper away to everyone else.
    if (t.scoped && t !== follow) {
      if (!tv.laser) {
        tv.laser = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 5, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.scene.add(tv.laser);
      }
      const from = tv.muzzle.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(tv.turret.getWorldQuaternion(new THREE.Quaternion()));
      const hit = this.sim.world.castRay(new RAPIER.Ray(from, dir), t.gun.range, true, undefined, undefined, undefined, t.body);
      const len = hit ? hit.timeOfImpact : t.gun.range;
      tv.laser.visible = true;
      tv.laser.position.copy(from).addScaledVector(dir, len / 2);
      tv.laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      tv.laser.scale.set(1 + t.charge * 1.5, len, 1 + t.charge * 1.5);
      (tv.laser.material as THREE.MeshBasicMaterial).opacity = 0.35 + t.charge * 0.5;
    } else if (tv.laser) tv.laser.visible = false;

    // Barrel slides back and eases home.
    tv.recoil = Math.max(0, tv.recoil - dt * (t.gun.name === 'Pulse' ? 14 : 3.5));
    tv.barrel.position.z = tv.recoil * tv.recoil * (t.gun.name === 'Lance' ? 0.55 : t.gun.name === 'Pulse' ? 0.12 : 0.4);

    // Tracks and wheels turn at each side's own ground speed.
    const yaw = t.yawRate * DEG * (h.halfW - 0.2);
    const moving = !wreck && t.grounded > 0;
    for (const [side, sign] of [[tv.left, -1], [tv.right, 1]] as [Running, number][]) {
      const v = moving ? t.forwardSpeed + sign * yaw : 0;
      side.tread.offset.x -= (v * dt) / 0.7;
      for (const w of side.wheels) w.rotation.x -= (v * dt) / side.wheelR;
    }
    if (!this.effects) return;

    const pos = tv.group.position;
    // Stream guns: a rolling jet of fire or freezing fog from the nozzle.
    if (t.streaming) {
      const at = tv.muzzle.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(tv.turret.getWorldQuaternion(new THREE.Quaternion()));
      const reach = t.gun.range, life = 0.42;
      const fire = t.gun.name === 'Ember';
      const n = Math.max(1, Math.round(dt * 110));
      for (let i = 0; i < n; i++) {
        const vel = dir.clone().multiplyScalar((reach / life) * (0.75 + Math.random() * 0.35));
        const spread = Math.tan(t.gun.cone * DEG) * (reach / life) * 1.3;
        if (fire) this.fx.puff(at, { color: [0xfff0a0, 0xffb040, 0xff6a1a, 0xe0380c][Math.floor(Math.random() * 4)], size: [0.35, 2.3 + Math.random()], life: life * (0.8 + Math.random() * 0.4), alpha: 0.95, glow: true, vel, spread, rise: 3, drag: 1.1 });
        else this.fx.puff(at, { color: Math.random() < 0.3 ? 0xffffff : 0xbfe9ff, size: [0.35, 2.6 + Math.random()], life: life * (0.9 + Math.random() * 0.5), alpha: 0.5, glow: Math.random() < 0.25, vel, spread, rise: -1.5, drag: 1.1 });
      }
      if (fire && Math.random() < dt * 14) this.fx.puff(at.clone().addScaledVector(dir, reach * 0.8), { color: 0x2b2826, size: [1.2, 3.4], life: 1.2, alpha: 0.45, spread: 2, rise: 3 });
      if (Math.random() < dt * 20) this.fx.flash(at.clone().addScaledVector(dir, reach * 0.35), fire ? 0xff8a2a : 0xaee4ff, fire ? 26 : 10, 0.12);
    }
    // On fire: flames lick up off the hull, with black smoke above.
    if (heat > 0.05) {
      tv.burn -= dt;
      if (tv.burn <= 0) {
        tv.burn = 0.11 - heat * 0.07;
        const at = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * h.halfW * 2, h.halfH * 0.6 + Math.random() * 0.7, (Math.random() - 0.5) * h.halfL * 2).applyQuaternion(tv.group.quaternion));
        this.fx.puff(at, { color: Math.random() < 0.5 ? 0xffb040 : 0xff5a14, size: [0.5 + heat * 0.5, 1.5 + heat], life: 0.4 + Math.random() * 0.25, alpha: 0.9, glow: true, spread: 0.8, rise: 5 });
        if (Math.random() < 0.4) this.fx.puff(at.clone().setY(at.y + 0.6), { color: 0x1f1d1b, size: [0.7, 2.6], life: 1.3, alpha: 0.5 * heat + 0.15, spread: 0.8, rise: 2.6, drag: 0.8 });
        if (Math.random() < 0.2) this.fx.flash(at, 0xff7a1a, 10 * heat, 0.15);
      }
    }
    // Frozen: glints off the ice and cold vapour sinking to the ground.
    if (cold > 0.05) {
      tv.burn -= dt;
      if (tv.burn <= 0) {
        tv.burn = 0.14;
        const at = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * h.halfW * 2.2, Math.random() * 1.2, (Math.random() - 0.5) * h.halfL * 2.2).applyQuaternion(tv.group.quaternion));
        this.fx.puff(at, { color: 0xffffff, size: [0.28 * cold + 0.08, 0.02], life: 0.35, alpha: 1, glow: true });
        if (Math.random() < 0.5) this.fx.puff(at, { color: 0xd4efff, size: [0.6, 1.8], life: 1.1, alpha: 0.28 * cold + 0.08, spread: 0.6, rise: -1.2 });
      }
    }
    const speed = Math.abs(t.forwardSpeed) + Math.abs(t.sideSpeed);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(tv.group.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(tv.group.quaternion);
    if (wreck) {
      // Burning wreck.
      tv.smoke -= dt;
      if (tv.smoke <= 0) {
        tv.smoke = 0.07;
        this.fx.puff(pos.clone().setY(pos.y + 0.8), { color: 0x25221f, size: [1.1, 3.6], life: 2 + Math.random(), alpha: 0.6, spread: 1.2, rise: 2.6, drag: 0.8 });
        if (Math.random() < 0.5) this.fx.puff(pos.clone().setY(pos.y + 0.6), { color: 0xff8a2a, size: [0.9, 1.6], life: 0.3, alpha: 0.9, glow: true, spread: 1.4, rise: 4 });
      }
      return;
    }
    if (t.shield > 0 && !tv.wasShielded) {
      // Just came back: a ring of light.
      for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.283; this.fx.puff(pos.clone().add(new THREE.Vector3(Math.cos(a) * 2, 0.4, Math.sin(a) * 2)), { color: 0x9be8ff, size: [0.8, 0.2], life: 0.7, alpha: 0.9, glow: true, rise: 5 }); }
    }
    tv.wasShielded = t.shield > 0;

    // Dust off the back of each track, exhaust under load, slip smoke in a drift.
    tv.dust -= dt;
    if (tv.dust <= 0 && t.grounded > 0 && speed > 1.2) {
      tv.dust = 0.05 + 0.25 / speed;
      const drifting = Math.abs(t.sideSpeed) > 1.5;
      for (const s of [-1, 1]) {
        const at = pos.clone().addScaledVector(back, h.halfL * 0.9).addScaledVector(right, s * (h.halfW - 0.25)).setY(pos.y - h.halfH - 0.15);
        this.fx.puff(at, { color: drifting ? 0xd8d4cc : 0xa39d90, size: [0.5, drifting ? 2.6 : 1.7], life: 0.7 + Math.random() * 0.5, alpha: drifting ? 0.5 : 0.3, vel: back.clone().multiplyScalar(1.5), spread: 1.2, rise: 0.9 });
      }
    }
    tv.smoke -= dt;
    if (tv.smoke <= 0) {
      tv.smoke = t.input.throttle !== 0 ? 0.06 : 0.22;
      const at = pos.clone().addScaledVector(back, h.halfL).setY(pos.y + h.halfH * 0.6);
      this.fx.puff(at, { color: 0x3a3836, size: [0.25, t.input.throttle !== 0 ? 1.3 : 0.7], life: 0.6, alpha: t.input.throttle !== 0 ? 0.4 : 0.16, vel: back.clone().multiplyScalar(2.5).setY(1.2), spread: 0.5, rise: 1.2 });
    }
    // Track marks, laid a short strip at a time.
    if (t.grounded >= 4 && tv.marked.distanceTo(pos) > 0.9) {
      const heading = Math.atan2(-back.x, -back.z);
      const hard = Math.abs(t.sideSpeed) > 1.2 || Math.abs(t.yawRate) > 60;
      for (const s of [-1, 1]) {
        const at = pos.clone().addScaledVector(right, s * (h.halfW - 0.25));
        this.fx.mark(at.x, pos.y - h.halfH - 0.27, at.z, 0.4, 1.15, heading, hard ? 0.42 : 0.14, hard ? 26 : 12);
      }
      tv.marked.copy(pos);
    }
    void alpha;
  }

  render(alpha: number, dt: number, follow: Tank | null) {
    this.clock += dt;
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
      this.animateTank(tv, dt, alpha, follow);
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

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const bm = this.beams[i];
      bm.life -= dt;
      const k = Math.max(0, bm.life / bm.full);
      (bm.mesh.material as THREE.MeshBasicMaterial).opacity = k;
      bm.mesh.scale.set(0.3 + k, 1, 0.3 + k);
      if (bm.life <= 0) { this.scene.remove(bm.mesh); bm.mesh.geometry.dispose(); this.beams.splice(i, 1); }
    }

    // Bolts in flight, each trailing a short glow.
    const shells = this.sim.shells;
    while (this.blobs.length < shells.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xb6ffd2 }));
      this.scene.add(m);
      this.blobs.push(m);
    }
    this.blobs.forEach((m, i) => {
      const sh = shells[i];
      m.visible = !!sh;
      if (!sh) return;
      m.position.set(sh.p.x + sh.v.x * alpha / 60, sh.p.y + sh.v.y * alpha / 60, sh.p.z + sh.v.z * alpha / 60);
      if (this.effects) this.fx.puff(m.position, { color: 0x58f09a, size: [0.6, 0.1], life: 0.16, alpha: 0.8, glow: true });
    });

    // The nearest flame and the nearest frost jet set how loud each hiss is.
    for (const kind of ['Ember', 'Frost'] as const) {
      let level = 0;
      for (const tv of this.tanks) {
        if (!tv.tank.streaming || tv.tank.gun.name !== kind) continue;
        const d = Math.hypot(tv.group.position.x - this.camPos.x, tv.group.position.z - this.camPos.z);
        level = Math.max(level, 1 / (1 + (d / 22) ** 2));
      }
      this.sound.spray(kind, level);
    }
    this.updateFlags();
    this.fx.update(dt);

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
    const inScope = !!fv && fv.tank.scoped;
    if (fv) fv.group.visible = !inScope; // looking through the sight, not at our own turret
    if (inScope !== this.scope.on) { this.scope.on = inScope; this.sound.click(); }
    if (fv && inScope) {
      // Scope view: the eye sits on the gun and the picture tightens as the shot builds.
      const t = fv.tank;
      const quat = fv.turret.getWorldQuaternion(new THREE.Quaternion());
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      const eye = fv.turret.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.56, -0.8).applyQuaternion(quat));
      const sway = (1 - t.charge) * 0.004; // settles as you hold
      this.camera.position.copy(eye);
      this.camera.quaternion.copy(quat);
      this.camera.rotateX(Math.sin(this.clock * 1.7) * sway);
      this.camera.rotateY(Math.cos(this.clock * 1.3) * sway);
      const fov = 24 - t.charge * 13;
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 10));
      this.camera.updateProjectionMatrix();
      this.camPos.copy(eye).addScaledVector(dir, -this.camDist).setY(eye.y + this.camHeight); // where the chase camera will resume from
      this.camYaw = Math.atan2(-dir.x, -dir.z);
      this.scope.charge = t.charge;
      this.scope.damage = t.gun.damage + (t.gun.maxDamage - t.gun.damage) * t.charge;
      this.sun.position.set(eye.x + 45, 70, eye.z + 25);
      this.sun.target.position.copy(eye);
      this.sound.listener = { x: eye.x, z: eye.z, yaw: this.camYaw };
      this.sound.drive(0, 0, t.charge, true);
    } else if (fv) {
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
      // Explosions and our own heavy shots jolt the view; the boost widens it.
      const sh = this.fx.shake + fv.recoil * (fv.tank.gun.name === 'Lance' ? 0.25 : fv.tank.gun.name === 'Slug' ? 0.08 : 0);
      if (sh > 0) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
      this.camera.lookAt(target.x, target.y + 1.2, target.z);
      const fov = 55 + (fv.tank.boostLeft > 0 ? 7 : 0) * Math.min(1, Math.abs(fv.tank.forwardSpeed) / fv.tank.hull.topSpeed);
      if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 4)); this.camera.updateProjectionMatrix(); }
      this.sun.position.set(target.x + 45, 70, target.z + 25);
      this.sun.target.position.copy(target);
      this.sound.listener = { x: this.camPos.x, z: this.camPos.z, yaw: this.camYaw };
      const t = fv.tank;
      this.sound.drive(t.forwardSpeed / t.hull.topSpeed, t.input.throttle, t.dead > 0 ? 0 : t.charge, t.dead <= 0);
    }
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  // Flags: on their pad, lying where dropped, or riding on the carrier; the cloth ripples.
  private updateFlags() {
    const flags = this.sim.flags;
    if (this.flagViews.length !== flags.length) {
      for (const fv of this.flagViews) this.scene.remove(fv.group);
      this.flagViews = flags.map((f) => {
        const group = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.7, roughness: 0.35 }));
        pole.position.y = 2.1;
        const geo = new THREE.PlaneGeometry(1.8, 1.1, 12, 4);
        geo.translate(0.9, 0, 0);
        const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: TEAM_COLORS[f.team], emissive: TEAM_COLORS[f.team], emissiveIntensity: 0.3, side: THREE.DoubleSide, roughness: 0.8 }));
        cloth.position.set(0.05, 3.55, 0);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[f.team], transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.y = 15;
        group.add(pole, cloth, beam);
        pole.castShadow = cloth.castShadow = true;
        this.scene.add(group);
        return { team: f.team, group, cloth, base: new Float32Array(geo.attributes.position.array), beam };
      });
    }
    flags.forEach((f, i) => {
      const fv = this.flagViews[i];
      const g = fv.group;
      const carrier = f.state === 1 ? this.tanks.find((t) => t.tank.id === f.by) : null;
      if (carrier) g.position.copy(carrier.group.position).add(new THREE.Vector3(0, carrier.tank.hull.halfH + 0.2, carrier.tank.hull.halfL * 0.6).applyQuaternion(carrier.group.quaternion));
      else g.position.set(f.p.x, f.state === 2 ? Math.max(0, f.p.y - 0.8) : 0, f.p.z);
      g.rotation.z = f.state === 2 ? 0.3 : 0;
      fv.beam.visible = f.state !== 1;
      (fv.beam.material as THREE.MeshBasicMaterial).opacity = f.state === 2 ? 0.1 + Math.abs(Math.sin(this.clock * 4)) * 0.22 : 0.16;
      const pos = fv.cloth.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const x = fv.base[k * 3];
        pos.setZ(k, Math.sin(x * 3.2 - this.clock * 6 + fv.base[k * 3 + 1] * 1.5) * 0.14 * x);
      }
      pos.needsUpdate = true;
      fv.cloth.geometry.computeVertexNormals();
    });
  }
}

import * as THREE from 'three';
import { puffTex } from './textures';

interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  full: number;
  size0: number;
  size1: number;
  alpha: number;
  drag: number;
  rise: number;
}

interface Chunk { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }
interface Mark { mesh: THREE.Mesh; life: number; full: number; alpha: number }
interface Flash { light: THREE.PointLight; life: number; full: number; power: number }

export interface PuffOpts {
  color: number; size: [number, number]; life: number; alpha?: number;
  vel?: THREE.Vector3; spread?: number; rise?: number; drag?: number; glow?: boolean;
}

// Smoke, dust, fire, debris, scorch and track marks, all from fixed pools so a long fight never slows down.
export class Fx {
  private puffs: Puff[] = [];
  private free: THREE.Sprite[] = [];
  private chunks: Chunk[] = [];
  private marks: Mark[] = [];
  private flashes: Flash[] = [];
  private tex = puffTex();
  private chunkGeo = new THREE.BoxGeometry(0.28, 0.16, 0.36);
  private chunkMat = new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.8 });
  private markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  shake = 0;

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 420; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false }));
      sprite.visible = false;
      scene.add(sprite);
      this.free.push(sprite);
    }
  }

  puff(at: THREE.Vector3, o: PuffOpts) {
    const sprite = this.free.pop() ?? this.puffs.shift()?.sprite;
    if (!sprite) return;
    const mat = sprite.material;
    mat.color.setHex(o.color);
    mat.blending = o.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.rotation = Math.random() * 6.28;
    sprite.position.copy(at);
    sprite.visible = true;
    const s = o.spread ?? 0;
    const vel = (o.vel ?? new THREE.Vector3()).clone().add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    this.puffs.push({ sprite, vel, life: o.life, full: o.life, size0: o.size[0], size1: o.size[1], alpha: o.alpha ?? 0.8, drag: o.drag ?? 1.5, rise: o.rise ?? 0 });
  }

  flash(at: THREE.Vector3, color: number, power: number, life: number) {
    const light = new THREE.PointLight(color, power, 26, 1.6);
    light.position.copy(at);
    this.scene.add(light);
    this.flashes.push({ light, life, full: life, power });
  }

  // A flat stain on the ground: tyre-black for tracks, soot for explosions.
  mark(x: number, y: number, z: number, w: number, l: number, yaw: number, alpha: number, life: number) {
    let m: Mark;
    if (this.marks.length >= 260) {
      m = this.marks.shift()!;
    } else {
      const mesh = new THREE.Mesh(this.markGeo, new THREE.MeshBasicMaterial({ color: 0x0b0b0b, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      m = { mesh, life, full: life, alpha };
    }
    m.mesh.position.set(x, y, z);
    m.mesh.rotation.y = yaw;
    m.mesh.scale.set(w, 1, l);
    m.life = m.full = life;
    m.alpha = alpha;
    this.marks.push(m);
  }

  // Soot left by an explosion: a soft round stain that fades over a minute.
  private scorches: Mark[] = [];
  scorch(x: number, y: number, z: number, size: number) {
    if (this.scorches.length >= 24) { const old = this.scorches.shift()!; this.scene.remove(old.mesh); }
    const mesh = new THREE.Mesh(this.markGeo, new THREE.MeshBasicMaterial({ color: 0x050505, map: this.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    mesh.position.set(x, y, z);
    mesh.scale.set(size, 1, size);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.scorches.push({ mesh, life: 60, full: 60, alpha: 0.85 });
  }

  muzzle(at: THREE.Vector3, dir: THREE.Vector3, gun: string) {
    const lance = gun === 'Lance', pulse = gun === 'Pulse';
    const color = lance ? 0x9be8ff : pulse ? 0x7dffb0 : 0xffc56a;
    this.flash(at, color, lance ? 60 : pulse ? 10 : 34, lance ? 0.22 : 0.09);
    this.puff(at, { color, size: [pulse ? 0.5 : 1.1, pulse ? 0.9 : 2.2], life: 0.09, alpha: 1, glow: true });
    if (pulse) return;
    for (let i = 0; i < (lance ? 3 : 6); i++) {
      this.puff(at, { color: lance ? 0xbfe9f5 : 0x9a968e, size: [0.5, 1.9], life: 0.7 + Math.random() * 0.5, alpha: 0.42, vel: dir.clone().multiplyScalar(2 + Math.random() * 5), spread: 1.6, rise: 0.8 });
    }
  }

  spark(at: THREE.Vector3, gun: string) {
    const color = gun === 'Lance' ? 0xbff2ff : gun === 'Pulse' ? 0x9dffc4 : 0xffb35a;
    this.flash(at, color, gun === 'Pulse' ? 8 : 28, 0.1);
    this.puff(at, { color, size: [gun === 'Pulse' ? 0.6 : 1.2, 0.2], life: 0.12, alpha: 1, glow: true });
    const n = gun === 'Pulse' ? 3 : 9;
    for (let i = 0; i < n; i++) this.puff(at, { color: 0xffd58a, size: [0.16, 0.04], life: 0.25 + Math.random() * 0.25, alpha: 1, glow: true, spread: 14, rise: -9, drag: 0.6 });
    if (gun !== 'Pulse') this.puff(at, { color: 0x6d6a66, size: [0.6, 1.8], life: 0.6, alpha: 0.4, spread: 1, rise: 1 });
  }

  explode(at: THREE.Vector3, groundY: number) {
    this.flash(at.clone().setY(at.y + 1), 0xffa040, 220, 0.5);
    this.shake = Math.max(this.shake, 0.6);
    for (let i = 0; i < 14; i++) this.puff(at, { color: i % 3 ? 0xff8a2a : 0xffd27a, size: [1.2, 4.2 + Math.random() * 2], life: 0.35 + Math.random() * 0.3, alpha: 1, glow: true, spread: 7, rise: 3 });
    for (let i = 0; i < 16; i++) this.puff(at, { color: i % 2 ? 0x2a2826 : 0x4a4642, size: [1.5, 5 + Math.random() * 3], life: 1.6 + Math.random() * 1.6, alpha: 0.7, spread: 5, rise: 3.2, drag: 1.1 });
    for (let i = 0; i < 22; i++) this.puff(at, { color: 0xffc070, size: [0.22, 0.05], life: 0.5 + Math.random() * 0.6, alpha: 1, glow: true, spread: 26, rise: -10, drag: 0.5, vel: new THREE.Vector3(0, 9, 0) });
    for (let i = 0; i < 9; i++) {
      const mesh = new THREE.Mesh(this.chunkGeo, this.chunkMat);
      mesh.position.copy(at).setY(at.y + 0.6);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.chunks.push({
        mesh, life: 3,
        vel: new THREE.Vector3((Math.random() - 0.5) * 16, 6 + Math.random() * 9, (Math.random() - 0.5) * 16),
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
      });
    }
    this.scorch(at.x, groundY + 0.03, at.z, 9);
  }

  update(dt: number) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; this.free.push(p.sprite); this.puffs.splice(i, 1); continue; }
      const k = 1 - p.life / p.full;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.vel.y += p.rise * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const size = p.size0 + (p.size1 - p.size0) * k;
      p.sprite.scale.set(size, size, 1);
      p.sprite.material.opacity = p.alpha * (1 - k) * Math.min(1, k * 12);
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      c.vel.y -= 22 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.y < 0.1 && c.vel.y < 0) { c.mesh.position.y = 0.1; c.vel.y *= -0.3; c.vel.x *= 0.5; c.vel.z *= 0.5; c.spin.multiplyScalar(0.4); }
      if (c.life <= 0) { this.scene.remove(c.mesh); this.chunks.splice(i, 1); }
    }
    for (const m of this.marks) {
      m.life -= dt;
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = m.alpha * Math.max(0, Math.min(1, m.life / (m.full * 0.5)));
    }
    for (const m of this.scorches) {
      m.life -= dt;
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = m.alpha * Math.max(0, Math.min(1, m.life / (m.full * 0.5)));
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.light.intensity = f.power * Math.max(0, f.life / f.full);
      if (f.life <= 0) { this.scene.remove(f.light); f.light.dispose(); this.flashes.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }
}

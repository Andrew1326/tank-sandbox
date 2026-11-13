import * as THREE from 'three';
import type { SimWorld, Crate } from '../sim/world';
import type { Tank } from '../sim/tank';
import { DEG } from '../sim/vec';

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

interface TankView {
  tank: Tank;
  group: THREE.Group;
  turret: THREE.Group;
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
  private tracers: { line: THREE.Line; life: number }[] = [];
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

    const grid = gridTexture();
    for (const b of sim.level) {
      const isGround = b.h[0] > 100;
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
      this.scene.add(mesh);
      if (b.label) {
        const sp = labelSprite(b.label);
        sp.position.set(b.p[0] + (b.deco ? -5.5 : 0), b.p[1] + b.h[1] + (b.deco ? 0.8 : 1.4), b.p[2]);
        this.scene.add(sp);
      }
    }

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

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  addTank(tank: Tank, color: number) {
    const h = tank.hull;
    const group = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(h.halfW * 2 - 0.7, h.halfH * 2, h.halfL * 2), paint);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(h.halfW * 2 - 0.9, h.halfH * 0.9, 0.5), dark);
    nose.position.set(0, h.halfH * 0.3, -h.halfL + 0.2);
    group.add(body, nose);
    for (const side of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.42, h.halfH * 2 + 0.3, h.halfL * 2), dark);
      track.position.set(side * (h.halfW - 0.21), -0.15, 0);
      group.add(track);
    }
    const turret = new THREE.Group();
    turret.position.y = h.halfH;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(h.halfW * 0.55, h.halfW * 0.65, 0.5, 8), paint);
    dome.position.y = 0.25;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, h.halfL * 1.25, 10), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.32, -h.halfL * 0.75);
    turret.add(dome, barrel);
    group.add(turret);
    group.traverse((o) => { o.castShadow = true; });
    this.scene.add(group);
    this.tanks.push({ tank, group, turret });
  }

  removeTank(tank: Tank) {
    const i = this.tanks.findIndex((t) => t.tank === tank);
    if (i < 0) return;
    this.scene.remove(this.tanks[i].group);
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

  drainShots() {
    for (const s of this.sim.shots) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s.from.x, s.from.y, s.from.z),
        new THREE.Vector3(s.to.x, s.to.y, s.to.z),
      ]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: s.hit ? 0xff7b3a : 0xfff2a8, transparent: true }));
      this.scene.add(line);
      this.tracers.push({ line, life: 0.35 });
    }
    this.sim.shots.length = 0;
  }

  render(alpha: number, dt: number, follow: Tank) {
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
      tv.turret.rotation.y = t.prevTurret + (t.turretYaw - t.prevTurret) * alpha;
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
      (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.life / 0.35);
      if (tr.life <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }

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

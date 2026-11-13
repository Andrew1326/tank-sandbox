import * as THREE from 'three';

// All art is drawn here at start-up; there are no image files.

function canvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(cv);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Repeatable pseudo-random so the world looks the same every load.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function speckle(g: CanvasRenderingContext2D, s: number, r: () => number, count: number, dark: string, light: string, max = 3) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = r() < 0.5 ? dark : light;
    const d = 0.5 + r() * max;
    g.fillRect(r() * s, r() * s, d, d);
  }
}

function blotches(g: CanvasRenderingContext2D, s: number, r: () => number, count: number, color: string, size: number) {
  for (let i = 0; i < count; i++) {
    const x = r() * s, y = r() * s, rad = size * (0.4 + r());
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    // draw wrapped so the tile has no seams
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { g.setTransform(1, 0, 0, 1, ox, oy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}

// One tile = 8 m of poured concrete slabs with stains, cracks and tyre-black smears.
export const groundTex = () => canvas(1024, (g, s) => {
  const r = rng(11);
  g.fillStyle = '#8b8d86'; g.fillRect(0, 0, s, s);
  blotches(g, s, r, 26, 'rgba(60,58,50,0.20)', 170);
  blotches(g, s, r, 18, 'rgba(190,190,176,0.16)', 150);
  blotches(g, s, r, 9, 'rgba(92,104,70,0.22)', 120); // moss creeping in
  speckle(g, s, r, 9000, 'rgba(40,40,36,0.16)', 'rgba(230,230,220,0.12)');
  g.strokeStyle = 'rgba(40,40,38,0.55)'; g.lineWidth = 4;
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * s / 2, 0); g.lineTo(i * s / 2, s); g.moveTo(0, i * s / 2); g.lineTo(s, i * s / 2); g.stroke(); }
  g.strokeStyle = 'rgba(30,30,28,0.5)'; g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    let x = r() * s, y = r() * s;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 9; k++) { x += (r() - 0.5) * 70; y += (r() - 0.3) * 60; g.lineTo(x, y); }
    g.stroke();
  }
});

// The test range keeps a metre grid on top of the same concrete.
export const gridTex = () => canvas(1024, (g, s) => {
  const r = rng(5);
  g.fillStyle = '#868d96'; g.fillRect(0, 0, s, s);
  speckle(g, s, r, 5000, 'rgba(40,40,40,0.10)', 'rgba(255,255,255,0.08)');
  const cell = s / 10;
  for (let i = 0; i <= 10; i++) {
    const major = i % 5 === 0;
    g.strokeStyle = major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
    g.lineWidth = major ? 5 : 2;
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, s); g.moveTo(0, i * cell); g.lineTo(s, i * cell); g.stroke();
  }
});

// Precast wall panels, 4 m per tile, with rust streaks running down from the top.
export const wallTex = () => canvas(512, (g, s) => {
  const r = rng(23);
  g.fillStyle = '#9a9c97'; g.fillRect(0, 0, s, s);
  blotches(g, s, r, 12, 'rgba(70,70,64,0.22)', 110);
  speckle(g, s, r, 4000, 'rgba(50,50,46,0.16)', 'rgba(240,240,232,0.12)');
  for (let i = 0; i < 14; i++) {
    const x = r() * s, len = 60 + r() * 220;
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(110,68,40,0.38)'); grad.addColorStop(1, 'rgba(110,68,40,0)');
    g.fillStyle = grad; g.fillRect(x, 0, 3 + r() * 9, len);
  }
  g.strokeStyle = 'rgba(40,40,38,0.7)'; g.lineWidth = 5;
  g.strokeRect(0, 0, s, s);
  g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
  g.fillStyle = 'rgba(30,30,28,0.6)';
  for (const x of [s * 0.08, s * 0.42, s * 0.58, s * 0.92]) for (const y of [s * 0.1, s * 0.9]) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
});

// Raised decks: riveted steel plate, 2 m per tile.
export const deckTex = () => canvas(512, (g, s) => {
  const r = rng(31);
  g.fillStyle = '#5d646c'; g.fillRect(0, 0, s, s);
  blotches(g, s, r, 10, 'rgba(110,70,40,0.22)', 90);
  speckle(g, s, r, 3000, 'rgba(20,20,20,0.2)', 'rgba(220,230,240,0.14)');
  g.strokeStyle = 'rgba(20,22,26,0.8)'; g.lineWidth = 4; g.strokeRect(0, 0, s, s);
  g.fillStyle = 'rgba(200,210,220,0.35)';
  for (let i = 0; i < 8; i++) for (const e of [14, s - 14]) { g.beginPath(); g.arc(30 + i * 64, e, 4, 0, 7); g.arc(e, 30 + i * 64, 4, 0, 7); g.fill(); }
});

// Ramps: non-slip plate with wear in the wheel lines and a hazard edge.
export const rampTex = () => canvas(512, (g, s) => {
  const r = rng(41);
  g.fillStyle = '#7b8572'; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(30,34,28,0.55)'; g.lineWidth = 6;
  for (let y = -s; y < s * 2; y += 44) { g.beginPath(); g.moveTo(0, y); g.lineTo(s / 2, y + 36); g.lineTo(s, y); g.stroke(); }
  blotches(g, s, r, 8, 'rgba(210,210,200,0.2)', 100);
  speckle(g, s, r, 2500, 'rgba(20,20,20,0.2)', 'rgba(240,240,230,0.14)');
  for (let x = 0; x < s; x += 48) { g.fillStyle = (x / 48) % 2 ? '#e0b22c' : '#22231f'; g.fillRect(x, 0, 48, 20); }
});

// Cover blocks: stacked shipping-crate planking with stencilled stripes.
export const coverTex = () => canvas(512, (g, s) => {
  const r = rng(53);
  g.fillStyle = '#4d5660'; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 32) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.07})`; g.fillRect(x, 0, 30, s); g.fillStyle = 'rgba(15,18,22,0.55)'; g.fillRect(x + 30, 0, 2, s); }
  blotches(g, s, r, 10, 'rgba(120,74,44,0.25)', 80);
  speckle(g, s, r, 2500, 'rgba(10,10,10,0.2)', 'rgba(230,236,244,0.12)');
  g.fillStyle = 'rgba(235,238,240,0.5)'; g.fillRect(0, s * 0.42, s, 26);
  g.strokeStyle = 'rgba(15,18,22,0.85)'; g.lineWidth = 8; g.strokeRect(0, 0, s, s);
});

export const crateTex = () => canvas(256, (g, s) => {
  const r = rng(61);
  g.fillStyle = '#b08a4a'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 42) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.1})`; g.fillRect(0, y, s, 40); g.fillStyle = 'rgba(40,24,8,0.6)'; g.fillRect(0, y + 40, s, 2); }
  g.strokeStyle = '#6e5226'; g.lineWidth = 22; g.strokeRect(11, 11, s - 22, s - 22);
  g.beginPath(); g.moveTo(20, 20); g.lineTo(s - 20, s - 20); g.stroke();
  speckle(g, s, r, 900, 'rgba(30,18,6,0.25)', 'rgba(255,240,200,0.12)');
});

// Track belt: one tile = a few links; scrolled along its length as the tank moves.
export const treadTex = () => canvas(128, (g, s) => {
  g.fillStyle = '#191b1e'; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 32) {
    g.fillStyle = '#2c3036'; g.fillRect(x + 4, 6, 22, s - 12);
    g.fillStyle = '#0c0d0f'; g.fillRect(x + 26, 0, 6, s);
    g.fillStyle = '#3e444c'; g.fillRect(x + 6, s / 2 - 8, 18, 16);
  }
}, true);

// Camouflage over a team colour: darker and lighter islands plus grime.
export function camoTex(color: number, seed: number): THREE.CanvasTexture {
  return canvas(256, (g, s) => {
    const r = rng(seed);
    const c = new THREE.Color(color);
    const css = (k: number, add = 0) => `rgb(${Math.min(255, c.r * 255 * k + add) | 0},${Math.min(255, c.g * 255 * k + add) | 0},${Math.min(255, c.b * 255 * k + add) | 0})`;
    g.fillStyle = css(1); g.fillRect(0, 0, s, s);
    for (const [shade, n] of [[css(0.72), 9], [css(1.08, 22), 7], [css(0.55), 4]] as [string, number][]) {
      g.fillStyle = shade;
      for (let i = 0; i < n; i++) {
        const x = r() * s, y = r() * s;
        for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
          g.beginPath();
          for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, rad = 18 + r() * 34; g.lineTo(x + ox + Math.cos(a) * rad * 1.5, y + oy + Math.sin(a) * rad); }
          g.closePath(); g.fill();
        }
      }
    }
    speckle(g, s, r, 1400, 'rgba(0,0,0,0.16)', 'rgba(255,255,255,0.07)', 2);
  });
}

// Soft round puff used for every smoke, dust and fire particle.
export const puffTex = () => canvas(64, (g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
}, false);

// Sky: deep blue overhead fading to haze at the horizon, with drifting cloud banks.
export const skyTex = () => {
  const cv = document.createElement('canvas');
  cv.width = 2048; cv.height = 1024;
  const g = cv.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, '#2a66ad'); grad.addColorStop(0.3, '#5d9bd6'); grad.addColorStop(0.46, '#9cc6e6'); grad.addColorStop(0.5, '#c8dcea'); grad.addColorStop(0.52, '#c9cfc9'); grad.addColorStop(1, '#8d928c');
  g.fillStyle = grad; g.fillRect(0, 0, 2048, 1024);
  const r = rng(7);
  for (let i = 0; i < 46; i++) {
    const x = r() * 2048, y = 250 + r() * 240, w = 90 + r() * 240;
    for (let k = 0; k < 14; k++) {
      const px = x + (r() - 0.5) * w * 1.6, py = y + (r() - 0.5) * w * 0.22, rad = w * (0.18 + r() * 0.3);
      for (const ox of [-2048, 0, 2048]) {
        const c = g.createRadialGradient(px + ox, py, 0, px + ox, py, rad);
        c.addColorStop(0, 'rgba(255,255,255,0.34)'); c.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = c; g.fillRect(px + ox - rad, py - rad, rad * 2, rad * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

// Box whose texture coordinates are in metres, so one material tiles evenly over boxes of any size.
export function metricBox(w: number, h: number, l: number, tile: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, l);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[l, h], [l, h], [w, l], [w, l], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[face][0]) / tile, (uv.getY(k) * dims[face][1]) / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

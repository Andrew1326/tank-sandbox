import GUI from 'lil-gui';
import { SimWorld, STEP } from './sim/world';
import { HULLS, HullParams, defaultSim } from './sim/params';
import { Tank, TankInput, noInput } from './sim/tank';
import { SPAWN, addCrates, addTargets } from './sim/setup';
import { View } from './render/view';
import { NetClient } from './net/client';
import { NET_PORT } from './net/protocol';

const STORE = 'tank-sandbox-v11';
const query = new URLSearchParams(location.search);
const online = query.has('online');
const COLORS = { me: 0x2f9e8f, player: 0x3a78c9, bot: 0xb5653a };

const sim = await SimWorld.create();
const view = new View(document.getElementById('c') as HTMLCanvasElement, sim);
const hud = document.getElementById('hud')!;

// Working copies so the sliders never touch the presets.
const hulls: Record<string, HullParams> = Object.fromEntries(Object.entries(HULLS).map(([k, v]) => [k, { ...v }]));
const state = { hull: 'Dart', lag: 0, name: '' };
try { state.name = localStorage.getItem('tank-name') ?? ''; } catch { /* ignore */ }
if (query.get('name')) state.name = query.get('name')!;
let feed = '';
let feedUntil = 0;
const nameOf = (id: number) => net?.score.find((r) => r.id === id)?.name ?? (sim.tanks.find((t) => t.id === id)?.bot ? 'target' : `tank ${id}`);
function onKills(kills: { by: number; victim: number; at: { x: number; y: number; z: number } }[]) {
  for (const k of kills) {
    view.explode(k.at);
    feed = `${nameOf(k.by)} destroyed ${nameOf(k.victim)}`;
    feedUntil = performance.now() + 4000;
  }
}
if (!online) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (saved) {
      Object.assign(sim.params, saved.sim);
      for (const k of Object.keys(hulls)) Object.assign(hulls[k], saved.hulls?.[k]);
      if (hulls[saved.hull]) state.hull = saved.hull;
    }
  } catch { /* start from defaults */ }
}
let tuneTimer = 0;
const save = () => {
  if (online) {
    // The server owns the numbers; push our edits to it.
    clearTimeout(tuneTimer);
    tuneTimer = window.setTimeout(() => net?.tune(), 120);
    return;
  }
  try { localStorage.setItem(STORE, JSON.stringify({ sim: sim.params, hulls, hull: state.hull })); } catch { /* ignore */ }
};

let player: Tank | null = null;
let net: NetClient | null = null;
let targets: Tank[] = [];

if (online) {
  net = new NetClient(`ws://${location.hostname}:${NET_PORT}`, sim, hulls, {
    onAdd: (t) => {
      const mine = t.id === net!.id;
      view.addTank(t, mine ? COLORS.me : t.bot ? COLORS.bot : COLORS.player);
      if (mine) { player = t; state.hull = t.hull.name; buildHullFolder(); resetMeters(); gui.controllersRecursive().forEach((c) => c.updateDisplay()); }
    },
    onRemove: (t) => { view.removeTank(t); if (t === player) player = null; },
    onCrate: (c) => view.addCrate(c),
    onShots: (s) => view.showShots(s),
    onKills,
    onTune: () => gui.controllersRecursive().forEach((c) => c.updateDisplay()),
    before: () => view.beginCorrection(),
    after: () => view.endCorrection(),
  }, state.hull, state.name);
} else {
  player = sim.addTank(hulls[state.hull], SPAWN, 0);
  view.addTank(player, COLORS.me);
  targets = addTargets(sim, hulls);
  targets.forEach((t) => view.addTank(t, COLORS.bot));
  addCrates(sim).forEach((c) => view.addCrate(c));
}

function resetTargets() {
  if (net) { net.command('targets'); return; }
  for (const d of targets) { view.removeTank(d); sim.removeTank(d); }
  targets = addTargets(sim, hulls);
  targets.forEach((t) => view.addTank(t, COLORS.bot));
}

function swapHull(name: string) {
  if (net) { net.setHull(name); return; }
  if (!player) return;
  const p = player.body.translation();
  view.removeTank(player);
  sim.removeTank(player);
  player = sim.addTank(hulls[name], { x: p.x, y: p.y + 0.6, z: p.z }, 0);
  view.addTank(player, COLORS.me);
  buildHullFolder();
  resetMeters();
  save();
}

// --- controls ---
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyR') { if (net) net.command('upright'); else player?.upright(); }
  if (e.code === 'KeyT') { if (net) net.command('respawn'); else player?.place(SPAWN, 0); resetMeters(); }
  if (e.code === 'KeyV') view.showRays = !view.showRays;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const axis = (pos: string[], neg: string[]) => (pos.some((k) => keys.has(k)) ? 1 : 0) - (neg.some((k) => keys.has(k)) ? 1 : 0);
function readInput(): TankInput {
  return {
    throttle: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
    steer: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
    turret: axis(['KeyZ', 'Comma'], ['KeyX', 'Period']),
    center: keys.has('KeyC') || keys.has('Slash'),
    fire: keys.has('Space'),
    boost: keys.has('Digit4') || keys.has('Numpad4'),
  };
}

// --- meters ---
const meter = { accelT: NaN, stopT: NaN, stopD: NaN, airT: NaN, peakYaw: 0, peakSpeed: 0 };
let accelStart = -1, stopStart = -1, stopFrom = 0, airStart = -1, lastThrottle = 0, odo = 0, clock = 0;
function resetMeters() {
  Object.assign(meter, { accelT: NaN, stopT: NaN, stopD: NaN, airT: NaN, peakYaw: 0, peakSpeed: 0 });
  accelStart = stopStart = airStart = -1;
}
function updateMeters(input: TankInput) {
  clock += STEP;
  if (!player) return;
  const v = Math.abs(player.forwardSpeed);
  const top = player.hull.topSpeed;
  odo += v * STEP;
  if (input.throttle !== 0 && lastThrottle === 0 && v < 0.3) accelStart = clock;
  if (accelStart >= 0 && v >= 0.95 * top) { meter.accelT = clock - accelStart; accelStart = -1; }
  if (input.throttle === 0 && lastThrottle !== 0) {
    accelStart = -1;
    if (v > 0.9 * top) { stopStart = clock; stopFrom = odo; }
  }
  if (stopStart >= 0 && input.throttle !== 0) stopStart = -1;
  if (stopStart >= 0 && v < 0.15) { meter.stopT = clock - stopStart; meter.stopD = odo - stopFrom; stopStart = -1; }
  if (player.grounded === 0 && airStart < 0) airStart = clock;
  if (player.grounded > 0 && airStart >= 0) {
    const t = clock - airStart;
    if (t > 0.15) meter.airT = t;
    airStart = -1;
  }
  meter.peakYaw = Math.max(meter.peakYaw, Math.abs(player.yawRate));
  meter.peakSpeed = Math.max(meter.peakSpeed, v);
  lastThrottle = input.throttle;
}
const f = (x: number, d = 2, unit = '') => (Number.isFinite(x) ? x.toFixed(d) + unit : '–');
function drawHud() {
  let netLine = '';
  if (net) {
    netLine = net.connected
      ? `ONLINE  ${net.players} player${net.players === 1 ? '' : 's'} · ping ${f(net.ping, 0)} ms\n` +
        `replay ${net.replaySteps} ticks · fix ${f(net.correction * 100, 1)} cm (worst ${f(net.worstCorrection * 100, 0)})\n`
      : `OFFLINE – no server on port ${NET_PORT} (npm run server)\n`;
  }
  if (net && net.score.length) {
    netLine += [...net.score].sort((a, b) => b.k - a.k).map((r) => `${r.id === net!.id ? '›' : ' '} ${r.name.padEnd(16)} ${String(r.k).padStart(2)} / ${r.d}`).join('\n') + '\n';
  }
  if (performance.now() < feedUntil) netLine += `✹ ${feed}\n`;
  if (!player) { hud.textContent = netLine + 'waiting for a tank…'; return; }
  const q = player.body.rotation();
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.x - q.y * q.z)))) * 57.2958;
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.x * q.x + q.z * q.z)) * 57.2958;
  const p = player.body.translation();
  hud.textContent =
    netLine +
    `${player.hull.name}   ${player.dead > 0 ? `DESTROYED – back in ${player.dead.toFixed(1)} s` : `HP ${Math.ceil(player.hp)} / ${player.hull.hp}`}${player.shield > 0 ? '   shielded' : ''}\n` +
    `speed    ${f(player.forwardSpeed, 2)} m/s   (top ${player.hull.topSpeed})${player.boostLeft > 0 ? `   BOOST ${player.boostLeft.toFixed(0)} s` : ''}\n` +
    `side     ${f(player.sideSpeed, 2)} m/s\n` +
    `yaw rate ${f(player.yawRate, 0)} °/s\n` +
    `pitch ${f(pitch, 1)}°  roll ${f(roll, 1)}°  slope ${f(player.slopeDeg, 0)}°\n` +
    `tracks   ${player.grounded}/${sim.params.raysPerSide * 2} touching\n` +
    `position ${f(-p.z, 1)} m down the straight\n` +
    `─────────────\n` +
    `0 → 95 % top   ${f(meter.accelT, 2, ' s')}\n` +
    `coast to stop  ${f(meter.stopT, 2, ' s')}  ${f(meter.stopD, 1, ' m')}\n` +
    `last air time  ${f(meter.airT, 2, ' s')}\n` +
    `peak speed ${f(meter.peakSpeed, 2)}  peak yaw ${f(meter.peakYaw, 0)}`;
}

// --- tuning panel ---
const gui = new GUI({ title: online ? 'Tuning (shared with server)' : 'Tuning', width: 300 });
gui.add(state, 'hull', Object.keys(hulls)).name('Hull').onChange(swapHull).listen();
if (online) {
  gui.add(state, 'name').name('Name (reload to apply)').onFinishChange((v: string) => { try { localStorage.setItem('tank-name', v); } catch { /* ignore */ } });
  gui.add(state, 'lag', 0, 300, 5).name('Fake lag, ms each way').onChange((v: number) => { if (net) net.lagMs = v; });
}
let hullFolder: GUI | null = null;
function buildHullFolder() {
  hullFolder?.destroy();
  const h = hulls[state.hull];
  const remass = () => sim.tanks.forEach((t) => t.applyMass());
  const fo = gui.addFolder('Hull handling');
  hullFolder = fo;
  fo.add(h, 'topSpeed', 2, 20, 0.1).name('Top speed m/s');
  fo.add(h, 'accel', 2, 30, 0.1).name('Acceleration');
  fo.add(h, 'reverseAccel', 2, 40, 0.1).name('Braking (opposite key)');
  fo.add(h, 'coastDecel', 0, 30, 0.1).name('Coast decel (no key)');
  fo.add(h, 'lateralAccel', 0, 40, 0.1).name('Side grip');
  fo.add(h, 'turnSpeed', 20, 220, 1).name('Turn speed °/s');
  fo.add(h, 'turnAccel', 20, 600, 1).name('Turn accel');
  fo.add(h, 'antiTurnAccel', 20, 900, 1).name('Turn stop accel');
  fo.add(h, 'mass', 500, 8000, 50).name('Mass kg').onChange(remass);
  fo.add(h, 'comY', -0.5, 0.5, 0.01).name('Centre of mass height').onChange(remass);
  fo.add(h, 'stability', 0.5, 8, 0.1).name('Tip resistance ×').onChange(remass);
  fo.add(h, 'hp', 20, 1000, 10).name('Health');
  fo.onChange(save);
  if (online) fo.close();
}
buildHullFolder();
const P = sim.params;
const susp = gui.addFolder('Suspension & grip');
susp.add(P, 'suspFreq', 0.8, 5, 0.05).name('Bounce frequency Hz');
susp.add(P, 'suspDamping', 0.05, 1.5, 0.01).name('Damping ratio');
susp.add(P, 'clearance', 0.05, 0.8, 0.01).name('Ride height m');
susp.add(P, 'droop', 0.02, 0.6, 0.01).name('Droop travel m');
susp.add(P, 'raysPerSide', 2, 8, 1).name('Support points per side');
susp.add(P, 'driveHeight', 0, 1, 0.01).name('Squat on throttle');
susp.add(P, 'sideHeight', 0, 1, 0.01).name('Lean in turns');
susp.add(P, 'gripFullDeg', 10, 80, 1).name('Full grip up to °');
susp.add(P, 'gripZeroDeg', 15, 89, 1).name('No grip beyond °');
susp.add(P, 'angularDamping', 0, 3, 0.05).name('Spin damping');
susp.add(P, 'gravity', 3, 30, 0.1).name('Gravity');
susp.add(P, 'invertSteerInReverse').name('Flip steering in reverse');
const gun = gui.addFolder('Turret & gun');
gun.add(P, 'turretSpeed', 20, 250, 1).name('Turret speed °/s');
gun.add(P, 'turretAccel', 50, 1500, 10).name('Turret accel');
gun.add(P, 'impact', 0, 40000, 100).name('Impact on target N·s');
gun.add(P, 'recoil', 0, 40000, 100).name('Recoil on shooter N·s');
gun.add(P, 'impactShove', 0, 1, 0.05).name('Hit shoves the target (0–1)');
gun.add(P, 'impactTilt', 0, 1, 0.05).name('Hit rocks the target (0–1)');
gun.add(P, 'autoAimUp', 0, 25, 1).name('Auto-aim up °');
gun.add(P, 'autoAimDown', 0, 25, 1).name('Auto-aim down °');
gun.add(P, 'damage', 0, 400, 5).name('Damage per hit');
gun.add(P, 'respawnTime', 0.5, 15, 0.5).name('Respawn after s');
gun.add(P, 'spawnShield', 0, 10, 0.5).name('Spawn protection s');
gun.add(P, 'fireDelay', 0, 2, 0.05).name('Delay before shot s');
gun.add(P, 'reload', 0.1, 8, 0.1).name('Reload s');
const boost = gui.addFolder('Speed boost (key 4)');
boost.add(P, 'boostSpeed', 1, 2.5, 0.05).name('Top speed ×');
boost.add(P, 'boostAccel', 1, 2.5, 0.05).name('Acceleration ×');
boost.add(P, 'boostTime', 1, 120, 1).name('Duration s');
const hit = gui.addFolder('Collisions');
hit.add(P, 'pushHold', 0, 15, 0.1).name('Parked tank holds m/s²');
hit.add(P, 'pushDrag', 0, 10, 0.1).name('Push drag (slower = higher)');
hit.add(P, 'shoveAbsorb', 0, 1, 0.05).name('Shove absorbed (0–1)');
hit.add(P, 'shoveThreshold', 0.2, 6, 0.1).name('Only jolts above m/s');
const cam = gui.addFolder('Camera');
cam.add(view, 'camDist', 4, 25, 0.5).name('Distance');
cam.add(view, 'camHeight', 1, 20, 0.5).name('Height');
cam.add(view, 'showRays').name('Show suspension').listen();
cam.close();
if (online) { susp.close(); gun.close(); boost.close(); hit.close(); }
gui.onChange(save);
if (innerWidth < 700) gui.close();
gui.add({ go: resetTargets }, 'go').name('Reset target tanks');
gui.add({ go: () => { navigator.clipboard?.writeText(JSON.stringify({ sim: sim.params, hulls }, null, 2)); } }, 'go').name('Copy settings as JSON');
gui.add({
  go: () => {
    Object.assign(sim.params, defaultSim());
    for (const k of Object.keys(hulls)) Object.assign(hulls[k], HULLS[k]);
    sim.tanks.forEach((t) => t.applyMass());
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    save();
  },
}, 'go').name('Restore defaults');

// --- loop ---
let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  net?.sync();
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    const input = readInput();
    if (net) {
      if (net.id) {
        net.sendInput(input);
        if (player) player.input = input;
        sim.step();
        // Other players' shots arrive from the server; only ours are shown from the prediction.
        const mine = sim.shots.filter((s) => s.by === net!.id);
        sim.shots.length = 0;
        sim.kills.length = 0; // kills are announced by the server
        view.showShots(mine);
      }
    } else {
      if (player) player.input = input;
      sim.step();
    }
    updateMeters(input);
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0;
  if (sim.kills.length) { onKills(sim.kills); sim.kills.length = 0; }
  if (net) for (const r of net.score) { const t = sim.tanks.find((x) => x.id === r.id); if (t) view.setName(t, r.id === net.id ? '' : r.name); }
  view.drainShots();
  view.render(acc / STEP, dt, player);
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the sim from the console.
Object.assign(window as object, { sim, view, net, getPlayer: () => player, noInput });

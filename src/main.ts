import GUI from 'lil-gui';
import { SimWorld, STEP } from './sim/world';
import { HULLS, HullParams, defaultSim } from './sim/params';
import { Tank, TankInput, noInput } from './sim/tank';
import { View } from './render/view';

const SPAWN = { x: 0, y: 1.2, z: 6 };
const STORE = 'tank-sandbox-v8';

const sim = await SimWorld.create();
const view = new View(document.getElementById('c') as HTMLCanvasElement, sim);
const hud = document.getElementById('hud')!;

// Working copies so the sliders never touch the presets.
const hulls: Record<string, HullParams> = Object.fromEntries(Object.entries(HULLS).map(([k, v]) => [k, { ...v }]));
const state = { hull: 'Dart' };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  if (saved) {
    Object.assign(sim.params, saved.sim);
    for (const k of Object.keys(hulls)) Object.assign(hulls[k], saved.hulls?.[k]);
    if (hulls[saved.hull]) state.hull = saved.hull;
  }
} catch { /* start from defaults */ }
const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify({ sim: sim.params, hulls, hull: state.hull })); } catch { /* ignore */ }
};

let player: Tank = sim.addTank(hulls[state.hull], SPAWN, 0);
view.addTank(player, 0x2f9e8f);

const dummies: Tank[] = [];
function spawnDummies() {
  for (const d of dummies) { view.removeTank(d); sim.removeTank(d); }
  dummies.length = 0;
  const spots: [string, number, number, number][] = [
    ['Dart', -9.5, -15, 90], ['Ranger', -9.5, -25, 90], ['Anvil', -9.5, -35, 90],
  ];
  for (const [name, x, z, yaw] of spots) {
    const d = sim.addTank(hulls[name], { x, y: 1.2, z }, yaw);
    view.addTank(d, 0xb5653a);
    dummies.push(d);
  }
}
spawnDummies();
for (let i = 0; i < 6; i++) view.addCrate(sim.addCrate({ x: -14 + (i % 3) * 1.3, y: 0.6 + Math.floor(i / 3) * 1.2, z: -2 }, 0.6, 250));

function swapHull(name: string) {
  const p = player.body.translation();
  view.removeTank(player);
  sim.removeTank(player);
  // The player must stay first so input index 0 drives it.
  player = sim.addTank(hulls[name], { x: p.x, y: p.y + 0.6, z: p.z }, 0);
  sim.tanks.unshift(sim.tanks.pop()!);
  view.addTank(player, 0x2f9e8f);
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
  if (e.code === 'KeyR') player.upright();
  if (e.code === 'KeyT') { player.place(SPAWN, 0); resetMeters(); }
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
let accelStart = -1, stopStart = -1, stopFrom = 0, airStart = -1, lastThrottle = 0, odo = 0;
function resetMeters() {
  Object.assign(meter, { accelT: NaN, stopT: NaN, stopD: NaN, airT: NaN, peakYaw: 0, peakSpeed: 0 });
  accelStart = stopStart = airStart = -1;
}
function updateMeters(input: TankInput) {
  const v = Math.abs(player.forwardSpeed);
  const top = player.hull.topSpeed;
  odo += v * STEP;
  if (input.throttle !== 0 && lastThrottle === 0 && v < 0.3) accelStart = sim.time;
  if (accelStart >= 0 && v >= 0.95 * top) { meter.accelT = sim.time - accelStart; accelStart = -1; }
  if (input.throttle === 0 && lastThrottle !== 0) {
    accelStart = -1;
    if (v > 0.9 * top) { stopStart = sim.time; stopFrom = odo; }
  }
  if (stopStart >= 0 && input.throttle !== 0) stopStart = -1;
  if (stopStart >= 0 && v < 0.15) { meter.stopT = sim.time - stopStart; meter.stopD = odo - stopFrom; stopStart = -1; }
  if (player.grounded === 0 && airStart < 0) airStart = sim.time;
  if (player.grounded > 0 && airStart >= 0) {
    const t = sim.time - airStart;
    if (t > 0.15) meter.airT = t;
    airStart = -1;
  }
  meter.peakYaw = Math.max(meter.peakYaw, Math.abs(player.yawRate));
  meter.peakSpeed = Math.max(meter.peakSpeed, v);
  lastThrottle = input.throttle;
}
const f = (x: number, d = 2, unit = '') => (Number.isFinite(x) ? x.toFixed(d) + unit : '–');
function drawHud() {
  const q = player.body.rotation();
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.x - q.y * q.z)))) * 57.2958;
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.x * q.x + q.z * q.z)) * 57.2958;
  const p = player.body.translation();
  hud.textContent =
    `${player.hull.name}   mass ${player.hull.mass} kg\n` +
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
const gui = new GUI({ title: 'Tuning', width: 300 });
gui.add(state, 'hull', Object.keys(hulls)).name('Hull').onChange(swapHull);
let hullFolder: GUI | null = null;
function buildHullFolder() {
  hullFolder?.destroy();
  const h = hulls[state.hull];
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
  fo.add(h, 'mass', 500, 8000, 50).name('Mass kg').onChange(() => player.applyMass());
  fo.add(h, 'comY', -0.5, 0.5, 0.01).name('Centre of mass height').onChange(() => player.applyMass());
  fo.add(h, 'stability', 0.5, 8, 0.1).name('Tip resistance ×').onChange(() => player.applyMass());
  fo.onChange(save);
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
gun.add(P, 'autoAimUp', 0, 25, 1).name('Auto-aim up °');
gun.add(P, 'autoAimDown', 0, 25, 1).name('Auto-aim down °');
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
gui.onChange(save);
if (innerWidth < 700) gui.close();
gui.add({ go: () => { spawnDummies(); } }, 'go').name('Reset target tanks');
gui.add({ go: () => { navigator.clipboard?.writeText(JSON.stringify({ sim: sim.params, hulls }, null, 2)); } }, 'go').name('Copy settings as JSON');
gui.add({
  go: () => {
    Object.assign(sim.params, defaultSim());
    for (const k of Object.keys(hulls)) Object.assign(hulls[k], HULLS[k]);
    player.applyMass();
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
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    const input = readInput();
    sim.step([input]);
    updateMeters(input);
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0;
  view.drainShots();
  view.render(acc / STEP, dt, player);
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the sim from the console.
Object.assign(window as object, { sim, view, getPlayer: () => player, noInput });

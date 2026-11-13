// Headless check of slopes, ledges and gun impulses.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
const drive = (idx: number, seconds: number, input: object, each?: () => void) => {
  for (let i = 0; i < seconds / STEP; i++) {
    const inputs: any[] = [];
    inputs[idx] = { ...noInput(), ...input };
    sim.step(inputs);
    each?.();
  }
};
const tiltOf = (t: any) => {
  const q = t.body.rotation();
  return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 57.3;
};

for (const name of Object.keys(HULLS)) {
  const out: string[] = [];
  [10, 20, 30, 40, 50].forEach((angle, i) => {
    const t = sim.addTank({ ...HULLS[name] }, { x: 22 + i * 9, y: 1.2, z: 0 }, 0);
    const idx = sim.tanks.indexOf(t);
    drive(idx, 1, {});
    let maxY = 0, maxTilt = 0;
    drive(idx, 6, { throttle: 1 }, () => { maxY = Math.max(maxY, t.body.translation().y); maxTilt = Math.max(maxTilt, tiltOf(t)); });
    const top = Math.sin((angle * Math.PI) / 180) * 12;
    out.push(`${angle}°:${maxY > top ? 'up' : 'no'}(y=${maxY.toFixed(1)}/${top.toFixed(1)}, tilt ${maxTilt.toFixed(0)}°)`);
    sim.removeTank(t);
  });
  console.log(name.padEnd(7), out.join('  '));
}

// Drive off the 4.1 m ledge at full speed and see how it lands.
for (const name of Object.keys(HULLS)) {
  const t = sim.addTank({ ...HULLS[name] }, { x: -34, y: 1.2, z: 0 }, 0);
  const idx = sim.tanks.indexOf(t);
  let air = 0, maxTilt = 0;
  drive(idx, 9, { throttle: 1 }, () => { if (t.grounded === 0) air += STEP; maxTilt = Math.max(maxTilt, tiltOf(t)); });
  drive(idx, 2, {});
  console.log(`${name.padEnd(7)} ledge: air ${air.toFixed(2)}s  max tilt ${maxTilt.toFixed(0)}°  final tilt ${tiltOf(t).toFixed(0)}°  z=${t.body.translation().z.toFixed(1)}`);
  sim.removeTank(t);
}

// Shoot each hull broadside from 15 m.
for (const name of Object.keys(HULLS)) {
  const shooter = sim.addTank({ ...HULLS.Ranger }, { x: 100, y: 1.2, z: 100 }, 0);
  const target = sim.addTank({ ...HULLS[name] }, { x: 100, y: 1.2, z: 85 }, 90);
  const si = sim.tanks.indexOf(shooter);
  drive(si, 1.5, {});
  let kick = 0, tgtSide = 0, tgtTilt = 0;
  drive(si, 0.1, { fire: true });
  drive(si, 1.5, {}, () => {
    kick = Math.max(kick, Math.abs(shooter.forwardSpeed));
    const v = target.body.linvel();
    tgtSide = Math.max(tgtSide, Math.hypot(v.x, v.z));
    tgtTilt = Math.max(tgtTilt, tiltOf(target));
  });
  console.log(`shot at ${name.padEnd(7)} shooter kick ${kick.toFixed(2)} m/s   target shove ${tgtSide.toFixed(2)} m/s  target tilt ${tgtTilt.toFixed(1)}°  final ${tiltOf(target).toFixed(1)}°`);
  sim.removeTank(shooter); sim.removeTank(target);
}

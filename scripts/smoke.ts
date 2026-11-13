// Headless check of the driving model: prints what the hull actually does.
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
for (const name of Object.keys(HULLS)) {
  const hull = { ...HULLS[name] };
  const t = sim.addTank(hull, { x: 0, y: 1.2, z: 0 }, 0);
  const idx = sim.tanks.indexOf(t);
  const run = (seconds: number, input: Partial<ReturnType<typeof noInput>>, each?: (time: number) => void) => {
    for (let i = 0; i < seconds / STEP; i++) {
      const inputs: any[] = [];
      inputs[idx] = { ...noInput(), ...input };
      sim.step(inputs);
      each?.((i + 1) * STEP);
    }
  };
  run(2, {});
  const rest = t.body.translation().y;
  let t95 = -1;
  run(4, { throttle: 1 }, (time) => { if (t95 < 0 && t.forwardSpeed >= 0.95 * hull.topSpeed) t95 = time; });
  const top = t.forwardSpeed;
  let stop = -1;
  const z0 = t.body.translation().z;
  run(4, {}, (time) => { if (stop < 0 && Math.abs(t.forwardSpeed) < 0.1) stop = time; });
  const stopDist = Math.abs(t.body.translation().z - z0);
  let peakYaw = 0;
  run(3, { steer: 1 }, () => { peakYaw = Math.max(peakYaw, t.yawRate); });
  const tilt = Math.acos(Math.min(1, 1 - 2 * (t.body.rotation().x ** 2 + t.body.rotation().z ** 2))) * 57.3;
  console.log(
    `${name.padEnd(7)} rest y=${rest.toFixed(3)} grounded=${t.grounded}  top=${top.toFixed(2)}/${hull.topSpeed} m/s  0-95%=${t95.toFixed(2)}s  ` +
      `stop=${stop.toFixed(2)}s over ${stopDist.toFixed(1)}m  yaw=${peakYaw.toFixed(0)}/${hull.turnSpeed} deg/s  tilt=${tilt.toFixed(1)}deg`,
  );
  sim.removeTank(t);
}

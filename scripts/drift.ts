// Full-speed turn with and without the boost: how far does the hull slide sideways?
import { SimWorld, STEP } from '../src/sim/world';
import { HULLS } from '../src/sim/params';
import { noInput } from '../src/sim/tank';

const sim = await SimWorld.create();
for (const name of Object.keys(HULLS)) {
  for (const boost of [false, true]) {
    const t = sim.addTank({ ...HULLS[name] }, { x: 100, y: 1.2, z: 100 }, 0);
    const idx = sim.tanks.indexOf(t);
    const run = (s: number, input: object, each?: () => void) => {
      for (let i = 0; i < s / STEP; i++) { const a: any[] = []; a[idx] = { ...noInput(), ...input }; sim.step(a); each?.(); }
    };
    run(1, { boost });
    run(3, { throttle: 1 });
    const top = t.forwardSpeed;
    let slide = 0;
    run(2, { throttle: 1, steer: 1 }, () => { slide = Math.max(slide, Math.abs(t.sideSpeed)); });
    console.log(`${name.padEnd(7)} ${boost ? 'boost' : 'plain'}  top ${top.toFixed(2)} m/s  peak side slip ${slide.toFixed(2)} m/s`);
    sim.removeTank(t);
  }
}

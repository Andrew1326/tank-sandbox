// Every sound is synthesised on the spot; there are no audio files.
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engine: { a: OscillatorNode; b: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private chargeOsc: { osc: OscillatorNode; gain: GainNode } | null = null;
  volume = 0.6;
  listener = { x: 0, z: 0, yaw: 0 };

  // Browsers only allow sound after a key press or click.
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'sawtooth'; b.type = 'square';
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 220;
    const gain = ctx.createGain(); gain.gain.value = 0;
    a.connect(filter); b.connect(filter); filter.connect(gain).connect(this.master);
    a.start(); b.start();
    this.engine = { a, b, gain, filter };
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  // Quieter with distance, panned by where it is relative to the camera.
  private place(x?: number, z?: number): AudioNode {
    const ctx = this.ctx!;
    if (x === undefined || z === undefined) return this.master;
    const dx = x - this.listener.x, dz = z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    const g = ctx.createGain();
    g.gain.value = 1 / (1 + (dist / 22) ** 2);
    const pan = ctx.createStereoPanner();
    const right = dx * Math.cos(this.listener.yaw) - dz * Math.sin(this.listener.yaw);
    pan.pan.value = Math.max(-0.8, Math.min(0.8, right / 30));
    g.connect(pan).connect(this.master);
    return g;
  }

  private burst(out: AudioNode, dur: number, vol: number, f0: number, f1: number, q = 0.7) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  private tone(out: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  shot(gun: string, x?: number, z?: number) {
    if (!this.ctx) return;
    const out = this.place(x, z);
    if (gun === 'Lance') {
      this.tone(out, 'sawtooth', 2400, 140, 0.45, 0.5);
      this.tone(out, 'sine', 160, 38, 0.5, 0.9);
      this.burst(out, 0.35, 0.5, 9000, 400);
    } else if (gun === 'Pulse') {
      this.tone(out, 'square', 900, 260, 0.09, 0.22);
      this.burst(out, 0.05, 0.15, 6000, 1500);
    } else {
      this.tone(out, 'sine', 130, 34, 0.32, 1.0);
      this.burst(out, 0.28, 0.8, 3200, 180);
      this.burst(out, 0.06, 0.6, 9000, 2000);
    }
  }

  hit(gun: string, x?: number, z?: number) {
    if (!this.ctx) return;
    const out = this.place(x, z);
    const v = gun === 'Pulse' ? 0.18 : 0.45;
    this.tone(out, 'triangle', 1900, 900, 0.09, v);
    this.tone(out, 'square', 640, 300, 0.12, v * 0.5);
    this.burst(out, 0.1, v, 7000, 900, 4);
  }

  explosion(x?: number, z?: number) {
    if (!this.ctx) return;
    const out = this.place(x, z);
    this.tone(out, 'sine', 90, 24, 1.0, 1.2);
    this.burst(out, 1.3, 1.1, 2400, 60);
    this.burst(out, 0.2, 0.9, 9000, 500);
  }

  jingle(kind: 'good' | 'bad' | 'neutral') {
    if (!this.ctx) return;
    const notes = kind === 'good' ? [523, 659, 784, 1047] : kind === 'bad' ? [392, 330, 262] : [587, 784];
    notes.forEach((f, i) => this.tone(this.master, 'triangle', f, f, 0.22, 0.25, i * 0.11));
  }

  // Own tank only: drone that rises with speed and throttle, plus the Lance wind-up.
  drive(speedRatio: number, throttle: number, charge: number, alive: boolean) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const f = 38 + Math.min(1.6, Math.abs(speedRatio)) * 58 + Math.abs(throttle) * 10;
    this.engine.a.frequency.setTargetAtTime(f, t, 0.08);
    this.engine.b.frequency.setTargetAtTime(f * 0.503, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(170 + Math.abs(speedRatio) * 420 + Math.abs(throttle) * 160, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(alive ? 0.07 + Math.abs(throttle) * 0.05 + Math.min(1, Math.abs(speedRatio)) * 0.04 : 0, t, 0.12);
    if (charge > 0 && !this.chargeOsc) {
      const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      osc.connect(gain).connect(this.master); osc.start();
      this.chargeOsc = { osc, gain };
    }
    if (this.chargeOsc) {
      this.chargeOsc.osc.frequency.setTargetAtTime(180 + charge * 900, t, 0.03);
      this.chargeOsc.gain.gain.setTargetAtTime(charge > 0 ? 0.05 + charge * 0.1 : 0, t, 0.03);
      if (charge <= 0) { const c = this.chargeOsc; this.chargeOsc = null; c.osc.stop(t + 0.2); }
    }
  }
}

import { clamp, rand } from './math';

type V3 = { x: number; y: number; z: number };

export type GunSound = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'dmr';
export type MechSound = 'magOut' | 'magIn' | 'bolt' | 'shell' | 'pump' | 'equip' | 'mode';
export type UiSound = 'tick' | 'open' | 'close' | 'select' | 'deny' | 'craft' | 'pickup' | 'objective' | 'radio';
export type VoiceKind = 'shambler' | 'runner' | 'bloater' | 'screamer' | 'brute';

/**
 * Fully procedural audio. Every sound is synthesised from oscillators and filtered noise so the
 * game ships without third-party sample licences. Positional sounds go through HRTF panners and a
 * shared convolution reverb sized for concrete hospital corridors.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private shaper!: WaveShaperNode;

  private droneGain: GainNode | null = null;
  private heartGain: GainNode | null = null;
  private heartTimer = 0;
  private heartRate = 0;
  private combatGain: GainNode | null = null;
  private combatTimer = 0;
  private combatLevel = 0;
  private ambientTimer = 4;
  private listenerPos: V3 = { x: 0, y: 0, z: 0 };

  volumes = { master: 0.8, sfx: 1, music: 0.6 };
  /** suppresses all scheduling (used when the simulation is fast-forwarded) */
  silent = false;
  /** end times of infected voices currently playing, for concurrency limiting */
  private voices: number[] = [];
  private lastImpact = 0;

  private get live() {
    return !!this.ctx && !this.silent;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.sfx);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 4);
    }
    this.shaper.curve = curve;

    this.applyVolumes();
    this.startDrone();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music, t, 0.05);
  }

  setPaused(paused: boolean) {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  setListener(pos: V3, fwd: V3) {
    if (!this.ctx) return;
    this.listenerPos = pos;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.01);
      l.positionY.setTargetAtTime(pos.y, t, 0.01);
      l.positionZ.setTargetAtTime(pos.z, t, 0.01);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.01);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.01);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // ---------------------------------------------------------------- building blocks

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections cluster + diffuse tail
        const early = i < ctx.sampleRate * 0.04 && Math.random() < 0.02 ? 1.6 : 0;
        ch[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  /** Returns an input node routed to output (spatialised if pos is given) plus reverb send. */
  private bus(pos?: V3, wet = 1, dry = 1): GainNode {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    let tail: AudioNode = input;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 2.2;
      p.rolloffFactor = 1.15;
      p.maxDistance = 80;
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      input.connect(p);
      tail = p;
      // occluded/distant sounds get muffled
      const dist = Math.hypot(pos.x - this.listenerPos.x, pos.z - this.listenerPos.z);
      if (dist > 10) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = clamp(14000 - dist * 260, 1200, 14000);
        p.connect(lp);
        tail = lp;
      }
    }
    const dryG = ctx.createGain();
    dryG.gain.value = dry;
    tail.connect(dryG);
    dryG.connect(this.sfx);
    const wetG = ctx.createGain();
    wetG.gain.value = wet;
    tail.connect(wetG);
    wetG.connect(this.reverbSend);
    return input;
  }

  private noiseSrc(dur: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const off = Math.random() * 1.5;
    s.start(ctx.currentTime, off, dur + 0.1);
    return s;
  }

  private env(g: GainNode, t: number, attack: number, peak: number, decay: number, curve = 0.3) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, decay * curve);
  }

  /** Filtered noise burst. */
  private burst(out: AudioNode, opts: { type: BiquadFilterType; freq: number; q?: number; gain: number; attack?: number; decay: number; delay?: number; freqEnd?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const dur = (opts.attack ?? 0.002) + opts.decay * 1.6;
    const src = this.noiseSrc(dur + (opts.delay ?? 0));
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.decay);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    this.env(g, t, opts.attack ?? 0.002, opts.gain, opts.decay);
    src.connect(f).connect(g).connect(out);
  }

  private tone(out: AudioNode, opts: { type: OscillatorType; f0: number; f1?: number; gain: number; attack?: number; decay: number; delay?: number; dur?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type;
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, t + (opts.dur ?? opts.decay));
    const g = ctx.createGain();
    this.env(g, t, opts.attack ?? 0.003, opts.gain, opts.decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + (opts.attack ?? 0.003) + opts.decay * 2 + 0.05);
  }

  // ---------------------------------------------------------------- weapons

  gunshot(kind: GunSound, pos?: V3, suppressedTail = false) {
    if (!this.live) return;
    const P: Record<GunSound, { body: number; crack: number; thump: number; decay: number; gain: number; low: number }> = {
      pistol: { body: 1700, crack: 5200, thump: 150, decay: 0.12, gain: 0.9, low: 0.6 },
      smg: { body: 1900, crack: 6000, thump: 140, decay: 0.09, gain: 0.75, low: 0.5 },
      rifle: { body: 1300, crack: 4800, thump: 110, decay: 0.16, gain: 1.0, low: 0.9 },
      shotgun: { body: 700, crack: 3200, thump: 80, decay: 0.28, gain: 1.15, low: 1.3 },
      dmr: { body: 1000, crack: 4200, thump: 90, decay: 0.24, gain: 1.15, low: 1.15 },
    };
    const p = P[kind];
    const out = this.bus(pos, suppressedTail ? 0.4 : 1.25, 1);
    const v = rand(0.92, 1.08);
    this.burst(out, { type: 'highpass', freq: p.crack * v, gain: p.gain * 0.55, decay: 0.025 });
    this.burst(out, { type: 'bandpass', freq: p.body * v, q: 0.7, gain: p.gain, decay: p.decay, freqEnd: p.body * 0.35 });
    this.burst(out, { type: 'lowpass', freq: 600, gain: p.gain * 0.6, decay: p.decay * 1.8, freqEnd: 120 });
    this.tone(out, { type: 'sine', f0: p.thump * 2.2, f1: p.thump * 0.4, gain: p.low, decay: 0.12, dur: 0.14 });
    // mechanical action
    this.burst(out, { type: 'bandpass', freq: 3200, q: 4, gain: 0.08, decay: 0.02, delay: 0.05 });
  }

  dryFire() {
    if (!this.live) return;
    const out = this.bus(undefined, 0.1);
    this.burst(out, { type: 'bandpass', freq: 2600, q: 6, gain: 0.35, decay: 0.015 });
    this.burst(out, { type: 'bandpass', freq: 1400, q: 5, gain: 0.2, decay: 0.02, delay: 0.03 });
  }

  mech(kind: MechSound) {
    if (!this.live) return;
    const out = this.bus(undefined, 0.15);
    switch (kind) {
      case 'magOut':
        this.burst(out, { type: 'bandpass', freq: 1800, q: 3, gain: 0.35, decay: 0.03 });
        this.burst(out, { type: 'bandpass', freq: 700, q: 2, gain: 0.25, decay: 0.06, delay: 0.04 });
        break;
      case 'magIn':
        this.burst(out, { type: 'bandpass', freq: 1200, q: 2.5, gain: 0.3, decay: 0.03 });
        this.burst(out, { type: 'bandpass', freq: 2600, q: 5, gain: 0.45, decay: 0.025, delay: 0.07 });
        break;
      case 'bolt':
        this.burst(out, { type: 'bandpass', freq: 2200, q: 4, gain: 0.4, decay: 0.03 });
        this.burst(out, { type: 'bandpass', freq: 3400, q: 6, gain: 0.5, decay: 0.03, delay: 0.12 });
        break;
      case 'shell':
        this.burst(out, { type: 'bandpass', freq: 1500, q: 3, gain: 0.3, decay: 0.04 });
        this.burst(out, { type: 'bandpass', freq: 900, q: 2, gain: 0.2, decay: 0.05, delay: 0.05 });
        break;
      case 'pump':
        this.burst(out, { type: 'bandpass', freq: 900, q: 1.5, gain: 0.45, decay: 0.07, freqEnd: 1600 });
        this.burst(out, { type: 'bandpass', freq: 1800, q: 2, gain: 0.5, decay: 0.06, delay: 0.16, freqEnd: 800 });
        break;
      case 'equip':
        this.burst(out, { type: 'bandpass', freq: 1100, q: 1.2, gain: 0.18, decay: 0.08, freqEnd: 2200 });
        this.burst(out, { type: 'bandpass', freq: 2400, q: 5, gain: 0.2, decay: 0.03, delay: 0.12 });
        break;
      case 'mode':
        this.burst(out, { type: 'bandpass', freq: 3000, q: 8, gain: 0.25, decay: 0.012 });
        break;
    }
  }

  swing() {
    if (!this.live) return;
    const out = this.bus(undefined, 0.1);
    this.burst(out, { type: 'bandpass', freq: 500, q: 1.5, gain: 0.35, attack: 0.06, decay: 0.12, freqEnd: 2000 });
  }

  impactFlesh(pos: V3, heavy = false) {
    if (!this.live) return;
    const out = this.bus(pos, 0.3);
    this.burst(out, { type: 'lowpass', freq: heavy ? 900 : 1300, gain: heavy ? 0.8 : 0.5, decay: 0.07, freqEnd: 200 });
    this.tone(out, { type: 'sine', f0: 120, f1: 60, gain: heavy ? 0.5 : 0.25, decay: 0.06 });
  }

  impactSurface(pos: V3, metal = false) {
    if (!this.live) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastImpact < 0.03) return;
    this.lastImpact = now;
    const out = this.bus(pos, 0.4, 0.6);
    if (metal) {
      this.tone(out, { type: 'triangle', f0: rand(1800, 2600), gain: 0.12, decay: 0.12 });
      this.burst(out, { type: 'highpass', freq: 4000, gain: 0.2, decay: 0.02 });
    } else {
      this.burst(out, { type: 'bandpass', freq: rand(2200, 3200), q: 1.5, gain: 0.3, decay: 0.03 });
    }
  }

  footstep(intensity: number, surface: 'concrete' | 'tile' | 'vinyl' = 'concrete') {
    if (!this.live) return;
    const out = this.bus(undefined, 0.12);
    const f = surface === 'tile' ? 2200 : surface === 'vinyl' ? 1200 : 900;
    this.burst(out, { type: 'bandpass', freq: f * rand(0.85, 1.15), q: 1.4, gain: 0.12 * intensity, decay: 0.035 });
    this.burst(out, { type: 'lowpass', freq: 300, gain: 0.18 * intensity, decay: 0.04 });
  }

  land(h: number) {
    if (!this.live) return;
    const out = this.bus(undefined, 0.2);
    this.burst(out, { type: 'lowpass', freq: 500, gain: clamp(0.2 + h * 0.1, 0.2, 0.7), decay: 0.08 });
  }

  explosion(pos: V3) {
    if (!this.live) return;
    const out = this.bus(pos, 1.6, 1.2);
    this.burst(out, { type: 'lowpass', freq: 3000, gain: 1.4, decay: 0.5, freqEnd: 120 });
    this.burst(out, { type: 'highpass', freq: 3000, gain: 0.5, decay: 0.05 });
    this.tone(out, { type: 'sine', f0: 90, f1: 28, gain: 1.4, decay: 0.6, dur: 0.8 });
    for (let i = 0; i < 6; i++) {
      this.burst(out, { type: 'bandpass', freq: rand(1500, 4000), q: 3, gain: 0.08, decay: 0.03, delay: 0.3 + i * rand(0.08, 0.2) });
    }
  }

  flare(pos: V3) {
    if (!this.live) return;
    const out = this.bus(pos, 0.4);
    this.burst(out, { type: 'highpass', freq: 2500, gain: 0.5, attack: 0.02, decay: 0.6 });
  }

  lureBeep(pos: V3) {
    if (!this.live) return;
    const out = this.bus(pos, 0.6);
    this.tone(out, { type: 'square', f0: 2200, gain: 0.08, decay: 0.06 });
    this.tone(out, { type: 'square', f0: 2200, gain: 0.08, decay: 0.06, delay: 0.14 });
  }

  gasHiss(pos: V3) {
    if (!this.live) return;
    const out = this.bus(pos, 0.5);
    this.burst(out, { type: 'bandpass', freq: 3500, q: 0.6, gain: 0.35, attack: 0.05, decay: 1.4 });
  }

  /** Wet rupture used when a Bloater pops. */
  rupture(pos: V3) {
    if (!this.live) return;
    const out = this.bus(pos, 0.9, 1);
    this.burst(out, { type: 'lowpass', freq: 1400, gain: 1.1, decay: 0.25, freqEnd: 150 });
    this.tone(out, { type: 'sine', f0: 140, f1: 45, gain: 0.9, decay: 0.25 });
    for (let i = 0; i < 5; i++) {
      this.burst(out, { type: 'bandpass', freq: rand(300, 900), q: 6, gain: 0.25, decay: 0.05, delay: 0.1 + i * 0.07 });
    }
    this.gasHiss(pos);
  }

  cough() {
    if (!this.live) return;
    const out = this.bus(undefined, 0.15);
    this.burst(out, { type: 'bandpass', freq: 700, q: 1.2, gain: 0.35, attack: 0.01, decay: 0.12 });
    this.burst(out, { type: 'bandpass', freq: 600, q: 1.2, gain: 0.25, attack: 0.01, decay: 0.1, delay: 0.22 });
  }

  playerHurt(heavy: boolean) {
    if (!this.live) return;
    const out = this.bus(undefined, 0.1);
    this.tone(out, { type: 'sawtooth', f0: heavy ? 180 : 220, f1: heavy ? 120 : 160, gain: 0.08, decay: 0.12 });
    this.burst(out, { type: 'lowpass', freq: 400, gain: heavy ? 0.6 : 0.35, decay: 0.08 });
  }

  // ---------------------------------------------------------------- infected voices

  voice(kind: VoiceKind, pos: V3, mood: 'idle' | 'alert' | 'attack' | 'pain' | 'death' | 'scream') {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.voices = this.voices.filter((e) => e > t);
    const important = mood === 'scream' || mood === 'death';
    if (this.voices.length >= (important ? 12 : 7)) return;
    const out = this.bus(pos, 0.7, 1);

    const base: Record<VoiceKind, number> = { shambler: 105, runner: 170, bloater: 70, screamer: 260, brute: 62 };
    let f0 = base[kind] * rand(0.85, 1.15);
    let dur = rand(0.7, 1.4);
    let gain = 0.22;
    let bend = 0.8;
    if (mood === 'alert') { dur = rand(0.5, 0.8); gain = 0.35; bend = 1.4; f0 *= 1.25; }
    if (mood === 'attack') { dur = 0.35; gain = 0.4; bend = 0.7; f0 *= 1.4; }
    if (mood === 'pain') { dur = 0.22; gain = 0.32; bend = 0.75; f0 *= 1.5; }
    if (mood === 'death') { dur = 0.9; gain = 0.32; bend = 0.45; }
    if (mood === 'scream') { dur = 1.8; gain = 0.6; bend = 2.6; f0 = 520; }

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f0 * bend, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = rand(5, 11);
    const vibG = ctx.createGain();
    vibG.gain.value = f0 * (mood === 'scream' ? 0.08 : 0.04);
    vib.connect(vibG).connect(osc.frequency);

    // two vocal-tract formants
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = (kind === 'bloater' || kind === 'brute' ? 420 : 640) * rand(0.9, 1.1);
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = (mood === 'scream' ? 2600 : 1150) * rand(0.9, 1.1);
    f2.Q.value = 8;
    const mix = ctx.createGain();
    mix.gain.value = 1;
    const pre = ctx.createGain();
    pre.gain.value = mood === 'scream' ? 3 : 1.6;
    osc.connect(pre);
    const sh = ctx.createWaveShaper();
    sh.curve = this.shaper.curve;
    pre.connect(sh);
    sh.connect(f1);
    sh.connect(f2);
    f1.connect(mix);
    f2.connect(mix);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.05);
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mix.connect(g).connect(out);

    // breath / rasp
    const n = this.noiseSrc(dur);
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = kind === 'bloater' ? 500 : 1500;
    nf.Q.value = 1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(gain * 0.5, t + 0.04);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(nf).connect(ng).connect(out);

    if (kind === 'bloater') {
      // gurgle via amplitude modulation
      const am = ctx.createOscillator();
      am.frequency.value = rand(12, 22);
      const amG = ctx.createGain();
      amG.gain.value = 0.6;
      am.connect(amG).connect(g.gain);
      am.start(t);
      am.stop(t + dur);
    }

    this.voices.push(t + dur);
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- UI & radio

  ui(kind: UiSound) {
    if (!this.live) return;
    const out = this.bus(undefined, 0.05);
    switch (kind) {
      case 'tick':
        this.tone(out, { type: 'triangle', f0: 1900, gain: 0.05, decay: 0.02 });
        break;
      case 'open':
        this.burst(out, { type: 'bandpass', freq: 600, q: 1, gain: 0.12, attack: 0.03, decay: 0.1, freqEnd: 1800 });
        break;
      case 'close':
        this.burst(out, { type: 'bandpass', freq: 1800, q: 1, gain: 0.1, attack: 0.01, decay: 0.08, freqEnd: 600 });
        break;
      case 'select':
        this.tone(out, { type: 'triangle', f0: 880, gain: 0.07, decay: 0.05 });
        this.tone(out, { type: 'triangle', f0: 1320, gain: 0.06, decay: 0.07, delay: 0.05 });
        break;
      case 'deny':
        this.tone(out, { type: 'square', f0: 180, gain: 0.05, decay: 0.08 });
        break;
      case 'craft':
        this.tone(out, { type: 'triangle', f0: 660, gain: 0.07, decay: 0.08 });
        this.tone(out, { type: 'triangle', f0: 990, gain: 0.07, decay: 0.12, delay: 0.08 });
        break;
      case 'pickup':
        this.burst(out, { type: 'bandpass', freq: 1400, q: 2, gain: 0.18, decay: 0.04 });
        this.tone(out, { type: 'triangle', f0: 1200, gain: 0.03, decay: 0.05, delay: 0.02 });
        break;
      case 'objective':
        this.tone(out, { type: 'sine', f0: 523, gain: 0.08, decay: 0.3 });
        this.tone(out, { type: 'sine', f0: 784, gain: 0.07, decay: 0.4, delay: 0.12 });
        break;
      case 'radio':
        this.burst(out, { type: 'bandpass', freq: 2000, q: 0.8, gain: 0.1, decay: 0.12 });
        this.tone(out, { type: 'square', f0: 1400, gain: 0.02, decay: 0.04, delay: 0.1 });
        break;
    }
  }

  // ---------------------------------------------------------------- continuous layers

  private startDrone() {
    const ctx = this.ctx!;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.connect(this.droneGain).connect(this.music);
    for (const f of [41.2, 41.7, 61.8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(lp);
      o.start();
    }
    // fluorescent hum
    const hum = ctx.createOscillator();
    hum.type = 'square';
    hum.frequency.value = 120;
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass';
    hf.frequency.value = 240;
    hf.Q.value = 12;
    const hg = ctx.createGain();
    hg.gain.value = 0.015;
    hum.connect(hf).connect(hg).connect(this.droneGain);
    hum.start();

    this.heartGain = ctx.createGain();
    this.heartGain.gain.value = 0;
    this.heartGain.connect(this.sfx);

    this.combatGain = ctx.createGain();
    this.combatGain.gain.value = 0;
    this.combatGain.connect(this.music);
  }

  setAmbience(level: number) {
    if (!this.ctx || !this.droneGain) return;
    this.droneGain.gain.setTargetAtTime(level * 0.55, this.ctx.currentTime, 1.5);
  }

  /** Call every frame with game-time dt. */
  update(dt: number, health01: number, combat01: number) {
    if (!this.live || this.ctx!.state !== 'running') return;
    const ctx = this.ctx!;
    // heartbeat below 35% health
    this.heartRate = health01 < 0.35 ? 1.4 - health01 * 1.5 : 0;
    if (this.heartRate > 0 && this.heartGain) {
      this.heartGain.gain.setTargetAtTime(clamp((0.35 - health01) * 2.4, 0, 0.8), ctx.currentTime, 0.2);
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 1 / this.heartRate;
        this.tone(this.heartGain, { type: 'sine', f0: 62, f1: 40, gain: 0.9, decay: 0.08 });
        this.tone(this.heartGain, { type: 'sine', f0: 58, f1: 38, gain: 0.6, decay: 0.08, delay: 0.18 });
      }
    }

    // tension pulse as combat intensity rises
    this.combatLevel += (combat01 - this.combatLevel) * Math.min(1, dt * 0.8);
    if (this.combatGain) {
      this.combatGain.gain.setTargetAtTime(this.combatLevel * 0.5, ctx.currentTime, 0.4);
      if (this.combatLevel > 0.05) {
        this.combatTimer -= dt;
        if (this.combatTimer <= 0) {
          this.combatTimer = 0.42;
          this.tone(this.combatGain, { type: 'sawtooth', f0: 55, gain: 0.18, decay: 0.12 });
          this.burst(this.combatGain, { type: 'bandpass', freq: 90, q: 2, gain: 0.25, decay: 0.08 });
        }
      }
    }

    // distant structure noises
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = rand(7, 16);
      const ang = rand(0, Math.PI * 2);
      const p = { x: this.listenerPos.x + Math.cos(ang) * 30, y: 2, z: this.listenerPos.z + Math.sin(ang) * 30 };
      const out = this.bus(p, 1.5, 0.5);
      const r = Math.random();
      if (r < 0.4) {
        this.burst(out, { type: 'lowpass', freq: 400, gain: 0.5, decay: 0.3 });
      } else if (r < 0.7) {
        this.tone(out, { type: 'sawtooth', f0: rand(300, 600), f1: rand(200, 300), gain: 0.03, attack: 0.3, decay: 0.8, dur: 1.2 });
      } else {
        this.burst(out, { type: 'bandpass', freq: 2400, q: 6, gain: 0.15, decay: 0.03 });
        this.burst(out, { type: 'bandpass', freq: 2000, q: 6, gain: 0.12, decay: 0.03, delay: 0.25 });
      }
    }
  }
}

export const audio = new AudioEngine();

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — the old transistor radio: a faint, looping 1970s soft-pop
// tune, fully synthesized, heard through an AM-radio chain.
//
//   FM electric piano melody + comping, triangle bass, brushed kit
//     → band-pass (≈380 Hz – 2.9 kHz) with a 1.3 kHz "honk"
//     → soft saturation (small speaker) → signal-strength wobble (two slow
//       LFOs) + a bed of static and occasional crackles → emitter.
//
// Song: 8 bars in F major at 100 BPM (Fmaj7 Dm7 Gm7 C7 | Fmaj7 Am7 Bbmaj7 C7sus).
// The song position follows the audio clock, so walking out of range and back
// resumes mid-song instead of restarting — like a real station.
// ─────────────────────────────────────────────────────────────────────────────

import type { AudioCore } from './core';
import { mtof, rand, type Synth } from './synth';

const BPM = 100;
const STEP = 60 / BPM / 4;
const BARS = 8;

/** [bar, step-in-bar, midi, length-in-steps] */
type Note = [number, number, number, number];

const CHORDS: number[][] = [
  [53, 57, 60, 64], // Fmaj7
  [53, 57, 60, 62], // Dm7
  [55, 58, 62, 65], // Gm7
  [52, 55, 58, 60], // C7
  [53, 57, 60, 64], // Fmaj7
  [52, 55, 57, 60], // Am7
  [53, 57, 58, 62], // Bbmaj7
  [53, 55, 58, 60], // C7sus
];
const ROOTS = [41, 38, 43, 36, 41, 45, 46, 36];

const MELODY: Note[] = [
  [0, 0, 72, 4], [0, 4, 76, 2], [0, 6, 77, 2], [0, 8, 79, 6], [0, 14, 77, 2],
  [1, 0, 77, 3], [1, 3, 76, 1], [1, 4, 74, 4], [1, 8, 72, 4], [1, 12, 69, 4],
  [2, 0, 70, 4], [2, 4, 74, 2], [2, 6, 77, 2], [2, 8, 76, 4], [2, 12, 74, 4],
  [3, 0, 72, 6], [3, 6, 70, 2], [3, 8, 67, 8],
  [4, 0, 72, 4], [4, 4, 76, 2], [4, 6, 77, 2], [4, 8, 81, 6], [4, 14, 79, 2],
  [5, 0, 79, 4], [5, 4, 76, 4], [5, 8, 72, 4], [5, 12, 76, 4],
  [6, 0, 77, 3], [6, 3, 74, 1], [6, 4, 74, 4], [6, 8, 81, 4], [6, 12, 79, 4],
  [7, 0, 77, 6], [7, 6, 76, 2], [7, 8, 72, 8],
];

export class RadioStation {
  private readonly core: AudioCore;
  private readonly s: Synth;
  private readonly input: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly start: number;
  private next = -1;
  private byStep: Note[][] = [];

  constructor(core: AudioCore, synth: Synth, out: AudioNode) {
    this.core = core;
    this.s = synth;
    const ctx = core.ctx;
    // Random station phase so two radios never play in lockstep.
    this.start = ctx.currentTime - rand(0, BARS * 16 * STEP);
    this.input = ctx.createGain();
    this.input.gain.value = 1;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    hp.Q.value = 0.7;
    const honk = ctx.createBiquadFilter();
    honk.type = 'peaking';
    honk.frequency.value = 1300;
    honk.Q.value = 1.2;
    honk.gain.value = 5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2900;
    lp.Q.value = 0.9;
    const sat = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
    }
    sat.curve = curve;
    // Output level: faint — a radio left on, not a second soundtrack.
    const LEVEL = 0.06;
    const am = ctx.createGain();
    am.gain.value = LEVEL;
    this.input.connect(hp).connect(honk).connect(lp).connect(sat).connect(am).connect(out);
    // Signal-strength wobble.
    for (const [f, depth] of [
      [0.21, 0.12],
      [0.047, 0.1],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = depth * LEVEL;
      o.connect(g).connect(am.gain);
      o.start();
      this.sources.push(o);
      this.nodes.push(g);
    }
    // Static bed.
    const hiss = ctx.createBufferSource();
    hiss.buffer = core.noise.white;
    hiss.loop = true;
    const hbp = ctx.createBiquadFilter();
    hbp.type = 'bandpass';
    hbp.frequency.value = 3200;
    hbp.Q.value = 0.6;
    const hg = ctx.createGain();
    hg.gain.value = 0.0012;
    hiss.connect(hbp).connect(hg).connect(out);
    hiss.start();
    this.sources.push(hiss);
    this.nodes.push(this.input, hp, honk, lp, sat, am, hbp, hg);
    // Index notes by absolute step.
    this.byStep = Array.from({ length: BARS * 16 }, () => []);
    for (const n of MELODY) this.byStep[n[0] * 16 + n[1]].push(n);
  }

  private stepTime(i: number): number {
    return this.start + i * STEP;
  }

  /** Schedules notes up to `until` (audio time). Call while audible. */
  schedule(until: number): void {
    const now = this.core.ctx.currentTime;
    const cur = Math.ceil((now - this.start) / STEP);
    if (this.next < cur - 1) this.next = cur; // resumed after silence: jump to "now"
    while (this.stepTime(this.next) < until) {
      this.play(this.next, this.stepTime(this.next));
      this.next++;
    }
  }

  private play(i: number, t: number): void {
    const s = this.s;
    const d = this.input;
    const step = i % (BARS * 16);
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    // Melody (FM e-piano).
    for (const n of this.byStep[step]) this.ep(t, mtof(n[2]), n[3] * STEP, 0.11, 2.4);
    // Comping: soft chords on 2 and 4 (and an anticipation on the "and" of 4).
    if (inBar === 4 || inBar === 12 || (inBar === 14 && bar % 2 === 1)) {
      for (const m of CHORDS[bar]) this.ep(t, mtof(m), STEP * 2.5, 0.035, 1.2);
    }
    // Bass: root … fifth … root … approach.
    const root = ROOTS[bar];
    const bassAt: Record<number, number> = { 0: root, 6: root + 7, 8: root, 14: ROOTS[(bar + 1) % BARS] - 1 };
    const b = bassAt[inBar];
    if (b !== undefined) s.tone(d, t, { wave: 'triangle', freq: mtof(b + 12), gain: 0.14, attack: 0.006, decay: inBar === 14 ? 0.12 : 0.3 });
    // Brushed kit.
    if (inBar === 0 || inBar === 8) s.tone(d, t, { freq: 110, freqEnd: 55, glide: 0.08, gain: 0.16, decay: 0.12 });
    if (inBar === 4 || inBar === 12) s.noise(d, t, { kind: 'pink', filter: 'bandpass', freq: 2200, q: 0.8, gain: 0.07, attack: 0.008, decay: 0.12 });
    if (inBar % 2 === 0) s.noise(d, t, { filter: 'highpass', freq: 6000, gain: inBar % 4 === 2 ? 0.03 : 0.018, decay: 0.03 });
    // Now and then: a crackle.
    if (Math.random() < 0.02) s.noise(this.input, t + rand(0, STEP), { filter: 'highpass', freq: 2500, gain: rand(0.02, 0.06), decay: 0.006 });
  }

  /** FM electric piano: carrier + ratio-1 modulator with a decaying index. */
  private ep(t: number, f: number, dur: number, gain: number, index: number): void {
    const ctx = this.core.ctx;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.15 + 1, t + 0.35);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    const end = t + dur + 0.25;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, t + Math.min(0.3, dur));
    g.gain.setTargetAtTime(0.00001, t + dur, 0.045);
    car.connect(g).connect(this.input);
    car.start(t);
    mod.start(t);
    car.stop(end);
    mod.stop(end);
    car.onended = () => {
      g.disconnect();
      mg.disconnect();
    };
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

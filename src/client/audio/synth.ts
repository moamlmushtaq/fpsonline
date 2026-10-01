// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — synthesis primitives shared by sfx, weapons and ambience.
//
// Every primitive schedules a self-cleaning one-shot at time `t` into `dest`:
// envelopes always start from 0 with a ≥1 ms linear attack and decay
// exponentially to −80 dB before the source stops, so nothing clicks or pops.
// Nodes disconnect themselves when their source ends.
// ─────────────────────────────────────────────────────────────────────────────

import type { AudioCore } from './core';

export interface NoiseOpts {
  kind?: 'white' | 'pink' | 'brown';
  filter?: BiquadFilterType;
  freq?: number;
  /** Filter sweep target (exponential over `sweep` or the whole sound). */
  freqEnd?: number;
  sweep?: number;
  q?: number;
  gain: number;
  attack?: number;
  /** Optional hold at full level before the decay. */
  hold?: number;
  decay: number;
  /** Playback rate (pitch of the noise texture). */
  rate?: number;
  /** Second filter stage (e.g. band-pass → low-pass for body). */
  filter2?: { type: BiquadFilterType; freq: number; q?: number };
  pan?: number;
}

export interface ToneOpts {
  wave?: OscillatorType;
  freq: number;
  freqEnd?: number;
  glide?: number;
  gain: number;
  attack?: number;
  hold?: number;
  decay: number;
  detune?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number; freqEnd?: number };
  /** Vibrato: rate (Hz) and depth (cents). */
  vib?: [number, number];
  pan?: number;
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Random factor 1 ± k. */
export const jit = (k: number): number => 1 + (Math.random() * 2 - 1) * k;
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Synth {
  readonly core: AudioCore;

  constructor(core: AudioCore) {
    this.core = core;
  }

  get ctx(): BaseAudioContext {
    return this.core.ctx;
  }

  get now(): number {
    return this.core.ctx.currentTime;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, decay: number): number {
    const p = Math.max(0.0002, peak);
    const a = Math.max(0.001, attack);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p, t + a);
    if (hold > 0) g.gain.setValueAtTime(p, t + a + hold);
    g.gain.exponentialRampToValueAtTime(p * 0.0001 + 0.00001, t + a + hold + decay);
    return t + a + hold + decay;
  }

  private panNode(dest: AudioNode, pan?: number): { node: AudioNode; extra: AudioNode | null } {
    if (pan === undefined || pan === 0) return { node: dest, extra: null };
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return { node: p, extra: p };
  }

  /** Filtered noise burst. */
  noise(dest: AudioNode, t: number, o: NoiseOpts): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const buf = this.core.noise[o.kind ?? 'white'];
    src.buffer = buf;
    if (o.rate && o.rate !== 1) src.playbackRate.value = o.rate;
    const g = ctx.createGain();
    const { node: out, extra: pn } = this.panNode(dest, o.pan);
    const end = this.env(g, t, o.gain, o.attack ?? 0.001, o.hold ?? 0, o.decay);
    let head: AudioNode = src;
    let f: BiquadFilterNode | null = null;
    let f2: BiquadFilterNode | null = null;
    if (o.filter) {
      f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.freq ?? 1000, t);
      if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + (o.sweep ?? end - t));
      f.Q.value = o.q ?? 0.7;
      head.connect(f);
      head = f;
    }
    if (o.filter2) {
      f2 = ctx.createBiquadFilter();
      f2.type = o.filter2.type;
      f2.frequency.value = o.filter2.freq;
      f2.Q.value = o.filter2.q ?? 0.7;
      head.connect(f2);
      head = f2;
    }
    head.connect(g);
    g.connect(out);
    const len = buf.duration;
    const dur = end - t + 0.02;
    // Long textures loop (the buffers are crossfaded at the loop point).
    if (dur * (o.rate ?? 1) > len - 0.1) src.loop = true;
    src.start(t, Math.random() * Math.max(0, len - dur * (o.rate ?? 1) - 0.05));
    src.stop(end + 0.02);
    src.onended = () => {
      g.disconnect();
      f?.disconnect();
      f2?.disconnect();
      pn?.disconnect();
    };
  }

  /** Oscillator with pitch glide, optional filter and vibrato. */
  tone(dest: AudioNode, t: number, o: ToneOpts): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    const g = ctx.createGain();
    const end = this.env(g, t, o.gain, o.attack ?? 0.002, o.hold ?? 0, o.decay);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + (o.glide ?? end - t));
    if (o.detune) osc.detune.value = o.detune;
    const { node: out, extra: pn } = this.panNode(dest, o.pan);
    let head: AudioNode = osc;
    let f: BiquadFilterNode | null = null;
    if (o.filter) {
      f = ctx.createBiquadFilter();
      f.type = o.filter.type;
      f.frequency.setValueAtTime(o.filter.freq, t);
      if (o.filter.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.freqEnd), end);
      f.Q.value = o.filter.q ?? 0.7;
      osc.connect(f);
      head = f;
    }
    let lfo: OscillatorNode | null = null;
    let lg: GainNode | null = null;
    if (o.vib) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = o.vib[0];
      lg = ctx.createGain();
      lg.gain.value = o.vib[1];
      lfo.connect(lg).connect(osc.detune);
      lfo.start(t);
      lfo.stop(end + 0.02);
    }
    head.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(end + 0.02);
    osc.onended = () => {
      g.disconnect();
      f?.disconnect();
      lg?.disconnect();
      pn?.disconnect();
    };
  }

  /** Bell / chime: sine partials with slightly inharmonic overtones. */
  bell(dest: AudioNode, t: number, f: number, gain: number, decay = 0.9, pan?: number): void {
    this.tone(dest, t, { freq: f, gain, decay, attack: 0.003, pan });
    this.tone(dest, t, { freq: f * 2.005, gain: gain * 0.32, decay: decay * 0.55, attack: 0.002, pan });
    this.tone(dest, t, { freq: f * 3.99, gain: gain * 0.1, decay: decay * 0.3, attack: 0.002, pan });
  }

  /** Mechanical click: a very short resonant noise tick. */
  click(dest: AudioNode, t: number, f: number, gain: number, q = 4, decay = 0.012): void {
    this.noise(dest, t, { filter: 'bandpass', freq: f, q, gain, decay, attack: 0.0008 });
  }

  /** Metal-on-metal clack: click + two inharmonic rings + a low knock. */
  clack(dest: AudioNode, t: number, f: number, gain: number, ring = 0.08, knock = 0): void {
    this.noise(dest, t, { filter: 'bandpass', freq: f, q: 2.2, gain, decay: 0.022, attack: 0.0008 });
    this.noise(dest, t + 0.002, { filter: 'highpass', freq: f * 1.8, q: 0.8, gain: gain * 0.5, decay: 0.01, attack: 0.0006 });
    if (ring > 0) {
      this.tone(dest, t, { freq: f * 1.37 * jit(0.03), gain: gain * 0.08, decay: ring, attack: 0.001 });
      this.tone(dest, t, { freq: f * 2.21 * jit(0.03), gain: gain * 0.05, decay: ring * 0.7, attack: 0.001 });
    }
    if (knock > 0) this.tone(dest, t, { freq: knock, freqEnd: knock * 0.6, gain: gain * 0.6, decay: 0.05, attack: 0.001 });
  }

  /** Sliding metal / plastic friction (mag out, bolt travel). */
  slideNoise(dest: AudioNode, t: number, f0: number, f1: number, gain: number, dur: number): void {
    this.noise(dest, t, { filter: 'bandpass', freq: f0, freqEnd: f1, q: 3, gain, attack: dur * 0.3, decay: dur * 0.7 });
  }
}

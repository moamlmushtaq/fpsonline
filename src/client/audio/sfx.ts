// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — synthesized sound effects (100% procedural Web Audio).
//
// Every sound is a short recipe of layered primitives (noise bursts through
// filters, pitched bodies with glides, filtered tails) scheduled at `t`.
// Weapons follow the audio bible: Meridian = punchy mid "thok" + brassy tail,
// Swift = tight high rattle, Longline = deep crack + long echo + bolt clack,
// Breaker = boomy thump + pump "chk-chk", Pulse = snappy electronic pop,
// Sunspear = rising charge whine → bright zap-roar.
// World sounds are routed through Spatializer (distance filter, panner, echo).
// Nodes self-disconnect when their source ends; nothing is kept alive.
// ─────────────────────────────────────────────────────────────────────────────

import type { UiSound } from '../contracts';
import type { Faction, SurfaceTag, Vec3, WeaponId } from '../../shared/types';
import type { AudioCore, Route, Spatializer } from './spatial';

interface NoiseOpts {
  kind?: 'white' | 'pink' | 'brown';
  filter?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  gain: number;
  attack?: number;
  decay: number;
  /** Playback rate (pitch of the noise texture). */
  rate?: number;
}

interface ToneOpts {
  wave?: OscillatorType;
  freq: number;
  freqEnd?: number;
  glide?: number;
  gain: number;
  attack?: number;
  decay: number;
  detune?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
}

interface ShotRecipe {
  crack: { f: number; g: number; d: number };
  body: { f0: number; f1: number; g: number; d: number; wave: OscillatorType };
  mid: { f: number; q: number; g: number; d: number };
  extra?: { wave: OscillatorType; f0: number; f1: number; g: number; d: number };
  tail: { f: number; g: number; d: number };
  echo: number;
  rev: number;
  vol: number;
}

const SHOTS: Record<WeaponId, ShotRecipe> = {
  meridian: {
    crack: { f: 3000, g: 0.45, d: 0.025 },
    body: { f0: 160, f1: 52, g: 0.95, d: 0.13, wave: 'sine' },
    mid: { f: 1150, q: 1.5, g: 0.6, d: 0.14 },
    extra: { wave: 'square', f0: 340, f1: 260, g: 0.07, d: 0.09 },
    tail: { f: 1700, g: 0.3, d: 0.5 },
    echo: 0.55,
    rev: 0.22,
    vol: 0.85,
  },
  swift: {
    crack: { f: 4200, g: 0.4, d: 0.018 },
    body: { f0: 230, f1: 110, g: 0.6, d: 0.06, wave: 'triangle' },
    mid: { f: 2500, q: 1.8, g: 0.55, d: 0.07 },
    tail: { f: 2400, g: 0.18, d: 0.22 },
    echo: 0.35,
    rev: 0.15,
    vol: 0.7,
  },
  longline: {
    crack: { f: 2200, g: 0.9, d: 0.035 },
    body: { f0: 110, f1: 38, g: 1.1, d: 0.26, wave: 'sine' },
    mid: { f: 700, q: 0.9, g: 0.55, d: 0.24 },
    tail: { f: 1300, g: 0.5, d: 1.1 },
    echo: 1,
    rev: 0.4,
    vol: 1,
  },
  breaker: {
    crack: { f: 1800, g: 0.55, d: 0.03 },
    body: { f0: 95, f1: 32, g: 1.25, d: 0.3, wave: 'sine' },
    mid: { f: 520, q: 0.7, g: 0.8, d: 0.26 },
    tail: { f: 950, g: 0.45, d: 0.7 },
    echo: 0.75,
    rev: 0.3,
    vol: 1,
  },
  pulse: {
    crack: { f: 3600, g: 0.4, d: 0.015 },
    body: { f0: 260, f1: 120, g: 0.55, d: 0.07, wave: 'triangle' },
    mid: { f: 1900, q: 2.2, g: 0.45, d: 0.07 },
    extra: { wave: 'square', f0: 820, f1: 190, g: 0.08, d: 0.05 },
    tail: { f: 2000, g: 0.18, d: 0.25 },
    echo: 0.3,
    rev: 0.15,
    vol: 0.7,
  },
  sunspear: {
    crack: { f: 5200, g: 0.5, d: 0.04 },
    body: { f0: 70, f1: 40, g: 1.1, d: 0.5, wave: 'sine' },
    mid: { f: 3000, q: 1.1, g: 0.6, d: 0.42 },
    extra: { wave: 'sawtooth', f0: 220, f1: 1400, g: 0.12, d: 0.18 },
    tail: { f: 2600, g: 0.4, d: 1.2 },
    echo: 0.9,
    rev: 0.45,
    vol: 1,
  },
};

interface SurfaceVoice {
  filter: BiquadFilterType;
  f: number;
  q: number;
  thud: number;
  ring?: number[];
  grain?: boolean;
  splash?: boolean;
  level: number;
}

const SURF: Record<SurfaceTag | 'player', SurfaceVoice> = {
  concrete: { filter: 'bandpass', f: 1700, q: 0.9, thud: 95, level: 1 },
  tile: { filter: 'bandpass', f: 2400, q: 1.2, thud: 110, level: 1 },
  ceramic: { filter: 'bandpass', f: 2800, q: 1.4, thud: 120, ring: [3400], level: 0.9 },
  rock: { filter: 'bandpass', f: 1400, q: 0.8, thud: 85, level: 1 },
  metal: { filter: 'bandpass', f: 2200, q: 1.5, thud: 140, ring: [2860, 4150], level: 1 },
  wood: { filter: 'bandpass', f: 650, q: 1.2, thud: 120, level: 1 },
  plaster: { filter: 'bandpass', f: 1300, q: 0.8, thud: 100, level: 0.9 },
  glass: { filter: 'highpass', f: 3500, q: 0.7, thud: 150, ring: [4800, 6200], level: 0.8 },
  grass: { filter: 'lowpass', f: 1600, q: 0.5, thud: 70, grain: true, level: 0.7 },
  foliage: { filter: 'lowpass', f: 2000, q: 0.5, thud: 70, grain: true, level: 0.7 },
  dirt: { filter: 'lowpass', f: 1200, q: 0.6, thud: 80, grain: true, level: 0.85 },
  sand: { filter: 'bandpass', f: 1900, q: 0.6, thud: 70, grain: true, level: 0.8 },
  snow: { filter: 'bandpass', f: 1500, q: 0.7, thud: 60, grain: true, level: 0.8 },
  water: { filter: 'bandpass', f: 1200, q: 0.8, thud: 60, splash: true, level: 0.9 },
  fabric: { filter: 'lowpass', f: 900, q: 0.5, thud: 70, level: 0.5 },
  player: { filter: 'bandpass', f: 2600, q: 2, thud: 160, ring: [3900], level: 0.9 },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Sfx {
  private readonly core: AudioCore;
  private readonly spatial: Spatializer;
  private xpStep = 0;
  private xpLast = 0;
  private heartbeat = 0;
  private heartNext = 0;
  private lastUi = new Map<UiSound, number>();

  constructor(core: AudioCore, spatial: Spatializer) {
    this.core = core;
    this.spatial = spatial;
  }

  private get now(): number {
    return this.core.ctx.currentTime;
  }

  // ── Primitives ──────────────────────────────────────────────────────────

  noise(dest: AudioNode, t: number, o: NoiseOpts): void {
    const ctx = this.core.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.core.noise[o.kind ?? 'white'];
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    const a = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
    let head: AudioNode = src;
    let f: BiquadFilterNode | null = null;
    if (o.filter) {
      f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.freq ?? 1000, t);
      if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + a + o.decay);
      f.Q.value = o.q ?? 0.7;
      src.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(dest);
    const len = src.buffer.duration;
    src.start(t, Math.random() * Math.max(0, len - a - o.decay - 0.05));
    src.stop(t + a + o.decay + 0.02);
    src.onended = () => {
      g.disconnect();
      f?.disconnect();
    };
  }

  tone(dest: AudioNode, t: number, o: ToneOpts): void {
    const ctx = this.core.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + (o.glide ?? o.decay));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
    let head: AudioNode = osc;
    let f: BiquadFilterNode | null = null;
    if (o.filter) {
      f = ctx.createBiquadFilter();
      f.type = o.filter.type;
      f.frequency.value = o.filter.freq;
      f.Q.value = o.filter.q ?? 0.7;
      osc.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + a + o.decay + 0.02);
    osc.onended = () => {
      g.disconnect();
      f?.disconnect();
    };
  }

  /** Bell/chime: sine partials with inharmonic overtones. */
  bell(dest: AudioNode, t: number, f: number, gain: number, decay = 0.9): void {
    this.tone(dest, t, { freq: f, gain, decay, attack: 0.004 });
    this.tone(dest, t, { freq: f * 2.01, gain: gain * 0.35, decay: decay * 0.6, attack: 0.004 });
    this.tone(dest, t, { freq: f * 3.98, gain: gain * 0.12, decay: decay * 0.35, attack: 0.003 });
  }

  private route(pos: Vec3 | undefined, dur: number, opts?: Parameters<Spatializer['route']>[2]): Route | null {
    return this.spatial.route(pos, dur, opts);
  }

  private jitter(k = 0.04): number {
    return 1 + (Math.random() * 2 - 1) * k;
  }

  // ── Weapons ─────────────────────────────────────────────────────────────

  shot(weapon: WeaponId, pos?: Vec3): void {
    const R = SHOTS[weapon] ?? SHOTS.meridian;
    const r = this.route(pos, R.tail.d + 0.3, { maxDist: 260, reverb: R.rev, echo: R.echo, gain: R.vol, priority: !pos });
    if (!r) return;
    const t = this.now + r.delay;
    const d = r.input;
    const p = this.jitter(0.03);
    const near = r.near;
    // Transient crack thins out with distance.
    this.noise(d, t, { filter: 'highpass', freq: R.crack.f * p, q: 0.7, gain: R.crack.g * (0.25 + near * 0.75), decay: R.crack.d });
    this.tone(d, t, { wave: R.body.wave, freq: R.body.f0 * p, freqEnd: R.body.f1, glide: R.body.d * 0.8, gain: R.body.g, decay: R.body.d });
    this.noise(d, t, { filter: 'bandpass', freq: R.mid.f * p, q: R.mid.q, gain: R.mid.g, decay: R.mid.d, kind: 'white' });
    if (R.extra) this.tone(d, t, { wave: R.extra.wave, freq: R.extra.f0, freqEnd: R.extra.f1, gain: R.extra.g, decay: R.extra.d, filter: { type: 'lowpass', freq: 3000 } });
    this.noise(d, t + 0.01, { kind: 'pink', filter: 'lowpass', freq: R.tail.f, freqEnd: R.tail.f * 0.4, gain: R.tail.g, attack: 0.01, decay: R.tail.d });
    if (weapon === 'sunspear') {
      // Bright shimmer on top of the roar.
      this.tone(d, t, { freq: 2600, freqEnd: 3600, glide: 0.3, gain: 0.08, decay: 0.6 });
      this.tone(d, t, { wave: 'sawtooth', freq: 55, gain: 0.25, decay: 0.8, attack: 0.02, filter: { type: 'lowpass', freq: 400 } });
    }
  }

  dryFire(): void {
    const r = this.route(undefined, 0.1, { reverb: 0 });
    if (!r) return;
    this.noise(r.input, this.now, { filter: 'bandpass', freq: 3200, q: 3, gain: 0.25, decay: 0.03 });
    this.tone(r.input, this.now, { freq: 1800, gain: 0.08, decay: 0.03 });
  }

  reload(weapon: WeaponId, stage: 'start' | 'mag_out' | 'mag_in' | 'chamber' | 'shell', pos?: Vec3): void {
    const r = this.route(pos, 0.4, { maxDist: 30, reverb: 0.1 });
    if (!r) return;
    const t = this.now + r.delay;
    const d = r.input;
    const pitch = weapon === 'swift' || weapon === 'pulse' ? 1.2 : weapon === 'longline' || weapon === 'breaker' ? 0.85 : 1;
    switch (stage) {
      case 'start':
        this.noise(d, t, { kind: 'pink', filter: 'bandpass', freq: 900, q: 0.6, gain: 0.12, attack: 0.02, decay: 0.12 });
        break;
      case 'mag_out':
        this.noise(d, t, { filter: 'bandpass', freq: 1300 * pitch, q: 2, gain: 0.35, decay: 0.05 });
        this.noise(d, t + 0.03, { filter: 'bandpass', freq: 2500 * pitch, q: 4, gain: 0.18, decay: 0.07 });
        this.tone(d, t + 0.02, { freq: 700 * pitch, freqEnd: 500, gain: 0.05, decay: 0.08 });
        break;
      case 'mag_in':
        this.noise(d, t, { filter: 'bandpass', freq: 950 * pitch, q: 1.6, gain: 0.5, decay: 0.05 });
        this.tone(d, t, { freq: 180 * pitch, freqEnd: 90, gain: 0.3, decay: 0.08 });
        this.noise(d, t + 0.05, { filter: 'bandpass', freq: 3000 * pitch, q: 5, gain: 0.15, decay: 0.04 });
        break;
      case 'chamber':
        this.noise(d, t, { filter: 'bandpass', freq: 1800 * pitch, q: 2.5, gain: 0.4, decay: 0.04 });
        this.noise(d, t + 0.11, { filter: 'bandpass', freq: 1400 * pitch, q: 2.5, gain: 0.45, decay: 0.05 });
        this.tone(d, t + 0.11, { freq: 2600 * pitch, gain: 0.05, decay: 0.12 });
        break;
      case 'shell':
        this.noise(d, t, { filter: 'bandpass', freq: 1100, q: 2, gain: 0.35, decay: 0.04 });
        this.tone(d, t + 0.02, { freq: 3100, gain: 0.04, decay: 0.1 });
        break;
    }
  }

  /** Pump (Breaker) or bolt cycle (Longline). */
  pump(weapon: WeaponId, pos?: Vec3): void {
    const r = this.route(pos, 0.5, { maxDist: 40, reverb: 0.12 });
    if (!r) return;
    const t = this.now + r.delay + 0.04;
    const d = r.input;
    if (weapon === 'longline') {
      this.noise(d, t, { filter: 'bandpass', freq: 1600, q: 2.5, gain: 0.35, decay: 0.05 });
      this.tone(d, t, { freq: 2900, gain: 0.05, decay: 0.15 });
      this.noise(d, t + 0.16, { filter: 'bandpass', freq: 1200, q: 2.5, gain: 0.45, decay: 0.06 });
      this.tone(d, t + 0.16, { freq: 220, freqEnd: 120, gain: 0.12, decay: 0.07 });
    } else {
      // "chk-chk"
      this.noise(d, t, { filter: 'bandpass', freq: 1200, q: 1.8, gain: 0.55, decay: 0.06 });
      this.tone(d, t, { freq: 160, freqEnd: 90, gain: 0.25, decay: 0.07 });
      this.noise(d, t + 0.14, { filter: 'bandpass', freq: 2000, q: 1.8, gain: 0.5, decay: 0.07 });
      this.tone(d, t + 0.14, { freq: 2300, gain: 0.05, decay: 0.2 });
    }
  }

  charge(pos?: Vec3): void {
    const r = this.route(pos, 0.9, { maxDist: 90, reverb: 0.2, priority: !pos });
    if (!r) return;
    const t = this.now + r.delay;
    this.tone(r.input, t, { wave: 'sawtooth', freq: 240, freqEnd: 1900, glide: 0.6, gain: 0.08, attack: 0.05, decay: 0.62, filter: { type: 'bandpass', freq: 1400, q: 1.2 } });
    this.tone(r.input, t, { freq: 480, freqEnd: 3800, glide: 0.6, gain: 0.07, attack: 0.05, decay: 0.62 });
    this.noise(r.input, t, { filter: 'highpass', freq: 5000, gain: 0.05, attack: 0.4, decay: 0.25 });
  }

  swap(weapon: WeaponId): void {
    const r = this.route(undefined, 0.3, { reverb: 0.05 });
    if (!r) return;
    const t = this.now;
    this.noise(r.input, t, { kind: 'pink', filter: 'bandpass', freq: 700, q: 0.6, gain: 0.15, attack: 0.02, decay: 0.12 });
    this.noise(r.input, t + 0.12, { filter: 'bandpass', freq: weapon === 'pulse' ? 2600 : 1800, q: 3, gain: 0.25, decay: 0.05 });
    this.tone(r.input, t + 0.12, { freq: 2400, gain: 0.03, decay: 0.12 });
  }

  // ── Movement ────────────────────────────────────────────────────────────

  private surfaceHit(d: AudioNode, t: number, s: SurfaceVoice, level: number, bright: number): void {
    if (s.grain) {
      for (let i = 0; i < 4; i++) {
        this.noise(d, t + i * 0.012 + Math.random() * 0.006, { filter: s.filter, freq: s.f * bright * (0.8 + Math.random() * 0.4), q: s.q, gain: level * 0.35 * s.level, decay: 0.025 });
      }
    } else {
      this.noise(d, t, { filter: s.filter, freq: s.f * bright, q: s.q, gain: level * 0.5 * s.level, decay: 0.05 });
    }
    this.tone(d, t, { freq: s.thud, freqEnd: s.thud * 0.6, gain: level * 0.35, decay: 0.07 });
    if (s.ring) for (const f of s.ring) this.tone(d, t, { freq: f * bright, gain: level * 0.05, decay: 0.12 });
    if (s.splash) {
      this.noise(d, t, { filter: 'bandpass', freq: 700, freqEnd: 2600, q: 1, gain: level * 0.4, decay: 0.16 });
      this.tone(d, t + 0.03, { freq: 900, freqEnd: 1600, gain: level * 0.05, decay: 0.05 });
    }
  }

  footstep(surface: SurfaceTag, pos: Vec3 | undefined, kind: 'walk' | 'sprint' | 'crouch'): void {
    const level = kind === 'sprint' ? 0.8 : kind === 'crouch' ? 0.28 : 0.52;
    const r = this.route(pos, 0.25, { maxDist: kind === 'crouch' ? 10 : kind === 'sprint' ? 38 : 26, reverb: 0.08, gain: pos ? 1.15 : 0.55 });
    if (!r) return;
    this.surfaceHit(r.input, this.now + r.delay, SURF[surface] ?? SURF.concrete, level, kind === 'sprint' ? 1.1 : kind === 'crouch' ? 0.8 : 1);
  }

  jump(pos?: Vec3): void {
    const r = this.route(pos, 0.3, { maxDist: 20, reverb: 0.05, gain: pos ? 1 : 0.5 });
    if (!r) return;
    this.noise(r.input, this.now + r.delay, { kind: 'pink', filter: 'bandpass', freq: 600, freqEnd: 1200, q: 0.7, gain: 0.25, attack: 0.03, decay: 0.15 });
  }

  land(surface: SurfaceTag, impact: number, pos?: Vec3): void {
    const k = Math.max(0.3, Math.min(1.4, impact / 8));
    const r = this.route(pos, 0.35, { maxDist: 30, reverb: 0.1, gain: pos ? 1 : 0.6 });
    if (!r) return;
    const t = this.now + r.delay;
    this.surfaceHit(r.input, t, SURF[surface] ?? SURF.concrete, k, 0.85);
    this.tone(r.input, t, { freq: 70, freqEnd: 40, gain: 0.4 * k, decay: 0.14 });
  }

  slide(surface: SurfaceTag, pos?: Vec3): void {
    const r = this.route(pos, 0.8, { maxDist: 30, reverb: 0.08, gain: pos ? 1 : 0.55 });
    if (!r) return;
    const s = SURF[surface] ?? SURF.concrete;
    this.noise(r.input, this.now + r.delay, { kind: 'pink', filter: 'bandpass', freq: s.f * 0.8, freqEnd: s.f * 0.35, q: 0.8, gain: 0.45, attack: 0.04, decay: 0.6 });
  }

  mantle(pos?: Vec3): void {
    const r = this.route(pos, 0.4, { maxDist: 20, reverb: 0.05, gain: pos ? 1 : 0.55 });
    if (!r) return;
    const t = this.now + r.delay;
    this.tone(r.input, t, { freq: 130, freqEnd: 80, gain: 0.3, decay: 0.08 });
    this.noise(r.input, t + 0.05, { kind: 'pink', filter: 'bandpass', freq: 900, q: 0.6, gain: 0.2, attack: 0.03, decay: 0.2 });
  }

  // ── Combat feedback ─────────────────────────────────────────────────────

  impact(surface: SurfaceTag | 'player', pos: Vec3): void {
    const r = this.route(pos, 0.3, { maxDist: 45, reverb: 0.12 });
    if (!r) return;
    const s = SURF[surface] ?? SURF.concrete;
    const t = this.now + r.delay;
    this.noise(r.input, t, { filter: s.filter === 'lowpass' ? 'bandpass' : s.filter, freq: s.f * 1.3, q: s.q, gain: 0.35 * s.level, decay: 0.05 });
    if (s.ring) for (const f of s.ring) this.tone(r.input, t, { freq: f * 1.05, gain: 0.05, decay: 0.2 });
    if (s.grain) this.noise(r.input, t + 0.01, { kind: 'pink', filter: 'lowpass', freq: 1500, gain: 0.2, decay: 0.12 });
  }

  whizz(pos: Vec3): void {
    const r = this.route(pos, 0.25, { maxDist: 14, reverb: 0.02, priority: true, gain: 1.4 });
    if (!r) return;
    this.noise(r.input, this.now, { filter: 'bandpass', freq: 3800, freqEnd: 1200, q: 3, gain: 0.35, attack: 0.03, decay: 0.12 });
  }

  hitmarker(kind: 'body' | 'head' | 'kill' | 'headkill'): void {
    // Hit feedback: dry, centred, never spatialized (under the SFX volume).
    const d = this.core.buses.sfx;
    const t = this.now;
    if (kind === 'body') {
      this.tone(d, t, { freq: 2900, gain: 0.14, decay: 0.035 });
      this.noise(d, t, { filter: 'highpass', freq: 5000, gain: 0.1, decay: 0.015 });
      return;
    }
    if (kind === 'head' || kind === 'headkill') {
      this.tone(d, t, { freq: 3700, gain: 0.16, decay: 0.28 });
      this.tone(d, t, { freq: 5550, gain: 0.06, decay: 0.2 });
      this.noise(d, t, { filter: 'highpass', freq: 6000, gain: 0.1, decay: 0.02 });
    }
    if (kind === 'kill' || kind === 'headkill') {
      const s = kind === 'headkill' ? t + 0.06 : t;
      this.bell(d, s, mtof(88), 0.12, 0.5);
      this.bell(d, s + 0.09, mtof(95), 0.1, 0.8);
      this.tone(d, s, { freq: 90, freqEnd: 45, gain: 0.35, decay: 0.18 });
    }
  }

  hurt(amount: number): void {
    const k = Math.max(0.2, Math.min(1, amount / 40));
    const d = this.core.buses.sfx;
    const t = this.now;
    this.tone(d, t, { freq: 110, freqEnd: 55, gain: 0.45 * k, decay: 0.16 });
    this.noise(d, t, { kind: 'brown', filter: 'lowpass', freq: 600, gain: 0.35 * k, decay: 0.14 });
    this.noise(d, t, { filter: 'bandpass', freq: 2600, q: 3, gain: 0.08 * k, decay: 0.05 });
  }

  explosion(pos: Vec3): void {
    const r = this.route(pos, 2, { maxDist: 200, reverb: 0.45, echo: 0.9, gain: 1.3, priority: true });
    if (!r) return;
    const t = this.now + r.delay;
    this.tone(r.input, t, { freq: 75, freqEnd: 28, glide: 0.6, gain: 1.2, decay: 0.8 });
    this.noise(r.input, t, { kind: 'brown', filter: 'lowpass', freq: 1400, freqEnd: 200, gain: 1, attack: 0.005, decay: 1.4 });
    this.noise(r.input, t, { filter: 'highpass', freq: 2500, gain: 0.5 * (0.3 + r.near * 0.7), decay: 0.06 });
    for (let i = 0; i < 5; i++) this.noise(r.input, t + 0.1 + Math.random() * 0.5, { filter: 'bandpass', freq: 2000 + Math.random() * 2000, q: 3, gain: 0.08, decay: 0.03 });
  }

  smoke(pos: Vec3): void {
    const r = this.route(pos, 1.8, { maxDist: 50, reverb: 0.15 });
    if (!r) return;
    const t = this.now + r.delay;
    this.noise(r.input, t, { filter: 'bandpass', freq: 1800, q: 0.9, gain: 0.35, decay: 0.05 });
    this.noise(r.input, t + 0.03, { filter: 'highpass', freq: 3000, freqEnd: 1500, gain: 0.3, attack: 0.08, decay: 1.5 });
  }

  bounce(pos: Vec3): void {
    const r = this.route(pos, 0.3, { maxDist: 35, reverb: 0.1 });
    if (!r) return;
    const t = this.now + r.delay;
    this.noise(r.input, t, { filter: 'bandpass', freq: 2200, q: 3, gain: 0.3, decay: 0.03 });
    this.tone(r.input, t, { freq: 3300 * this.jitter(0.1), gain: 0.06, decay: 0.15 });
  }

  pickup(pos?: Vec3): void {
    const r = this.route(pos, 0.9, { maxDist: 40, reverb: 0.2 });
    if (!r) return;
    const t = this.now + r.delay;
    [74, 78, 81, 86].forEach((m, i) => this.bell(r.input, t + i * 0.06, mtof(m), 0.08, 0.6));
  }

  zone(kind: 'capturing' | 'captured' | 'lost' | 'contested'): void {
    const d = this.core.buses.ui;
    const t = this.now;
    switch (kind) {
      case 'capturing':
        this.tone(d, t, { wave: 'triangle', freq: mtof(69), gain: 0.07, attack: 0.04, decay: 0.3 });
        break;
      case 'captured':
        [62, 66, 69, 74].forEach((m, i) => this.bell(d, t + i * 0.08, mtof(m + 12), 0.1, 1));
        break;
      case 'lost':
        [69, 65, 62].forEach((m, i) => this.tone(d, t + i * 0.12, { wave: 'triangle', freq: mtof(m), gain: 0.12, decay: 0.4, filter: { type: 'lowpass', freq: 1800 } }));
        break;
      case 'contested':
        for (let i = 0; i < 3; i++) this.tone(d, t + i * 0.14, { wave: 'square', freq: i % 2 ? 660 : 550, gain: 0.04, decay: 0.08, filter: { type: 'lowpass', freq: 2000 } });
        break;
    }
  }

  spawn(pos?: Vec3): void {
    const r = this.route(pos, 1, { maxDist: 30, reverb: 0.25, gain: pos ? 0.8 : 0.6 });
    if (!r) return;
    const t = this.now + r.delay;
    this.noise(r.input, t, { kind: 'pink', filter: 'bandpass', freq: 400, freqEnd: 2400, q: 1, gain: 0.25, attack: 0.25, decay: 0.3 });
    this.bell(r.input, t + 0.35, mtof(81), 0.06, 0.7);
  }

  elimination(faction: Faction, pos: Vec3): void {
    const r = this.route(pos, 1.4, { maxDist: 70, reverb: 0.3 });
    if (!r) return;
    const t = this.now + r.delay;
    if (faction === 0) {
      // Halcyon: fired ceramic shattering into shards.
      this.noise(r.input, t, { filter: 'highpass', freq: 3500, gain: 0.35, decay: 0.12 });
      for (let i = 0; i < 9; i++) this.tone(r.input, t + Math.random() * 0.25, { freq: 3000 + Math.random() * 4500, gain: 0.05, decay: 0.08 + Math.random() * 0.2 });
      this.tone(r.input, t, { freq: 150, freqEnd: 70, gain: 0.25, decay: 0.15 });
    } else {
      // The Bloom: a soft airy bloom of light petals.
      this.noise(r.input, t, { kind: 'pink', filter: 'bandpass', freq: 900, freqEnd: 3200, q: 1.2, gain: 0.2, attack: 0.12, decay: 0.8 });
      [76, 81, 83, 88].forEach((m, i) => this.bell(r.input, t + 0.05 + i * 0.07, mtof(m), 0.04, 1.1));
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────

  ui(s: UiSound): void {
    const d = this.core.buses.ui;
    const t = this.now;
    // De-duplicate identical sounds fired in the same few ms (delegation can double up).
    const last = this.lastUi.get(s) ?? -1;
    if (t - last < 0.018 && s !== 'xpTick') return;
    this.lastUi.set(s, t);
    switch (s) {
      case 'hover':
        this.tone(d, t, { freq: 2350, freqEnd: 2100, gain: 0.035, decay: 0.03, filter: { type: 'lowpass', freq: 4000 } });
        break;
      case 'click':
        this.noise(d, t, { filter: 'bandpass', freq: 3000, q: 2, gain: 0.12, decay: 0.012 });
        this.tone(d, t, { freq: 920, freqEnd: 620, gain: 0.1, decay: 0.045 });
        break;
      case 'back':
        this.tone(d, t, { wave: 'triangle', freq: 660, gain: 0.09, decay: 0.06 });
        this.tone(d, t + 0.06, { wave: 'triangle', freq: 440, gain: 0.09, decay: 0.1 });
        break;
      case 'confirm':
        this.tone(d, t, { wave: 'triangle', freq: 523, gain: 0.1, decay: 0.07 });
        this.tone(d, t + 0.07, { wave: 'triangle', freq: 784, gain: 0.1, decay: 0.16 });
        this.tone(d, t + 0.07, { freq: 1568, gain: 0.025, decay: 0.2 });
        break;
      case 'toggle':
        this.noise(d, t, { filter: 'bandpass', freq: 2200, q: 3, gain: 0.12, decay: 0.01 });
        this.tone(d, t, { freq: 1500, gain: 0.05, decay: 0.03 });
        break;
      case 'error':
        this.tone(d, t, { wave: 'square', freq: 180, gain: 0.06, decay: 0.08, filter: { type: 'lowpass', freq: 900 } });
        this.tone(d, t + 0.1, { wave: 'square', freq: 150, gain: 0.06, decay: 0.12, filter: { type: 'lowpass', freq: 900 } });
        break;
      case 'unlock':
        [79, 83, 86, 91, 95].forEach((m, i) => this.bell(d, t + i * 0.05, mtof(m), 0.05, 0.8));
        break;
      case 'xpTick': {
        this.xpStep = t - this.xpLast < 0.25 ? Math.min(14, this.xpStep + 1) : 0;
        this.xpLast = t;
        this.tone(d, t, { freq: mtof(84 + this.xpStep), gain: 0.04, decay: 0.04 });
        break;
      }
      case 'levelUp':
        [62, 66, 69, 74].forEach((m) => this.tone(d, t, { wave: 'triangle', freq: mtof(m + 12), gain: 0.07, attack: 0.03, decay: 1.4, filter: { type: 'lowpass', freq: 3500 } }));
        [86, 90, 93, 98].forEach((m, i) => this.bell(d, t + 0.1 + i * 0.07, mtof(m), 0.05, 1.2));
        this.tone(d, t, { freq: 73, freqEnd: 50, gain: 0.3, decay: 0.4 });
        break;
      case 'matchFound':
        [74, 78, 81].forEach((m, i) => this.bell(d, t + i * 0.12, mtof(m), 0.1, 1));
        break;
      case 'countdown':
        this.tone(d, t, { freq: 880, gain: 0.1, decay: 0.12 });
        this.tone(d, t, { freq: 1760, gain: 0.02, decay: 0.08 });
        break;
      case 'go':
        this.tone(d, t, { freq: 1320, gain: 0.12, decay: 0.35 });
        [69, 73, 76].forEach((m) => this.tone(d, t, { wave: 'triangle', freq: mtof(m), gain: 0.06, decay: 0.6 }));
        break;
    }
  }

  // ── Heartbeat (low health) ──────────────────────────────────────────────

  setHeartbeat(intensity: number): void {
    this.heartbeat = Math.max(0, Math.min(1, intensity));
  }

  /** Called every frame by the AudioSystem. */
  update(): void {
    if (this.heartbeat <= 0.01) return;
    const t = this.now;
    if (this.heartNext < t) this.heartNext = t + 0.05;
    if (this.heartNext > t + 0.15) return;
    const k = this.heartbeat;
    const d = this.core.buses.sfx;
    const at = this.heartNext;
    this.tone(d, at, { freq: 58, freqEnd: 42, gain: 0.5 * k, attack: 0.01, decay: 0.12, filter: { type: 'lowpass', freq: 160 } });
    this.tone(d, at + 0.2, { freq: 52, freqEnd: 40, gain: 0.35 * k, attack: 0.01, decay: 0.12, filter: { type: 'lowpass', freq: 160 } });
    const bpm = 62 + k * 38;
    this.heartNext = at + 60 / bpm;
  }
}

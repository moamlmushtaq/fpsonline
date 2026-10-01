// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — weapon sound design (fire, distant fire, foley).
//
// Every shot is a stack of layers, each with its own job:
//   crack    high-passed noise transient (the "snap" at the muzzle)
//   snap     ballistic whip — a falling resonant sweep (Longline only)
//   body     pitched thump with a fast pitch drop (+2nd harmonic for punch)
//   blast    low-passed brown noise burst (the broadband "boom" of gas)
//   formant  resonant band of noise: each weapon's vowel ("thok", "tak", "boom")
//   ring     brassy / metallic ring (receiver and barrel)
//   rattle   mechanical action clicks right after the shot (bolt carrier)
//   voice    weapon-specific extras (Pulse FM "pew", Sunspear zap-roar)
//   tail     filtered noise decay + reverb/echo sends (the space answers)
//   sub      chest-thump sine (local only)
// Identity (see measurements in the polish report):
//   Meridian  punchy mid "thok" (~1.1 kHz formant) + brassy 2.35 kHz ring
//   Swift     tight, high (2.7 kHz formant) with a three-click 5 kHz rattle
//   Longline  huge broadband crack + whip + deep 36 Hz body + 1.3 s tail
//   Breaker   boomiest (95→30 Hz, 480 Hz formant) + pellet roar, pump foley
//   Pulse     tonal FM pop (square 1.1 kHz→190 Hz with beating partner)
//   Sunspear  rising saw zap → bright sizzle + long roar and 55 Hz sub
// Per-shot micro-variation (pitch ±3.5 %, filters ±7 %, level ±1 dB, rattle
// timing ±3 ms, noise start offsets) keeps automatic fire from sounding
// machine-gunned. Distant shots lose the crack, rattle and sub, gain a
// low "boom" and longer tails, arrive after distance/343 s, and send more to
// the map echo — that is what makes open maps answer back.
// ─────────────────────────────────────────────────────────────────────────────

import type { Vec3, WeaponId } from '../../shared/types';
import type { Spatializer } from './spatial';
import { jit, rand, type Synth } from './synth';

interface WeaponVoice {
  vol: number;
  crack: { f: number; q: number; g: number; d: number };
  snap?: { f0: number; f1: number; g: number; d: number };
  body: { f0: number; f1: number; drop: number; g: number; d: number; wave: OscillatorType; h2: number };
  blast: { f0: number; f1: number; g: number; d: number };
  formant: { f: number; q: number; g: number; d: number };
  ring?: { f: number; g: number; d: number };
  rattle?: { t: number[]; f: number; g: number };
  tail: { f0: number; f1: number; g: number; d: number };
  sub: number;
  rev: number;
  echo: number;
  maxDist: number;
  casing: number;
}

const V: Record<WeaponId, WeaponVoice> = {
  meridian: {
    vol: 1,
    crack: { f: 2600, q: 0.8, g: 0.85, d: 0.022 },
    body: { f0: 175, f1: 58, drop: 0.06, g: 0.6, d: 0.14, wave: 'sine', h2: 0.35 },
    blast: { f0: 2400, f1: 500, g: 1.2, d: 0.12 },
    formant: { f: 1150, q: 1.6, g: 3.2, d: 0.13 },
    ring: { f: 2350, g: 0.45, d: 0.26 },
    rattle: { t: [0.032, 0.058], f: 3300, g: 0.3 },
    tail: { f0: 1900, f1: 600, g: 0.45, d: 0.5 },
    sub: 0.45,
    rev: 0.22,
    echo: 0.6,
    maxDist: 230,
    casing: 0.5,
  },
  swift: {
    vol: 1,
    crack: { f: 4600, q: 0.9, g: 0.7, d: 0.016 },
    body: { f0: 270, f1: 140, drop: 0.03, g: 0.6, d: 0.06, wave: 'triangle', h2: 0 },
    blast: { f0: 3500, f1: 1200, g: 1.2, d: 0.08 },
    formant: { f: 2700, q: 2.4, g: 3.6, d: 0.08 },
    ring: { f: 4100, g: 0.35, d: 0.09 },
    rattle: { t: [0.012, 0.024, 0.037], f: 5200, g: 0.45 },
    tail: { f0: 3000, f1: 1400, g: 0.3, d: 0.2 },
    sub: 0.18,
    rev: 0.15,
    echo: 0.35,
    maxDist: 190,
    casing: 0.3,
  },
  longline: {
    vol: 1,
    crack: { f: 1900, q: 0.6, g: 1.0, d: 0.03 },
    snap: { f0: 2600, f1: 800, g: 1.1, d: 0.07 },
    body: { f0: 120, f1: 36, drop: 0.12, g: 0.85, d: 0.32, wave: 'sine', h2: 0.25 },
    blast: { f0: 1800, f1: 250, g: 1.1, d: 0.25 },
    formant: { f: 650, q: 0.9, g: 1.5, d: 0.22 },
    tail: { f0: 1300, f1: 300, g: 0.5, d: 1.3 },
    sub: 0.75,
    rev: 0.4,
    echo: 1,
    maxDist: 320,
    casing: 0,
  },
  breaker: {
    vol: 1,
    crack: { f: 1700, q: 0.6, g: 0.55, d: 0.025 },
    body: { f0: 95, f1: 30, drop: 0.15, g: 0.95, d: 0.36, wave: 'sine', h2: 0.45 },
    blast: { f0: 3000, f1: 400, g: 1.4, d: 0.3 },
    formant: { f: 480, q: 0.7, g: 1.8, d: 0.24 },
    tail: { f0: 900, f1: 250, g: 0.45, d: 0.8 },
    sub: 0.95,
    rev: 0.3,
    echo: 0.75,
    maxDist: 220,
    casing: 0,
  },
  pulse: {
    vol: 1.4,
    crack: { f: 3800, q: 1, g: 0.6, d: 0.012 },
    body: { f0: 260, f1: 120, drop: 0.04, g: 0.45, d: 0.07, wave: 'triangle', h2: 0 },
    blast: { f0: 2600, f1: 900, g: 0.8, d: 0.05 },
    formant: { f: 1900, q: 2.4, g: 2.4, d: 0.07 },
    tail: { f0: 2200, f1: 800, g: 0.3, d: 0.22 },
    sub: 0.22,
    rev: 0.16,
    echo: 0.3,
    maxDist: 180,
    casing: 0,
  },
  sunspear: {
    vol: 0.85,
    crack: { f: 5200, q: 0.7, g: 0.48, d: 0.04 },
    body: { f0: 72, f1: 38, drop: 0.2, g: 0.95, d: 0.55, wave: 'sine', h2: 0.3 },
    blast: { f0: 4000, f1: 500, g: 0.5, d: 0.9 },
    formant: { f: 3000, q: 1.1, g: 0.8, d: 0.35 },
    tail: { f0: 2600, f1: 600, g: 0.38, d: 1.2 },
    sub: 0.85,
    rev: 0.45,
    echo: 0.9,
    maxDist: 260,
    casing: 0,
  },
};

type Family = 'ballistic' | 'bolt' | 'shotgun' | 'energy';
const FAMILY: Record<WeaponId, Family> = {
  meridian: 'ballistic',
  swift: 'ballistic',
  longline: 'bolt',
  breaker: 'shotgun',
  pulse: 'energy',
  sunspear: 'energy',
};
/** Foley pitch per weapon (smaller guns ring higher). */
const PITCH: Record<WeaponId, number> = { meridian: 1, swift: 1.18, longline: 0.85, breaker: 0.9, pulse: 1.1, sunspear: 0.88 };

export type ReloadStage = 'start' | 'mag_out' | 'mag_in' | 'chamber' | 'shell';

export class WeaponSfx {
  private readonly s: Synth;
  private readonly spatial: Spatializer;
  private lastShot = new Map<string, number>();

  constructor(synth: Synth, spatial: Spatializer) {
    this.s = synth;
    this.spatial = spatial;
  }

  /** Voice parameters (exposed for measurement tooling). */
  static voice(w: WeaponId): Readonly<WeaponVoice> {
    return V[w] ?? V.meridian;
  }

  shot(weapon: WeaponId, pos?: Vec3): void {
    const R = V[weapon] ?? V.meridian;
    const local = !pos;
    const tailLen = R.tail.d * 1.8 + 0.3;
    const r = this.spatial.route(pos, tailLen, {
      maxDist: R.maxDist,
      reverb: R.rev,
      echo: R.echo,
      gain: R.vol * jit(0.06),
      prio: local ? 3 : 2,
      ref: 3,
      rolloff: 0.9,
    });
    if (!r) return;
    const s = this.s;
    const d = r.input;
    const t = s.now + r.delay + 0.001;
    // Rapid fire: shorten tails a little so they don't smear into mush.
    const key = local ? 'local' : `${Math.round(pos.x)}:${Math.round(pos.z)}`;
    const prev = this.lastShot.get(key) ?? -1;
    this.lastShot.set(key, t);
    if (this.lastShot.size > 64) this.lastShot.clear();
    const rapid = t - prev < 0.14 ? 0.7 : 1;
    const fd = local ? 0 : Math.max(0, Math.min(1, (r.dist - 30) / 90));
    const close = local ? 1 : Math.max(0, 1 - r.dist / 14);
    const p = jit(0.035);
    const fj = () => jit(0.07);
    const pan = local ? rand(-0.18, 0.18) : undefined;

    // Crack (thins with distance; air absorption does the rest).
    s.noise(d, t, { filter: 'highpass', freq: R.crack.f * fj(), q: R.crack.q, gain: R.crack.g * (1 - 0.7 * fd) * jit(0.1), decay: R.crack.d, attack: 0.0006 });
    if (R.snap) s.noise(d, t, { filter: 'bandpass', freq: R.snap.f0 * fj(), freqEnd: R.snap.f1, q: 2.5, gain: R.snap.g * (1 - 0.5 * fd), decay: R.snap.d, attack: 0.0008 });
    // Body: pitched thump (+ octave partial for punch).
    s.tone(d, t, { wave: R.body.wave, freq: R.body.f0 * p, freqEnd: R.body.f1 * p, glide: R.body.drop, gain: R.body.g, decay: R.body.d, attack: 0.0015 });
    if (R.body.h2 > 0) s.tone(d, t, { wave: 'sine', freq: R.body.f0 * 2 * p, freqEnd: R.body.f1 * 2 * p, glide: R.body.drop * 0.8, gain: R.body.g * R.body.h2, decay: R.body.d * 0.5, attack: 0.001 });
    // Blast: broadband gas.
    s.noise(d, t, { kind: 'pink', filter: 'lowpass', freq: R.blast.f0 * fj(), freqEnd: R.blast.f1, q: 0.6, gain: R.blast.g * jit(0.1), decay: R.blast.d * (1 + fd * 1.5) * rapid, attack: 0.001 });
    // Formant: the weapon's vowel.
    s.noise(d, t, { filter: 'bandpass', freq: R.formant.f * fj(), q: R.formant.q, gain: R.formant.g * jit(0.1), decay: R.formant.d * rapid, attack: 0.001 });
    // Ring and rattle: close-range detail only.
    if (R.ring && close > 0.05) {
      s.noise(d, t + 0.002, { filter: 'bandpass', freq: R.ring.f * jit(0.02), q: 9, gain: R.ring.g * close, decay: R.ring.d * rapid, attack: 0.002 });
      s.tone(d, t + 0.002, { freq: R.ring.f * jit(0.015), gain: R.ring.g * 0.14 * close, decay: R.ring.d * 0.8, attack: 0.002 });
    }
    if (R.rattle && close > 0.05) {
      for (const at of R.rattle.t) s.click(d, t + at + rand(-0.003, 0.003), R.rattle.f * jit(0.08), R.rattle.g * close * jit(0.15), 5, 0.01);
    }
    this.voiceLayer(weapon, d, t, close, fd, p);
    // Tail (+ a distant "boom" that carries over range).
    s.noise(d, t + 0.008, { kind: 'pink', filter: 'lowpass', freq: R.tail.f0 * fj(), freqEnd: R.tail.f1, q: 0.5, gain: R.tail.g * (1 + fd * 0.5), attack: 0.012, decay: R.tail.d * (1 + fd) * rapid, pan });
    if (fd > 0) s.noise(d, t + 0.01, { kind: 'brown', filter: 'lowpass', freq: 380, freqEnd: 120, gain: 0.45 * fd * R.vol, attack: 0.015, decay: 0.5 + 0.8 * fd });
    if (local) {
      if (R.sub > 0) s.tone(d, t, { freq: 58 * p, freqEnd: 38, gain: R.sub * 0.55, decay: 0.09, attack: 0.002 });
      if (R.casing > 0 && Math.random() < R.casing) this.casing(d, t + rand(0.34, 0.52));
    }
  }

  /** Weapon-specific extra layers. */
  private voiceLayer(w: WeaponId, d: AudioNode, t: number, close: number, fd: number, p: number): void {
    const s = this.s;
    if (w === 'pulse') {
      // Electronic "pew": square glide with a beating partner + chirp.
      s.tone(d, t, { wave: 'square', freq: 1100 * p, freqEnd: 190, glide: 0.06, gain: 0.3, decay: 0.07, filter: { type: 'lowpass', freq: 3600, q: 1.5 } });
      s.tone(d, t, { wave: 'square', freq: 1163 * p, freqEnd: 201, glide: 0.06, gain: 0.13, decay: 0.06, filter: { type: 'lowpass', freq: 3000 } });
      s.tone(d, t, { freq: 2200 * p, freqEnd: 600, glide: 0.05, gain: 0.16, decay: 0.05 });
      if (close > 0.05) s.tone(d, t, { freq: 5200, freqEnd: 2600, glide: 0.02, gain: 0.04 * close, decay: 0.02 });
      s.noise(d, t + 0.01, { filter: 'bandpass', freq: 5200, q: 3, gain: 0.05 * (1 - fd), decay: 0.12 });
    } else if (w === 'sunspear') {
      // Zap (rising saw) → roar (the blast/tail layers) + sizzle + sub.
      s.tone(d, t, { wave: 'sawtooth', freq: 180 * p, freqEnd: 1500, glide: 0.12, gain: 0.14, decay: 0.2, filter: { type: 'bandpass', freq: 1800, q: 0.9 } });
      s.tone(d, t, { freq: 2600 * p, freqEnd: 3700, glide: 0.3, gain: 0.06, decay: 0.55, vib: [7, 25] });
      s.tone(d, t, { wave: 'sawtooth', freq: 55, gain: 0.2, decay: 0.8, attack: 0.02, filter: { type: 'lowpass', freq: 380 } });
      s.noise(d, t, { filter: 'highpass', freq: 6000, gain: 0.2 * (1 - 0.6 * fd), decay: 0.4, attack: 0.004 });
    } else if (w === 'longline' && close > 0.05) {
      // Long barrel ring-out.
      s.tone(d, t + 0.004, { freq: 1480 * p, gain: 0.025 * close, decay: 0.45 });
    }
  }

  /** Brass casing hitting the ground: two little bounces. */
  private casing(d: AudioNode, t: number): void {
    const s = this.s;
    const f = rand(4200, 5200);
    for (const [dt, g] of [
      [0, 0.03],
      [rand(0.07, 0.11), 0.016],
    ] as const) {
      s.tone(d, t + dt, { freq: f, gain: g, decay: 0.06, attack: 0.0008 });
      s.tone(d, t + dt, { freq: f * 1.51, gain: g * 0.6, decay: 0.04, attack: 0.0008 });
      s.tone(d, t + dt, { freq: f * 2.23, gain: g * 0.35, decay: 0.03, attack: 0.0008 });
    }
  }

  dryFire(weapon: WeaponId): void {
    const r = this.spatial.route(undefined, 0.15, { reverb: 0.02, prio: 3 });
    if (!r) return;
    const s = this.s;
    const t = s.now;
    const d = r.input;
    if (FAMILY[weapon] === 'energy') {
      s.click(d, t, 2600, 0.2, 4, 0.01);
      s.tone(d, t + 0.01, { wave: 'square', freq: 220, freqEnd: 150, gain: 0.07, decay: 0.08, filter: { type: 'lowpass', freq: 900 } });
    } else {
      // Hammer/striker falling on nothing: sharp dry tick with a small ring.
      s.clack(d, t, 3200 * PITCH[weapon], 0.32, 0.03, 900);
    }
  }

  reload(weapon: WeaponId, stage: ReloadStage, pos?: Vec3): void {
    // Enemy reloads carry to ~25 m (the fade only starts past 23 m).
    const r = this.spatial.route(pos, 0.7, { maxDist: 32, reverb: 0.1, gain: pos ? 1.8 : 0.9, prio: pos ? 2 : 3, ref: 1.5, rolloff: 0.9 });
    if (!r) return;
    const s = this.s;
    const t = s.now + r.delay;
    const d = r.input;
    const k = PITCH[weapon] ?? 1;
    const fam = FAMILY[weapon] ?? 'ballistic';
    switch (stage) {
      case 'start':
        // Handling: cloth + a light grip tap.
        s.noise(d, t, { kind: 'pink', filter: 'bandpass', freq: 750, freqEnd: 1100, q: 0.7, gain: 0.14, attack: 0.03, decay: 0.14 });
        s.click(d, t + 0.05, 1800 * k, 0.08, 3, 0.015);
        break;
      case 'mag_out':
        if (fam === 'energy') {
          s.click(d, t, 2900 * k, 0.28, 4);
          s.noise(d, t + 0.01, { filter: 'bandpass', freq: 4200, q: 0.8, gain: 0.14, attack: 0.02, decay: 0.18 });
          s.tone(d, t + 0.02, { freq: 1200 * k, freqEnd: 480, glide: 0.18, gain: 0.05, decay: 0.2 });
        } else {
          s.click(d, t, 3200 * k, 0.22, 5);
          s.slideNoise(d, t + 0.012, 1400 * k, 800 * k, 0.3, 0.075);
          s.tone(d, t + 0.09, { freq: 210 * k, freqEnd: 150, gain: 0.07, decay: 0.05 });
        }
        break;
      case 'mag_in':
        if (fam === 'energy') {
          s.slideNoise(d, t, 900 * k, 1500 * k, 0.2, 0.05);
          s.clack(d, t + 0.05, 1300 * k, 0.38, 0.05, 170);
          // Coil whine powering up, then a "ready" blip.
          s.tone(d, t + 0.08, { freq: 380, freqEnd: 2400 * k, glide: 0.35, gain: 0.05, attack: 0.04, decay: 0.34 });
          s.tone(d, t + 0.08, { wave: 'sawtooth', freq: 190, freqEnd: 1200 * k, glide: 0.35, gain: 0.012, attack: 0.04, decay: 0.3, filter: { type: 'bandpass', freq: 1400, q: 1 } });
          s.tone(d, t + 0.46, { freq: 2400 * k, gain: 0.04, decay: 0.06 });
        } else {
          s.slideNoise(d, t, 900 * k, 1500 * k, 0.24, 0.06);
          s.clack(d, t + 0.06, 1500 * k, 0.5, 0.06, 170 * k);
          s.click(d, t + 0.068, 3800 * k, 0.14, 6);
        }
        break;
      case 'chamber':
        if (fam === 'bolt') this.bolt(d, t, k, !pos);
        else if (fam === 'energy') {
          s.click(d, t, 2400 * k, 0.2, 4);
          s.tone(d, t + 0.02, { freq: 600, freqEnd: 3000 * k, glide: 0.2, gain: 0.04, attack: 0.02, decay: 0.2 });
          s.clack(d, t + 0.18, 1900 * k, 0.3, 0.05);
        } else {
          // Charging handle: pull (click + slide) … release (slam + ring).
          s.click(d, t, 2600 * k, 0.2, 4);
          s.slideNoise(d, t + 0.01, 1200 * k, 2200 * k, 0.22, 0.08);
          s.clack(d, t + 0.12, 1800 * k, 0.5, 0.1, 140 * k);
        }
        break;
      case 'shell':
        // Shell push: plastic "shk" + seat click.
        s.noise(d, t, { filter: 'bandpass', freq: 900, freqEnd: 1600, q: 1.5, gain: 0.3, attack: 0.008, decay: 0.045 });
        s.click(d, t + 0.028, 2800, 0.2, 4);
        s.tone(d, t + 0.028, { freq: 250, freqEnd: 170, gain: 0.08, decay: 0.04 });
        break;
    }
  }

  private bolt(d: AudioNode, t: number, k: number, local: boolean): void {
    const s = this.s;
    s.click(d, t, 2600 * k, 0.25, 5); // lift
    s.slideNoise(d, t + 0.02, 1100 * k, 650 * k, 0.28, 0.09); // back
    s.clack(d, t + 0.11, 1300 * k, 0.28, 0.04); // stop
    s.slideNoise(d, t + 0.16, 650 * k, 1150 * k, 0.26, 0.08); // forward
    s.clack(d, t + 0.25, 1500 * k, 0.5, 0.08, 120); // lock
    if (local) this.casing(d, t + rand(0.5, 0.62));
  }

  /** Pump (Breaker) or bolt cycle (Longline) after a shot. */
  pump(weapon: WeaponId, pos?: Vec3): void {
    const r = this.spatial.route(pos, 0.9, { maxDist: 40, reverb: 0.12, gain: pos ? 1.4 : 1, prio: pos ? 2 : 3, ref: 1.5 });
    if (!r) return;
    const s = this.s;
    const t = s.now + r.delay + 0.04;
    const d = r.input;
    if (weapon === 'longline') {
      this.bolt(d, t, PITCH.longline, !pos);
      return;
    }
    // "chk-chk": back (slide + clack), forward (slide + slam with ring).
    s.slideNoise(d, t, 1500, 900, 0.3, 0.07);
    s.clack(d, t + 0.06, 1100, 0.55, 0.05, 150);
    s.slideNoise(d, t + 0.16, 900, 1500, 0.26, 0.05);
    s.clack(d, t + 0.21, 1600, 0.6, 0.12, 180);
    if (!pos) {
      // Plastic hull hitting the ground.
      for (const [dt, g] of [
        [0.52, 0.06],
        [0.66, 0.03],
      ] as const) {
        s.tone(d, t + dt, { freq: 900, freqEnd: 600, gain: g, decay: 0.03 });
        s.noise(d, t + dt, { filter: 'bandpass', freq: 1200, q: 1.5, gain: g * 1.5, decay: 0.02 });
      }
    }
  }

  /** Sunspear charge-up whine (0.6 s). */
  charge(pos?: Vec3): void {
    const r = this.spatial.route(pos, 0.9, { maxDist: 90, reverb: 0.2, prio: pos ? 2 : 3, gain: pos ? 1.3 : 1 });
    if (!r) return;
    const s = this.s;
    const t = s.now + r.delay;
    const d = r.input;
    s.tone(d, t, { wave: 'sawtooth', freq: 240, freqEnd: 1900, glide: 0.6, gain: 0.07, attack: 0.08, hold: 0.3, decay: 0.25, filter: { type: 'bandpass', freq: 700, freqEnd: 2600, q: 1.4 }, vib: [9, 30] });
    s.tone(d, t, { freq: 480, freqEnd: 3800, glide: 0.6, gain: 0.06, attack: 0.08, hold: 0.3, decay: 0.25, vib: [13, 18] });
    s.tone(d, t, { freq: 60, freqEnd: 90, gain: 0.12, attack: 0.3, decay: 0.3 });
    s.noise(d, t + 0.1, { filter: 'highpass', freq: 5000, gain: 0.05, attack: 0.35, decay: 0.2 });
  }

  swap(weapon: WeaponId): void {
    const r = this.spatial.route(undefined, 0.45, { reverb: 0.05, prio: 3 });
    if (!r) return;
    const s = this.s;
    const t = s.now;
    const d = r.input;
    const k = PITCH[weapon] ?? 1;
    const fam = FAMILY[weapon] ?? 'ballistic';
    // Cloth whoosh as the weapon comes up.
    s.noise(d, t, { kind: 'pink', filter: 'bandpass', freq: 500, freqEnd: 1300, q: 0.8, gain: 0.16, attack: 0.05, decay: 0.12 });
    const heavy = weapon === 'breaker' || weapon === 'longline';
    s.clack(d, t + 0.13, (heavy ? 1100 : 2000) * k, heavy ? 0.36 : 0.26, 0.06, heavy ? 120 : 0);
    if (fam === 'energy') {
      s.tone(d, t + 0.16, { freq: 600 * k, freqEnd: 1800 * k, glide: 0.09, gain: 0.04, decay: 0.1 });
      s.tone(d, t + 0.27, { freq: 2400 * k, gain: 0.03, decay: 0.06 });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — synthesized sound effects (100% procedural Web Audio).
//
// Weapons live in weapons.ts; this module covers movement foley, combat
// feedback, world events, zones, UI and the low-health heartbeat.
//
// Footsteps are two-part (heel strike + toe roll) with a per-surface voice
// (band, low thud, grit grains, resonances, hollow boards, snow squeak, leaf
// rustle, splashes) and a per-gait shape (walk / sprint with gear jingle /
// crouch soft & dark). Enemy steps are louder and carry further than friendly
// ones, and all positional steps go through the Spatializer (HRTF, air
// absorption, occlusion) so they read clearly as direction + distance.
//
// Feedback (hitmarkers, damage, heartbeat) goes to the feedback bus, which is
// never muffled; damage briefly low-passes the world bus ("concussion") and
// low health adds subtle tunnel hearing plus a heartbeat that sidechain-ducks
// the music.
// ─────────────────────────────────────────────────────────────────────────────

import type { UiSound } from '../contracts';
import type { Faction, SurfaceTag, Vec3, WeaponId } from '../../shared/types';
import type { AudioCore } from './core';
import type { Route, RouteOpts, Spatializer } from './spatial';
import { jit, mtof, rand, Synth } from './synth';
import { WeaponSfx, type ReloadStage } from './weapons';

interface SurfaceVoice {
  filter: BiquadFilterType;
  f: number;
  q: number;
  thud: number;
  thudG: number;
  grit?: number;
  gritF?: number;
  ring?: number[];
  ringG?: number;
  hollow?: number;
  squeak?: boolean;
  splash?: boolean;
  rustle?: boolean;
  level: number;
}

const SURF: Record<SurfaceTag | 'player', SurfaceVoice> = {
  concrete: { filter: 'bandpass', f: 1600, q: 0.9, thud: 95, thudG: 0.3, grit: 2, gritF: 3200, level: 1 },
  tile: { filter: 'bandpass', f: 2400, q: 1.3, thud: 110, thudG: 0.28, ring: [3900], ringG: 0.03, level: 1 },
  ceramic: { filter: 'bandpass', f: 2800, q: 1.5, thud: 120, thudG: 0.25, ring: [3400, 5100], ringG: 0.04, level: 0.9 },
  rock: { filter: 'bandpass', f: 1300, q: 0.8, thud: 85, thudG: 0.3, grit: 3, gritF: 2500, level: 1 },
  metal: { filter: 'bandpass', f: 2100, q: 1.4, thud: 140, thudG: 0.25, ring: [2860, 4150, 710], ringG: 0.06, hollow: 190, level: 1.05 },
  wood: { filter: 'bandpass', f: 650, q: 1.3, thud: 120, thudG: 0.32, hollow: 220, level: 1 },
  plaster: { filter: 'bandpass', f: 1300, q: 0.8, thud: 100, thudG: 0.28, level: 0.9 },
  glass: { filter: 'highpass', f: 3500, q: 0.7, thud: 150, thudG: 0.2, ring: [4800, 6200], ringG: 0.05, level: 0.8 },
  grass: { filter: 'lowpass', f: 1800, q: 0.5, thud: 70, thudG: 0.25, grit: 5, gritF: 2600, rustle: true, level: 0.75 },
  foliage: { filter: 'lowpass', f: 2200, q: 0.5, thud: 70, thudG: 0.22, grit: 6, gritF: 3200, rustle: true, level: 0.75 },
  dirt: { filter: 'lowpass', f: 1100, q: 0.6, thud: 80, thudG: 0.3, grit: 4, gritF: 1800, level: 0.85 },
  sand: { filter: 'bandpass', f: 1900, q: 0.6, thud: 70, thudG: 0.25, grit: 7, gritF: 2200, level: 0.8 },
  snow: { filter: 'bandpass', f: 1500, q: 0.7, thud: 60, thudG: 0.22, grit: 6, gritF: 1400, squeak: true, level: 0.8 },
  water: { filter: 'bandpass', f: 1200, q: 0.8, thud: 60, thudG: 0.2, splash: true, level: 0.9 },
  fabric: { filter: 'lowpass', f: 900, q: 0.5, thud: 70, thudG: 0.25, level: 0.5 },
  player: { filter: 'bandpass', f: 1300, q: 1, thud: 150, thudG: 0.35, ring: [3900], ringG: 0.04, level: 0.9 },
};

type Gait = 'walk' | 'sprint' | 'crouch';
const GAIT: Record<Gait, { level: number; gap: number; bright: number; range: number }> = {
  walk: { level: 0.55, gap: 0.055, bright: 1, range: 34 },
  sprint: { level: 0.85, gap: 0.034, bright: 1.12, range: 46 },
  crouch: { level: 0.26, gap: 0.09, bright: 0.72, range: 13 },
};

export class Sfx {
  private readonly core: AudioCore;
  private readonly spatial: Spatializer;
  readonly synth: Synth;
  readonly weapons: WeaponSfx;
  private xpStep = 0;
  private xpLast = 0;
  private heartbeat = 0;
  private heartNext = 0;
  private hurtUntil = 0;
  private lastUi = new Map<UiSound, number>();
  private lastHit = 0;

  constructor(core: AudioCore, spatial: Spatializer) {
    this.core = core;
    this.spatial = spatial;
    this.synth = new Synth(core);
    this.weapons = new WeaponSfx(this.synth, spatial);
  }

  private get now(): number {
    return this.core.ctx.currentTime;
  }

  /** Bell/chime (kept for the announcer chime). */
  bell(dest: AudioNode, t: number, f: number, gain: number, decay = 0.9): void {
    this.synth.bell(dest, t, f, gain, decay);
  }

  private route(pos: Vec3 | undefined, dur: number, opts?: RouteOpts): Route | null {
    return this.spatial.route(pos, dur, opts);
  }

  // ── Weapons (delegated) ─────────────────────────────────────────────────

  shot(weapon: WeaponId, pos?: Vec3): void {
    this.weapons.shot(weapon, pos);
  }

  dryFire(weapon: WeaponId = 'meridian'): void {
    this.weapons.dryFire(weapon);
  }

  reload(weapon: WeaponId, stage: ReloadStage, pos?: Vec3): void {
    this.weapons.reload(weapon, stage, pos);
  }

  pump(weapon: WeaponId, pos?: Vec3): void {
    this.weapons.pump(weapon, pos);
  }

  charge(pos?: Vec3): void {
    this.weapons.charge(pos);
  }

  swap(weapon: WeaponId): void {
    this.weapons.swap(weapon);
  }

  // ── Movement ────────────────────────────────────────────────────────────

  /** One foot contact: heel strike (+ toe roll `gap` s later). */
  private step(d: AudioNode, t: number, s: SurfaceVoice, level: number, bright: number, gap: number): void {
    const syn = this.synth;
    const lv = level * s.level * jit(0.12);
    const b = bright * jit(0.08);
    if (s.splash) {
      syn.noise(d, t, { filter: 'bandpass', freq: 600, freqEnd: 2400, q: 1, gain: lv * 0.45, attack: 0.004, decay: 0.16 });
      syn.noise(d, t + gap, { filter: 'bandpass', freq: 1400, freqEnd: 700, q: 1.2, gain: lv * 0.25, attack: 0.01, decay: 0.12 });
      syn.tone(d, t + 0.03, { freq: rand(700, 1000), freqEnd: rand(1400, 1900), gain: lv * 0.05, decay: 0.05 });
      syn.tone(d, t, { freq: s.thud, freqEnd: s.thud * 0.6, gain: lv * s.thudG, decay: 0.06 });
      return;
    }
    // Heel.
    syn.noise(d, t, { filter: s.filter, freq: s.f * b, q: s.q, gain: lv * 0.5, decay: 0.045, attack: 0.001 });
    syn.tone(d, t, { freq: s.thud * jit(0.06), freqEnd: s.thud * 0.6, gain: lv * s.thudG, decay: 0.06, attack: 0.002 });
    // Toe roll: softer, a bit brighter.
    syn.noise(d, t + gap, { filter: s.filter, freq: s.f * b * 1.25, q: s.q, gain: lv * 0.24, decay: 0.03, attack: 0.002 });
    if (s.grit) {
      const n = Math.max(1, Math.round(s.grit * (0.6 + level * 0.6)));
      for (let i = 0; i < n; i++) {
        syn.noise(d, t + rand(0, gap + 0.035), { filter: 'bandpass', freq: (s.gritF ?? 2000) * b * rand(0.75, 1.3), q: 2.5, gain: lv * 0.2, decay: rand(0.008, 0.02), attack: 0.0008 });
      }
    }
    if (s.hollow) syn.tone(d, t, { freq: s.hollow * jit(0.04), freqEnd: s.hollow * 0.94, gain: lv * 0.12, decay: 0.13, attack: 0.002 });
    if (s.ring) for (const f of s.ring) syn.tone(d, t, { freq: f * b * jit(0.02), gain: lv * (s.ringG ?? 0.04), decay: 0.12, attack: 0.001 });
    if (s.squeak) syn.tone(d, t + gap * 0.5, { wave: 'triangle', freq: rand(1500, 1800), freqEnd: rand(2100, 2500), glide: 0.05, gain: lv * 0.035, decay: 0.05, filter: { type: 'bandpass', freq: 2000, q: 1.5 } });
    if (s.rustle) syn.noise(d, t + 0.01, { kind: 'pink', filter: 'bandpass', freq: 3200 * b, q: 0.7, gain: lv * 0.14, attack: 0.02, decay: 0.12 });
  }

  footstep(surface: SurfaceTag, pos: Vec3 | undefined, kind: Gait, friendly = false): void {
    const g = GAIT[kind] ?? GAIT.walk;
    const opts: RouteOpts = pos
      ? {
          maxDist: g.range * (friendly ? 0.75 : 1),
          reverb: 0.06,
          gain: friendly ? 0.72 : 1.4,
          prio: friendly ? 1 : 2,
          ref: 1.5,
          rolloff: 0.85,
        }
      : { reverb: 0.03, gain: 0.5, prio: 1 };
    const r = this.route(pos, 0.3, opts);
    if (!r) return;
    const t = this.now + r.delay;
    this.step(r.input, t, SURF[surface] ?? SURF.concrete, g.level, g.bright, g.gap);
    if (kind === 'sprint') {
      // Gear: sling jingle + cloth swish.
      this.synth.click(r.input, t + rand(0.02, 0.05), rand(5000, 6200), 0.035 * r.near + 0.01, 8, 0.02);
      this.synth.noise(r.input, t, { kind: 'pink', filter: 'bandpass', freq: 1100, q: 0.8, gain: 0.05, attack: 0.03, decay: 0.08 });
    }
  }

  jump(pos?: Vec3): void {
    const r = this.route(pos, 0.35, { maxDist: 22, reverb: 0.05, gain: pos ? 1.1 : 0.5, prio: pos ? 1 : 2, ref: 1.5 });
    if (!r) return;
    const t = this.now + r.delay;
    this.synth.noise(r.input, t, { kind: 'pink', filter: 'bandpass', freq: 600, freqEnd: 1400, q: 0.7, gain: 0.22, attack: 0.03, decay: 0.15 });
    this.synth.noise(r.input, t, { filter: 'bandpass', freq: 1500, q: 1, gain: 0.12, decay: 0.03 });
  }

  land(surface: SurfaceTag, impact: number, pos?: Vec3): void {
    const k = Math.max(0.3, Math.min(1.4, impact / 8));
    const r = this.route(pos, 0.4, { maxDist: 32, reverb: 0.1, gain: pos ? 1.2 : 0.6, prio: pos ? 2 : 2, ref: 1.5 });
    if (!r) return;
    const t = this.now + r.delay;
    const s = SURF[surface] ?? SURF.concrete;
    this.step(r.input, t, s, k, 0.85, 0.028);
    this.synth.tone(r.input, t, { freq: 72, freqEnd: 40, gain: 0.4 * k, decay: 0.14 });
    // Kit settles a beat after the feet.
    this.synth.click(r.input, t + 0.06, 4200, 0.04 * k, 6, 0.02);
    this.synth.noise(r.input, t + 0.02, { kind: 'pink', filter: 'bandpass', freq: 900, q: 0.7, gain: 0.08 * k, attack: 0.02, decay: 0.1 });
  }

  slide(surface: SurfaceTag, pos?: Vec3): void {
    const r = this.route(pos, 0.9, { maxDist: 30, reverb: 0.08, gain: pos ? 1.1 : 0.55, prio: pos ? 2 : 2, ref: 1.5 });
    if (!r) return;
    const s = SURF[surface] ?? SURF.concrete;
    const t = this.now + r.delay;
    this.synth.noise(r.input, t, { kind: 'pink', filter: 'bandpass', freq: s.f * 0.9, freqEnd: s.f * 0.35, q: 0.8, gain: 0.42, attack: 0.03, hold: 0.15, decay: 0.5 });
    if (s.grit) for (let i = 0; i < 6; i++) this.synth.noise(r.input, t + rand(0, 0.5), { filter: 'bandpass', freq: (s.gritF ?? 2000) * rand(0.7, 1.2), q: 2.5, gain: 0.06, decay: 0.015 });
    if (s.ring) this.synth.tone(r.input, t, { freq: s.ring[0] * 0.5, gain: 0.02, attack: 0.05, decay: 0.5 });
  }

  mantle(pos?: Vec3): void {
    const r = this.route(pos, 0.45, { maxDist: 20, reverb: 0.05, gain: pos ? 1 : 0.55, prio: pos ? 1 : 2, ref: 1.5 });
    if (!r) return;
    const t = this.now + r.delay;
    // Hand slap on the ledge, body thump, cloth.
    this.synth.noise(r.input, t, { filter: 'bandpass', freq: 1200, q: 1.1, gain: 0.25, decay: 0.03 });
    this.synth.tone(r.input, t + 0.02, { freq: 130, freqEnd: 80, gain: 0.25, decay: 0.08 });
    this.synth.noise(r.input, t + 0.05, { kind: 'pink', filter: 'bandpass', freq: 900, q: 0.6, gain: 0.18, attack: 0.03, decay: 0.2 });
  }

  // ── Combat feedback ─────────────────────────────────────────────────────

  impact(surface: SurfaceTag | 'player', pos: Vec3): void {
    const r = this.route(pos, 0.45, { maxDist: 45, reverb: 0.12, prio: 1, ref: 1.5 });
    if (!r) return;
    const syn = this.synth;
    const s = SURF[surface] ?? SURF.concrete;
    const t = this.now + r.delay;
    const d = r.input;
    if (surface === 'player') {
      // Meaty thwack + a crisp armour tick.
      syn.noise(d, t, { filter: 'bandpass', freq: 1200 * jit(0.1), q: 1, gain: 0.4, decay: 0.05 });
      syn.tone(d, t, { freq: 150, freqEnd: 90, gain: 0.3, decay: 0.07 });
      syn.tone(d, t, { freq: 3900 * jit(0.03), gain: 0.04, decay: 0.08 });
      return;
    }
    syn.noise(d, t, { filter: s.filter === 'lowpass' ? 'bandpass' : s.filter, freq: s.f * 1.4 * jit(0.1), q: s.q, gain: 0.36 * s.level, decay: 0.045, attack: 0.0008 });
    syn.noise(d, t, { filter: 'highpass', freq: 4000, gain: 0.12, decay: 0.012, attack: 0.0006 });
    if (s.ring) for (const f of s.ring) syn.tone(d, t, { freq: f * 1.05 * jit(0.03), gain: 0.05, decay: 0.22 });
    if ((surface === 'metal' || surface === 'rock') && Math.random() < 0.28) {
      // Ricochet whine.
      syn.tone(d, t + 0.01, { freq: rand(2600, 3400), freqEnd: rand(1100, 1500), glide: 0.25, gain: 0.035, attack: 0.01, decay: 0.26, vib: [30, 20] });
    }
    if (s.grit) for (let i = 0; i < 4; i++) syn.noise(d, t + rand(0.02, 0.25), { filter: 'bandpass', freq: (s.gritF ?? 2000) * rand(0.6, 1.2), q: 2, gain: 0.05, decay: 0.015 });
    if (s.hollow) syn.tone(d, t, { freq: s.hollow * 1.4, freqEnd: s.hollow * 1.2, gain: 0.08, decay: 0.1 });
    if (surface === 'glass') for (let i = 0; i < 5; i++) syn.tone(d, t + rand(0.01, 0.2), { freq: rand(4000, 8000), gain: 0.02, decay: rand(0.04, 0.12) });
    if (s.splash) syn.noise(d, t, { filter: 'bandpass', freq: 800, freqEnd: 2600, q: 1, gain: 0.3, decay: 0.2 });
  }

  whizz(pos: Vec3): void {
    const r = this.route(pos, 0.3, { maxDist: 14, reverb: 0.02, prio: 3, gain: 1.4, noOcclusion: true, ref: 1 });
    if (!r) return;
    const t = this.now;
    // Supersonic snap + a falling "vvt" as it passes.
    this.synth.noise(r.input, t, { filter: 'highpass', freq: 3500, gain: 0.14, decay: 0.01, attack: 0.0006 });
    this.synth.noise(r.input, t, { filter: 'bandpass', freq: 4200, freqEnd: 1100, q: 3, gain: 0.34, attack: 0.02, decay: 0.12 });
  }

  hitmarker(kind: 'body' | 'head' | 'kill' | 'headkill'): void {
    // Dry, centred, never spatialized, never muffled.
    const d = this.core.buses.feedback;
    const syn = this.synth;
    const t = this.now;
    // Rapid body hits: rotate pitch slightly so automatic fire stays crisp.
    const close = t - this.lastHit < 0.12;
    this.lastHit = t;
    const v = close ? jit(0.03) : 1;
    if (kind === 'body') {
      syn.noise(d, t, { filter: 'bandpass', freq: 4300, q: 1.2, gain: 0.16, decay: 0.006, attack: 0.0005 });
      syn.tone(d, t, { freq: 3000 * v, gain: 0.12, decay: 0.04, attack: 0.001 });
      syn.tone(d, t, { freq: 1500 * v, gain: 0.05, decay: 0.02, attack: 0.001 });
      syn.tone(d, t, { freq: 170, freqEnd: 110, gain: 0.08, decay: 0.03 });
      return;
    }
    if (kind === 'head' || kind === 'headkill') {
      // Bright ringing ping with a slow beat (two detuned partials).
      syn.noise(d, t, { filter: 'highpass', freq: 6000, gain: 0.12, decay: 0.012, attack: 0.0005 });
      syn.tone(d, t, { freq: 3520 * v, gain: 0.12, decay: 0.42, attack: 0.001 });
      syn.tone(d, t, { freq: 3527 * v, gain: 0.06, decay: 0.42, attack: 0.001 });
      syn.tone(d, t, { freq: 5280 * v, gain: 0.05, decay: 0.26, attack: 0.001 });
      syn.tone(d, t, { freq: 7110 * v, gain: 0.025, decay: 0.14, attack: 0.001 });
      syn.tone(d, t, { freq: 190, freqEnd: 120, gain: 0.08, decay: 0.04 });
    }
    if (kind === 'kill' || kind === 'headkill') {
      // Two-note rising-fifth chime + low thump (headkill: an extra octave sparkle).
      const s0 = kind === 'headkill' ? t + 0.07 : t;
      syn.bell(d, s0, mtof(88), 0.1, 0.5);
      syn.bell(d, s0 + 0.085, mtof(95), 0.09, 0.85);
      if (kind === 'headkill') syn.bell(d, s0 + 0.17, mtof(100), 0.05, 0.9);
      syn.tone(d, s0, { freq: 82, freqEnd: 42, gain: 0.3, decay: 0.2, attack: 0.002 });
      syn.noise(d, s0, { kind: 'brown', filter: 'lowpass', freq: 300, gain: 0.12, decay: 0.12 });
    }
  }

  hurt(amount: number): void {
    const k = Math.max(0.2, Math.min(1, amount / 40));
    const d = this.core.buses.feedback;
    const syn = this.synth;
    const t = this.now;
    syn.tone(d, t, { freq: 115, freqEnd: 50, gain: 0.42 * k, decay: 0.16, attack: 0.002 });
    syn.noise(d, t, { kind: 'brown', filter: 'lowpass', freq: 520, gain: 0.3 * k, decay: 0.14 });
    syn.noise(d, t, { filter: 'bandpass', freq: 950, q: 1, gain: 0.1 * k, decay: 0.03 });
    // Concussion: the world briefly goes dull, then comes back.
    const wf = this.core.worldFilter.frequency;
    const base = this.worldBase();
    const dip = Math.max(700, base * (1 - 0.8 * k));
    wf.cancelScheduledValues(t);
    wf.setTargetAtTime(dip, t, 0.012);
    wf.setTargetAtTime(base, t + 0.05 + 0.12 * k, 0.12 + 0.18 * k);
    this.hurtUntil = t + 0.8;
  }

  private worldBase(): number {
    // Low health: subtle tunnel hearing (20 kHz → ~9 kHz).
    return 20000 * (1 - 0.55 * this.heartbeat);
  }

  explosion(pos: Vec3): void {
    const r = this.route(pos, 2.2, { maxDist: 220, reverb: 0.45, echo: 0.9, gain: 1.3, prio: 3, ref: 3, rolloff: 0.9 });
    if (!r) return;
    const syn = this.synth;
    const t = this.now + r.delay;
    const d = r.input;
    syn.tone(d, t, { freq: 72, freqEnd: 26, glide: 0.6, gain: 1.1, decay: 0.85, attack: 0.002 });
    syn.noise(d, t, { kind: 'brown', filter: 'lowpass', freq: 1600, freqEnd: 180, gain: 1, attack: 0.003, decay: 1.5 });
    syn.noise(d, t, { filter: 'highpass', freq: 2200, gain: 0.55 * (0.3 + r.near * 0.7), decay: 0.07, attack: 0.0008 });
    syn.noise(d, t, { filter: 'bandpass', freq: 600, q: 0.8, gain: 0.5, decay: 0.3 });
    for (let i = 0; i < 7; i++) syn.noise(d, t + 0.12 + Math.random() * 0.7, { filter: 'bandpass', freq: rand(1800, 4200), q: 3, gain: 0.06 * (0.3 + r.near), decay: 0.03 });
    if (r.dist > 40) syn.noise(d, t + 0.05, { kind: 'brown', filter: 'lowpass', freq: 300, gain: 0.5, attack: 0.05, decay: 1.4 });
  }

  smoke(pos: Vec3): void {
    const r = this.route(pos, 2, { maxDist: 50, reverb: 0.15, prio: 1 });
    if (!r) return;
    const t = this.now + r.delay;
    this.synth.noise(r.input, t, { filter: 'bandpass', freq: 1800, q: 0.9, gain: 0.35, decay: 0.05 });
    this.synth.tone(r.input, t, { freq: 140, freqEnd: 80, gain: 0.2, decay: 0.08 });
    this.synth.noise(r.input, t + 0.03, { filter: 'highpass', freq: 3000, freqEnd: 1500, gain: 0.26, attack: 0.08, hold: 0.3, decay: 1.3 });
  }

  bounce(pos: Vec3): void {
    const r = this.route(pos, 0.35, { maxDist: 35, reverb: 0.1, prio: 2 });
    if (!r) return;
    const t = this.now + r.delay;
    this.synth.clack(r.input, t, 2200 * jit(0.1), 0.3, 0.14);
    this.synth.tone(r.input, t, { freq: 180, freqEnd: 120, gain: 0.12, decay: 0.05 });
  }

  pickup(pos?: Vec3): void {
    const r = this.route(pos, 1, { maxDist: 40, reverb: 0.2, prio: pos ? 1 : 3 });
    if (!r) return;
    const t = this.now + r.delay;
    [74, 78, 81, 86].forEach((m, i) => this.synth.bell(r.input, t + i * 0.06, mtof(m), 0.07, 0.6));
  }

  zone(kind: 'capturing' | 'captured' | 'lost' | 'contested'): void {
    const d = this.core.buses.ui;
    const syn = this.synth;
    const t = this.now;
    switch (kind) {
      case 'capturing':
        syn.tone(d, t, { wave: 'triangle', freq: mtof(69), gain: 0.06, attack: 0.04, decay: 0.3 });
        syn.tone(d, t + 0.1, { wave: 'triangle', freq: mtof(76), gain: 0.05, attack: 0.03, decay: 0.35 });
        break;
      case 'captured':
        // Warm rising Dmaj9 figure over a soft swell.
        [62, 66, 69, 74, 76].forEach((m, i) => syn.bell(d, t + i * 0.075, mtof(m + 12), 0.085, 1.1));
        syn.tone(d, t, { wave: 'triangle', freq: mtof(50), gain: 0.08, attack: 0.05, decay: 1, filter: { type: 'lowpass', freq: 800 } });
        break;
      case 'lost':
        [69, 65, 62].forEach((m, i) => syn.tone(d, t + i * 0.13, { wave: 'triangle', freq: mtof(m), gain: 0.1, decay: 0.45, filter: { type: 'lowpass', freq: 1800 } }));
        syn.tone(d, t, { freq: mtof(38), gain: 0.1, attack: 0.02, decay: 0.7 });
        break;
      case 'contested':
        for (let i = 0; i < 3; i++) syn.tone(d, t + i * 0.15, { wave: 'square', freq: i % 2 ? 660 : 554, gain: 0.035, decay: 0.09, filter: { type: 'lowpass', freq: 1800 } });
        break;
    }
  }

  spawn(pos?: Vec3): void {
    const r = this.route(pos, 1.1, { maxDist: 30, reverb: 0.25, gain: pos ? 0.8 : 0.6, prio: pos ? 1 : 2 });
    if (!r) return;
    const t = this.now + r.delay;
    this.synth.noise(r.input, t, { kind: 'pink', filter: 'bandpass', freq: 400, freqEnd: 2400, q: 1, gain: 0.22, attack: 0.25, decay: 0.3 });
    this.synth.bell(r.input, t + 0.35, mtof(81), 0.05, 0.7);
  }

  elimination(faction: Faction, pos: Vec3): void {
    const r = this.route(pos, 1.5, { maxDist: 70, reverb: 0.3, prio: 2 });
    if (!r) return;
    const syn = this.synth;
    const t = this.now + r.delay;
    if (faction === 0) {
      // Halcyon: fired ceramic shattering into shards.
      syn.noise(r.input, t, { filter: 'highpass', freq: 3500, gain: 0.32, decay: 0.12 });
      for (let i = 0; i < 9; i++) syn.tone(r.input, t + Math.random() * 0.25, { freq: rand(3000, 7500), gain: 0.045, decay: rand(0.08, 0.28) });
      syn.tone(r.input, t, { freq: 150, freqEnd: 70, gain: 0.24, decay: 0.15 });
    } else {
      // The Bloom: a soft airy bloom of light petals.
      syn.noise(r.input, t, { kind: 'pink', filter: 'bandpass', freq: 900, freqEnd: 3200, q: 1.2, gain: 0.2, attack: 0.12, decay: 0.8 });
      [76, 81, 83, 88].forEach((m, i) => syn.bell(r.input, t + 0.05 + i * 0.07, mtof(m), 0.04, 1.1));
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────

  ui(s: UiSound): void {
    const d = this.core.buses.ui;
    const syn = this.synth;
    const t = this.now;
    // De-duplicate identical sounds fired in the same few ms (delegation can double up).
    const last = this.lastUi.get(s) ?? -1;
    if (t - last < (s === 'hover' ? 0.04 : 0.018) && s !== 'xpTick') return;
    this.lastUi.set(s, t);
    switch (s) {
      case 'hover':
        syn.tone(d, t, { freq: 2350, freqEnd: 2150, gain: 0.025, decay: 0.028, filter: { type: 'lowpass', freq: 4000 } });
        break;
      case 'click':
        syn.noise(d, t, { filter: 'bandpass', freq: 3000, q: 2, gain: 0.1, decay: 0.01 });
        syn.tone(d, t, { freq: 920, freqEnd: 640, gain: 0.08, decay: 0.045 });
        break;
      case 'back':
        syn.tone(d, t, { wave: 'triangle', freq: 660, gain: 0.08, decay: 0.06 });
        syn.tone(d, t + 0.06, { wave: 'triangle', freq: 440, gain: 0.08, decay: 0.1 });
        break;
      case 'confirm':
        syn.tone(d, t, { wave: 'triangle', freq: 523.25, gain: 0.09, decay: 0.07 });
        syn.tone(d, t + 0.07, { wave: 'triangle', freq: 783.99, gain: 0.09, decay: 0.16 });
        syn.tone(d, t + 0.07, { freq: 1568, gain: 0.02, decay: 0.2 });
        break;
      case 'toggle':
        syn.noise(d, t, { filter: 'bandpass', freq: 2200, q: 3, gain: 0.1, decay: 0.01 });
        syn.tone(d, t, { freq: 1500, gain: 0.04, decay: 0.03 });
        break;
      case 'error':
        syn.tone(d, t, { wave: 'square', freq: 180, gain: 0.05, decay: 0.08, filter: { type: 'lowpass', freq: 900 } });
        syn.tone(d, t + 0.1, { wave: 'square', freq: 150, gain: 0.05, decay: 0.12, filter: { type: 'lowpass', freq: 900 } });
        break;
      case 'unlock':
        [79, 83, 86, 91, 95].forEach((m, i) => syn.bell(d, t + i * 0.05, mtof(m), 0.045, 0.8));
        break;
      case 'xpTick': {
        this.xpStep = t - this.xpLast < 0.25 ? Math.min(14, this.xpStep + 1) : 0;
        this.xpLast = t;
        syn.tone(d, t, { freq: mtof(84 + this.xpStep), gain: 0.035, decay: 0.04 });
        break;
      }
      case 'levelUp':
        [62, 66, 69, 74].forEach((m) => syn.tone(d, t, { wave: 'triangle', freq: mtof(m + 12), gain: 0.06, attack: 0.03, decay: 1.4, filter: { type: 'lowpass', freq: 3500 } }));
        [86, 90, 93, 98].forEach((m, i) => syn.bell(d, t + 0.1 + i * 0.07, mtof(m), 0.045, 1.2));
        syn.tone(d, t, { freq: 73, freqEnd: 50, gain: 0.25, decay: 0.4 });
        break;
      case 'matchFound':
        [74, 78, 81].forEach((m, i) => syn.bell(d, t + i * 0.12, mtof(m), 0.09, 1));
        break;
      case 'countdown':
        syn.tone(d, t, { freq: 880, gain: 0.09, decay: 0.12 });
        syn.tone(d, t, { freq: 1760, gain: 0.02, decay: 0.08 });
        break;
      case 'go':
        syn.tone(d, t, { freq: 1320, gain: 0.1, decay: 0.35 });
        [69, 73, 76].forEach((m) => syn.tone(d, t, { wave: 'triangle', freq: mtof(m), gain: 0.05, decay: 0.6 }));
        break;
    }
  }

  // ── Heartbeat (low health) ──────────────────────────────────────────────

  setHeartbeat(intensity: number): void {
    const k = Math.max(0, Math.min(1, intensity));
    if (Math.abs(k - this.heartbeat) < 1e-3) return;
    this.heartbeat = k;
    const t = this.now;
    if (k <= 0.01) this.resetHeartbeat();
    if (t > this.hurtUntil) this.core.worldFilter.frequency.setTargetAtTime(this.worldBase(), t, 0.4);
  }

  /** Called every frame by the AudioSystem (schedules ~150 ms ahead). */
  update(): void {
    const t = this.now;
    this.spatial.reap(t);
    if (this.heartbeat <= 0.01) return;
    if (this.heartNext < t) this.heartNext = t + 0.05;
    if (this.heartNext > t + 0.15) return;
    const k = this.heartbeat;
    const d = this.core.buses.feedback;
    const at = this.heartNext;
    const syn = this.synth;
    // "Lub" … "dub": soft filtered thumps, felt more than heard.
    syn.tone(d, at, { freq: 62, freqEnd: 42, gain: 0.34 * (0.45 + 0.55 * k), attack: 0.012, decay: 0.13, filter: { type: 'lowpass', freq: 180 } });
    syn.noise(d, at, { kind: 'brown', filter: 'lowpass', freq: 140, gain: 0.1 * k, attack: 0.01, decay: 0.08 });
    syn.tone(d, at + 0.21, { freq: 55, freqEnd: 40, gain: 0.24 * (0.45 + 0.55 * k), attack: 0.012, decay: 0.12, filter: { type: 'lowpass', freq: 160 } });
    // Sidechain: music dips on each beat.
    const sc = this.core.musicSidechain.gain;
    sc.setTargetAtTime(1 - 0.32 * k, at, 0.02);
    sc.setTargetAtTime(1, at + 0.12, 0.16);
    const bpm = 64 + k * 40;
    this.heartNext = at + 60 / bpm;
  }

  /** Heartbeat off: restore the music sidechain and world filter. */
  resetHeartbeat(): void {
    const t = this.now;
    this.core.musicSidechain.gain.setTargetAtTime(1, t, 0.2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — sample bank: procedural sounds rendered once, played cheaply.
//
// Live synthesis of one gunshot is ~15 sources + biquads (≈ 9 ms of DSP over
// its life); a firefight would spend a big slice of the audio thread on it.
// At startup (in the background, on the offline rendering thread) the bank
// renders each weapon's recipe several times with the exact same synthesis
// code (weapons.ts) into mono AudioBuffers:
//   local ×3 (your own gun: sub, rattle, casings), near ×2 (another player
//   up close), far ×2 (100 m recipe: no crack/rattle, boom + long tail, at
//   half sample rate — it has no highs anyway)
// and the music kit (kick, snare, hats, rim, shaker, tom, crash).
// Playback picks a variant (never the same twice in a row) and adds pitch /
// level jitter, so automatic fire still never sounds machine-gunned. Until
// the bank is ready (or without OfflineAudioContext) everything falls back
// to live synthesis. Memory: ≈ 10 MB (≈ 6 MB in lite mode).
// ─────────────────────────────────────────────────────────────────────────────

import type { WeaponId } from '../../shared/types';
import type { AudioCore } from './core';
import type { Route, RouteOpts } from './spatial';
import { Synth } from './synth';
import { WeaponSfx } from './weapons';

export type ShotKind = 'local' | 'near' | 'far';
export type DrumKey = 'kick' | 'snare' | 'hat' | 'hatOpen' | 'rim' | 'shaker' | 'tom' | 'crash';

const WEAPONS: WeaponId[] = ['meridian', 'swift', 'longline', 'breaker', 'pulse', 'sunspear'];

type OfflineCtor = typeof OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  if (typeof window === 'undefined') return null;
  return window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext ?? null;
}

/** A router that sends everything dry to one destination (bank rendering only). */
class DryRouter {
  constructor(
    private readonly dest: AudioNode,
    private readonly ctx: BaseAudioContext,
    private readonly dist: number,
  ) {}

  route(pos: unknown, dur: number, opts?: RouteOpts): Route {
    void dur;
    void opts;
    const input = this.ctx.createGain();
    input.connect(this.dest);
    const d = pos ? this.dist : 0;
    return { input, dist: d, delay: 0, near: Math.max(0, 1 - d / 60), occluded: false };
  }
}

export class SampleBank {
  private readonly core: AudioCore;
  private readonly shots = new Map<string, AudioBuffer[]>();
  private readonly drums = new Map<DrumKey, AudioBuffer>();
  private readonly last = new Map<string, number>();
  ready = false;
  private building = false;

  constructor(core: AudioCore) {
    this.core = core;
  }

  /** Renders everything; resolves when done (errors leave the synth fallback in place). */
  async build(lite: boolean): Promise<void> {
    const OC = offlineCtor();
    if (!OC || this.building || this.ready) return;
    this.building = true;
    try {
      const sr = this.core.ctx.sampleRate;
      const counts: Record<ShotKind, number> = lite ? { local: 2, near: 1, far: 1 } : { local: 3, near: 2, far: 2 };
      for (const w of WEAPONS) {
        const len = Math.min(2.2, WeaponSfx.voice(w).tail.d * 1.8 + 0.3);
        for (const kind of ['local', 'near', 'far'] as const) {
          const rate = kind === 'far' ? Math.round(sr / 2) : sr;
          const n = counts[kind];
          const bufs = await this.renderSeries(OC, rate, len, n, (ws, t) => {
            void t;
            ws.shot(w, kind === 'local' ? undefined : { x: 0, y: 0, z: 0 });
          }, kind === 'far' ? 100 : 6);
          this.shots.set(`${w}:${kind}`, bufs);
        }
      }
      await this.buildDrums(OC, sr);
      this.ready = true;
    } catch (err) {
      console.warn('[audio] sample bank unavailable, using live synthesis', err);
    } finally {
      this.building = false;
    }
  }

  /** Renders `n` takes of a sound back to back in one offline context, then slices them. */
  private async renderSeries(OC: OfflineCtor, rate: number, len: number, n: number, play: (ws: WeaponSfx, t: number) => void, dist: number): Promise<AudioBuffer[]> {
    const pre = 0.01;
    const slot = len + pre;
    const off = new OC(1, Math.ceil(rate * slot * n), rate);
    const mini = { ...this.core, ctx: off } as AudioCore;
    const synth = new Synth(mini);
    const out: AudioBuffer[] = [];
    const ws = new WeaponSfx(synth, new DryRouter(off.destination, off, dist));
    // Schedule each take at its slot by suspending the offline clock.
    for (let i = 0; i < n; i++) {
      const at = i * slot + pre;
      if (i === 0) {
        // currentTime is 0: schedule the first take directly (synth uses ctx.currentTime).
        play(ws, at);
      } else {
        void off.suspend(Math.round((i * slot * rate) / 128) * (128 / rate)).then(() => {
          play(ws, at);
          void off.resume();
        });
      }
    }
    const rendered = await off.startRendering();
    const data = rendered.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const s0 = Math.round(i * slot * rate);
      const s1 = Math.min(data.length, s0 + Math.round(slot * rate));
      const b = new AudioBuffer({ length: s1 - s0, sampleRate: rate, numberOfChannels: 1 });
      const seg = data.subarray(s0, s1);
      // Fade the last 30 ms so a truncated tail never clicks.
      const f = Math.min(seg.length, Math.round(rate * 0.03));
      const copy = new Float32Array(seg);
      for (let k = 0; k < f; k++) copy[copy.length - 1 - k] *= k / f;
      b.copyToChannel(copy, 0);
      out.push(b);
    }
    return out;
  }

  private async buildDrums(OC: OfflineCtor, sr: number): Promise<void> {
    const specs: [DrumKey, number, (s: Synth, d: AudioNode, ctx: BaseAudioContext) => void][] = [
      [
        'kick',
        0.36,
        (s, d, ctx) => {
          const o = ctx.createOscillator();
          o.frequency.setValueAtTime(140, 0.005);
          o.frequency.exponentialRampToValueAtTime(44, 0.115);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, 0.005);
          g.gain.linearRampToValueAtTime(0.85, 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, 0.33);
          o.connect(g).connect(d);
          o.start(0.005);
          o.stop(0.35);
          s.noise(d, 0.005, { filter: 'lowpass', freq: 1800, q: 0.7, gain: 0.08, decay: 0.015 });
        },
      ],
      [
        'snare',
        0.3,
        (s, d) => {
          s.noise(d, 0.005, { filter: 'bandpass', freq: 1900, q: 0.7, gain: 0.32, decay: 0.17 });
          s.noise(d, 0.005, { filter: 'highpass', freq: 5000, q: 0.7, gain: 0.1, decay: 0.09 });
          s.tone(d, 0.005, { freq: 200, freqEnd: 150, glide: 0.08, gain: 0.22, decay: 0.11 });
        },
      ],
      ['hat', 0.08, (s, d) => s.noise(d, 0.003, { filter: 'highpass', freq: 7500, q: 0.7, gain: 0.13, decay: 0.04 })],
      ['hatOpen', 0.3, (s, d) => s.noise(d, 0.003, { filter: 'highpass', freq: 7500, q: 0.7, gain: 0.13, decay: 0.22 })],
      ['rim', 0.06, (s, d) => s.noise(d, 0.003, { filter: 'bandpass', freq: 2600, q: 4, gain: 0.22, decay: 0.03 })],
      ['shaker', 0.09, (s, d) => s.noise(d, 0.003, { filter: 'bandpass', freq: 6200, q: 1.2, gain: 0.16, attack: 0.012, decay: 0.05 })],
      [
        'tom',
        0.3,
        (s, d) => s.tone(d, 0.003, { freq: 180, freqEnd: 108, glide: 0.2, gain: 0.4, attack: 0.003, decay: 0.25 }),
      ],
      ['crash', 1.8, (s, d) => s.noise(d, 0.003, { filter: 'highpass', freq: 4500, freqEnd: 3000, q: 0.5, gain: 0.12, attack: 0.002, decay: 1.6 })],
    ];
    for (const [key, len, fn] of specs) {
      const off = new OC(1, Math.ceil(sr * len), sr);
      const mini = { ...this.core, ctx: off } as AudioCore;
      fn(new Synth(mini), off.destination, off);
      this.drums.set(key, await off.startRendering());
    }
  }

  /** A shot take, never the same take twice in a row. */
  shot(w: WeaponId, kind: ShotKind): AudioBuffer | null {
    if (!this.ready) return null;
    const list = this.shots.get(`${w}:${kind}`);
    if (!list || list.length === 0) return null;
    const key = `${w}:${kind}`;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.last.get(key)) i = (i + 1) % list.length;
    this.last.set(key, i);
    return list[i];
  }

  drum(k: DrumKey): AudioBuffer | null {
    return this.ready ? (this.drums.get(k) ?? null) : null;
  }

  /** Plays a buffer into `dest` at `t` (self-cleaning). Returns the gain for envelopes. */
  play(buf: AudioBuffer, dest: AudioNode, t: number, gain: number, rate = 1): { src: AudioBufferSourceNode; g: GainNode } {
    const ctx = this.core.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(t);
    src.onended = () => g.disconnect();
    return { src, g };
  }
}

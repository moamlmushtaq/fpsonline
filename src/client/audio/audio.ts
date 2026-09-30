// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — AudioSystem implementation (Web Audio, fully procedural).
//
// Graph:
//   sfx voices ─► sfx bus ─► sfxDuck ─┐
//   ambience   ─► amb bus ─► sfx bus  │
//   music      ─► music bus ─► musicDuck ─┼─► master ─► glue compressor ─► limiter ─► out
//   announcer  ─► voice bus ──────────┤
//   ui         ─► ui bus ─────────────┘
//   reverb send ─► convolver (per-map IR) ─► sfx bus;  echo send ─► delay loop ─► sfx bus
//
// Designed to be deepened: synthesis lives in sfx.ts, music in music.ts and
// space/ambience in spatial.ts; this class only wires, routes and guards.
// Every public method is a silent no-op if Web Audio is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

import type { AudioSystem, AudioVolumes, MusicState, UiSound } from '../contracts';
import type { MapDef } from '../../shared/maps/types';
import type { Faction, SurfaceTag, Vec3, WeaponId } from '../../shared/types';
import { Music } from './music';
import { Sfx } from './sfx';
import { Environment, makeImpulse, makeNoise, Spatializer, type AudioCore } from './spatial';

interface XYZ {
  x: number;
  y: number;
  z: number;
}

type Ctor = typeof AudioContext;

export class Audio implements AudioSystem {
  private core: AudioCore | null = null;
  private sfx: Sfx | null = null;
  private music: Music | null = null;
  private env: Environment | null = null;
  private spatial: Spatializer | null = null;
  private musicDuck: GainNode | null = null;
  private sfxDuck: GainNode | null = null;
  private voiceDuck = 0;
  private volumes: AudioVolumes = { master: 0.85, music: 0.55, sfx: 0.9, voice: 0.85, ui: 0.6 };
  private pendingMusic: MusicState = 'off';
  private hidden = false;
  private duckK = 0;

  constructor() {
    try {
      const AC: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.build(ctx);
    } catch (err) {
      console.warn('[audio] Web Audio unavailable', err);
      this.core = null;
    }
  }

  private build(ctx: AudioContext): void {
    const g = () => ctx.createGain();
    const master = g();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 12;
    glue.ratio.value = 3;
    glue.attack.value = 0.006;
    glue.release.value = 0.22;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    master.connect(glue).connect(limiter).connect(ctx.destination);

    const music = g();
    const sfx = g();
    const voice = g();
    const ui = g();
    const ambience = g();
    this.musicDuck = g();
    this.sfxDuck = g();
    music.connect(this.musicDuck).connect(master);
    sfx.connect(this.sfxDuck).connect(master);
    ambience.gain.value = 0.9;
    ambience.connect(sfx);
    voice.connect(master);
    ui.connect(master);

    // Map reverb (convolution) and tuned echo.
    const reverbSend = g();
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 'open');
    const reverbOut = g();
    reverbOut.gain.value = 0.55;
    reverbSend.connect(convolver).connect(reverbOut).connect(sfx);
    const echoSend = g();
    const echoDelay = ctx.createDelay(1.5);
    echoDelay.delayTime.value = 0.3;
    const echoFeedback = g();
    echoFeedback.gain.value = 0;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 1600;
    echoSend.connect(echoDelay);
    echoDelay.connect(echoTone);
    echoTone.connect(echoFeedback);
    echoFeedback.connect(echoDelay);
    const echoOut = g();
    echoOut.gain.value = 0.5;
    echoTone.connect(echoOut).connect(sfx);

    this.core = {
      ctx,
      buses: { master, music, sfx, voice, ui, ambience },
      reverbSend,
      convolver,
      echoSend,
      echoDelay,
      echoFeedback,
      noise: { white: makeNoise(ctx, 'white', 2), pink: makeNoise(ctx, 'pink', 3), brown: makeNoise(ctx, 'brown', 3) },
      hrtf: false,
      voices: 0,
      maxVoices: 40,
    };
    this.spatial = new Spatializer(this.core);
    this.sfx = new Sfx(this.core, this.spatial);
    this.music = new Music(this.core);
    this.env = new Environment(this.core, this.spatial);
    this.applyVolumes();
  }

  /** True once the context runs (after a user gesture). */
  get unlocked(): boolean {
    return this.core?.ctx.state === 'running';
  }

  /** The raw AudioContext (for future specialists); null if unavailable. */
  get context(): AudioContext | null {
    return this.core?.ctx ?? null;
  }

  unlock(): void {
    const ctx = this.core?.ctx;
    if (!ctx || this.hidden) return;
    if (ctx.state !== 'running') {
      ctx.resume().then(
        () => {
          if (this.pendingMusic !== 'off') this.music?.setState(this.pendingMusic);
        },
        () => undefined,
      );
    }
  }

  /** Suspends everything while the page is hidden (saves battery; music pauses). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const ctx = this.core?.ctx;
    if (!ctx) return;
    try {
      if (hidden && ctx.state === 'running') void ctx.suspend();
      else if (!hidden && ctx.state === 'suspended') void ctx.resume();
    } catch {
      /* ignore */
    }
  }

  /** Low-end devices: lighter music voices and a smaller voice budget. */
  setLite(lite: boolean): void {
    this.music?.setLite(lite);
    if (this.core) this.core.maxVoices = lite ? 24 : 40;
  }

  private guard(fn: () => void): void {
    if (!this.core || this.core.ctx.state !== 'running') return;
    try {
      fn();
    } catch (err) {
      console.warn('[audio]', err);
    }
  }

  setListener(pos: XYZ, forward: XYZ, up: XYZ): void {
    this.guard(() => this.spatial?.setListener(pos.x, pos.y, pos.z, forward.x, forward.y, forward.z, up.x, up.y, up.z));
  }

  shot(weapon: WeaponId, pos?: Vec3): void {
    this.guard(() => this.sfx?.shot(weapon, pos));
  }

  reload(weapon: WeaponId, stage: 'start' | 'mag_out' | 'mag_in' | 'chamber' | 'shell', pos?: Vec3): void {
    this.guard(() => this.sfx?.reload(weapon, stage, pos));
  }

  dryFire(weapon: WeaponId): void {
    void weapon;
    this.guard(() => this.sfx?.dryFire());
  }

  pump(weapon: WeaponId, pos?: Vec3): void {
    this.guard(() => this.sfx?.pump(weapon, pos));
  }

  charge(pos?: Vec3): void {
    this.guard(() => this.sfx?.charge(pos));
  }

  swap(weapon: WeaponId): void {
    this.guard(() => this.sfx?.swap(weapon));
  }

  footstep(surface: SurfaceTag, pos: Vec3 | undefined, kind: 'walk' | 'sprint' | 'crouch'): void {
    this.guard(() => this.sfx?.footstep(surface, pos, kind));
  }

  jump(pos?: Vec3): void {
    this.guard(() => this.sfx?.jump(pos));
  }

  land(surface: SurfaceTag, impact: number, pos?: Vec3): void {
    this.guard(() => this.sfx?.land(surface, impact, pos));
  }

  slide(surface: SurfaceTag, pos?: Vec3): void {
    this.guard(() => this.sfx?.slide(surface, pos));
  }

  mantle(pos?: Vec3): void {
    this.guard(() => this.sfx?.mantle(pos));
  }

  impact(surface: SurfaceTag | 'player', pos: Vec3): void {
    this.guard(() => this.sfx?.impact(surface, pos));
  }

  whizz(pos: Vec3): void {
    this.guard(() => this.sfx?.whizz(pos));
  }

  hitmarker(kind: 'body' | 'head' | 'kill' | 'headkill'): void {
    this.guard(() => this.sfx?.hitmarker(kind));
  }

  hurt(amount: number): void {
    this.guard(() => this.sfx?.hurt(amount));
  }

  explosion(pos: Vec3): void {
    this.guard(() => this.sfx?.explosion(pos));
  }

  smoke(pos: Vec3): void {
    this.guard(() => this.sfx?.smoke(pos));
  }

  bounce(pos: Vec3): void {
    this.guard(() => this.sfx?.bounce(pos));
  }

  pickup(pos?: Vec3): void {
    this.guard(() => this.sfx?.pickup(pos));
  }

  zone(kind: 'capturing' | 'captured' | 'lost' | 'contested'): void {
    this.guard(() => this.sfx?.zone(kind));
  }

  spawn(pos?: Vec3): void {
    this.guard(() => this.sfx?.spawn(pos));
  }

  elimination(faction: Faction, pos: Vec3): void {
    this.guard(() => this.sfx?.elimination(faction, pos));
  }

  ui(s: UiSound): void {
    this.guard(() => this.sfx?.ui(s));
  }

  setHeartbeat(intensity: number): void {
    this.sfx?.setHeartbeat(intensity);
  }

  setEnvironment(map: MapDef | null): void {
    if (!this.core) return;
    try {
      this.env?.set(map);
    } catch (err) {
      console.warn('[audio] environment', err);
    }
  }

  setMusic(state: MusicState): void {
    this.pendingMusic = state;
    if (!this.core || this.core.ctx.state !== 'running') return;
    try {
      this.music?.setState(state);
    } catch (err) {
      console.warn('[audio] music', err);
    }
  }

  setVolumes(v: Partial<AudioVolumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const c = this.core;
    if (!c) return;
    const t = c.ctx.currentTime;
    // Perceptual (squared) curves feel natural on sliders.
    const sq = (x: number) => Math.max(0, Math.min(1, x)) ** 2;
    c.buses.master.gain.setTargetAtTime(sq(this.volumes.master), t, 0.03);
    c.buses.music.gain.setTargetAtTime(sq(this.volumes.music) * 1.25, t, 0.03);
    c.buses.sfx.gain.setTargetAtTime(sq(this.volumes.sfx), t, 0.03);
    c.buses.voice.gain.setTargetAtTime(sq(this.volumes.voice), t, 0.03);
    c.buses.ui.gain.setTargetAtTime(sq(this.volumes.ui) * 1.2, t, 0.03);
  }

  setHrtf(on: boolean): void {
    if (!this.core) return;
    this.core.hrtf = on;
    this.env?.setHrtf(on);
  }

  setDuck(k: number): void {
    this.duckK = Math.max(0, Math.min(1, k));
    this.applyDuck();
  }

  /** Announcer ducking: music dips while a voice line plays. */
  duckForVoice(on: boolean): void {
    this.voiceDuck = on ? 1 : 0;
    this.applyDuck();
  }

  private applyDuck(): void {
    const c = this.core;
    if (!c || !this.musicDuck || !this.sfxDuck) return;
    const t = c.ctx.currentTime;
    const music = (1 - this.duckK * 0.55) * (1 - this.voiceDuck * 0.45);
    this.musicDuck.gain.setTargetAtTime(music, t, 0.12);
    this.sfxDuck.gain.setTargetAtTime(1 - this.duckK * 0.75, t, 0.12);
  }

  /** Soft two-tone chime before announcer lines (voice bus). */
  announcerChime(): void {
    this.guard(() => {
      const c = this.core as AudioCore;
      const t = c.ctx.currentTime;
      const d = c.buses.voice;
      this.sfx?.bell(d, t, 659.25, 0.07, 0.8);
      this.sfx?.bell(d, t + 0.16, 987.77, 0.06, 1.1);
    });
  }

  update(dt: number): void {
    void dt;
    if (!this.core || this.core.ctx.state !== 'running') return;
    try {
      this.sfx?.update();
      this.env?.update();
    } catch (err) {
      console.warn('[audio] update', err);
    }
  }
}

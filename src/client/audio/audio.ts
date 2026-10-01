// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — AudioSystem implementation (Web Audio, fully procedural).
//
// The mixing graph lives in core.ts (buses → glue compressor → limiter →
// safety clip); synthesis in synth.ts / weapons.ts / sfx.ts; space and
// ambience in spatial.ts / reverb.ts / environment.ts / radio.ts; the score
// in music.ts. This class only wires, routes and guards: every public method
// is a silent no-op if Web Audio is unavailable or still locked.
//
// Mix targets (measured with an OfflineAudioContext, see the polish report):
// weapons are the loudest element (local shots peak ≈ −3 dBFS pre-limiter),
// feedback and footsteps sit clearly above the music, ambience is a quiet
// bed, UI is soft, music sits under gameplay in matches (state trim −3 dB)
// and ducks for the announcer, the pause menu and the low-health heartbeat.
// ─────────────────────────────────────────────────────────────────────────────

import type { AudioSystem, AudioVolumes, MusicState, UiSound } from '../contracts';
import type { MapDef } from '../../shared/maps/types';
import type { Faction, SurfaceTag, Vec3, WeaponId } from '../../shared/types';
import type { ChimeTone } from './announcer';
import { SampleBank } from './bank';
import { createCore, type AudioCore } from './core';
import { Environment } from './environment';
import { Music } from './music';
import { Sfx } from './sfx';
import { Spatializer, type OcclusionProbe } from './spatial';

interface XYZ {
  x: number;
  y: number;
  z: number;
}

type Ctor = typeof AudioContext;

export class Audio implements AudioSystem {
  private core: AudioCore | null = null;
  private actx: AudioContext | null = null;
  private sfx: Sfx | null = null;
  private music: Music | null = null;
  private env: Environment | null = null;
  private spatial: Spatializer | null = null;
  private bank: SampleBank | null = null;
  private voiceDuck = 0;
  private volumes: AudioVolumes = { master: 0.85, music: 0.55, sfx: 0.9, voice: 0.85, ui: 0.6 };
  private pendingMusic: MusicState = 'off';
  private hidden = false;
  private duckK = 0;
  private lite = false;

  constructor() {
    try {
      const AC: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.actx = ctx;
      this.build(ctx);
    } catch (err) {
      console.warn('[audio] Web Audio unavailable', err);
      this.core = null;
    }
  }

  private build(ctx: BaseAudioContext): void {
    this.core = createCore(ctx, { lite: this.lite });
    this.spatial = new Spatializer(this.core);
    this.sfx = new Sfx(this.core, this.spatial);
    this.music = new Music(this.core);
    this.env = new Environment(this.core, this.spatial);
    this.applyVolumes();
  }

  /** Renders the sample bank in the background; live synthesis covers the gap. */
  private buildBank(): void {
    const core = this.core;
    if (!core || this.bank) return;
    const bank = new SampleBank(core);
    this.bank = bank;
    void bank.build(this.lite).then(() => {
      if (!bank.ready) return;
      if (this.sfx) this.sfx.weapons.bank = bank;
      if (this.music) this.music.bank = bank;
    });
  }

  /** True once the context runs (after a user gesture). */
  get unlocked(): boolean {
    return this.core?.ctx.state === 'running';
  }

  /** The raw AudioContext (for future specialists); null if unavailable. */
  get context(): AudioContext | null {
    return this.actx;
  }

  unlock(): void {
    const ctx = this.actx;
    if (!ctx || this.hidden) return;
    // First gesture: the quality preset (lite) is known by now.
    this.buildBank();
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
    const ctx = this.actx;
    if (!ctx) return;
    try {
      if (hidden && ctx.state === 'running') void ctx.suspend();
      else if (!hidden && ctx.state === 'suspended') void ctx.resume();
    } catch {
      /* ignore */
    }
  }

  /** Low-end devices: fewer voices, no convolution, lighter music, equal-power panning. */
  setLite(lite: boolean): void {
    this.lite = lite;
    const c = this.core;
    if (!c) return;
    try {
      c.maxVoices = lite ? 22 : 40;
      this.env?.setLite(lite);
      this.music?.setLite(lite);
    } catch (err) {
      console.warn('[audio] lite', err);
    }
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

  /**
   * Occlusion probe: returns true when level geometry blocks the segment
   * a → b. Set by the match from its collision world; null clears it. Used
   * for muffling occluded sources and the indoor/outdoor acoustics.
   */
  setOcclusionProbe(probe: OcclusionProbe | null): void {
    this.spatial?.setProbe(probe);
  }

  shot(weapon: WeaponId, pos?: Vec3, opts?: { suppressedByDistance?: boolean }): void {
    void opts;
    this.guard(() => this.sfx?.shot(weapon, pos));
  }

  reload(weapon: WeaponId, stage: 'start' | 'mag_out' | 'mag_in' | 'chamber' | 'shell', pos?: Vec3): void {
    this.guard(() => this.sfx?.reload(weapon, stage, pos));
  }

  dryFire(weapon: WeaponId): void {
    this.guard(() => this.sfx?.dryFire(weapon));
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

  /** `friendly`: a teammate's step (quieter, shorter range than an enemy's). */
  footstep(surface: SurfaceTag, pos: Vec3 | undefined, kind: 'walk' | 'sprint' | 'crouch', friendly = false): void {
    this.guard(() => this.sfx?.footstep(surface, pos, kind, friendly));
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
    try {
      this.sfx?.setHeartbeat(intensity);
    } catch (err) {
      console.warn('[audio] heartbeat', err);
    }
  }

  setEnvironment(map: MapDef | null): void {
    if (!this.core) return;
    try {
      if (!map) this.spatial?.setProbe(null);
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
    c.buses.ui.gain.setTargetAtTime(sq(this.volumes.ui) * 1.6, t, 0.03);
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

  /** Announcer ducking: music dips (and the world a touch) while a voice line plays. */
  duckForVoice(on: boolean): void {
    this.voiceDuck = on ? 1 : 0;
    this.applyDuck();
  }

  private applyDuck(): void {
    const c = this.core;
    if (!c) return;
    const t = c.ctx.currentTime;
    const music = (1 - this.duckK * 0.55) * (1 - this.voiceDuck * 0.5);
    const sfx = (1 - this.duckK * 0.75) * (1 - this.voiceDuck * 0.15);
    c.musicDuck.gain.setTargetAtTime(music, t, this.voiceDuck ? 0.08 : 0.25);
    c.sfxDuck.gain.setTargetAtTime(sfx, t, 0.12);
  }

  /** Soft chime before announcer lines (voice bus). */
  announcerChime(tone: ChimeTone = 'normal'): void {
    this.guard(() => {
      const c = this.core as AudioCore;
      const s = this.sfx?.synth;
      if (!s) return;
      const t = c.ctx.currentTime;
      const d = c.buses.voice;
      if (tone === 'bright') {
        s.bell(d, t, 783.99, 0.06, 0.9);
        s.bell(d, t + 0.12, 1174.66, 0.055, 1.2);
      } else if (tone === 'low') {
        s.bell(d, t, 659.25, 0.06, 0.9);
        s.bell(d, t + 0.14, 493.88, 0.06, 1.1);
      } else {
        s.bell(d, t, 659.25, 0.06, 0.8);
        s.bell(d, t + 0.14, 987.77, 0.055, 1.1);
      }
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

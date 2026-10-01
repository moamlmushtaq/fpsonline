// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — spatial routing, voice budget and occlusion.
//
// Spatializer.route() gives every one-shot an input node:
//   local sounds  → world bus (dry, centred) + a small reverb send;
//   world sounds  → air-absorption / occlusion low-pass → PannerNode (HRTF on
//                   high quality, equal-power otherwise or when far) → world bus,
//                   with reverb/echo sends that grow with distance, a
//                   speed-of-sound delay (distant gunfire lags its flash), a
//                   gentle "behind you" darkening and a soft fade near the cull
//                   distance so nothing pops in or out.
// Voice budget: when full, the oldest lowest-priority voice is faded out in
// ~10 ms and its slot reused (voice stealing); a sound whose priority is lower
// than every live voice is dropped.
// Occlusion: an optional probe (set by the match from the collision world)
// tells whether the straight line listener → source is blocked.
//
// This module re-exports the shared graph types and the Environment so older
// imports (`./spatial`) keep working.
// ─────────────────────────────────────────────────────────────────────────────

import type { Vec3 } from '../../shared/types';
import type { AudioCore } from './core';

export type { AudioBuses, AudioCore } from './core';
export { makeNoise } from './core';
export { makeImpulse } from './reverb';
export { Environment } from './environment';

export interface Route {
  input: GainNode;
  /** Distance to the listener (0 for local). */
  dist: number;
  /** Seconds of speed-of-sound delay applied to scheduling. */
  delay: number;
  /** 0..1 brightness (1 = close/local): sfx use it to thin out transients. */
  near: number;
  /** True when geometry blocks the direct path. */
  occluded: boolean;
}

export interface RouteOpts {
  maxDist?: number;
  /** Reverb send (0..1). */
  reverb?: number;
  /** Echo send (0..1), scaled up with distance. */
  echo?: number;
  gain?: number;
  /** Legacy: true = priority 3. */
  priority?: boolean;
  /** Voice priority 0 (ambient) … 3 (local / critical). */
  prio?: number;
  /** PannerNode reference distance (m) and rolloff. */
  ref?: number;
  rolloff?: number;
  /** Skip the occlusion probe (e.g. bullet whizz). */
  noOcclusion?: boolean;
  /** Destination bus (defaults to the world bus). */
  dest?: AudioNode;
}

/** Returns true when the segment a → b is blocked by level geometry. */
export type OcclusionProbe = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean;

const SPEED_OF_SOUND = 343;

interface VoiceRec {
  input: GainNode;
  nodes: (AudioNode | null)[];
  start: number;
  end: number;
  prio: number;
  alive: boolean;
}

export class Spatializer {
  private readonly core: AudioCore;
  readonly listener = { x: 0, y: 0, z: 0 };
  readonly forward = { x: 0, y: 0, z: -1 };
  private probe: OcclusionProbe | null = null;
  private live: VoiceRec[] = [];
  private aliveCount = 0;
  /** Stats for debugging / tests. */
  readonly stats = { routed: 0, stolen: 0, dropped: 0, occluded: 0 };

  constructor(core: AudioCore) {
    this.core = core;
  }

  setProbe(p: OcclusionProbe | null): void {
    this.probe = p;
  }

  get hasProbe(): boolean {
    return this.probe !== null;
  }

  /** Probe helper (false when no probe is set). */
  blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    if (!this.probe) return false;
    try {
      return this.probe(ax, ay, az, bx, by, bz);
    } catch {
      return false;
    }
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this.listener.x = px;
    this.listener.y = py;
    this.listener.z = pz;
    this.forward.x = fx;
    this.forward.y = fy;
    this.forward.z = fz;
    const l = this.core.ctx.listener;
    const t = this.core.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(px, t, 0.012);
      l.positionY.setTargetAtTime(py, t, 0.012);
      l.positionZ.setTargetAtTime(pz, t, 0.012);
      l.forwardX.setTargetAtTime(fx, t, 0.012);
      l.forwardY.setTargetAtTime(fy, t, 0.012);
      l.forwardZ.setTargetAtTime(fz, t, 0.012);
      l.upX.setTargetAtTime(ux, t, 0.012);
      l.upY.setTargetAtTime(uy, t, 0.012);
      l.upZ.setTargetAtTime(uz, t, 0.012);
    } else {
      // Older Safari.
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(px, py, pz);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  distance(pos: Vec3): number {
    const dx = pos.x - this.listener.x;
    const dy = pos.y - this.listener.y;
    const dz = pos.z - this.listener.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Live (not yet stolen/ended) one-shot voices. */
  get liveVoices(): number {
    this.reap(this.core.ctx.currentTime);
    return this.aliveCount;
  }

  /** Disconnects voices that have finished. Cheap; called per route and per frame. */
  reap(now: number): void {
    const live = this.live;
    let w = 0;
    let alive = 0;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      if (v.end < now) {
        for (const n of v.nodes) {
          try {
            n?.disconnect();
          } catch {
            /* already disconnected */
          }
        }
        continue;
      }
      if (v.alive) alive++;
      live[w++] = v;
    }
    live.length = w;
    this.aliveCount = alive;
    this.core.voices = alive;
  }

  /** Makes room for a voice of `prio`; false if it should be dropped. */
  private admit(prio: number, now: number): boolean {
    this.reap(now);
    if (this.aliveCount < this.core.maxVoices) return true;
    let victim: VoiceRec | null = null;
    for (const v of this.live) {
      if (!v.alive) continue;
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
    }
    if (!victim || victim.prio > prio) {
      this.stats.dropped++;
      return false;
    }
    // Steal: a fast fade (no click), then disconnect on the next reap.
    const gp = victim.input.gain;
    gp.cancelScheduledValues(now);
    gp.setTargetAtTime(0, now, 0.004);
    victim.alive = false;
    victim.end = now + 0.04;
    this.aliveCount--;
    this.stats.stolen++;
    return true;
  }

  private track(input: GainNode, nodes: (AudioNode | null)[], dur: number, prio: number, now: number): void {
    this.live.push({ input, nodes: [input, ...nodes], start: now, end: now + dur + 0.1, prio, alive: true });
    this.aliveCount++;
    this.core.voices = this.aliveCount;
    this.stats.routed++;
  }

  /**
   * An input node for a one-shot lasting `dur` seconds (after its distance
   * delay). Returns null when the sound would be inaudible or the voice budget
   * refuses it.
   */
  route(pos: Vec3 | undefined, dur: number, opts: RouteOpts = {}): Route | null {
    const core = this.core;
    const ctx = core.ctx;
    const now = ctx.currentTime;
    const gain = opts.gain ?? 1;
    const prio = opts.prio ?? (opts.priority ? 3 : pos ? 1 : 3);
    const dest = opts.dest ?? core.buses.world;
    if (!pos) {
      if (!this.admit(prio, now)) return null;
      const input = ctx.createGain();
      input.gain.value = gain;
      input.connect(dest);
      let send: GainNode | null = null;
      const rv = opts.reverb ?? 0.12;
      if (rv > 0) {
        send = ctx.createGain();
        send.gain.value = rv;
        input.connect(send);
        send.connect(core.reverbSend);
      }
      let echo: GainNode | null = null;
      if ((opts.echo ?? 0) > 0) {
        echo = ctx.createGain();
        echo.gain.value = (opts.echo ?? 0) * 0.45;
        input.connect(echo);
        echo.connect(core.echoSend);
      }
      this.track(input, [send, echo], dur, prio, now);
      return { input, dist: 0, delay: 0, near: 1, occluded: false };
    }
    const dist = this.distance(pos);
    const maxDist = opts.maxDist ?? 120;
    if (dist > maxDist) return null;
    if (!this.admit(prio, now)) return null;
    const delay = Math.min(0.55, dist / SPEED_OF_SOUND);
    const near = Math.max(0, 1 - dist / 60);
    // Occlusion: test from the ear to the source's torso height.
    let occluded = false;
    if (!opts.noOcclusion && this.probe && dist > 1.5) {
      const L = this.listener;
      occluded = this.blocked(L.x, L.y, L.z, pos.x, pos.y + 0.9, pos.z);
      if (occluded) this.stats.occluded++;
    }
    // Behind the listener: a touch darker (helps front/back on equal-power).
    const dx = pos.x - this.listener.x;
    const dy = pos.y - this.listener.y;
    const dz = pos.z - this.listener.z;
    const inv = dist > 1e-3 ? 1 / dist : 0;
    const facing = (dx * this.forward.x + dy * this.forward.y + dz * this.forward.z) * inv;
    const behind = facing < -0.2 ? Math.min(1, (-facing - 0.2) / 0.6) : 0;
    // Air absorption (exaggerated for readability) + occlusion.
    let cutoff = 20000 / (1 + dist / 14);
    cutoff *= 1 - behind * 0.35;
    if (occluded) cutoff = Math.min(cutoff, 1100);
    cutoff = Math.max(550, cutoff);
    // Soft fade over the last quarter of the audible range.
    const edge = dist > maxDist * 0.72 ? Math.max(0, (maxDist - dist) / (maxDist * 0.28)) : 1;
    const input = ctx.createGain();
    input.gain.value = gain * edge * (occluded ? 0.5 : 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.5;
    const panner = ctx.createPanner();
    panner.panningModel = core.hrtf && !core.lite && dist < 50 ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = opts.ref ?? 2;
    panner.rolloffFactor = opts.rolloff ?? 1;
    panner.maxDistance = Math.max(maxDist, 1);
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    input.connect(lp);
    lp.connect(panner);
    panner.connect(dest);
    // Sends are pre-panner, so they get their own (gentler: half the dB)
    // distance attenuation. Reverb/echo share grows with distance and when
    // occluded (you hear the room rather than the source).
    const ref = panner.refDistance;
    const direct = ref / (ref + panner.rolloffFactor * (Math.max(dist, ref) - ref));
    const sendAtt = Math.sqrt(direct);
    const rev = ctx.createGain();
    const rv = opts.reverb ?? 0.25;
    rev.gain.value = rv * (0.35 + (1 - near) * 0.9) * (occluded ? 2.2 : 1) * sendAtt;
    lp.connect(rev);
    rev.connect(core.reverbSend);
    let echo: GainNode | null = null;
    if ((opts.echo ?? 0) > 0) {
      echo = ctx.createGain();
      // Echo stays below the direct sound up close and approaches it far away
      // (a distinct repeat that never reads as a second shot).
      echo.gain.value = (opts.echo ?? 0) * direct * (0.4 + 0.8 * Math.min(1, dist / 80)) * (occluded ? 1.4 : 1);
      lp.connect(echo);
      echo.connect(core.echoSend);
    }
    this.track(input, [lp, panner, rev, echo], dur + delay, prio, now);
    return { input, dist, delay, near, occluded };
  }
}

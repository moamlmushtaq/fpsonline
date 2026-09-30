// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — spatial audio + map environment.
//
// AudioCore: the shared graph handles (context, buses, sends, noise buffers)
// created by audio.ts and consumed by sfx.ts / music.ts / this module.
//
// Spatializer.route(): gives every one-shot an input node. Local sounds go
// straight to the SFX bus (dry, stereo). World sounds go through a distance
// low-pass → PannerNode (HRTF when enabled) → SFX bus, with reverb/echo sends
// that grow with distance, and a speed-of-sound delay so far gunfire lags.
//
// Environment: per-map convolution reverb (generated impulse responses), echo
// amount, an ambience bed (coast waves + gulls / suburb breeze + chimes /
// mountain wind / range birds) and positional emitters (an old radio playing a
// faint looping tune, wind chimes, machinery hum, waves, drips).
// ─────────────────────────────────────────────────────────────────────────────

import type { MapAudioDef, MapDef } from '../../shared/maps/types';
import type { Vec3 } from '../../shared/types';

export interface AudioBuses {
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  voice: GainNode;
  ui: GainNode;
  /** Ambience bed + emitters (under the SFX volume). */
  ambience: GainNode;
}

export interface AudioCore {
  readonly ctx: AudioContext;
  readonly buses: AudioBuses;
  /** Send into the map convolution reverb. */
  readonly reverbSend: GainNode;
  readonly convolver: ConvolverNode;
  /** Send into the tuned echo (distant gunfire). */
  readonly echoSend: GainNode;
  readonly echoDelay: DelayNode;
  readonly echoFeedback: GainNode;
  readonly noise: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer };
  hrtf: boolean;
  /** Live one-shot voices (used for the voice budget). */
  voices: number;
  maxVoices: number;
}

export interface Route {
  input: GainNode;
  /** Distance to the listener (0 for local). */
  dist: number;
  /** Seconds of speed-of-sound delay applied to scheduling. */
  delay: number;
  /** 0..1 brightness (1 = close/local): sfx use it to thin out transients. */
  near: number;
}

const SPEED_OF_SOUND = 343;

/** Makes a noise buffer: 'white', 'pink' (Voss-ish filter) or 'brown'. */
export function makeNoise(ctx: BaseAudioContext, kind: 'white' | 'pink' | 'brown', seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

/** Generated stereo impulse response for a reverb character. */
export function makeImpulse(ctx: BaseAudioContext, kind: MapAudioDef['reverb']): AudioBuffer {
  const spec = {
    open: { dur: 1.6, decay: 3.2, bright: 0.55, taps: [0.045, 0.11] },
    coastal: { dur: 2.4, decay: 2.6, bright: 0.35, taps: [0.07, 0.19] },
    suburb: { dur: 1.3, decay: 3.4, bright: 0.6, taps: [0.018, 0.034, 0.061, 0.09] },
    mountain: { dur: 3.4, decay: 2.2, bright: 0.4, taps: [0.28, 0.61, 0.95] },
    indoor: { dur: 0.9, decay: 4.2, bright: 0.8, taps: [0.009, 0.017, 0.028] },
  }[kind] ?? { dur: 1.6, decay: 3, bright: 0.5, taps: [0.05] };
  const len = Math.floor(ctx.sampleRate * spec.dur);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Darken over time: one-pole low-pass whose coefficient falls with t.
      const a = spec.bright * (1 - t * 0.7);
      lp += (Math.random() * 2 - 1 - lp) * a;
      d[i] = lp * Math.pow(1 - t, spec.decay);
    }
    // Discrete early reflections / slap echoes (mountains: distinct canyon echoes).
    for (const tap of spec.taps) {
      const at = Math.floor((tap + ch * 0.004) * ctx.sampleRate);
      const amp = 0.6 * Math.pow(1 - tap / spec.dur, 2);
      for (let k = 0; k < 220 && at + k < len; k++) d[at + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / 40);
    }
  }
  return buf;
}

export class Spatializer {
  private readonly core: AudioCore;
  readonly listener = { x: 0, y: 0, z: 0 };

  constructor(core: AudioCore) {
    this.core = core;
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this.listener.x = px;
    this.listener.y = py;
    this.listener.z = pz;
    const l = this.core.ctx.listener;
    const t = this.core.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(px, t, 0.015);
      l.positionY.setTargetAtTime(py, t, 0.015);
      l.positionZ.setTargetAtTime(pz, t, 0.015);
      l.forwardX.setTargetAtTime(fx, t, 0.015);
      l.forwardY.setTargetAtTime(fy, t, 0.015);
      l.forwardZ.setTargetAtTime(fz, t, 0.015);
      l.upX.setTargetAtTime(ux, t, 0.015);
      l.upY.setTargetAtTime(uy, t, 0.015);
      l.upZ.setTargetAtTime(uz, t, 0.015);
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

  /**
   * An input node for a one-shot lasting `dur` seconds. Returns null when the
   * sound would be inaudible or the voice budget is exhausted (distant sounds
   * are the first to be dropped).
   */
  route(pos: Vec3 | undefined, dur: number, opts: { maxDist?: number; reverb?: number; echo?: number; gain?: number; priority?: boolean } = {}): Route | null {
    const core = this.core;
    const ctx = core.ctx;
    const gain = opts.gain ?? 1;
    if (!pos) {
      if (core.voices >= core.maxVoices + 8) return null;
      const input = ctx.createGain();
      input.gain.value = gain;
      input.connect(core.buses.sfx);
      let send: GainNode | null = null;
      if ((opts.reverb ?? 0.12) > 0) {
        send = ctx.createGain();
        send.gain.value = opts.reverb ?? 0.12;
        input.connect(send);
        send.connect(core.reverbSend);
      }
      this.track(dur, [input, send]);
      return { input, dist: 0, delay: 0, near: 1 };
    }
    const dist = this.distance(pos);
    const maxDist = opts.maxDist ?? 120;
    if (dist > maxDist) return null;
    if (!opts.priority && core.voices >= core.maxVoices && dist > 12) return null;
    const delay = Math.min(0.35, dist / SPEED_OF_SOUND);
    const near = Math.max(0, 1 - dist / 60);
    const input = ctx.createGain();
    input.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(700, 18000 * Math.exp(-dist / 28));
    lp.Q.value = 0.4;
    const panner = ctx.createPanner();
    panner.panningModel = core.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2.5;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = maxDist;
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    input.connect(lp);
    lp.connect(panner);
    panner.connect(core.buses.sfx);
    const rev = ctx.createGain();
    rev.gain.value = (opts.reverb ?? 0.25) * (0.35 + (1 - near) * 0.9);
    lp.connect(rev);
    rev.connect(core.reverbSend);
    let echo: GainNode | null = null;
    if ((opts.echo ?? 0) > 0) {
      echo = ctx.createGain();
      echo.gain.value = (opts.echo ?? 0) * Math.min(1, 0.25 + dist / 40);
      lp.connect(echo);
      echo.connect(core.echoSend);
    }
    this.track(dur + delay, [input, lp, panner, rev, echo]);
    return { input, dist, delay, near };
  }

  /** Counts the voice and disconnects its routing nodes once it is done. */
  private track(dur: number, nodes: (AudioNode | null)[]): void {
    const core = this.core;
    core.voices++;
    setTimeout(() => {
      core.voices = Math.max(0, core.voices - 1);
      for (const n of nodes) {
        try {
          n?.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    }, (dur + 0.25) * 1000);
  }
}

// ── Environment: reverb, echo, ambience bed and emitters ───────────────────

interface Emitter {
  kind: MapAudioDef['emitters'][number]['kind'];
  pos: Vec3;
  radius: number;
  panner: PannerNode;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  next: number;
  step: number;
}

// A short, wistful 1970s jingle for the old radio (MIDI notes, 8th notes; 0 = rest).
const RADIO_TUNE = [72, 76, 79, 76, 74, 0, 71, 74, 76, 0, 72, 69, 71, 72, 0, 0, 69, 72, 76, 74, 72, 0, 67, 69, 71, 72, 74, 0, 72, 0, 0, 0];
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Environment {
  private readonly core: AudioCore;
  private readonly spatial: Spatializer;
  private bedNodes: AudioNode[] = [];
  private bedSources: AudioScheduledSourceNode[] = [];
  private bedGain: GainNode | null = null;
  private emitters: Emitter[] = [];
  private kind: MapAudioDef['ambience'] | null = null;
  private eventAt = 0;
  private current: MapDef | null = null;

  constructor(core: AudioCore, spatial: Spatializer) {
    this.core = core;
    this.spatial = spatial;
  }

  set(map: MapDef | null): void {
    if (map === this.current) return;
    this.current = map;
    this.teardown();
    const core = this.core;
    const ctx = core.ctx;
    const t = ctx.currentTime;
    if (!map) {
      core.convolver.buffer = makeImpulse(ctx, 'open');
      core.echoFeedback.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    const a = map.audio;
    core.convolver.buffer = makeImpulse(ctx, a.reverb);
    // Echo: longer delay in open/mountain maps; feedback = echo amount.
    const delay = a.reverb === 'mountain' ? 0.46 : a.reverb === 'coastal' ? 0.34 : a.reverb === 'suburb' ? 0.16 : 0.24;
    core.echoDelay.delayTime.setTargetAtTime(delay, t, 0.05);
    core.echoFeedback.gain.setTargetAtTime(Math.min(0.55, a.echo * 0.6), t, 0.05);
    this.kind = a.ambience;
    this.buildBed(a.ambience);
    for (const e of a.emitters) this.addEmitter(e.kind, e.pos, e.radius);
  }

  private teardown(): void {
    const t = this.core.ctx.currentTime;
    if (this.bedGain) this.bedGain.gain.setTargetAtTime(0, t, 0.3);
    const oldSources = [...this.bedSources, ...this.emitters.flatMap((e) => e.sources)];
    const oldNodes = [...this.bedNodes, ...this.emitters.flatMap((e) => [e.panner, e.gain] as AudioNode[])];
    for (const e of this.emitters) e.gain.gain.setTargetAtTime(0, t, 0.3);
    setTimeout(() => {
      for (const s of oldSources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const n of oldNodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    }, 1500);
    this.bedSources = [];
    this.bedNodes = [];
    this.bedGain = null;
    this.emitters = [];
    this.kind = null;
  }

  private loopNoise(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.core.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random() * 0.5;
    s.start();
    this.bedSources.push(s);
    return s;
  }

  private lfo(freq: number, depth: number, target: AudioParam): OscillatorNode {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(target);
    o.start();
    this.bedSources.push(o);
    this.bedNodes.push(g);
    return o;
  }

  private buildBed(kind: MapAudioDef['ambience']): void {
    const ctx = this.core.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    out.connect(this.core.buses.ambience);
    this.bedGain = out;
    this.bedNodes.push(out);
    const n = this.core.noise;
    if (kind === 'coast') {
      // Waves: pink noise through a low-pass, amplitude swelling on a slow LFO.
      const src = this.loopNoise(n.pink);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      src.connect(lp).connect(g).connect(out);
      this.lfo(0.11, 0.12, g.gain);
      this.lfo(0.07, 300, lp.frequency);
      this.bedNodes.push(lp, g);
    } else if (kind === 'suburb') {
      const src = this.loopNoise(n.pink);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      src.connect(bp).connect(g).connect(out);
      this.lfo(0.05, 0.035, g.gain);
      this.lfo(0.09, 400, bp.frequency);
      this.bedNodes.push(bp, g);
    } else if (kind === 'wind') {
      for (const [f, q, lv, rate] of [
        [420, 1.5, 0.09, 0.06],
        [1100, 3, 0.04, 0.13],
      ] as const) {
        const src = this.loopNoise(n.white);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = lv;
        src.connect(bp).connect(g).connect(out);
        this.lfo(rate, f * 0.45, bp.frequency);
        this.lfo(rate * 0.7, lv * 0.8, g.gain);
        this.bedNodes.push(bp, g);
      }
    } else {
      // Range: warm, quiet air.
      const src = this.loopNoise(n.brown);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.value = 0.06;
      src.connect(lp).connect(g).connect(out);
      this.bedNodes.push(lp, g);
    }
  }

  private addEmitter(kind: Emitter['kind'], pos: Vec3, radius: number): void {
    const ctx = this.core.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = this.core.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.maxDistance = Math.max(4, radius * 2.2);
    panner.rolloffFactor = 1;
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, 1);
    gain.connect(panner);
    panner.connect(this.core.buses.ambience);
    const em: Emitter = { kind, pos, radius, panner, gain, sources: [], next: ctx.currentTime + Math.random(), step: 0 };
    const n = this.core.noise;
    if (kind === 'machinery' || kind === 'hum') {
      const o = ctx.createOscillator();
      o.type = kind === 'hum' ? 'sine' : 'sawtooth';
      o.frequency.value = kind === 'hum' ? 60 : 47;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = kind === 'hum' ? 240 : 320;
      const g = ctx.createGain();
      g.gain.value = kind === 'hum' ? 0.05 : 0.07;
      o.connect(lp).connect(g).connect(gain);
      o.start();
      em.sources.push(o);
      if (kind === 'machinery') {
        const s = ctx.createBufferSource();
        s.buffer = n.brown;
        s.loop = true;
        const g2 = ctx.createGain();
        g2.gain.value = 0.06;
        s.connect(g2).connect(gain);
        s.start();
        em.sources.push(s);
      }
    } else if (kind === 'waves') {
      const s = ctx.createBufferSource();
      s.buffer = n.pink;
      s.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      s.connect(lp).connect(g).connect(gain);
      s.start();
      const l = ctx.createOscillator();
      l.frequency.value = 0.13;
      const lg = ctx.createGain();
      lg.gain.value = 0.1;
      l.connect(lg).connect(g.gain);
      l.start();
      em.sources.push(s, l);
    }
    this.emitters.push(em);
  }

  /** Schedules discrete ambience events (radio notes, chimes, drips, gulls). */
  update(): void {
    if (!this.current) return;
    const ctx = this.core.ctx;
    const now = ctx.currentTime;
    const ahead = now + 0.3;
    for (const em of this.emitters) {
      // Only simulate emitters the listener can hear.
      if (this.spatial.distance(em.pos) > em.radius * 2.4) {
        if (em.next < now) em.next = now + 0.5;
        continue;
      }
      while (em.next < ahead) {
        switch (em.kind) {
          case 'radio': {
            const note = RADIO_TUNE[em.step % RADIO_TUNE.length];
            em.step++;
            if (note) this.radioNote(em.gain, em.next, mtof(note));
            if (em.step % 4 === 0) this.crackle(em.gain, em.next);
            em.next += 0.27;
            break;
          }
          case 'wind_chime':
            this.chime(em.gain, em.next, mtof(PENTA[Math.floor(Math.random() * PENTA.length)]), 0.05);
            em.next += 0.25 + Math.random() * (Math.random() < 0.3 ? 0.2 : 2.2);
            break;
          case 'drip':
            this.drip(em.gain, em.next);
            em.next += 0.6 + Math.random() * 2.4;
            break;
          default:
            em.next = ahead + 10;
        }
      }
    }
    // Non-positional bed events.
    if (now > this.eventAt) {
      if (this.kind === 'coast') this.gull(now + 0.05);
      else if (this.kind === 'suburb') this.chime(this.bedGain ?? this.core.buses.ambience, now + 0.05, mtof(PENTA[Math.floor(Math.random() * 5) + 3]), 0.018);
      else if (this.kind === 'range') this.bird(now + 0.05);
      this.eventAt = now + 4 + Math.random() * 9;
    }
  }

  private radioNote(dest: AudioNode, t: number, f: number): void {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(bp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.28);
    o.onended = () => g.disconnect();
  }

  private crackle(dest: AudioNode, t: number): void {
    const ctx = this.core.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.core.noise.white;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0.008;
    s.connect(hp).connect(g).connect(dest);
    s.start(t, Math.random(), 1.1);
    s.onended = () => g.disconnect();
  }

  private chime(dest: AudioNode, t: number, f: number, level: number): void {
    const ctx = this.core.ctx;
    for (const [mult, lv] of [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level * lv, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 / mult + 0.4);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + 2.8);
      o.onended = () => g.disconnect();
    }
  }

  private drip(dest: AudioNode, t: number): void {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1400 + Math.random() * 600, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.15);
    o.onended = () => g.disconnect();
  }

  private gull(t: number): void {
    const ctx = this.core.ctx;
    const dest = this.bedGain ?? this.core.buses.ambience;
    const calls = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < calls; i++) {
      const s = t + i * 0.32;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const f = 1500 + Math.random() * 300;
      o.frequency.setValueAtTime(f, s);
      o.frequency.linearRampToValueAtTime(f * 1.35, s + 0.08);
      o.frequency.linearRampToValueAtTime(f * 0.8, s + 0.24);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.012, s + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.26);
      o.connect(g).connect(dest);
      o.start(s);
      o.stop(s + 0.3);
      o.onended = () => g.disconnect();
    }
  }

  private bird(t: number): void {
    const ctx = this.core.ctx;
    const dest = this.bedGain ?? this.core.buses.ambience;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.12;
      const o = ctx.createOscillator();
      const f = 3200 + Math.random() * 900;
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * 1.5, s + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.008, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      o.connect(g).connect(dest);
      o.start(s);
      o.stop(s + 0.1);
      o.onended = () => g.disconnect();
    }
  }

  setHrtf(on: boolean): void {
    for (const e of this.emitters) e.panner.panningModel = on ? 'HRTF' : 'equalpower';
  }

  dispose(): void {
    this.teardown();
    this.current = null;
  }
}

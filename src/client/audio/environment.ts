// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map environments: reverb/echo character, ambience beds,
// positional emitters and indoor/outdoor acoustics.
//
// Reverb: a generated IR per map (reverb.ts) on the outdoor convolver and a
// tunnel IR on the indoor convolver. When the match provides an occlusion
// probe, a cheap "roof over my head?" test (4×/s, with hysteresis) crossfades
// outdoor ↔ indoor acoustics, pulls the map echo back and muffles the bed.
// Echo: ping-pong delay tuned per map (coastal slap, suburban flutter, huge
// canyon repeats in the mountains).
// Beds are driven by a shared random-walk "gust" (no sine-wave LFO pumping):
//   coast   sea rumble + surf, wave washes with foam fizz, gulls, a buoy bell,
//           rigging clinks
//   suburb  breeze + leaves, songbirds, a lawn sprinkler, a far-off dog
//   wind    low roar + gusts + a thin whistle over rock, a distant hawk
//   range   warm air, crickets, birds
// Emitters: the radio (radio.ts), wind chimes that ring with the gusts,
// harbour machinery (diesel throb, clanks, hydraulic hiss), lapping water,
// drips (rising "plip"), mains hum + neon buzz. Each emitter has a low-pass
// that closes when geometry blocks it, and is culled when far away.
// ─────────────────────────────────────────────────────────────────────────────

import type { MapAudioDef, MapDef } from '../../shared/maps/types';
import type { Vec3 } from '../../shared/types';
import { setEcho, type AudioCore } from './core';
import { RadioStation } from './radio';
import { makeImpulse } from './reverb';
import type { Spatializer } from './spatial';
import { mtof, rand, Synth } from './synth';

type EmitterKind = MapAudioDef['emitters'][number]['kind'];
type BedKind = MapAudioDef['ambience'];
type ReverbKind = MapAudioDef['reverb'];

interface Emitter {
  kind: EmitterKind;
  pos: Vec3;
  radius: number;
  panner: PannerNode;
  lp: BiquadFilterNode;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  next: number;
  audible: boolean;
  occluded: boolean;
  radio: RadioStation | null;
  tubes: number[];
}

/** [delay s, feedback, tone Hz] */
const ECHO: Record<ReverbKind, [number, number, number]> = {
  open: [0.26, 0.22, 2200],
  coastal: [0.36, 0.32, 2000],
  suburb: [0.17, 0.15, 2600],
  mountain: [0.62, 0.45, 1500],
  indoor: [0.09, 0.1, 2800],
};

const PENTA = [72, 74, 76, 79, 81, 84, 86, 88, 91];
const BED_TRIM = 0.4;

interface GustParam {
  param: AudioParam;
  base: number;
  depth: number;
}

export class Environment {
  private readonly core: AudioCore;
  private readonly spatial: Spatializer;
  private readonly s: Synth;
  private current: MapDef | null = null;
  private bed: BedKind | null = null;
  private reverbKind: ReverbKind = 'open';
  private bedOut: GainNode | null = null;
  private bedNodes: AudioNode[] = [];
  private bedSources: AudioScheduledSourceNode[] = [];
  private gustParams: GustParam[] = [];
  private gust = 0.5;
  private gustAt = 0;
  private events = new Map<string, number>();
  private emitters: Emitter[] = [];
  private echoBase = 0.55;
  private indoor = 0;
  private indoorVotes = 0;
  private probeAt = 0;
  private emitterProbeAt = 0;

  constructor(core: AudioCore, spatial: Spatializer) {
    this.core = core;
    this.spatial = spatial;
    this.s = new Synth(core);
    this.applyReverb();
  }

  /** 0 = outdoors, 1 = under a roof (for tests / debug). */
  get indoorness(): number {
    return this.indoor;
  }

  set(map: MapDef | null): void {
    if (map === this.current) return;
    this.current = map;
    this.teardown();
    const core = this.core;
    const t = core.ctx.currentTime;
    this.setIndoor(0, true);
    if (!map) {
      this.reverbKind = 'open';
      this.applyReverb();
      setEcho(core, 0.26, 0);
      return;
    }
    const a = map.audio;
    this.reverbKind = a.reverb;
    this.applyReverb();
    const [delay, fb, tone] = ECHO[a.reverb] ?? ECHO.open;
    setEcho(core, delay, Math.min(0.55, fb * (0.6 + a.echo * 0.6)), tone);
    this.echoBase = 0.3 + 0.45 * a.echo;
    core.echoReturn.gain.setTargetAtTime(this.echoBase, t, 0.1);
    this.bed = a.ambience;
    this.buildBed(a.ambience);
    for (const e of a.emitters) this.addEmitter(e.kind, e.pos, e.radius);
  }

  /** Lite: no convolution (the reverb send feeds the echo network instead). */
  setLite(lite: boolean): void {
    this.core.lite = lite;
    this.applyReverb();
  }

  private applyReverb(): void {
    const c = this.core;
    const t = c.ctx.currentTime;
    if (c.lite) {
      c.convolver.buffer = null;
      c.convolverIndoor.buffer = null;
      c.reverbLite.gain.setTargetAtTime(0.35, t, 0.05);
    } else {
      c.convolver.buffer = makeImpulse(c.ctx, this.reverbKind);
      c.convolverIndoor.buffer = makeImpulse(c.ctx, 'indoor');
      c.reverbLite.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  private setIndoor(k: number, immediate = false): void {
    this.indoor = k;
    const c = this.core;
    const t = c.ctx.currentTime;
    const tc = immediate ? 0.01 : 0.35;
    c.reverbIndoor.gain.setTargetAtTime(k, t, tc);
    c.reverbOutdoor.gain.setTargetAtTime(1 - 0.7 * k, t, tc);
    c.echoReturn.gain.setTargetAtTime(this.echoBase * (1 - 0.7 * k), t, tc);
    c.ambFilter.frequency.setTargetAtTime(k > 0.5 ? 900 : 18000, t, tc);
  }

  private teardown(): void {
    const t = this.core.ctx.currentTime;
    if (this.bedOut) this.bedOut.gain.setTargetAtTime(0, t, 0.3);
    for (const e of this.emitters) e.gain.gain.setTargetAtTime(0, t, 0.3);
    const oldSources = [...this.bedSources, ...this.emitters.flatMap((e) => e.sources)];
    const oldNodes = [...this.bedNodes, ...this.emitters.flatMap((e) => [e.panner, e.lp, e.gain, ...e.nodes])];
    const radios = this.emitters.map((e) => e.radio).filter((r): r is RadioStation => !!r);
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
      for (const r of radios) r.dispose();
    }, 1500);
    this.bedSources = [];
    this.bedNodes = [];
    this.bedOut = null;
    this.gustParams = [];
    this.emitters = [];
    this.events.clear();
    this.bed = null;
  }

  // ── Bed ─────────────────────────────────────────────────────────────────

  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.core.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(this.core.ctx.currentTime, Math.random() * buf.duration * 0.9);
    this.bedSources.push(s);
    return s;
  }

  /** noise → filter → gain → bed, with the gain (and optionally frequency) following the gust. */
  private layer(buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, level: number, gustDepth: number, freqDepth = 0): void {
    const ctx = this.core.ctx;
    const out = this.bedOut;
    if (!out) return;
    const src = this.loop(buf);
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, level + gustDepth * this.gust);
    src.connect(flt).connect(g).connect(out);
    this.bedNodes.push(flt, g);
    this.gustParams.push({ param: g.gain, base: level, depth: gustDepth });
    if (freqDepth) this.gustParams.push({ param: flt.frequency, base: f, depth: freqDepth });
  }

  private buildBed(kind: BedKind): void {
    const ctx = this.core.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    // Beds sit well under footsteps (≈ −55 dB A): texture, never masking.
    out.gain.setTargetAtTime(BED_TRIM, ctx.currentTime, 1.2);
    out.connect(this.core.buses.ambience);
    this.bedOut = out;
    this.bedNodes.push(out);
    const n = this.core.noise;
    if (kind === 'coast') {
      this.layer(n.brown, 'lowpass', 260, 0.5, 0.04, 0.02);
      this.layer(n.pink, 'bandpass', 500, 0.5, 0.025, 0.02);
    } else if (kind === 'suburb') {
      this.layer(n.brown, 'lowpass', 180, 0.5, 0.015, 0);
      this.layer(n.pink, 'bandpass', 700, 0.5, 0.02, 0.05, 250);
      this.layer(n.white, 'bandpass', 4500, 0.7, -0.004, 0.012);
    } else if (kind === 'wind') {
      this.layer(n.brown, 'lowpass', 300, 0.5, 0.02, 0.04);
      this.layer(n.pink, 'bandpass', 800, 1, 0.01, 0.06, 500);
      this.layer(n.white, 'bandpass', 1250, 14, -0.02, 0.045, 250);
    } else {
      this.layer(n.brown, 'lowpass', 500, 0.5, 0.015, 0.01);
    }
  }

  private due(key: string, now: number, min: number, max: number): boolean {
    const at = this.events.get(key);
    if (at === undefined) {
      this.events.set(key, now + rand(min * 0.3, max * 0.6));
      return false;
    }
    if (now < at) return false;
    this.events.set(key, now + rand(min, max));
    return true;
  }

  private bedEvents(now: number): void {
    const d = this.bedOut;
    if (!d) return;
    const t = now + 0.05;
    const s = this.s;
    switch (this.bed) {
      case 'coast':
        if (this.due('wash', now, 4.5, 9)) this.wash(d, t);
        if (this.due('gull', now, 7, 18)) this.gull(d, t);
        if (this.due('buoy', now, 18, 40)) {
          const pan = rand(-0.8, 0.8);
          for (let i = 0; i < 2; i++) s.bell(d, t + i * rand(1.1, 1.6), 523 * rand(0.99, 1.01), 0.012, 2.2, pan);
        }
        if (this.due('clink', now, 6, 15)) s.tone(d, t, { freq: rand(2600, 3400), gain: 0.006, decay: 0.3, pan: rand(-0.7, 0.7) });
        break;
      case 'suburb':
        if (this.due('bird', now, 5, 13)) this.songbird(d, t);
        if (this.due('sprinkler', now, 30, 60)) this.sprinkler(d, t);
        if (this.due('dog', now, 40, 80)) this.dog(d, t);
        break;
      case 'wind':
        if (this.due('hawk', now, 30, 70)) this.hawk(d, t);
        break;
      case 'range':
        if (this.due('cricket', now, 1.5, 4)) this.cricket(d, t);
        if (this.due('bird', now, 5, 12)) this.songbird(d, t);
        break;
    }
  }

  private wash(d: AudioNode, t: number): void {
    const pan = rand(-0.6, 0.6);
    const k = rand(0.7, 1.2);
    this.s.noise(d, t, { kind: 'pink', filter: 'bandpass', freq: 320, freqEnd: 1300, sweep: 1.8, q: 0.6, gain: 0.1 * k, attack: 1.6, hold: 0.3, decay: 2.8, pan });
    this.s.noise(d, t + 1.5, { filter: 'highpass', freq: 2600, freqEnd: 4200, q: 0.5, gain: 0.022 * k, attack: 0.4, decay: 2.2, pan: -pan * 0.5 });
  }

  private gull(d: AudioNode, t: number): void {
    const ctx = this.core.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.9, 0.9);
    pan.connect(d);
    const calls = 2 + Math.floor(Math.random() * 3);
    const base = rand(820, 1000);
    let end = t;
    for (let i = 0; i < calls; i++) {
      const s = t + i * rand(0.28, 0.4);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base, s);
      o.frequency.linearRampToValueAtTime(base * 1.45, s + 0.06);
      o.frequency.exponentialRampToValueAtTime(base * 0.75, s + 0.26);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.012, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.00001, s + 0.28);
      o.connect(bp).connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.3);
      o.onended = () => {
        bp.disconnect();
        g.disconnect();
      };
      end = s + 0.3;
    }
    setTimeout(() => pan.disconnect(), (end - ctx.currentTime + 0.5) * 1000);
  }

  private songbird(d: AudioNode, t: number): void {
    const pan = rand(-0.8, 0.8);
    const f = rand(2800, 3800);
    const notes = 3 + Math.floor(Math.random() * 4);
    let at = t;
    for (let i = 0; i < notes; i++) {
      const up = Math.random() < 0.5;
      this.s.tone(d, at, { freq: f * rand(0.9, 1.15), freqEnd: f * (up ? 1.4 : 0.8), glide: 0.05, gain: 0.006, decay: 0.06, attack: 0.004, pan, vib: [rand(25, 45), 60] });
      at += rand(0.08, 0.16);
    }
  }

  private sprinkler(d: AudioNode, t: number): void {
    const pan = rand(-0.9, 0.9);
    const n = 28 + Math.floor(Math.random() * 10);
    for (let i = 0; i < n; i++) this.s.noise(d, t + i * 0.1, { filter: 'bandpass', freq: 3200, q: 2, gain: 0.007, decay: 0.03, pan });
    // Fast return ratchet.
    for (let i = 0; i < 16; i++) this.s.noise(d, t + n * 0.1 + i * 0.03, { filter: 'bandpass', freq: 3600, q: 2, gain: 0.004, decay: 0.012, pan });
  }

  private dog(d: AudioNode, t: number): void {
    // Far away and dark: two short formant barks.
    const pan = rand(-1, 1) > 0 ? rand(0.5, 0.9) : rand(-0.9, -0.5);
    const barks = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < barks; i++) {
      const s = t + i * rand(0.35, 0.5);
      this.s.tone(d, s, { wave: 'sawtooth', freq: 420, freqEnd: 300, glide: 0.09, gain: 0.006, attack: 0.008, decay: 0.1, filter: { type: 'bandpass', freq: 700, q: 2.5 }, pan });
      this.s.noise(d, s, { filter: 'bandpass', freq: 900, q: 1.5, gain: 0.004, attack: 0.006, decay: 0.08, pan, filter2: { type: 'lowpass', freq: 1200 } });
    }
  }

  private hawk(d: AudioNode, t: number): void {
    const pan = rand(-0.9, 0.9);
    this.s.tone(d, t, { freq: 2300, freqEnd: 1500, glide: 0.9, gain: 0.006, attack: 0.08, hold: 0.2, decay: 0.7, vib: [22, 50], pan, filter: { type: 'lowpass', freq: 3000 } });
  }

  private cricket(d: AudioNode, t: number): void {
    const pan = rand(-0.9, 0.9);
    const f = rand(4200, 4700);
    const pulses = 3 + Math.floor(Math.random() * 2);
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i < pulses; i++) this.s.tone(d, t + rep * 0.35 + i * 0.026, { freq: f, gain: 0.004, attack: 0.003, decay: 0.012, pan });
    }
  }

  // ── Emitters ────────────────────────────────────────────────────────────

  private addEmitter(kind: EmitterKind, pos: Vec3, radius: number): void {
    const ctx = this.core.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = this.core.hrtf && !this.core.lite ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.maxDistance = Math.max(4, radius * 2.2);
    panner.rolloffFactor = 1;
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 16000;
    lp.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(lp).connect(panner).connect(this.core.buses.ambience);
    const em: Emitter = {
      kind,
      pos,
      radius,
      panner,
      lp,
      gain,
      sources: [],
      nodes: [],
      next: ctx.currentTime + Math.random(),
      audible: false,
      occluded: false,
      radio: null,
      tubes: [],
    };
    const n = this.core.noise;
    const loopInto = (buf: AudioBuffer, type: BiquadFilterType, f: number, level: number) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = level;
      s.connect(flt).connect(g).connect(gain);
      s.start(ctx.currentTime, Math.random() * buf.duration * 0.9);
      em.sources.push(s);
      em.nodes.push(flt, g);
      return g;
    };
    const osc = (type: OscillatorType, f: number, level: number, dest: AudioNode = gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(dest);
      o.start();
      em.sources.push(o);
      em.nodes.push(g);
      return { o, g };
    };
    switch (kind) {
      case 'radio':
        em.radio = new RadioStation(this.core, this.s, gain);
        break;
      case 'machinery': {
        // Diesel idle: filtered saw with a 6.5 Hz throb, plus rumble.
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 260;
        lpf.connect(gain);
        em.nodes.push(lpf);
        const { g } = osc('sawtooth', 46, 0.03, lpf);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 6.5;
        const lg = ctx.createGain();
        lg.gain.value = 0.012;
        lfo.connect(lg).connect(g.gain);
        lfo.start();
        em.sources.push(lfo);
        em.nodes.push(lg);
        loopInto(n.brown, 'lowpass', 400, 0.022);
        // Engine-block chatter (mid band) so it reads on small speakers too.
        loopInto(n.pink, 'bandpass', 900, 0.006);
        break;
      }
      case 'waves':
        loopInto(n.pink, 'lowpass', 400, 0.03);
        break;
      case 'hum': {
        osc('sine', 60, 0.02);
        osc('sine', 120, 0.012);
        osc('sine', 180, 0.006);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2200;
        bp.Q.value = 2;
        bp.connect(gain);
        em.nodes.push(bp);
        osc('sawtooth', 120, 0.004, bp);
        break;
      }
      case 'wind_chime': {
        const pool = [...PENTA];
        for (let i = 0; i < 5; i++) em.tubes.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        break;
      }
      default:
        break;
    }
    this.emitters.push(em);
  }

  private emitterEvent(em: Emitter, t: number): void {
    const s = this.s;
    const d = em.gain;
    switch (em.kind) {
      case 'wind_chime': {
        const tube = em.tubes[Math.floor(Math.random() * em.tubes.length)] ?? 84;
        this.chime(d, t, mtof(tube), rand(0.03, 0.06) * (0.5 + this.gust * 0.6));
        // More gust → clusters.
        em.next = t + (Math.random() < 0.25 + this.gust * 0.5 ? rand(0.12, 0.45) : rand(1.2, 4));
        break;
      }
      case 'drip':
        s.tone(d, t, { freq: rand(600, 900), freqEnd: rand(1300, 1900), glide: 0.035, gain: 0.05, decay: 0.05, attack: 0.001 });
        s.noise(d, t, { filter: 'bandpass', freq: 2500, q: 2, gain: 0.02, decay: 0.01 });
        em.next = t + (Math.random() < 0.3 ? rand(0.25, 0.6) : rand(0.9, 3));
        break;
      case 'machinery':
        if (Math.random() < 0.8) {
          s.clack(d, t, rand(700, 1100), rand(0.05, 0.1), 0.35, 90);
          if (Math.random() < 0.4) s.clack(d, t + rand(0.15, 0.3), rand(800, 1200), 0.05, 0.3);
        } else s.noise(d, t, { filter: 'highpass', freq: 2200, gain: 0.025, attack: 0.05, hold: 0.6, decay: 0.8 });
        em.next = t + rand(3, 9);
        break;
      case 'waves':
        s.noise(d, t, { kind: 'pink', filter: 'bandpass', freq: 500, freqEnd: 950, q: 0.8, gain: 0.07, attack: 0.15, decay: 0.55 });
        s.noise(d, t + 0.05, { kind: 'brown', filter: 'lowpass', freq: 300, gain: 0.06, attack: 0.1, decay: 0.5 });
        em.next = t + rand(1.2, 3);
        break;
      case 'hum':
        // Neon flicker.
        s.noise(d, t, { filter: 'bandpass', freq: 3000, q: 1, gain: 0.006, decay: 0.03 });
        em.next = t + rand(2, 8);
        break;
      default:
        em.next = t + 10;
    }
  }

  private chime(dest: AudioNode, t: number, f: number, level: number): void {
    // Tubular chime partials.
    for (const [mult, lv, dec] of [
      [1, 1, 2.4],
      [2.76, 0.4, 1.2],
      [5.4, 0.16, 0.6],
      [8.93, 0.06, 0.3],
    ] as const) {
      this.s.tone(dest, t, { freq: f * mult, gain: level * lv, attack: 0.002, decay: dec });
    }
  }

  // ── Per frame ───────────────────────────────────────────────────────────

  update(): void {
    if (!this.current) return;
    const ctx = this.core.ctx;
    const now = ctx.currentTime;
    // Gusts: a random walk (occasionally a big one) the bed and chimes follow.
    if (now > this.gustAt) {
      const big = Math.random() < 0.15;
      this.gust = big ? rand(0.8, 1) : Math.max(0.1, Math.min(0.85, this.gust + rand(-0.35, 0.35)));
      const tc = big ? rand(0.4, 0.7) : rand(0.8, 1.6);
      for (const g of this.gustParams) g.param.setTargetAtTime(Math.max(0, g.base + g.depth * this.gust), now, tc);
      this.gustAt = now + rand(1.2, 3.5);
    }
    // Indoor / outdoor (needs the match's occlusion probe).
    if (now > this.probeAt) {
      this.probeAt = now + 0.25;
      if (this.spatial.hasProbe) {
        const L = this.spatial.listener;
        const roof = this.spatial.blocked(L.x, L.y + 0.1, L.z, L.x, L.y + 14, L.z);
        this.indoorVotes = Math.max(-2, Math.min(2, this.indoorVotes + (roof ? 1 : -1)));
        const want = this.indoorVotes >= 2 ? 1 : this.indoorVotes <= -2 ? 0 : this.indoor;
        if (want !== this.indoor) this.setIndoor(want);
      }
    }
    this.bedEvents(now);
    const probeEmitters = now > this.emitterProbeAt;
    if (probeEmitters) this.emitterProbeAt = now + 0.5;
    const ahead = now + 0.3;
    for (const em of this.emitters) {
      const dist = this.spatial.distance(em.pos);
      const audible = dist < em.radius * 2.4;
      if (audible !== em.audible) {
        em.audible = audible;
        em.gain.gain.setTargetAtTime(audible ? 1 : 0, now, 0.25);
      }
      if (!audible) {
        if (em.next < now) em.next = now + 0.5;
        continue;
      }
      if (probeEmitters && this.spatial.hasProbe) {
        const L = this.spatial.listener;
        const occ = this.spatial.blocked(L.x, L.y, L.z, em.pos.x, em.pos.y, em.pos.z);
        if (occ !== em.occluded) {
          em.occluded = occ;
          em.lp.frequency.setTargetAtTime(occ ? 900 : 16000, now, 0.15);
        }
      }
      if (em.radio) {
        em.radio.schedule(ahead);
        continue;
      }
      if (em.next < now - 1) em.next = now + 0.05;
      let guard = 0;
      while (em.next < ahead && guard++ < 8) this.emitterEvent(em, Math.max(em.next, now + 0.01));
    }
  }

  setHrtf(on: boolean): void {
    for (const e of this.emitters) e.panner.panningModel = on && !this.core.lite ? 'HRTF' : 'equalpower';
  }

  dispose(): void {
    this.teardown();
    this.current = null;
  }
}

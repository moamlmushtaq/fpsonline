// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — generative warm analog-synth score (1970s sci-fi).
//
// One theme ties everything together: the four-bar "Halcyon motif"
// (A – F♯ – E – D … B – C♯ – D – A) and its answer. It is sung by a soft lead
// in the menu, turns minor in matches, becomes an urgent eighth-note figure in
// the final minute (a whole step higher: D minor → E minor, then up another
// semitone) and returns as the victory fanfare / defeat lament.
//
// Instruments (all per-note Web Audio voices):
//   pad   detuned saws → slow-swept low-pass → stereo chorus → hall reverb
//   bass  sub (sine+triangle) or pulsing filtered saw (8ths / 16ths)
//   arp   plucked triangle+saw with a filter envelope → ping-pong delay
//   lead  triangle+saw, delayed vibrato, gentle glide → delay + hall
//   drums kick / snare / hats / rim / shaker / crash / toms / risers
//   bell  high glassy chimes (sparkle in calm sections)
// A shared tape-wobble (0.37 Hz) + flutter (5.3 Hz) detunes every oscillator,
// and the bus goes through a gentle tape saturation and roll-off.
//
// Arrangement: each state is a list of sections (bars, chords, which layers
// play, patterns) that loops with small random variations (arp pattern, bell
// sparkle, fills), with "breath" sections so it never becomes fatiguing.
// State changes land on the next bar line with layer crossfades; the switch
// into the final minute plays a one-bar riser + snare roll first; victory and
// defeat cut in immediately with a stinger, then settle into a calm bed.
// Scheduling: 25 ms timer, 250 ms lookahead against the audio clock (sample-
// accurate, nearly free on the main thread). scheduleUntil() also lets an
// OfflineAudioContext render the score for measurement.
// ─────────────────────────────────────────────────────────────────────────────

import type { MusicState } from '../contracts';
import type { AudioCore } from './core';
import { makeImpulse } from './reverb';
import { mtof, rand } from './synth';

interface Chord {
  root: number;
  notes: number[];
}

/** [step (16ths from phrase start), midi, length in 16ths] */
type Phrase = [number, number, number][];

type Layer = 'pad' | 'bass' | 'arp' | 'lead' | 'drums' | 'perc' | 'bell';
type ArpPattern = 'up8' | 'updown8' | 'up16' | 'broken16' | 'sparse';
type BassPattern = 'sub' | 'pulse8' | 'drive16' | 'offbeat';
type DrumPattern = 'light' | 'groove' | 'drive';

interface Section {
  name: string;
  bars: number;
  prog: Chord[];
  transpose?: number;
  layers: Partial<Record<Layer, number>>;
  /** One phrase per 4 bars, cycled. */
  lead?: Phrase[];
  arp?: ArpPattern[];
  bass?: BassPattern;
  drums?: DrumPattern;
  /** Riser into the next section (last bar). */
  riser?: boolean;
  /** Pad filter cutoff for this section. */
  cutoff?: number;
}

interface StateDef {
  bpm: number;
  sections: Section[];
  /** Section index to loop back to. */
  loopFrom: number;
  padAttack: number;
  padRelease: number;
  leadTone: number;
}

// ── Harmony ────────────────────────────────────────────────────────────────

const PROG_A: Chord[] = [
  { root: 38, notes: [62, 66, 69, 73, 76] }, // Dmaj9
  { root: 35, notes: [59, 62, 66, 69, 73] }, // Bm9
  { root: 31, notes: [55, 59, 62, 66, 69] }, // Gmaj9
  { root: 33, notes: [57, 62, 64, 66, 69] }, // A6sus4
];
const PROG_B: Chord[] = [
  { root: 40, notes: [55, 59, 62, 66] }, // Em9
  { root: 42, notes: [57, 61, 64, 69] }, // F#m7
  { root: 43, notes: [59, 62, 66, 69] }, // Gmaj7
  { root: 45, notes: [57, 62, 64, 66] }, // A6sus4
];
const PROG_M: Chord[] = [
  { root: 38, notes: [62, 65, 69, 72, 76] }, // Dm9
  { root: 34, notes: [58, 62, 65, 69] }, // Bbmaj7
  { root: 31, notes: [55, 58, 62, 65, 69] }, // Gm9
  { root: 33, notes: [57, 62, 64, 67] }, // A7sus4
];
const PROG_M2: Chord[] = [
  { root: 34, notes: [58, 62, 65, 69] }, // Bbmaj7
  { root: 36, notes: [60, 64, 67, 72] }, // C
  { root: 38, notes: [62, 65, 69, 74] }, // Dm
  { root: 33, notes: [57, 61, 64, 67] }, // A7
];
const PROG_F: Chord[] = [
  { root: 40, notes: [64, 67, 71, 76] }, // Em
  { root: 36, notes: [60, 64, 67, 72] }, // C
  { root: 38, notes: [62, 66, 69, 74] }, // D
  { root: 35, notes: [59, 63, 66, 69] }, // B7
];

// ── Themes ─────────────────────────────────────────────────────────────────

const MOTIF_A: Phrase = [
  [0, 69, 6], [6, 78, 2], [8, 76, 4], [12, 74, 4],
  [16, 71, 4], [20, 73, 2], [22, 74, 2], [24, 69, 8],
  [32, 69, 6], [38, 78, 2], [40, 81, 8], [48, 79, 2], [50, 78, 2], [52, 76, 4],
  [56, 78, 8],
];
const MOTIF_A_ANSWER: Phrase = [
  [0, 81, 6], [6, 79, 2], [8, 78, 4], [12, 76, 4],
  [16, 74, 6], [22, 76, 2], [24, 71, 8],
  [32, 69, 4], [36, 71, 4], [40, 73, 4], [44, 76, 4],
  [48, 74, 14],
];
const MOTIF_MIN: Phrase = [
  [0, 69, 6], [6, 77, 2], [8, 76, 4], [12, 74, 4],
  [16, 70, 4], [20, 72, 2], [22, 74, 2], [24, 69, 8],
  [32, 69, 6], [38, 77, 2], [40, 81, 8], [48, 79, 2], [50, 77, 2], [52, 76, 4],
  [56, 76, 8],
];
const MOTIF_MIN_ANSWER: Phrase = [
  [0, 81, 6], [6, 79, 2], [8, 77, 4], [12, 76, 4],
  [16, 74, 6], [22, 76, 2], [24, 70, 8],
  [32, 67, 4], [36, 69, 4], [40, 70, 4], [44, 74, 4],
  [48, 76, 12],
];
const MOTIF_FINAL: Phrase = [
  [0, 71, 2], [2, 74, 2], [4, 76, 4], [8, 79, 2], [10, 78, 2], [12, 76, 4],
  [16, 72, 2], [18, 74, 2], [20, 76, 4], [24, 79, 4], [28, 76, 4],
  [32, 74, 2], [34, 76, 2], [36, 78, 4], [40, 81, 4], [44, 78, 4],
  [48, 75, 4], [52, 78, 4], [56, 83, 8],
];
const MOTIF_HEAD: Phrase = MOTIF_A.slice(0, 8);

// ── Arrangements ───────────────────────────────────────────────────────────

const STATES: Record<Exclude<MusicState, 'off'>, StateDef> = {
  menu: {
    bpm: 72,
    loopFrom: 1,
    padAttack: 1.3,
    padRelease: 2.6,
    leadTone: 1800,
    sections: [
      { name: 'intro', bars: 4, prog: PROG_A, layers: { pad: 0.8, bell: 1 }, cutoff: 900 },
      { name: 'theme', bars: 8, prog: PROG_A, layers: { pad: 1, bass: 0.8, lead: 1, bell: 0.4 }, lead: [MOTIF_A, MOTIF_A_ANSWER], bass: 'sub', cutoff: 1100 },
      { name: 'drift', bars: 8, prog: PROG_B, layers: { pad: 0.9, bass: 0.8, arp: 0.8 }, arp: ['updown8', 'up8'], bass: 'sub', cutoff: 1300 },
      { name: 'theme2', bars: 8, prog: PROG_A, layers: { pad: 1, bass: 0.9, arp: 0.55, lead: 1 }, lead: [MOTIF_A, MOTIF_A_ANSWER], arp: ['sparse', 'up8'], bass: 'sub', cutoff: 1400 },
      { name: 'rest', bars: 4, prog: PROG_A, layers: { pad: 0.75, bell: 1 }, cutoff: 800 },
    ],
  },
  lobby: {
    bpm: 88,
    loopFrom: 0,
    padAttack: 0.8,
    padRelease: 1.8,
    leadTone: 2000,
    sections: [
      { name: 'pulse', bars: 8, prog: PROG_A, layers: { pad: 0.8, bass: 0.7, arp: 0.8, perc: 0.5 }, arp: ['up8', 'broken16'], bass: 'pulse8', cutoff: 1400 },
      { name: 'call', bars: 8, prog: PROG_B, layers: { pad: 0.8, bass: 0.7, arp: 0.6, perc: 0.6, lead: 0.8 }, lead: [MOTIF_HEAD], arp: ['broken16', 'updown8'], bass: 'pulse8', cutoff: 1600 },
    ],
  },
  match: {
    bpm: 100,
    loopFrom: 0,
    padAttack: 0.6,
    padRelease: 1.6,
    leadTone: 2200,
    sections: [
      { name: 'groove', bars: 8, prog: PROG_M, layers: { pad: 0.7, bass: 1, drums: 0.8, perc: 0.7, arp: 0.5 }, arp: ['sparse'], bass: 'pulse8', drums: 'light', cutoff: 1400 },
      { name: 'motif', bars: 8, prog: PROG_M, layers: { pad: 0.7, bass: 1, drums: 0.8, perc: 0.7, lead: 0.8 }, lead: [MOTIF_MIN, MOTIF_MIN_ANSWER], bass: 'pulse8', drums: 'light', cutoff: 1500 },
      { name: 'lift', bars: 8, prog: PROG_M2, layers: { pad: 0.8, bass: 1, drums: 1, perc: 1, arp: 0.7 }, arp: ['up16', 'broken16'], bass: 'pulse8', drums: 'groove', cutoff: 1900, riser: true },
      { name: 'breath', bars: 4, prog: PROG_M, layers: { pad: 1, bass: 0.7, bell: 0.6 }, bass: 'sub', cutoff: 1100 },
    ],
  },
  final: {
    bpm: 118,
    loopFrom: 0,
    padAttack: 0.25,
    padRelease: 1,
    leadTone: 2800,
    sections: [
      { name: 'drive', bars: 8, prog: PROG_F, layers: { pad: 0.7, bass: 1, drums: 1, perc: 1, arp: 0.9 }, arp: ['up16', 'broken16'], bass: 'drive16', drums: 'drive', cutoff: 2200, riser: true },
      { name: 'surge', bars: 8, prog: PROG_F, transpose: 1, layers: { pad: 0.7, bass: 1, drums: 1, perc: 1, arp: 0.7, lead: 0.9 }, lead: [MOTIF_FINAL], arp: ['up16'], bass: 'drive16', drums: 'drive', cutoff: 2600, riser: true },
    ],
  },
  victory: {
    bpm: 76,
    loopFrom: 0,
    padAttack: 1.2,
    padRelease: 2.4,
    leadTone: 2000,
    sections: [
      { name: 'glow', bars: 8, prog: PROG_A, layers: { pad: 0.85, bass: 0.6, bell: 0.9, arp: 0.4 }, arp: ['sparse'], bass: 'sub', cutoff: 1400 },
      { name: 'glow-theme', bars: 8, prog: PROG_A, layers: { pad: 0.85, bass: 0.6, lead: 0.7 }, lead: [MOTIF_A, MOTIF_A_ANSWER], bass: 'sub', cutoff: 1300 },
    ],
  },
  defeat: {
    bpm: 62,
    loopFrom: 0,
    padAttack: 1.6,
    padRelease: 3,
    leadTone: 1300,
    sections: [{ name: 'dusk', bars: 8, prog: PROG_M, layers: { pad: 0.7, bass: 0.4, bell: 0.5 }, bass: 'sub', cutoff: 800 }],
  },
};

/** Base level of each layer into the music bus (before section scaling). */
const LAYER_LEVEL: Record<Layer, number> = { pad: 0.26, bass: 0.22, arp: 0.1, lead: 0.085, drums: 0.3, perc: 0.13, bell: 0.045 };
/**
 * Per-state overall trim. Measured (A-weighted, default sliders): menu ≈ −34 dB;
 * in matches the score sits ≈ 12 dB under a rifle shot so footsteps and
 * reloads stay readable; the final minute is ~2 dB hotter than the match.
 */
const STATE_TRIM: Record<Exclude<MusicState, 'off'>, number> = { menu: 1, lobby: 0.9, match: 0.42, final: 0.52, victory: 0.95, defeat: 1 };

const LOOKAHEAD = 0.25;

export class Music {
  private readonly core: AudioCore;
  private readonly out: GainNode;
  private readonly layers: Record<Layer, GainNode>;
  private readonly padFilter: BiquadFilterNode;
  private readonly wobble: GainNode;
  private readonly chorusWet: GainNode[] = [];
  private readonly hall: ConvolverNode;
  private readonly hallSend: GainNode;
  private readonly delaySend: GainNode;
  private readonly lfos: OscillatorNode[] = [];
  private state: MusicState = 'off';
  private def: StateDef = STATES.menu;
  private pending: MusicState | null = null;
  private transitionBar = false;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private sectionIdx = 0;
  private barInSection = 0;
  private arpIdx = 0;
  private arpPattern: ArpPattern = 'up8';
  private lastLead = 0;
  private lite = false;
  private stopAt = 0;
  private running = false;

  constructor(core: AudioCore) {
    this.core = core;
    const ctx = core.ctx;
    // Output: gentle tape saturation + roll-off → music bus.
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const tape = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(1.4 * x) / Math.tanh(1.4);
    }
    tape.curve = curve;
    const roll = ctx.createBiquadFilter();
    roll.type = 'lowpass';
    roll.frequency.value = 11000;
    roll.Q.value = 0.5;
    this.out.connect(tape).connect(roll).connect(core.buses.music);

    // Hall reverb + ping-pong delay (music never uses the map acoustics).
    this.hall = ctx.createConvolver();
    this.hallSend = ctx.createGain();
    const hallRet = ctx.createGain();
    hallRet.gain.value = 0.5;
    this.hallSend.connect(this.hall).connect(hallRet).connect(this.out);
    this.delaySend = ctx.createGain();
    const dl = ctx.createDelay(2);
    const dr = ctx.createDelay(2);
    const fb1 = ctx.createGain();
    const fb2 = ctx.createGain();
    fb1.gain.value = 0.38;
    fb2.gain.value = 0.38;
    const dTone = ctx.createBiquadFilter();
    dTone.type = 'lowpass';
    dTone.frequency.value = 2600;
    const pl = ctx.createStereoPanner();
    pl.pan.value = -0.6;
    const pr = ctx.createStereoPanner();
    pr.pan.value = 0.6;
    const dRet = ctx.createGain();
    dRet.gain.value = 0.45;
    this.delaySend.connect(dTone).connect(dl);
    dl.connect(pl).connect(dRet);
    dl.connect(fb1).connect(dr);
    dr.connect(pr).connect(dRet);
    dr.connect(fb2).connect(dl);
    dRet.connect(this.out);
    dRet.connect(this.hallSend);
    this.setDelayTime(dl, dr);

    // Layers.
    const mk = (): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      return g;
    };
    this.layers = { pad: mk(), bass: mk(), arp: mk(), lead: mk(), drums: mk(), perc: mk(), bell: mk() };
    // Pad: filter → chorus (dry + two modulated delays) → pad layer.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1000;
    this.padFilter.Q.value = 0.7;
    this.padFilter.connect(this.layers.pad);
    for (const [base, depth, rate, pan] of [
      [0.012, 0.0025, 0.5, -0.75],
      [0.017, 0.003, 0.63, 0.75],
    ] as const) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg).connect(d.delayTime);
      lfo.start();
      this.lfos.push(lfo);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      this.padFilter.connect(d).connect(p).connect(wet).connect(this.layers.pad);
      this.chorusWet.push(wet);
    }
    const padRev = ctx.createGain();
    padRev.gain.value = 0.5;
    this.layers.pad.connect(padRev).connect(this.hallSend);
    const arpDelay = ctx.createGain();
    arpDelay.gain.value = 0.5;
    this.layers.arp.connect(arpDelay).connect(this.delaySend);
    const arpRev = ctx.createGain();
    arpRev.gain.value = 0.3;
    this.layers.arp.connect(arpRev).connect(this.hallSend);
    const leadDelay = ctx.createGain();
    leadDelay.gain.value = 0.35;
    this.layers.lead.connect(leadDelay).connect(this.delaySend);
    const leadRev = ctx.createGain();
    leadRev.gain.value = 0.45;
    this.layers.lead.connect(leadRev).connect(this.hallSend);
    const bellRev = ctx.createGain();
    bellRev.gain.value = 0.8;
    this.layers.bell.connect(bellRev).connect(this.hallSend);
    const drumRev = ctx.createGain();
    drumRev.gain.value = 0.12;
    this.layers.drums.connect(drumRev).connect(this.hallSend);

    // Slow filter sweep on the pad.
    const f = ctx.createOscillator();
    f.frequency.value = 0.045;
    const fg = ctx.createGain();
    fg.gain.value = 280;
    f.connect(fg).connect(this.padFilter.frequency);
    f.start();
    // Tape wobble + flutter (cents) shared by every oscillator's detune.
    this.wobble = ctx.createGain();
    this.wobble.gain.value = 1;
    for (const [rate, cents] of [
      [0.37, 6],
      [5.3, 1.6],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = cents;
      o.connect(g).connect(this.wobble);
      o.start();
      this.lfos.push(o);
    }
    this.lfos.push(f);
    this.applyLite();
  }

  private setDelayTime(dl: DelayNode, dr: DelayNode): void {
    // Dotted eighth at the current tempo.
    const t = (60 / this.def.bpm) * 0.75;
    const now = this.core.ctx.currentTime;
    dl.delayTime.setTargetAtTime(t, now, 0.05);
    dr.delayTime.setTargetAtTime(t, now, 0.05);
    this.delayNodes = [dl, dr];
  }
  private delayNodes: DelayNode[] = [];

  /** Fewer oscillators, no chorus and no convolution on weak devices. */
  setLite(lite: boolean): void {
    if (lite === this.lite) return;
    this.lite = lite;
    this.applyLite();
  }

  private applyLite(): void {
    const t = this.core.ctx.currentTime;
    for (const w of this.chorusWet) w.gain.setTargetAtTime(this.lite ? 0 : 0.55, t, 0.05);
    this.hall.buffer = this.lite ? null : makeImpulse(this.core.ctx, 'hall');
  }

  get current(): MusicState {
    return this.state;
  }

  /** Name of the section playing (debug / tests). */
  get section(): string {
    return this.state === 'off' ? 'off' : (this.def.sections[this.sectionIdx]?.name ?? '');
  }

  setState(s: MusicState): void {
    if (s === this.state && !this.pending) return;
    if (s === this.pending) return;
    const ctx = this.core.ctx;
    const t = ctx.currentTime;
    if (s === 'off') {
      this.pending = null;
      this.state = 'off';
      this.out.gain.setTargetAtTime(0, t, 0.6);
      this.stopAt = t + 4;
      return;
    }
    this.stopAt = 0;
    const fromOff = this.state === 'off' || !this.running;
    if (s === 'victory' || s === 'defeat' || fromOff) {
      // Immediate: stingers cut in; a fresh start doesn't wait for a bar line.
      this.pending = null;
      this.transitionBar = false;
      this.enter(s, t, fromOff);
      return;
    }
    if (s === this.state) {
      this.pending = null;
      return;
    }
    this.pending = s;
    this.transitionBar = s === 'final' && this.state === 'match';
  }

  private enter(s: Exclude<MusicState, 'off'>, t: number, fromOff: boolean): void {
    const prev = this.state;
    this.state = s;
    this.def = STATES[s];
    this.sectionIdx = 0;
    this.barInSection = 0;
    this.step = 0;
    let start = t + 0.08;
    if (s === 'victory' || s === 'defeat') {
      this.silenceLayers(t, 0.25);
      start = t + this.stinger(s === 'victory', t + 0.05);
    }
    this.out.gain.setTargetAtTime(STATE_TRIM[s], t, fromOff || prev === 'off' ? 1.2 : 0.5);
    this.nextTime = start;
    if (this.delayNodes.length === 2) this.setDelayTime(this.delayNodes[0], this.delayNodes[1]);
    this.ensureRunning();
  }

  private silenceLayers(t: number, tc: number): void {
    for (const k of Object.keys(this.layers) as Layer[]) this.layers[k].gain.setTargetAtTime(0, t, tc);
  }

  private ensureRunning(): void {
    if (this.running) return;
    this.running = true;
    const offline = typeof OfflineAudioContext !== 'undefined' && this.core.ctx instanceof OfflineAudioContext;
    if (typeof window !== 'undefined' && !offline) {
      this.timer = window.setInterval(() => this.tick(), 25);
    }
  }

  private stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.running = false;
  }

  private tick(): void {
    const ctx = this.core.ctx;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.stopAt && now > this.stopAt) {
      this.stop();
      return;
    }
    if (this.state === 'off') return;
    // After a suspend (tab hidden) don't try to catch up on missed notes.
    if (this.nextTime < now - 0.3) this.nextTime = now + 0.05;
    this.scheduleUntil(now + LOOKAHEAD);
  }

  /** Schedules every step starting before `until` (also used by offline renders). */
  scheduleUntil(until: number): void {
    if (this.state === 'off') return;
    let guard = 0;
    while (this.nextTime < until && guard++ < 4096) {
      this.schedule(this.nextTime);
      this.nextTime += 60 / this.def.bpm / 4;
      this.step++;
    }
  }

  private get sec(): Section {
    return this.def.sections[this.sectionIdx] ?? this.def.sections[0];
  }

  private schedule(t: number): void {
    const in16 = this.step % 16;
    if (in16 === 0) this.barStart(t);
    if (this.transitionActive) {
      this.transitionStep(in16, t);
      return;
    }
    const sec = this.sec;
    const chord = this.chordNow();
    const tr = sec.transpose ?? 0;
    this.bassStep(sec, chord, in16, t, tr);
    this.arpStep(sec, chord, in16, t, tr);
    this.leadStep(sec, in16, t, tr);
    this.drumStep(sec, in16, t);
    this.bellStep(sec, chord, in16, t, tr);
  }

  private transitionActive = false;

  private barStart(t: number): void {
    // A requested state change lands on the bar line (after a transition bar into 'final').
    if (this.transitionActive) {
      this.transitionActive = false;
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.switchTo(p, t);
      }
    } else if (this.pending) {
      if (this.transitionBar) {
        this.transitionBar = false;
        this.transitionActive = true;
        this.transitionStart(t);
        return;
      }
      const p = this.pending;
      this.pending = null;
      this.switchTo(p, t);
    } else if (this.step > 0) {
      this.barInSection++;
      if (this.barInSection >= this.sec.bars) {
        this.barInSection = 0;
        this.sectionIdx++;
        if (this.sectionIdx >= this.def.sections.length) this.sectionIdx = this.def.loopFrom;
        this.sectionStart(t);
      }
    } else this.sectionStart(t);
    this.padChord(this.chordNow(), t, this.sec.transpose ?? 0);
  }

  private switchTo(s: MusicState, t: number): void {
    if (s === 'off') return;
    this.state = s;
    this.def = STATES[s];
    this.sectionIdx = 0;
    this.barInSection = 0;
    this.out.gain.setTargetAtTime(STATE_TRIM[s], t, 0.8);
    if (this.delayNodes.length === 2) this.setDelayTime(this.delayNodes[0], this.delayNodes[1]);
    if (s === 'final') this.crash(t, 1);
    this.sectionStart(t);
  }

  private sectionStart(t: number): void {
    const sec = this.sec;
    const tc = 0.6;
    for (const k of Object.keys(this.layers) as Layer[]) {
      const lv = (sec.layers[k] ?? 0) * LAYER_LEVEL[k];
      this.layers[k].gain.setTargetAtTime(lv, t, tc);
    }
    const pats = sec.arp ?? ['up8'];
    this.arpPattern = pats[Math.floor(Math.random() * pats.length)];
    this.arpIdx = 0;
    this.padFilter.frequency.setTargetAtTime(sec.cutoff ?? 1200, t, 1.5);
    if (sec.drums === 'drive' && this.barInSection === 0 && this.step > 0) this.crash(t, 0.7);
  }

  private chordNow(): Chord {
    const p = this.sec.prog;
    return p[this.barInSection % p.length] ?? p[0];
  }

  // ── Layers per step ─────────────────────────────────────────────────────

  private bassStep(sec: Section, chord: Chord, s: number, t: number, tr: number): void {
    if (!sec.layers.bass) return;
    const root = chord.root + 12 + tr;
    const beat = 60 / this.def.bpm;
    switch (sec.bass ?? 'sub') {
      case 'sub':
        if (s === 0) this.subBass(root, t, beat * 3.6);
        break;
      case 'pulse8':
        if (s % 2 === 0) this.pulseBass(s === 6 || s === 14 ? root + 12 : root, t, beat * 0.45, s % 4 === 0 ? 1 : 0.7);
        break;
      case 'drive16':
        this.pulseBass(s % 4 === 2 ? root + 12 : root, t, beat * 0.22, s % 4 === 0 ? 1 : 0.6);
        break;
      case 'offbeat':
        if (s % 4 === 2) this.pulseBass(root, t, beat * 0.4, 0.9);
        break;
    }
  }

  private arpStep(sec: Section, chord: Chord, s: number, t: number, tr: number): void {
    if (!sec.layers.arp) return;
    const n = chord.notes;
    const pat = this.arpPattern;
    const every = pat === 'up16' || pat === 'broken16' ? 1 : pat === 'sparse' ? 4 : 2;
    if (s % every !== 0) return;
    if (pat === 'sparse' && Math.random() < 0.4) return;
    if (this.lite && every === 1 && s % 2 === 1) return;
    const i = this.arpIdx++;
    let note: number;
    if (pat === 'updown8') {
      const cyc = n.length * 2 - 2;
      const k = i % cyc;
      note = n[k < n.length ? k : cyc - k];
    } else if (pat === 'broken16') {
      const order = [0, 2, 1, 3, 2, 4, 3, 1];
      note = n[order[i % order.length] % n.length] + (Math.floor(i / 8) % 2) * 12;
    } else {
      note = n[i % n.length] + (Math.floor(i / n.length) % 2) * 12;
    }
    const beat = 60 / this.def.bpm;
    this.pluck(note + 12 + tr, t, every === 1 ? beat * 0.3 : beat * 0.7, s % 4 === 0 ? 1 : 0.75);
  }

  private leadStep(sec: Section, s: number, t: number, tr: number): void {
    if (!sec.lead || !sec.layers.lead) return;
    const phraseIdx = Math.floor(this.barInSection / 4) % sec.lead.length;
    const phrase = sec.lead[phraseIdx];
    const pos = (this.barInSection % 4) * 16 + s;
    const beat16 = 60 / this.def.bpm / 4;
    for (const [at, m, len] of phrase) if (at === pos) this.leadNote(m + tr, t, len * beat16);
  }

  private drumStep(sec: Section, s: number, t: number): void {
    const lastBar = this.barInSection === sec.bars - 1;
    if (sec.riser && lastBar && s === 0) this.riser(t, (60 / this.def.bpm) * 4);
    if (sec.layers.perc) {
      // Shaker on 8ths (16ths when driving), rim accents.
      const drive = sec.drums === 'drive' || sec.drums === 'groove';
      if (drive ? true : s % 2 === 0) this.shaker(t, s % 4 === 2 ? 1 : 0.55);
    }
    if (!sec.layers.drums) return;
    switch (sec.drums) {
      case 'light':
        if (s === 0 || s === 10) this.kick(t, s === 0 ? 0.9 : 0.6);
        if (s === 8) this.kick(t, 0.75);
        if (s === 12 && this.barInSection % 2 === 1) this.rim(t);
        if (s % 4 === 2) this.hat(t, 0.5);
        break;
      case 'groove':
        if (s === 0 || s === 8 || s === 11) this.kick(t, s === 11 ? 0.6 : 0.95);
        if (s === 4 || s === 12) this.snare(t, 0.7);
        if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.8 : 0.45);
        break;
      case 'drive':
        if (s % 4 === 0) this.kick(t, 1);
        if (s === 4 || s === 12) this.snare(t, 0.9);
        if (lastBar && s >= 12) this.tom(t, 1 - (s - 12) * 0.12);
        else this.hat(t, s % 4 === 2 ? 0.9 : s % 2 === 0 ? 0.55 : 0.35, s === 14);
        break;
    }
  }

  private bellStep(sec: Section, chord: Chord, s: number, t: number, tr: number): void {
    if (!sec.layers.bell || s % 8 !== 4) return;
    if (Math.random() > 0.35) return;
    const m = chord.notes[Math.floor(Math.random() * chord.notes.length)] + 24 + tr;
    this.bell(m, t);
  }

  // ── Transition into the final minute ───────────────────────────────────

  private transitionStart(t: number): void {
    const bar = (60 / this.def.bpm) * 4;
    this.riser(t, bar);
    this.layers.drums.gain.setTargetAtTime(LAYER_LEVEL.drums, t, 0.1);
    this.kick(t, 1);
    this.padChord(this.chordNow(), t, 0);
  }

  private transitionStep(s: number, t: number): void {
    // Snare roll crescendo across the last two beats.
    if (s >= 8) this.snare(t, 0.3 + (s - 8) * 0.08);
    else if (s % 4 === 0) this.kick(t, 0.8);
  }

  // ── Instruments ─────────────────────────────────────────────────────────

  private osc(type: OscillatorType, f: number, t: number, end: number, dest: AudioNode, detune = 0): OscillatorNode {
    const o = this.core.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    this.wobble.connect(o.detune);
    o.connect(dest);
    o.start(t);
    o.stop(end);
    o.onended = () => {
      try {
        this.wobble.disconnect(o.detune);
      } catch {
        /* ignore */
      }
      o.disconnect();
    };
    return o;
  }

  private padChord(ch: Chord, t: number, tr: number): void {
    const ctx = this.core.ctx;
    const d = this.def;
    const bar = (60 / d.bpm) * 4;
    const attack = Math.min(d.padAttack, bar * 0.6);
    const hold = bar;
    const end = t + hold + d.padRelease;
    const per = 0.24 / Math.sqrt(ch.notes.length);
    const detunes = this.lite ? [0] : [-7, 6];
    for (const n of ch.notes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(per, t + attack);
      g.gain.setValueAtTime(per, t + hold);
      g.gain.setTargetAtTime(0, t + hold, d.padRelease / 4);
      g.connect(this.padFilter);
      let last: OscillatorNode | null = null;
      for (const dt of detunes) last = this.osc('sawtooth', mtof(n + tr), t, end, g, dt + rand(-2, 2));
      if (last) last.addEventListener('ended', () => g.disconnect());
    }
  }

  private subBass(m: number, t: number, dur: number): void {
    const ctx = this.core.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.05);
    g.gain.setTargetAtTime(0.28, t + 0.1, 0.4);
    g.gain.setTargetAtTime(0, t + dur, 0.25);
    g.connect(this.layers.bass);
    const end = t + dur + 1.3;
    this.osc('sine', mtof(m - 12), t, end, g);
    const tri = ctx.createGain();
    tri.gain.value = 0.22;
    tri.connect(g);
    const o = this.osc('triangle', mtof(m), t, end, tri);
    o.addEventListener('ended', () => {
      tri.disconnect();
      g.disconnect();
    });
  }

  private pulseBass(m: number, t: number, dur: number, acc: number): void {
    const ctx = this.core.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(300 + 900 * acc, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * acc, t + 0.006);
    g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.25);
    lp.connect(g).connect(this.layers.bass);
    const end = t + dur * 1.8 + 0.05;
    this.osc('sawtooth', mtof(m), t, end, lp, -4);
    const o = this.osc('sine', mtof(m - 12), t, end, g);
    o.addEventListener('ended', () => {
      lp.disconnect();
      g.disconnect();
    });
  }

  private pluck(m: number, t: number, dur: number, acc: number): void {
    const ctx = this.core.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(3600 * (0.7 + 0.3 * acc), t);
    lp.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * acc, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(this.layers.arp);
    const end = t + dur + 0.03;
    this.osc('triangle', mtof(m), t, end, lp);
    const sg = ctx.createGain();
    sg.gain.value = 0.25;
    sg.connect(lp);
    const o = this.osc('sawtooth', mtof(m), t, end, sg, 5);
    o.addEventListener('ended', () => {
      sg.disconnect();
      lp.disconnect();
      g.disconnect();
    });
  }

  private leadNote(m: number, t: number, dur: number): void {
    const ctx = this.core.ctx;
    const f = mtof(m);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1;
    const tone = this.def.leadTone;
    lp.frequency.setValueAtTime(tone * 1.6, t);
    lp.frequency.setTargetAtTime(tone, t + 0.02, 0.15);
    const g = ctx.createGain();
    const rel = 0.25;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.03);
    g.gain.setTargetAtTime(0.3, t + 0.05, 0.2);
    g.gain.setTargetAtTime(0, t + dur * 0.95, rel / 3);
    lp.connect(g).connect(this.layers.lead);
    const end = t + dur + rel + 0.1;
    // Gentle glide up from the previous note's neighbourhood.
    const glideFrom = this.lastLead > 0 && Math.abs(this.lastLead - f) / f < 0.5 ? this.lastLead : f;
    this.lastLead = f;
    const a = this.osc('triangle', glideFrom, t, end, lp);
    a.frequency.setValueAtTime(glideFrom, t);
    a.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const sg = ctx.createGain();
    sg.gain.value = 0.22;
    sg.connect(lp);
    const b = this.osc('sawtooth', glideFrom, t, end, sg, 7);
    b.frequency.setValueAtTime(glideFrom, t);
    b.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    // Delayed vibrato.
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(0, t + 0.25);
    vg.gain.linearRampToValueAtTime(11, t + 0.6);
    vib.connect(vg);
    vg.connect(a.detune);
    vg.connect(b.detune);
    vib.start(t);
    vib.stop(end);
    b.addEventListener('ended', () => {
      vg.disconnect();
      sg.disconnect();
      lp.disconnect();
      g.disconnect();
    });
  }

  private bell(m: number, t: number): void {
    const ctx = this.core.ctx;
    for (const [mult, lvl, dec] of [
      [1, 0.3, 2.4],
      [2.005, 0.12, 1.2],
      [3.01, 0.05, 0.6],
    ] as const) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lvl, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      g.connect(this.layers.bell);
      const o = this.osc('sine', mtof(m) * mult, t, t + dec + 0.05, g);
      o.addEventListener('ended', () => g.disconnect());
    }
  }

  private noiseHit(dest: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, gain: number, decay: number, kind: 'white' | 'pink' = 'white', fEnd?: number, attack = 0.001): void {
    const ctx = this.core.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.core.noise[kind];
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (fEnd) flt.frequency.exponentialRampToValueAtTime(fEnd, t + attack + decay);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(flt).connect(g).connect(dest);
    const len = s.buffer.duration;
    if (attack + decay > len - 0.1) s.loop = true;
    s.start(t, Math.random() * Math.max(0, len - attack - decay - 0.1));
    s.stop(t + attack + decay + 0.02);
    s.onended = () => {
      flt.disconnect();
      g.disconnect();
    };
  }

  private kick(t: number, acc: number): void {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.85 * acc, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.34);
    o.onended = () => g.disconnect();
    this.noiseHit(this.layers.drums, t, 'lowpass', 1800, 0.7, 0.08 * acc, 0.015);
  }

  private snare(t: number, acc: number): void {
    this.noiseHit(this.layers.drums, t, 'bandpass', 1900, 0.7, 0.32 * acc, 0.17);
    this.noiseHit(this.layers.drums, t, 'highpass', 5000, 0.7, 0.1 * acc, 0.09);
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * acc, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g).connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.13);
    o.onended = () => g.disconnect();
  }

  private hat(t: number, lvl: number, open = false): void {
    this.noiseHit(this.layers.drums, t, 'highpass', 7500, 0.7, 0.13 * lvl, open ? 0.22 : 0.04);
  }

  private rim(t: number): void {
    this.noiseHit(this.layers.drums, t, 'bandpass', 2600, 4, 0.22, 0.03);
  }

  private shaker(t: number, lvl: number): void {
    this.noiseHit(this.layers.perc, t, 'bandpass', 6200, 1.2, 0.16 * lvl, 0.05, 'white', undefined, 0.012);
  }

  private tom(t: number, acc: number): void {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    const f = 180 * acc;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.27);
    o.onended = () => g.disconnect();
  }

  private crash(t: number, lvl: number): void {
    this.noiseHit(this.layers.drums, t, 'highpass', 4500, 0.5, 0.12 * lvl, 1.6, 'white', 3000, 0.002);
  }

  private riser(t: number, dur: number): void {
    this.noiseHit(this.layers.drums, t, 'bandpass', 400, 1.5, 0.12, 0.08, 'white', 5000, dur);
  }

  /** Victory fanfare / defeat lament on the motif head. Returns its length (s). */
  private stinger(win: boolean, t: number): number {
    const ctx = this.core.ctx;
    const dest = this.out;
    const stab = (notes: number[], at: number, dur: number, lvl: number) => {
      for (const n of notes) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(win ? 3200 : 1200, at);
        lp.frequency.exponentialRampToValueAtTime(win ? 900 : 500, at + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(lvl, at + (win ? 0.02 : 0.25));
        g.gain.setTargetAtTime(0, at + dur * 0.5, dur * 0.3);
        lp.connect(g).connect(dest);
        const send = ctx.createGain();
        send.gain.value = 0.5;
        g.connect(send).connect(this.hallSend);
        const end = at + dur * 1.6 + 0.1;
        this.osc('sawtooth', mtof(n), at, end, lp, -5);
        const o = this.osc('sawtooth', mtof(n), at, end, lp, 6);
        o.addEventListener('ended', () => {
          lp.disconnect();
          g.disconnect();
          send.disconnect();
        });
      }
    };
    const leadAt = (m: number, at: number, dur: number) => this.leadNote(m, at, dur);
    if (win) {
      // D – G – A – Dmaj9 with the motif head (A F♯ E D) on top, timpani and crash.
      this.kick(t, 1);
      this.crash(t, 1);
      stab([50, 57, 62, 66], t, 0.45, 0.05);
      stab([55, 59, 62, 67], t + 0.5, 0.4, 0.045);
      stab([57, 61, 64, 69], t + 0.9, 0.4, 0.045);
      stab([50, 57, 62, 66, 69, 76], t + 1.35, 2.2, 0.045);
      this.kick(t + 1.35, 0.9);
      leadAt(81, t, 0.45);
      leadAt(90, t + 0.5, 0.4);
      leadAt(88, t + 0.9, 0.4);
      leadAt(86, t + 1.35, 1.8);
      [74, 78, 81, 85, 86, 90, 93].forEach((m, i) => this.bell(m, t + 1.35 + i * 0.08));
      this.layers.lead.gain.setTargetAtTime(LAYER_LEVEL.lead * 1.1, t, 0.02);
      this.layers.bell.gain.setTargetAtTime(LAYER_LEVEL.bell * 1.5, t, 0.02);
      this.layers.drums.gain.setTargetAtTime(LAYER_LEVEL.drums * 0.8, t, 0.02);
      return 3.4;
    }
    // Defeat: slow, soft, the motif head in minor, falling away.
    stab([50, 57, 62, 65], t, 3, 0.04);
    stab([46, 53, 58, 62], t + 1.8, 2.5, 0.035);
    leadAt(69, t + 0.2, 0.7);
    leadAt(77, t + 0.95, 0.6);
    leadAt(76, t + 1.6, 0.6);
    leadAt(74, t + 2.25, 1.8);
    this.subBass(38, t, 3.5);
    this.layers.lead.gain.setTargetAtTime(LAYER_LEVEL.lead * 0.9, t, 0.02);
    this.layers.bass.gain.setTargetAtTime(LAYER_LEVEL.bass * 0.5, t, 0.02);
    return 4.2;
  }

  dispose(): void {
    this.stop();
    for (const l of this.lfos) {
      try {
        l.stop();
      } catch {
        /* ignore */
      }
    }
    this.out.disconnect();
  }
}

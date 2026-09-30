// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — generative warm analog-synth music.
//
// Layers: detuned-saw pads through a low-pass with a slow filter LFO and a
// shared "tape wobble" pitch LFO; a sub bass; soft plucked arpeggios; and a
// drum kit (kick / snare / hats) that only appears in match intensity.
// States (menu → lobby → match → final) crossfade layer levels and tempo;
// victory/defeat play a stinger then settle into a calm pad.
// Scheduling uses a 25 ms lookahead timer against AudioContext time, so it is
// sample-accurate and costs almost nothing on the main thread.
// ─────────────────────────────────────────────────────────────────────────────

import type { MusicState } from '../contracts';
import type { AudioCore } from './spatial';

interface Chord {
  root: number;
  notes: number[];
}

// D-centred progressions (MIDI). Two bars per chord.
const PROG_MENU: Chord[] = [
  { root: 38, notes: [62, 66, 69, 73, 76] }, // Dmaj9
  { root: 35, notes: [59, 62, 66, 69, 73] }, // Bm9
  { root: 31, notes: [55, 59, 62, 66, 73] }, // Gmaj7#11
  { root: 33, notes: [57, 62, 64, 66, 69] }, // A6sus
];
const PROG_MATCH: Chord[] = [
  { root: 38, notes: [62, 65, 69, 72, 76] }, // Dm9
  { root: 34, notes: [58, 62, 65, 69] }, // Bbmaj7
  { root: 31, notes: [55, 58, 62, 65, 69] }, // Gm9
  { root: 33, notes: [57, 62, 64, 67] }, // A7sus4
];
const PROG_FINAL: Chord[] = [
  { root: 38, notes: [62, 65, 69, 74] }, // Dm
  { root: 34, notes: [58, 62, 65, 70] }, // Bb
  { root: 36, notes: [60, 64, 67, 72] }, // C
  { root: 33, notes: [57, 61, 64, 69] }, // A (tension)
];

interface StateSpec {
  bpm: number;
  prog: Chord[];
  pad: number;
  bass: number;
  arp: number;
  /** Arp step in 16th notes. */
  arpEvery: number;
  drums: number;
  hats: number;
  cutoff: number;
}

const STATES: Record<Exclude<MusicState, 'off'>, StateSpec> = {
  menu: { bpm: 68, prog: PROG_MENU, pad: 0.5, bass: 0.22, arp: 0.1, arpEvery: 4, drums: 0, hats: 0, cutoff: 1000 },
  lobby: { bpm: 84, prog: PROG_MENU, pad: 0.44, bass: 0.32, arp: 0.18, arpEvery: 2, drums: 0, hats: 0.06, cutoff: 1300 },
  match: { bpm: 96, prog: PROG_MATCH, pad: 0.34, bass: 0.4, arp: 0.2, arpEvery: 2, drums: 0.32, hats: 0.12, cutoff: 1500 },
  final: { bpm: 118, prog: PROG_FINAL, pad: 0.32, bass: 0.5, arp: 0.26, arpEvery: 1, drums: 0.6, hats: 0.28, cutoff: 2200 },
  victory: { bpm: 64, prog: PROG_MENU, pad: 0.38, bass: 0.12, arp: 0.05, arpEvery: 4, drums: 0, hats: 0, cutoff: 1400 },
  defeat: { bpm: 60, prog: PROG_MATCH, pad: 0.32, bass: 0.1, arp: 0, arpEvery: 4, drums: 0, hats: 0, cutoff: 700 },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private readonly core: AudioCore;
  private readonly out: GainNode;
  private readonly pad: GainNode;
  private readonly padFilter: BiquadFilterNode;
  private readonly bass: GainNode;
  private readonly arp: GainNode;
  private readonly drums: GainNode;
  private readonly hats: GainNode;
  private readonly wobble: GainNode;
  private readonly lfos: OscillatorNode[] = [];
  private state: MusicState = 'off';
  private spec: StateSpec = STATES.menu;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private chordIdx = 0;
  private arpIdx = 0;
  private lite = false;
  private stopAt = 0;

  constructor(core: AudioCore) {
    this.core = core;
    const ctx = core.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(core.buses.music);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1000;
    this.padFilter.Q.value = 0.6;
    this.pad = ctx.createGain();
    this.pad.gain.value = 0;
    this.padFilter.connect(this.pad);
    this.pad.connect(this.out);
    // Send the pad lightly into the reverb for space.
    const padRev = ctx.createGain();
    padRev.gain.value = 0.25;
    this.pad.connect(padRev);
    padRev.connect(core.reverbSend);
    this.bass = this.layer();
    this.arp = this.layer();
    this.drums = this.layer();
    this.hats = this.layer();
    const arpRev = ctx.createGain();
    arpRev.gain.value = 0.35;
    this.arp.connect(arpRev);
    arpRev.connect(core.reverbSend);

    // Slow filter sweep + tape wobble (pitch, in cents).
    const f = ctx.createOscillator();
    f.frequency.value = 0.045;
    const fg = ctx.createGain();
    fg.gain.value = 320;
    f.connect(fg).connect(this.padFilter.frequency);
    f.start();
    const w = ctx.createOscillator();
    w.frequency.value = 0.37;
    this.wobble = ctx.createGain();
    this.wobble.gain.value = 7;
    w.connect(this.wobble);
    w.start();
    this.lfos.push(f, w);
  }

  private layer(): GainNode {
    const g = this.core.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.out);
    return g;
  }

  /** Fewer oscillators on weak devices. */
  setLite(lite: boolean): void {
    this.lite = lite;
  }

  get current(): MusicState {
    return this.state;
  }

  setState(s: MusicState): void {
    if (s === this.state) return;
    const ctx = this.core.ctx;
    const t = ctx.currentTime;
    const prev = this.state;
    this.state = s;
    if (s === 'off') {
      this.out.gain.setTargetAtTime(0, t, 0.8);
      this.stopAt = t + 4;
      return;
    }
    this.stopAt = 0;
    this.spec = STATES[s];
    this.out.gain.setTargetAtTime(1, t, prev === 'off' ? 1.5 : 0.6);
    const tc = s === 'final' ? 0.6 : 1.4;
    this.pad.gain.setTargetAtTime(this.spec.pad, t, tc);
    this.bass.gain.setTargetAtTime(this.spec.bass, t, tc);
    this.arp.gain.setTargetAtTime(this.spec.arp, t, tc);
    this.drums.gain.setTargetAtTime(this.spec.drums, t, tc * 0.7);
    this.hats.gain.setTargetAtTime(this.spec.hats, t, tc * 0.7);
    this.padFilter.frequency.setTargetAtTime(this.spec.cutoff, t, 2);
    if (s === 'victory') this.stinger(true);
    if (s === 'defeat') this.stinger(false);
    if (!this.timer) this.start();
  }

  private start(): void {
    const ctx = this.core.ctx;
    this.nextTime = ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  private stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private tick(): void {
    const ctx = this.core.ctx;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.stopAt && now > this.stopAt) {
      this.stop();
      return;
    }
    // After a suspend (tab hidden) don't try to catch up on missed notes.
    if (this.nextTime < now - 0.3) this.nextTime = now + 0.05;
    const ahead = now + 0.2;
    while (this.nextTime < ahead) {
      this.schedule(this.step, this.nextTime);
      this.nextTime += 60 / this.spec.bpm / 4;
      this.step++;
    }
  }

  private schedule(step: number, t: number): void {
    const s = this.spec;
    const in16 = step % 16;
    const bar = Math.floor(step / 16);
    if (in16 === 0 && bar % 2 === 0) {
      this.chordIdx = (bar / 2) % s.prog.length;
      this.padChord(s.prog[this.chordIdx], t, (60 / s.bpm) * 8);
    }
    const chord = s.prog[this.chordIdx] ?? s.prog[0];
    // Bass.
    const bassHits = this.state === 'final' ? [0, 4, 8, 12] : this.state === 'match' ? [0, 6, 8, 14] : this.state === 'lobby' ? [0, 8] : [0];
    if (bassHits.includes(in16) && (this.state !== 'menu' || bar % 2 === 0)) this.bassNote(chord.root + 12, t, this.state === 'menu' ? 2.4 : 0.45);
    // Arp.
    if (s.arp > 0 && in16 % s.arpEvery === 0 && (this.state !== 'menu' || Math.random() < 0.55)) {
      const notes = chord.notes;
      const n = notes[this.arpIdx % notes.length] + (this.arpIdx % (notes.length * 2) >= notes.length ? 12 : 0);
      this.arpIdx++;
      this.pluck(n + 12, t, this.state === 'final' ? 0.14 : 0.3);
    }
    // Drums.
    if (s.drums > 0) {
      const kicks = this.state === 'final' ? [0, 4, 8, 12] : [0, 8, 10];
      if (kicks.includes(in16)) this.kick(t);
      if (this.state === 'final' && (in16 === 4 || in16 === 12)) this.snare(t);
      if (this.state === 'match' && in16 === 12 && bar % 2 === 1) this.snare(t);
    }
    if (s.hats > 0) {
      const every = this.state === 'final' ? 2 : 4;
      if (in16 % every === every / 2) this.hat(t, in16 % 4 === 2 ? 1 : 0.6);
    }
    // Occasional high shimmer in calm states.
    if ((this.state === 'menu' || this.state === 'victory') && in16 === 8 && Math.random() < 0.18) this.shimmer(chord.notes[Math.floor(Math.random() * chord.notes.length)] + 24, t);
  }

  private padChord(ch: Chord, t: number, dur: number): void {
    const ctx = this.core.ctx;
    const attack = 1.4;
    const release = 2.6;
    const perNote = 0.26 / Math.sqrt(ch.notes.length);
    const detunes = this.lite ? [0] : [-8, 7];
    for (const n of ch.notes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(perNote, t + attack);
      g.gain.setValueAtTime(perNote, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
      g.connect(this.padFilter);
      for (const d of detunes) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = d;
        this.wobble.connect(o.detune);
        o.connect(g);
        o.start(t);
        o.stop(t + dur + release + 0.05);
        o.onended = () => {
          try {
            this.wobble.disconnect(o.detune);
          } catch {
            /* ignore */
          }
          o.disconnect();
        };
      }
      setTimeout(() => g.disconnect(), (t - ctx.currentTime + dur + release + 0.3) * 1000);
    }
  }

  private bassNote(m: number, t: number, dur: number): void {
    const ctx = this.core.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.bass);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.connect(g);
    for (const [type, mult, lvl] of [
      ['sine', 1, 1],
      ['triangle', 2, 0.25],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(m) * mult;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
      o.onended = () => {
        og.disconnect();
        lp.disconnect();
        g.disconnect();
      };
    }
  }

  private pluck(m: number, t: number, dur: number): void {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(m);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.arp);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      lp.disconnect();
      g.disconnect();
    };
  }

  private kick(t: number): void {
    const ctx = this.core.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.3);
    o.onended = () => g.disconnect();
  }

  private snare(t: number): void {
    const ctx = this.core.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.core.noise.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(bp).connect(g).connect(this.drums);
    s.start(t, Math.random());
    s.stop(t + 0.2);
    s.onended = () => {
      bp.disconnect();
      g.disconnect();
    };
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.25, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(this.drums);
    o.start(t);
    o.stop(t + 0.12);
    o.onended = () => og.disconnect();
  }

  private hat(t: number, lvl: number): void {
    const ctx = this.core.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.core.noise.white;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 * lvl, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    s.connect(hp).connect(g).connect(this.hats);
    s.start(t, Math.random());
    s.stop(t + 0.06);
    s.onended = () => {
      hp.disconnect();
      g.disconnect();
    };
  }

  private shimmer(m: number, t: number): void {
    const ctx = this.core.ctx;
    for (const [mult, lvl] of [
      [1, 0.05],
      [2.01, 0.02],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = mtof(m) * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(lvl, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.connect(g).connect(this.arp);
      o.start(t);
      o.stop(t + 2.5);
      o.onended = () => g.disconnect();
    }
  }

  /** Victory: rising major arpeggio + swell. Defeat: slow falling minor line. */
  private stinger(win: boolean): void {
    const ctx = this.core.ctx;
    const t = ctx.currentTime + 0.05;
    const notes = win ? [62, 66, 69, 73, 74, 78, 81] : [69, 65, 62, 60, 57];
    notes.forEach((n, i) => {
      const at = t + i * (win ? 0.11 : 0.28);
      const o = ctx.createOscillator();
      o.type = win ? 'triangle' : 'sine';
      o.frequency.value = mtof(n + 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(win ? 0.18 : 0.14, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (win ? 1.4 : 1.8));
      o.connect(g).connect(this.out);
      o.start(at);
      o.stop(at + 2);
      o.onended = () => g.disconnect();
    });
    // Swell chord under the stinger.
    const chord = win ? [50, 54, 57, 61, 64] : [50, 53, 57, 60];
    for (const n of chord) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n + 12);
      this.wobble.connect(o.detune);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
      o.connect(g).connect(this.padFilter);
      o.start(t);
      o.stop(t + 4.6);
      o.onended = () => {
        try {
          this.wobble.disconnect(o.detune);
        } catch {
          /* ignore */
        }
        g.disconnect();
      };
    }
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

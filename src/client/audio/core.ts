// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — the audio graph (buses, sends, mastering) and shared buffers.
//
//   world one-shots ─► world ─► worldFilter (hurt / low-health muffle) ─┐
//   ambience beds + emitters ─► ambience ─► ambFilter (indoor) ─► world  │
//   feedback (hitmarkers, heartbeat, hurt) ─────────────────────────────┤
//                                                   sfx (volume) ◄──────┘
//   sfx ─► sfxDuck ─────────────────────────────────┐
//   music ─► musicDuck (pause/voice) ─► sidechain (heartbeat) ─► focus ─┼─► master
//   (focus: dips the score while enemies are audible nearby — footsteps and
//    reloads must never be masked by the music)
//   voice (announcer chime) ───────────────────────────────────┤
//   ui ────────────────────────────────────────────────────────┘
//   master ─► glue compressor ─► brickwall limiter ─► safety soft-clip ─► out
//
//   reverbSend ─► outdoor convolver (per-map IR) ┐
//              └► indoor convolver (tunnels)    ┴► reverb return (HP 140 Hz) ─► world
//   echoSend ─► band-limited ping-pong delay (map echo; mountains = canyon) ─► world
//   Lite mode: no convolution — the reverb send feeds the echo network instead.
//
// Everything is built on a BaseAudioContext so the exact same graph renders in
// an OfflineAudioContext for measurement.
// ─────────────────────────────────────────────────────────────────────────────

export interface AudioBuses {
  master: GainNode;
  music: GainNode;
  /** SFX volume (everything in the game world + feedback). */
  sfx: GainNode;
  voice: GainNode;
  ui: GainNode;
  /** Ambience bed + emitters (under the SFX volume, muffled indoors). */
  ambience: GainNode;
  /** World one-shots (weapons, footsteps, impacts): muffled when hurt. */
  world: GainNode;
  /** Player feedback (hitmarkers, damage, heartbeat): never muffled. */
  feedback: GainNode;
}

export interface AudioCore {
  readonly ctx: BaseAudioContext;
  readonly buses: AudioBuses;
  /** Send into the map reverb (outdoor + indoor convolvers). */
  readonly reverbSend: GainNode;
  /** Outdoor (map) convolver; its buffer is null in lite mode. */
  readonly convolver: ConvolverNode;
  /** Indoor (tunnel / interior) convolver; null buffer in lite mode. */
  readonly convolverIndoor: ConvolverNode;
  readonly reverbOutdoor: GainNode;
  readonly reverbIndoor: GainNode;
  /** Lite-mode substitute for the convolvers (feeds the echo network). */
  readonly reverbLite: GainNode;
  /** Send into the tuned ping-pong echo (open-map gunfire). */
  readonly echoSend: GainNode;
  readonly echoDelay: DelayNode;
  readonly echoDelayR: DelayNode;
  readonly echoFeedback: GainNode;
  readonly echoFeedbackR: GainNode;
  readonly echoTone: BiquadFilterNode;
  readonly echoReturn: GainNode;
  /** Low-pass on the world bus (damage muffle, low-health tunnel hearing). */
  readonly worldFilter: BiquadFilterNode;
  /** Low-pass on the ambience bed (indoors). */
  readonly ambFilter: BiquadFilterNode;
  readonly musicDuck: GainNode;
  readonly sfxDuck: GainNode;
  /** Heartbeat sidechain on the music. */
  readonly musicSidechain: GainNode;
  /** Gameplay focus duck on the music (enemy footsteps / reloads / shots nearby). */
  readonly musicFocus: GainNode;
  readonly noise: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer };
  hrtf: boolean;
  lite: boolean;
  /** Live one-shot voices (kept in sync by the Spatializer). */
  voices: number;
  maxVoices: number;
}

/** Makes a noise buffer: 'white', 'pink' (Paul Kellet filter) or 'brown'. */
export function makeNoise(ctx: BaseAudioContext, kind: 'white' | 'pink' | 'brown', seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    let v: number;
    if (kind === 'white') v = w;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      v = last;
    }
    d[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  // Normalize so every colour peaks at ~0.9 (recipes then read in true gains).
  const k = peak > 0 ? 0.9 / peak : 1;
  // Short crossfade at the loop point so looping beds never click.
  const fade = Math.min(len >> 2, Math.floor(ctx.sampleRate * 0.02));
  for (let i = 0; i < len; i++) d[i] *= k;
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[len - fade + i] = d[len - fade + i] * (1 - a) + d[i] * a;
  }
  return buf;
}

/** Soft-clip curve: linear to ±0.9, then a smooth knee into ±1 (safety only). */
function safetyCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= 0.9 ? a : 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export interface CoreOptions {
  lite?: boolean;
  /** Output node (defaults to ctx.destination). */
  out?: AudioNode;
}

/** Builds the whole mixing graph on any (online or offline) context. */
export function createCore(ctx: BaseAudioContext, opts: CoreOptions = {}): AudioCore {
  const g = (v = 1) => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const master = g();
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.knee.value = 10;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.008;
  glue.release.value = 0.25;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.0015;
  limiter.release.value = 0.12;
  const clip = ctx.createWaveShaper();
  clip.curve = safetyCurve();
  master.connect(glue).connect(limiter).connect(clip).connect(opts.out ?? ctx.destination);

  const music = g();
  const sfx = g();
  const voice = g();
  const ui = g();
  const world = g();
  const feedback = g();
  const ambience = g(0.9);
  const musicDuck = g();
  const musicSidechain = g();
  const musicFocus = g();
  const sfxDuck = g();
  music.connect(musicDuck).connect(musicSidechain).connect(musicFocus).connect(master);
  sfx.connect(sfxDuck).connect(master);
  const worldFilter = ctx.createBiquadFilter();
  worldFilter.type = 'lowpass';
  worldFilter.frequency.value = 20000;
  worldFilter.Q.value = 0.5;
  world.connect(worldFilter).connect(sfx);
  feedback.connect(sfx);
  const ambFilter = ctx.createBiquadFilter();
  ambFilter.type = 'lowpass';
  ambFilter.frequency.value = 18000;
  ambFilter.Q.value = 0.4;
  ambience.connect(ambFilter).connect(world);
  voice.connect(master);
  ui.connect(master);

  // Reverb: outdoor + indoor convolvers → shared return (no mud under 140 Hz).
  const reverbSend = g();
  const reverbReturn = g(0.62);
  const revHp = ctx.createBiquadFilter();
  revHp.type = 'highpass';
  revHp.frequency.value = 140;
  revHp.Q.value = 0.5;
  reverbReturn.connect(revHp).connect(world);
  const convolver = ctx.createConvolver();
  const convolverIndoor = ctx.createConvolver();
  const reverbOutdoor = g(1);
  const reverbIndoor = g(0);
  reverbSend.connect(convolver).connect(reverbOutdoor).connect(reverbReturn);
  reverbSend.connect(convolverIndoor).connect(reverbIndoor).connect(reverbReturn);
  const reverbLite = g(0);

  // Echo: band-limited stereo ping-pong (L → R → L …).
  const echoSend = g();
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 2200;
  echoTone.Q.value = 0.3;
  const echoHp = ctx.createBiquadFilter();
  echoHp.type = 'highpass';
  echoHp.frequency.value = 180;
  const echoDelay = ctx.createDelay(2);
  const echoDelayR = ctx.createDelay(2);
  echoDelay.delayTime.value = 0.3;
  echoDelayR.delayTime.value = 0.3;
  const echoFeedback = g(0);
  const echoFeedbackR = g(0);
  const echoReturn = g(0.55);
  const panL = ctx.createStereoPanner();
  panL.pan.value = -0.55;
  const panR = ctx.createStereoPanner();
  panR.pan.value = 0.55;
  // Two poles of low-pass: far walls return a dull, rounded repeat.
  const echoTone2 = ctx.createBiquadFilter();
  echoTone2.type = 'lowpass';
  echoTone2.frequency.value = 3200;
  echoTone2.Q.value = 0.5;
  echoSend.connect(echoHp).connect(echoTone).connect(echoTone2).connect(echoDelay);
  echoDelay.connect(panL).connect(echoReturn);
  // Each repeat gets a little darker (low-pass inside the feedback loop).
  const fbLp = (): BiquadFilterNode => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    f.Q.value = 0.4;
    return f;
  };
  echoDelay.connect(echoFeedback).connect(fbLp()).connect(echoDelayR);
  echoDelayR.connect(panR).connect(echoReturn);
  echoDelayR.connect(echoFeedbackR).connect(fbLp()).connect(echoDelay);
  echoReturn.connect(world);
  reverbSend.connect(reverbLite).connect(echoSend);

  const core: AudioCore = {
    ctx,
    buses: { master, music, sfx, voice, ui, ambience, world, feedback },
    reverbSend,
    convolver,
    convolverIndoor,
    reverbOutdoor,
    reverbIndoor,
    reverbLite,
    echoSend,
    echoDelay,
    echoDelayR,
    echoFeedback,
    echoFeedbackR,
    echoTone,
    echoReturn,
    worldFilter,
    ambFilter,
    musicDuck,
    sfxDuck,
    musicSidechain,
    musicFocus,
    noise: { white: makeNoise(ctx, 'white', 2), pink: makeNoise(ctx, 'pink', 3), brown: makeNoise(ctx, 'brown', 3) },
    hrtf: false,
    lite: !!opts.lite,
    voices: 0,
    maxVoices: opts.lite ? 22 : 40,
  };
  return core;
}

/** Tunes the ping-pong echo (seconds, 0..~0.6 feedback). */
export function setEcho(core: AudioCore, delay: number, feedback: number, tone = 2200): void {
  const t = core.ctx.currentTime;
  core.echoDelay.delayTime.setTargetAtTime(delay, t, 0.05);
  core.echoDelayR.delayTime.setTargetAtTime(delay, t, 0.05);
  core.echoFeedback.gain.setTargetAtTime(feedback, t, 0.05);
  core.echoFeedbackR.gain.setTargetAtTime(feedback, t, 0.05);
  core.echoTone.frequency.setTargetAtTime(tone, t, 0.05);
}

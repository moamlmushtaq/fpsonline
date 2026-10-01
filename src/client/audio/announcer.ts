// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — calm voice announcer.
//
// speechSynthesis with the best available voice for the language (natural /
// neural / enhanced voices first, novelty voices never), a soft chime on the
// voice bus before each line, music (and a little sfx) ducking while speaking,
// and a subtitle for every line that plays — even with no speech engine, no
// voice for the language or the voice volume at zero.
//
// Queue rules:
//   priority  victory/defeat/draw > final minute > training/launch/match start
//             > zones > lead changes > streaks / first elimination
//   interrupt a line of priority ≥ 70 cuts off a routine (≤ 50) line mid-sentence
//   ending    victory/defeat/draw flush everything else and cut off any line
//   staleness low-priority lines expire after ~2.5 s in the queue
//   cooldowns per key (e.g. "Zone contested" at most every 10 s) and a small
//             global gap, so callouts never chatter.
// ─────────────────────────────────────────────────────────────────────────────

import type { Announcer, AudioSystem } from '../contracts';
import type { AnnouncerKey, Lang } from '../../shared/types';
import { i18n } from '../ui/i18n';

export type ChimeTone = 'normal' | 'bright' | 'low';

interface ChimeCapable {
  announcerChime?: (tone?: ChimeTone) => void;
  duckForVoice?: (on: boolean) => void;
}

const PRIORITY: Record<AnnouncerKey, number> = {
  victory: 100,
  defeat: 100,
  draw: 100,
  final_minute: 80,
  training_complete: 75,
  launch_ready: 70,
  match_start: 65,
  zone_captured: 50,
  zone_lost: 50,
  zone_contested: 40,
  lead_taken: 35,
  lead_lost: 35,
  triple_elim: 30,
  streak_5: 29,
  first_blood: 28,
  double_elim: 25,
};

/** Seconds before the same line may play again. */
const COOLDOWN: Partial<Record<AnnouncerKey, number>> = {
  zone_contested: 10,
  lead_taken: 8,
  lead_lost: 8,
  zone_captured: 2.5,
  zone_lost: 2.5,
  double_elim: 3,
  triple_elim: 3,
};

const TONE: Partial<Record<AnnouncerKey, ChimeTone>> = {
  victory: 'bright',
  training_complete: 'bright',
  zone_captured: 'bright',
  lead_taken: 'bright',
  defeat: 'low',
  zone_lost: 'low',
  lead_lost: 'low',
};

/** Voices that are jokes or effects on common platforms — never used. */
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|superstar|trinoids|whisper|wobble|zarvox|ralph|fred|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;

/** Scores a voice for calm, natural delivery (higher is better). */
export function scoreVoice(v: { name: string; lang: string; localService: boolean; default?: boolean }, lang: Lang): number {
  const name = v.name ?? '';
  const vl = (v.lang ?? '').toLowerCase().replace('_', '-');
  if (!vl.startsWith(lang)) return -Infinity;
  if (NOVELTY.test(name)) return -Infinity;
  let s = 0;
  if (/natural|neural|online|premium|enhanced|siri/i.test(name)) s += 50;
  if (lang === 'en') {
    if (/google uk english female/i.test(name)) s += 40;
    else if (/google us english|google uk english/i.test(name)) s += 30;
    if (/microsoft (aria|jenny|sonia|libby|ava|emma|andrew|guy|ryan|natasha|clara)/i.test(name)) s += 35;
    if (/samantha|serena|karen|moira|daniel|kate|tessa|allison|ava|susan|zoe/i.test(name)) s += 25;
    if (vl === 'en-gb') s += 8;
    else if (vl === 'en-us') s += 6;
    else if (vl === 'en-au' || vl === 'en-ie' || vl === 'en-ca') s += 4;
  } else {
    if (/microsoft (hamed|zariyah|salma|shakir|fatima|laila)/i.test(name)) s += 35;
    if (/google/i.test(name)) s += 25;
    if (/maged|majed|laila|tarik|mariam/i.test(name)) s += 25;
    if (vl === 'ar-sa' || vl === 'ar-eg' || vl === 'ar-ae') s += 5;
  }
  // Robotic legacy engines.
  if (/espeak|mbrola|festival|pico/i.test(name)) s -= 40;
  if (v.localService) s += 3;
  if (v.default) s += 2;
  return s;
}

interface Queued {
  key: AnnouncerKey;
  prio: number;
  at: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export class VoiceAnnouncer implements Announcer {
  private readonly audio: AudioSystem & ChimeCapable;
  private readonly synth: SpeechSynthesis | null;
  private lang: Lang = 'en';
  private volume = 0.85;
  private voice: SpeechSynthesisVoice | null = null;
  private voicesKnown = false;
  private queue: Queued[] = [];
  private speaking: Queued | null = null;
  /** Holds the live utterance (Chrome drops onend if it is garbage-collected). */
  private utter: SpeechSynthesisUtterance | null = null;
  private listeners: ((text: string, durationMs: number) => void)[] = [];
  private lastSaid = new Map<AnnouncerKey, number>();
  private lastEnd = 0;
  private timers: number[] = [];
  private token = 0;

  constructor(audio: AudioSystem) {
    this.audio = audio as AudioSystem & ChimeCapable;
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    if (this.synth) {
      this.pickVoice();
      try {
        this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
      } catch {
        /* older Safari */
      }
    }
  }

  onSubtitle(cb: (text: string, durationMs: number) => void): void {
    this.listeners.push(cb);
  }

  setLang(lang: Lang): void {
    if (lang === this.lang) return;
    this.lang = lang;
    this.pickVoice();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
  }

  /** The chosen voice's name (debug). */
  get voiceName(): string {
    return this.voice?.name ?? '';
  }

  say(key: AnnouncerKey): void {
    const t = now();
    const prio = PRIORITY[key] ?? 20;
    const last = this.lastSaid.get(key);
    if (last !== undefined && t - last < (COOLDOWN[key] ?? 1.5)) return;
    if (this.speaking?.key === key || this.queue.some((q) => q.key === key)) return;
    this.lastSaid.set(key, t);
    const item: Queued = { key, prio, at: t };
    if (prio >= 100) {
      // The match is over: nothing else matters.
      this.queue = [];
    }
    // Interrupt: the match result cuts off anything; final minute / match
    // start cut off routine callouts (zones, streaks).
    const cur = this.speaking;
    if (cur && ((prio >= 100 && cur.prio < 100) || (prio >= 70 && cur.prio <= 50))) {
      this.queue.unshift(item);
      this.interrupt();
      return;
    }
    this.queue.push(item);
    // Highest priority first; FIFO within a priority.
    this.queue.sort((a, b) => b.prio - a.prio || a.at - b.at);
    if (this.queue.length > 4) this.queue.length = 4;
    if (!this.speaking) this.next();
  }

  private pickVoice(): void {
    if (!this.synth) return;
    let voices: SpeechSynthesisVoice[] = [];
    try {
      voices = this.synth.getVoices();
    } catch {
      voices = [];
    }
    this.voicesKnown = voices.length > 0;
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = -Infinity;
    for (const v of voices) {
      const s = scoreVoice(v, this.lang);
      if (s > bestScore) {
        bestScore = s;
        best = v;
      }
    }
    this.voice = bestScore > -Infinity ? best : null;
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }

  private interrupt(): void {
    this.token++;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
    this.utter = null;
    this.speaking = null;
    this.next();
  }

  private next(): void {
    const t = now();
    // Drop stale low-priority callouts.
    this.queue = this.queue.filter((q) => t - q.at < (q.prio >= 60 ? 8 : 2.5));
    const item = this.queue.shift();
    if (!item) {
      this.speaking = null;
      this.audio.duckForVoice?.(false);
      return;
    }
    // Small global gap between lines.
    const gap = 0.25 - (t - this.lastEnd);
    if (gap > 0 && this.lastEnd > 0) {
      this.queue.unshift(item);
      this.speaking = item;
      this.later(() => {
        this.speaking = null;
        this.next();
      }, gap * 1000);
      return;
    }
    this.speaking = item;
    const token = ++this.token;
    const text = i18n.t(`announcer.${item.key}`);
    // Subtitle duration: reading speed with a sensible floor.
    const ms = Math.max(1800, Math.min(5000, 900 + text.length * 55));
    for (const cb of this.listeners) {
      try {
        cb(text, ms);
      } catch {
        /* ignore subscriber errors */
      }
    }
    try {
      this.audio.announcerChime?.(TONE[item.key] ?? 'normal');
    } catch {
      /* audio unavailable */
    }
    let finished = false;
    const done = () => {
      if (finished || token !== this.token) return;
      finished = true;
      this.utter = null;
      this.lastEnd = now();
      this.speaking = null;
      this.later(() => this.next(), 160);
    };
    // English can still speak with the engine's default voice before the
    // voice list has loaded; Arabic text must never go to an English voice.
    const canSpeak = !!this.synth && this.volume > 0.01 && (this.voice !== null || (!this.voicesKnown && this.lang === 'en'));
    if (!canSpeak) {
      // No voice (or muted): chime + subtitle only, paced by the subtitle.
      this.audio.duckForVoice?.(true);
      this.later(done, Math.min(ms, 1400));
      return;
    }
    // Speak after the chime settles.
    this.later(() => {
      if (token !== this.token) return;
      try {
        const synth = this.synth as SpeechSynthesis;
        // A stuck engine (common after tab switches) blocks the queue.
        if (synth.speaking || synth.pending) synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (this.voice) u.voice = this.voice;
        u.lang = this.voice?.lang ?? (this.lang === 'ar' ? 'ar-SA' : 'en-GB');
        const natural = /natural|neural|online|premium|enhanced|google/i.test(this.voice?.name ?? '');
        u.rate = this.lang === 'ar' ? 0.9 : natural ? 0.96 : 0.92;
        u.pitch = natural ? 1 : 0.92;
        u.volume = this.volume;
        u.onend = done;
        u.onerror = done;
        this.utter = u;
        this.audio.duckForVoice?.(true);
        synth.speak(u);
        // Some engines never fire onend; never let the queue stall.
        this.later(done, ms + 2500);
      } catch {
        done();
      }
    }, 300);
  }
}

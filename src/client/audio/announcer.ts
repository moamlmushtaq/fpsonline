// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — calm voice announcer.
//
// speechSynthesis with a calm voice for the current language (rate ~0.95,
// pitch ~0.9), a soft two-tone chime on the voice bus before each line, music
// ducking while speaking, and subtitles through onSubtitle(). Lines are queued
// and de-duplicated (a line already queued or speaking is skipped). Without
// speechSynthesis it still chimes and emits subtitles.
// ─────────────────────────────────────────────────────────────────────────────

import type { Announcer, AudioSystem } from '../contracts';
import type { AnnouncerKey, Lang } from '../../shared/types';
import { i18n } from '../ui/i18n';

interface ChimeCapable {
  announcerChime?: () => void;
  duckForVoice?: (on: boolean) => void;
}

/** Preferred voices, best first (calm, natural timbres on common platforms). */
const PREFERRED: Record<Lang, RegExp[]> = {
  en: [/Google UK English Female/i, /Samantha/i, /Serena/i, /Karen/i, /Moira/i, /Microsoft (Aria|Jenny|Libby|Sonia)/i, /Natural/i, /English/i],
  ar: [/Maged/i, /Laila/i, /Tarik/i, /Microsoft (Hamed|Salma|Zariyah|Naayf)/i, /Google.*(عربي|Arabic)/i, /Arabic/i],
};

export class VoiceAnnouncer implements Announcer {
  private readonly audio: AudioSystem & ChimeCapable;
  private readonly synth: SpeechSynthesis | null;
  private lang: Lang = 'en';
  private volume = 0.85;
  private voice: SpeechSynthesisVoice | null = null;
  private queue: AnnouncerKey[] = [];
  private speaking: AnnouncerKey | null = null;
  private listeners: ((text: string, durationMs: number) => void)[] = [];
  private watchdog = 0;

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

  say(key: AnnouncerKey): void {
    if (this.speaking === key || this.queue.includes(key)) return;
    // Keep the queue short: stale callouts are worse than none.
    if (this.queue.length >= 3) this.queue.shift();
    this.queue.push(key);
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
    const langPrefix = this.lang === 'ar' ? 'ar' : 'en';
    const candidates = voices.filter((v) => v.lang?.toLowerCase().startsWith(langPrefix));
    let pick: SpeechSynthesisVoice | null = null;
    for (const re of PREFERRED[this.lang]) {
      pick = candidates.find((v) => re.test(v.name)) ?? null;
      if (pick) break;
    }
    this.voice = pick ?? candidates.find((v) => v.localService) ?? candidates[0] ?? null;
  }

  private next(): void {
    const key = this.queue.shift();
    if (!key) {
      this.speaking = null;
      this.audio.duckForVoice?.(false);
      return;
    }
    this.speaking = key;
    const text = i18n.t(`announcer.${key}`);
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
      this.audio.announcerChime?.();
    } catch {
      /* audio unavailable */
    }
    const done = () => {
      if (this.watchdog) window.clearTimeout(this.watchdog);
      this.watchdog = 0;
      window.setTimeout(() => this.next(), 180);
    };
    if (!this.synth || this.volume <= 0.01 || !this.voice) {
      // No voice available (or muted): chime + subtitle only, paced by the subtitle.
      window.setTimeout(done, Math.min(ms, 1400));
      return;
    }
    // Speak after the chime settles.
    window.setTimeout(() => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = this.voice;
        u.lang = this.voice?.lang ?? (this.lang === 'ar' ? 'ar-SA' : 'en-GB');
        u.rate = 0.95;
        u.pitch = 0.9;
        u.volume = this.volume;
        u.onend = done;
        u.onerror = done;
        this.audio.duckForVoice?.(true);
        this.synth?.speak(u);
        // Some engines never fire onend; never let the queue stall.
        this.watchdog = window.setTimeout(done, ms + 2500);
      } catch {
        done();
      }
    }, 320);
  }
}

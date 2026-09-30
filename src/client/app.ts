// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — App shell.
//
// Creates every client service once, owns the requestAnimationFrame loop,
// applies settings live (quality, language/RTL, colorblind, volumes, HUD),
// and drives navigation + the match flow:
//
//   menu ─► quickPlay / botMatch / training / createRoom / joinRoom
//        ─► (matchmaking | room) ─► matchStart ─► loading ─► ClientMatch
//        ─► match (HUD) ─► done ─► results (XP via profile.applyMatch) ─► menu
//
// The in-match section is kept isolated ("MATCH FLOW") so the netcode engineer
// can refine it without touching the rest of the shell.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action, HudState, ScreenId, Settings } from './contracts';
import { Renderer } from './engine/renderer';
import { Materials } from './engine/materials';
import { setColorblindMode, teamColors } from './engine/palette';
import { WeaponModels } from './world/weapon-models';
import { Characters } from './world/characters';
import { Input } from './input/input';
import { Audio } from './audio/audio';
import { VoiceAnnouncer } from './audio/announcer';
import { GameHud } from './ui/hud/hud';
import { UI } from './ui/manager';
import { MenuScene } from './ui/menu-scene';
import { prewarmKeyArt } from './ui/keyart';
import { i18n } from './ui/i18n';
import { settings, type SettingsStore } from './state/settings';
import { profile, type ProfileStore } from './state/profile';
import { NetManager } from './net/net-manager';
import type { Transport } from './net/transport';
import { ClientMatch } from './game/match';
import type { LoadingScreen } from './ui/screens/loading';
import { PROTOCOL_VERSION, ROOM_CODE_LENGTH } from '../shared/constants';
import { totalXpForLevel, unlocksBetween } from '../shared/progression';
import { MODES } from '../shared/modes';
import type { ClientMsg, HelloMsg, MatchStartMsg, QueueStatusMsg, RoomStateMsg, ServerMsg } from '../shared/protocol';
import type { BotDifficulty, InputDevice, Lang, MapId, MatchResults, ModeId, Platform, PlayerResult, Team } from '../shared/types';
import { PVP_MAP_IDS } from '../shared/types';

export interface AppEvents {
  queue: QueueStatusMsg;
  room: RoomStateMsg | null;
}

interface Session {
  transport: Transport;
  offs: (() => void)[];
  closed: boolean;
  /** Why the session exists (drives error handling). */
  purpose: 'queue' | 'room' | 'match';
}

const MENU_SCREENS = new Set<ScreenId>(['menu', 'play', 'loadout', 'customize', 'settings', 'profile', 'matchmaking', 'room', 'results']);

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  if (/iPad|Tablet/i.test(ua) || (touch && /Macintosh/.test(ua))) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

export class App {
  readonly engine: Renderer;
  readonly materials: Materials;
  readonly weapons: WeaponModels;
  readonly characters: Characters;
  readonly input: Input;
  readonly audio: Audio;
  readonly announcer: VoiceAnnouncer;
  readonly ui: UI;
  readonly net: NetManager;
  readonly hud: GameHud;

  readonly settings: SettingsStore = settings;
  readonly profile: ProfileStore = profile;
  readonly i18n = i18n;
  readonly platform: Platform = detectPlatform();
  readonly debug: boolean;

  menuScene: MenuScene | null = null;
  /** Latest private-room lobby state (null when not in a room). */
  room: RoomStateMsg | null = null;
  /** Latest matchmaking status (null when not queued). */
  queueStatus: QueueStatusMsg | null = null;
  /** Installed by the touch-layout engineer; the Settings screen shows its button only when defined. */
  openTouchLayoutEditor?: () => void;

  private match: ClientMatch | null = null;
  private session: Session | null = null;
  private lastLaunch: (() => Promise<void>) | null = null;
  private paused = false;
  private raf = 0;
  private lastT = 0;
  private prevSettings: Settings | null = null;
  private listeners: { [K in keyof AppEvents]: Set<(v: AppEvents[K]) => void> } = { queue: new Set(), room: new Set() };
  private pendingRoomCode: string | null = null;
  private launching = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.debug = params.get('debug') === '1';
    const urlLang = params.get('lang');
    if (urlLang === 'ar' || urlLang === 'en') settings.update({ lang: urlLang as Lang });
    // Language first so every screen is built in the right direction.
    i18n.setLang(settings.value.lang);

    const s = settings.value;
    this.engine = new Renderer(canvas, { preset: s.quality, renderScale: s.renderScale });
    this.materials = new Materials();
    this.materials.setQuality(this.engine.quality);
    this.weapons = new WeaponModels(this.materials);
    this.characters = new Characters(this.materials, this.weapons);
    this.input = new Input(canvas, () => settings.value);
    this.audio = new Audio();
    this.announcer = new VoiceAnnouncer(this.audio);
    this.hud = new GameHud();
    this.net = new NetManager();
    this.ui = new UI(uiRoot, this);

    try {
      this.menuScene = new MenuScene(this);
    } catch (err) {
      console.error('[app] menu scene failed', err);
      this.menuScene = null;
    }

    this.wireServices(canvas);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  private wireServices(canvas: HTMLCanvasElement): void {
    settings.onChange((s) => this.applySettings(s));
    this.engine.onQualityChange((q) => {
      document.body.classList.toggle('q-low', q.preset === 'low');
      this.materials.setQuality(q);
      this.audio.setHrtf(q.hrtf);
      this.audio.setLite(q.preset === 'low');
    });
    this.input.onDeviceChange((d: InputDevice) => {
      document.body.classList.toggle('touch-ui', d === 'touch');
      this.syncTouchControls();
    });
    this.announcer.onSubtitle((text, ms) => {
      if (settings.value.subtitles && this.match) this.hud.subtitle(text, ms);
    });
    this.ui.onChange((base, top) => this.onScreenChange(base, top));
    this.net.onStatus(() => this.onNetStatus());

    // Audio can only start from a user gesture.
    const events = ['pointerdown', 'keydown', 'touchend'] as const;
    const unlock = () => {
      this.audio.unlock();
      this.onScreenChange(this.ui.baseScreen, this.ui.current);
      // Keep listening until the context really runs (some browsers need a second gesture).
      window.setTimeout(() => {
        if (this.audio.unlocked) for (const ev of events) window.removeEventListener(ev, unlock);
      }, 250);
    };
    for (const ev of events) window.addEventListener(ev, unlock, { passive: true });

    document.addEventListener('visibilitychange', () => {
      this.audio.setHidden(document.hidden);
      this.lastT = performance.now();
      if (document.hidden) settings.flush();
    });

    // Losing pointer lock in gameplay (Esc on desktop) opens the pause menu.
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.match && !this.paused && this.ui.current === 'match' && this.input.device === 'kbm') this.pause();
    });
    // Clicking the game view re-captures the mouse.
    canvas.addEventListener('pointerdown', () => {
      if (this.match && !this.paused && this.ui.current === 'match' && this.input.device !== 'touch' && !this.input.pointerLocked) this.input.lockPointer();
    });
    window.addEventListener('pagehide', () => settings.flush());
  }

  /** Shows the menu, starts the frame loop and resolves once the first frame rendered. */
  async start(): Promise<void> {
    this.applySettings(settings.value);
    document.body.classList.toggle('q-low', this.engine.quality.preset === 'low');
    document.body.classList.toggle('touch-ui', this.input.device === 'touch');
    this.audio.setHrtf(this.engine.quality.hrtf);
    this.audio.setLite(this.engine.quality.preset === 'low');
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    await this.ui.show('menu');
    // Two frames: scene compiled and presented before the splash fades.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    prewarmKeyArt(['gantry', 'pastel', 'observatory', 'range']);
    void this.net.probe().catch(() => undefined);
    this.handleUrlEntry();
    if (this.debug) this.installDebug();
  }

  on<K extends keyof AppEvents>(ev: K, cb: (v: AppEvents[K]) => void): () => void {
    this.listeners[ev].add(cb);
    return () => this.listeners[ev].delete(cb);
  }

  private emit<K extends keyof AppEvents>(ev: K, v: AppEvents[K]): void {
    for (const cb of [...this.listeners[ev]]) {
      try {
        cb(v);
      } catch (err) {
        console.error('[app] listener failed', err);
      }
    }
  }

  // ── Frame loop ────────────────────────────────────────────────────────────

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    if (document.hidden) return;
    try {
      // Input sampling happens inside ClientMatch.update (fixed-step accumulator).
      if (this.match) {
        this.match.update(dt);
        if (!this.paused && this.ui.current === 'match' && this.input.pressed('pause')) this.pause();
      } else this.menuScene?.update(dt);
      this.ui.update(dt);
      this.audio.update(dt);
      this.engine.render(dt);
    } catch (err) {
      console.error('[app] frame error', err);
    }
    this.input.endFrame();
  };

  // ── Settings ──────────────────────────────────────────────────────────────

  private applySettings(s: Settings): void {
    const prev = this.prevSettings;
    this.prevSettings = s;
    if (!prev || prev.lang !== s.lang) {
      i18n.setLang(s.lang);
      this.announcer.setLang(s.lang);
      document.title = s.lang === 'ar' ? 'HALCYON FRONT — هالسيون فرونت' : 'HALCYON FRONT';
    }
    if (prev && prev.quality !== s.quality) this.engine.setQualityPreset(s.quality);
    if (!prev || prev.renderScale !== s.renderScale) this.engine.setRenderScale(s.renderScale);
    if (!prev || prev.colorblind !== s.colorblind) {
      setColorblindMode(s.colorblind);
      this.applyTeamColors();
      // Characters' visors & the menu preview read team colors at build time.
      if (prev) this.menuScene?.refresh(true);
    }
    this.audio.setVolumes(s.volumes);
    this.announcer.setVolume(s.volumes.voice);
    this.hud.setScale(s.hudScale);
    this.hud.setCrosshair(s.crosshair, s.crosshairColor);
    document.documentElement.style.setProperty('--hud-scale', String(s.hudScale));
  }

  private applyTeamColors(): void {
    const st = document.documentElement.style;
    for (const t of [0, 1, 2] as const) {
      const c = teamColors(t);
      st.setProperty(`--team${t}`, c.primary);
      st.setProperty(`--team${t}-light`, c.light);
    }
    st.setProperty('--team1-secondary', teamColors(1).secondary);
  }

  // ── Screen-driven state (music, 3D menu scene, input capture, ducking) ───

  private onScreenChange(base: ScreenId | null, top: ScreenId | null): void {
    const menuish = base !== null && MENU_SCREENS.has(base) && !this.match;
    if (this.menuScene) {
      if (menuish) {
        this.menuScene.activate();
        this.menuScene.setFocus(base);
      } else this.menuScene.deactivate();
    }
    // Music (the match refines match/final itself; results sets victory/defeat).
    if (base === 'loading' || base === 'matchmaking' || base === 'room') this.audio.setMusic('lobby');
    else if (base === 'match') {
      /* ClientMatch owns in-match music */
    } else if (base !== 'results') this.audio.setMusic('menu');
    const inGameplay = base === 'match' && top === 'match' && !this.paused;
    this.input.setGameplayActive(inGameplay);
    this.audio.setDuck(base === 'match' && top !== 'match' ? 1 : 0);
    this.syncTouchControls();
  }

  private syncTouchControls(): void {
    const show = !!this.match && !this.paused && this.ui.current === 'match' && this.input.device === 'touch';
    this.input.setTouchControlsVisible(show);
  }

  private onNetStatus(): void {
    if (this.pendingRoomCode && this.net.status === 'online') {
      const code = this.pendingRoomCode;
      this.pendingRoomCode = null;
      void this.joinRoom(code);
    }
  }

  // ── Navigation API ────────────────────────────────────────────────────────

  openScreen(id: ScreenId, params?: unknown): Promise<void> {
    return this.ui.show(id, params);
  }

  /** Called after sign-in/out so the next hello carries the new identity. */
  onAccountChanged(): void {
    void this.net.probe().catch(() => undefined);
  }

  roomLink(code: string): string {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    const server = new URLSearchParams(location.search).get('server');
    if (server) u.searchParams.set('server', server);
    u.searchParams.set('room', code);
    return u.toString();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // MATCH FLOW — sessions, queueing, rooms and the match lifecycle.
  // (Owned by the shell today; the netcode engineer may refine this section.)
  // ═════════════════════════════════════════════════════════════════════════

  /** Quick play: online matchmaking when the server is reachable, else an offline bot match. */
  async quickPlay(mode: ModeId = 'tdm'): Promise<void> {
    if (this.launching) return;
    this.lastLaunch = () => this.quickPlay(mode);
    const t = await this.openTransport('auto');
    if (!t) return;
    this.beginSession(t, 'queue');
    this.queueStatus = null;
    await this.ui.show('matchmaking', { mode });
    this.send({ type: 'queue', mode, map: 'any', botDifficulty: 'veteran', kind: 'quick' });
  }

  /** Offline match against bots (always the in-browser host). */
  async botMatch(mode: ModeId = 'tdm', map: MapId | 'any' = 'any', difficulty: BotDifficulty = 'veteran'): Promise<void> {
    if (this.launching) return;
    const m: ModeId = mode === 'range' ? 'tdm' : mode;
    const resolved: MapId = map === 'any' || !MODES[m].maps.includes(map) ? PVP_MAP_IDS[Math.floor(Math.random() * PVP_MAP_IDS.length)] : map;
    this.lastLaunch = () => this.botMatch(mode, map, difficulty);
    const t = await this.openTransport('local');
    if (!t) return;
    this.beginSession(t, 'queue');
    await this.ui.show('loading', { map: resolved, mode: m });
    this.send({ type: 'queue', mode: m, map: resolved, botDifficulty: difficulty, kind: 'bots' });
  }

  /** Training Range (optionally with the 60-second interactive tutorial). */
  async training(tutorial = false): Promise<void> {
    if (this.launching) return;
    this.lastLaunch = () => this.training(false);
    const t = await this.openTransport('local');
    if (!t) return;
    this.beginSession(t, 'queue');
    await this.ui.show('loading', { map: 'range', mode: 'range' });
    this.send({ type: 'queue', mode: 'range', map: 'range', botDifficulty: 'veteran', kind: 'solo', tutorial });
  }

  async createRoom(opts: { mode: ModeId; map: MapId; botFill: boolean; botDifficulty: BotDifficulty }): Promise<void> {
    if (this.launching) return;
    const t = await this.openTransport('online');
    if (!t) return;
    this.beginSession(t, 'room');
    this.room = null;
    await this.ui.show('room', {});
    this.send({ type: 'createRoom', mode: opts.mode, map: opts.map, botFill: opts.botFill, botDifficulty: opts.botDifficulty });
  }

  async joinRoom(code: string): Promise<void> {
    const c = code.trim().toUpperCase();
    if (c.length !== ROOM_CODE_LENGTH) {
      this.ui.toast('errors.invalidCode', 'error');
      return;
    }
    if (this.launching) return;
    const t = await this.openTransport('online');
    if (!t) return;
    this.beginSession(t, 'room');
    this.room = null;
    await this.ui.show('room', { code: c });
    this.send({ type: 'joinRoom', code: c });
  }

  updateRoom(opts: { mode: ModeId; map: MapId; botFill: boolean; botDifficulty: BotDifficulty }): void {
    this.send({ type: 'roomSettings', ...opts });
  }

  switchRoomTeam(): void {
    const me = this.room?.players.find((p) => p.id === this.room?.you);
    if (!me) return;
    this.send({ type: 'roomTeam', team: (me.team === 0 ? 1 : 0) as Team });
  }

  startRoom(): void {
    this.send({ type: 'startRoom' });
  }

  leaveRoom(): void {
    this.send({ type: 'leave' });
    this.endSession();
    this.room = null;
    this.emit('room', null);
    void this.ui.show('menu');
  }

  cancelQueue(): void {
    this.send({ type: 'cancelQueue' });
    this.endSession();
    this.queueStatus = null;
    void this.ui.show('menu');
  }

  async playAgain(): Promise<void> {
    if (this.lastLaunch) await this.lastLaunch();
    else await this.quickPlay('tdm');
  }

  /** Pause overlay (the online match keeps running). */
  pause(): void {
    if (!this.match || this.paused) return;
    this.paused = true;
    if (document.pointerLockElement) document.exitPointerLock?.();
    void this.ui.push('pause');
    this.onScreenChange(this.ui.baseScreen, this.ui.current);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    void (async () => {
      while (this.ui.overlayCount > 0) await this.ui.pop();
      this.onScreenChange(this.ui.baseScreen, this.ui.current);
      if (this.input.device === 'kbm') this.input.lockPointer();
    })();
  }

  async leaveMatch(): Promise<void> {
    const ok = await this.ui.confirm('hud.pause.leaveTitle', 'hud.pause.leaveBody', 'hud.pause.leaveOk', 'hud.pause.stay');
    if (!ok) return;
    const m = this.match;
    if (!m) {
      void this.ui.show('menu');
      return;
    }
    this.paused = false;
    try {
      m.leave();
    } catch (err) {
      console.error('[app] leave failed', err);
      this.finishMatch(m, null, -1);
    }
  }

  get inMatch(): boolean {
    return !!this.match;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  // ── Transport sessions ────────────────────────────────────────────────────

  private async openTransport(kind: 'auto' | 'online' | 'local'): Promise<Transport | null> {
    this.endSession();
    this.launching = true;
    try {
      if (kind === 'online' || (kind === 'auto' && this.net.status === 'online')) {
        if (this.net.status !== 'online') {
          this.ui.toast('errors.onlineOnly', 'error');
          return null;
        }
        try {
          return await this.net.openOnline();
        } catch (err) {
          console.warn('[app] online transport failed', err);
          if (kind === 'online') {
            this.ui.toast('errors.connectFailed', 'error');
            return null;
          }
          this.ui.toast('errors.fallbackBots', 'info');
        }
      }
      try {
        return this.net.openLocal();
      } catch (err) {
        console.warn('[app] local transport unavailable', err);
        this.ui.toast('errors.notReady', 'error');
        return null;
      }
    } finally {
      this.launching = false;
    }
  }

  private helloMsg(): HelloMsg {
    const p = profile.value;
    return {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      name: p.name,
      token: p.token ?? undefined,
      platform: this.platform,
      lang: i18n.lang,
      level: p.level,
      rating: p.rating,
      loadout: p.loadout,
      cosmetics: p.cosmetics,
      faction: p.faction,
    };
  }

  private beginSession(transport: Transport, purpose: Session['purpose']): Session {
    const s: Session = { transport, offs: [], closed: false, purpose };
    this.session = s;
    s.offs.push(transport.onMessage((m) => this.onServerMessage(s, m)));
    s.offs.push(transport.onClose(() => this.onTransportClosed(s)));
    transport.send(this.helloMsg());
    return s;
  }

  private send(m: ClientMsg): void {
    const s = this.session;
    if (!s || s.closed) return;
    try {
      s.transport.send(m);
    } catch (err) {
      console.warn('[app] send failed', err);
    }
  }

  private endSession(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    s.closed = true;
    for (const off of s.offs) off();
    try {
      s.transport.close();
    } catch {
      /* already closed */
    }
  }

  private onServerMessage(s: Session, m: ServerMsg): void {
    if (s !== this.session) return;
    switch (m.type) {
      case 'queueStatus':
        this.queueStatus = m;
        this.emit('queue', m);
        if (m.state === 'cancelled' && this.ui.baseScreen === 'matchmaking') {
          this.endSession();
          void this.ui.show('menu');
        }
        break;
      case 'roomState':
        this.room = m;
        s.purpose = 'room';
        this.emit('room', m);
        if (m.state === 'lobby' && !this.match && this.ui.baseScreen !== 'room') void this.ui.show('room', { code: m.code });
        break;
      case 'matchStart':
        s.purpose = 'match';
        void this.beginMatch(s, m);
        break;
      case 'error':
        this.ui.toast(`errors.${m.code}`, 'error');
        if (!this.match && (m.code === 'room_not_found' || m.code === 'room_full' || m.code === 'room_started' || m.code === 'bad_protocol' || m.code === 'server_full' || m.code === 'offline_unavailable')) {
          this.endSession();
          this.room = null;
          void this.ui.show('menu');
        }
        break;
      default:
        break;
    }
  }

  private onTransportClosed(s: Session): void {
    if (s !== this.session || s.closed) return;
    s.closed = true;
    this.session = null;
    for (const off of s.offs) off();
    this.ui.toast('errors.connectionLost', 'error');
    const m = this.match;
    if (m) {
      // The match should resolve `done` itself; make sure we never hang in a dead match.
      window.setTimeout(() => {
        if (this.match === m) {
          try {
            m.leave();
          } catch {
            this.finishMatch(m, null, -1);
          }
        }
      }, 1500);
    } else if (this.ui.baseScreen !== 'menu' && this.ui.baseScreen !== 'results') void this.ui.show('menu');
  }

  private async beginMatch(s: Session, start: MatchStartMsg): Promise<void> {
    if (this.match) return;
    const { map, mode } = start.config;
    this.audio.ui('matchFound');
    if (this.ui.baseScreen !== 'loading') await this.ui.show('loading', { map, mode });
    const t0 = performance.now();
    // Release the renderer before the match claims it with its own scene.
    this.menuScene?.deactivate();
    let match: ClientMatch;
    try {
      match = new ClientMatch(this, s.transport, start);
    } catch (err) {
      console.error('[app] match failed to start', err);
      this.ui.toast('errors.generic', 'error');
      this.endSession();
      void this.ui.show('menu');
      return;
    }
    this.match = match;
    this.paused = false;
    // Optional readiness/progress hooks a richer ClientMatch may expose.
    const hooks = match as unknown as { ready?: Promise<unknown>; loadProgress?: number };
    const loading = this.ui.screen<LoadingScreen>('loading');
    if (hooks.ready) {
      const poll = window.setInterval(() => {
        if (typeof hooks.loadProgress === 'number') loading.setProgress(hooks.loadProgress);
      }, 100);
      await hooks.ready.catch(() => undefined);
      window.clearInterval(poll);
    }
    loading.setProgress(1);
    // Keep the key art on screen long enough to read a tip (shorter for training).
    await wait((mode === 'range' ? 900 : 2400) - (performance.now() - t0));
    if (this.match !== match) return;
    await this.ui.show('match');
    this.onScreenChange('match', this.ui.current);
    const result = await match.done.catch((err) => {
      console.error('[app] match ended with an error', err);
      return null;
    });
    this.finishMatch(match, result, start.you);
  }

  private finishMatch(match: ClientMatch, result: { results: MatchResults; ratingDelta: number } | null, you: number): void {
    if (this.match !== match) return;
    this.match = null;
    this.paused = false;
    try {
      match.dispose();
    } catch (err) {
      console.error('[app] match dispose failed', err);
    }
    this.input.setGameplayActive(false);
    this.input.setTouchControlsVisible(false);
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.audio.setHeartbeat(0);
    this.audio.setEnvironment(null);
    this.engine.setOverlay(null, null);
    this.endSession();
    this.room = null;
    if (result && you >= 0) {
      const applied = profile.applyMatch(result.results, you, result.ratingDelta);
      void this.ui.show('results', { results: result.results, you, applied, ratingDelta: result.ratingDelta });
    } else void this.ui.show('menu');
  }

  // ── URL entry points ──────────────────────────────────────────────────────

  private handleUrlEntry(): void {
    const params = new URLSearchParams(location.search);
    const code = params.get('room');
    if (!code) return;
    // Consume the parameter so a reload doesn't rejoin.
    params.delete('room');
    const qs = params.toString();
    try {
      history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
    } catch {
      /* ignore */
    }
    if (this.net.status === 'online') void this.joinRoom(code);
    else {
      this.pendingRoomCode = code.toUpperCase();
      // Give discovery a few seconds before explaining that rooms need the server.
      window.setTimeout(() => {
        if (this.pendingRoomCode) {
          this.pendingRoomCode = null;
          this.ui.toast('errors.offline_unavailable', 'error');
        }
      }, 6000);
    }
  }

  // ── Debug hooks (?debug=1) — ARCHITECTURE §9 ────────────────────────────

  private installDebug(): void {
    const app = this;
    (window as unknown as { __HF: unknown }).__HF = {
      app,
      botMatch: (mode: ModeId = 'tdm', map: MapId | 'any' = 'any', difficulty: BotDifficulty = 'veteran') => app.botMatch(mode, map, difficulty),
      training: (tutorial = false) => app.training(tutorial),
      quickPlay: (mode: ModeId = 'tdm') => app.quickPlay(mode),
      show: (id: ScreenId, params?: unknown) => app.ui.show(id, params),
      state: () => {
        const extra = (app.match as unknown as { debugState?: () => Record<string, unknown> } | null)?.debugState?.() ?? {};
        return {
          screen: app.ui.current,
          inMatch: !!app.match,
          phase: null,
          fps: Math.round(app.engine.stats.fps),
          players: null,
          you: null,
          health: null,
          ammo: null,
          drawCalls: app.engine.stats.calls,
          ...extra,
        };
      },
      simulateInput: (actions: Partial<Record<Action, boolean>>, look?: { dx: number; dy: number }) => {
        const sim = (app.input as unknown as { simulate?: (a: Partial<Record<Action, boolean>>, l?: { dx: number; dy: number }) => void }).simulate;
        if (typeof sim === 'function') sim.call(app.input, actions, look);
        else console.warn('[debug] input simulation not available');
      },
      setTimeScale: (k: number) => (app.match as unknown as { setTimeScale?: (k: number) => void } | null)?.setTimeScale?.(k),
      /** Renders the results screen with generated data (does not change saved progress). */
      mockResults: (opts: { mode?: ModeId; win?: boolean; levelUp?: boolean } = {}) => app.showMockResults(opts),
      /** Shows the HUD with a representative state (visual QA without a match). */
      mockHud: (patch: Partial<HudState> = {}) => app.showMockHud(patch),
    };
  }

  private async showMockHud(patch: Partial<HudState>): Promise<void> {
    await this.ui.show('match');
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const c0 = teamColors(0).primary;
    const c1 = teamColors(1).primary;
    const state: HudState = {
      mode: 'control',
      phase: 'live',
      phaseLeft: 222,
      health: 64,
      maxHealth: 100,
      alive: true,
      respawnIn: 0,
      protectedT: 0,
      weapon: 'meridian',
      mag: 7,
      magSize: 30,
      reserve: 120,
      reloading: -1,
      charge: 0,
      throwable: 'grenade',
      throwables: 1,
      yaw: -0.6,
      compass: [
        { yaw: -0.9, label: 'A', color: c0, kind: 'zone' },
        { yaw: -0.2, label: 'B', color: '#f3ece0', kind: 'zone' },
        { yaw: 0.35, label: 'C', color: c1, kind: 'zone' },
        { yaw: -1.2, label: i18n.t('landmark.gantry.sea'), color: '#f3ece0', kind: 'landmark' },
        { yaw: -0.45, label: i18n.t('landmark.gantry.tower'), color: '#f3ece0', kind: 'landmark' },
      ],
      objectives: [
        { id: 'A', label: 'A', screen: { x: w * 0.28, y: hgt * 0.42 }, offscreen: false, color: c0, progress: 1, distance: 42, kind: 'zone', pulse: false },
        { id: 'B', label: 'B', screen: { x: w * 0.56, y: hgt * 0.38 }, offscreen: false, color: '#f3ece0', progress: 0.45, distance: 18, kind: 'zone', pulse: true },
        { id: 'C', label: 'C', screen: { x: w - 30, y: hgt * 0.5 }, offscreen: true, color: c1, progress: 1, distance: 61, kind: 'zone', pulse: false },
      ],
      localTeam: 0,
      teamScores: [212, 187],
      scoreLimit: 400,
      spread: 6,
      ads: 0,
      scoped: false,
      sprinting: false,
      prompt: null,
      ping: 42,
      fps: 118,
      showFps: true,
      ...patch,
    };
    this.hud.update(0.016, state);
    this.hud.killFeed({ killer: { name: profile.value.name, team: 0, local: true }, victim: { name: 'Vega', team: 1, local: false }, cause: 'meridian', head: true });
    this.hud.killFeed({ killer: { name: 'Orla', team: 1, local: false }, victim: { name: 'Kepler', team: 0, local: false }, cause: 'longline', head: false });
    this.hud.killFeed({ killer: { name: 'Halley', team: 0, local: false }, victim: { name: 'Tycho', team: 1, local: false }, cause: 'grenade', head: false });
    this.hud.toast('+100 ' + i18n.t('hud.toast.elim'));
    this.hud.toast('+15 ' + i18n.t('hud.toast.headshot'), '#ffd166');
    this.hud.hitMarker('headkill');
    this.hud.eliminated('Vega', true);
    this.hud.damage(1.2, 30);
    this.hud.subtitle(i18n.t('announcer.zone_captured'), 4000);
  }

  private showMockResults(opts: { mode?: ModeId; win?: boolean; levelUp?: boolean }): Promise<void> {
    const mode = opts.mode ?? 'tdm';
    const names = ['Halley', 'Juno', 'Kepler', 'Mira', 'Soren', 'Vega', 'Orla', 'Tycho', 'Lumen'];
    const you = 1;
    const players: PlayerResult[] = [];
    const teams = mode === 'tdm' || mode === 'control';
    for (let i = 0; i < 10; i++) {
      const isYou = i === 1;
      const kills = isYou ? 17 : Math.floor(4 + ((i * 7) % 13));
      players.push({
        id: i,
        name: isYou ? profile.value.name : names[i % names.length],
        team: (teams ? (i % 2) : 2) as Team,
        faction: (i % 2) as 0 | 1,
        isBot: !isYou && i > 3,
        level: isYou ? profile.value.level : 3 + ((i * 5) % 30),
        namecard: isYou ? profile.value.cosmetics.namecard : ['horizon', 'launchpad', 'suburbia', 'aperture', 'telemetry'][i % 5],
        stats: {
          kills,
          deaths: isYou ? 8 : 5 + (i % 7),
          assists: isYou ? 6 : i % 5,
          damage: kills * 88,
          shots: isYou ? 412 : 300,
          hits: isYou ? 158 : 90,
          headshots: isYou ? 7 : i % 4,
          objectiveTime: mode === 'control' ? (isYou ? 84 : 30) : 0,
          captures: mode === 'control' ? (isYou ? 3 : 1) : 0,
          score: kills * 100 + (isYou ? 650 : i * 20),
          bestStreak: isYou ? 5 : 2,
        },
      });
    }
    const win = opts.win ?? true;
    const results: MatchResults = {
      mode,
      map: 'gantry',
      winner: teams ? ((win ? 1 : 0) as Team) : 2,
      winnerPlayer: teams ? -1 : win ? you : 4,
      draw: false,
      teamScores: teams ? (win ? [42, 50] : [50, 44]) : [0, 0],
      players,
      mvp: you,
      duration: 412,
    };
    const applied = profile.applyMatch(results, you, win ? 14 : -9, { dryRun: true, botMatch: false });
    if (opts.levelUp) {
      // Preview a level-up with unlock reveals: start just short of the next level.
      const startXp = Math.max(0, totalXpForLevel(applied.before.level + 1) - Math.round(applied.xp.total * 0.4));
      applied.before = profile.levelInfo(startXp);
      applied.after = profile.levelInfo(startXp + applied.xp.total);
      applied.unlocks = unlocksBetween(applied.before.level, applied.after.level);
    }
    return this.ui.show('results', { results, you, applied, ratingDelta: win ? 14 : -9 });
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.endSession();
    this.menuScene?.dispose();
    this.input.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — admin console controller (the game owner's cheat menu).
//
// Activation is secret: Backquote / F8 toggles a terminal (menus and matches);
// on touch, 7 taps on the build label in Settings open it. Until `admin <code>`
// succeeds every command answers "unknown command". Afterwards: `help`,
// `menu` / Ctrl+Shift+A (cheat panel), and the cheats.
//
// Authorization:
//   • offline (local Worker host): the code is checked here against a salted
//     SHA-256 baked at build time (VITE_ADMIN_CODE, see vite.config.ts); the
//     auth message then carries `trusted: true`, which only kind 'local' hosts honour.
//   • online: the password goes to the server (ADMIN_PASSWORD, constant-time,
//     rate-limited); the server decides.
// Auth (+ the password for re-authorizing new connections) and the sticky
// toggles (god / ammo / speed / wallhack) are remembered in sessionStorage.
//
// Host cheats are authoritative (GameSim); ammo/speed travel inside the
// predicted CombatState so prediction stays exact. Client-only cheats:
// wallhack (adminFlags, active only offline or when the server authorized us),
// unlockall and xp (local profile; accounts sync like normal progress).
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../app';
import { MAX_LEVEL, totalXpForLevel } from '../../shared/progression';
import type { AdminCheat, AdminReplyMsg, AdminState } from '../../shared/protocol';
import { adminCodeHash } from '../../shared/sha256';
import { getMap } from '../../shared/maps/index';
import { i18n } from '../ui/i18n';
import { AdminUi, type PanelAction, type PanelModel } from './admin-ui';
import { adminFlags } from './flags';

declare const __HF_ADMIN_HASH__: string;
/** Salted SHA-256 of the offline admin code (empty = offline admin disabled). */
const BAKED_HASH: string = typeof __HF_ADMIN_HASH__ === 'string' ? __HF_ADMIN_HASH__ : '';

const STORE_KEY = 'hf.admin.v1';
const TAPS_TO_OPEN = 7;
const TAP_GAP_MS = 1200;

interface Saved {
  /** Password for re-authorizing new online connections (tab-scoped). */
  pw: string | null;
  /** The offline code was verified. */
  local: boolean;
  god: boolean;
  ammo: boolean;
  speed: number;
  wallhack: boolean;
}

type Pending = { kind: 'auth'; silent: boolean } | { kind: 'cheat'; cheat: AdminCheat; value: unknown; silent: boolean };

const HOST_CMDS: { cmd: string; usage: string; help: string }[] = [
  { cmd: 'god', usage: 'god [on|off]', help: 'admin.help.god' },
  { cmd: 'ammo', usage: 'ammo [on|off]', help: 'admin.help.ammo' },
  { cmd: 'speed', usage: 'speed <1..3>', help: 'admin.help.speed' },
  { cmd: 'sunspear', usage: 'sunspear', help: 'admin.help.sunspear' },
  { cmd: 'killbots', usage: 'killbots', help: 'admin.help.killbots' },
  { cmd: 'freezebots', usage: 'freezebots [on|off]', help: 'admin.help.freezebots' },
  { cmd: 'teleport', usage: 'teleport <A|B|C|spawn>', help: 'admin.help.teleport' },
  { cmd: 'endmatch', usage: 'endmatch [win]', help: 'admin.help.endmatch' },
];
const OTHER_CMDS: { usage: string; help: string }[] = [
  { usage: 'wallhack [on|off]', help: 'admin.help.wallhack' },
  { usage: 'unlockall', help: 'admin.help.unlockall' },
  { usage: 'xp <amount>', help: 'admin.help.xp' },
  { usage: 'menu', help: 'admin.help.menu' },
  { usage: 'status', help: 'admin.help.status' },
  { usage: 'clear', help: 'admin.help.clear' },
  { usage: 'logout', help: 'admin.help.logout' },
  { usage: 'help', help: 'admin.help.help' },
];

function readStore(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved>;
    return {
      pw: typeof v.pw === 'string' ? v.pw : null,
      local: v.local === true,
      god: v.god === true,
      ammo: v.ammo === true,
      speed: typeof v.speed === 'number' && v.speed >= 1 && v.speed <= 3 ? v.speed : 1,
      wallhack: v.wallhack === true,
    };
  } catch {
    return null;
  }
}

/** Typed admin code → matches the build-time hash? */
export function checkAdminCode(code: string): boolean {
  return BAKED_HASH.length === 64 && code.length > 0 && adminCodeHash(code) === BAKED_HASH;
}

export class AdminConsole {
  private ui: AdminUi | null = null;
  /** Console commands are available (offline code verified or a server granted access). */
  private unlocked = false;
  private localOk = false;
  private password: string | null = null;
  private sticky = { god: false, ammo: false, speed: 1, wallhack: false };
  /** Authorization of the current connection by its host. */
  private hostAuth: 'none' | 'pending' | 'ok' | 'denied' = 'none';
  private hostKind: 'online' | 'local' | null = null;
  private state: AdminState | null = null;
  private pending: Pending[] = [];
  private taps: number[] = [];
  private printedDenied = false;

  constructor(private readonly app: App) {
    const s = readStore();
    if (s && (s.local || s.pw)) {
      this.unlocked = true;
      this.localOk = s.local && BAKED_HASH.length === 64;
      this.password = s.pw;
      this.sticky = { god: s.god, ammo: s.ammo, speed: s.speed, wallhack: s.wallhack };
    }
    window.addEventListener('keydown', this.onKey, true);
    // The HUD tag follows the match lifecycle (cheap poll; no per-frame work).
    window.setInterval(() => this.refreshTag(), 500);
  }

  /** The terminal or the cheat panel is up (the App suspends gameplay input meanwhile). */
  get capturing(): boolean {
    return !!this.ui && (this.ui.consoleOpen || this.ui.panelOpen);
  }

  // ── Activation ────────────────────────────────────────────────────────────

  private getUi(): AdminUi {
    if (!this.ui) {
      this.ui = new AdminUi({
        exec: (line) => this.exec(line),
        panel: (a) => this.onPanel(a),
        visibility: () => this.onVisibility(),
        tagTap: () => this.togglePanel(),
        sfx: (s) => this.app.audio.ui(s),
        touch: () => this.app.input.device === 'touch' || document.body.classList.contains('touch-ui'),
      });
      this.ui.heading(`HALCYON FRONT · ${i18n.t('admin.console.title')}`);
    }
    return this.ui;
  }

  toggleConsole(): void {
    const ui = this.getUi();
    if (ui.consoleOpen) ui.closeConsole();
    else ui.openConsole(this.unlocked);
  }

  openConsole(): void {
    this.getUi().openConsole(this.unlocked);
  }

  togglePanel(): void {
    if (!this.unlocked) return;
    const ui = this.getUi();
    if (ui.panelOpen) ui.closePanel();
    else ui.openPanel(this.panelModel());
  }

  /** Secret touch entry: 7 quick taps on a label (Settings build label). */
  attachSecretTap(el: HTMLElement): void {
    el.addEventListener('click', () => {
      const now = performance.now();
      // A run of quick taps: each within TAP_GAP_MS of the previous one.
      if (this.taps.length && now - this.taps[this.taps.length - 1] > TAP_GAP_MS) this.taps = [];
      this.taps.push(now);
      if (this.taps.length >= TAPS_TO_OPEN) {
        this.taps = [];
        // Unlocked: straight to the touch-friendly panel (its footer opens the terminal).
        if (this.unlocked) this.getUi().openPanel(this.panelModel());
        else this.openConsole();
      }
    });
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const ui = this.ui;
    const target = e.target as HTMLElement | null;
    const inConsole = !!ui && target === ui.inputEl;
    const typingElsewhere = !inConsole && !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if ((e.code === 'Backquote' || e.code === 'F8') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.code === 'Backquote' && typingElsewhere) return; // a ` typed into a name field
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.toggleConsole();
      return;
    }
    if (e.code === 'KeyA' && e.ctrlKey && e.shiftKey && !e.altKey && this.unlocked && !typingElsewhere) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.togglePanel();
      return;
    }
    if (!ui) return;
    if (e.key === 'Escape' && (ui.consoleOpen || ui.panelOpen)) {
      e.preventDefault();
      e.stopPropagation();
      if (ui.consoleOpen) ui.closeConsole();
      else ui.closePanel();
      return;
    }
    if (inConsole) {
      // The terminal owns its keys: keep menu navigation / gameplay bindings out of it.
      e.stopPropagation();
      ui.onInputKey(e);
    }
  };

  private onVisibility(): void {
    this.app.setAdminCapture(this.capturing);
  }

  // ── Session hooks (called by the App) ────────────────────────────────────

  /** A transport session began (hello already sent): re-authorize silently. */
  onSession(kind: 'online' | 'local'): void {
    this.hostKind = kind;
    this.hostAuth = 'none';
    this.state = null;
    this.pending = [];
    if (this.unlocked) this.sendAuth(true);
    this.applyFlags();
  }

  onSessionEnd(): void {
    this.hostKind = null;
    this.hostAuth = 'none';
    this.state = null;
    this.pending = [];
    this.applyFlags();
    this.refreshPanel();
  }

  /** matchStart: re-apply the sticky toggles in the new room. */
  onMatchStart(): void {
    if (this.hostAuth === 'ok') this.applySticky();
    this.refreshPanel();
  }

  onReply(m: AdminReplyMsg): void {
    const p = this.pending.shift();
    if (m.state) this.state = m.state;
    if (p?.kind === 'auth') this.onAuthReply(m, p.silent);
    else if (p?.kind === 'cheat') this.onCheatReply(m, p);
    this.applyFlags();
    this.refreshPanel();
    this.refreshTag();
  }

  private onAuthReply(m: AdminReplyMsg, silent: boolean): void {
    if (m.ok) {
      this.hostAuth = 'ok';
      if (this.hostKind === 'online' && !this.unlocked) {
        // A server-only password (not the offline code) unlocked the console.
        this.unlocked = true;
        this.ui?.setUnlocked(true);
        this.save();
        this.out(i18n.t('admin.granted'), 'ok');
      } else if (!silent || this.hostKind === 'online') this.out(i18n.t('admin.serverGranted'), 'ok', silent && !this.ui?.consoleOpen);
      if (this.app.inMatch) this.applySticky();
      return;
    }
    this.hostAuth = 'denied';
    if (!this.unlocked) {
      this.out(m.message === 'locked' ? i18n.t('admin.locked') : i18n.t('admin.denied'), 'err');
      return;
    }
    // Unlocked by the offline code but this server says no.
    const reason = i18n.t(m.message === 'locked' ? 'admin.reason.locked' : m.message === 'disabled' ? 'admin.reason.disabled' : 'admin.reason.denied');
    if (!silent || !this.printedDenied) this.out(i18n.t('admin.serverRefused', { reason }), 'err', silent);
    this.printedDenied = true;
  }

  private onCheatReply(m: AdminReplyMsg, p: Extract<Pending, { kind: 'cheat' }>): void {
    if (m.ok && this.state) {
      this.sticky.god = this.state.god;
      this.sticky.ammo = this.state.ammo;
      this.sticky.speed = this.state.speed;
      this.save();
    }
    if (p.silent && m.ok) return;
    if (!m.ok) {
      this.out(this.reasonText(m.message, p.cheat), 'err');
      return;
    }
    const st = this.state;
    const onOff = (v: boolean) => i18n.t(v ? 'admin.on' : 'admin.off');
    switch (p.cheat) {
      case 'god':
      case 'ammo':
      case 'freezebots': {
        const v = p.cheat === 'god' ? !!st?.god : p.cheat === 'ammo' ? !!st?.ammo : !!st?.freezeBots;
        this.out(i18n.t('admin.toggled', { name: i18n.t(`admin.cheat.${p.cheat}`), state: onOff(v) }), 'ok');
        break;
      }
      case 'speed':
        this.out(i18n.t('admin.speedSet', { v: String(st?.speed ?? p.value) }), 'ok');
        break;
      case 'sunspear':
        this.out(i18n.t('admin.sunspearGiven'), 'ok');
        break;
      case 'killbots': {
        const n = Number(/killbots:(\d+)/.exec(m.message ?? '')?.[1] ?? 0);
        this.out(i18n.t('admin.killed', { n }), 'ok');
        break;
      }
      case 'teleport':
        this.out(i18n.t('admin.teleported', { where: String(p.value).toLowerCase() === 'spawn' ? i18n.t('admin.cheat.spawn') : String(p.value).toUpperCase() }), 'ok');
        break;
      case 'endmatch':
        this.out(i18n.t(p.value === true ? 'admin.endingWin' : 'admin.ending'), 'ok');
        break;
    }
  }

  private reasonText(message: string | undefined, cheat: AdminCheat): string {
    switch (message) {
      case 'no_match':
        return i18n.t('admin.noMatch');
      case 'not_alive':
        return i18n.t('admin.notAlive');
      case 'not_here':
        return i18n.t('admin.notHere');
      case 'unauthorized':
        return i18n.t('admin.notAuthorized');
      case 'bad_value':
        return i18n.t('admin.badValue', { usage: HOST_CMDS.find((c) => c.cmd === cheat)?.usage ?? cheat });
      default:
        return i18n.t('admin.error', { reason: message ?? '?' });
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  exec(line: string): void {
    const raw = line.trim();
    if (!raw) return;
    const word = raw.split(/\s+/)[0];
    const cmd = word.toLowerCase();
    const rest = raw.slice(word.length).trim();
    const args = rest ? rest.split(/\s+/) : [];
    const ui = this.getUi();
    if (cmd === 'admin') {
      ui.print(`▸ admin ${'•'.repeat(Math.min(12, rest.length))}`, 'in');
      this.auth(rest);
      return;
    }
    ui.print(`▸ ${raw}`, 'in');
    ui.remember(raw);
    if (!this.unlocked) {
      ui.print(i18n.t('admin.unknown', { cmd: word }), 'err');
      return;
    }
    const flag = (cur: boolean): boolean | null => {
      const a = (args[0] ?? '').toLowerCase();
      if (!a || a === 'toggle') return !cur;
      if (a === 'on' || a === '1' || a === 'true') return true;
      if (a === 'off' || a === '0' || a === 'false') return false;
      return null;
    };
    const bad = (usage: string) => ui.print(i18n.t('admin.badValue', { usage }), 'err');
    switch (cmd) {
      case 'help':
      case '?':
        this.help();
        return;
      case 'menu':
      case 'panel':
        ui.openPanel(this.panelModel());
        return;
      case 'clear':
      case 'cls':
        ui.clear();
        return;
      case 'exit':
      case 'close':
        ui.closeConsole();
        return;
      case 'status':
        this.status();
        return;
      case 'logout':
        this.logout();
        return;
      case 'god':
      case 'ammo':
      case 'freezebots': {
        const cur = cmd === 'god' ? this.curGod : cmd === 'ammo' ? this.curAmmo : !!this.state?.freezeBots;
        const v = flag(cur);
        if (v === null) return bad(`${cmd} [on|off]`);
        this.hostCheat(cmd, v);
        return;
      }
      case 'speed': {
        const a = (args[0] ?? '').toLowerCase();
        const v = a === 'off' || a === 'reset' ? 1 : Number(a.replace(/^x/, ''));
        if (!Number.isFinite(v) || v < 1 || v > 3) return bad('speed <1..3>');
        this.hostCheat('speed', Math.round(v * 100) / 100);
        return;
      }
      case 'sunspear':
      case 'killbots':
        this.hostCheat(cmd, undefined);
        return;
      case 'teleport':
      case 'tp': {
        const a = (args[0] ?? '').toLowerCase();
        if (a !== 'a' && a !== 'b' && a !== 'c' && a !== 'spawn') return bad('teleport <A|B|C|spawn>');
        this.hostCheat('teleport', a === 'spawn' ? 'spawn' : a.toUpperCase());
        return;
      }
      case 'endmatch': {
        const a = (args[0] ?? '').toLowerCase();
        if (a && a !== 'win') return bad('endmatch [win]');
        this.hostCheat('endmatch', a === 'win');
        return;
      }
      case 'wallhack':
      case 'wh': {
        const v = flag(this.sticky.wallhack);
        if (v === null) return bad('wallhack [on|off]');
        this.setWallhack(v);
        return;
      }
      case 'unlockall':
        this.unlockAll();
        return;
      case 'xp': {
        const n = Math.round(Number(args[0]));
        if (!Number.isFinite(n) || n < 1 || n > 1_000_000) return bad('xp <1..1000000>');
        this.addXp(n);
        return;
      }
      default:
        ui.print(i18n.t('admin.unknown', { cmd: word }), 'err');
    }
  }

  private get curGod(): boolean {
    return this.state ? this.state.god : this.sticky.god;
  }

  private get curAmmo(): boolean {
    return this.state ? this.state.ammo : this.sticky.ammo;
  }

  private help(): void {
    const ui = this.getUi();
    ui.heading(i18n.t('admin.helpTitle'));
    for (const c of HOST_CMDS) ui.helpRow(c.usage, i18n.t(c.help));
    for (const c of OTHER_CMDS) ui.helpRow(c.usage, i18n.t(c.help));
  }

  private status(): void {
    const ui = this.getUi();
    const items = this.activeItems();
    ui.print(items.length ? i18n.t('admin.status', { list: items.join(', ') }) : i18n.t('admin.statusNone'), 'sys');
    if (this.hostKind === 'local') ui.print(i18n.t('admin.session.local'), 'sys');
    else if (this.hostKind === 'online') ui.print(i18n.t('admin.session.online', { auth: i18n.t(`admin.auth.${this.hostAuth}`) }), 'sys');
    else ui.print(i18n.t('admin.session.none'), 'sys');
  }

  private auth(code: string): void {
    const localOk = checkAdminCode(code);
    if (this.hostKind === 'online') {
      // The server decides; the offline code (if it matches) still unlocks offline/client cheats.
      this.password = code;
      if (localOk) {
        this.localOk = true;
        this.unlocked = true;
        this.ui?.setUnlocked(true);
        this.save();
      }
      this.getUi().print(i18n.t('admin.verifying'), 'sys');
      this.sendAuth(false);
      return;
    }
    if (!localOk) {
      this.out(i18n.t('admin.denied'), 'err');
      return;
    }
    this.localOk = true;
    this.unlocked = true;
    this.password = code;
    this.ui?.setUnlocked(true);
    this.save();
    this.out(i18n.t('admin.granted'), 'ok');
    if (this.hostKind === 'local') this.sendAuth(true);
  }

  /** Authorizes the current connection with its host. */
  private sendAuth(silent: boolean): boolean {
    const kind = this.hostKind;
    if (!kind) return false;
    if (kind === 'local') {
      if (!this.localOk) return false;
      // The local host trusts this flag (kind 'local' only); the code itself never leaves the page.
      if (!this.app.adminSend({ type: 'admin', action: 'auth', password: '', trusted: true })) return false;
    } else {
      if (!this.password) return false;
      if (!this.app.adminSend({ type: 'admin', action: 'auth', password: this.password })) return false;
    }
    this.hostAuth = 'pending';
    this.pending.push({ kind: 'auth', silent });
    return true;
  }

  private hostCheat(cheat: AdminCheat, value: number | string | boolean | undefined, silent = false): void {
    if (!this.hostKind) {
      if (!silent) this.out(i18n.t('admin.noMatch'), 'err');
      return;
    }
    if (this.hostAuth === 'denied') {
      if (!silent) this.out(i18n.t('admin.notAuthorized'), 'err');
      return;
    }
    if (this.hostAuth === 'none' && !this.sendAuth(true)) {
      if (!silent) this.out(i18n.t('admin.notAuthorized'), 'err');
      return;
    }
    const msg = value === undefined ? ({ type: 'admin', action: 'cheat', cheat } as const) : ({ type: 'admin', action: 'cheat', cheat, value } as const);
    if (!this.app.adminSend(msg)) {
      if (!silent) this.out(i18n.t('admin.noMatch'), 'err');
      return;
    }
    this.pending.push({ kind: 'cheat', cheat, value, silent });
  }

  private applySticky(): void {
    if (this.sticky.god) this.hostCheat('god', true, true);
    if (this.sticky.ammo) this.hostCheat('ammo', true, true);
    if (this.sticky.speed > 1) this.hostCheat('speed', this.sticky.speed, true);
  }

  private setWallhack(v: boolean): void {
    this.sticky.wallhack = v;
    this.save();
    this.applyFlags();
    this.out(i18n.t('admin.toggled', { name: i18n.t('admin.cheat.wallhack'), state: i18n.t(v ? 'admin.on' : 'admin.off') }), 'ok');
    if (v && this.hostKind === 'online' && this.hostAuth !== 'ok') this.out(i18n.t('admin.notAuthorized'), 'err');
    this.refreshPanel();
    this.refreshTag();
  }

  private unlockAll(): void {
    const p = this.app.profile;
    const target = totalXpForLevel(MAX_LEVEL);
    if (p.value.xp < target) p.update({ xp: target });
    void p.pushProfile();
    this.out(i18n.t('admin.unlocked', { level: p.value.level }), 'ok');
  }

  private addXp(n: number): void {
    const p = this.app.profile;
    p.update({ xp: p.value.xp + n });
    void p.pushProfile();
    this.out(i18n.t('admin.xpAdded', { n, level: p.value.level }), 'ok');
  }

  private logout(): void {
    this.unlocked = false;
    this.localOk = false;
    this.password = null;
    this.sticky = { god: false, ammo: false, speed: 1, wallhack: false };
    this.hostAuth = 'none';
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    this.applyFlags();
    this.ui?.setUnlocked(false);
    this.ui?.closePanel();
    this.out(i18n.t('admin.loggedOut'), 'sys');
    this.refreshTag();
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  private onPanel(a: PanelAction): void {
    switch (a.a) {
      case 'god':
      case 'ammo':
      case 'freezebots':
        this.hostCheat(a.a, a.on);
        break;
      case 'wallhack':
        this.setWallhack(a.on);
        break;
      case 'speed':
        this.hostCheat('speed', a.v);
        break;
      case 'sunspear':
      case 'killbots':
        this.hostCheat(a.a, undefined);
        break;
      case 'teleport':
        this.hostCheat('teleport', a.where);
        break;
      case 'endmatch':
        this.hostCheat('endmatch', a.win);
        break;
      case 'unlockall':
        this.unlockAll();
        break;
      case 'xp':
        this.addXp(1000);
        break;
      case 'console':
        this.getUi().closePanel();
        this.openConsole();
        break;
    }
  }

  private panelModel(): PanelModel {
    const map = this.app.currentMatchMap;
    let zones: string[] = ['A', 'B', 'C'];
    try {
      if (map) zones = getMap(map).zones.map((z) => z.id);
    } catch {
      /* keep defaults */
    }
    return {
      source: this.hostKind ?? 'none',
      hostOk: this.hostAuth === 'ok',
      inMatch: this.app.inMatch,
      god: this.curGod,
      ammo: this.curAmmo,
      speed: this.state ? this.state.speed : this.sticky.speed,
      freezeBots: !!this.state?.freezeBots,
      wallhack: this.sticky.wallhack,
      zones,
    };
  }

  private refreshPanel(): void {
    if (this.ui?.panelOpen) this.ui.renderPanel(this.panelModel());
  }

  // ── Flags, tag, persistence ───────────────────────────────────────────────

  private hostTrusted(): boolean {
    return this.hostKind === 'local' ? this.localOk : this.hostAuth === 'ok';
  }

  /** Client-side wallhack never helps in an online match the server did not authorize. */
  private applyFlags(): void {
    adminFlags.wallhack = this.unlocked && this.sticky.wallhack && this.hostKind !== null && this.hostTrusted();
  }

  private activeItems(): string[] {
    const items: string[] = [];
    const st = this.state;
    if (st?.god) items.push(i18n.t('admin.cheat.god'));
    if (st?.ammo) items.push(i18n.t('admin.cheat.ammo'));
    if (st && st.speed > 1) items.push(`${i18n.t('admin.cheat.speed')} ×${st.speed}`);
    if (st?.freezeBots) items.push(i18n.t('admin.cheat.freezebots'));
    if (adminFlags.wallhack) items.push(i18n.t('admin.cheat.wallhack'));
    return items;
  }

  private refreshTag(): void {
    if (!this.ui && !this.unlocked) return;
    // Only over live gameplay (not under the pause menu / settings overlays).
    const inMatch = this.app.inMatch && this.app.ui.current === 'match';
    const items = inMatch ? this.activeItems() : [];
    const touch = this.app.input.device === 'touch';
    // Touch players have no Ctrl+Shift+A: once authorized in a match, the tag is their panel button.
    const visible = inMatch && (items.length > 0 || (touch && this.unlocked && this.hostTrusted()));
    if (!visible && !this.ui) return;
    // Follow the HUD's health panel (read twice a second, never per frame).
    const health = visible ? document.querySelector<HTMLElement>('.hud-health') : null;
    this.getUi().setTag(visible, items, health ? health.getBoundingClientRect() : null, touch);
  }

  private out(text: string, kind: 'ok' | 'err' | 'sys', quiet = false): void {
    if (quiet && !this.ui) return;
    this.getUi().print(text, kind);
  }

  private save(): void {
    try {
      const s: Saved = { pw: this.password, local: this.localOk, ...this.sticky };
      sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch {
      /* private mode: auth lasts for this page only */
    }
  }
}

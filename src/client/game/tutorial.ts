// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — the 60-second interactive tutorial (Training Range).
//
// Lazy-loaded by ClientMatch when GameConfig.tutorial is set; default export
// (api: MatchApi) => MatchExtension. Teaches by doing, one verb at a time:
//   look → move → sprint → jump the gap → mantle → slide → shoot 3 targets →
//   ADS + 50 m target → reload → throw at the cluster → capture the pad.
// The pure step machine (tutorial/steps.ts) decides completion from the
// predicted local state + host events; this module feeds it and presents it:
// world beacons (tutorial/beacons.ts), the prompt card / progress / skip /
// summary (tutorial/ui.ts) with the right glyphs per device
// (tutorial/glyphs.ts), completion ticks (sound + check + haptic), hints
// after 12 s, an off-screen arrow to the next goal.
// Setup: fresh range (reset), normal target speed, Meridian + grenade (a
// predictable teaching kit; the player's own loadout is restored after).
// Finish: announcer "training_complete", summary card, profile.seenTutorial,
// "Play now" (quick play TDM) / "Keep practicing". Skip: chip (tap/click),
// Esc when the cursor is free, or hold ⧉ (View) on a gamepad.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { profile } from '../state/profile';
import { RANGE_COURSE, type CourseRegion } from '../../shared/maps/range';
import { eyeHeight } from '../../shared/movement';
import type { GameEvent, Vec3 } from '../../shared/types';
import { PRIMARY_WEAPON_IDS } from '../../shared/types';
import type { MatchApi, MatchExtension } from './extensions';
import { Beacons, type BeaconSpec } from './tutorial/beacons';
import { skipGlyph, stepGlyphs } from './tutorial/glyphs';
import { STEP_ORDER, TutorialMachine, type StepId } from './tutorial/steps';
import { TutorialUI } from './tutorial/ui';

const C = RANGE_COURSE;
/** Seconds the gamepad View button must be held to skip. */
const SKIP_HOLD = 0.8;
/** Grace before movement dismisses the summary card ("keep practicing"). */
const SUMMARY_GRACE = 1.6;
/** Body class while the tutorial runs (the range stats panel hides itself). */
export const TUTORIAL_BODY_CLASS = 'hf-tutorial-active';

function center(r: CourseRegion, y = 0): Vec3 {
  return { x: (r.minX + r.maxX) / 2, y, z: (r.minZ + r.maxZ) / 2 };
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

class Tutorial implements MatchExtension {
  private readonly m = new TutorialMachine(C);
  private readonly ui: TutorialUI;
  private beacons: Beacons | null = null;
  private started = false;
  private ended = false;
  private shownStep: StepId | null = null;
  private promptSig = '';
  private subSig = '';
  private hintShown = false;
  private reloading = false;
  private skipHold = 0;
  private chipDevice = '';
  private summaryT = 0;
  private readonly ownThrows = new Set<number>();
  private readonly offs: (() => void)[] = [];
  private readonly v = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(private readonly api: MatchApi) {
    this.ui = new TutorialUI(STEP_ORDER, () => this.skip());
    this.ui.setProgress([], 0);
    document.body.classList.add(TUTORIAL_BODY_CLASS);
    // A predictable teaching setup: fresh range, normal speed, Meridian + grenade.
    api.resetRange();
    api.setRangeSpeed(1);
    api.setRangeWeapon(0);
    api.setRangeThrowable(0);
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey, true);
    this.offs.push(() => window.removeEventListener('keydown', onKey, true));
    this.offs.push(api.i18n.onChange(() => this.refreshTexts()));
    this.refreshTexts();
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.api.i18n.t(key, params);
  }

  // ── Input hooks ──────────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    if (this.ended && this.ui.summaryOpen) {
      if (e.key === 'Enter' && !e.repeat) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.playNow();
      }
      return;
    }
    if (this.ended || e.key !== 'Escape' || e.repeat) return;
    // Esc skips while the cursor is free and the game is not paused (a captured
    // cursor makes Esc open the pause menu, where the skip chip is highlighted).
    if (!document.pointerLockElement && this.api.controllable) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.skip();
    }
  }

  // ── Extension hooks ──────────────────────────────────────────────────────

  onEvent(ev: GameEvent): void {
    if (this.ended) return;
    const me = this.api.localId;
    switch (ev.t) {
      case 'target':
        this.m.event({ kind: 'target', id: ev.id, kill: ev.kill, thrown: ev.w === 'grenade' });
        break;
      case 'throw':
        if (ev.p === me) this.ownThrows.add(ev.id);
        break;
      case 'explode':
      case 'smoke':
        if (this.ownThrows.delete(ev.id)) this.m.event({ kind: 'throwLanded', pos: ev.pos });
        break;
      case 'zone':
        if (ev.ev === 'captured' && ev.team === 0) this.m.event({ kind: 'captured' });
        break;
      default:
        break;
    }
  }

  onTick(dt: number): void {
    const api = this.api;
    if (this.ended) {
      this.tickSummary(dt);
      return;
    }
    if (!this.beacons && api.scene) this.beacons = new Beacons(api.scene);
    const playing = api.controllable;
    this.ui.setPaused(this.started && !playing && api.alive);
    if (!this.started) {
      if (!playing) return;
      this.started = true;
      this.showStep(this.m.current);
    }
    this.tickSkipHold(dt);
    if (this.ended) return;
    if (playing) this.observe(dt);
    if (this.ended) return;
    this.present(dt);
  }

  private observe(dt: number): void {
    const api = this.api;
    const mv = api.move;
    const c = api.combat;
    // Reload: an actual reload or the button (a full magazine can't reload — never block on it).
    const rl = !!c && c.reloadT > 0;
    if ((rl && !this.reloading) || api.input.pressed('reload')) this.m.event({ kind: 'reload' });
    this.reloading = rl;
    const zone = api.zones.find((z) => z.id === C.padZone);
    const upd = this.m.observe({
      dt,
      alive: api.alive && !!mv,
      pos: mv ? mv.pos : C.spawn,
      eye: mv ? { x: mv.pos.x, y: mv.pos.y + eyeHeight(mv), z: mv.pos.z } : C.spawn,
      yaw: api.yaw,
      pitch: api.pitch,
      sprinting: !!mv?.sprint,
      sliding: (mv?.slideT ?? 0) > 0,
      mantling: (mv?.mantleT ?? 0) > 0,
      ads: c?.adsT ?? 0,
      padProgress: zone ? Math.max(0, Math.min(1, -zone.progress)) : 0,
      padOwned: zone?.owner === 0,
    });
    if (upd.completed) this.onCompleted(upd.completed);
    if (upd.started) this.showStep(upd.started);
    if (upd.finished) this.finish(false);
  }

  private onCompleted(id: StepId): void {
    this.api.audio.ui('confirm');
    this.api.input.haptic('light');
    this.ui.done();
    this.hintShown = false;
    for (const k of this.beaconKeys(id)) this.beacons?.complete(k);
    this.ui.setProgress(
      this.m.steps.map((s) => s.done),
      this.m.index,
    );
  }

  private showStep(id: StepId | null): void {
    this.shownStep = id;
    this.promptSig = '';
    this.subSig = '';
    this.hintShown = false;
    this.ui.setHint(null);
    this.ui.setProgress(
      this.m.steps.map((s) => s.done),
      this.m.index,
    );
    if (!id) return;
    this.renderPrompt();
    this.beacons?.set(this.beaconSpecs(id));
  }

  private renderPrompt(): void {
    const id = this.shownStep;
    if (!id) return;
    const device = this.api.device;
    const sig = `${id}|${device}|${this.api.i18n.lang}`;
    if (sig === this.promptSig) return;
    this.promptSig = sig;
    const g = stepGlyphs(id, device, (a) => this.api.keyLabel(a), (k) => this.t(k));
    this.ui.prompt(this.t(`tutorial.${id}`), g.tokens);
    this.ui.highlightTouch(g.touch);
    if (this.hintShown) this.ui.setHint(this.t(`tutorial.hint.${id}`));
  }

  private refreshTexts(): void {
    this.promptSig = '';
    this.renderPrompt();
    this.ui.setBarLabel(this.t('tutorial.progress'));
    this.ui.setSkipLabelAria(this.t('tutorial.skip'));
    this.updateSkipChip();
  }

  private updateSkipChip(): void {
    const device = this.api.device;
    const hold = device === 'gamepad';
    this.ui.setSkip(hold && this.skipHold > 0 ? this.t('tutorial.skipHold') : this.t('tutorial.skip'), skipGlyph(device), hold ? this.skipHold / SKIP_HOLD : 0);
  }

  private tickSkipHold(dt: number): void {
    const api = this.api;
    const holding = api.device === 'gamepad' && api.input.down('scoreboard');
    const prev = this.skipHold;
    this.skipHold = holding ? this.skipHold + dt : 0;
    if (this.skipHold >= SKIP_HOLD) {
      this.skip();
      return;
    }
    if (prev !== this.skipHold || holding || api.device !== this.chipDevice) {
      this.chipDevice = api.device;
      this.updateSkipChip();
    }
  }

  /** Per-frame presentation: glyph device changes, sub-progress, hints, beacons, arrow. */
  private present(dt: number): void {
    const api = this.api;
    const id = this.m.current;
    if (!id || this.m.hold > 0) {
      this.beacons?.update(dt, api.camera);
      this.ui.setArrow(null);
      return;
    }
    this.renderPrompt();
    // Sub-progress (look beacons, trio) with a soft tick per step forward.
    const sub = this.m.sub();
    const sig = sub ? `${sub.n}` : '';
    if (sig !== this.subSig) {
      if (this.subSig !== '' && sub && sub.n > 0) {
        this.api.audio.ui('xpTick');
        if (id === 'look') this.beacons?.complete(`look${this.m.beaconsSeen[0] && !this.m.beaconsSeen[1] ? 0 : 1}`);
      }
      this.subSig = sig;
    }
    this.ui.setDots(sub);
    if (id === 'look') for (let i = 0; i < 2; i++) if (this.m.beaconsSeen[i]) this.beacons?.complete(`look${i}`);
    if (id === 'shoot') {
      for (const tid of C.trio) if (this.m.trioDown.has(tid)) this.beacons?.complete(`t${tid}`);
      this.followTargets();
    }
    if (id === 'ads') this.followTargets();
    if (id === 'capture') {
      this.ui.setPercent(this.m.padProgress > 0.01 ? this.m.padProgress : null);
      this.beacons?.setFill('pad', this.m.padProgress);
    }
    // Gentle hint when stuck.
    if (this.m.hint && !this.hintShown) {
      this.hintShown = true;
      this.ui.setHint(this.t(`tutorial.hint.${id}`));
    }
    if (this.beacons) {
      this.beacons.hint = this.m.hint ? Math.min(1, this.beacons.hint + dt * 2) : Math.max(0, this.beacons.hint - dt * 2);
      this.beacons.update(dt, api.camera);
    }
    this.updateArrow();
  }

  /** Keeps target beacons above the (strafing / respawning) targets. */
  private followTargets(): void {
    const ids = this.m.current === 'ads' ? [C.long] : C.trio;
    for (const tid of ids) {
      const t = this.api.targets.find((x) => x.id === tid);
      if (!t) continue;
      this.tmp.x = t.x;
      this.tmp.y = t.y + 2.25;
      this.tmp.z = t.z;
      this.beacons?.move(`t${tid}`, this.tmp);
    }
  }

  private beaconKeys(id: StepId): string[] {
    switch (id) {
      case 'look':
        return ['look0', 'look1'];
      case 'shoot':
        return [...C.trio.map((t) => `t${t}`), 'perch'];
      case 'ads':
        return [`t${C.long}`];
      case 'reload':
        return [];
      default:
        return [id === 'capture' ? 'pad' : id === 'throw' ? 'pit' : id];
    }
  }

  private beaconSpecs(id: StepId): BeaconSpec[] {
    const tpos = (tid: number, up: number): Vec3 => {
      const def = this.api.def.targets?.find((t) => t.id === tid);
      return def ? { x: def.pos.x, y: def.pos.y + up, z: def.pos.z } : { x: 0, y: 0, z: 0 };
    };
    switch (id) {
      case 'look':
        return [
          { key: 'look0', pos: C.lookBeacons[0], kind: 'sight' },
          { key: 'look1', pos: C.lookBeacons[1], kind: 'sight' },
        ];
      case 'move':
        return [{ key: 'move', pos: C.entry, kind: 'column', radius: 0.8, height: 3.4 }];
      case 'sprint':
        return [{ key: 'sprint', pos: { x: 12, y: 0, z: -12.6 }, kind: 'column', radius: 0.8, height: 3.4 }];
      case 'jump':
        return [{ key: 'jump', pos: center(C.jumpEnd, 1), kind: 'column', radius: 0.8, height: 3.2 }];
      case 'mantle':
        return [{ key: 'mantle', pos: { x: 12, y: 0, z: -32.6 }, kind: 'column', radius: 0.8, height: 3.2 }];
      case 'slide':
        return [{ key: 'slide', pos: center(C.slideEnd, 0), kind: 'column', radius: 0.8, height: 3.0 }];
      case 'shoot': {
        const out: BeaconSpec[] = C.trio.filter((t) => !this.m.trioDown.has(t)).map((t) => ({ key: `t${t}`, pos: tpos(t, 2.25), kind: 'sight' as const }));
        const mv = this.api.move;
        if (!mv || mv.pos.y < C.perch.y - 0.5) out.push({ key: 'perch', pos: C.perch, kind: 'column', radius: 0.8, height: 3 });
        return out;
      }
      case 'ads':
        return [{ key: `t${C.long}`, pos: tpos(C.long, 2.25), kind: 'sight' }];
      case 'reload':
        return [];
      case 'throw':
        return [{ key: 'pit', pos: C.trioCenter, kind: 'ring', radius: 3 }];
      case 'capture':
        // The pad already has its own objective ring + beam: a floating marker is enough.
        return [{ key: 'pad', pos: { x: C.pad.x, y: C.pad.y + 3.4, z: C.pad.z }, kind: 'sight' }];
    }
  }

  /** Edge arrow toward the current beacon when it is off-screen. */
  private updateArrow(): void {
    const spec = this.beacons?.primary();
    const cam = this.api.camera;
    if (!spec || this.m.current === 'reload') {
      this.ui.setArrow(null);
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const y = spec.kind === 'column' ? spec.pos.y + 1.6 : spec.pos.y;
    cam.getWorldDirection(this.fwd);
    const behind = (spec.pos.x - cam.position.x) * this.fwd.x + (y - cam.position.y) * this.fwd.y + (spec.pos.z - cam.position.z) * this.fwd.z < 0;
    const p = this.v.set(spec.pos.x, y, spec.pos.z).project(cam);
    let nx = p.x;
    let ny = p.y;
    if (behind) {
      nx = -nx;
      ny = -ny;
      if (Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) ny = -1;
    }
    const off = behind || Math.abs(nx) > 0.92 || Math.abs(ny) > 0.88;
    if (!off) {
      this.ui.setArrow(null);
      return;
    }
    const k = Math.max(Math.abs(nx) / 0.88, Math.abs(ny) / 0.8, 1e-3);
    nx /= k;
    ny /= k;
    const sx = ((nx + 1) / 2) * w;
    const sy = ((1 - ny) / 2) * h;
    const angle = Math.atan2(nx, ny);
    const mv = this.api.move;
    const dist = mv ? Math.hypot(spec.pos.x - mv.pos.x, spec.pos.z - mv.pos.z) : 0;
    // Standing on it (pad, ring): no arrow.
    if (dist < (spec.radius ?? 0.6) + 1.2) {
      this.ui.setArrow(null);
      return;
    }
    this.ui.setArrow({ x: sx, y: sy, angle, dist });
  }

  // ── End states ───────────────────────────────────────────────────────────

  private skip(): void {
    if (this.ended) return;
    this.m.skip();
    this.finish(true);
  }

  private finish(skipped: boolean): void {
    if (this.ended) return;
    this.ended = true;
    const api = this.api;
    this.beacons?.clear();
    this.ui.setArrow(null);
    this.ui.highlightTouch(null);
    const best = profile.value.rangeBest;
    const patch: Parameters<typeof profile.update>[0] = { seenTutorial: true };
    let pb = false;
    if (!skipped) {
      const secs = Math.round(this.m.elapsed * 10) / 10;
      pb = !best?.tutorial || secs < best.tutorial;
      if (pb) patch.rangeBest = { ...(best ?? { score: 0, accuracy: 0, headshots: 0 }), tutorial: secs };
    }
    try {
      profile.update(patch);
    } catch (err) {
      console.warn('[tutorial] profile update failed', err);
    }
    if (skipped) {
      api.hud.toast(this.t('tutorial.skipped'));
      this.release();
      return;
    }
    api.announcer.say('training_complete');
    api.audio.ui('levelUp');
    api.input.haptic('kill');
    const s = api.rangeSummary();
    const device = api.device;
    this.ui.showSummary(
      this.t('tutorial.done.title'),
      this.t('tutorial.done.sub'),
      {
        time: this.t('tutorial.done.time'),
        accuracy: this.t('tutorial.done.accuracy'),
        targets: this.t('tutorial.done.targets'),
        best: this.t('tutorial.done.best'),
        play: this.t('tutorial.done.play'),
        practice: this.t('tutorial.done.practice'),
      },
      {
        time: fmtTime(this.m.elapsed),
        accuracy: s.shots ? `${Math.round(s.accuracy * 100)}%` : '—',
        targets: String(s.kills),
        best: pb && !!best?.tutorial,
        playKey: device === 'kbm' ? 'Enter' : device === 'gamepad' ? 'RB' : '',
      },
      () => this.playNow(),
      () => this.keepPracticing(),
    );
    this.summaryT = 0;
  }

  private tickSummary(dt: number): void {
    if (!this.ui.summaryOpen) return;
    this.summaryT += dt;
    const api = this.api;
    if (api.device === 'gamepad' && api.input.pressed('interact')) {
      this.playNow();
      return;
    }
    if (this.summaryT > SUMMARY_GRACE && api.controllable) {
      const mv = api.move;
      const moving = !!mv && Math.hypot(mv.vel.x, mv.vel.z) > 1.5;
      if (moving || api.input.pressed('fire')) this.keepPracticing();
    }
  }

  private playNow(): void {
    this.ui.hideSummary();
    this.api.exit('quickplay');
  }

  private keepPracticing(): void {
    if (!this.ui.summaryOpen) return;
    this.ui.hideSummary();
    this.release();
  }

  /** Hands the range back: the player's own loadout, the stats panel, no tutorial UI. */
  private release(): void {
    const lo = profile.value.loadout;
    const wi = PRIMARY_WEAPON_IDS.indexOf(lo.primary);
    if (wi > 0) this.api.setRangeWeapon(wi);
    if (lo.throwable === 'smoke') this.api.setRangeThrowable(1);
    document.body.classList.remove(TUTORIAL_BODY_CLASS);
    window.setTimeout(() => this.teardownVisuals(), 900);
  }

  private teardownVisuals(): void {
    this.ui.dispose();
    this.beacons?.dispose();
    this.beacons = null;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    document.body.classList.remove(TUTORIAL_BODY_CLASS);
    this.teardownVisuals();
  }

  /** Debug / e2e view of the machine. */
  debug(): Record<string, unknown> {
    return {
      step: this.m.current,
      index: this.m.index,
      elapsed: Math.round(this.m.elapsed * 10) / 10,
      finished: this.m.finished,
      skipped: this.m.skipped,
      started: this.started,
      trioDown: [...this.m.trioDown],
      steps: this.m.steps.map((s) => ({ id: s.id, done: s.done, t: Math.round(s.time * 10) / 10, assisted: s.assisted })),
    };
  }
}

export default function createTutorial(api: MatchApi): MatchExtension {
  const t = new Tutorial(api);
  // e2e / debug: window.__HF_TUTORIAL() → machine state (only with ?debug=1).
  if (typeof location !== 'undefined' && /[?&]debug=1/.test(location.search)) (window as unknown as { __HF_TUTORIAL?: () => unknown }).__HF_TUTORIAL = () => t.debug();
  return t;
}

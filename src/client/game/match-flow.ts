// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — match flow: the "director's notes" of a match.
//
//  • Intro: fly-in + mode/map banner + match music when the match screen
//    first appears; countdown ticks; "Engage" + go sound at live.
//  • Final minute: banner + intense music layer (from the announce event or
//    the clock, whichever comes first).
//  • Lead taken / lost callouts derived from team scores (debounced).
//  • End: victory / defeat stinger + banner (MVP or launching team), then the
//    outro camera — Launch Control winners launch the last rocket
//    (MapRuntimeState.rocketLaunch), other modes orbit the MVP / final kill.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { UI } from '../engine/palette';
import type { ScoreboardRow } from '../../shared/protocol';
import { clamp } from '../../shared/math';
import type { AnnouncerKey, MatchPhase, Team } from '../../shared/types';
import type { MatchContext } from './context';
import type { CameraDirector } from './deathcam';
import type { HudBridge } from './hud-bridge';
import type { MatchOverlays } from './overlays';

export class MatchFlow {
  /** Launch Control finale: launching team + seconds since liftoff. */
  rocket: { team: Team; t: number } | null = null;
  started = false;
  outroStarted = false;
  lastKillPos: THREE.Vector3 | null = null;
  private rows: ScoreboardRow[] = [];
  private finalMusic = false;
  private lastCountdown = -1;
  private lastLeader = 0;
  private lastLeadCall = -1e9;

  constructor(
    private readonly ctx: MatchContext,
    private readonly director: CameraDirector,
    private readonly hudBridge: HudBridge,
    private readonly overlays: () => MatchOverlays | null,
  ) {}

  private t(key: string, params?: Record<string, string | number>): string {
    return this.ctx.app.i18n.t(key, params);
  }

  onScoreboard(rows: ScoreboardRow[]): void {
    this.rows = rows;
  }

  /** Match screen became visible: fly in. */
  startIntro(phaseLeft: number): void {
    this.started = true;
    const ctx = this.ctx;
    const view = ctx.view;
    if (!view) return;
    const range = ctx.config.mode === 'range';
    const dur = ctx.clock.phase === 'countdown' ? clamp(phaseLeft + 0.3, 1.3, 3.2) : range ? 1.1 : 1.4;
    this.director.startIntro(view.map.showcase('intro'), dur);
    this.overlays()?.setCinematic(true);
    const title = range ? this.t('match.range.welcome') : this.hudBridge.modeName();
    const sub = range ? this.t('match.range.hint') : this.t(ctx.def.nameKey);
    ctx.app.hud.banner(title, sub, UI.accent);
    ctx.app.audio.setMusic('match');
  }

  onPhase(phase: MatchPhase): void {
    const ctx = this.ctx;
    if (phase === 'live' && ctx.config.mode !== 'range') {
      ctx.app.hud.banner(this.t('hud.go'), this.hudBridge.modeName(), UI.accent);
      ctx.app.audio.ui('go');
      this.director.hurryIntro(0.6);
    } else if (phase === 'ended') this.beginOutro();
  }

  onAnnounce(key: AnnouncerKey): void {
    const hud = this.ctx.app.hud;
    if (key === 'final_minute') {
      hud.banner(this.t('hud.finalMinute'), undefined, UI.danger);
      this.setFinalMusic();
    } else if (key === 'victory' || key === 'defeat' || key === 'draw') {
      if (key !== 'draw') this.ctx.app.audio.setMusic(key);
      const color = key === 'victory' ? UI.good : key === 'defeat' ? UI.danger : UI.text;
      const mvp = this.mvpName();
      let sub = mvp ? this.t('match.mvp', { name: mvp }) : undefined;
      if (this.rocket) sub = this.t('match.launch', { team: this.t(`common.team.${this.rocket.team}`) });
      hud.banner(this.t(`results.${key}`), sub, color);
    }
  }

  private setFinalMusic(): void {
    if (this.finalMusic || this.ctx.clock.phase !== 'live') return;
    this.finalMusic = true;
    this.ctx.app.audio.setMusic('final');
  }

  /** Per frame: countdown ticks, final-minute music, rocket clock. */
  frame(dt: number, phaseLeft: number): void {
    const ctx = this.ctx;
    const phase = ctx.clock.phase;
    if (this.started && phase === 'countdown') {
      const sec = Math.ceil(phaseLeft);
      if (sec !== this.lastCountdown && sec >= 1 && sec <= 3) ctx.app.audio.ui('countdown');
      this.lastCountdown = sec;
    }
    if (phase === 'live' && ctx.config.timeLimit > 90 && phaseLeft <= 60 && ctx.config.mode !== 'range') this.setFinalMusic();
    if (this.rocket) this.rocket.t += dt;
  }

  /** Lead taken / lost callouts derived from team scores. */
  checkLead(): void {
    const ctx = this.ctx;
    const mode = ctx.config.mode;
    if ((mode !== 'tdm' && mode !== 'control') || ctx.clock.phase !== 'live') return;
    const zt = ctx.localTeam === 1 ? 1 : 0;
    const mine = ctx.clock.teamScores[zt];
    const theirs = ctx.clock.teamScores[zt === 0 ? 1 : 0];
    const leader = Math.sign(mine - theirs);
    if (leader === 0 || leader === this.lastLeader) return;
    const now = performance.now();
    if (mine + theirs >= (mode === 'tdm' ? 4 : 30) && now - this.lastLeadCall > 12000) {
      if (leader > 0) ctx.app.announcer.say('lead_taken');
      else if (this.lastLeader > 0) ctx.app.announcer.say('lead_lost');
      this.lastLeadCall = now;
    }
    this.lastLeader = leader;
  }

  noteKill(pos: THREE.Vector3): void {
    this.lastKillPos = (this.lastKillPos ?? new THREE.Vector3()).copy(pos);
  }

  beginOutro(): void {
    const ctx = this.ctx;
    if (this.outroStarted || !ctx.view || ctx.config.mode === 'range') return;
    this.outroStarted = true;
    const s = ctx.clock.teamScores;
    const winner: Team = ctx.config.mode === 'ffa' || s[0] === s[1] ? 2 : s[0] > s[1] ? 0 : 1;
    ctx.app.hud.scoreboard(false, [], ctx.config.mode);
    if (ctx.config.mode === 'control' && winner !== 2) {
      this.rocket = { team: winner, t: 0 };
      this.director.startOutro(ctx.camera, 'rocket', ctx.view.map.showcase('outro'), null);
    } else {
      this.director.startOutro(ctx.camera, 'orbit', null, this.outroCenter(new THREE.Vector3()));
    }
    this.overlays()?.setCinematic(true);
  }

  private mvpId(): number {
    let best = -1;
    let score = -Infinity;
    for (const r of this.rows) {
      if (r.score > score) {
        score = r.score;
        best = r.id;
      }
    }
    return best;
  }

  private mvpName(): string {
    return this.ctx.players.get(this.mvpId())?.name ?? '';
  }

  /** Outro orbit center: the MVP if alive, else the final elimination, else us. */
  outroCenter(out: THREE.Vector3): THREE.Vector3 {
    const ctx = this.ctx;
    const remotes = ctx.view?.remotes;
    const mvp = this.mvpId();
    const e = mvp >= 0 ? remotes?.get(mvp) : undefined;
    if (remotes) remotes.showLocal = mvp === ctx.localId;
    if (e && e.alive) return out.copy(e.pos);
    if (this.lastKillPos) return out.copy(this.lastKillPos);
    const m = ctx.predictor.move;
    return m ? out.set(m.pos.x, m.pos.y, m.pos.z) : out.copy(ctx.camPos);
  }
}

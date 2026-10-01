// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — feedback: turns predicted local actions and host events into
// what the player sees, hears and feels.
//
// Predicted (instant, local): shots (tracePellet for tracer end points against
// the world, interpolated enemies and range targets → muzzle flash, tracer or
// Sunspear beam, impacts, viewmodel kick, shot sound, camera kick), dry fire,
// reload (viewmodel + staged sounds timed from reloadDuration; Breaker shells
// as they load), swap, charge, pump/bolt cycle, throw, landing dip/sound/dust,
// footsteps per stride, jump, slide, mantle.
//
// Host events: split in two.
//  • Immediate (authoritative info, ASAP): hit markers, damage direction,
//    kill feed + elimination toasts, pickups, zones, announcer, range targets.
//  • World (queued to the render tick so they line up with the interpolated
//    characters ~100 ms in the past): other players' shots (muzzle flash,
//    tracers, impacts, 3D sound, bullet whizz), their reload/charge cues,
//    explosions, smoke, bounces, respawn flashes, elimination dissolves.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { UI, DANGER_COLOR, PICKUP_COLOR, teamColors } from '../engine/palette';
import { activeSlot, hitboxes, type CombatStepResult, type Hitboxes, type ShotRequest } from '../../shared/combat';
import { STRIDE_LENGTH } from '../../shared/constants';
import { wrapAngle } from '../../shared/math';
import { SCORE_ASSIST, SCORE_CAPTURE, SCORE_HEADSHOT, SCORE_KILL } from '../../shared/sim/player';
import { tracePellet } from '../../shared/sim/hitscan';
import type { GameEvent, SurfaceTag, Team, Vec3, WeaponId } from '../../shared/types';
import { WEAPONS } from '../../shared/weapons';
import type { MatchContext } from './context';
import type { HudBridge } from './hud-bridge';
import type { RangePanel } from './range-stats';

/** Movement/combat marks captured before a live predicted step. */
export interface StepMarks {
  onGround: boolean;
  mantleT: number;
  slideT: number;
  stride: number;
  mag: number;
  weapon: WeaponId;
}

type WorldEvent = { tick: number; at: number; ev: GameEvent };

const MAX_QUEUE = 256;
/** World events never wait longer than this (ms) even if the clock stalls. */
const MAX_WAIT_MS = 600;

export class Feedback {
  private readonly queue: WorldEvent[] = [];
  private readonly hb: Hitboxes[] = [];
  private readonly muzzle = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly nrm = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly posV: Vec3 = { x: 0, y: 0, z: 0 };
  /** Local shots fired (predicted) — diagnostics / e2e. */
  shotsFired = 0;
  hitsConfirmed = 0;
  /** Pellets our own prediction saw hitting a player/target (diagnostics). */
  predictedHits = 0;
  kills = 0;

  constructor(
    private readonly m: MatchContext,
    private readonly hudBridge: HudBridge,
    private readonly range: RangePanel | null,
  ) {}

  private get me(): number {
    return this.m.localId;
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.m.app.i18n.t(key, params);
  }

  // ═══ Predicted local feedback ═══════════════════════════════════════════

  /** After a LIVE predicted step (never for replays). */
  localStep(r: CombatStepResult, before: StepMarks): void {
    const v = this.m.view;
    const p = this.m.predictor;
    const c = p.combat;
    const mv = p.move;
    if (!v || !c || !mv) return;
    const audio = this.m.app.audio;
    const slot = activeSlot(c);

    if (r.shot) this.localShot(r.shot);
    if (r.dryFire) {
      v.vm.dryFire();
      audio.dryFire(slot.id);
    }
    if (r.swappedTo) {
      this.m.scheduler.cancel('local-reload');
      const me = this.m.players.get(this.me);
      v.vm.setWeapon(r.swappedTo, me?.cosmetics.skins[r.swappedTo] ?? 'factory');
      audio.swap(r.swappedTo);
    }
    if (r.reloadStarted) this.localReload(r.reloadEmpty, c.reloadT);
    if (r.chargeStarted) audio.charge();
    if (r.cycled) audio.pump(slot.id);
    if (r.throwRequested) {
      const me = this.m.players.get(this.me);
      v.vm.throwStart(me?.loadout.throwable ?? 'grenade');
    }
    // Breaker shells as they seat.
    if (slot.id === 'breaker' && before.weapon === 'breaker' && slot.mag > before.mag && !r.shot) {
      for (let i = before.mag; i < slot.mag; i++) audio.reload('breaker', 'shell');
    }

    // ── Movement ──
    if (mv.landImpact > 0) {
      v.feel.land(mv.landImpact);
      audio.land(mv.ground, mv.landImpact);
      if (mv.landImpact > 6.5) v.effects.dust(this.feet(), Math.min(1, mv.landImpact / 14), mv.ground);
    }
    if (before.onGround && !mv.onGround && mv.mantleT <= 0 && mv.vel.y > 4) audio.jump();
    if (before.mantleT <= 0 && mv.mantleT > 0) audio.mantle();
    if (before.slideT <= 0 && mv.slideT > 0) {
      audio.slide(mv.ground);
      v.effects.dust(this.feet(), 0.7, mv.ground);
    }
    if (mv.onGround && mv.slideT <= 0 && Math.floor(mv.stride / STRIDE_LENGTH) !== Math.floor(before.stride / STRIDE_LENGTH)) {
      audio.footstep(mv.ground, undefined, mv.sprint ? 'sprint' : mv.crouchT > 0.5 ? 'crouch' : 'walk');
    }
  }

  /** Per frame: cancel reload sounds that no longer apply. */
  frame(): void {
    const c = this.m.predictor.combat;
    if ((!c || c.reloadT <= 0 || !this.m.predictor.alive) && this.m.scheduler.has('local-reload')) this.m.scheduler.cancel('local-reload');
  }

  private feet(): THREE.Vector3 {
    const mv = this.m.predictor.move;
    return this.tmp.set(mv?.pos.x ?? 0, mv?.pos.y ?? 0, mv?.pos.z ?? 0);
  }

  private localReload(empty: boolean, duration: number): void {
    const v = this.m.view;
    const c = this.m.predictor.combat;
    if (!v || !c) return;
    const w = activeSlot(c).id;
    const audio = this.m.app.audio;
    v.vm.reloadStart(empty);
    audio.reload(w, 'start');
    const s = this.m.scheduler;
    s.cancel('local-reload');
    if (w === 'breaker') return; // shells are voiced as they load
    const T = Math.max(0.3, duration);
    s.after(T * 0.2, 'local-reload', () => audio.reload(w, 'mag_out'));
    s.after(T * 0.62, 'local-reload', () => audio.reload(w, 'mag_in'));
    if (empty || w === 'longline') s.after(T * 0.86, 'local-reload', () => audio.reload(w, 'chamber'));
  }

  /** Candidate hitboxes for predicted tracer ends: interpolated enemies + range targets. */
  private buildCandidates(): number {
    let n = 0;
    const remotes = this.m.view?.remotes;
    if (remotes) {
      for (const e of remotes.entries.values()) {
        if (e.isLocal || !e.alive || !this.m.isEnemy(e.ident.id)) continue;
        const hb = this.hb[n] ?? (this.hb[n] = hitboxes({ x: 0, y: 0, z: 0 }, 0));
        this.posV.x = e.pos.x;
        this.posV.y = e.pos.y;
        this.posV.z = e.pos.z;
        hitboxes(this.posV, e.s.c / 100, hb);
        n++;
      }
    }
    for (const t of this.m.targets) {
      if (!t.alive) continue;
      const hb = this.hb[n] ?? (this.hb[n] = hitboxes({ x: 0, y: 0, z: 0 }, 0));
      this.posV.x = t.x;
      this.posV.y = t.y;
      this.posV.z = t.z;
      hitboxes(this.posV, 0, hb);
      n++;
    }
    return n;
  }

  private localShot(shot: ShotRequest): void {
    const v = this.m.view;
    if (!v) return;
    this.shotsFired++;
    this.range?.onShot(shot.weapon); // weapon: per-weapon range stats
    const w = shot.weapon;
    const def = WEAPONS[w];
    const audio = this.m.app.audio;
    const team = this.visualTeam(this.me);
    const muzzle = v.vm.muzzleWorld(this.m.camera, this.muzzle);
    const n = this.buildCandidates();
    const maxTracers = this.m.app.engine.quality.preset === 'low' ? 3 : 9;
    let soundDone = false;
    for (let i = 0; i < shot.dirs.length; i++) {
      const d = shot.dirs[i];
      const tr = tracePellet(this.m.world, shot.origin, d, def.range, this.hb, n, null);
      this.end.set(shot.origin.x + d.x * tr.dist, shot.origin.y + d.y * tr.dist, shot.origin.z + d.z * tr.dist);
      if (w === 'sunspear') v.effects.beam(muzzle, this.end, team);
      else if (i < maxTracers) v.effects.tracer(muzzle, this.end, w, team);
      if (tr.candidate >= 0) {
        this.predictedHits++;
        this.nrm.set(-d.x, -d.y, -d.z);
        v.effects.impact(this.end, this.nrm, 'player');
      } else if (tr.impact.n) {
        this.nrm.set(tr.impact.n.x, tr.impact.n.y, tr.impact.n.z);
        const surf = tr.impact.s ?? 'concrete';
        v.effects.impact(this.end, this.nrm, surf);
        if (!soundDone && tr.dist < 30) {
          soundDone = true;
          audio.impact(surf, this.end);
        }
      }
    }
    const d0 = shot.dirs[0];
    this.dir.set(d0.x, d0.y, d0.z);
    v.effects.muzzleFlash(muzzle, this.dir, w, true);
    v.vm.fire();
    audio.shot(w);
    v.feel.fire(w);
  }

  /** Team used for visuals (FFA: the player's faction color for their own tracers). */
  private visualTeam(id: number): Team {
    const p = this.m.players.get(id);
    if (!p) return 2;
    return p.team === 2 ? (id === this.me ? p.faction : 2) : p.team;
  }

  // ═══ Host events ═════════════════════════════════════════════════════════

  /** Routes one event: immediate feedback now, world feedback at the render tick. */
  event(ev: GameEvent, snapTick: number): void {
    switch (ev.t) {
      case 'hit':
        this.onHit(ev);
        return;
      case 'dmg':
        this.onDamage(ev);
        return;
      case 'kill':
        this.onKillImmediate(ev);
        if (ev.v !== this.me) this.enqueue(ev, snapTick);
        return;
      case 'target':
        this.onTarget(ev);
        return;
      case 'pickup':
        this.onPickup(ev);
        return;
      case 'pickupSpawn': {
        const pd = this.m.def.pickups.find((p) => p.id === ev.id);
        if (pd) this.m.app.audio.pickup(pd.pos);
        this.m.app.hud.toast(this.t('match.pickup.ready'), PICKUP_COLOR);
        return;
      }
      case 'zone':
        this.onZone(ev);
        return;
      case 'announce':
        this.m.app.announcer.say(ev.key);
        return;
      case 'spawn':
        if (ev.p !== this.me) this.enqueue(ev, snapTick);
        return;
      case 'shot':
      case 'reload':
      case 'charge':
      case 'swap':
      case 'explode':
      case 'smoke':
      case 'bounce':
        this.enqueue(ev, snapTick);
        return;
      default:
        return;
    }
  }

  private enqueue(ev: GameEvent, snapTick: number): void {
    if (this.queue.length >= MAX_QUEUE) this.runWorld(this.queue.shift()!.ev);
    // Events happened during the ticks leading up to the snapshot.
    this.queue.push({ tick: snapTick - 1, at: performance.now(), ev });
  }

  /** Flushes world events whose tick has been reached by the render clock. */
  update(renderTick: number): void {
    if (!this.queue.length) return;
    const now = performance.now();
    let i = 0;
    while (i < this.queue.length) {
      const q = this.queue[i];
      if (q.tick > renderTick && now - q.at < MAX_WAIT_MS) break;
      i++;
      try {
        this.runWorld(q.ev);
      } catch (err) {
        console.error('[match] world event failed', q.ev.t, err);
      }
    }
    if (i) this.queue.splice(0, i);
  }

  private runWorld(ev: GameEvent): void {
    const v = this.m.view;
    if (!v) return;
    const audio = this.m.app.audio;
    switch (ev.t) {
      case 'shot':
        this.remoteShot(ev);
        break;
      case 'reload':
        this.remoteReload(ev.p, ev.w);
        break;
      case 'charge': {
        const e = v.remotes.get(ev.p);
        if (e) audio.charge(e.pos);
        break;
      }
      case 'swap':
        this.m.scheduler.cancel(`r${ev.p}`);
        break;
      case 'explode': {
        this.tmp.set(ev.pos.x, ev.pos.y, ev.pos.z);
        v.effects.projectileEnd(ev.id);
        v.effects.explosion(this.tmp);
        audio.explosion(ev.pos);
        const d = this.tmp.distanceTo(this.m.camPos);
        if (d < 24) {
          v.feel.shake(0.75 * (1 - d / 24), 0.55);
          if (d < 10) this.m.app.input.haptic('light');
        }
        break;
      }
      case 'smoke':
        this.tmp.set(ev.pos.x, ev.pos.y, ev.pos.z);
        v.effects.projectileEnd(ev.id);
        v.effects.smokeStart(ev.id, this.tmp);
        audio.smoke(ev.pos);
        break;
      case 'bounce':
        audio.bounce(ev.pos);
        break;
      case 'spawn':
        v.effects.spawnFlash(ev.pos, this.visualTeam(ev.p));
        audio.spawn(ev.pos);
        break;
      case 'kill':
        this.remoteElimination(ev.v);
        break;
      default:
        break;
    }
  }

  // ── Immediate handlers ──

  private onHit(ev: Extract<GameEvent, { t: 'hit' }>): void {
    this.hitsConfirmed++;
    const kind = ev.kill ? (ev.head ? 'headkill' : 'kill') : ev.head ? 'head' : 'body';
    this.m.app.hud.hitMarker(kind);
    this.m.app.audio.hitmarker(kind);
    this.m.app.input.haptic(ev.kill ? 'kill' : 'hit');
    const e = this.m.view?.remotes.get(ev.v);
    if (e && this.m.view) {
      this.tmp.set(e.pos.x - this.m.camPos.x, 0, e.pos.z - this.m.camPos.z).normalize();
      e.view.flinch(this.tmp);
    }
  }

  private onDamage(ev: Extract<GameEvent, { t: 'dmg' }>): void {
    const p = this.m.predictor;
    p.health = Math.min(p.health, ev.hp);
    const eye = this.m.camPos;
    const dx = ev.from.x - eye.x;
    const dz = ev.from.z - eye.z;
    const self = dx * dx + dz * dz < 0.25;
    const rel = self ? Math.PI : wrapAngle(Math.atan2(-dx, -dz) - this.m.camYaw);
    this.m.app.hud.damage(rel, ev.dmg);
    this.m.view?.feel.damage(self ? 0 : rel, ev.dmg);
    this.m.app.audio.hurt(ev.dmg);
    this.m.app.input.haptic('damage');
  }

  private onKillImmediate(ev: Extract<GameEvent, { t: 'kill' }>): void {
    const hud = this.m.app.hud;
    const me = this.me;
    const killer = ev.k >= 0 ? this.m.players.get(ev.k) : undefined;
    const victim = this.m.players.get(ev.v);
    this.hudBridge.onKill(ev.k !== ev.v ? ev.k : -1);
    hud.killFeed({
      killer: killer && ev.k !== ev.v ? { name: killer.name, team: killer.team, local: ev.k === me } : null,
      victim: { name: victim?.name ?? '?', team: victim?.team ?? 2, local: ev.v === me },
      cause: ev.w,
      head: ev.head,
    });
    if (ev.k === me && ev.v !== me) {
      this.kills++;
      hud.eliminated(victim?.name ?? '', ev.head);
      hud.toast(`+${SCORE_KILL} ${this.t('hud.toast.elim')}`);
      if (ev.head) hud.toast(`+${SCORE_HEADSHOT} ${this.t('hud.toast.headshot')}`, UI.headshot);
      if (ev.streak >= 3) hud.toast(this.t('hud.toast.streak', { n: ev.streak }), UI.xp);
    } else if (ev.assist === me) {
      hud.toast(`+${SCORE_ASSIST} ${this.t('hud.toast.assist')}`);
    }
    if (ev.v === me) {
      // Our own dissolve plays right where we stand (the camera pulls back to watch).
      const v = this.m.view;
      const mv = this.m.predictor.move;
      const ident = victim;
      if (v && mv && ident) {
        v.effects.elimination(mv.pos, this.m.local.yaw, ident.faction, this.visualTeam(ev.v), ident.cosmetics.elimFx, mv.crouchT);
        this.m.app.audio.elimination(ident.faction, mv.pos);
      }
      this.m.scheduler.cancel('local-reload');
    }
  }

  private remoteElimination(id: number): void {
    const v = this.m.view;
    const e = v?.remotes.get(id);
    if (!v || !e) return;
    this.m.scheduler.cancel(`r${id}`);
    const ident = e.ident;
    v.effects.elimination(e.pos, e.s.yaw, ident.faction, this.visualTeam(id), ident.cosmetics.elimFx, e.s.c / 100);
    this.m.app.audio.elimination(ident.faction, e.pos);
    v.remotes.markDead(id);
  }

  private onTarget(ev: Extract<GameEvent, { t: 'target' }>): void {
    const kind = ev.kill ? (ev.head ? 'headkill' : 'kill') : ev.head ? 'head' : 'body';
    this.hitsConfirmed++;
    this.m.app.hud.hitMarker(kind);
    this.m.app.audio.hitmarker(kind);
    this.m.app.input.haptic(ev.kill ? 'kill' : 'hit');
    this.range?.onTarget(ev);
  }

  private onPickup(ev: Extract<GameEvent, { t: 'pickup' }>): void {
    const pd = this.m.def.pickups.find((p) => p.id === ev.id);
    if (ev.p === this.me) {
      this.m.app.audio.pickup();
      this.m.app.hud.toast(this.t('match.pickup.you'), PICKUP_COLOR);
      this.m.app.input.haptic('light');
      return;
    }
    if (pd) this.m.app.audio.pickup(pd.pos);
    const who = this.m.players.get(ev.p);
    if (who) this.m.app.hud.toast(this.t('match.pickup.other', { name: who.name }), this.m.isEnemy(ev.p) ? DANGER_COLOR : teamColors(who.team === 2 ? 0 : who.team).light);
  }

  private onZone(ev: Extract<GameEvent, { t: 'zone' }>): void {
    const zt: Team = this.m.localTeam === 1 ? 1 : 0;
    const zd = this.m.def.zones.find((z) => z.id === ev.z);
    const name = zd ? this.t(zd.nameKey) : ev.z;
    const hud = this.m.app.hud;
    const audio = this.m.app.audio;
    const ann = this.m.app.announcer;
    if (ev.ev === 'captured') {
      if (ev.team === zt) {
        ann.say('zone_captured');
        hud.banner(this.t('match.zone.captured', { zone: name }), ev.z, teamColors(zt).primary);
        audio.zone('captured');
        const mv = this.m.predictor.move;
        if (zd && mv && this.m.predictor.alive) {
          const dx = mv.pos.x - zd.center.x;
          const dz = mv.pos.z - zd.center.z;
          const dy = mv.pos.y - zd.center.y;
          if (dx * dx + dz * dz <= zd.radius * zd.radius && dy >= -0.5 && dy <= zd.height) hud.toast(`+${SCORE_CAPTURE} ${this.t('hud.toast.capture')}`, teamColors(zt).light);
        }
      } else {
        hud.banner(this.t('match.zone.enemy', { zone: name }), ev.z, teamColors(ev.team).primary);
        audio.zone('lost');
      }
    } else if (ev.ev === 'neutralized') {
      if (ev.team !== zt) {
        ann.say('zone_lost');
        hud.banner(this.t('match.zone.lost', { zone: name }), ev.z, DANGER_COLOR);
        audio.zone('lost');
      } else audio.zone('capturing');
    } else if (ev.ev === 'contested' && ev.team === zt) {
      ann.say('zone_contested');
      audio.zone('contested');
    }
  }

  // ── World handlers ──

  private remoteShot(ev: Extract<GameEvent, { t: 'shot' }>): void {
    // Gunfire reveals the shooter on the radar (enemies only show while firing).
    this.hudBridge.onShot(ev.p);
    const v = this.m.view;
    if (!v) return;
    const audio = this.m.app.audio;
    const e = v.remotes.get(ev.p);
    const team = this.visualTeam(ev.p);
    const w = ev.w;
    if (e && e.view.root.visible) {
      e.view.muzzleWorld(this.muzzle);
      e.view.fire();
    } else this.muzzle.set(ev.o.x, ev.o.y - 0.15, ev.o.z);
    const hits = ev.hits;
    const maxTracers = this.m.app.engine.quality.preset === 'low' ? 2 : 6;
    const eye = this.m.camPos;
    let whizzD = Infinity;
    let soundDone = false;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      this.end.set(h.e.x, h.e.y, h.e.z);
      if (w === 'sunspear') v.effects.beam(this.muzzle, this.end, team);
      else if (i < maxTracers) v.effects.tracer(this.muzzle, this.end, w, team);
      if (h.pl !== undefined || h.tg !== undefined) {
        this.nrm.subVectors(this.muzzle, this.end).normalize();
        if (h.pl !== this.me) v.effects.impact(this.end, this.nrm, 'player');
      } else if (h.n) {
        this.nrm.set(h.n.x, h.n.y, h.n.z);
        const surf: SurfaceTag = h.s ?? 'concrete';
        v.effects.impact(this.end, this.nrm, surf);
        if (!soundDone && this.end.distanceToSquared(eye) < 20 * 20) {
          soundDone = true;
          audio.impact(surf, this.end);
        }
      }
      // Bullet whizz: closest approach of the trace to our head.
      if (ev.p !== this.me && this.m.predictor.alive && h.pl !== this.me) {
        const ox = ev.o.x;
        const oy = ev.o.y;
        const oz = ev.o.z;
        const dx = h.e.x - ox;
        const dy = h.e.y - oy;
        const dz = h.e.z - oz;
        const ll = dx * dx + dy * dy + dz * dz;
        if (ll > 1) {
          const t = ((eye.x - ox) * dx + (eye.y - oy) * dy + (eye.z - oz) * dz) / ll;
          if (t > 0.04 && t < 0.99) {
            const cx = ox + dx * t - eye.x;
            const cy = oy + dy * t - eye.y;
            const cz = oz + dz * t - eye.z;
            const d2 = cx * cx + cy * cy + cz * cz;
            if (d2 < 4 && d2 < whizzD) {
              whizzD = d2;
              this.nrm.set(ox + dx * t, oy + dy * t, oz + dz * t);
            }
          }
        }
      }
    }
    if (whizzD < Infinity) audio.whizz(this.nrm);
    const h0 = hits[0];
    if (h0) this.dir.set(h0.e.x - this.muzzle.x, h0.e.y - this.muzzle.y, h0.e.z - this.muzzle.z).normalize();
    else this.dir.set(0, 0, -1);
    v.effects.muzzleFlash(this.muzzle, this.dir, w, false);
    audio.shot(w, ev.o);
  }

  private remoteReload(p: number, w: WeaponId): void {
    const e = this.m.view?.remotes.get(p);
    if (!e) return;
    const audio = this.m.app.audio;
    const tag = `r${p}`;
    const s = this.m.scheduler;
    s.cancel(tag);
    audio.reload(w, 'start', e.pos);
    const def = WEAPONS[w];
    if (def.reloadPerRound) {
      for (let i = 0; i < 3; i++) s.after(def.reloadTime * 0.25 + def.reloadPerRound * (i + 1), tag, () => audio.reload(w, 'shell', e.pos));
      return;
    }
    const T = def.reloadTime;
    s.after(T * 0.2, tag, () => audio.reload(w, 'mag_out', e.pos));
    s.after(T * 0.62, tag, () => audio.reload(w, 'mag_in', e.pos));
    s.after(T * 0.86, tag, () => audio.reload(w, 'chamber', e.pos));
  }

  clear(): void {
    this.queue.length = 0;
  }
}

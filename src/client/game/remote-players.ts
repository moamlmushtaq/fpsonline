// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — remote players: one CharacterView per player, driven by the
// interpolated snapshot state at the shared render tick.
//
// Per frame (O(players), allocation-free): sample the EntityBuffer, place the
// character, derive CharacterAnim from PF_* flags + velocity, and turn their
// movement into 3D sound — footsteps every STRIDE_LENGTH of ground travel
// (surface from the collision world), jump/land from PF_AIR transitions,
// slide/mantle starts. Visibility follows the alive flag (the elimination
// dissolve itself is spawned by the event feedback at the same render tick).
// The local player also gets a (hidden) character, shown only by cinematic
// cameras (outro orbit).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { CharacterAnim, CharacterView } from '../contracts';
import { STRIDE_LENGTH } from '../../shared/constants';
import type { PlayerIdentity, PlayerSnap, SurfaceTag, Team } from '../../shared/types';
import { PF_ADS, PF_AIR, PF_ALIVE, PF_CHARGING, PF_MANTLE, PF_PROTECTED, PF_RELOAD, PF_SLIDE, PF_SPRINT, WEAPON_IDS } from '../../shared/types';
import type { MatchContext } from './context';
import { EntityBuffer, emptySample, type EntitySample } from './interpolator';
// Admin wallhack: enemies get a soft rim glow (client-only cheat).
import { adminFlags } from '../admin/flags';

/** Remote movement sounds are only simulated within this distance of the listener (m). */
const SOUND_RANGE = 48;

export interface RemoteEntry {
  ident: PlayerIdentity;
  view: CharacterView;
  buf: EntityBuffer;
  /** Interpolated state this frame. */
  s: EntitySample;
  isLocal: boolean;
  /** Displayed alive (from flags). */
  alive: boolean;
  /** Displayed feet position. */
  pos: THREE.Vector3;
  /** True once at least one sample was applied. */
  placed: boolean;
  lastX: number;
  lastZ: number;
  stride: number;
  prevFlags: number;
  prevVy: number;
  anim: CharacterAnim;
  /**
   * Seconds left during which the character stays hidden even if the sampled
   * flags still say alive (the elimination event can land a tick before the
   * snapshot flags catch up — avoids a one-frame "respawn" flicker).
   */
  deadHold: number;
  /** Spawn-shield glow currently applied. */
  glow: number;
}

export class RemotePlayers {
  readonly entries = new Map<number, RemoteEntry>();
  /** Show the local player's own character (cinematics only). */
  showLocal = false;
  private readonly scene: THREE.Scene;
  private time = 0;

  constructor(
    private readonly ctx: MatchContext,
    scene: THREE.Scene,
  ) {
    this.scene = scene;
  }

  /** Creates (or refreshes) a player's character. Idempotent. */
  add(ident: PlayerIdentity): RemoteEntry {
    const cur = this.entries.get(ident.id);
    if (cur) {
      const recreate = cur.ident.team !== ident.team || cur.ident.faction !== ident.faction;
      cur.ident = ident;
      if (recreate) {
        const old = cur.view;
        cur.view = this.makeView(ident);
        cur.view.root.visible = old.root.visible;
        cur.view.root.position.copy(old.root.position);
        old.dispose();
      }
      return cur;
    }
    const view = this.makeView(ident);
    const e: RemoteEntry = {
      ident,
      view,
      buf: new EntityBuffer(24),
      s: emptySample(),
      isLocal: ident.id === this.ctx.localId,
      alive: false,
      pos: new THREE.Vector3(),
      placed: false,
      lastX: 0,
      lastZ: 0,
      stride: 0,
      prevFlags: 0,
      prevVy: 0,
      anim: {
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0,
        pitch: 0,
        crouch: 0,
        sliding: false,
        airborne: false,
        sprinting: false,
        ads: false,
        reloading: false,
        mantling: false,
        charging: false,
        weapon: ident.loadout.primary,
        alive: false,
      },
      deadHold: 0,
      glow: 0,
    };
    view.root.visible = false;
    this.entries.set(ident.id, e);
    return e;
  }

  private makeView(ident: PlayerIdentity): CharacterView {
    const app = this.ctx.app;
    const friendly = ident.id === this.ctx.localId || (!this.ctx.isEnemy(ident.id));
    const view = app.characters.create({
      faction: ident.faction,
      team: ident.team,
      cosmetics: ident.cosmetics,
      friendly,
      quality: app.engine.quality,
    });
    view.root.name = `player.${ident.id}`;
    this.scene.add(view.root);
    return view;
  }

  remove(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    e.view.dispose();
    e.view.root.removeFromParent();
  }

  get(id: number): RemoteEntry | undefined {
    return this.entries.get(id);
  }

  /** Feeds one snapshot's player list. */
  push(tick: number, players: readonly PlayerSnap[]): void {
    for (const p of players) {
      const e = this.entries.get(p.id);
      if (e) e.buf.push(tick, p);
    }
  }

  update(dt: number, renderTick: number, listener: THREE.Vector3): void {
    const audio = this.ctx.app.audio;
    this.time += dt;
    for (const e of this.entries.values()) {
      const mode = e.buf.sample(renderTick, e.s);
      if (mode === 'empty') continue;
      const s = e.s;
      const flagAlive = (s.f & PF_ALIVE) !== 0;
      if (e.deadHold > 0) e.deadHold = flagAlive ? e.deadHold - dt : 0;
      const alive = flagAlive && e.deadHold <= 0;
      if (alive !== e.alive) {
        e.alive = alive;
        if (alive) e.view.respawn();
        else e.view.die();
        e.stride = 0;
        e.lastX = s.x;
        e.lastZ = s.z;
      }
      const show = alive && (!e.isLocal || this.showLocal);
      if (e.view.root.visible !== show) e.view.root.visible = show;
      e.pos.set(s.x, s.y, s.z);
      e.view.root.position.copy(e.pos);
      const a = e.anim;
      a.vel.x = s.vx;
      a.vel.y = s.vy;
      a.vel.z = s.vz;
      a.yaw = s.yaw;
      a.pitch = s.pitch;
      a.crouch = s.c / 100;
      a.sliding = (s.f & PF_SLIDE) !== 0;
      a.airborne = (s.f & PF_AIR) !== 0;
      a.sprinting = (s.f & PF_SPRINT) !== 0;
      a.ads = (s.f & PF_ADS) !== 0;
      a.reloading = (s.f & PF_RELOAD) !== 0;
      a.mantling = (s.f & PF_MANTLE) !== 0;
      a.charging = (s.f & PF_CHARGING) !== 0;
      a.weapon = WEAPON_IDS[s.w] ?? a.weapon;
      a.alive = alive;
      if (show) {
        e.view.update(dt, a);
        // Spawn shield: a soft pulsing glow tells you shots won't land yet.
        const glow = (s.f & PF_PROTECTED) !== 0 ? 0.3 + 0.3 * Math.sin(this.time * 9) : adminFlags.wallhack && !e.isLocal && this.ctx.isEnemy(e.ident.id) ? 0.45 : 0;
        if (glow !== e.glow) {
          e.glow = glow;
          e.view.setHighlight(glow);
        }
      }

      // ── Movement audio (others only, near the listener) ──
      if (!e.isLocal && alive && e.placed) {
        const dx = s.x - listener.x;
        const dz = s.z - listener.z;
        if (dx * dx + dz * dz < SOUND_RANGE * SOUND_RANGE) this.movementAudio(e, audio);
      }
      e.placed = true;
      e.prevFlags = s.f;
      e.prevVy = s.vy;
      e.lastX = s.x;
      e.lastZ = s.z;
    }
  }

  private movementAudio(e: RemoteEntry, audio: MatchContext['app']['audio']): void {
    const s = e.s;
    const f = s.f;
    const pf = e.prevFlags;
    const air = (f & PF_AIR) !== 0;
    const wasAir = (pf & PF_AIR) !== 0;
    const mantle = (f & PF_MANTLE) !== 0;
    if (mantle && (pf & PF_MANTLE) === 0) audio.mantle(e.pos);
    if (air && !wasAir && !mantle && s.vy > 2) audio.jump(e.pos);
    if (!air && wasAir && (pf & PF_MANTLE) === 0 && e.prevVy < -3) audio.land(this.surfaceAt(s.x, s.y, s.z), -e.prevVy, e.pos);
    const slide = (f & PF_SLIDE) !== 0;
    if (slide && (pf & PF_SLIDE) === 0) {
      const surf = this.surfaceAt(s.x, s.y, s.z);
      audio.slide(surf, e.pos);
      this.ctx.view?.effects.dust(e.pos, 0.6, surf);
    }
    if (air || slide || mantle) return;
    const ddx = s.x - e.lastX;
    const ddz = s.z - e.lastZ;
    const d = Math.sqrt(ddx * ddx + ddz * ddz);
    if (d > 3) return; // teleport / resync
    e.stride += d;
    if (e.stride >= STRIDE_LENGTH) {
      e.stride -= STRIDE_LENGTH;
      if (e.stride > STRIDE_LENGTH) e.stride = 0;
      const kind = (f & PF_SPRINT) !== 0 ? 'sprint' : s.c > 50 ? 'crouch' : 'walk';
      // Audio pass: teammates' steps are quieter than enemies'.
      audio.footstep(this.surfaceAt(s.x, s.y, s.z), e.pos, kind, !this.ctx.isEnemy(e.ident.id));
    }
  }

  /** Surface under a point (allocation-free query on the shared collision world). */
  surfaceAt(x: number, y: number, z: number): SurfaceTag {
    const w = this.ctx.world;
    if (w.waterY !== undefined && y < w.waterY + 0.05) return 'water';
    const g = w.supportHeight(x, z, 0.3, y + 0.3, 1.2);
    if (Number.isNaN(g) || !w.supportSolid) return 'concrete';
    return w.supportSolid.tag;
  }

  /** Hides a player right away (elimination event); flags take over once they agree. */
  markDead(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.deadHold = 0.5;
    if (e.alive) {
      e.alive = false;
      e.view.die();
      e.view.root.visible = false;
    }
  }

  /** Team of an entry (for markers). */
  teamOf(id: number): Team {
    return this.entries.get(id)?.ident.team ?? 2;
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }
}

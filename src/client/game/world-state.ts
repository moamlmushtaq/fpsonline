// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — replicated non-player world state for rendering:
//  • throwable projectiles — interpolated at the render tick (same clock as
//    characters), removed when they vanish from snapshots;
//  • smoke clouds — radius / remaining time pushed to Effects each snapshot,
//    ended when the host drops them;
//  • training-range targets — interpolated TargetSnaps handed to the map view
//    (MapRuntimeState.targets) and used for predicted hit tests.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { SnapshotMsg } from '../../shared/protocol';
import type { SmokeSnap, TargetSnap, ThrowableId, Vec3 } from '../../shared/types';
import type { MatchContext } from './context';
import { EntityBuffer, emptySample, type EntitySample } from './interpolator';

interface ProjEntry {
  buf: EntityBuffer;
  s: EntitySample;
  kind: ThrowableId;
  owner: number;
  /** Tick of the first snapshot that no longer contained it (-1 = alive). */
  gone: number;
  seen: number;
}

interface TargetEntry {
  buf: EntityBuffer;
  s: EntitySample;
  out: TargetSnap;
}

export class WorldState {
  /** Interpolated range targets (stable array, rewritten in place). */
  readonly targets: TargetSnap[] = [];
  private readonly projs = new Map<number, ProjEntry>();
  private readonly targetBufs = new Map<number, TargetEntry>();
  private smokeIds = new Set<number>();
  private seenSmokes = new Set<number>();
  private snapCount = 0;
  private readonly v = new THREE.Vector3();

  constructor(private readonly ctx: MatchContext) {}

  onSnapshot(s: SnapshotMsg): void {
    const n = ++this.snapCount;
    for (const p of s.projectiles) {
      let e = this.projs.get(p.id);
      if (!e) {
        e = { buf: new EntityBuffer(12), s: emptySample(), kind: p.kind, owner: p.owner, gone: -1, seen: n };
        this.projs.set(p.id, e);
      }
      e.buf.push(s.tick, { x: p.x, y: p.y, z: p.z, f: 1 });
      e.seen = n;
      e.gone = -1;
    }
    for (const e of this.projs.values()) if (e.seen !== n && e.gone < 0) e.gone = s.tick;

    for (const t of s.targets) {
      let e = this.targetBufs.get(t.id);
      if (!e) {
        e = { buf: new EntityBuffer(12), s: emptySample(), out: { id: t.id, x: t.x, y: t.y, z: t.z, yaw: t.yaw, alive: t.alive, hp: t.hp } };
        this.targetBufs.set(t.id, e);
        this.targets.push(e.out);
      }
      e.buf.push(s.tick, { x: t.x, y: t.y, z: t.z, yaw: t.yaw, f: t.alive ? 1 : 0, hp: t.hp });
    }

    const fx = this.ctx.view?.effects;
    const seen = this.seenSmokes;
    seen.clear();
    for (const sm of s.smokes) {
      seen.add(sm.id);
      fx?.smokeUpdate(sm.id, this.v.set(sm.x, sm.y, sm.z), sm.r, sm.t);
    }
    for (const id of this.smokeIds) if (!seen.has(id)) fx?.smokeEnd(id);
    this.seenSmokes = this.smokeIds;
    this.smokeIds = seen;
  }

  update(renderTick: number): void {
    const fx = this.ctx.view?.effects;
    for (const [id, e] of this.projs) {
      if (e.gone >= 0 && renderTick >= e.gone - 1) {
        fx?.projectileEnd(id);
        this.projs.delete(id);
        continue;
      }
      if (e.buf.sample(renderTick, e.s, 6) === 'empty') continue;
      fx?.projectile(id, e.kind, this.v.set(e.s.x, e.s.y, e.s.z), e.owner);
    }
    for (const e of this.targetBufs.values()) {
      if (e.buf.sample(renderTick, e.s, 0) === 'empty') continue;
      const o = e.out;
      o.x = e.s.x;
      o.y = e.s.y;
      o.z = e.s.z;
      o.yaw = e.s.yaw;
      o.alive = (e.s.f & 1) !== 0;
      o.hp = e.s.hp;
    }
  }

  /** Sight test through smoke clouds (sphere vs segment, like the host's). */
  static smokeBlocks(smokes: readonly SmokeSnap[], a: Vec3, b: Vec3): boolean {
    if (smokes.length === 0) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const ll = dx * dx + dy * dy + dz * dz;
    for (const s of smokes) {
      const r = s.r * 0.85;
      if (r <= 0.3) continue;
      let t = ll > 0 ? ((s.x - a.x) * dx + (s.y - a.y) * dy + (s.z - a.z) * dz) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.x + dx * t - s.x;
      const cy = a.y + dy * t - s.y;
      const cz = a.z + dz * t - s.z;
      if (cx * cx + cy * cy + cz * cz < r * r) return true;
    }
    return false;
  }

  clear(): void {
    this.projs.clear();
    this.targetBufs.clear();
    this.targets.length = 0;
    this.smokeIds.clear();
  }
}

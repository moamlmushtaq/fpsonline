// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — client-side prediction + reconciliation for the local player.
//
// The predictor runs the SAME `stepPlayer` the host runs, one InputCmd per
// fixed SIM_DT tick, so movement, ammo, reloads, recoil and spread respond
// instantly. Every command is kept (seq-ordered) until the host acknowledges
// it. On each authoritative SelfSnap:
//   1. the state is reset to the host's move/combat,
//   2. every command with seq > ack is replayed WITHOUT effects,
//   3. the difference between the old and the new predicted eye position is
//      returned so the camera can hide it (smoothly decayed ~100 ms; snapped
//      when larger than 2 m, e.g. a respawn or a real desync).
// While the host says we are dead, commands are still recorded (the host acks
// them without applying) but nothing is stepped.
//
// Pure logic: no DOM, no three.js — unit-tested in tests/client.
// ─────────────────────────────────────────────────────────────────────────────

import { cloneCombatState, stepPlayer, type CombatStepResult } from '../../shared/combat';
import { SIM_DT } from '../../shared/constants';
import { cloneMoveState, eyeHeight } from '../../shared/movement';
import type { CollisionWorld } from '../../shared/physics';
import type { CombatState, InputCmd, MoveState, SelfSnap, Vec3 } from '../../shared/types';

/** Commands kept for replay (≈ 2 s at 60 Hz; older ones are dropped as lost causes). */
const MAX_PENDING = 120;
/** Visual corrections larger than this are snapped instead of smoothed (m). */
export const SNAP_CORRECTION = 2;

export class Predictor {
  /** Predicted state (null until the first SelfSnap). */
  move: MoveState | null = null;
  combat: CombatState | null = null;
  alive = false;
  health = 100;
  respawnIn = 0;
  protectedT = 0;
  /** Last command seq acknowledged by the host. */
  ackSeq = 0;
  /** Number of reconciliations applied / replayed commands (diagnostics). */
  reconciles = 0;
  replayed = 0;
  /** Largest correction seen (m, diagnostics). */
  maxCorrection = 0;
  /** Recent non-trivial corrections (diagnostics): [ack, pending, meters]. */
  readonly corrections: [number, number, number][] = [];
  /** Eye position of the previous tick (render interpolation). */
  readonly prevEye: Vec3 = { x: 0, y: 0, z: 0 };
  /** Recoil of the previous tick (render interpolation). */
  prevRecoilPitch = 0;
  prevRecoilYaw = 0;

  private readonly pending: InputCmd[] = [];
  private readonly scratchA: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly scratchB: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly world: CollisionWorld,
    readonly playerId: number,
  ) {}

  get hasState(): boolean {
    return this.move !== null && this.combat !== null;
  }

  /** Commands not yet acknowledged (oldest first). */
  get unacked(): readonly InputCmd[] {
    return this.pending;
  }

  /** The last `max` unacknowledged commands (redundant resend for lossy links). */
  resendList(max = 8): InputCmd[] {
    const n = this.pending.length;
    return n <= max ? this.pending.slice() : this.pending.slice(n - max);
  }

  /** Current predicted eye position (feet + eye height). */
  eye(out: Vec3): Vec3 {
    const m = this.move;
    if (!m) return out;
    out.x = m.pos.x;
    out.y = m.pos.y + eyeHeight(m);
    out.z = m.pos.z;
    return out;
  }

  /**
   * Live step: records `cmd` and, when alive, advances the predicted state.
   * Returns the combat result (for predicted effects) or null when nothing was stepped.
   */
  step(cmd: InputCmd): CombatStepResult | null {
    this.pending.push(cmd);
    if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
    const m = this.move;
    const c = this.combat;
    if (!m || !c || !this.alive) return null;
    this.eye(this.prevEye);
    this.prevRecoilPitch = c.recoilPitch;
    this.prevRecoilYaw = c.recoilYaw;
    return stepPlayer(this.world, m, c, cmd, this.playerId, SIM_DT);
  }

  /**
   * Applies an authoritative snapshot. Returns the visual eye correction
   * (old predicted eye − new predicted eye) in `outErr`; `snapped` is true when
   * the change is too large to smooth (spawn, death, teleport).
   */
  reconcile(self: SelfSnap, outErr: Vec3): { snapped: boolean } {
    const hadState = this.hasState && this.alive;
    const oldEye = this.scratchA;
    if (hadState) this.eye(oldEye);

    this.ackSeq = Math.max(this.ackSeq, self.ack | 0);
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop].seq <= this.ackSeq) drop++;
    if (drop) this.pending.splice(0, drop);

    this.alive = self.alive;
    this.health = self.health;
    this.respawnIn = self.respawnIn;
    this.protectedT = self.protectedT;
    const m = cloneMoveState(self.move);
    const c = cloneCombatState(self.combat);
    if (self.alive) {
      for (const cmd of this.pending) stepPlayer(this.world, m, c, cmd, this.playerId, SIM_DT);
      this.replayed += this.pending.length;
    }
    this.move = m;
    this.combat = c;
    this.reconciles++;

    outErr.x = outErr.y = outErr.z = 0;
    if (!hadState || !self.alive) {
      this.eye(this.prevEye);
      this.prevRecoilPitch = c.recoilPitch;
      this.prevRecoilYaw = c.recoilYaw;
      return { snapped: true };
    }
    const ne = this.eye(this.scratchB);
    outErr.x = oldEye.x - ne.x;
    outErr.y = oldEye.y - ne.y;
    outErr.z = oldEye.z - ne.z;
    const d = Math.sqrt(outErr.x * outErr.x + outErr.y * outErr.y + outErr.z * outErr.z);
    if (d > this.maxCorrection) this.maxCorrection = d;
    if (d > 0.005) {
      this.corrections.push([this.ackSeq, this.pending.length, Math.round(d * 1000) / 1000]);
      if (this.corrections.length > 12) this.corrections.shift();
    }
    if (d > SNAP_CORRECTION) {
      outErr.x = outErr.y = outErr.z = 0;
      this.eye(this.prevEye);
      return { snapped: true };
    }
    // Keep the render interpolation continuous: shift the previous-tick eye by the same delta.
    this.prevEye.x -= outErr.x;
    this.prevEye.y -= outErr.y;
    this.prevEye.z -= outErr.z;
    return { snapped: false };
  }

  /** Forget everything (e.g. leaving a match). */
  clear(): void {
    this.pending.length = 0;
    this.move = null;
    this.combat = null;
    this.alive = false;
  }
}

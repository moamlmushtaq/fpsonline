// Test helper (not a suite): drives the shared GameSim on the Training Range
// with scripted InputCmds, like a player would, and exposes small movement /
// aiming primitives. Used by map-range and tutorial-flow tests.
import { SIM_DT, SIM_HZ } from '../../src/shared/constants';
import { RANGE, RANGE_COURSE } from '../../src/shared/maps/range';
import { makeGameConfig } from '../../src/shared/modes';
import { eyeHeight } from '../../src/shared/movement';
import { GameSim, type RoutedEvent } from '../../src/shared/sim/game';
import type { GameEvent, InputCmd, Vec3 } from '../../src/shared/types';

export const COURSE = RANGE_COURSE;

export function human(name = 'Trainee') {
  return {
    name,
    isBot: false,
    faction: 0 as const,
    loadout: { primary: 'meridian' as const, throwable: 'grenade' as const },
    cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} },
    level: 1,
    platform: 'desktop' as const,
  };
}

export function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/** Yaw/pitch from a point toward another (types.ts convention). */
export function aimAt(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

export class RangeDriver {
  readonly sim: GameSim;
  readonly id: number;
  seq = 0;
  yaw = 0;
  pitch = 0;
  /** Every event routed to the player (or broadcast). */
  readonly events: GameEvent[] = [];
  /** Events of the latest step only. */
  latest: GameEvent[] = [];
  ticks = 0;
  /** Called after every simulated tick (observers such as the tutorial machine). */
  onStep: (() => void) | null = null;

  constructor(seed = 7) {
    this.sim = new GameSim(makeGameConfig('range', 'range', { botFill: false, tutorial: true }), RANGE, seed);
    this.id = this.sim.addPlayer(human()).id;
    this.step({});
  }

  get p() {
    return this.sim.player(this.id)!;
  }

  get pos(): Vec3 {
    return this.p.move.pos;
  }

  get eye(): Vec3 {
    const m = this.p.move;
    return { x: m.pos.x, y: m.pos.y + eyeHeight(m), z: m.pos.z };
  }

  get seconds(): number {
    return this.ticks * SIM_DT;
  }

  /** One tick with the given command fields (angles default to the current view). */
  step(c: Partial<InputCmd>): void {
    const cmd: InputCmd = { seq: ++this.seq, mx: 0, mz: 0, yaw: this.yaw, pitch: this.pitch, buttons: 0, slot: 0, viewTick: this.sim.tick, ...c };
    this.yaw = cmd.yaw;
    this.pitch = cmd.pitch;
    this.sim.pushInputs(this.id, [cmd]);
    this.sim.step();
    this.ticks++;
    const evs: RoutedEvent[] = this.sim.drainEvents();
    this.latest = [];
    for (const e of evs) {
      if (e.to !== undefined && e.to !== this.id) continue;
      this.latest.push(e.ev);
      this.events.push(e.ev);
    }
    this.onStep?.();
  }

  idle(seconds: number, buttons = 0): void {
    for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) this.step({ buttons });
  }

  /** Smoothly turns the view toward (yaw, pitch) at `rate` rad/s (a mouse flick is ~6–10). */
  turnTo(yaw: number, pitch: number, rate = 5, onTick?: () => void): void {
    for (let i = 0; i < SIM_HZ * 4; i++) {
      const dy = wrap(yaw - this.yaw);
      const dp = pitch - this.pitch;
      const max = rate * SIM_DT;
      if (Math.abs(dy) < 1e-3 && Math.abs(dp) < 1e-3) break;
      this.step({ yaw: this.yaw + Math.max(-max, Math.min(max, dy)), pitch: this.pitch + Math.max(-max, Math.min(max, dp)) });
      onTick?.();
    }
  }

  /**
   * Moves toward a point (feet XZ) until within `tol` or `timeout` s. `buttons`
   * may be a function of the current state (jump at an edge, crouch at a beam…).
   * Returns true when the point was reached.
   */
  moveTo(to: { x: number; z: number }, opts: { tol?: number; timeout?: number; buttons?: number | ((d: RangeDriver) => number); onTick?: () => void } = {}): boolean {
    const tol = opts.tol ?? 0.6;
    const timeout = opts.timeout ?? 12;
    for (let i = 0; i < timeout * SIM_HZ; i++) {
      const dx = to.x - this.pos.x;
      const dz = to.z - this.pos.z;
      if (Math.hypot(dx, dz) <= tol) return true;
      const yaw = Math.atan2(-dx, -dz);
      // A human turns toward the goal quickly but not instantly.
      const turn = wrap(yaw - this.yaw);
      const ny = this.yaw + Math.max(-0.2, Math.min(0.2, turn));
      const b = typeof opts.buttons === 'function' ? opts.buttons(this) : (opts.buttons ?? 0);
      this.step({ yaw: ny, pitch: this.pitch * 0.9, mz: 1, buttons: b });
      opts.onTick?.();
    }
    return false;
  }

  ofType<T extends GameEvent['t']>(t: T, list: GameEvent[] = this.events): Extract<GameEvent, { t: T }>[] {
    return list.filter((e) => e.t === t) as Extract<GameEvent, { t: T }>[];
  }

  target(id: number) {
    return this.sim.range!.targets.find((t) => t.id === id)!;
  }
}

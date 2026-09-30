// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — tutorial step machine (pure logic: no DOM, no three.js).
//
// The 60-second Training Range tutorial is a fixed sequence of drills. The
// machine is fed one observation per frame (predicted local player state) and
// discrete events (target hits, reloads, throws landing, pad captured) and
// decides when each drill is done. Design rules:
//  • Teach by doing: a drill completes the moment the action happens.
//  • Tolerant: everything the player does is remembered from the start, so a
//    drill done early (out of order) auto-completes when it comes up; course
//    drills are position based (reaching a checkpoint also completes every
//    earlier movement drill).
//  • Never softlocks: after HINT_AFTER s on a drill the UI shows a hint; after
//    ASSIST_AFTER s the drill completes by itself ("assisted").
// Steps: look → move → sprint → jump → mantle → slide → shoot → ads → reload
//        → throw → capture → finished.
// ─────────────────────────────────────────────────────────────────────────────

import { inRegion, type CourseRegion, type RangeCourse } from '../../../shared/maps/range';
import type { Vec3 } from '../../../shared/types';

export type StepId = 'look' | 'move' | 'sprint' | 'jump' | 'mantle' | 'slide' | 'shoot' | 'ads' | 'reload' | 'throw' | 'capture';

export const STEP_ORDER: readonly StepId[] = ['look', 'move', 'sprint', 'jump', 'mantle', 'slide', 'shoot', 'ads', 'reload', 'throw', 'capture'];

/** Seconds on one drill before the gentle hint animation. */
export const HINT_AFTER = 12;
/** Seconds on one drill before it completes by itself (never softlock). */
export const ASSIST_AFTER = 32;
/** Check-mark beat after a drill completes before the next one starts. */
export const DONE_HOLD = 0.6;
/** Shorter beat when the next drill was already done (out of order). */
export const DONE_HOLD_FAST = 0.28;
/** Crosshair cone (radians) that counts as "looking at" a beacon. */
export const LOOK_CONE = 0.075;
/** A throwable landing this close to the trio centre completes the throw drill. */
export const THROW_RADIUS = 6.5;

export interface TutorialObservation {
  dt: number;
  alive: boolean;
  /** Feet position. */
  pos: Vec3;
  /** Eye position (look drill). */
  eye: Vec3;
  yaw: number;
  pitch: number;
  sprinting: boolean;
  sliding: boolean;
  mantling: boolean;
  /** ADS amount 0..1. */
  ads: number;
  /** Pad capture progress toward the player 0..1 (display) and ownership. */
  padProgress: number;
  padOwned: boolean;
}

export type TutorialEvent =
  | { kind: 'target'; id: number; kill: boolean; thrown: boolean }
  | { kind: 'reload' }
  | { kind: 'throwLanded'; pos: Vec3 }
  | { kind: 'captured' };

export interface StepState {
  id: StepId;
  done: boolean;
  /** Completed by the assist timer instead of the player. */
  assisted: boolean;
  /** Seconds the drill was current. */
  time: number;
}

export interface MachineUpdate {
  /** A drill just completed (play the tick). */
  completed: StepId | null;
  /** The current drill changed (show the new prompt). */
  started: StepId | null;
  /** The whole tutorial just finished. */
  finished: boolean;
}

/** Course checkpoints in order; reaching one implies all earlier movement drills. */
const COURSE_STEPS: readonly StepId[] = ['move', 'sprint', 'jump', 'mantle', 'slide'];

function dirFrom(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export class TutorialMachine {
  readonly steps: StepState[] = STEP_ORDER.map((id) => ({ id, done: false, assisted: false, time: 0 }));
  /** Index of the current drill (steps.length = finished). */
  index = 0;
  /** Seconds since the first observation. */
  elapsed = 0;
  finished = false;
  skipped = false;
  /** Seconds on the current drill. */
  stepTime = 0;
  /** Remaining check-mark beat before advancing (> 0 while holding). */
  hold = 0;

  // Everything the player has done so far (remembered from the start).
  readonly beaconsSeen: [boolean, boolean] = [false, false];
  readonly trioDown = new Set<number>();
  private course = -1; // highest course checkpoint reached (index into COURSE_STEPS)
  private longHit = false;
  private reloaded = false;
  private thrown = false;
  private captured = false;
  private slid = false;
  private sprinted = false;
  private mantled = false;
  padProgress = 0;

  constructor(private readonly c: RangeCourse) {}

  get current(): StepId | null {
    return this.finished ? null : (this.steps[this.index]?.id ?? null);
  }

  /** 0..1 fraction of drills done (for the thin progress bar). */
  get progress(): number {
    let n = 0;
    for (const s of this.steps) if (s.done) n++;
    return n / this.steps.length;
  }

  /** True once the player has been on the current drill long enough to deserve a hint. */
  get hint(): boolean {
    return !this.finished && this.hold <= 0 && this.stepTime >= HINT_AFTER;
  }

  /** Sub-progress of the current drill: e.g. beacons 1/2, targets 2/3. */
  sub(): { n: number; total: number } | null {
    switch (this.current) {
      case 'look':
        return { n: Number(this.beaconsSeen[0]) + Number(this.beaconsSeen[1]), total: 2 };
      case 'shoot':
        return { n: Math.min(3, this.trioDown.size), total: 3 };
      default:
        return null;
    }
  }

  /** Whether the player has already satisfied a drill (possibly out of order). */
  satisfied(id: StepId): boolean {
    switch (id) {
      case 'look':
        return this.beaconsSeen[0] && this.beaconsSeen[1];
      case 'move':
      case 'sprint':
      case 'jump':
      case 'mantle':
      case 'slide':
        return this.course >= COURSE_STEPS.indexOf(id);
      case 'shoot':
        return this.trioDown.size >= Math.min(3, this.c.trio.length);
      case 'ads':
        return this.longHit;
      case 'reload':
        return this.reloaded;
      case 'throw':
        return this.thrown;
      case 'capture':
        return this.captured;
    }
  }

  /** Technique flags (for the summary / analytics): did the player actually sprint, slide, mantle? */
  get technique(): { sprinted: boolean; slid: boolean; mantled: boolean } {
    return { sprinted: this.sprinted, slid: this.slid, mantled: this.mantled };
  }

  event(e: TutorialEvent): void {
    if (this.finished) return;
    switch (e.kind) {
      case 'target':
        if (e.thrown && this.c.trio.includes(e.id)) this.thrown = true;
        if (e.kill && this.c.trio.includes(e.id) && !e.thrown) this.trioDown.add(e.id);
        // A grenade kill on the trio also counts for "shoot" once the grenade drill is reached.
        if (e.kill && e.thrown && this.c.trio.includes(e.id) && this.index >= STEP_ORDER.indexOf('shoot')) this.trioDown.add(e.id);
        if (e.id === this.c.long && !e.thrown) this.longHit = true;
        break;
      case 'reload':
        this.reloaded = true;
        break;
      case 'throwLanded': {
        const dx = e.pos.x - this.c.trioCenter.x;
        const dz = e.pos.z - this.c.trioCenter.z;
        if (dx * dx + dz * dz <= THROW_RADIUS * THROW_RADIUS) this.thrown = true;
        break;
      }
      case 'captured':
        this.captured = true;
        break;
    }
  }

  private reach(r: CourseRegion, p: Vec3, stepIdx: number): void {
    if (this.course < stepIdx && inRegion(r, p)) this.course = stepIdx;
  }

  /** Advances the machine by one frame of observations. */
  observe(o: TutorialObservation): MachineUpdate {
    const out: MachineUpdate = { completed: null, started: null, finished: false };
    if (this.finished) return out;
    const dt = Math.max(0, Math.min(0.25, o.dt));
    this.elapsed += dt;

    if (o.alive) {
      // Look: the crosshair ray passes within LOOK_CONE of a beacon.
      const d = dirFrom(o.yaw, o.pitch);
      for (let i = 0; i < 2; i++) {
        if (this.beaconsSeen[i]) continue;
        const b = this.c.lookBeacons[i];
        const vx = b.x - o.eye.x;
        const vy = b.y - o.eye.y;
        const vz = b.z - o.eye.z;
        const len = Math.hypot(vx, vy, vz) || 1;
        const cos = (vx * d.x + vy * d.y + vz * d.z) / len;
        if (cos >= Math.cos(LOOK_CONE)) this.beaconsSeen[i] = true;
      }
      // Course checkpoints (monotonic).
      const p = o.pos;
      const dxE = p.x - this.c.entry.x;
      const dzE = p.z - this.c.entry.z;
      if (this.course < 0 && dxE * dxE + dzE * dzE <= this.c.entryRadius * this.c.entryRadius) this.course = 0;
      this.reach(this.c.sprintEnd, p, 1);
      this.reach(this.c.jumpEnd, p, 2);
      this.reach(this.c.mantleEnd, p, 3);
      this.reach(this.c.slideEnd, p, 4);
      // Anything beyond the slide beam (perch, pad) implies the whole course.
      if (this.course < 4 && p.x > 7 && p.z < this.c.slideEnd.minZ) this.course = 4;
      if (o.sprinting) this.sprinted = true;
      if (o.sliding) this.slid = true;
      if (o.mantling) this.mantled = true;
      this.padProgress = o.padProgress;
      if (o.padOwned) this.captured = true;
    }

    const cur = this.steps[this.index];
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.index++;
        this.stepTime = 0;
        if (this.index >= this.steps.length) {
          this.finished = true;
          out.finished = true;
          return out;
        }
        out.started = this.steps[this.index].id;
      }
      return out;
    }
    if (!cur) return out;
    cur.time += dt;
    this.stepTime += dt;
    let done = this.satisfied(cur.id);
    if (!done && this.stepTime >= ASSIST_AFTER) {
      done = true;
      cur.assisted = true;
    }
    if (done) {
      cur.done = true;
      out.completed = cur.id;
      const next = this.steps[this.index + 1];
      this.hold = next && this.satisfied(next.id) ? DONE_HOLD_FAST : DONE_HOLD;
    }
    return out;
  }

  /** Skip everything (Skip button / Esc / hold B). */
  skip(): void {
    if (this.finished) return;
    this.skipped = true;
    this.finished = true;
  }
}

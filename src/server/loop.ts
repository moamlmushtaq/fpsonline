// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — HostLoop: drives HostCore.update() at the simulation rate.
//
// HostCore steps a fixed 60 Hz accumulator internally. Feeding it raw
// wall-clock samples from a jittery timer makes the step count per call
// alternate 0/2 around tick boundaries, which shows up as uneven snapshot
// spacing on clients. Instead this loop:
//   • wakes on a drift-free grid (base + k·TICK, never "now + interval"),
//   • passes the GRID time (not the sampled time) to update(), and
//   • starts HostCore's clock half a tick behind the grid,
// so every wake lands mid-way between two host tick boundaries and advances
// exactly one step. Timer lateness (typically ≤ 2 ms) only shifts WHEN a tick
// runs, never how many run.
//
// CPU: ~60 wakeups/s while any room runs or anyone is queued; ~10/s when idle.
// wake() (called on incoming client messages) ends an idle sleep immediately.
// If the event loop stalls for more than HostCore's catch-up budget (8 steps),
// HostCore drops the backlog and restarts its accumulator; the loop re-centres
// its grid half a tick after that point to restore the invariant.
// ─────────────────────────────────────────────────────────────────────────────

import { performance } from 'node:perf_hooks';
import { SIM_HZ } from '../shared/constants';

/** The part of HostCore the loop needs. */
export interface TickTarget {
  update(nowMs: number): void;
  stats(): { rooms: number; queued: number };
}

export interface HostLoopOptions {
  /** Simulation rate (default SIM_HZ). */
  hz?: number;
  /** Sleep between updates while idle (clamped to ≤ 8 ticks so HostCore never drops time). */
  idleMs?: number;
  /** Clock (default performance.now). */
  now?: () => number;
  onError?: (err: unknown) => void;
  /** Called (rate-limited by the caller's discretion) when the event loop stalled past the catch-up budget. */
  onStall?: (lostMs: number) => void;
}

/** Must match HostCore's MAX_STEPS_PER_UPDATE. */
const HOST_MAX_STEPS = 8;

export class HostLoop {
  private readonly tickMs: number;
  private readonly idleTicks: number;
  private readonly now: () => number;
  private readonly onError: (err: unknown) => void;
  private readonly onStall?: (lostMs: number) => void;
  private timer: NodeJS.Timeout | null = null;
  /** Absolute time of the scheduled wake (Infinity if none). */
  private timerAt = Infinity;
  private running = false;
  /** Grid origin and the last grid index delivered to the host. */
  private base = 0;
  private k = 0;
  /** Diagnostics. */
  updates = 0;
  stalls = 0;

  constructor(
    private readonly target: TickTarget,
    opts: HostLoopOptions = {},
  ) {
    const hz = opts.hz ?? SIM_HZ;
    this.tickMs = 1000 / hz;
    this.idleTicks = Math.max(1, Math.min(HOST_MAX_STEPS, Math.round((opts.idleMs ?? 100) / this.tickMs)));
    this.now = opts.now ?? (() => performance.now());
    this.onError = opts.onError ?? (() => {});
    this.onStall = opts.onStall;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const now = this.now();
    // Host clock starts half a tick behind the grid (see file header).
    this.deliver(now - this.tickMs / 2);
    this.base = now;
    this.k = 0;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = Infinity;
  }

  /** Something happened (client message): if sleeping idle, run at the next tick boundary instead. */
  wake(): void {
    if (!this.running) return;
    const next = this.base + (this.k + 1) * this.tickMs;
    if (this.timerAt > next + 1) this.schedule(this.k + 1);
  }

  private deliver(t: number): void {
    try {
      this.target.update(t);
    } catch (err) {
      this.onError(err);
    }
  }

  private isIdle(): boolean {
    try {
      const s = this.target.stats();
      return s.rooms === 0 && s.queued === 0;
    } catch {
      return false;
    }
  }

  private readonly run = (): void => {
    this.timer = null;
    this.timerAt = Infinity;
    if (!this.running) return;
    const now = this.now();
    const K = Math.floor((now - this.base) / this.tickMs);
    // Timers may fire slightly early (libuv caches its clock per loop turn): no new grid point → re-arm.
    if (K > this.k) {
      const n = K - this.k;
      const t = this.base + K * this.tickMs;
      this.updates++;
      this.deliver(t);
      if (n > HOST_MAX_STEPS) {
        // HostCore dropped the backlog and restarted its accumulator at `t`.
        this.stalls++;
        this.onStall?.((n - HOST_MAX_STEPS) * this.tickMs);
        this.base = t + this.tickMs / 2;
        this.k = 0;
      } else this.k = K;
    }
    this.schedule();
  };

  private schedule(nextK?: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const k = nextK ?? this.k + (this.isIdle() ? this.idleTicks : 1);
    const at = this.base + k * this.tickMs;
    const delay = Math.max(0, Math.ceil(at - this.now()));
    this.timerAt = at;
    this.timer = setTimeout(this.run, delay);
  }
}

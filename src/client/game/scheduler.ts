// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — frame-driven timers for match feedback (reload stage sounds,
// delayed callouts). Advanced by the match clock (so pausing/time-scale apply),
// cancellable by tag (e.g. a player's reload when they swap or die), and
// allocation-light: finished entries are recycled.
// ─────────────────────────────────────────────────────────────────────────────

interface Entry {
  at: number;
  tag: string;
  fn: (() => void) | null;
}

export class Scheduler {
  private time = 0;
  private readonly list: Entry[] = [];
  private readonly free: Entry[] = [];

  /** Runs `fn` after `delay` seconds. `tag` groups entries for cancel(). */
  after(delay: number, tag: string, fn: () => void): void {
    const e = this.free.pop() ?? { at: 0, tag: '', fn: null };
    e.at = this.time + Math.max(0, delay);
    e.tag = tag;
    e.fn = fn;
    this.list.push(e);
  }

  cancel(tag: string): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.tag !== tag) continue;
      this.list.splice(i, 1);
      e.fn = null;
      this.free.push(e);
    }
  }

  has(tag: string): boolean {
    return this.list.some((e) => e.tag === tag);
  }

  update(dt: number): void {
    this.time += Math.max(0, dt);
    for (let i = 0; i < this.list.length; ) {
      const e = this.list[i];
      if (e.at > this.time) {
        i++;
        continue;
      }
      this.list.splice(i, 1);
      const fn = e.fn;
      e.fn = null;
      this.free.push(e);
      try {
        fn?.();
      } catch (err) {
        console.error('[match] scheduled callback failed', err);
      }
    }
  }

  clear(): void {
    this.list.length = 0;
  }
}

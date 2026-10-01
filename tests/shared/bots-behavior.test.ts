// Bot behaviour in controlled arenas: fair perception (walls, smoke), reacting
// to being shot from behind, human-like aim (turn-rate limits, overshoot,
// reaction time ordered by difficulty), anti-frustration (spawn protection,
// spreading attention, easing up on a human on a losing streak).
import { describe, expect, it } from 'vitest';
import { SIM_DT, SIM_HZ } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import type { MapDef, Solid } from '../../src/shared/maps/types';
import { angleDiff, yawFromDir } from '../../src/shared/math';
import { makeGameConfig } from '../../src/shared/modes';
import { BOT_PROFILES } from '../../src/shared/sim/bot-profiles';
import { BotDirector } from '../../src/shared/sim/bots/director';
import { inSpawnArea, laneInfoFor } from '../../src/shared/sim/bots/lanes';
import { GameSim, type SimPlayer } from '../../src/shared/sim/game';
import type { BotDifficulty, InputCmd, Vec3 } from '../../src/shared/types';
import { BTN_FIRE, PVP_MAP_IDS } from '../../src/shared/types';

const DEG = Math.PI / 180;

function arena(extra: Solid[] = []): MapDef {
  return {
    ...getMap('gantry'),
    solids: [{ min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 0, z: 60 }, tag: 'concrete' }, ...extra],
    bounds: { min: { x: -60, y: -10, z: -60 }, max: { x: 60, y: 30, z: 60 } },
    spawns: [
      { pos: { x: 0, y: 0, z: -40 }, yaw: 0, team: 0 },
      { pos: { x: 0, y: 0, z: 40 }, yaw: Math.PI, team: 1 },
      { pos: { x: 40, y: 0, z: 0 }, yaw: 0, team: 2 },
    ],
    zones: [],
    pickups: [],
    navLinks: [],
  };
}

function human(name: string) {
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

function newSim(map: MapDef, seed = 1): GameSim {
  const cfg = { ...makeGameConfig('tdm', 'gantry', { botFill: false }), countdown: 0, scoreLimit: 0, maxPlayers: 10 };
  return new GameSim(cfg, map, seed);
}

/** Puts a player at `pos` looking along `yaw` (bots re-read their view from it). */
function place(p: SimPlayer, pos: Vec3, yaw: number, protectedT = 0): void {
  p.move.pos = { ...pos };
  p.move.vel = { x: 0, y: 0, z: 0 };
  p.protectedT = protectedT;
  p.lastCmd = { ...p.lastCmd, yaw, pitch: 0 };
  p.bot?.onSpawn();
}

/** Drives an idle (or scripted) human alongside the sim. */
class Driver {
  private seq = 0;
  constructor(
    private readonly sim: GameSim,
    readonly id: number,
  ) {}
  input(partial: Partial<InputCmd> = {}): void {
    this.seq++;
    const p = this.sim.player(this.id)!;
    this.sim.pushInputs(this.id, [
      { seq: this.seq, mx: 0, mz: 0, yaw: p.lastCmd.yaw, pitch: 0, buttons: 0, slot: 0, viewTick: this.sim.tick, ...partial },
    ]);
  }
}

function visibleTarget(p: SimPlayer): number {
  const m = /tgt=(-?\d+)(\*?)/.exec(p.bot!.debugState());
  return m && m[2] === '*' ? Number(m[1]) : -1;
}

describe('fair perception', () => {
  it('never sees (or shoots) an enemy through walls', () => {
    const box: Solid[] = [
      { min: { x: -3.5, y: 0, z: 16.5 }, max: { x: 3.5, y: 4, z: 17 }, tag: 'concrete' },
      { min: { x: -3.5, y: 0, z: 23 }, max: { x: 3.5, y: 4, z: 23.5 }, tag: 'concrete' },
      { min: { x: -3.5, y: 0, z: 17 }, max: { x: -3, y: 4, z: 23 }, tag: 'concrete' },
      { min: { x: 3, y: 0, z: 17 }, max: { x: 3.5, y: 4, z: 23 }, tag: 'concrete' },
    ];
    const sim = newSim(arena(box));
    const h = new Driver(sim, sim.addPlayer({ ...human('Boxed'), team: 1 }).id);
    const bot = sim.player(sim.addBot(0, 'elite').id)!;
    place(sim.player(h.id)!, { x: 0, y: 0, z: 20 }, Math.PI);
    place(bot, { x: 0, y: 0, z: 0 }, yawFromDir(0, 1));
    for (let i = 0; i < 12 * SIM_HZ; i++) {
      h.input();
      sim.step();
      sim.drainEvents();
      expect(visibleTarget(bot)).toBe(-1);
    }
    expect(bot.stats.shots).toBe(0);
  }, 60_000);

  it('loses sight through smoke', () => {
    const sim = newSim(arena());
    const h = new Driver(sim, sim.addPlayer({ ...human('Hidden'), team: 1 }).id);
    const bot = sim.player(sim.addBot(0, 'elite').id)!;
    place(sim.player(h.id)!, { x: 0, y: 0, z: 15 }, Math.PI, 1e9);
    place(bot, { x: 0, y: 0, z: -15 }, yawFromDir(0, 1));
    for (let i = 0; i < SIM_HZ; i++) {
      h.input();
      sim.step();
    }
    expect(visibleTarget(bot)).toBe(h.id);
    // A fully grown cloud right in front of the target.
    (sim.throwables.smokes as { id: number; pos: Vec3; r: number; t: number; age: number }[]).push({ id: 999, pos: { x: 0, y: 0.6, z: 7 }, r: 5.5, t: 10, age: 5 });
    for (let i = 0; i < 1.2 * SIM_HZ; i++) {
      h.input();
      sim.step();
      if (i > 6) expect(visibleTarget(bot)).toBe(-1);
    }
    expect(bot.stats.shots).toBe(0); // protected target, then hidden: nothing to shoot
  }, 60_000);

  it('turns toward damage from an unseen attacker behind it', () => {
    for (const diff of ['recruit', 'veteran', 'elite'] as BotDifficulty[]) {
      const sim = newSim(arena(), 7);
      const h = new Driver(sim, sim.addPlayer({ ...human('Flanker'), team: 1 }).id);
      const bot = sim.player(sim.addBot(0, diff).id)!;
      place(sim.player(h.id)!, { x: 0, y: 0, z: 12 }, yawFromDir(0, -1));
      place(bot, { x: 0, y: 0, z: 0 }, yawFromDir(0, -1)); // back turned
      const toAttacker = yawFromDir(0, 12);
      let turnedAt = -1;
      for (let i = 0; i < 3 * SIM_HZ; i++) {
        // Two rounds into the back, then stop.
        h.input({ yaw: yawFromDir(0, -1), pitch: Math.atan2(-0.55, 12), buttons: i < 10 ? BTN_FIRE : 0 });
        sim.step();
        sim.drainEvents();
        if (turnedAt < 0 && Math.abs(angleDiff(bot.lastCmd.yaw, toAttacker)) < 25 * DEG) turnedAt = i / SIM_HZ;
      }
      expect(bot.health, diff).toBeLessThan(100);
      expect(turnedAt, diff).toBeGreaterThan(0.2); // not instant: a human needs a moment too
      expect(turnedAt, diff).toBeLessThan(diff === 'recruit' ? 2.6 : 1.6);
    }
  }, 60_000);
});

describe('human-like aim', () => {
  interface Trial {
    firstShot: number;
    maxTurn: number;
    overshoot: boolean;
  }
  function trial(diff: BotDifficulty, seed: number, mercyStreak = 0): Trial {
    const sim = newSim(arena(), seed);
    const hp = sim.addPlayer({ ...human('Target'), team: 1 });
    const h = new Driver(sim, hp.id);
    const bot = sim.player(sim.addBot(0, diff).id)!;
    const tgt = sim.player(h.id)!;
    // Let the director see the human, then (optionally) hand them a losing streak.
    // (Same number of steps either way, so both runs share the random stream.)
    for (let i = 0; i < 31; i++) sim.step();
    tgt.stats.deaths += mercyStreak;
    for (let i = 0; i < 31; i++) sim.step();
    place(tgt, { x: 0, y: 0, z: 20 }, Math.PI);
    // Facing 60° away: the target is at the edge of view.
    place(bot, { x: 0, y: 0, z: 0 }, yawFromDir(0, 1) + 38 * DEG);
    const want = yawFromDir(0, 20);
    let prev = bot.lastCmd.yaw;
    const s0 = Math.sign(angleDiff(want, prev));
    const out: Trial = { firstShot: 10, maxTurn: 0, overshoot: false };
    for (let i = 0; i < 4 * SIM_HZ; i++) {
      h.input();
      sim.step();
      for (const e of sim.drainEvents()) if (e.ev.t === 'shot' && e.ev.p === bot.ident.id && out.firstShot === 10) out.firstShot = i * SIM_DT;
      const y = bot.lastCmd.yaw;
      out.maxTurn = Math.max(out.maxTurn, Math.abs(angleDiff(prev, y)) / SIM_DT);
      if (out.firstShot === 10 && Math.sign(angleDiff(want, y)) === -s0 && Math.abs(angleDiff(want, y)) > 0.15 * DEG) out.overshoot = true;
      prev = y;
    }
    return out;
  }

  it('never turns faster than the profile allows, overshoots and settles, and needs time to shoot', () => {
    const mean: Record<string, number> = {};
    for (const diff of ['recruit', 'veteran', 'elite'] as BotDifficulty[]) {
      const trials = [11, 12, 13, 14, 15, 16].map((s) => trial(diff, s));
      for (const t of trials) {
        expect(t.maxTurn).toBeLessThanOrEqual(BOT_PROFILES[diff].turnRate * 1.001);
        expect(t.firstShot, diff).toBeGreaterThan(BOT_PROFILES[diff].reaction * 0.8);
        expect(t.firstShot, diff).toBeLessThan(4);
      }
      expect(trials.filter((t) => t.overshoot).length, `${diff} overshoots`).toBeGreaterThanOrEqual(2);
      mean[diff] = trials.reduce((a, t) => a + t.firstShot, 0) / trials.length;
    }
    expect(mean.recruit).toBeGreaterThan(mean.veteran);
    expect(mean.veteran).toBeGreaterThan(mean.elite);
    expect(mean.elite).toBeGreaterThan(0.35); // quick, but a human's quick
  }, 60_000);

  it('eases up on a human on a long losing streak (recruit/veteran only, subtly)', () => {
    const seeds = [21, 22, 23, 24, 25, 26, 27, 28];
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const normal = avg(seeds.map((s) => trial('veteran', s).firstShot));
    const eased = avg(seeds.map((s) => trial('veteran', s, 6).firstShot));
    expect(eased).toBeGreaterThan(normal * 1.1);
    expect(eased).toBeLessThan(normal * 2); // subtle, not a free pass
    expect(BOT_PROFILES.elite.mercy).toBe(false);
  }, 60_000);
});

describe('anti-frustration', () => {
  it('tracks losing streaks per human and forgets them after a kill', () => {
    const sim = newSim(arena());
    const hp = sim.player(sim.addPlayer({ ...human('Streaky'), team: 1 }).id)!;
    sim.addBot(0, 'recruit');
    const dir = BotDirector.for(sim);
    for (let i = 0; i < 31; i++) sim.step();
    expect(dir.mercy(hp.ident.id)).toBe(0);
    hp.stats.deaths += 5;
    for (let i = 0; i < 31; i++) sim.step();
    expect(dir.mercy(hp.ident.id)).toBeGreaterThan(0.5);
    hp.stats.kills += 1;
    for (let i = 0; i < 31; i++) sim.step();
    expect(dir.mercy(hp.ident.id)).toBe(0);
  }, 60_000);

  it('never shoots spawn-protected players', () => {
    const sim = newSim(arena());
    const h = new Driver(sim, sim.addPlayer({ ...human('Fresh'), team: 1 }).id);
    const bot = sim.player(sim.addBot(0, 'elite').id)!;
    place(sim.player(h.id)!, { x: 0, y: 0, z: 15 }, Math.PI, 2.5);
    place(bot, { x: 0, y: 0, z: 0 }, yawFromDir(0, 1));
    for (let i = 0; i < 2.4 * SIM_HZ; i++) {
      h.input();
      sim.step();
    }
    expect(bot.stats.shots).toBe(0);
    for (let i = 0; i < 2 * SIM_HZ; i++) {
      h.input();
      sim.step();
    }
    expect(bot.stats.shots).toBeGreaterThan(0);
  }, 60_000);

  it('spreads its attention: three bots do not all lock onto the same human', () => {
    let piledOn = 0;
    for (const seed of [1, 2, 3, 4]) {
      const sim = newSim(arena(), seed);
      const a = new Driver(sim, sim.addPlayer({ ...human('A'), team: 1 }).id);
      const b = new Driver(sim, sim.addPlayer({ ...human('B'), team: 1 }).id);
      place(sim.player(a.id)!, { x: -3, y: 0, z: 16 }, Math.PI, 1e9);
      place(sim.player(b.id)!, { x: 3, y: 0, z: 16 }, Math.PI, 1e9);
      const bots = [-4, 0, 4].map((x) => {
        const p = sim.player(sim.addBot(0, 'veteran').id)!;
        place(p, { x, y: 0, z: -2 }, yawFromDir(0, 1));
        return p;
      });
      for (let i = 0; i < 1.5 * SIM_HZ; i++) {
        a.input();
        b.input();
        sim.step();
      }
      const on = bots.map(visibleTarget);
      if (on.every((t) => t === on[0] && t >= 0)) piledOn++;
    }
    expect(piledOn).toBeLessThanOrEqual(1);
  }, 60_000);

  it('bots stay out of the enemy spawn area in TDM', () => {
    for (const id of PVP_MAP_IDS) {
      const cfg = { ...makeGameConfig('tdm', id, { botFill: true, botDifficulty: 'elite' }), countdown: 0, scoreLimit: 0 };
      const sim = new GameSim(cfg, getMap(id), 77);
      sim.fillBots();
      const info = laneInfoFor(sim.map, sim.world, sim.nav)!;
      let inside = 0;
      let samples = 0;
      for (let i = 0; i < 60 * SIM_HZ; i++) {
        sim.step();
        sim.drainEvents();
        if (i % 30) continue;
        for (const p of sim.players) {
          if (!p.alive) continue;
          samples++;
          if (inSpawnArea(info, p.ident.team === 0 ? 1 : 0, p.move.pos.x, p.move.pos.z)) inside++;
        }
      }
      expect(inside / samples, id).toBeLessThan(0.01);
    }
  }, 60_000);
});

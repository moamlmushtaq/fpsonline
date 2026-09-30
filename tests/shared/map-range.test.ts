// Training Range — map data + course reachability, driven through the shared
// GameSim with scripted InputCmds (the same path a player's inputs take).
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, SIM_HZ } from '../../src/shared/constants';
import { RANGE, RANGE_COURSE, inRegion } from '../../src/shared/maps/range';
import { worldForMap } from '../../src/shared/sim/game';
import { NavGraph } from '../../src/shared/sim/nav';
import { RANGE_BANDS } from '../../src/shared/sim/range';
import { BTN_CROUCH, BTN_JUMP, BTN_SPRINT, BTN_THROW, PRIMARY_WEAPON_IDS } from '../../src/shared/types';
import { RangeDriver, aimAt } from './range-agent';

const C = RANGE_COURSE;
const world = worldForMap(RANGE);

/** Presses JUMP in short pulses once `when` holds (a player mashing jump at a ledge). */
const pulseJump = (when: (d: RangeDriver) => boolean, base = 0) => (d: RangeDriver) => base | (when(d) && d.ticks % 8 < 4 ? BTN_JUMP : 0);

describe('training range map', () => {
  it('stays within budgets and exposes every band, target type and station', () => {
    expect(RANGE.solids.length).toBeLessThanOrEqual(200);
    for (const s of RANGE.solids) for (const ax of ['x', 'y', 'z'] as const) expect(s.max[ax]).toBeGreaterThan(s.min[ax]);
    const t = RANGE.targets!;
    expect(new Set(t.map((x) => x.id)).size).toBe(t.length);
    expect([...new Set(t.map((x) => x.distance))].sort((a, b) => a - b)).toEqual([...RANGE_BANDS]);
    expect(t.some((x) => x.path && x.period)).toBe(true);
    expect(t.some((x) => x.popup)).toBe(true);
    expect(t.filter((x) => !x.path && !x.popup).length).toBeGreaterThanOrEqual(5);
    for (const id of [...C.trio, C.long]) expect(t.find((x) => x.id === id)).toBeTruthy();
    expect(RANGE.zones.map((z) => z.id)).toEqual([C.padZone]);
    expect(RANGE.pickups.length).toBe(1);
    expect(C.rackSlots.length).toBe(PRIMARY_WEAPON_IDS.length);
    // Stations stand in free space next to their consoles.
    for (const p of [...C.rackSlots, C.resetStation, C.speedStation, C.pedestal, C.spawn]) expect(world.playerOverlaps(p, 1.8)).toBe(false);
  });

  it('every lane target is visible from the firing line and the tutorial targets from the perch', () => {
    const eye = { x: C.spawn.x, y: EYE_HEIGHT, z: C.spawn.z };
    const lanes = RANGE.targets!.filter((t) => !C.trio.includes(t.id) && t.id !== C.long);
    for (const t of lanes) {
      const chest = { x: t.pos.x + (t.path ? t.path.x / 2 : 0), y: 1.2, z: t.pos.z };
      expect(world.segmentClear(eye.x, eye.y, eye.z, chest.x, chest.y, chest.z, 'bullet'), `lane target ${t.id}`).toBe(true);
    }
    const perchEye = { x: C.perch.x, y: C.perch.y + EYE_HEIGHT, z: C.perch.z - 1.5 };
    for (const id of [...C.trio, C.long]) {
      const t = RANGE.targets!.find((x) => x.id === id)!;
      expect(world.segmentClear(perchEye.x, perchEye.y, perchEye.z, t.pos.x, 1.2, t.pos.z, 'bullet'), `tutorial target ${id}`).toBe(true);
    }
  });

  it('a player can run the whole movement course with real inputs', () => {
    const d = new RangeDriver();
    expect(Math.hypot(d.pos.x - C.spawn.x, d.pos.z - C.spawn.z)).toBeLessThan(4);
    // Move → course entry.
    expect(d.moveTo(C.entry, { tol: C.entryRadius * 0.8 })).toBe(true);
    // Sprint the strip and up the causeway ramp.
    expect(d.moveTo({ x: 12, z: -14 }, { buttons: BTN_SPRINT })).toBe(true);
    expect(inRegion(C.sprintEnd, d.pos)).toBe(true);
    let sprinted = false;
    expect(
      d.moveTo({ x: 12, z: -19.2 }, { buttons: BTN_SPRINT, onTick: () => (sprinted ||= d.p.move.sprint) }),
    ).toBe(true);
    expect(sprinted).toBe(true);
    expect(d.pos.y).toBeCloseTo(1, 1);
    // Jump the gap (sprint + jump at the edge).
    expect(d.moveTo({ x: 12, z: -25 }, { buttons: (x) => BTN_SPRINT | (x.pos.z < -19.9 ? BTN_JUMP : 0), tol: 0.8 })).toBe(true);
    expect(inRegion(C.jumpEnd, d.pos)).toBe(true);
    // Drop off and mantle the wall.
    let mantled = false;
    expect(d.moveTo({ x: 12, z: -32.5 }, { buttons: pulseJump((x) => x.pos.z < -29.1 && x.pos.z > -30.4 && x.pos.y < 0.5), onTick: () => (mantled ||= d.p.move.mantleT > 0) })).toBe(true);
    expect(mantled).toBe(true);
    expect(inRegion(C.mantleEnd, d.pos)).toBe(true);
    // Sprint + crouch → slide under the beam.
    let slid = false;
    expect(
      d.moveTo({ x: 12, z: -40 }, { buttons: (x) => BTN_SPRINT | (x.pos.z < -34 ? BTN_CROUCH : 0), onTick: () => (slid ||= d.p.move.slideT > 0) }),
    ).toBe(true);
    expect(slid).toBe(true);
    expect(inRegion(C.slideEnd, d.pos)).toBe(true);
    // Up the ramp to the perch.
    expect(d.moveTo({ x: C.perch.x, z: C.perch.z })).toBe(true);
    expect(d.pos.y).toBeCloseTo(C.perch.y, 1);
    // Drop onto the capture pad and hold it.
    expect(d.moveTo(C.pad, { tol: 0.8 })).toBe(true);
    expect(d.pos.y).toBeCloseTo(0, 1);
    d.idle(6.5);
    expect(d.sim.zoneStates()[0].owner).toBe(0);
    expect(d.ofType('zone').some((z) => z.ev === 'captured')).toBe(true);
    // …and walk back to the firing line along the open return path.
    expect(d.moveTo({ x: 3.8, z: -45 })).toBe(true);
    expect(d.moveTo({ x: 3.8, z: 2 }, { buttons: BTN_SPRINT })).toBe(true);
    expect(d.moveTo(C.spawn)).toBe(true);
  });

  it('the slide beam cannot be walked under standing, and crouching also fits', () => {
    const d = new RangeDriver();
    d.p.move.pos.x = 12;
    d.p.move.pos.z = -33;
    expect(d.moveTo({ x: 12, z: -40 }, { timeout: 3 })).toBe(false);
    expect(d.pos.z).toBeGreaterThan(-36);
    expect(d.moveTo({ x: 12, z: -40 }, { buttons: BTN_CROUCH, timeout: 6 })).toBe(true);
  });

  it('falling into the jump gap is recoverable (mantle onto the far platform)', () => {
    const d = new RangeDriver();
    d.p.move.pos.x = 12;
    d.p.move.pos.y = 1;
    d.p.move.pos.z = -19;
    d.moveTo({ x: 12, z: -21.8 }, { timeout: 3 });
    d.idle(0.5);
    expect(d.pos.y).toBeLessThan(0.2);
    expect(d.moveTo({ x: 12, z: -24.5 }, { buttons: pulseJump((x) => x.pos.y < 0.5), timeout: 5 })).toBe(true);
    d.idle(0.8);
    expect(d.pos.y).toBeCloseTo(1, 1);
  });

  it('the course channel wall cannot be mantled even from a jump', () => {
    const d = new RangeDriver();
    d.p.move.pos.x = 4.5;
    d.p.move.pos.z = -25;
    expect(d.moveTo({ x: 10, z: -25 }, { buttons: pulseJump(() => true, BTN_SPRINT), timeout: 3 })).toBe(false);
    expect(d.pos.x).toBeLessThan(6.4);
  });

  it('a grenade thrown from the perch at the trio lands in the pit and hits them', () => {
    const d = new RangeDriver();
    d.moveTo(C.entry);
    d.p.move.pos.x = C.perch.x;
    d.p.move.pos.y = C.perch.y;
    d.p.move.pos.z = C.perch.z - 1.5;
    d.idle(0.3);
    const a = aimAt(d.eye, { x: C.trioCenter.x, y: 0.9, z: C.trioCenter.z });
    d.turnTo(a.yaw, a.pitch, 8);
    d.step({ buttons: BTN_THROW });
    d.idle(2.5);
    const ex = d.ofType('explode');
    expect(ex.length).toBe(1);
    expect(Math.hypot(ex[0].pos.x - C.trioCenter.x, ex[0].pos.z - C.trioCenter.z)).toBeLessThan(6.5);
    const hits = d.ofType('target').filter((t) => t.w === 'grenade');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const h of hits) expect(C.trio).toContain(h.id);
    // The range refills the throwable.
    expect(d.p.combat.throwables).toBeGreaterThanOrEqual(1);
  });

  it('pop-up targets rise and fall on a cycle (speed scales it) and stay down once hit', () => {
    const d = new RangeDriver();
    const pop = d.sim.range!.targets.find((t) => t.def.popup)!;
    const seen = new Set<boolean>();
    for (let i = 0; i < 8 * SIM_HZ; i++) {
      d.step({});
      seen.add(pop.alive);
    }
    expect(seen).toEqual(new Set([true, false]));
    // Wait for a rise, eliminate it, it stays down for the rest of the window.
    while (!pop.alive) d.step({});
    d.sim.range!.damage(pop, 200, d.sim.tick);
    const cycle = pop.def.popup!.up;
    let backUp = false;
    for (let i = 0; i < Math.floor(cycle * SIM_HZ * 0.5); i++) {
      d.step({});
      backUp ||= pop.alive;
    }
    expect(backUp).toBe(false);
    // Faster speed → more rises per second.
    const count = (speed: number) => {
      const x = new RangeDriver(3);
      x.sim.rangeCommand('difficulty', speed);
      let rises = 0;
      let prev = x.sim.range!.targets.find((t) => t.def.popup)!.alive;
      for (let i = 0; i < 20 * SIM_HZ; i++) {
        x.step({});
        const now = x.sim.range!.targets.find((t) => t.def.popup)!.alive;
        if (now && !prev) rises++;
        prev = now;
      }
      return rises;
    };
    expect(count(1.6)).toBeGreaterThan(count(0.6));
  });

  it('the weapon rack command swaps primaries and throwables in the range only', () => {
    const d = new RangeDriver();
    for (let i = 0; i < PRIMARY_WEAPON_IDS.length; i++) {
      d.sim.rangeCommand('weapon', i, d.id);
      d.step({});
      expect(d.p.combat.slots[0].id).toBe(PRIMARY_WEAPON_IDS[i]);
    }
    d.sim.rangeCommand('throwable', 1, d.id);
    expect(d.p.ident.loadout.throwable).toBe('smoke');
    d.sim.rangeCommand('weapon', 99, d.id);
    d.sim.rangeCommand('weapon', Number.NaN, d.id);
    expect(d.p.combat.slots[0].id).toBe(PRIMARY_WEAPON_IDS[PRIMARY_WEAPON_IDS.length - 1]);
  });

  it('the Sunspear pedestal, stations and course are on the navigation graph', () => {
    const nav = NavGraph.build(world, RANGE);
    for (const goal of [C.pedestal, C.rackSlots[0], C.resetStation, C.entry, C.pad]) {
      expect(nav.findPath(C.spawn, goal), JSON.stringify(goal)).not.toBeNull();
    }
  });
});

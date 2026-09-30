// Pastel — focused map tests: spawn safety, routes, verticality, water,
// walk-through vine curtains, bot lane flow and sightline limits.
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, PLAYER_HEIGHT, SIM_DT, SIM_HZ } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { makeGameConfig } from '../../src/shared/modes';
import { createMoveState, stepMovement } from '../../src/shared/movement';
import { CollisionWorld } from '../../src/shared/physics';
import { GameSim } from '../../src/shared/sim/game';
import { NavGraph } from '../../src/shared/sim/nav';
import type { InputCmd, MoveState, Vec3 } from '../../src/shared/types';
import { BTN_JUMP } from '../../src/shared/types';

const map = getMap('pastel');
const world = new CollisionWorld(map.solids, map.bounds, { waterY: map.waterY });
const nav = NavGraph.build(world, map);

function cmd(seq: number, yaw: number, mz: number, buttons = 0): InputCmd {
  return { seq, mx: 0, mz, yaw, pitch: 0, buttons, slot: 0, viewTick: 0 };
}

/** Runs `seconds` of movement with a constant command; returns the final state. */
function run(start: Vec3, yaw: number, mz: number, seconds: number, jumpAt = -1): MoveState {
  const m = createMoveState({ ...start });
  let seq = 0;
  // Settle onto the ground first.
  for (let i = 0; i < 10; i++) stepMovement(world, m, cmd(++seq, yaw, 0), 1, SIM_DT);
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    const jump = jumpAt >= 0 && i >= jumpAt * SIM_HZ && i < jumpAt * SIM_HZ + 6 ? BTN_JUMP : 0;
    stepMovement(world, m, cmd(++seq, yaw, mz, jump), 1, SIM_DT);
  }
  return m;
}

describe('pastel map', () => {
  it('stays inside the collision budget with sane solids', () => {
    expect(map.solids.length).toBeLessThanOrEqual(120);
    for (const s of map.solids) {
      for (const ax of ['x', 'y', 'z'] as const) {
        expect(Number.isFinite(s.min[ax]) && Number.isFinite(s.max[ax])).toBe(true);
        expect(s.max[ax]).toBeGreaterThan(s.min[ax]);
      }
    }
    // Zones sit in the three lanes; the pickup is on the mall bridge.
    const [a, b, c] = map.zones;
    expect(a.center.x).toBeLessThan(-25);
    expect(Math.abs(b.center.x)).toBeLessThan(1);
    expect(c.center.x).toBeGreaterThan(25);
    expect(map.pickups[0].pos.y).toBeGreaterThan(3);
    expect(map.lighting.weather).toBe('spores');
    expect(map.audio.emitters.map((e) => e.kind)).toEqual(expect.arrayContaining(['radio', 'wind_chime', 'drip']));
  });

  it('team spawns are never visible from the enemy half of the map', () => {
    const sample: number[] = [];
    for (let i = 0; i < nav.mainNodes.length; i += 2) sample.push(nav.mainNodes[i]);
    for (const team of [0, 1] as const) {
      const spawns = map.spawns.filter((s) => s.team === team);
      expect(spawns.length).toBeGreaterThanOrEqual(6);
      const home = team === 0 ? 1 : -1;
      for (const s of spawns) {
        expect(s.pos.z * home).toBeGreaterThan(40);
        for (const k of sample) {
          const z = nav.pz[k];
          if (z * home > 0) continue; // only the enemy half
          const x = nav.px[k];
          const y = nav.py[k] + EYE_HEIGHT;
          const seen =
            world.segmentClear(x, y, z, s.pos.x, s.pos.y + EYE_HEIGHT, s.pos.z, 'sight') || world.segmentClear(x, y, z, s.pos.x, s.pos.y + 1.0, s.pos.z, 'sight');
          expect(seen, `spawn ${JSON.stringify(s.pos)} seen from (${x}, ${nav.py[k]}, ${z})`).toBe(false);
        }
      }
    }
  });

  it('every spawn (team and FFA) can reach every zone, the pickup and back', () => {
    const goals = [...map.zones.map((z) => z.center), map.pickups[0].pos];
    for (const s of map.spawns) {
      for (const g of goals) {
        expect(nav.findPath(s.pos, g), `${JSON.stringify(s.pos)} → ${JSON.stringify(g)}`).not.toBeNull();
        expect(nav.findPath(g, s.pos), `${JSON.stringify(g)} → ${JSON.stringify(s.pos)}`).not.toBeNull();
      }
    }
  });

  it('bots can climb: wagon → carport → bungalow roof, stairs to the house upper floor, escalators to the bridge', () => {
    const roof = nav.nearestNode({ x: -50, y: 2.95, z: 20 }, 2);
    expect(nav.py[roof]).toBeCloseTo(2.95, 1);
    expect(nav.findPath({ x: -40, y: 0, z: 30 }, { x: -50, y: 2.95, z: 20 })).not.toBeNull();
    const upstairs = nav.findPath({ x: -20, y: 0, z: 21 }, { x: -27, y: 2.7, z: 20 });
    expect(upstairs).not.toBeNull();
    expect(upstairs!.points[upstairs!.points.length - 1].y).toBeCloseTo(2.7, 1);
    expect(nav.findPath({ x: 6, y: -0.35, z: 10.5 }, map.pickups[0].pos)).not.toBeNull();
    // The drained pool: in via the sloped shallow end, out again.
    expect(nav.findPath({ x: -42, y: -1.2, z: 0 }, { x: -39, y: 0, z: 9 })).not.toBeNull();
    // …and the whole pool counts as zone A (deep end included).
    const a = map.zones[0];
    expect(-1.2).toBeGreaterThanOrEqual(a.center.y - 1.2);
  });

  it('players can jump-mantle from a house balcony onto its roof', () => {
    // Balcony of the south-west house (upper floor 2.7), facing the wall (+X).
    const m = run({ x: -30.6, y: 2.7, z: 18 }, -Math.PI / 2, 1, 1.4, 0.1);
    expect(m.pos.y).toBeGreaterThan(5.05);
    expect(m.pos.x).toBeGreaterThan(-30);
  });

  it('the flooded mall floor splashes, the street does not', () => {
    const inMall = run({ x: 7, y: -0.35, z: -5 }, 0, 0, 0.2);
    expect(inMall.ground).toBe('water');
    const street = run({ x: 37, y: 0, z: 20 }, 0, 0, 0.2);
    expect(street.ground).not.toBe('water');
  });

  it('vine curtains block sight and bullets but not movement', () => {
    // Pool pergola curtain at z = 7.5 (x −47.5..−30).
    expect(world.segmentClear(-40, 1.6, 4, -40, 1.6, 11, 'sight')).toBe(false);
    expect(world.segmentClear(-40, 1.6, 4, -40, 1.6, 11, 'bullet')).toBe(false);
    const m = run({ x: -40, y: 0, z: 10.5 }, 0, 1, 1.2); // walk north through it
    expect(m.pos.z).toBeLessThan(6);
    expect(world.playerOverlaps(m.pos, PLAYER_HEIGHT)).toBe(false);
  });

  it('ground-level sightlines in the combat area stay short', () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < nav.mainNodes.length; i++) {
      const k = nav.mainNodes[i];
      const x = nav.px[k];
      const z = nav.pz[k];
      if (Math.abs(z) > 38 || nav.py[k] > 0.5 || nav.py[k] < -0.5) continue;
      if (Math.abs(((x + 54) % 3) - 0.5) < 0.3 && Math.abs(((z + 54) % 3) - 0.5) < 0.3) pts.push({ x, y: nav.py[k] + EYE_HEIGHT, z });
    }
    let longest = 0;
    let over60 = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < 45) continue;
        if (world.segmentClear(a.x, a.y, a.z, b.x, b.y, b.z, 'sight')) {
          longest = Math.max(longest, d);
          if (d > 60) over60++;
        }
      }
    }
    // A handful of door-slot slivers may exceed 60 m; nothing crosses the map.
    expect(longest).toBeLessThan(80);
    expect(over60).toBeLessThan(40);
  });

  it('bots flow through all three lanes and never get stuck', () => {
    const cfg = { ...makeGameConfig('tdm', 'pastel', { botFill: true, botDifficulty: 'veteran' }), maxPlayers: 10 };
    const sim = new GameSim(cfg, map, 99);
    sim.fillBots();
    const lanes = [0, 0, 0];
    let maxStill = 0;
    const anchor = new Map<number, { x: number; z: number; t: number }>();
    for (let i = 0; i < 90 * SIM_HZ; i++) {
      sim.step();
      sim.drainEvents();
      for (const p of sim.players) {
        if (!p.alive) {
          anchor.delete(p.ident.id);
          continue;
        }
        const { x, z } = p.move.pos;
        if (i % 30 === 0 && Math.abs(z) < 38) lanes[x < -17 ? 0 : x > 17 ? 2 : 1]++;
        const a = anchor.get(p.ident.id);
        if (!a || Math.hypot(x - a.x, z - a.z) > 1.5) anchor.set(p.ident.id, { x, z, t: sim.tick });
        else maxStill = Math.max(maxStill, (sim.tick - a.t) / SIM_HZ);
      }
    }
    const total = lanes[0] + lanes[1] + lanes[2];
    for (const l of lanes) expect(l / total).toBeGreaterThan(0.12);
    expect(maxStill).toBeLessThan(10);
  });
});

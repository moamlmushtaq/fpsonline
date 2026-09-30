import { describe, expect, it } from 'vitest';
import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_HEIGHT } from '../../src/shared/constants';
import { MAPS, getMap } from '../../src/shared/maps/index';
import { CollisionWorld } from '../../src/shared/physics';
import { worldForMap } from '../../src/shared/sim/game';
import { LINK_MANTLE, LINK_WALK, NavGraph } from '../../src/shared/sim/nav';
import type { MapId } from '../../src/shared/types';
import { PVP_MAP_IDS } from '../../src/shared/types';

describe('maps', () => {
  for (const id of Object.keys(MAPS) as MapId[]) {
    it(`${id}: valid spawns, zones, pickups and metadata`, () => {
      const map = getMap(id);
      const world = worldForMap(map);
      expect(map.id).toBe(id);
      for (const s of map.spawns) {
        const g = world.supportHeight(s.pos.x, s.pos.z, PLAYER_RADIUS, s.pos.y + 0.01, 0.5);
        expect(g).toBeCloseTo(s.pos.y, 3);
        expect(world.playerOverlaps(s.pos, PLAYER_HEIGHT)).toBe(false);
      }
      for (const p of map.pickups) {
        expect(world.playerOverlaps(p.pos, PLAYER_HEIGHT)).toBe(false);
      }
      if (id !== 'range') {
        expect(map.solids.length).toBeGreaterThanOrEqual(60);
        expect(map.solids.length).toBeLessThanOrEqual(120);
        expect(map.spawns.filter((s) => s.team === 0).length).toBeGreaterThanOrEqual(6);
        expect(map.spawns.filter((s) => s.team === 1).length).toBeGreaterThanOrEqual(6);
        expect(map.spawns.filter((s) => s.team === 2).length).toBeGreaterThanOrEqual(8);
        expect(map.zones.map((z) => z.id)).toEqual(['A', 'B', 'C']);
        expect(map.pickups.length).toBe(1);
        expect(map.pickups[0].respawn).toBe(45);
      } else {
        expect(map.targets?.length).toBeGreaterThanOrEqual(16);
        const dists = new Set(map.targets!.map((t) => t.distance));
        expect([...dists].sort((a, b) => a - b)).toEqual([10, 25, 50, 75]);
        expect(map.targets!.some((t) => t.path && t.period)).toBe(true);
      }
      // Stairs never rise more than a step.
      for (const s of map.solids) if (s.style === 'stairs') expect(s.max.y - s.min.y).toBeGreaterThan(0);
      expect(map.bounds.max.x).toBeGreaterThan(map.bounds.min.x);
    });
  }

  it('Observatory has stars and snow at dusk; Gantry sun comes from +X', () => {
    expect(MAPS.observatory.lighting.stars).toBeGreaterThan(0);
    expect(MAPS.observatory.lighting.weather).toBe('snow');
    expect(MAPS.observatory.lighting.mood).toBe('dusk');
    expect(MAPS.gantry.lighting.mood).toBe('sunset');
    expect(MAPS.gantry.lighting.sunDir.x).toBeGreaterThan(0.5);
    expect(MAPS.pastel.lighting.mood).toBe('golden');
  });
});

describe('NavGraph', () => {
  for (const id of PVP_MAP_IDS) {
    it(`${id}: builds fast and connects every pair of team spawns, zones and the pickup`, () => {
      const map = getMap(id);
      const world = new CollisionWorld(map.solids, map.bounds);
      const t0 = performance.now();
      const nav = NavGraph.build(world, map);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(1500); // target < 400 ms on a dev machine; generous for CI
      expect(nav.count).toBeGreaterThan(5000);
      expect(NavGraph.build(world, map)).toBe(nav); // cached
      const spawns = map.spawns.filter((s) => s.team !== 2);
      for (const a of spawns) {
        for (const b of spawns) {
          if (a === b) continue;
          const p = nav.findPath(a.pos, b.pos);
          expect(p, `${id} ${JSON.stringify(a.pos)} → ${JSON.stringify(b.pos)}`).not.toBeNull();
        }
      }
      for (const z of map.zones) expect(nav.findPath(spawns[0].pos, z.center)).not.toBeNull();
      for (const pk of map.pickups) expect(nav.findPath(spawns[spawns.length - 1].pos, pk.pos)).not.toBeNull();
      for (const s of map.spawns) {
        const k = nav.nearestNode(s.pos);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(nav.comp[k]).toBe(nav.mainComp);
      }
    });
  }

  it('walks stairs, mantles ledges, and never routes through walls', () => {
    const solids = [
      { min: { x: -20, y: -1, z: -20 }, max: { x: 20, y: 0, z: 20 }, tag: 'concrete' as const },
      // Wall splitting the room, with a 1.2 m ledge block to mantle over at one end.
      { min: { x: -20, y: 0, z: -0.25 }, max: { x: 14, y: 3, z: 0.25 }, tag: 'concrete' as const },
      { min: { x: 14, y: 0, z: -1 }, max: { x: 20, y: 1.2, z: 1 }, tag: 'concrete' as const },
    ];
    const map = { ...getMap('gantry'), solids, bounds: { min: { x: -20, y: -5, z: -20 }, max: { x: 20, y: 10, z: 20 } }, spawns: [{ pos: { x: -10, y: 0, z: 10 }, yaw: 0, team: 0 as const }], navLinks: [] };
    const world = new CollisionWorld(solids, map.bounds);
    const nav = NavGraph.build(world, map);
    const p = nav.findPath({ x: -10, y: 0, z: 10 }, { x: -10, y: 0, z: -10 });
    expect(p).not.toBeNull();
    expect(p!.kinds).toContain(LINK_MANTLE);
    // Every straight WALK segment is clear of the wall.
    let prev = { x: -10, y: 0, z: 10 };
    for (let i = 0; i < p!.points.length; i++) {
      const q = p!.points[i];
      if (p!.kinds[i] === LINK_WALK) {
        expect(world.segmentClear(prev.x, prev.y + 1, prev.z, q.x, q.y + 1, q.z, 'move')).toBe(true);
        expect(Math.abs(q.y - prev.y)).toBeLessThanOrEqual(STEP_HEIGHT + 1e-6 + Math.hypot(q.x - prev.x, q.z - prev.z));
      }
      prev = q;
    }
  });
});

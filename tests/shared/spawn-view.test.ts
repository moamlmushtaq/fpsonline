// Every spawn must open its eyes on the level, not on a wall: a pilot who
// respawns nose-to-plaster loses a second turning around (Pastel's FFA spawn
// beside the mall pylon once faced it from half a metre away).
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { forwardFromAngles } from '../../src/shared/math';
import { CollisionWorld } from '../../src/shared/physics';

const MIN_CLEAR = 2.5; // metres of open view straight ahead at eye height

describe('spawn view', () => {
  for (const id of ['gantry', 'pastel', 'observatory'] as const) {
    it(`${id}: no spawn faces a wall closer than ${MIN_CLEAR} m`, () => {
      const map = getMap(id);
      const world = new CollisionWorld(map.solids, map.bounds, { waterY: map.waterY });
      const blocked: string[] = [];
      for (const s of map.spawns) {
        const eye = { x: s.pos.x, y: s.pos.y + EYE_HEIGHT, z: s.pos.z };
        const hit = world.raycast(eye, forwardFromAngles(s.yaw, 0), 50, 'sight');
        if (hit && hit.dist < MIN_CLEAR) blocked.push(`team ${s.team} at (${s.pos.x}, ${s.pos.z}) yaw ${s.yaw.toFixed(2)}: ${hit.dist.toFixed(2)} m`);
      }
      expect(blocked).toEqual([]);
    });
  }
});

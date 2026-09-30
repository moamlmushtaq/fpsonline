// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range decor: the Halcyon Proving Ground at golden
// hour (DecorBuilder).
//
//   range/kit.ts       batched static geometry (one mesh per material kind)
//   range/signs.ts     one canvas atlas for every sign, plaque and ground paint
//   range/pavilion.ts  ceramic-vault canopy, counter, armory rack + consoles
//   range/lanes.ts     lane field, distance numerals/boards, rails, the berm
//   range/course.ts    movement course dressing, perch, pad, grenade pit
//   range/backdrop.ts  control tower, fuel spheres, far gantry, scrub, windsock
//
// Environment palette only (sand, bone, faded terracotta, sage): the saturated
// budget stays with gameplay (targets' rings, the Sunspear, the capture pad).
// Budget: ~12 merged batches + 2 sign meshes + 4 rack weapons + a handful of
// animated bits (≈ 40 decor draw calls on high, fewer on low).
// ─────────────────────────────────────────────────────────────────────────────

import type { DecorBuilder, MapDecor, ShowcasePose } from '../../contracts';
import { WEAPONS } from '../../../shared/weapons';
import { PRIMARY_WEAPON_IDS } from '../../../shared/types';
import type { BackdropOptions } from '../map-builder';
import { buildBackdrop } from './range/backdrop';
import { buildCourse } from './range/course';
import { RangeKit } from './range/kit';
import { buildLanes } from './range/lanes';
import { buildPavilion } from './range/pavilion';
import { SignAtlas, defineRangeSigns } from './range/signs';

/** Sandy terrain skirt to the horizon (hills + haze from the builder). */
export const backdrop: BackdropOptions = { kind: 'terrain', tag: 'sand', color: '#d3bf98' };

const SHOWCASE: Record<'intro' | 'outro' | 'keyart', ShowcasePose> = {
  intro: { pos: { x: 9.5, y: 5.2, z: 17.5 }, target: { x: -6, y: 1.6, z: -22 }, fov: 58 },
  outro: { pos: { x: 12, y: 7, z: -30 }, target: { x: -6, y: 2, z: 2 }, fov: 52 },
  keyart: { pos: { x: -14.5, y: 1.35, z: -13.5 }, target: { x: -3, y: 2.5, z: 5 }, fov: 56 },
};

const build: DecorBuilder = (ctx) => {
  const { materials, quality, rng, def } = ctx;
  const k = new RangeKit(ctx);
  const signs = new SignAtlas(materials, k.low);
  defineRangeSigns(
    signs,
    PRIMARY_WEAPON_IDS.map((w) => WEAPONS[w].id),
  );
  signs.bake();

  const pavilion = buildPavilion(k, signs, materials);
  buildLanes(k, signs, def, rng);
  const course = buildCourse(k, signs, rng);
  const back = buildBackdrop(k, signs, rng);
  k.build();
  signs.build(k.root, quality.shadows !== 'off');


  let t = 0;
  const decor: MapDecor = {
    update(dt) {
      t += dt;
      pavilion.update(dt, t);
      course.update(t);
      back.update(t);
    },
    showcase(kind) {
      return SHOWCASE[kind];
    },
    dispose() {
      pavilion.dispose();
      signs.dispose();
      k.dispose();
    },
  };
  return decor;
};

export default build;

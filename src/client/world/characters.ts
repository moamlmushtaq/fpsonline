// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural stylized soldiers (CharacterFactory).
//
// Silhouettes readable at 80 m by SHAPE alone (art bible §5, brief §2):
//  • HALCYON — "castle" outline: tall upright figure, broad SQUARE pauldrons,
//    a crested helmet flanked by two rocket-pack pods rising above the
//    shoulders (team-coloured tip lights), V torso, segmented tapered
//    ceramic plates over an anatomical undersuit, orange accent stripes.
//  • THE BLOOM — organic and asymmetric: a big frond fan erupting from the
//    LEFT shoulder past the head, a bud-shaped hood with a swept point, a
//    hunched spine, a ragged cloak (A-line), pangolin chitin scales, vines,
//    one wrapped and one armoured arm, teal / violet bioluminescence.
//
// Implementation lives in ./characters/:
//   rig.ts       bones + per-faction rest pose
//   kit.ts       low-poly primitives + skinned geometry assembler
//   halcyon.ts / bloom.ts / visor.ts   the designs
//   material.ts  one shared shader material per (tier, team, friendly)
//   body.ts      geometry cache (faction × armour × visor × detail)
//   ik.ts        two-bone IK + weapon-hold table
//   instance.ts  CharacterView: procedural animation
//
// Budgets (measured with preview.html?view=characters&layout=perf):
//   body = 1 draw call (+ the weapon model's draw, + a blob shadow on low);
//   body triangles ≈3.85–3.93k (medium/high, < 26 m), ≈1.5–1.6k beyond 26 m
//   (distance LOD) and on low, ≈16–17k (menu); animation ≈0.05 ms CPU per
//   character per frame, allocation-free.
// Readability: team emissives are pre-saturated for the ACES grade (visor =
// team hue, not cream). Beyond ~20 m the vertex shader exaggerates the
// silhouette markers (pods / pauldrons / frond fan grow from their roots,
// visor + team lights grow — kit PartOpts.farGrow / growAt / visor), the
// fragment shader boosts glow, team rim and painted accents, and the
// Halcyon undersuit drifts toward ceramic (PartOpts.farLift) so each
// faction reads as one coherent shape + team colour at 60–80 m. Silhouette
// test: preview.html?view=characters&layout=far&d=60&sil=1 (and map=…).
// ─────────────────────────────────────────────────────────────────────────────

import type { CharacterFactory, CharacterOptions, MaterialLibrary, WeaponModelFactory } from '../contracts';
import type { Faction } from '../../shared/types';
import { defaultCosmetics } from '../../shared/cosmetics';
import { CharacterInstance } from './characters/instance';
import { bodyGeometry } from './characters/body';
import { refreshCharacterColors, sharedMaterial, tierFor } from './characters/material';

export { CharacterInstance } from './characters/instance';
export { refreshCharacterColors } from './characters/material';

export class Characters implements CharacterFactory {
  constructor(
    private readonly materials: MaterialLibrary,
    private readonly weapons: WeaponModelFactory,
  ) {
    void this.materials;
  }

  create(opts: CharacterOptions): CharacterInstance {
    return new CharacterInstance(this.weapons, opts);
  }

  /**
   * Re-read team colours after a colour-blind mode change. Optional: instances
   * also detect the switch on their next update().
   */
  refreshColors(): void {
    refreshCharacterColors();
  }

  /** Pre-build body geometry + materials (call during the loading screen to avoid a hitch on first spawn). */
  warm(quality: CharacterOptions['quality'], factions: Faction[] = [0, 1], cosmetics = defaultCosmetics()): void {
    const detail = quality.preset === 'low' ? 0 : 1;
    for (const f of factions) bodyGeometry(f, cosmetics.armor, cosmetics.visor, detail);
    for (const team of [0, 1, 2] as const) for (const friendly of [true, false]) sharedMaterial(tierFor(quality.preset), team, friendly);
  }
}

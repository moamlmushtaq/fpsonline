// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural stylized soldiers (CharacterFactory).
//
// Silhouettes readable at 80 m by shape alone (art bible §5):
//  • HALCYON — tall, clean, symmetric ceramic-white armour, broad rounded
//    pauldrons, horizontal emissive visor line, backpack + antenna, orange
//    accent stripes; calm upright posture.
//  • THE BLOOM — hunched & asymmetric bark/chitin plates, a leafy overgrown
//    left shoulder with glowing teal/violet bulbs, hood + swept crest, teal
//    visor, fabric wraps, trailing scarf and loincloth.
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
//   body = 1 draw call (+ the weapon model's draws, + a blob shadow on low);
//   body triangles ≈3.7–3.9k (medium/high, < 26 m), ≈1.56–1.6k beyond 26 m
//   (distance LOD) and on low, ≈15–17k (menu); animation ≈0.05 ms CPU per
//   character per frame, allocation-free.
// Readability: team emissives are pre-saturated for the ACES grade (visor =
// team hue, not cream); beyond ~20 m the shader thickens visor lines and
// boosts glow / team rim / albedo fill so factions read at 60–80 m.
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

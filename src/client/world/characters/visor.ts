// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — emissive visor shapes (cosmetic `VisorStyle.shape`).
//
// Every shape is a patch/decal that hugs the helmet (or Bloom mask) surface,
// so it reads as part of the shell rather than a sticker floating in front:
//   band  — wide horizontal line (default, the Halcyon signature)
//   slit  — very thin, narrower, hotter line
//   twin  — two separate angled eye lenses
//   cross — horizontal line crossed by a vertical bar
//   mono  — single round cyclops lens with a ring
//   halo  — a band that wraps all the way round the head (visible from behind)
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { VisorStyle } from '../../../shared/cosmetics';
import type { BoneName, V3 } from './rig';
import { FRONT, sqDecal, sqPatch, type Kit, type SqParams } from './kit';

export interface VisorMount {
  bone: BoneName;
  /** Surface the visor hugs (same params as the shell it sits on). */
  surf: SqParams;
  /** Where that surface is placed in bone space. */
  at: V3;
  /** Polar angle of the eye line on that surface (π/2 = equator). */
  eyeTheta: number;
  /** Extra phi span multiplier (masks are narrower than helmets). */
  width?: number;
  /** Glow weight channel: 'a' = team primary emissive. */
  intensity?: number;
}

export function addVisor(k: Kit, style: VisorStyle, m: VisorMount): void {
  const w = m.width ?? 1;
  const I = m.intensity ?? 1;
  const hs = k.n(1, 2, 3);
  const ws = (span: number): number => Math.max(3, Math.round(span * k.n(5, 8, 12)));
  const glow = (g: THREE.BufferGeometry, weight = 1): void => k.add(m.bone, g, '#101010', { pos: m.at, glow: weight * I, gloss: 1, ao: 0, visor: true });
  const th = m.eyeTheta;
  const patch = (phiC: number, span: number, thC: number, halfH: number, grow = 0.007): THREE.BufferGeometry =>
    sqPatch(m.surf, grow, phiC - span / 2, span, thC - halfH, halfH * 2, ws(span), hs);
  switch (style.shape) {
    case 'band':
      glow(patch(FRONT, 2.5 * w, th, 0.07));
      break;
    case 'slit':
      glow(patch(FRONT, 1.9 * w, th - 0.02, 0.028), 1.4);
      break;
    case 'twin':
      for (const s of [-1, 1]) {
        // Each lens is a short band tilted slightly (outer end lower).
        const flat = new THREE.PlaneGeometry(0.46 * w, 0.13, 5, 1);
        flat.rotateZ(s * 0.16);
        glow(sqDecal(m.surf, 0.007, flat, FRONT - s * 0.33 * w, th));
      }
      break;
    case 'cross':
      glow(patch(FRONT, 1.8 * w, th, 0.038));
      glow(sqDecal(m.surf, 0.0075, new THREE.PlaneGeometry(0.075, 0.62, 1, 6), FRONT, th - 0.05));
      break;
    case 'mono': {
      glow(sqDecal(m.surf, 0.008, new THREE.CircleGeometry(0.2, k.n(10, 16, 24)), FRONT, th), 1.2);
      glow(sqDecal(m.surf, 0.0065, new THREE.RingGeometry(0.26, 0.31, k.n(10, 16, 24), 1), FRONT, th), 0.55);
      break;
    }
    case 'halo':
      glow(sqPatch(m.surf, 0.007, 0, Math.PI * 2, th - 0.055, 0.11, k.n(12, 20, 32), hs));
      break;
  }
}

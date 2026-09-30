// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map pickups (the Sunspear). Walk over it (1.2 m) or hold
// INTERACT within 2.5 m to take it; it respawns after its def's timer.
// ─────────────────────────────────────────────────────────────────────────────

import { giveSunspear } from '../combat';
import type { PickupDef } from '../maps/types';
import type { GameEvent, PickupSnap } from '../types';
import { BTN_INTERACT } from '../types';
import type { SimPlayer } from './player';

export const PICKUP_WALK_RADIUS = 1.2;
export const PICKUP_INTERACT_RADIUS = 2.5;

export interface PickupState {
  def: PickupDef;
  available: boolean;
  respawnT: number;
}

export class PickupSystem {
  readonly items: PickupState[];

  constructor(defs: readonly PickupDef[]) {
    this.items = defs.map((def) => ({ def, available: true, respawnT: 0 }));
  }

  step(dt: number, players: readonly SimPlayer[], emit: (ev: GameEvent) => void): void {
    for (const pk of this.items) {
      if (!pk.available) {
        pk.respawnT -= dt;
        if (pk.respawnT <= 0) {
          pk.available = true;
          pk.respawnT = 0;
          emit({ t: 'pickupSpawn', id: pk.def.id });
        }
        continue;
      }
      const pp = pk.def.pos;
      for (const p of players) {
        if (!p.alive) continue;
        const dy = p.move.pos.y - pp.y;
        if (dy < -1.6 || dy > 1.6) continue;
        const dx = p.move.pos.x - pp.x;
        const dz = p.move.pos.z - pp.z;
        const d2 = dx * dx + dz * dz;
        const interact = (p.lastCmd.buttons & BTN_INTERACT) !== 0;
        if (d2 > PICKUP_WALK_RADIUS * PICKUP_WALK_RADIUS && !(interact && d2 <= PICKUP_INTERACT_RADIUS * PICKUP_INTERACT_RADIUS)) continue;
        if (!giveSunspear(p.combat)) continue;
        pk.available = false;
        pk.respawnT = pk.def.respawn;
        emit({ t: 'pickup', p: p.ident.id, id: pk.def.id, w: 'sunspear' });
        break;
      }
    }
  }

  snaps(): PickupSnap[] {
    return this.items.map((pk) => ({ id: pk.def.id, available: pk.available, respawnIn: Math.round(pk.respawnT * 10) / 10 }));
  }
}

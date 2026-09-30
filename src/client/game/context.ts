// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — the internal surface ClientMatch shares with its helpers
// (remote players, event feedback, HUD bridge, camera director). Helpers get
// the match typed as MatchContext so they stay decoupled from its internals.
// ─────────────────────────────────────────────────────────────────────────────

import type * as THREE from 'three';
import type { App } from '../app';
import type { MapView } from '../contracts';
import type { CameraFeelController } from '../engine/camera-feel';
import type { EffectsSystem } from '../engine/effects';
import type { FirstPersonViewModel } from '../world/viewmodel';
import type { MapDef } from '../../shared/maps/types';
import type { CollisionWorld } from '../../shared/physics';
import type { GameConfig, MatchClock, PickupSnap, PlayerIdentity, SmokeSnap, TargetSnap, Team, ZoneSnap } from '../../shared/types';
import type { LocalPlayer } from './local-player';
import type { Predictor } from './predictor';
import type { RemotePlayers } from './remote-players';
import type { Scheduler } from './scheduler';

/** Everything that exists only once the map view is built. */
export interface MatchView {
  map: MapView;
  effects: EffectsSystem;
  vm: FirstPersonViewModel;
  feel: CameraFeelController;
  remotes: RemotePlayers;
}

export interface MatchContext {
  readonly app: App;
  readonly config: GameConfig;
  readonly def: MapDef;
  readonly world: CollisionWorld;
  readonly localId: number;
  readonly localTeam: Team;
  readonly players: Map<number, PlayerIdentity>;
  readonly predictor: Predictor;
  readonly local: LocalPlayer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scheduler: Scheduler;
  readonly view: MatchView | null;
  /** Latest authoritative match clock. */
  readonly clock: MatchClock;
  readonly zones: readonly ZoneSnap[];
  readonly pickups: readonly PickupSnap[];
  readonly smokes: readonly SmokeSnap[];
  /** Range targets interpolated at the render tick. */
  readonly targets: readonly TargetSnap[];
  /** Fractional host tick currently rendered for remote entities. */
  readonly renderTick: number;
  /** Current camera world position (after director / feel). */
  readonly camPos: THREE.Vector3;
  /** Current camera yaw (view + recoil, radians). */
  readonly camYaw: number;
  /** True when `id` is an enemy of the local player. */
  isEnemy(id: number): boolean;
  nameOf(id: number): string;
  teamOf(id: number): Team;
}

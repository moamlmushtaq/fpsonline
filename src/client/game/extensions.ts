// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — match extensions (tutorial, future modes, analytics…).
//
// A MatchExtension is a small plug-in that ClientMatch drives:
//   onEvent(ev)     — every GameEvent addressed to this client (in arrival order)
//   onTick(dt)      — once per rendered frame after the match updated
//   onSnapshot(s)   — every snapshot (after prediction/interpolation consumed it)
//   dispose()       — the match is being torn down
// Extensions talk back through the read-only MatchApi (implemented by
// ClientMatch). When GameConfig.tutorial is set, ClientMatch lazy-loads
// './tutorial.ts' (default export: (match: MatchApi) => MatchExtension).
// ─────────────────────────────────────────────────────────────────────────────

import type * as THREE from 'three';
import type { Announcer, AudioSystem, Hud, I18n, InputSystem } from '../contracts';
import type { MapDef } from '../../shared/maps/types';
import type { SnapshotMsg } from '../../shared/protocol';
import type { RangeSummary } from '../../shared/sim/range';
import type {
  CombatState,
  GameConfig,
  GameEvent,
  MatchClock,
  MoveState,
  PickupSnap,
  PlayerIdentity,
  TargetSnap,
  Team,
  ZoneSnap,
} from '../../shared/types';

export interface MatchExtension {
  onEvent?(ev: GameEvent): void;
  onTick?(dt: number): void;
  onSnapshot?(s: SnapshotMsg): void;
  dispose?(): void;
}

export interface InstructionOptions {
  /** Smaller line under the main instruction. */
  sub?: string;
  /** Step label, e.g. "2 / 6". */
  step?: string;
  /** 0..1 progress bar (omit to hide). */
  progress?: number;
  /** Key/button glyph shown before the text (e.g. "W A S D"). */
  keys?: string;
  /** Success flash (tick mark + chime-free pulse). */
  done?: boolean;
}

/** Read-only view of a running match for extensions. */
export interface MatchApi {
  readonly config: GameConfig;
  readonly def: MapDef;
  readonly localId: number;
  readonly localTeam: Team;
  readonly players: ReadonlyMap<number, PlayerIdentity>;
  /** Predicted local movement/combat state (null while dead or before the first snapshot). */
  readonly move: Readonly<MoveState> | null;
  readonly combat: Readonly<CombatState> | null;
  readonly alive: boolean;
  readonly health: number;
  readonly clock: Readonly<MatchClock>;
  /** View angles (radians). */
  readonly yaw: number;
  readonly pitch: number;
  readonly zones: readonly ZoneSnap[];
  readonly pickups: readonly PickupSnap[];
  readonly targets: readonly TargetSnap[];
  readonly camera: THREE.PerspectiveCamera;
  readonly hud: Hud;
  readonly audio: AudioSystem;
  readonly announcer: Announcer;
  readonly i18n: I18n;
  /** Input device currently used ('kbm' | 'touch' | 'gamepad'). */
  readonly device: string;
  /** Training range statistics (session so far). */
  rangeSummary(): RangeSummary;
  /** Large instructional card (null hides it). */
  instruct(text: string | null, opts?: InstructionOptions): void;
  /** Resets the training range targets and stats. */
  resetRange(): void;
  /** Sets the range target speed multiplier (0..3). */
  setRangeSpeed(k: number): void;
  /** Human-readable label for the key/button bound to an action on the current device. */
  keyLabel(action: string): string;
  /** Registers another extension. */
  use(ext: MatchExtension): void;

  // ── Additive (Training Range + tutorial) ──────────────────────────────────
  /** The input hub (pressed/down for station interaction, skip-hold, device glyphs). */
  readonly input: InputSystem;
  /** The world scene (null until the map view is built): extensions may add world markers. */
  readonly scene: THREE.Scene | null;
  /** True while the player is in live first-person control (no intro/death camera, not paused). */
  readonly controllable: boolean;
  /** InputCmd.seq of the most recent local command (matches 'target' events' `s`). */
  readonly localSeq: number;
  /** Range rack: equip PRIMARY_WEAPON_IDS[index] immediately (range only). */
  setRangeWeapon(index: number): void;
  /** Range: equip a throwable (0 = grenade, 1 = smoke) immediately (range only). */
  setRangeThrowable(index: number): void;
  /** Contextual HUD prompt shown when no pickup prompt applies (null clears). */
  setPrompt(text: string | null): void;
  /** Leaves the match without a results screen, then opens the menu or starts quick play. */
  exit(next: 'menu' | 'quickplay'): void;
}

// HALCYON FRONT — gameplay & network constants (architecture contract, see ARCHITECTURE.md).
// Tuning values may be adjusted by the owners of the simulation, but names must remain stable.

export const PROTOCOL_VERSION = 1;
export const GAME_VERSION = '1.0.0';

/** Fixed simulation rate (host and client prediction). */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
/** Snapshot broadcast rate. */
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_EVERY_TICKS = SIM_HZ / SNAPSHOT_HZ;
/** Remote players are rendered this far in the past (seconds) for smooth interpolation. */
export const INTERP_DELAY = 0.1;
/** Maximum lag compensation rewind (seconds). */
export const MAX_REWIND = 0.25;
/** Host keeps this many ticks of position history for lag compensation. */
export const HISTORY_TICKS = 60;
/** Max queued input commands processed per player per host tick (anti speed-hack, absorbs jitter). */
export const MAX_CMDS_PER_TICK = 4;

// ── Player body ─────────────────────────────────────────────────────────────
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.2;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.05;
export const PITCH_LIMIT = 1.45;

// ── Movement ────────────────────────────────────────────────────────────────
export const GRAVITY = 20;
export const WALK_SPEED = 5.4;
export const SPRINT_SPEED = 7.8;
export const CROUCH_SPEED = 2.9;
export const ADS_SPEED_MULT = 0.62;
export const GROUND_ACCEL = 60;
export const GROUND_FRICTION = 11;
export const AIR_ACCEL = 14;
export const AIR_CONTROL_MAX = 7.8;
export const JUMP_VELOCITY = 6.8;
export const COYOTE_TIME = 0.1;
export const STEP_HEIGHT = 0.45;
export const SLIDE_SPEED = 10.5;
export const SLIDE_DURATION = 0.8;
export const SLIDE_FRICTION = 3.2;
export const SLIDE_COOLDOWN = 0.6;
/** Minimum horizontal speed needed to start a slide from sprint. */
export const SLIDE_MIN_SPEED = 6.4;
export const MANTLE_MIN_HEIGHT = 0.5;
export const MANTLE_MAX_HEIGHT = 1.3;
export const MANTLE_DURATION = 0.32;
/** How far ahead of the player we probe for a mantle-able ledge. */
export const MANTLE_REACH = 0.7;
export const CROUCH_SPEED_T = 8; // crouchT approach rate per second
/** Horizontal distance per footstep. */
export const STRIDE_LENGTH = 2.1;
export const FALL_KILL_MARGIN = 20;

// ── Health ──────────────────────────────────────────────────────────────────
export const MAX_HEALTH = 100;
export const REGEN_DELAY = 4.5;
export const REGEN_RATE = 30;
export const RESPAWN_TIME = 4;
export const SPAWN_PROTECTION = 2;
export const ASSIST_WINDOW = 6;

// ── Throwables ──────────────────────────────────────────────────────────────
export const THROW_SPEED = 17;
export const THROW_UP = 3.5;
export const THROW_COOLDOWN = 0.8;
export const GRENADE_FUSE = 1.7;
export const GRENADE_RADIUS = 5.5;
export const GRENADE_DAMAGE = 95;
export const GRENADE_MIN_DAMAGE = 12;
export const SMOKE_FUSE = 1.0;
export const SMOKE_RADIUS = 5.5;
export const SMOKE_DURATION = 13;
export const THROWABLE_BOUNCE = 0.42;

// ── Launch Control ──────────────────────────────────────────────────────────
export const ZONE_CAPTURE_TIME = 5;
/** Additional capture speed per extra teammate in the zone (fraction). */
export const ZONE_EXTRA_CAPTURER = 0.35;
/** Points per second per owned zone. */
export const ZONE_POINTS_PER_SEC = 1;
/** Seconds of end-of-match outro (rocket launch / victory pose) before results. */
export const MATCH_OUTRO = 7;

// ── Matchmaking ─────────────────────────────────────────────────────────────
/** Seconds quick play waits for humans before starting with bot fill. */
export const QUEUE_BOT_FILL_AFTER = 4;
export const DEFAULT_RATING = 1000;
export const ROOM_CODE_LENGTH = 5;

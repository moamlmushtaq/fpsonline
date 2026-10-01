// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — client module contracts (architecture contract, see ARCHITECTURE.md).
//
// Each client subsystem lives in its own folder and exports a factory/class that
// implements one of these interfaces. The match orchestrator (src/client/game/match.ts)
// and the app shell (src/client/app.ts) talk to subsystems ONLY through these
// interfaces, so subsystems can be rewritten independently.
//
// Rules for implementers:
//  • You may ADD optional members to an interface in your implementation, but never
//    remove/rename members or change signatures here without updating every caller.
//  • All three.js objects you create must be released in dispose().
//  • Respect QualitySettings (particle budget, decor density, shadows) — performance
//    on phones matters more than detail.
// ─────────────────────────────────────────────────────────────────────────────

import type * as THREE from 'three';
import type { MapDef } from '../shared/maps/types';
import type {
  AnnouncerKey,
  CosmeticSelection,
  Faction,
  InputDevice,
  KillCause,
  Lang,
  MatchPhase,
  ModeId,
  PickupSnap,
  SurfaceTag,
  TargetSnap,
  Team,
  ThrowableId,
  Vec3,
  WeaponId,
  ZoneSnap,
} from '../shared/types';
import type { ColorblindMode } from './engine/palette';

// ── Quality ─────────────────────────────────────────────────────────────────

export type QualityPreset = 'low' | 'medium' | 'high' | 'auto';

export interface QualitySettings {
  /** Resolved preset (never 'auto'; see QualityManager for auto). */
  preset: 'low' | 'medium' | 'high';
  /** Final renderer pixel ratio (already includes devicePixelRatio cap and render scale). */
  pixelRatio: number;
  shadows: 'off' | 'low' | 'high';
  shadowMapSize: number;
  /** Full-screen grading pass (tone, vignette, grain). If false, grading falls back to renderer tone mapping only. */
  post: boolean;
  bloom: boolean;
  /** Painterly brush-stroke filter (high only). */
  painterly: boolean;
  /** Fake volumetric light shafts (additive cones / god-ray sprites). */
  lightShafts: boolean;
  /** Particle budget multiplier 0.25..1. */
  particles: number;
  /** Decor density multiplier 0.3..1 (grass tufts, vines, debris). */
  decor: number;
  /** Camera far plane (m). */
  drawDistance: number;
  antialias: boolean;
  /** Use HRTF spatial audio (more CPU). */
  hrtf: boolean;
}

// ── Render engine (src/client/engine/renderer.ts) ──────────────────────────

export interface GradingSettings {
  exposure: number;
  /** 0..1.5 */
  bloomStrength: number;
  /** Saturation multiplier (1 = neutral). */
  saturation: number;
  /** Warm/cool tint multiplier, e.g. '#fff1dc'. */
  tint: string;
  /** 0..1 */
  vignette: number;
  /** 0..1 film grain amount. */
  grain: number;
  /** Lift shadows toward this color (painterly shadow tint), e.g. '#3b4150'. */
  shadowTint: string;
}

export interface RenderEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly quality: QualitySettings;
  /** Main world view. */
  setScene(scene: THREE.Scene | null, camera: THREE.PerspectiveCamera | null): void;
  /** First-person weapon overlay rendered after the world with a cleared depth buffer. */
  setOverlay(scene: THREE.Scene | null, camera: THREE.PerspectiveCamera | null): void;
  setGrading(g: Partial<GradingSettings>): void;
  /** Change preset; 'auto' enables adaptive quality driven by frame time. */
  setQualityPreset(p: QualityPreset): void;
  /** Extra render-scale multiplier from settings (0.5..1). */
  setRenderScale(s: number): void;
  /** Subscribe to quality changes (auto adjustments). */
  onQualityChange(cb: (q: QualitySettings) => void): () => void;
  render(dt: number): void;
  readonly size: { width: number; height: number; aspect: number };
  readonly stats: { fps: number; frameMs: number; calls: number; triangles: number };
  onResize(cb: (w: number, h: number) => void): () => void;
}

// ── Atmosphere (src/client/engine/atmosphere.ts) ───────────────────────────

export interface Atmosphere {
  /** The sun light (casts shadows when enabled). Its shadow camera follows the view. */
  readonly sun: THREE.DirectionalLight;
  /** Update sky, sun shadow frustum placement, weather particles, stars fade (0..1). */
  update(dt: number, camera: THREE.Camera, starAmount: number): void;
  setQuality(q: QualitySettings): void;
  dispose(): void;
}

// ── Materials (src/client/engine/materials.ts) ─────────────────────────────

export interface MaterialLibrary {
  /** Shared material for a surface tag + optional style/color override. Materials are cached & shared. */
  surface(tag: SurfaceTag, opts?: { style?: string; color?: string }): THREE.Material;
  /** Painted (vertex-colored or flat) stylized material in the environment palette. */
  painted(color: string, opts?: { roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number; side?: THREE.Side }): THREE.Material;
  /** Emissive bioluminescent plant material (chartreuse / gold). */
  glow(color: string, intensity?: number): THREE.Material;
  /** Procedural canvas texture cache (posters, signage, dials). Key is used for caching. */
  canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture;
  dispose(): void;
}

// ── Map view (src/client/world/map-builder.ts + src/client/world/maps/<id>.ts) ─

export interface MapRuntimeState {
  /** Seconds since the map view was created. */
  time: number;
  /** Seconds of live match time elapsed. */
  matchElapsed: number;
  /** 0..1 progress through the match (drives stars on Observatory etc.). */
  matchProgress: number;
  phase: MatchPhase;
  zones: ZoneSnap[];
  pickups: PickupSnap[];
  targets: TargetSnap[];
  localTeam: Team;
  camera: THREE.PerspectiveCamera;
  /** Launch Control finale: team whose rocket launches and seconds since launch began. */
  rocketLaunch: { team: Team; t: number } | null;
}

export interface ShowcasePose {
  pos: Vec3;
  target: Vec3;
  fov: number;
}

export interface MapView {
  readonly def: MapDef;
  /** Scene containing the map + atmosphere. ClientMatch adds characters/effects to it. */
  readonly scene: THREE.Scene;
  readonly atmosphere: Atmosphere;
  update(dt: number, s: MapRuntimeState): void;
  /** Camera poses for intro fly-in, end-of-match outro (rocket launch) and key art. */
  showcase(kind: 'intro' | 'outro' | 'keyart'): ShowcasePose;
  dispose(): void;
}

export interface DecorContext {
  def: MapDef;
  scene: THREE.Scene;
  /** Group for static decor; the builder may merge/instance its children for performance. */
  root: THREE.Group;
  quality: QualitySettings;
  materials: MaterialLibrary;
  /** Deterministic RNG seeded per map. */
  rng: () => number;
}

export interface MapDecor {
  update?(dt: number, s: MapRuntimeState): void;
  showcase?(kind: 'intro' | 'outro' | 'keyart'): ShowcasePose | undefined;
  dispose?(): void;
}

/** Each map module (src/client/world/maps/<id>.ts) default-exports a DecorBuilder. */
export type DecorBuilder = (ctx: DecorContext) => MapDecor;

// ── Weapon models (src/client/world/weapon-models.ts) ──────────────────────

export interface WeaponModel {
  readonly root: THREE.Group;
  /** Muzzle anchor (for flashes/tracers). */
  readonly muzzle: THREE.Object3D;
  /** Named moving parts (magazine, bolt, pump, drum, dial needle, charge coils…) animated by the viewmodel. */
  readonly parts: Partial<Record<'mag' | 'bolt' | 'pump' | 'dial' | 'coil' | 'slide' | 'shell' | 'screen', THREE.Object3D>>;
  /** Update the little ammo counter screen / analog dial. */
  setAmmo(mag: number, magSize: number): void;
  /** 0..1 Sunspear charge glow. */
  setCharge(k: number): void;
  dispose(): void;
}

export interface WeaponModelFactory {
  create(id: WeaponId, skin: string, lod: 'view' | 'world'): WeaponModel;
}

// ── First-person viewmodel (src/client/world/viewmodel.ts) ────────────────

export interface ViewModelState {
  weapon: WeaponId;
  skin: string;
  /** 0..1 ADS amount. */
  ads: number;
  sprinting: boolean;
  sliding: boolean;
  crouch: number;
  /** Horizontal speed m/s. */
  speed: number;
  onGround: boolean;
  /** Reload progress 0..1, or -1 when not reloading. */
  reload: number;
  /** Swap/raise progress 0..1 (1 = fully raised). */
  raise: number;
  /** Sunspear charge 0..1. */
  charge: number;
  /** Pump/bolt cycle 0..1 (1 = done). */
  cycle: number;
  mag: number;
  magSize: number;
  /** Mouse/stick look delta this frame (radians) for sway. */
  lookDx: number;
  lookDy: number;
  /** Scoped weapon fully aimed → hide model (scope overlay shown by HUD). */
  scoped: boolean;
}

export interface ViewModel {
  /** Overlay scene + camera (rendered via RenderEngine.setOverlay). */
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  setWeapon(id: WeaponId, skin: string): void;
  update(dt: number, s: ViewModelState): void;
  fire(): void;
  dryFire(): void;
  reloadStart(empty: boolean): void;
  throwStart(kind: ThrowableId): void;
  /** Muzzle position in WORLD space given the main camera (for tracers). */
  muzzleWorld(mainCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3;
  setTeamLight(color: string): void;
  dispose(): void;
}

// ── Characters (src/client/world/characters.ts) ────────────────────────────

export interface CharacterOptions {
  faction: Faction;
  team: Team;
  cosmetics: CosmeticSelection;
  /** Friendly to the local player (affects outline/nameplate intensity, never the faction colors). */
  friendly: boolean;
  quality: QualitySettings;
  /** Menu/showcase rendering: higher detail, idle pose. */
  showcase?: boolean;
}

export interface CharacterAnim {
  /** World-space velocity. */
  vel: Vec3;
  yaw: number;
  pitch: number;
  crouch: number;
  sliding: boolean;
  airborne: boolean;
  sprinting: boolean;
  ads: boolean;
  reloading: boolean;
  mantling: boolean;
  charging: boolean;
  weapon: WeaponId;
  alive: boolean;
}

export interface CharacterView {
  readonly root: THREE.Group;
  setWeapon(id: WeaponId, skin: string): void;
  update(dt: number, a: CharacterAnim): void;
  /** Recoil / muzzle kick animation for third-person. */
  fire(): void;
  /** Hit flinch in a direction (world). */
  flinch(dir: Vec3): void;
  /** Hide the body (the dissolve particles are spawned by Effects.elimination). */
  die(): void;
  respawn(): void;
  /** Muzzle position in world space. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3;
  /** Head position in world space (nameplates, headshot FX). */
  headWorld(out: THREE.Vector3): THREE.Vector3;
  setHighlight(k: number): void;
  dispose(): void;
}

export interface CharacterFactory {
  create(opts: CharacterOptions): CharacterView;
}

// ── Effects (src/client/engine/effects.ts, particles.ts) ───────────────────

export interface Effects {
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponId, firstPerson: boolean): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, weapon: WeaponId, team: Team): void;
  impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceTag | 'player' | 'shield'): void;
  beam(from: THREE.Vector3, to: THREE.Vector3, team: Team): void;
  /** Elimination dissolve: petals of light (Bloom) or white ceramic shards (Halcyon), or an unlocked style. */
  elimination(pos: Vec3, yaw: number, faction: Faction, team: Team, fxId: string, crouch: number): void;
  explosion(pos: THREE.Vector3): void;
  smokeStart(id: number, pos: THREE.Vector3): void;
  smokeUpdate(id: number, pos: THREE.Vector3, radius: number, remaining: number): void;
  smokeEnd(id: number): void;
  /** Throwable projectile visual. */
  projectile(id: number, kind: ThrowableId, pos: THREE.Vector3, owner: number): void;
  projectileEnd(id: number): void;
  /** Soft landing/slide dust at feet. */
  dust(pos: THREE.Vector3, amount: number, surface: SurfaceTag): void;
  spawnFlash(pos: Vec3, team: Team): void;
  update(dt: number, camera: THREE.Camera): void;
  setQuality(q: QualitySettings): void;
  dispose(): void;
}

// ── Camera feel (src/client/engine/camera-feel.ts) ─────────────────────────

export interface CameraFeelInput {
  speed: number;
  sprinting: boolean;
  sliding: boolean;
  crouch: number;
  onGround: boolean;
  ads: number;
  /** Local player's look delta this frame (radians). */
  lookDx: number;
  lookDy: number;
  /** Player move axes for strafe tilt. */
  strafe: number;
}

export interface CameraFeelOutput {
  /** Local-space position offset (m). */
  pos: THREE.Vector3;
  /** Extra rotation (radians) applied after view angles. */
  pitch: number;
  yaw: number;
  roll: number;
  /** Additive FOV offset (degrees). */
  fov: number;
}

export interface CameraFeel {
  update(dt: number, s: CameraFeelInput): CameraFeelOutput;
  land(impactSpeed: number): void;
  fire(weapon: WeaponId): void;
  shake(amount: number, duration?: number): void;
  damage(fromAngle: number, amount: number): void;
  /** 0..1 multiplier from the "reduced screen shake" accessibility option. */
  setShakeScale(k: number): void;
  reset(): void;
}

// ── Audio (src/client/audio/*) ──────────────────────────────────────────────

export type UiSound = 'hover' | 'click' | 'back' | 'confirm' | 'toggle' | 'error' | 'unlock' | 'xpTick' | 'levelUp' | 'matchFound' | 'countdown' | 'go';
export type MusicState = 'off' | 'menu' | 'lobby' | 'match' | 'final' | 'victory' | 'defeat';

export interface AudioVolumes {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  ui: number;
}

export interface AudioSystem {
  /** Must be called from a user gesture before sound is audible. Safe to call repeatedly. */
  unlock(): void;
  readonly unlocked: boolean;
  setListener(pos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void;
  /** Weapon fire. `pos` undefined = local player (dry, close, stereo). */
  shot(weapon: WeaponId, pos?: Vec3, opts?: { suppressedByDistance?: boolean }): void;
  reload(weapon: WeaponId, stage: 'start' | 'mag_out' | 'mag_in' | 'chamber' | 'shell', pos?: Vec3): void;
  dryFire(weapon: WeaponId): void;
  pump(weapon: WeaponId, pos?: Vec3): void;
  charge(pos?: Vec3): void;
  swap(weapon: WeaponId): void;
  footstep(surface: SurfaceTag, pos: Vec3 | undefined, kind: 'walk' | 'sprint' | 'crouch'): void;
  jump(pos?: Vec3): void;
  land(surface: SurfaceTag, impact: number, pos?: Vec3): void;
  slide(surface: SurfaceTag, pos?: Vec3): void;
  mantle(pos?: Vec3): void;
  impact(surface: SurfaceTag | 'player', pos: Vec3): void;
  whizz(pos: Vec3): void;
  hitmarker(kind: 'body' | 'head' | 'kill' | 'headkill'): void;
  hurt(amount: number): void;
  explosion(pos: Vec3): void;
  smoke(pos: Vec3): void;
  bounce(pos: Vec3): void;
  pickup(pos?: Vec3): void;
  zone(kind: 'capturing' | 'captured' | 'lost' | 'contested'): void;
  spawn(pos?: Vec3): void;
  elimination(faction: Faction, pos: Vec3): void;
  ui(s: UiSound): void;
  setHeartbeat(intensity: number): void;
  /** Map environment: reverb character, echo amount, ambience bed and positional emitters. */
  setEnvironment(map: MapDef | null): void;
  setMusic(state: MusicState): void;
  setVolumes(v: Partial<AudioVolumes>): void;
  setHrtf(on: boolean): void;
  /** Duck music & sfx (e.g. pause menu). */
  setDuck(k: number): void;
  update(dt: number): void;
}

export interface Announcer {
  /** Speak a line (calm voice) + chime, and emit a subtitle through onSubtitle. */
  say(key: AnnouncerKey): void;
  setLang(lang: Lang): void;
  setVolume(v: number): void;
  onSubtitle(cb: (text: string, durationMs: number) => void): void;
}

// ── Input (src/client/input/*) ──────────────────────────────────────────────

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'fire'
  | 'ads'
  | 'reload'
  | 'throw'
  | 'interact'
  | 'nextWeapon'
  | 'primary'
  | 'secondary'
  | 'pickupSlot'
  | 'scoreboard'
  | 'pause';

export interface InputSystem {
  /** Last device the player used; drives on-screen glyphs/prompts. */
  readonly device: InputDevice;
  /** Whether gameplay input is captured (false in menus). */
  setGameplayActive(active: boolean): void;
  /** Movement axes, x = strafe (+right), y = forward (+forward), magnitude ≤ 1. */
  moveAxes(): { x: number; y: number };
  /** Look delta since last call in radians (sensitivity, invert and ADS multiplier applied). */
  consumeLook(): { dx: number; dy: number };
  down(a: Action): boolean;
  /** True once on the frame the action was pressed. */
  pressed(a: Action): boolean;
  /** Call at the end of each rendered frame. */
  endFrame(): void;
  /** Desktop: request pointer lock (from a user gesture). */
  lockPointer(): void;
  readonly pointerLocked: boolean;
  /** ADS state for sensitivity scaling (set by the match). */
  setAimState(adsAmount: number, zoom: number): void;
  /** Touch-only aim assist: the match provides a function returning a look nudge in radians. */
  setAimAssist(fn: ((dt: number) => { dx: number; dy: number; slow: number }) | null): void;
  /** Haptic pulse (touch devices / gamepad rumble) if enabled. */
  haptic(kind: 'hit' | 'kill' | 'damage' | 'light'): void;
  /** Show/hide the on-screen touch controls. */
  setTouchControlsVisible(v: boolean): void;
  /** Called when a device switch happens. */
  onDeviceChange(cb: (d: InputDevice) => void): () => void;
  dispose(): void;
}

// ── HUD (src/client/ui/hud/*) ───────────────────────────────────────────────

export interface HudObjective {
  id: string;
  label: string;
  /** Screen-space position in CSS px, or null if behind camera. */
  screen: { x: number; y: number } | null;
  /** Edge-clamped when off-screen. */
  offscreen: boolean;
  color: string;
  /** 0..1 progress ring. */
  progress: number;
  distance: number;
  kind: 'zone' | 'pickup' | 'friendly' | 'target';
  pulse: boolean;
}

export interface HudCompassMarker {
  /** World yaw of the marker (radians). */
  yaw: number;
  label: string;
  color: string;
  kind: 'landmark' | 'zone' | 'pickup' | 'ping';
}

export interface HudState {
  mode: ModeId;
  phase: MatchPhase;
  phaseLeft: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  respawnIn: number;
  protectedT: number;
  weapon: WeaponId;
  mag: number;
  magSize: number;
  reserve: number;
  reloading: number;
  charge: number;
  throwable: ThrowableId;
  throwables: number;
  /** Local camera yaw for the compass. */
  yaw: number;
  compass: HudCompassMarker[];
  objectives: HudObjective[];
  localTeam: Team;
  teamScores: [number, number];
  scoreLimit: number;
  /** FFA: local player's score and the leader's score. */
  ffa?: { mine: number; leader: number; rank: number };
  /** Crosshair spread in CSS px (0 = tight). */
  spread: number;
  ads: number;
  scoped: boolean;
  sprinting: boolean;
  /** Short contextual prompt (e.g. "Hold E to pick up Sunspear"). */
  prompt: string | null;
  ping: number;
  fps: number;
  showFps: boolean;
  /** Radar (circular minimap) contents; null hides the radar (e.g. training range). */
  radar?: HudRadar | null;
}

/** One radar contact. Positions are world x/z; the HUD rotates them player-up. */
export interface HudRadarBlip {
  x: number;
  z: number;
  kind: 'friend' | 'enemy' | 'zone' | 'pickup';
  color: string;
  /** 0..1 opacity (enemies fade out after they stop firing). */
  alpha: number;
  /** Zone letter ('' otherwise). */
  label: string;
  /** Facing yaw (friends' arrows). */
  yaw: number;
  /** Contested / being captured. */
  pulse: boolean;
}

export interface HudRadar {
  /** Local view position (world x/z) and yaw. */
  x: number;
  z: number;
  yaw: number;
  /** Horizontal field of view (radians) for the view cone. */
  fov: number;
  /** Reused array; only the first `count` entries are valid. */
  blips: HudRadarBlip[];
  count: number;
}

export interface KillFeedEntry {
  killer: { name: string; team: Team; local: boolean } | null;
  victim: { name: string; team: Team; local: boolean };
  cause: KillCause;
  head: boolean;
}

export interface ScoreboardEntry {
  id: number;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  objectiveTime: number;
  ping: number;
  isBot: boolean;
  local: boolean;
  level: number;
  alive: boolean;
}

export interface Hud {
  mount(parent: HTMLElement): void;
  update(dt: number, s: HudState): void;
  hitMarker(kind: 'body' | 'head' | 'kill' | 'headkill'): void;
  /** Center-screen elimination icon + name. */
  eliminated(victimName: string, head: boolean): void;
  killFeed(e: KillFeedEntry): void;
  /** Damage direction relative to view: angle radians (0 = front, +left), amount 0..100. */
  damage(angle: number, amount: number): void;
  /** Big centered banner (match start, final minute, zone captured...). */
  banner(title: string, sub?: string, color?: string): void;
  /** Subtitle line for announcer / radio. */
  subtitle(text: string, durationMs: number): void;
  /** Toast for XP/score events: '+100 Elimination'. */
  toast(text: string, color?: string): void;
  scoreboard(visible: boolean, rows: ScoreboardEntry[], mode: ModeId): void;
  setScale(k: number): void;
  setVisible(v: boolean): void;
  /** Paints the radar's map layer for the current match (null clears). */
  setRadarMap?(def: MapDef | null): void;
  /** Radar on/off from settings. */
  setRadarEnabled?(on: boolean): void;
  unmount(): void;
}

// ── UI screens (src/client/ui/*) ────────────────────────────────────────────

export type ScreenId =
  | 'menu'
  | 'play'
  | 'matchmaking'
  | 'room'
  | 'loadout'
  | 'customize'
  | 'settings'
  | 'profile'
  | 'loading'
  | 'results'
  | 'pause'
  | 'match';

export interface Screen {
  readonly id: ScreenId;
  /** Root element (created once). */
  readonly el: HTMLElement;
  /** Called after the element is attached and before the enter transition. */
  enter(params?: unknown): void;
  /** Called before the leave transition; resolve when cleanup is complete. */
  leave(): void | Promise<void>;
  /** Per-frame update while visible (optional). */
  update?(dt: number): void;
  /** Handle Escape/back; return true if handled. */
  back?(): boolean;
}

export interface UIManager {
  show(id: ScreenId, params?: unknown): Promise<void>;
  /** Show an overlay screen on top of the current one (pause, settings in-match). */
  push(id: ScreenId, params?: unknown): Promise<void>;
  pop(): Promise<void>;
  readonly current: ScreenId | null;
  toast(text: string, kind?: 'info' | 'good' | 'error'): void;
  /** Modal confirm dialog. */
  confirm(title: string, body: string, ok: string, cancel: string): Promise<boolean>;
  update(dt: number): void;
}

// ── i18n (src/client/ui/i18n.ts) ────────────────────────────────────────────

export interface I18n {
  readonly lang: Lang;
  readonly dir: 'ltr' | 'rtl';
  t(key: string, params?: Record<string, string | number>): string;
  setLang(lang: Lang): void;
  /** Format a number in the current locale (Arabic uses Western digits for readability in HUD). */
  num(n: number, digits?: number): string;
  onChange(cb: (lang: Lang) => void): () => void;
}

// ── Settings (src/client/state/settings.ts) ─────────────────────────────────

export interface KeyBinding {
  /** KeyboardEvent.code values or 'Mouse0'/'Mouse1'/'Mouse2'/'Wheel+'/'Wheel-'. Up to 2 per action. */
  keys: string[];
}

export interface Settings {
  lang: Lang;
  quality: QualityPreset;
  renderScale: number;
  fov: number;
  mouseSensitivity: number;
  adsSensitivity: number;
  touchSensitivity: number;
  gamepadSensitivity: number;
  invertY: boolean;
  toggleCrouch: boolean;
  toggleAds: boolean;
  autoSprint: boolean;
  bindings: Record<Action, KeyBinding>;
  aimAssist: boolean;
  haptics: boolean;
  /** Touch layout: button id → normalized position (0..1 of screen) and scale. */
  touchLayout: Record<string, { x: number; y: number; s: number }>;
  touchOpacity: number;
  volumes: AudioVolumes;
  subtitles: boolean;
  colorblind: ColorblindMode;
  hudScale: number;
  reducedShake: boolean;
  showFps: boolean;
  /** Show the radar minimap during matches. */
  radar: boolean;
  crosshair: 'dot' | 'cross' | 'circle';
  crosshairColor: string;
}

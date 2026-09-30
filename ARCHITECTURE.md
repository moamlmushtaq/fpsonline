# HALCYON FRONT — Architecture & Studio Bible

This document is the single source of truth for everyone (human or agent) working on the
codebase. Read it fully before writing code. The creative brief is in `docs/BRIEF.md` —
it is the product owner's word and overrides anything here if they conflict.

---------------------------------------------------------------------------------------------

## 0. Tech stack (fixed — do not add dependencies)

| Layer            | Choice                                                                    |
|------------------|---------------------------------------------------------------------------|
| Language         | TypeScript (strict), ES2022 modules                                       |
| Client renderer  | three.js 0.180 (`three` + `three/examples/jsm/*` addons allowed)           |
| Client build     | Vite 7 (`npm run build` → `dist/client`, relative `base: './'`)           |
| UI               | Plain DOM + CSS (no framework). Fonts bundled via `@fontsource/*`          |
| Audio            | Web Audio API, 100% procedural synthesis (no audio files). Web Speech API for the announcer voice (with subtitle fallback) |
| Art              | 100% procedural (geometry built in code, canvas-generated textures). No external asset files, no image downloads |
| Server           | Node ≥ 20, `ws` WebSocket server + built-in `http` (no express)           |
| Tests            | Vitest (`npm test`) for shared/server logic; Playwright (`npm run e2e`) for browser smoke tests using the preinstalled Chromium |

Allowed runtime deps: `three`, `ws`. Allowed fonts: Space Grotesk (UI), JetBrains Mono
(numbers), IBM Plex Sans Arabic (Arabic). Anything else must be written by hand.

Commands:
- `npm run dev` — single process: Node game server + Vite dev middleware on http://localhost:8080
- `npm run build && npm start` — production: `node dist/server/index.js` serves `dist/client` + WebSocket on `$PORT` (default 8080)
- `npm run typecheck` — `tsconfig.json` (client+shared, DOM) and `tsconfig.node.json` (shared+server+tests, NO DOM)
- `npm test` — vitest
- `npm run e2e` — builds nothing; expects `npm run build` first; boots the server and drives Chromium

---------------------------------------------------------------------------------------------

## 1. Runtime architecture

```
            ┌────────────────────────── Browser ───────────────────────────┐
            │  App shell (app.ts) ─ UIManager/screens ─ Profile/Settings   │
            │        │                                                     │
            │  ClientMatch (game/match.ts)                                 │
            │   ├─ Predictor (shared movement+combat, replay unacked cmds) │
            │   ├─ Interpolator (remote players rendered INTERP_DELAY ago) │
            │   ├─ MapView / Characters / ViewModel / Effects / CameraFeel │
            │   ├─ AudioSystem / Announcer / HUD / InputSystem             │
            │   └─ Transport ──┬── WebSocketTransport ──► Node server      │
            │                  └── LocalTransport ──► Web Worker           │
            └──────────────────────────────────────────────────────────────┘
      Web Worker (net/local-host.worker.ts)          Node (src/server/index.ts)
      └─ HostCore (shared/host) ─ Rooms ─ GameSim    └─ HostCore (same code!) + accounts REST + static files
```

**Key idea: one host implementation.** `src/shared/host/HostCore` (matchmaker + rooms +
GameSim + bots) runs both inside the Node server (online) and inside a Web Worker in the
browser (offline/bot matches/training). The client speaks the exact same protocol
(`src/shared/protocol.ts`) to either. Therefore:
- Training Range and Bot matches always use the LocalTransport (instant, offline-feeling).
- Quick Play / Private Rooms use the WebSocketTransport when the server is reachable.
- If the server is unreachable (e.g. static hosting), Quick Play silently falls back to a
  local bot match and the menu shows "Offline — playing with bots".

**Authority & netcode (Source/Quake model):**
- Fixed simulation at `SIM_HZ` = 60. The client samples input once per sim tick → `InputCmd`.
- Client predicts its own movement AND combat (ammo, reload, fire cooldown, recoil, spread)
  with the SAME shared functions the host uses. Spread uses a deterministic hash of
  `(playerId, seq, pellet)` so predicted tracers match the host.
- Client sends `input` messages every tick containing the last ≤ 8 unacknowledged commands.
- Host applies each player's commands in order (≤ `MAX_CMDS_PER_TICK` per tick), steps the
  world, and every `SNAPSHOT_EVERY_TICKS` sends each client a `snap` with its `SelfSnap`
  (ack seq + authoritative move/combat) + compact `PlayerSnap`s + events.
- Reconciliation: on each snap the client resets its predicted state to `self` and replays
  commands with `seq > ack`. Replays never re-trigger effects.
- Remote players are rendered `INTERP_DELAY` (100 ms) in the past by interpolating snaps.
  The client puts the host tick it is currently displaying in `InputCmd.viewTick`.
- Lag compensation: the host keeps `HISTORY_TICKS` of player positions and rewinds victims
  to `viewTick` (clamped to `MAX_REWIND`) when resolving a shooter's hitscan.
- Hit markers / damage / kills are authoritative (host events). Muzzle flash, tracer, sound,
  recoil and ammo are predicted instantly for the local player.

---------------------------------------------------------------------------------------------

## 2. Directory map & ownership

`CONTRACT` files are owned by the lead architect. Do not change their existing exports;
additive changes (new optional fields, new union members) are allowed only if you also
update every consumer, and you must mention them in your report.

```
src/shared/                         (NO DOM, NO three, NO node APIs — runs everywhere)
  types.ts constants.ts protocol.ts   CONTRACT
  weapons.ts modes.ts                 CONTRACT (numbers may be tuned by sim owners)
  cosmetics.ts progression.ts         CONTRACT
  maps/types.ts                       CONTRACT
  maps/index.ts                       map registry: getMap(id): MapDef, MAPS
  maps/gantry.ts pastel.ts observatory.ts range.ts   map data (one owner per map)
  math.ts                             vectors, angles, seeded RNG, hashing
  physics.ts                          CollisionWorld (grid broadphase, AABB + ramps, raycasts)
  movement.ts                         createMoveState / stepMovement (walk, sprint, crouch, jump, slide, mantle, step-up)
  combat.ts                           createCombatState / stepCombat / aim & spread / hitboxes / rayVsPlayer
  names.ts                            guest name generator ("Amber-Kestrel-42" style) + bot names
  sim/game.ts                         GameSim: players, damage, regen, respawn, spawns, pickups, throwables, modes, events, results
  sim/spawns.ts                       safe spawn selection (anti spawn-camping)
  sim/lagcomp.ts                      position history + rewind
  sim/nav.ts                          NavGraph auto-generated from the CollisionWorld (2.5D walkable cells + A*)
  sim/bots.ts                         BotController (recruit/veteran/elite)
  sim/range.ts                        training range targets + stats
  host/host-core.ts                   HostCore: connections, hello, matchmaker, rooms, private rooms
  host/room.ts                        Room: owns a GameSim, joins/leaves, bot fill/replace, snapshots, scoreboard, match end
  host/matchmaker.ts                  skill-banded quick-play queue with bot fill

src/server/                         (Node only)
  index.ts                            http server: static dist/client, /api/*, WebSocket /ws, dev mode with Vite middleware
  accounts.ts                         accounts store (data/accounts.json), scrypt hashes, session tokens
  ws.ts                               ws ⇄ HostCore glue, heartbeats, rate limiting

src/client/
  main.ts                             entry: boot splash → App
  app.ts                              App: services, navigation, starting/ending matches, debug hooks
  contracts.ts                        CONTRACT — interfaces for every client subsystem
  net/transport.ts                    Transport interface, WebSocketTransport, LocalTransport
  net/local-host.worker.ts            Web Worker running HostCore
  net/net-manager.ts                  server discovery (online/offline), ping, reconnect
  game/match.ts                       ClientMatch: the in-match orchestrator (render loop glue)
  game/predictor.ts                   client prediction + reconciliation
  game/interpolator.ts                snapshot buffer + interpolation of remote entities
  game/local-player.ts                builds InputCmd from InputSystem each tick
  game/tutorial.ts                    interactive 60-second tutorial (Training Range)
  engine/palette.ts                   CONTRACT — color bible + colorblind team colors
  engine/renderer.ts                  RenderEngine (WebGLRenderer, overlay pass, resize)
  engine/quality.ts                   presets + Auto (adaptive by frame time)
  engine/post.ts                      grading / bloom / painterly pass
  engine/atmosphere.ts                sky dome, sun, fog/haze, stars, weather, light shafts
  engine/materials.ts                 MaterialLibrary + procedural canvas textures
  engine/effects.ts engine/particles.ts   Effects (flashes, tracers, impacts, eliminations, smoke…)
  engine/camera-feel.ts               CameraFeel (sway, bob, landing dip, FOV kick, shake)
  world/map-builder.ts                buildMapView(def) — renders solids + invokes map decor
  world/maps/<id>.ts                  per-map DecorBuilder (signature set pieces, props, storytelling)
  world/characters.ts                 CharacterFactory (procedural soldiers, animation)
  world/weapon-models.ts              WeaponModelFactory (procedural 1970s hardware, skins, ammo screens)
  world/viewmodel.ts                  first-person ViewModel (sway, reload animations with moving parts)
  audio/audio.ts audio/sfx.ts audio/music.ts audio/spatial.ts audio/announcer.ts
  input/input.ts input/keyboard-mouse.ts input/gamepad.ts input/touch.ts input/touch-layout-editor.ts
  ui/manager.ts ui/components.ts ui/icons.ts ui/keyart.ts ui/styles/*.css
  ui/screens/<id>.ts                  menu, play, matchmaking, room, loadout, customize, settings, profile, loading, results, pause
  ui/hud/hud.ts (+ parts)             HUD
  ui/i18n.ts                          I18n implementation; dictionaries merged from ui/locales/*/*.ts
  ui/locales/en/<ns>.ts ui/locales/ar/<ns>.ts   one namespace file per subsystem (see §6)
  state/settings.ts state/profile.ts  persistence (localStorage), account sync
tests/                                vitest suites
scripts/                              build-server.mjs, e2e.mjs
```

---------------------------------------------------------------------------------------------

## 3. Shared simulation API (implemented in src/shared, consumed by host + client)

```ts
// math.ts
export function v3(x?: number, y?: number, z?: number): Vec3;
export function forwardFromAngles(yaw: number, pitch: number, out?: Vec3): Vec3; // see types.ts
export function wrapAngle(a: number): number;           // → (-π, π]
export function hash32(...ints: number[]): number;       // deterministic
export function hashFloat(...ints: number[]): number;    // [0,1)
export function mulberry32(seed: number): () => number;
// …plus add/sub/scale/len/normalize/dot/cross/lerp/clamp/dist helpers

// physics.ts
export interface RayHit { dist: number; point: Vec3; normal: Vec3; solid: Solid }
export type RayMode = 'bullet' | 'sight' | 'move';   // bullet: ignores shootThrough; move: ignores walkThrough
export class CollisionWorld {
  constructor(solids: Solid[], bounds: AABB);
  readonly solids: readonly Solid[];
  readonly bounds: AABB;
  raycast(origin: Vec3, dir: Vec3, maxDist: number, mode?: RayMode): RayHit | null;
  /** Highest walkable surface under (x,z) at or below fromY (within maxDrop). Handles ramps. */
  groundAt(x: number, z: number, fromY: number, maxDrop: number): { y: number; solid: Solid } | null;
  /** Does a player cylinder/box at feet position `pos` with `height` intersect any solid? */
  playerOverlaps(pos: Vec3, height: number): boolean;
  /** Line of sight between two points (mode 'sight'). */
  visible(a: Vec3, b: Vec3): boolean;
}

// movement.ts
export function createMoveState(pos: Vec3): MoveState;
export function stepMovement(world: CollisionWorld, m: MoveState, cmd: InputCmd, speedMult: number, dt: number): void;
export function playerHeight(m: MoveState): number;   // lerp(PLAYER_HEIGHT, PLAYER_CROUCH_HEIGHT, crouchT)
export function eyeHeight(m: MoveState): number;      // lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, crouchT)

// combat.ts
export function createCombatState(loadout: Loadout): CombatState;
export interface ShotRequest { weapon: WeaponId; origin: Vec3; dirs: Vec3[] }   // one dir per pellet
export interface CombatStepResult {
  shot: ShotRequest | null;       // fired this tick (host resolves hits; client predicts FX)
  dryFire: boolean;
  reloadStarted: boolean;
  reloadEmpty: boolean;
  swappedTo: WeaponId | null;
  throwRequested: boolean;        // host spawns the throwable
  chargeStarted: boolean;
  cycled: boolean;                // pump/bolt cycle began
}
/** Advances timers, ADS, reload, swap, fire decisions. Deterministic. */
export function stepCombat(c: CombatState, m: MoveState, cmd: InputCmd, playerId: number, dt: number): CombatStepResult;
export function speedMultiplier(c: CombatState): number;     // weapon move speed × ADS slow
export function currentSpread(c: CombatState, m: MoveState): number;  // radians (HUD crosshair)
export function aimAngles(cmd: InputCmd, c: CombatState): { yaw: number; pitch: number }; // view + recoil
export interface Hitboxes { head: { c: Vec3; r: number }; body: { min: Vec3; max: Vec3 } }
export function hitboxes(pos: Vec3, crouchT: number, out?: Hitboxes): Hitboxes;
export function rayVsHitboxes(o: Vec3, d: Vec3, maxDist: number, hb: Hitboxes): { dist: number; head: boolean } | null;

// sim/game.ts
export class GameSim {
  constructor(config: GameConfig, map: MapDef, seed: number);
  readonly config: GameConfig; readonly map: MapDef; readonly world: CollisionWorld;
  tick: number;
  addPlayer(ident: Omit<PlayerIdentity, 'id' | 'team'> & { team?: Team }): PlayerIdentity; // assigns id + balanced team
  removePlayer(id: number): void;
  replaceBotWith(ident: …): PlayerIdentity | null;   // human takes a bot's slot mid-match
  setLoadout(id: number, loadout: Loadout): void;
  pushInputs(id: number, cmds: InputCmd[]): void;      // ignores seq ≤ last received
  step(): void;                                        // one SIM_DT
  clock(): MatchClock;
  identities(): PlayerIdentity[];
  buildSnapshot(forId: number | null): Omit<SnapshotMsg, 'type' | 'events'>;
  drainEvents(): { ev: GameEvent; to?: number; except?: number }[];
  scoreboard(): ScoreboardRow[];
  results(): MatchResults;
  readonly finished: boolean;                          // ended + outro elapsed
}
```

Host API (`src/shared/host/host-core.ts`):
```ts
export interface HostConnection { readonly id: string; send(msg: ServerMsg): void; readonly rttMs?: number }
export interface AccountHooks {
  resolve(token: string): Promise<{ name: string; rating: number } | null>;
  recordMatch(token: string, rating: number): void;
}
export class HostCore {
  constructor(opts: { kind: 'online' | 'local'; accounts?: AccountHooks; log?: (...a: unknown[]) => void; maxRooms?: number });
  connect(conn: HostConnection): void;
  receive(conn: HostConnection, msg: ClientMsg): void;
  disconnect(conn: HostConnection): void;
  /** Drive from a timer every ~4–16 ms. Uses a fixed-step accumulator internally (never more than 8 steps per call). */
  update(nowMs: number): void;
  readonly onlineCount: number;
}
```

---------------------------------------------------------------------------------------------

## 4. Client orchestration

- `App` (app.ts) creates services once: `RenderEngine`, `AudioSystem`, `Announcer`,
  `InputSystem`, `UIManager`, `I18n`, `SettingsStore`, `ProfileStore`, `NetManager`,
  `MaterialLibrary`, `CharacterFactory`, `WeaponModelFactory`. Screens receive the `App`.
- `App` methods: `quickPlay(mode?)`, `botMatch(mode, map, difficulty)`, `training(tutorial)`,
  `createRoom(opts)`, `joinRoom(code)`, `leaveMatch()`, `openScreen(id)`.
- URL entry points: `?room=CODE` joins a private room; `?debug=1` exposes `window.__HF`
  (see §9); `?server=wss://host/ws` overrides the server URL; `?lang=ar`.
- `ClientMatch` (game/match.ts) is created per match. It owns the transport subscription,
  predictor, interpolator, map view, characters, viewmodel, effects, camera feel, HUD, and
  translates events into feedback (FX, audio, HUD, haptics, announcer).
- Render loop: `requestAnimationFrame` → fixed-step input sampling (60 Hz accumulator) →
  predictor → interpolation → update views → `engine.render()`. Hard rule: never allocate in
  the per-frame hot path if avoidable (reuse vectors), keep draw calls low (merge static
  geometry, instancing), and never block on network.

---------------------------------------------------------------------------------------------

## 5. Art bible (THE most important section)

**Style:** stylized realism with a painterly finish — simple, confident shapes, rich light.
Think 1970s sci-fi paperback covers (Chris Foss, Syd Mead, Robert McCall) filtered through
modern stylized games. Every frame should be a book-cover illustration.

**Shapes:** chamfered/beveled boxes, cylinders, capsules, rounded ceramic shells. Use
`RoundedBoxGeometry`, `LatheGeometry`, `ExtrudeGeometry` with bevels, tubes. Avoid noisy
detail; build big readable masses with a few crisp accent details. Megastructures are huge,
brutalist, sun-bleached; suburban houses are pastel modernist (flat/butterfly roofs,
breeze-block walls, carports, round windows).

**Color:** read ALL colors from `engine/palette.ts`.
- Environment = warm dusty neutrals (sand, bone, faded terracotta, sky blue, sage).
- Saturation budget is reserved for gameplay: players (team colors), objectives, pickups
  (gold), danger (red). Team orange/teal/violet NEVER appear in environment art.
- Environmental bioluminescence = chartreuse + pale gold (+ soft pink), never teal.
- Shadows are tinted cool-violet (`shadowCool`), never pure black. Highlights warm.

**Lighting:** one signature mood per map (Gantry = sunset over the sea, Pastel = warm
golden late afternoon, Observatory = blue-violet dusk above clouds with stars appearing).
Low sun → long shadows. Exponential haze that deepens with distance and takes the sky's
horizon color (aerial perspective). Fake volumetric shafts through broken roofs (additive
gradient cones/cards, soft-edged, with dust motes). Emissive plants in shaded areas + bloom.

**Materials:** `MeshStandardMaterial`/`MeshLambertMaterial` on low preset. Procedural canvas
textures with brush-stroke noise, edge wear, subtle scratches; never photographic. Use
vertex colors/ambient-occlusion-by-color (darken bottoms, crevices) to fake GI cheaply.

**Characters:** silhouettes readable at 80 m by shape alone.
- HALCYON: tall, clean, symmetric; rounded ceramic-white helmet with a horizontal visor line;
  broad smooth pauldrons; backpack with antenna; orange accent stripes; calm upright posture.
- THE BLOOM: hunched/asymmetric; organic layered armor fused with plants; leaf-fronds and
  glowing bulbs on one shoulder; hooded or crest-like helmet; teal emissive visor + violet
  accents; loose fabric wraps.
- Emissive visor line in team color (from `teamColors()` — colorblind aware).

**Weapons:** premium 1970s industrial design (Braun/Dieter Rams, Olivetti, NASA hardware):
rounded metal receivers, ceramic shells, knurled grips, analog dials, a tiny glowing
ammo-counter screen (canvas texture) on each weapon. Visible moving parts on reload
(magazine out/in, bolt, pump, drum, cylinder, charge coils).

**Effects:** crisp starburst muzzle flashes (2–3 crossed sprite cards, 1–2 frames), small
spark (metal) or dust (stone/sand) bursts, no gore, no blood. Eliminations dissolve into
drifting light petals (Bloom) or white ceramic shards (Halcyon). Smoke = warm peach/amber
mist. Sunspear = bright gold-white beam with a lingering afterglow.

**Camera feel:** subtle weapon sway, gentle landing dip, slight sprint FOV kick (+6°),
small satisfying shake — never nauseating; honor `reducedShake`.

## 6. UI bible

- Minimal retro-futurist: thin 1 px lines, 10–14 px rounded corners, translucent warm-dark
  panels with backdrop blur (disable blur on low), small analog-dial/tick-mark details,
  warm off-white text (`UI.text`), numbers in JetBrains Mono, UI text in Space Grotesk,
  Arabic in IBM Plex Sans Arabic.
- Every interactive element has hover, press (scale .97), focus-visible, and sound (ui()).
- Transitions: 220–380 ms, cubic-bezier(.2,.8,.2,1); screens slide/fade; stagger lists.
- No unexplained buttons: every icon button has a label or tooltip.
- **i18n:** every user-visible string goes through `i18n.t(key)`. Each subsystem owns a
  namespace file pair: `ui/locales/en/<ns>.ts` and `ui/locales/ar/<ns>.ts`, each
  `export default { 'ns.key': 'text', … } satisfies Record<string,string>`. Keys are
  prefixed by namespace (`menu.play`, `hud.reloading`, `weapon.meridian.name`…). Arabic
  must be real, natural Arabic (not transliteration). Layout must work in RTL:
  use logical CSS properties (`margin-inline-start`, `inset-inline-end`, `text-align: start`).
  HUD mirrors in RTL except the compass and gameplay-spatial elements. Numbers stay LTR
  (`dir="ltr"` / `unicode-bidi: isolate` on numeric spans).
- HUD layout: health bottom-left, ammo bottom-right, compass bar top, kill feed top-right,
  timer + score top-center, objectives as world-anchored team-colored markers.
- Touch: minimum 48 px targets, safe-area insets (`env(safe-area-inset-*)`).

## 7. Audio bible

All procedural (Web Audio). Warm, analog, tactile.
- Each weapon has a distinct identity: Meridian = punchy mid "thok" with brassy tail;
  Swift = tight high rattle; Longline = deep crack + long echo + bolt clack; Breaker = boomy
  low thump + pump "chk-chk"; Pulse = snappy electronic-tinged pop; Sunspear = rising
  charge whine → bright zap-roar.
- Spatial: PannerNode (HRTF on high), distance filtering (low-pass with distance), echo
  (convolution or tuned delays) scaled by map `audio.echo`. Footsteps and enemy reloads
  must communicate direction and distance.
- Hitmarker: crisp tick; headshot: brighter ping with ring; elimination: satisfying
  two-note chime + low thump.
- Music: warm analog synth (detuned saws, tape-wobble pads, arpeggios), calm menu theme;
  match layer; final-minute intensity layer (drums, faster arps); victory/defeat stingers.
- Heartbeat under 35% health. Announcer: calm voice via speechSynthesis + chime + subtitle.

## 8. Performance budget

- Target 60 fps on mid phones at Medium/Auto, 120+ fps on desktop High.
- Draw calls: < 250 (high), < 150 (low). Merge static map geometry per material
  (`BufferGeometryUtils.mergeGeometries`), use `InstancedMesh` for repeated props.
- One shadow-casting light (sun), shadow camera follows the player, 1024–2048 map.
- Particle pools preallocated; no per-frame allocations in hot paths.
- Low preset: no post, no shadows (or blob shadows), pixel ratio ≤ 1, decor 0.35.

## 9. Debug & test hooks

When the URL contains `debug=1`, `window.__HF` exposes:
```ts
{
  app,                                 // App instance
  botMatch(mode, map, difficulty),     // start a local bot match immediately
  training(tutorial?: boolean),
  state(): { screen, inMatch, phase, fps, players, you, health, ammo, drawCalls },
  simulateInput(actions: Partial<Record<Action, boolean>>, look?: {dx, dy}), // injects input
  setTimeScale?(k)
}
```
`scripts/e2e.mjs` uses these hooks with Playwright + Chromium (SwiftShader WebGL:
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) to smoke-test
menus, a bot match on each map, touch layout on a phone viewport, and Arabic RTL, and
saves screenshots to `artifacts/`.

## 10. Code conventions

- Strict TS, no `any` in public APIs. Small focused modules (< ~900 lines each; split otherwise).
- Comments explain *why*; top-of-file comment explains the module's role.
- Deterministic shared code: never use `Math.random()` or `Date.now()` inside `src/shared/`
  simulation paths — use seeded RNG / tick counters.
- Client code must degrade gracefully: WebGL context loss, no audio, no speechSynthesis,
  no pointer lock, no vibration, no Worker (fallback to main-thread host).
- Do not commit generated files (`dist/`, `artifacts/`, `data/`).

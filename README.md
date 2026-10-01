# HALCYON FRONT

A retro-futurist online multiplayer first-person shooter that runs in the browser — desktop, laptop, tablet and phone — with no install.

Earth, 2090. The clean ceramic soldiers of **HALCYON** and the bioluminescent scavengers of **THE BLOOM** fight over the last working launch towers of a collapsed 1970s-style space age.

- **6 weapons**: Meridian AR, Swift SMG, Longline marksman rifle, Breaker pump shotgun, Pulse sidearm, and the Sunspear charge rifle (map pickup). Plus a smoke canister or pulse grenade per life. Each weapon has its own sound, reload animation and 3 unlockable skins.
- **Modes**: Team Deathmatch (5v5), Launch Control (3 zones, with a rocket launch finale), Free-for-All (up to 8), Training Range with a 60-second interactive tutorial, bot matches (Recruit / Veteran / Elite), and private rooms joined by link or code.
- **Maps**: Gantry (coastal launch site at sunset), Pastel (overgrown 1970s suburb and flooded mall), Observatory (mountaintop dome above the clouds at dusk).
- **Cross-platform**: mouse and keyboard with rebindable keys, gamepad, and touch. Touch has a floating joystick, drag-to-aim, an editable button layout, optional aim assist and haptics.
- **HUD**: health, ammo, compass, kill feed, objective markers and a radar minimap (map, teammates, objectives, enemies that open fire).
- **Accessibility**: colorblind modes, subtitles, HUD scale and reduced screen shake. English and Arabic, with full right-to-left layout.
- **Progression**: XP and levels that unlock weapon skins, armor tints, visors, name cards and elimination effects. Everything is cosmetic; nothing is pay-to-win.
- **Assets**: all art and audio are procedural. There are no asset files.

## Run it

Requires Node 20+.

```bash
npm ci
npm run dev            # http://localhost:8080 — game server + Vite dev middleware with hot reload
```

Production:

```bash
npm run build          # client → dist/client, server → dist/server
PORT=8080 npm start    # serves the game, the WebSocket endpoint (/ws) and the accounts API on one port
```

Open the URL and press **PLAY**. If the game server can't be reached (for example on a static host), PLAY starts a local bot match that runs in a Web Worker. The Training Range and bot matches always run locally.

Useful URL parameters: `?room=CODE` (join a private room), `?lang=ar`, `?server=wss://host/ws`, `?debug=1` (exposes `window.__HF` test hooks).

## Deploy

| Target | How |
|---|---|
| Docker | `docker build -t halcyon-front . && docker run -p 8080:8080 -v halcyon-data:/app/data halcyon-front` |
| Render | Uses `render.yaml` (build: `npm ci && npm run build`, start: `npm start`, health check `/healthz`). Enable the disk block to keep accounts across deploys. |
| Fly.io | `fly launch --no-deploy --copy-config && fly deploy` (see `fly.toml` for the optional volume) |
| Static only | Upload `dist/client/` to any static host. You get full offline play against bots, but no online matches or accounts. |

Server environment variables: `PORT`, `HOST`, `DATA_DIR` (accounts store, default `./data`), `TRUST_PROXY`, `PROXY_HOPS`, `MAX_ROOMS`, `MAX_CONNECTIONS`, `MAX_CONN_PER_IP`, and for the [admin console](#admin-console) `ADMIN_PASSWORD` (unset = admin disabled online) and `ADMIN_ACCOUNTS` (optional, comma-separated account names).

Build-time variable: `VITE_ADMIN_CODE` sets the offline admin code baked into the client (default `halcyon2090`; only a salted SHA-256 of it ships in the bundle). Set it when you build: `VITE_ADMIN_CODE='my-code' npm run build`, `docker build --build-arg VITE_ADMIN_CODE='my-code' …`, or as an environment variable on Render (Render applies env vars to the build). On Fly.io, pass `--build-arg VITE_ADMIN_CODE=…` to `fly deploy` and set the server password with `fly secrets set ADMIN_PASSWORD=…`.

## Admin console

A hidden cheat console for the game's owner. There is no visible button.

- **Open it**: press <kbd>`</kbd> (Backquote) or <kbd>F8</kbd>, in menus or in a match. On a phone or tablet, open **Settings** (from the menu or the pause menu) and tap the **Build** label at the bottom 7 times quickly. <kbd>Esc</kbd> closes it.
- **Sign in**: type `admin <code>`. Until you do, every command answers "unknown command". Access is remembered for the browser tab (sessionStorage).
  - Offline (bot matches, training): the code is checked against `VITE_ADMIN_CODE` (default `halcyon2090`).
  - Online: the server checks the password against `ADMIN_PASSWORD` (constant-time compare). After 5 wrong attempts a connection is locked out for 60 s. If `ADMIN_ACCOUNTS` is set, you must also be signed in to one of those accounts. Grants, refusals and every cheat are written to the server log. With `ADMIN_PASSWORD` unset, admin is disabled online.
- **Commands** (type `help`): `god`, `ammo`, `speed <1..3>`, `sunspear`, `killbots`, `freezebots`, `teleport <A|B|C|spawn>`, `endmatch [win]`, `wallhack`, `unlockall`, `xp <amount>`, `status`, `clear`, `logout`. Toggles take an optional `on`/`off`.
- **Cheat panel**: `menu` or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> opens a panel with the same toggles and buttons. On touch, tap the red **ADMIN** tag on the HUD (it appears once you're authorized in a match), or tap the build label 7 times again.
- God, ammo, speed, bot freeze, teleport, kills and match end run on the host, so they also work online. Wallhack is client-side and only turns on offline or when the server has authorized you. `unlockall` and `xp` change your profile; for signed-in accounts they sync like normal progress. God, ammo, speed and wallhack stay on for later matches in the same tab.
- While a cheat is on, a red **ADMIN** tag lists it on the HUD, so screenshots and streams show it. Online matches where a cheat was used are unrated.

## Test

```bash
npm run typecheck      # client (DOM) and shared/server (no DOM) configs
npm test               # vitest: simulation, movement, combat, bots, nav, maps, host, server, netcode
npm run build && npm run e2e   # Playwright + Chromium: offline, online, touch, Arabic RTL, range, finale
```

## How it's built

- **One host, two places.** `src/shared/host` (matchmaking, rooms, the deterministic `GameSim`, bots) runs inside the Node server for online play, and inside a browser Web Worker for offline play. The client speaks the same protocol to both.
- **Netcode.** Fixed 60 Hz simulation. The client predicts its own movement and combat with the same shared code, and reconciles against authoritative snapshots (20 Hz). Remote players are interpolated. Hitscan uses lag compensation.
- **Rendering.** three.js with a merged-geometry map builder, procedural painterly materials, sky and atmosphere, grading/bloom/painterly post-processing, and Low/Medium/High presets plus an adaptive Auto preset.
- **UI.** Plain DOM and CSS, bundled fonts, and i18n namespaces in `src/client/ui/locales/{en,ar}`.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full studio bible (module map, contracts, art/audio/UI rules) and [`docs/BRIEF.md`](docs/BRIEF.md) for the original product brief.

Dev tools: `preview.html` (map, character, weapon, viewmodel and effects preview harness; open it from `npx vite`) and `scripts/shot.mjs` (headless screenshots).

## Known limitations

- The Arabic HUD is mirrored (health bar on the right), following the RTL convention in `ARCHITECTURE.md`. The brief places health bottom-left; flip `dir` handling in `src/client/ui/hud` if you prefer it unmirrored.
- Distance labels in the Arabic HUD still use a Latin "m".
- On a static host the browser logs one harmless 404 when the client checks for a game server.
- The announcer uses the device's built-in speech voices, so voice quality varies by platform. Subtitles always work.
- On Render's free plan the filesystem is ephemeral, so accounts reset on redeploy unless you attach a disk.
- Admin console: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> is also Chrome's "search tabs" shortcut, so Chrome may take it first; `menu` always works. The offline code is checked in the browser, so anyone who reads the bundle can try to brute-force its hash. It only affects that player's own offline game. The online lockout is per connection, so a client that reconnects gets a fresh 5 attempts; use a long `ADMIN_PASSWORD`.

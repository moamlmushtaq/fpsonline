# HALCYON FRONT — Creative Brief (verbatim from the product owner)

Build a complete, polished, online multiplayer first-person shooter called "HALCYON FRONT" that runs in the browser and feels premium on every device: desktop, laptop, tablet and phone. It should open instantly from a link, with no install, and feel like a finished commercial game rather than a prototype.

## 1. CORE IDENTITY
Tone: fast, readable, stylish, competitive but welcoming. The player should feel skilled within 60 seconds and still be improving after 60 hours.

Setting: Earth, year 2090. A retro-futurist world built by an optimistic 1970s-style space age that quietly collapsed. Sun-bleached concrete megastructures, abandoned orbital launch sites, pastel modernist towns half-swallowed by glowing overgrowth. Two factions fight over the last working launch towers:
- HALCYON: clean, ceramic-white armor with warm orange accents, calm and disciplined.
- THE BLOOM: scavengers fused with the bioluminescent plant life, teal and violet, organic and unpredictable.

## 2. ART DIRECTION (the most important part)
Style: stylized realism with a painterly finish. Simple, confident shapes with rich lighting, not photorealism. Every frame should look like a sci-fi book cover illustration.

Color language:
- Environments use warm, dusty neutrals: sand, bone white, faded terracotta, sky blue.
- Only gameplay-relevant things are saturated: enemies, objectives, pickups and danger.
- Team colors (orange vs teal) are never used in the environment, so players are always readable at a glance.

Lighting: long golden-hour shadows, soft atmospheric haze that deepens with distance, volumetric light shafts through broken ceilings, and glowing plant life in shaded areas. Each map has one signature lighting mood.

Characters: strong silhouettes that can be identified from far away by shape alone. Clean armor panels, subtle wear and scratches, and emissive visor lines in the team color.

Weapons: industrial-designed like premium 1970s hardware, with rounded metal, ceramic shells, analog dials and little ammo counter screens. Each weapon has visible moving parts when reloading.

Effects: stylized rather than messy. Muzzle flashes are crisp starburst shapes, impacts give small spark or dust bursts, and eliminations dissolve into drifting petals of light (Bloom) or white ceramic shards (Halcyon). No gore.

Camera feel: subtle weapon sway, a gentle landing dip, a slight FOV kick when sprinting, and screen shake that is small and satisfying, never nauseating.

## 3. GAMEPLAY FEEL
Movement: responsive and fluid. Sprint, crouch, jump, a short slide from sprint, and mantling over waist-high ledges. Movement should feel skillful without being chaotic.

Shooting: every shot should feel impactful. Hit markers with a crisp sound, a distinct sound and marker for headshots, a satisfying elimination sound with a small center-screen icon, and readable recoil patterns that can be learned.

Time to eliminate: medium. Enough time to react and fight back, short enough that positioning matters.

Health: regenerates after a few seconds out of combat. The screen edges show damage direction clearly.

## 4. WEAPONS (6 at launch, each with a clear role)
- "Meridian" assault rifle: reliable all-rounder.
- "Swift" SMG: fast close-range, high mobility.
- "Longline" marksman rifle: precise, rewarding headshots.
- "Breaker" shotgun: powerful at short range, satisfying pump action.
- "Pulse" sidearm: quick backup weapon.
- "Sunspear" charge rifle: charges up and fires a bright beam, found only as a map pickup.

Plus one throwable per player: a smoke canister that releases warm-colored mist, or a pulse grenade.
Each weapon has its own sound identity, reload animation and 3 cosmetic skins.

## 5. GAME MODES
- Team Deathmatch (5v5): the default quick-play mode.
- Launch Control: capture and hold three zones; the winning team triggers a rocket launch visible across the map at the end of the match.
- Free-for-All (up to 8 players).
- Training Range: solo practice against moving targets, with stats.
- Bot matches: offline-feeling practice against AI bots of 3 difficulty levels, also used to fill empty slots when few players are online.
- Private rooms: create a room and share a link or short code to play with friends.

Match length: 6–8 minutes. Short sessions suitable for phones.

## 6. MAPS (3 at launch, each with its own identity)
- "Gantry": a coastal rocket launch site at sunset. Huge launch tower in the center, long sightlines on the outskirts, tight maintenance tunnels inside.
- "Pastel": an abandoned 1970s-style suburb overgrown with glowing vines. Houses, backyards, a flooded shopping mall. Close-range, vertical.
- "Observatory": a mountaintop observatory above the clouds at dusk. A rotating telescope dome in the center, wind-blown snow, stars appearing as the match goes on.

Map design rules: three main lanes, clear landmarks visible from anywhere to help orientation, no spawn camping, balanced sightlines, and small environmental storytelling details (old posters, abandoned lunch boxes, a radio still playing).

## 7. CROSS-PLATFORM EXPERIENCE
All devices play together in the same matches.

Desktop: mouse and keyboard with fully rebindable keys, adjustable sensitivity, and gamepad support.

Mobile and tablet:
- Left side: floating virtual joystick that appears where the thumb touches.
- Right side: drag to aim, with a fire button, aim button, jump, crouch/slide, reload and weapon swap.
- A gentle, optional aim assist for touch players only.
- Button layout can be customized by dragging buttons around the screen.
- Landscape orientation with a clear prompt to rotate the phone.
- Haptic feedback on hits and eliminations where supported.

Graphics presets: Low, Medium, High and Auto. Auto picks the best quality the device can handle smoothly. Smooth gameplay always matters more than visual detail; weaker phones get simpler effects but keep the same art direction and colors.

## 8. UI / HUD
Style: minimal, clean, retro-futurist. Thin lines, rounded corners, a monospace-style font for numbers, warm off-white text, and small analog-dial details.

HUD: health bar at bottom left, ammo counter at bottom right, a small compass bar at the top instead of a minimap, a compact kill feed at top right, objective indicators in team color, and a clean match timer and score at top center.

Menus: the main menu shows the player's character standing in a slowly rotating 3D scene at sunset with ambient music. One big "PLAY" button, then quick access to Loadout, Customize, Settings and Profile. Every screen transition is smooth and animated.

Every interaction must have feedback: hover, press, hit, reward.

Language: English and Arabic, with full right-to-left layout for Arabic.

## 9. AUDIO
Music: warm analog synth, 1970s sci-fi inspired, calm in menus and more intense in the final minute of a match.
Sound design: sounds that tell you direction and distance (footsteps, enemy reloads), a distinct sound for each weapon, a satisfying echo in open maps, and a subtle heartbeat at low health.
Announcer: calm, short voice lines ("Zone captured", "Final minute", "Victory").

## 10. ONLINE & PROGRESSION
- Play instantly as a guest with an auto-generated name; an optional account saves progress.
- Quick matchmaking that finds a game in seconds and fills with bots when needed.
- Player level with XP from matches, unlocking weapon skins, character colors, visor styles, name cards and elimination effects.
- Everything unlockable is cosmetic only. No pay-to-win.
- End-of-match screen: winning team, MVP highlight, personal stats (eliminations, accuracy, objective time) and XP gained with an animated progress bar.
- Simple anti-frustration: new players are matched with players of similar skill.

## 11. FIRST-TIME EXPERIENCE
From opening the link to the first shot fired: under 30 seconds.
A 60-second optional interactive tutorial in the Training Range that teaches movement, shooting and objectives through doing, not reading.
A short loading screen with lore tips and beautiful key art from the three maps.

## 12. QUALITY BAR
- Consistent art direction across every screen, icon and effect.
- No placeholder art, no empty screens, no unexplained buttons.
- Smooth, stable performance is a priority on every device.
- Clear accessibility options: colorblind modes, subtitle toggle, adjustable HUD size, and reduced screen shake.
- The whole experience should feel crafted, cohesive and confident, as if made by a small, talented studio.

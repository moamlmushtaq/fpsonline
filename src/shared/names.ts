// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — player names: guest name generator ("Amber-Kestrel-42"),
// bot callsigns, and name sanitization for the host.
// Deterministic: all generators take an RNG (use mulberry32) — no Math.random.
// ─────────────────────────────────────────────────────────────────────────────

export const NAME_MIN = 3;
export const NAME_MAX = 16;

const ADJECTIVES = [
  'Amber', 'Azure', 'Brass', 'Cobalt', 'Coral', 'Dusty', 'Ember', 'Gilded', 'Hazel', 'Ivory',
  'Jade', 'Lunar', 'Misty', 'Ochre', 'Olive', 'Pale', 'Quiet', 'Rusty', 'Sable', 'Sage',
  'Solar', 'Tawny', 'Umber', 'Velvet', 'Warm', 'Zephyr', 'Copper', 'Dune', 'Sandy', 'Bright',
];

const NOUNS = [
  'Kestrel', 'Heron', 'Falcon', 'Comet', 'Orbit', 'Lynx', 'Otter', 'Pilot', 'Rover', 'Signal',
  'Swift', 'Tern', 'Vesper', 'Wren', 'Atlas', 'Beacon', 'Cedar', 'Delta', 'Echo', 'Fern',
  'Gantry', 'Harbor', 'Juniper', 'Meteor', 'Nomad', 'Quasar', 'Relay', 'Sparrow', 'Tundra', 'Yarrow',
];

/** Bot callsigns: short, readable at a glance, faction-neutral. */
const BOT_NAMES = [
  'Ansel', 'Birch', 'Calder', 'Dorian', 'Eames', 'Fable', 'Gale', 'Halley', 'Ines', 'Juno',
  'Kepler', 'Lumen', 'Mira', 'Nadir', 'Orla', 'Pax', 'Quill', 'Rhea', 'Soren', 'Tycho',
  'Umbra', 'Vega', 'Wilder', 'Xeno', 'Yuri', 'Zora', 'Arlo', 'Bram', 'Cleo', 'Dune',
  'Ember', 'Faro', 'Gemma', 'Holt', 'Iris', 'Jett', 'Koa', 'Lark', 'Milo', 'Nova',
];

/** Guest name like "Amber-Kestrel-42" (≤ 16 characters). */
export function guestName(rng: () => number): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const a = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length) % ADJECTIVES.length];
    const n = NOUNS[Math.floor(rng() * NOUNS.length) % NOUNS.length];
    const d = 10 + Math.floor(rng() * 90);
    const name = `${a}-${n}-${d}`;
    if (name.length <= NAME_MAX) return name;
  }
  return `Pilot-${10 + Math.floor(rng() * 90)}`;
}

/** Picks a bot callsign not present in `taken` (case-insensitive). */
export function botName(rng: () => number, taken: ReadonlySet<string> | readonly string[] = []): string {
  const used = new Set<string>();
  for (const t of taken as Iterable<string>) used.add(t.toLowerCase());
  const start = Math.floor(rng() * BOT_NAMES.length);
  for (let i = 0; i < BOT_NAMES.length; i++) {
    const n = BOT_NAMES[(start + i) % BOT_NAMES.length];
    if (!used.has(n.toLowerCase())) return n;
  }
  for (let k = 2; k < 1000; k++) {
    const n = `${BOT_NAMES[start]}-${k}`;
    if (!used.has(n.toLowerCase())) return n;
  }
  return `Bot-${Math.floor(rng() * 10000)}`;
}

/**
 * Sanitizes a user-provided name: strips control/format characters and anything
 * outside letters (any script, incl. Arabic), digits, space, '-', '_', '.';
 * collapses whitespace; trims to NAME_MAX. Returns null if fewer than NAME_MIN
 * visible characters remain.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFC');
  s = s.replace(/[^\p{L}\p{M}\p{N} _.\-]/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  // Trim leading/trailing punctuation so names don't look like "---".
  s = s.replace(/^[_.\-\s]+|[_.\-\s]+$/g, '');
  const chars = Array.from(s);
  if (chars.length > NAME_MAX) s = chars.slice(0, NAME_MAX).join('').trim();
  if (Array.from(s).length < NAME_MIN) return null;
  return s;
}

/** Makes `name` unique against `taken` (case-insensitive) by appending a number, staying ≤ NAME_MAX. */
export function dedupeName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  for (let k = 2; k < 10000; k++) {
    const suffix = String(k);
    const base = Array.from(name).slice(0, NAME_MAX - suffix.length).join('');
    const cand = base + suffix;
    if (!taken(cand)) return cand;
  }
  return name;
}

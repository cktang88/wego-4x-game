// The art bible's tokens in code (docs/ART-BIBLE.md is the source of truth; client/src/art/kit.css mirrors these
// as CSS custom properties). New art reads from here, not from ad-hoc hex values.

/** Materials: the few physical things the whole game is made of. */
export const MATERIAL = {
  // the table and the dark of the room
  ink: '#07080c', soot: '#0e0f13', umbra: '#16171c',
  // gunmetal / blued steel plates
  steel950: '#121318', steel900: '#1b1d23', steel800: '#262932', steel700: '#353945', steel500: '#5b6170', steel300: '#9aa1ae',
  // aged brass (trim, engraving, rules)
  brass900: '#3a2810', brass700: '#6b4a1c', brass500: '#a87a35', brass400: '#c8964a', brass300: '#dcb46c', brass200: '#efd59a', brass100: '#fbedc8',
  // vellum / parchment
  vellum: '#e9dcbc', vellumShade: '#c9b48a', vellumDeep: '#9c845a', inkOnVellum: '#2a1d10',
  // felt of the war table
  felt: '#121a22', feltLit: '#1d2731',
  // sealing wax
  wax: '#8e1f1f', waxHi: '#c2453a', waxLo: '#4a0d0e',
} as const;

/** Text on dark chrome, and on vellum. */
export const TEXT = {
  ivory: '#ece3cf', parchment: '#c4b89c', faded: '#958a74', engraved: '#d9b26a', ink: '#2a1d10', inkFaded: '#6b5638',
} as const;

/** Faction enamels: the owner colour as a fired enamel, not a screen neon. `hi` for lit edges and text on dark,
 *  `lo` for recesses and territory hatching. The old neon hexes (#3fd0ff, #ff4f7b, #ffd23f) retire. */
export const FACTION = {
  azure:   { name: 'Azure Compact',          base: '#2f6ea6', hi: '#7fb3dc', lo: '#163556', metal: 'silver' },
  crimson: { name: 'Crimson Dominion',       base: '#a3303a', hi: '#dc6a66', lo: '#4f1117', metal: 'brass' },
  gilded:  { name: 'Gilded Throneholders',   base: '#c79a2c', hi: '#f0cf72', lo: '#5e4410', metal: 'gold' },
  warden:  { name: 'the Warden',             base: '#6e58a0', hi: '#ab95d8', lo: '#2b2046', metal: 'silver' },
  neutral: { name: 'Unclaimed',              base: '#6d6f78', hi: '#a9abb3', lo: '#2c2d33', metal: 'iron' },
} as const;

/** Semantic colours, tuned into the enamel family (each readable on steel900 at >= 4.5:1 for text use). */
export const SEMANTIC = {
  good: '#86c08f', goodEnamel: '#3f7a4c',     // malachite
  bad: '#e2725d', badEnamel: '#9a3427',       // cinnabar
  warn: '#e4ab4a', warnEnamel: '#8f6418',     // amber
  info: '#9bbbd9', infoEnamel: '#36597d',     // pale lapis
  fate: '#f1d488',                            // lamp gold: Fate, crowns, victory points
} as const;

/** The lamp: one warm key light, upper left of the table, slightly above centre. */
export const LAMP = { color: '#ffd9a0', uv: [0.42, 0.34] as [number, number], dir: [-0.52, -0.85] as [number, number] } as const;

/** Nebula pigments for the GL sky (art/gl/nebula): pigments, not light. */
export const SKY = {
  ink: '#05060a', deep: '#0c1526', umber: '#6a3f26', blood: '#4e1a1e', verd: '#1c4848', gold: '#d9a256',
} as const;

/** Star corona tints by kind (stars.ts StarKind): warm-biased so even blue stars sit inside the palette. */
export const CORONA: Record<string, string> = {
  yellow: '#ffcf7a', red: '#ff8a5c', blue: '#a9c6ff', white: '#f1ecdf', binary: '#ffd59a', pulsar: '#c3b6ff', blackhole: '#ffb070', throne: '#ffe2a0',
};

/** Motion: durations (ms) and easings shared by CSS (kit.css) and canvas tweens. */
export const MOTION = {
  tick: 90, press: 120, settle: 260, sheet: 340, ceremony: 900,
  // a weighted object: fast out of rest, long settle, no bounce
  easeHeavy: 'cubic-bezier(0.22, 0.9, 0.25, 1)',
  // a struck plate / seal: tiny overshoot once
  easeStrike: 'cubic-bezier(0.3, 1.35, 0.45, 1)',
  // things that leave: accelerate away
  easeOut: 'cubic-bezier(0.55, 0, 0.75, 0.2)',
} as const;

// ------------------------------------------------------------------ owner colour → enamel
/** A house key, by the colour the game state carries for its owner. */
export type HouseKey = keyof typeof FACTION;
/** Seat → house (0 Azure, 1 Crimson, 2 Gilded; -1 the Warden). */
export const SEAT_HOUSE: HouseKey[] = ['azure', 'crimson', 'gilded'];
const ALIAS = new Map<string, HouseKey>();
for (const k of Object.keys(FACTION) as HouseKey[]) for (const v of [FACTION[k].base, FACTION[k].hi, FACTION[k].lo]) ALIAS.set(v, k);
// the retired screen neons (old saves and servers still carry them) and the old Warden / neutral greys
for (const [hex, k] of [['#3fd0ff', 'azure'], ['#6fc3ff', 'azure'], ['#ff4f7b', 'crimson'], ['#ff5d7a', 'crimson'], ['#e0566f', 'crimson'], ['#ffd23f', 'gilded'],
  ['#e7b6ff', 'warden'], ['#b78bff', 'warden'], ['#8a8aa8', 'neutral'], ['#a59ccc', 'neutral'], ['#bdb6d6', 'neutral']] as [string, HouseKey][]) ALIAS.set(hex, k);

/** The house an owner colour belongs to (null: not a house colour, e.g. a semantic colour). */
export function houseOf(color: string | null | undefined): HouseKey | null {
  return color ? ALIAS.get(color.trim().toLowerCase()) ?? null : null;
}
export interface Enamel { base: string; hi: string; lo: string; house: HouseKey | null }
/** The enamel for an owner colour: `base` for fills and lacquer, `hi` for lit edges and names on dark, `lo` for
 *  recesses. Anything that is not a house colour passes through unchanged. */
export function enamel(color: string | null | undefined): Enamel {
  const k = houseOf(color);
  if (k) return { ...FACTION[k], house: k };
  const c = color || FACTION.neutral.hi;
  return { base: c, hi: c, lo: c, house: null };
}
/** The text-safe owner colour (enamel `hi`), for names and lines on dark chrome. */
export const ownerHi = (color: string | null | undefined) => enamel(color).hi;
/** Territory engraving by house: a pattern cue on top of colour (colour-blind players read the hatch angle).
 *  Radians from the x axis; `cross` adds the perpendicular stroke. */
export const HATCH: Record<HouseKey, { a: number; cross: boolean }> = {
  azure: { a: -Math.PI / 4, cross: false }, crimson: { a: Math.PI / 4, cross: false }, gilded: { a: 0, cross: true },
  warden: { a: Math.PI / 2, cross: false }, neutral: { a: 0, cross: false },
};

/** The retired screen colours still passed in by older code (HUD verbs, arrows, highlights), mapped onto the bible's
 *  tokens: a coral is cinnabar, a mint malachite, a neon gold lamp gold, a cyan pale lapis, a violet the Warden. */
const RETINT = new Map<string, string>([
  ['#ff5d7a', SEMANTIC.bad], ['#ff4f5e', SEMANTIC.bad], ['#ff5d5d', SEMANTIC.bad], ['#ff6b6b', SEMANTIC.bad], ['#ff6b5e', SEMANTIC.bad], ['#e0566f', SEMANTIC.bad], ['#ff7a6a', SEMANTIC.bad],
  ['#ff9db0', '#e8a08e'], ['#ff9b6b', '#e8946a'], ['#ff9a62', '#e8946a'], ['#ff8a3c', SEMANTIC.warn],
  ['#ffb84d', SEMANTIC.warn], ['#ffb36b', SEMANTIC.warn], ['#ffb347', SEMANTIC.warn],
  ['#ffd86b', SEMANTIC.fate], ['#ffd23f', SEMANTIC.fate], ['#e9c46a', SEMANTIC.fate],
  ['#7ff7ff', '#7fbfb3'], ['#6ff3ff', '#7fbfb3'], ['#6dffb0', SEMANTIC.good], ['#7ee3a2', SEMANTIC.good], ['#8fd3ff', SEMANTIC.info], ['#6fc3ff', SEMANTIC.info],
  ['#e7b6ff', FACTION.warden.hi], ['#d6b4ff', FACTION.warden.hi], ['#b9a6ff', FACTION.warden.hi], ['#b78bff', FACTION.warden.hi],
  ['#c9c3e6', FACTION.neutral.hi], ['#bdb6d6', FACTION.neutral.hi], ['#a59ccc', FACTION.neutral.hi], ['#8a8aa8', FACTION.neutral.hi],
  ['#ffffff', '#f3ead6'], ['#fff', '#f3ead6'],
]);
/** Any colour on the board, in the bible's palette: house colours become their enamel `hi`, retired neons their token. */
export function retint(color: string): string {
  const c = color.trim().toLowerCase();
  const k = houseOf(c);
  if (k) return FACTION[k].hi;
  return RETINT.get(c) ?? color;
}

/** A category colour (a research branch, a VP source) as an enamel boss: the hue kept, the value and chroma brought
 *  down into the fired-enamel range so it sits with the house enamels instead of glowing. Returns hex. */
export function enamelBoss(color: string): string {
  const h = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return color;
  const n = parseInt(h, 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  // pull 45% toward the grey of the same lightness, then darken to enamel value
  const m = (c: number) => Math.max(0, Math.min(255, Math.round((c + (l - c) * 0.45) * 0.62)));
  return `#${((1 << 24) | (m(r) << 16) | (m(g) << 8) | m(b)).toString(16).slice(1)}`;
}

/** An owner's name as text on dark steel: the enamel `hi`, lifted a little toward ivory so even the darkest
 *  house (Crimson) holds 4.5:1 on a lit plate. */
export function ownerText(color: string | null | undefined): string {
  const h = enamel(color).hi.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return enamel(color).hi;
  const n = parseInt(h, 16), iv = [0xf3, 0xea, 0xd6];
  const m = (c: number, i: number) => Math.round(c + (iv[i] - c) * 0.22);
  return `#${((1 << 24) | (m((n >> 16) & 255, 0) << 16) | (m((n >> 8) & 255, 1) << 8) | m(n & 255, 2)).toString(16).slice(1)}`;
}

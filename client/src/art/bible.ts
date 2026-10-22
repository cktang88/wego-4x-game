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

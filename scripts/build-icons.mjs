// Builds client/src/art/icons.gen.ts: the icon set's path data, extracted from game-icons.net
// (@iconify-json/game-icons, CC BY 3.0, devDependency only) plus a few hand-drawn icons for the gaps.
// The generated file is committed, so the client never loads the 4000-icon JSON.
//
//   node scripts/build-icons.mjs
//
// To change an icon: edit SRC below (a game-icons name, optionally rotated/flipped) and re-run.
// Browse names: node -e "console.log(Object.keys(require('@iconify-json/game-icons/icons.json').icons).join('\n'))" | grep sword
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const GI = require('@iconify-json/game-icons/icons.json');
const OUT = fileURLToPath(new URL('../client/src/art/icons.gen.ts', import.meta.url));

// ------------------------------------------------------------------ semantic name -> source
// string: a game-icons name. { gi, rot, flip }: rotated (deg, about the centre) / mirrored horizontally.
// { c }: hand-drawn (CUSTOM below, 24-unit grid, even-odd fill; nz: non-zero, for overlapping parts).
const SRC = {
  // resources and stats
  industry: 'cog', credits: 'two-coins', influence: 'laurels', fate: { c: 1 }, crown: 'crown', time: 'stopwatch',
  hourglass: 'hourglass', antimatter: 'atom', crystal: 'crystal-growth', attack: 'crossed-swords', hull: 'hearts',
  speed: 'wingfoot', shield: 'shield', garrison: 'templar-shield', ships: { c: 1, nz: 1 },
  // orders and free actions
  move: { gi: 'plain-arrow', rot: -90 }, seize: 'planet-conquest', build: 'dig-dug', develop: 'upgrade',
  fortify: 'defensive-wall', scan: 'radar-sweep', feint: 'domino-mask', conceal: 'hood', excavate: 'spade',
  pact: 'shaking-hands', law: 'scroll-unfurled', refit: 'spanner', retire: 'vertical-banner', engrave: 'chisel',
  raze: 'burning-dot', halt: 'halt', split: 'split-arrows', merge: { c: 1 }, vow: 'iron-cross', hold: 'spartan-helmet',
  evade: 'wind-slap', research: 'round-bottom-flask', edit: 'quill', dispatch: 'quill-ink', scales: 'scales',
  honour: 'medal', calling: 'bell-shield', deed: 'rune-stone',
  // fleet postures, world postures, fate uses
  steady: { c: 1 }, guarded: 'checked-shield', running: 'run', bolt: 'power-lightning', ambush: 'mantrap',
  levies: 'spears', fire: 'fire', gates: 'open-gate',
  laststand: 'sword-in-stone', surge: 'sun-radiations', hyperjump: 'fast-arrow', twist: 'cycle', rally: 'bugle-call',
  // stars and bodies
  sun: 'sun', 'star-red': { c: 1 }, 'star-blue': 'polar-star', binary: { c: 1 }, pulsar: { c: 1 }, blackhole: 'vortex',
  habitable: 'world', gas: 'ringed-planet', belt: 'asteroid', moon: 'moon', barren: 'stone-sphere',
  ruin: 'ancient-columns', station: 'hexagonal-nut', colony: 'habitat-dome',
  // system roles and structures
  core: 'capitol', forge: 'anvil', harbor: 'anchor', waystation: 'lighthouse',
  shipyard: 'cargo-crane', fortress: 'castle', mine: 'mine-wagon', trade: 'trade', sensor: 'radar-dish',
  depot: 'oil-drum', gate: 'star-gate', academy: 'open-book', battery: 'cannon', pshield: 'lightning-dome',
  extractor: 'drill',
  // techs, laws, traits
  railgun: 'supersonic-bullet', cruiser: { c: 1, nz: 1 }, comet: 'comet-spark', thruster: 'jet-pack',
  heal: 'health-normal', tower: 'chess-rook', purse: 'swap-bag', triad: 'stars-stack', throne: 'stone-throne',
  fist: 'fist', dawn: 'sunrise', plating: 'chest-armor', home: 'house', ghost: 'ghost', tent: 'camping-tent',
  garden: 'flower-emblem', sprout: 'sprout', hunt: 'targeted', arrow: 'broadhead-arrow', bow: 'crossbow', slow: { c: 1 },
  mail: { c: 1 }, star: 'seven-pointed-star',
  // soul layer, herald, map states
  rout: 'return-arrow', grave: { c: 1 }, 'blood-debt': 'drop', oathbreaker: 'broken-shield', legend: 'round-star',
  skull: 'death-skull', plunder: 'open-chest', citizen: 'character', refugee: 'walking-scout', blockade: 'dungeon-gate',
  chain: 'linked-rings', liberated: 'breaking-chain', occupied: 'tower-flag', dormant: 'night-sleep',
  limping: 'bandage-roll', scar: 'claw-slashes', battle: 'sword-clash', banner: 'flying-flag', relic: 'amphora',
  // banner sigils not covered above
  wolf: 'wolf-head', serpent: 'sea-serpent', raven: 'raven', blade: 'plain-dagger',
  // UI chrome
  close: { c: 1 }, check: { c: 1 }, warning: { c: 1 }, lock: 'padlock', plus: { c: 1 }, more: { c: 1 },
  caret: { c: 1 }, dot: { c: 1 }, forbidden: { c: 1 }, undo: { c: 1 }, political: { c: 1 }, choke: { c: 1 },
  lane: { c: 1 }, copy: { c: 1 }, eye: { c: 1 }, menu: 'hamburger-menu', chronicle: 'black-book', help: 'help',
  empire: 'fleur-de-lys', keyboard: 'keyboard', download: { c: 1 }, leave: 'exit-door', play: 'play-button',
  pause: 'pause-button', skip: 'next-button', fast: 'fast-forward-button', replay: { c: 1 },
};

// ------------------------------------------------------------------ hand-drawn gaps (24 grid, even-odd)
const f = n => +n.toFixed(2);
const P = pts => 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
const circ = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(r * 2)} 0a${r} ${r} 0 1 0 ${f(-r * 2)} 0Z`;
const rad = d => (d * Math.PI) / 180;
const pol = (cx, cy, r, a) => [cx + Math.cos(rad(a)) * r, cy + Math.sin(rad(a)) * r];
const star = (n, ro, ri, cx = 12, cy = 12, rot = -90) =>
  P(Array.from({ length: n * 2 }, (_, i) => pol(cx, cy, i % 2 ? ri : ro, rot + (i * 180) / n)));
/** Annular band from angle a0 to a1 (degrees, clockwise on screen). */
const band = (cx, cy, ro, ri, a0, a1) => {
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const [x0, y0] = pol(cx, cy, ro, a0), [x1, y1] = pol(cx, cy, ro, a1), [x2, y2] = pol(cx, cy, ri, a1), [x3, y3] = pol(cx, cy, ri, a0);
  return `M${f(x0)} ${f(y0)}A${ro} ${ro} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${ri} ${ri} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
};
/** A bar of width w from p to q. */
const bar = ([x0, y0], [x1, y1], w) => {
  const L = Math.hypot(x1 - x0, y1 - y0), nx = (-(y1 - y0) / L) * (w / 2), ny = ((x1 - x0) / L) * (w / 2);
  return P([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
};
/** The game's own ship silhouettes (client/src/hud/util.ts SIL, 28x14; M/L pairs only), fitted to the 24 grid. */
const fitSil = (d, ky = 1) => {
  let i = 0;
  const k = 23 / 28;
  return d.replace(/-?\d+(?:\.\d+)?/g, m => { const v = Number(m); const out = i % 2 === 0 ? v * k + 0.5 : (v - 7) * k * ky + 12; i++; return String(f(out)); });
};
const arrowArc = (cx, cy, ro, ri, a0, a1, head) => {
  // the band runs a0 -> a1 clockwise; the arrowhead sits at a0, pointing back against the sweep
  const rm = (ro + ri) / 2, [mx, my] = pol(cx, cy, rm, a0);
  const dx = Math.sin(rad(a0)), dy = -Math.cos(rad(a0)); // direction of decreasing angle
  const nx = Math.cos(rad(a0)), ny = Math.sin(rad(a0));
  return band(cx, cy, ro, ri, a0 + 2, a1) + P([[mx + dx * head, my + dy * head], [mx + nx * head, my + ny * head], [mx - nx * head, my - ny * head]]);
};

const CUSTOM = {
  fate: circ(12, 12, 11.2) + circ(12, 12, 8.8) + star(5, 7.4, 3.0, 12, 12.4),
  ships: P([[1, 6.4], [11, 8.6], [23.2, 12], [11, 15.4], [1, 17.6], [5, 12]]) + P([[4.6, 1.6], [12.4, 8.9], [7.6, 8.3]]) + P([[4.6, 22.4], [7.6, 15.7], [12.4, 15.1]]),
  cruiser: fitSil('M1 5 L6 3 L20 3 L27 7 L20 11 L6 11 L1 9 Z M8 0.6 L14 0.6 L16.5 3.4 L8 3.4 Z M8 13.4 L14 13.4 L16.5 10.6 L8 10.6 Z', 1.25),
  steady: P([[12, 0.8], [23.2, 12], [12, 23.2], [0.8, 12]]) + P([[12, 6.8], [17.2, 12], [12, 17.2], [6.8, 12]]),
  'star-red': circ(12, 12, 11.4) + circ(12, 12, 9.2) + circ(12, 12, 7.2),
  binary: circ(8.6, 14, 7.4) + circ(18.6, 5.6, 4.2) + band(8.6, 14, 11.2, 9.4, 300, 400),
  pulsar: circ(12, 12, 4.4) + P([[12, 0.3], [14, 7.4], [10, 7.4]]) + P([[12, 23.7], [10, 16.6], [14, 16.6]])
    + band(12, 12, 10.8, 8.4, -50, 50) + band(12, 12, 10.8, 8.4, 130, 230),
  close: P([[4.4, 1.6], [12, 9.2], [19.6, 1.6], [22.4, 4.4], [14.8, 12], [22.4, 19.6], [19.6, 22.4], [12, 14.8], [4.4, 22.4], [1.6, 19.6], [9.2, 12], [1.6, 4.4]]),
  check: P([[1.2, 12.8], [4.8, 9.2], [9.2, 13.6], [19.2, 3.6], [22.8, 7.2], [9.2, 20.8]]),
  warning: 'M12 1.2 23.4 21.6H.6Z' + P([[10.4, 7.6], [13.6, 7.6], [13, 14.8], [11, 14.8]]) + circ(12, 18, 1.7),
  plus: P([[9.8, 2], [14.2, 2], [14.2, 9.8], [22, 9.8], [22, 14.2], [14.2, 14.2], [14.2, 22], [9.8, 22], [9.8, 14.2], [2, 14.2], [2, 9.8], [9.8, 9.8]]),
  more: circ(3.6, 12, 2.9) + circ(12, 12, 2.9) + circ(20.4, 12, 2.9),
  caret: P([[6, 3], [20, 12], [6, 21]]),
  dot: circ(12, 12, 6.5),
  forbidden: circ(12, 12, 11.2) + circ(12, 12, 8) + bar(pol(12, 12, 7.9, 225), pol(12, 12, 7.9, 45), 3.4),
  undo: arrowArc(12.5, 13, 9.4, 5.6, 185, 450, 5.4),
  slow: P([[21.5, 3.5], [16, 3.5], [9, 12], [16, 20.5], [21.5, 20.5], [14.5, 12]]) + P([[13.5, 3.5], [8, 3.5], [1, 12], [8, 20.5], [13.5, 20.5], [6.5, 12]]),
  political: circ(12, 12, 11.2) + circ(12, 12, 8.6) + 'M12 5.2A6.8 6.8 0 0 0 12 18.8Z',
  choke: P([[1, 2.5], [12, 10], [23, 2.5], [23, 21.5], [12, 14], [1, 21.5]]),
  lane: circ(4.2, 19.8, 3.4) + circ(19.8, 4.2, 3.4) + bar([7.6, 16.4], [10.4, 13.6], 2.8) + bar([13.6, 10.4], [16.4, 7.6], 2.8) + circ(12, 12, 1.7),
  copy: P([[7, 1], [23, 1], [23, 17], [17, 17], [17, 14.4], [20.4, 14.4], [20.4, 3.6], [9.6, 3.6], [9.6, 7], [7, 7]]) + 'M1 9H15V23H1Z',
  merge: P([[12, 0.8], [19.6, 8.6], [14.2, 8.6], [14.2, 12.2], [22, 19.6], [19.2, 22.6], [12, 15.8], [4.8, 22.6], [2, 19.6], [9.8, 12.2], [9.8, 8.6], [4.4, 8.6]]),
  mail: 'M1 4.5H23V19.5H1Z' + P([[3, 6.2], [5.6, 6.2], [12, 11.4], [18.4, 6.2], [21, 6.2], [12, 13.8]]),
  replay: arrowArc(12, 12, 10.8, 6.8, -60, 228, 5.6),
  download: P([[9.8, 1.5], [14.2, 1.5], [14.2, 9.2], [19.6, 9.2], [12, 17.4], [4.4, 9.2], [9.8, 9.2]]) + 'M2 19.4H22V22.6H2Z',
  grave: P([[10.1, 0.8], [13.9, 0.8], [13.9, 5.8], [19.8, 5.8], [19.8, 9.6], [13.9, 9.6], [13.9, 18.2], [10.1, 18.2], [10.1, 9.6], [4.2, 9.6], [4.2, 5.8], [10.1, 5.8]]) + 'M1.5 23.2Q12 15.4 22.5 23.2Z',
  eye: 'M.5 12C5.2 4.6 18.8 4.6 23.5 12 18.8 19.4 5.2 19.4.5 12Z' + circ(12, 12, 4.6) + circ(12, 12, 2.2),
};

// ------------------------------------------------------------------ path minifier (1 decimal on the 512 grid)
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
function minify(d, dec) {
  const out = [];
  let i = 0, cmd = '';
  const num = () => {
    const m = /^[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/i.exec(d.slice(i));
    if (!m) throw new Error(`bad path at ${i}: ${d.slice(i, i + 20)}`);
    i += m[0].length;
    return Number(m[1]);
  };
  const flag = () => { const m = /^[\s,]*([01])/.exec(d.slice(i)); if (!m) throw new Error('bad flag'); i += m[0].length; return Number(m[1]); };
  const fmt = v => { let s = String(+v.toFixed(dec)); if (s === '-0') s = '0'; return s.replace(/^(-?)0\./, '$1.'); };
  while (i < d.length) {
    const ws = /^[\s,]+/.exec(d.slice(i)); if (ws) { i += ws[0].length; continue; }
    if (/[a-z]/i.test(d[i])) { cmd = d[i++]; out.push(cmd); if (cmd.toLowerCase() === 'z') continue; }
    const k = ARGS[cmd.toLowerCase()];
    if (!k) throw new Error(`implicit args after ${cmd}`);
    const vals = [];
    for (let j = 0; j < k; j++) vals.push(cmd.toLowerCase() === 'a' && (j === 3 || j === 4) ? String(flag()) : fmt(num()));
    // join, letting '-' and '.' separate numbers where they can
    let s = '';
    for (const v of vals) s += s && !(v[0] === '-' || (v[0] === '.' && /\.\d*$/.test(s))) ? ` ${v}` : v;
    const prev = out[out.length - 1];
    out.push(/[a-z]/i.test(prev) || s[0] === '-' || (s[0] === '.' && /\.\d*$/.test(prev)) ? s : ` ${s}`);
  }
  return out.join('');
}

// ------------------------------------------------------------------ emit
const entries = [];
const credits = new Set();
for (const [name, src] of Object.entries(SRC)) {
  if (typeof src === 'object' && src.c) {
    const d = CUSTOM[name];
    if (!d) throw new Error(`no custom path for ${name}`);
    entries.push(`  ${JSON.stringify(name)}: { g: 24,${src.nz ? '' : ' e: 1,'} d: ${JSON.stringify(minify(d, 2))} },`);
    continue;
  }
  const gi = typeof src === 'string' ? src : src.gi;
  const icon = GI.icons[gi];
  if (!icon) throw new Error(`game-icons has no "${gi}" (for ${name})`);
  const m = /^<path fill="currentColor" d="([^"]+)"\/>$/.exec(icon.body);
  if (!m) throw new Error(`unexpected body for ${gi}`);
  const extra = typeof src === 'object' ? `${src.rot ? `, r: ${src.rot}` : ''}${src.flip ? ', f: 1' : ''}` : '';
  entries.push(`  ${JSON.stringify(name)}: { g: 512, d: ${JSON.stringify(minify(m[1], 1))}${extra}, src: ${JSON.stringify(gi)} },`);
  credits.add(gi);
}

const ts = `// GENERATED by scripts/build-icons.mjs. Do not edit; change the script and re-run it.
// Path data from game-icons.net (Lorc, Delapouite & contributors), CC BY 3.0: see ./ICONS-CREDITS.md.
// Entries with g: 24 are hand-drawn for this game on a 24-unit grid (even-odd fill).
/** g: grid size of d; e: even-odd fill; r: rotation in degrees about the centre; f: mirror horizontally; src: game-icons name. */
export interface IconPath { g: 512 | 24; d: string; e?: 1; r?: number; f?: 1; src?: string }

export const ICON_PATHS = {
${entries.join('\n')}
} satisfies Record<string, IconPath>;

export type IconName = keyof typeof ICON_PATHS;
`;
writeFileSync(OUT, ts);
console.log(`${OUT}: ${entries.length} icons (${credits.size} from game-icons), ${(ts.length / 1024).toFixed(1)} KB`);

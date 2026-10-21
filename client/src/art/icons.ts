// The icon set: one heavy filled silhouette per meaning, replacing the Unicode glyphs (⚙ ¢ ✦ ⚔ ⛨ …) that
// rendered at a different size and weight on every font and platform (and as colour emoji on iOS).
//
// Source: game-icons.net (Lorc, Delapouite & contributors, CC BY 3.0) through scripts/build-icons.mjs, which
// writes only the icons mapped here into ./icons.gen.ts; a few gaps are hand-drawn in that script.
// Credits: ./ICONS-CREDITS.md. Sizing next to text: client/src/icons.css. Review sheet: scripts/icon-gallery.mjs.
//
//   ic('industry')                    → '<svg class="ic ic-industry" …>'   (inline HTML)
//   icFromGlyph('⚙')                  → 'industry'                         (legacy glyph strings from shared/config)
//   icFor('posture', 'ambush')        → 'ambush'                           (glyph reuse disambiguated by domain)
//   glyphHtml('⚙ 34 · +3¢')           → the same HTML with the glyphs swapped for icons
//   drawIcon(ctx, 'attack', x, y, 16, '#fff')                              (canvas, cached Path2D)
import { ICON_PATHS, type IconName, type IconPath } from './icons.gen.ts';

export type { IconName };
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

// ------------------------------------------------------------------ aliases (other words for the same icon)
const ALIASES = {
  vp: 'crown', score: 'crown', power: 'attack', hp: 'hull', health: 'hull', heart: 'hull', defence: 'garrison',
  sword: 'attack', swords: 'attack', charge: 'bolt', lightning: 'bolt', grudge: 'bolt', flame: 'fire', scorch: 'fire',
  burned: 'fire', tribute: 'scales', balance: 'scales', deflector: 'shield', idle: 'dormant', sleep: 'dormant',
  supply: 'chain', economy: 'industry', military: 'attack', capture: 'seize', founded: 'banner', flag: 'banner',
  doctrine: 'attack', rename: 'edit', quill: 'edit', blueprint: 'refit', posture: 'guarded', wposture: 'levies',
  ion: 'thruster', medic: 'heal', regen: 'heal', rook: 'tower', citadel: 'tower', capital: 'tower',
  coronation: 'crown', mandate: 'crown', death: 'grave', fallen: 'grave', eliminated: 'skull', raiders: 'skull',
  debt: 'blood-debt', oath: 'oathbreaker', broken: 'oathbreaker', star5: 'legend', exposed: 'eye', sensors: 'eye',
  cross: 'close', x: 'close', no: 'forbidden', locked: 'lock', blocked: 'forbidden', alert: 'warning',
  ok: 'check', yes: 'check', settings: 'menu', next: 'skip', back: 'undo', revoke: 'undo', save: 'download',
  exit: 'leave', chat: 'mail', herald: 'dispatch', saga: 'empire', fleur: 'empire', person: 'citizen',
  people: 'citizen', loot: 'plunder', sack: 'purse', markets: 'purse', gilded: 'purse', hyperlane: 'lane',
  toil: 'build', blood: 'attack', siege: 'comet', loss: 'grave', burst: 'surge', glass: 'steady', diamond: 'steady',
  dagger: 'blade', avenge: 'blade', haunted: 'moon', quiet: 'moon', nebula: 'ghost', ghosts: 'ghost',
  'yellow': 'sun', red: 'star-red', blue: 'star-blue', 'black-hole': 'blackhole', planet: 'habitable',
  asteroid: 'belt', tradehub: 'trade', 'trade-hub': 'trade', fort: 'fortress', castle: 'fortress', pick: 'mine',
  fuel: 'depot', book: 'academy', cannon: 'battery', 'planet-shield': 'pshield', dome: 'pshield',
  warp: 'gate', portal: 'gate', fleet: 'ships', frigate: 'ships', bombard: 'battery',
  speedup: 'fast', twistoffate: 'twist', newturn: 'replay', redo: 'replay', federal: 'triad',
  central: 'throne', martial: 'fist', open: 'dawn', freedom: 'liberated', occupy: 'occupied', limp: 'limping',
  honor: 'honour', jump: 'hyperjump', medal: 'honour', bell: 'calling', tablet: 'deed', key: 'lock',
} as const satisfies Record<string, IconName>;

export type IconKey = IconName | keyof typeof ALIASES;

/** The icon for a name or alias (unknown names fall back to 'dot'). */
export function iconName(name: string): IconName {
  if (name in ICON_PATHS) return name as IconName;
  return (ALIASES as Record<string, IconName>)[name] ?? 'dot';
}
export const hasIcon = (name: string): boolean => name in ICON_PATHS || name in ALIASES;

// ------------------------------------------------------------------ inventory: legacy glyph -> icon
// Every glyph used as an icon in client/src and shared/config (grep, Oct 2026), with the meaning it carried
// and where. A glyph that means several things maps to its commonest meaning; icFor() picks the right one per
// domain. Typography (→ − ≤ ≥ × · ½) stays text. `x: 1` = only an exact match converts (glyphHtml skips it in
// running text: '!', '+', '?', 'Zz' and the multiplication sign are ordinary characters there).
interface GlyphUse { i: IconName; u: string; x?: 1 }
export const GLYPHS: Record<string, GlyphUse> = {
  // resources and stats (hud/hud.ts pills, hud/util.ts IC, card.ts, modal-empire.ts, systems.ts)
  '⚙': { i: 'industry', u: 'industry (IC, pills, card, empire, help); mine project (card); Industrial law; Salvagers boon; Mass-produced trait; economy lens; Build order (ORDER_INFO)' },
  '¢': { i: 'credits', u: 'credits (IC, pills, costs in text); Trade Hub project (card, map); Mercantile law; Supplied/Frugal traits; loot beat' },
  '₵': { i: 'credits', u: 'credits (alternate cedi glyph)' },
  '✦': { i: 'influence', u: 'influence (IC, pills, map bar, order); State branch; vow_kept beat/headline' },
  '♛': { i: 'crown', u: 'VP / score (IC, Score modal, help, saga, hud); Crown sigil; Take-the-Throne vow; King’s Seat deed; Throne-forged trait; Imperial Mandate tech; coronation headline' },
  '♕': { i: 'crown', u: 'Crown-sworn ship trait' },
  '♔': { i: 'throne', u: 'Centralism law' },
  '♚': { i: 'core', u: 'Core system role' },
  '⚔': { i: 'attack', u: 'power / attack (IC, card stats, ship cards); Seize order; War branch; Vanguard law; Never-retreat vow; Proving Ground calling; Veteran-yard trait; doctrine free action; blood mark; battle/vengeance headline; military lens; battery project; Last Stand fate (FATE_USES)' },
  '⛨': { i: 'garrison', u: 'garrison (IC, card, systems slot); Fortify order; Bulwark branch; Bastion law; Guard vow; Unbroken deed; Garrison-class trait; siege mark; fortress & pshield projects' },
  '❤': { i: 'hull', u: 'hull / hp (card stats, ship cards)' },
  '♥': { i: 'hull', u: 'Beloved boon' },
  '➤': { i: 'move', u: 'Move order; speed stat (ship cards); Logistics branch; depot project; corvette glyph; "drag to a region" hints; Ships help heading' },
  '⏱': { i: 'time', u: 'turn timer (hud, notify, strip, help, game.ts)' },
  '⏳': { i: 'hourglass', u: 'Slow Refits bane; research in progress (ui/empire.ts)' },
  '⚛': { i: 'antimatter', u: 'antimatter vein (IC, systems, empire, techs); extractor project; Antimatter-charged trait' },
  '◆': { i: 'crystal', u: 'crystal vein (IC, map, techs); Asteroid-born trait; deed headline; frigate glyph' },
  '⛭': { i: 'ships', u: 'ship count (card stats)' },
  // orders and free actions (shared/sim/orders.ts ORDER_INFO, hud/util.ts ORDER_ICONS, hud/strip.ts FREE_ICON)
  '⚒': { i: 'build', u: 'Build / Refit orders; shipyard project; blueprint free action; Forge trait/role; Arsenal calling; Forged trait; toil mark; refit button' },
  '▲': { i: 'develop', u: 'Develop order; default project icon (card)' },
  '◎': { i: 'scan', u: 'Scan order; sensor & gate projects; Planetary Shields tech; Keen-eyed trait; scan marker on the map; signal marker' },
  '☍': { i: 'feint', u: 'Feint order; Subversion tech' },
  '☾': { i: 'moon', u: 'Conceal order; Moon sigil; quiet headline' },
  '☽': { i: 'moon', u: 'Haunted scar' },
  '✧': { i: 'relic', u: 'Excavate order; relic mark/headline; Bring-a-relic vow; Relic-touched trait' },
  '⚭': { i: 'pact', u: 'Pact order (score modal, card); Binary star' },
  '⚑': { i: 'banner', u: 'Law order; Retire order; revoke/wposture free actions; Bureaucracy tech; Martial Law; Inspiring boon; Haven deed; Martial-crew trait; founded/retired/capture beats & headlines; occupied map tag; Stance header; Levies world posture' },
  '✎': { i: 'edit', u: 'Engrave order; rename free action' },
  '🔥': { i: 'fire', u: 'Raze order; Scorched Earth world posture' },
  '♨': { i: 'fire', u: 'Flame sigil; Burned scar; raze free action; razed / scorched headlines; Scorched Earth (signature.ts substitute)' },
  '✂': { i: 'split', u: 'Split (verbs, strip, card, empire)' },
  '■': { i: 'halt', u: 'Halt free action ("■ Halt"); Lumbering trait; bombard glyph' },
  '✠': { i: 'vow', u: 'Vow free action/beat; blood-debt headline; Blooded-crew trait' },
  '❖': { i: 'honour', u: 'Honour free action/beat/headline' },
  '◈': { i: 'calling', u: 'Calling free action/headline' },
  '✒': { i: 'dispatch', u: 'Herald dispatch (strip, herald, chronicle button)' },
  '⚖': { i: 'scales', u: 'Tribute (systems, herald, map tag); Trade Compacts tech' },
  '✺': { i: 'research', u: 'research free action; academy project; Empire modal icon; research notifications' },
  '⚗': { i: 'research', u: 'research fallback (ui/empire.ts)' },
  // fleet postures, world postures, fate (shared/config/content.ts POSTURES, WORLD_POSTURES, FATE_USES)
  '◇': { i: 'steady', u: 'Steady posture; Glass Hulls bane; Crystal-lensed trait; map calling fallback' },
  '⛉': { i: 'guarded', u: 'Guarded posture; posture free action; Posture header' },
  '»': { i: 'running', u: 'Running posture; Long Range boon; Ion Drives tech / Ion module; Racer trait' },
  '«': { i: 'slow', u: 'Ponderous bane' },
  '⚡': { i: 'bolt', u: 'Charge posture; Surge fate; Alpha Strike tech; Grudge scar; Grudge-bound bane; sulk beat; charge-broken headline' },
  '◉': { i: 'eye', u: 'Ambush posture; Eye sigil; Oracle calling; Deep Scanners tech; Black-hole star; Habitable body; idle fleets button; exposed map mark; ambush headline' },
  '⚶': { i: 'ambush', u: 'Ambushers boon' },
  '⛩': { i: 'gates', u: 'Open the Gates world posture' },
  '✪': { i: 'fate', u: 'Fate coin (signature, strip, herald, help, game.ts)' },
  '⇶': { i: 'hyperjump', u: 'Hyperjump fate' },
  '↻': { i: 'twist', u: 'Twist of Fate; verbs / hud refresh' },
  '✚': { i: 'heal', u: 'Rally fate; Field Medics boon; Regenerators tech; Well-equipped trait' },
  // stars, bodies, roles, structures (shared/config/systems.ts, card.ts PROJ_ICON, render/glyphs.ts)
  '☉': { i: 'sun', u: 'Yellow dwarf star; Sun sigil; help' },
  '●': { i: 'dot', u: 'Red dwarf star; status dots', x: 1 },
  '✹': { i: 'star-blue', u: 'Blue giant star' },
  '✳': { i: 'pulsar', u: 'Pulsar star' },
  '◍': { i: 'gas', u: 'Gas giant body/trait; Refinery calling; Gas-fuelled trait' },
  '⁘': { i: 'belt', u: 'Asteroid belt body' },
  '◐': { i: 'political', u: 'political lens; Moon body; game.ts' },
  '◌': { i: 'sprout', u: 'Green Crew bane; Barren body; exposed headline' },
  '⌂': { i: 'home', u: 'Ruin body; Homesick bane; Home-built trait; home beat; route-home tag on the map' },
  '⬡': { i: 'station', u: 'Station body / project' },
  '○': { i: 'colony', u: 'Colony-built trait' },
  '⚓': { i: 'harbor', u: 'Harbor role; Anchor sigil; Iron Discipline boon' },
  '⛯': { i: 'waystation', u: 'Waystation role; gates & slots help' },
  '⛫': { i: 'fortress', u: 'Bulwark calling; Siege-hardened trait' },
  '⛏': { i: 'mine', u: 'mine pictogram (glyphs.ts); Siegebreakers boon' },
  '⛁': { i: 'extractor', u: 'extractor pictogram (glyphs.ts)' },
  '⛽': { i: 'depot', u: 'Supply Depots tech; Hungry bane' },
  '⧉': { i: 'gate', u: 'Warp Gates tech; copy button (saga)' },
  '⊕': { i: 'battery', u: 'Orbital Batteries tech' },
  // techs, modules, laws, traits (shared/config/empire.ts, content.ts)
  '⁍': { i: 'railgun', u: 'Railguns tech / module' },
  '▬': { i: 'cruiser', u: 'Cruiser Yards tech' },
  '▰': { i: 'cruiser', u: 'cruiser glyph (ui/empire.ts)' },
  '☄': { i: 'comet', u: 'Siege Doctrine tech; Daredevils trait' },
  '☀': { i: 'sun', u: 'The Sunhammer tech; Conspicuous bane' },
  '◠': { i: 'shield', u: 'Deflectors tech / Deflector module' },
  '♜': { i: 'tower', u: 'Citadel Worlds tech; Tower sigil; capital headline' },
  '↯': { i: 'hyperjump', u: 'Jump Drive tech' },
  '¤': { i: 'purse', u: 'Free Markets tech; Gilded bane' },
  '⁂': { i: 'triad', u: 'Federation law' },
  '☼': { i: 'dawn', u: 'Open Society law; Liberated deed/headline; Free-crew trait' },
  '▣': { i: 'plating', u: 'Armor module; Bastion calling; Bulwark Moon trait; Bulwark-plated trait' },
  '❀': { i: 'garden', u: 'Garden World trait; Granary calling; Garden-crewed trait' },
  '☁': { i: 'ghost', u: 'Ghosts boon; Nebula-raised trait' },
  '➹': { i: 'arrow', u: 'Shock Troops boon; Forward-rigged trait' },
  '➶': { i: 'bow', u: 'Hunters boon' },
  '⤺': { i: 'rout', u: 'Clean Break boon; rout beat/headline' },
  '⟲': { i: 'replay', u: 'Thrice-Taken deed; replay (strip, battle viewer, hud)' },
  '✉': { i: 'mail', u: 'Loose Lips bane; mail notification' },
  '☠': { i: 'skull', u: 'Raiders boon; Skeleton Crew scar' },
  '⛺': { i: 'tent', u: 'Frontier-built trait' },
  '☂': { i: 'hold', u: 'Cautious trait' },
  '✸': { i: 'surge', u: 'Overgunned trait' },
  '✶': { i: 'star', u: 'Star sigil' },
  '★': { i: 'legend', u: 'legend beat/headline; unique-tech marker in descriptions' },
  '✝': { i: 'grave', u: 'Cenotaph calling; Where-it-Fell deed; loss mark; broken/destroyed/caught/death/eliminated beats & headlines' },
  '🗡': { i: 'blade', u: 'Avenge vow' },
  '†': { i: 'blade', u: 'Blade sigil' },
  '🐺': { i: 'wolf', u: 'Wolf sigil' },
  '§': { i: 'serpent', u: 'Serpent sigil' },
  '⚚': { i: 'raven', u: 'Raven sigil' },
  // soul layer, map states, herald (hud/soul.ts, ui/herald.ts, render/map.ts)
  '⛓': { i: 'chain', u: 'supply lens; contested / blockade map tag; dug-in mark; copy-link button' },
  '⇢': { i: 'refugee', u: 'refugees headline' },
  '⚠': { i: 'warning', u: 'alerts (notify, card, systems, map out-of-supply badge); Brittle Morale bane; refugees notice' },
  '⊘': { i: 'forbidden', u: 'blocked-action reasons in tooltips (card, soul, signature, systems)' },
  '✓': { i: 'check', u: 'confirm buttons; p_called headline; done states' },
  '✗': { i: 'close', u: 'vow broken / oath / p_caught; failed states' },
  '✕': { i: 'close', u: 'close buttons (dom.ts, systems)' },
  '×': { i: 'close', u: 'close buttons; also multiplication in "×3"', x: 1 },
  '⚜': { i: 'empire', u: 'The Saga (help, chronicle, game.ts)' },
  '☺': { i: 'citizen', u: 'citizens (systems)' },
  '⋈': { i: 'choke', u: 'chokepoint marker (systems)' },
  '⟿': { i: 'lane', u: 'Hyperlanes help heading' },
  // UI chrome
  '☰': { i: 'menu', u: 'Chronicle button / modal icon; menus' },
  '≡': { i: 'menu', u: 'menu button (hud, help)' },
  '↶': { i: 'undo', u: 'undo (strip, empire, soul, signature)' },
  '↺': { i: 'undo', u: 'keep-this-law (ui/empire.ts)' },
  '👁': { i: 'eye', u: 'replay "eye" view (strip, help)' },
  '▶': { i: 'play', u: 'play (strip, chronicle, battle viewer)' },
  '⏵': { i: 'play', u: 'auto play (strip)' },
  '⏵⏵': { i: 'fast', u: 'auto play button (strip)' },
  '❚❚': { i: 'pause', u: 'pause (strip, battle viewer)' },
  '⏭': { i: 'skip', u: 'skip (strip, battle viewer)' },
  '⤓': { i: 'download', u: 'save file / save image (hud, saga)' },
  '⏏': { i: 'leave', u: 'leave game (hud menu)' },
  '⌨': { i: 'keyboard', u: 'keys help heading' },
  '⋯': { i: 'more', u: 'more menu (card)' },
  '▸': { i: 'caret', u: 'bullets / disclosure (verbs, herald, ux.css)' },
  '!': { i: 'warning', u: 'Reckless bane; refugee map tag suffix', x: 1 },
  '+': { i: 'plus', u: 'merge free action / beat', x: 1 },
  '?': { i: 'help', u: 'Help modal icon', x: 1 },
  'Zz': { i: 'dormant', u: 'idle fleet badge (map)', x: 1 },
};

const VS = /[︎️]/g;
/** A legacy glyph string ('⚙', '⚙︎', ' ⚔ ') → its icon name, or null when it is not an icon glyph. */
export function icFromGlyph(glyph: string | null | undefined): IconName | null {
  if (!glyph) return null;
  const g = glyph.replace(VS, '').trim();
  return GLYPHS[g]?.i ?? null;
}

// ------------------------------------------------------------------ per-domain choices (glyphs are reused)
// Keys are the ids in shared/config and the client's icon tables. Anything missing falls back to its glyph.
export const ICON_FOR = {
  resource: { industry: 'industry', credits: 'credits', influence: 'influence', fate: 'fate', vp: 'crown', antimatter: 'antimatter', crystal: 'crystal', time: 'time' },
  stat: { attack: 'attack', power: 'attack', hull: 'hull', hp: 'hull', speed: 'speed', shield: 'shield', shields: 'shield', garrison: 'garrison', ships: 'ships', sensor: 'eye', siege: 'comet', upkeep: 'credits', citizens: 'citizen' },
  order: { move: 'move', seize: 'seize', build: 'build', develop: 'develop', fortify: 'fortify', influence: 'influence', scan: 'scan', feint: 'feint', conceal: 'conceal', excavate: 'excavate', pact: 'pact', law: 'law', refit: 'refit', retire: 'retire', engrave: 'engrave', raze: 'raze' },
  free: { doctrine: 'attack', split: 'split', merge: 'merge', rename: 'edit', research: 'research', blueprint: 'refit', revoke: 'undo', halt: 'halt', posture: 'guarded', wposture: 'levies', fate: 'fate', tribute: 'scales', vow: 'vow', honour: 'honour', calling: 'calling', raze: 'raze', dispatch: 'dispatch' },
  doctrine: { attack: 'attack', hold: 'hold', evade: 'evade' },
  posture: { steady: 'steady', guarded: 'guarded', running: 'running', charge: 'bolt', ambush: 'ambush' },
  wposture: { levies: 'levies', scorch: 'fire', gates: 'gates' },
  fate: { laststand: 'laststand', surge: 'surge', hyperjump: 'hyperjump', twist: 'twist', rally: 'rally' },
  star: { yellow: 'sun', red: 'star-red', blue: 'star-blue', binary: 'binary', pulsar: 'pulsar', blackhole: 'blackhole' },
  body: { habitable: 'habitable', gas: 'gas', belt: 'belt', moon: 'moon', barren: 'barren', ruin: 'ruin', station: 'station' },
  role: { core: 'core', forge: 'forge', harbor: 'harbor', waystation: 'waystation' },
  structure: { station: 'station', develop: 'develop', shipyard: 'shipyard', fortress: 'fortress', mine: 'mine', tradehub: 'trade', sensor: 'sensor', academy: 'academy', extractor: 'extractor', battery: 'battery', pshield: 'pshield', depot: 'depot', gate: 'gate' },
  branch: { war: 'attack', bulwark: 'garrison', logistics: 'move', state: 'influence' },
  tech: { railguns: 'railgun', cruisers: 'cruiser', siege: 'comet', alpha: 'bolt', sunhammer: 'sun', deflectors: 'shield', batteries: 'battery', pshield: 'pshield', regen: 'heal', citadel: 'tower', ion: 'thruster', depots: 'depot', gates: 'gate', scanners: 'eye', jump: 'hyperjump', trade: 'scales', bureaucracy: 'law', subversion: 'feint', markets: 'purse', mandate: 'crown' },
  module: { armor: 'plating', railgun: 'railgun', deflector: 'shield', ion: 'thruster' },
  law: { bastion: 'garrison', vanguard: 'attack', mercantile: 'credits', industrial: 'industry', central: 'throne', federal: 'triad', martial: 'fist', open: 'dawn' },
  trait: { forge: 'forge', garden: 'garden', bulwark: 'plating', gas: 'gas' },
  vein: { antimatter: 'antimatter', crystal: 'crystal' },
  boon: { medics: 'heal', ghosts: 'ghost', ambushers: 'ambush', shock: 'arrow', cleanbreak: 'rout', salvagers: 'industry', hunters: 'bow', iron: 'harbor', siegebreakers: 'mine', longrange: 'running', beloved: 'hull', raiders: 'skull', inspiring: 'banner' },
  bane: { green: 'sprout', hungry: 'depot', slowrefit: 'hourglass', brittle: 'warning', conspicuous: 'sun', glass: 'steady', homesick: 'home', grudgebound: 'bolt', ponderous: 'slow', looselips: 'mail', reckless: 'warning', gilded: 'purse' },
  vow: { throne: 'crown', never_retreat: 'attack', guard: 'garrison', avenge: 'blade', relic: 'relic' },
  scar: { burned: 'fire', grudge: 'bolt', skeleton: 'skull', haunted: 'moon' },
  calling: { arsenal: 'build', granary: 'garden', bastion: 'plating', refinery: 'gas', proving: 'attack', oracle: 'eye', cenotaph: 'grave', bulwark: 'fortress' },
  deed: { unbroken: 'garrison', thrice: 'replay', fell: 'grave', haven: 'banner', kings_seat: 'crown', liberated: 'liberated' },
  sigil: { sun: 'sun', moon: 'moon', star: 'star', crown: 'crown', wolf: 'wolf', serpent: 'serpent', anchor: 'harbor', tower: 'tower', blade: 'blade', eye: 'eye', flame: 'fire', raven: 'raven' },
  herald: {
    rout: 'rout', caught: 'grave', destroyed: 'grave', broken: 'grave', death: 'grave', vengeance: 'attack', debt: 'blood-debt',
    vow_broken: 'oathbreaker', vow_kept: 'vow', vow_sworn: 'vow', oath: 'oathbreaker', coronation: 'crown', relic: 'relic',
    capital: 'tower', capture: 'seize', razed: 'fire', liberated: 'liberated', battle: 'battle', honour: 'honour', legend: 'legend',
    retired: 'retire', eliminated: 'skull', founded: 'banner', quiet: 'moon', calling: 'calling', deed: 'deed', fate: 'fate',
    fate_bonus: 'fate', p_called: 'check', p_caught: 'close', p_ambush: 'ambush', p_broken: 'bolt', p_exposed: 'eye',
    p_scorched: 'fire', p_levies: 'levies', tribute: 'scales', tribute_offer: 'scales', refugees: 'refugee',
  },
  beat: {
    founded: 'banner', vow: 'vow', vow_kept: 'vow', vow_broken: 'oathbreaker', vow_lapsed: 'dot', honour: 'honour', legend: 'legend',
    rout: 'rout', home: 'home', broken: 'grave', destroyed: 'grave', caught: 'grave', loot: 'plunder', sulk: 'bolt', merged: 'merge', retired: 'retire',
  },
  mark: { toil: 'build', blood: 'attack', siege: 'garrison', relic: 'relic', loss: 'grave' },
  lens: { political: 'political', supply: 'chain', economy: 'industry', military: 'attack' },
  modal: { empire: 'empire', score: 'crown', chronicle: 'chronicle', help: 'help' },
  state: { contested: 'chain', blockaded: 'blockade', occupied: 'occupied', tribute: 'scales', refugees: 'refugee', plunder: 'plunder', dormant: 'dormant', idle: 'dormant', limping: 'limping', scarred: 'scar', oos: 'warning', exposed: 'eye', dug: 'fortify' },
} satisfies Record<string, Record<string, IconName>>;
export type IconDomain = keyof typeof ICON_FOR;

/** The icon for an id in a domain ('posture', 'ambush'), else the legacy glyph's icon, else 'dot'. */
export function icFor(domain: IconDomain, id: string, glyph?: string): IconName {
  return (ICON_FOR[domain] as Record<string, IconName>)[id] ?? icFromGlyph(glyph) ?? 'dot';
}

// ------------------------------------------------------------------ inline SVG
export interface IcOpts {
  /** Extra classes ('ic-pill', 'ic-lg', 'ic-solo', …; see icons.css). */
  cls?: string;
  /** Accessible name: renders role="img" + <title> instead of aria-hidden. */
  title?: string;
  /** Fixed pixel size (width/height attributes); by default icons.css sizes it from the font. */
  size?: number;
  /** Fill colour (any CSS colour) instead of the inherited currentColor. */
  color?: string;
  /** Second tone: an engraved under-shadow, filled with var(--ic2) (default a dark ink), as on the sigils. */
  emboss?: boolean;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const xform = (p: IconPath) => {
  const c = p.g / 2;
  return `${p.r ? `rotate(${p.r} ${c} ${c})` : ''}${p.f ? ` translate(${p.g} 0) scale(-1 1)` : ''}`.trim();
};

/** Inline <svg> for an icon name or alias. Fills with currentColor; sized by icons.css (.ic) unless opts.size. */
export function ic(name: IconKey | string, opts: IcOpts = {}): string {
  const n = iconName(name);
  const p: IconPath = ICON_PATHS[n];
  const t = xform(p);
  const rule = p.e ? ' fill-rule="evenodd"' : '';
  const tf = t ? ` transform="${t}"` : '';
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  const style = opts.color ? ` style="color:${escAttr(opts.color)}"` : '';
  const a11y = opts.title ? ` role="img"><title>${escAttr(opts.title)}</title` : ' aria-hidden="true"';
  // the shadow sits ~1/40 of the box down-right, like the sigils' raised charge
  const off = p.g / 40;
  const shadow = opts.emboss ? `<path d="${p.d}"${rule} style="fill:var(--ic2,rgba(0,0,0,.55))" transform="translate(${off} ${off * 1.3})${t ? ` ${t}` : ''}"/>` : '';
  return `<svg class="ic ic-${n}${opts.cls ? ` ${escAttr(opts.cls)}` : ''}" viewBox="0 0 ${p.g} ${p.g}"${size}${style} fill="currentColor" focusable="false"${a11y}>${shadow}<path d="${p.d}"${rule}${tf}/></svg>`;
}

// glyph runs inside HTML text: longest first so '❚❚' wins over a lone '❚', and variation selectors go too
const TEXT_GLYPHS = Object.keys(GLYPHS).filter(g => !GLYPHS[g].x).sort((a, b) => b.length - a.length);
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GLYPH_RE = new RegExp(`(?:${TEXT_GLYPHS.map(reEsc).join('|')})[\\uFE0E\\uFE0F]?`, 'gu');

/** Replaces the known icon glyphs in an HTML string (already escaped) with inline icons. Only text between
 *  tags is touched, never attribute values (tooltips keep their glyphs). opts apply to every icon. */
export function glyphHtml(html: string, opts?: IcOpts): string {
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) =>
    tag ?? text!.replace(GLYPH_RE, g => ic(GLYPHS[g.replace(VS, '')].i, opts)));
}

// ------------------------------------------------------------------ canvas
const PATHS = new Map<IconName, Path2D>();
function path2d(n: IconName): Path2D {
  let p = PATHS.get(n);
  if (!p) { p = new Path2D(ICON_PATHS[n].d); PATHS.set(n, p); }
  return p;
}

export interface DrawIconOpts {
  /** Dark outline drawn under the icon so it reads over any map fill (as haloText does for labels). */
  halo?: string;
  /** Halo width in px (default 3). */
  haloWidth?: number;
  /** Engraved under-shadow colour (the second tone), offset down-right. */
  shadow?: string;
  /** Where (x, y) sits on the icon box: centre (default), or its left / right edge (vertically centred). */
  align?: 'center' | 'left' | 'right';
}

/** Draws an icon whose box is `size` px square, centred on (x, y) by default, in the current transform. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconKey | string, x: number, y: number, size: number, color: string | CanvasGradient | CanvasPattern, opts: DrawIconOpts = {}): void {
  const n = iconName(name);
  const p = ICON_PATHS[n] as IconPath;
  const path = path2d(n);
  const k = size / p.g;
  const cx = opts.align === 'left' ? x + size / 2 : opts.align === 'right' ? x - size / 2 : x;
  const rule: CanvasFillRule = p.e ? 'evenodd' : 'nonzero';
  const place = (dx = 0, dy = 0) => {
    ctx.translate(cx + dx, y + dy);
    if (p.r) ctx.rotate((p.r * Math.PI) / 180);
    if (p.f) ctx.scale(-1, 1);
    ctx.scale(k, k);
    ctx.translate(-p.g / 2, -p.g / 2);
  };
  ctx.save();
  if (opts.halo) {
    ctx.save(); place();
    ctx.lineJoin = 'round'; ctx.strokeStyle = opts.halo; ctx.fillStyle = opts.halo; ctx.lineWidth = ((opts.haloWidth ?? 3) * 2) / k;
    ctx.stroke(path); ctx.fill(path, rule);
    ctx.restore();
  }
  if (opts.shadow) {
    ctx.save(); place(size / 40, (size / 40) * 1.3);
    ctx.fillStyle = opts.shadow; ctx.fill(path, rule);
    ctx.restore();
  }
  place();
  ctx.fillStyle = color; ctx.fill(path, rule);
  ctx.restore();
}

/** Width a canvas icon takes before text at `size` (icon box + a gap), for laying out "icon number" runs. */
export const iconAdvance = (size: number, gap = 0.2) => size * (1 + gap);

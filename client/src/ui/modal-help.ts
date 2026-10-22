// Help modal (?): a short encyclopedia. Every bullet ≤ 12 words; numbers come from the rules.
import type { GameState } from '../../../shared/sim/types.ts';
import { type Ctx } from './modal-util.ts';
import { ic } from '../art/icons.ts';
import { openSoundSettings, soundIcon } from '../audio/hooks.ts';

/** "Reading the map": the board's visual language, first in How to win (and in the lobby's How to play, help.ts). */
export const MAP_INTRO = 'Everything on the board is either a territory, a star, a fleet piece, a battle, or an order line. Numbers appear only when you point at something: hover (or tap) a star for its defenders, a fleet for its strength, a battle for its odds. Zoom out for who owns what and where the armies are; zoom in for names, then the full tabletop.';
export const MAP_LEGEND: [string, string][] = [
  ['Coloured territory', 'who holds it.'],
  ['Gold ring', 'a Crown, worth victory points each turn. <b>Double ring</b>: the Throne.'],
  ['A counter or chevron beside a star', 'a fleet there; yours sit on the left.'],
  ['A piece on a lane', 'a fleet travelling.'],
  ['Crossed swords', 'a battle.'],
  ['Dashed line with arrowhead', 'a planned move. <b>Reticle</b>: a planned attack.'],
  ['Breathing rim', 'no orders. <b>Amber dashed rim</b>: out of supply.'],
  ['Hatching', 'cut off. <b>Dashed ring</b>: contested.'],
];
const mapRead = () => `<section class="hc map-read"><h3><span>◎</span>Reading the map</h3><p class="mr-intro">${MAP_INTRO}</p><ul class="mr-legend">${MAP_LEGEND.map(([k, v]) => `<li><b>${k}</b>: ${v}</li>`).join('')}</ul></section>`;

const A = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

export const HELP_TABS: [string, string, string][] = [['win', '♛', 'How to win'], ['orders', '➤', 'Orders'], ['combat', '⚔', 'Combat'], ['soul', '⚑', 'Banners'], ['bets', '⛉', 'Postures'], ['empire', '✺', 'Empire'], ['live', '⏱', 'Live mode']];

interface Card { ic: string; t: string; b: string[] }

function cards(st: GameState, tab: string): Card[] {
  const R = st.rules, V = R.victory, E = R.empire, S = R.soul;
  switch (tab) {
    case 'orders': return [
      { ic: '➤', t: 'Five orders', b: [`<b>${R.orders.perTurn} orders</b> a turn, however big your empire.`, 'Everyone plans in secret; all orders resolve together.', 'Order in the strip never matters: one step per turn.'] },
      { ic: '⚔', t: 'Drag to command', b: ['<b>Drag</b> a fleet onto a world: the target picks the verb.', 'Own or empty: <b>Move</b>. Hostile or neutral: <b>Seize</b>.', 'Drop on your own fleet to <b>merge</b> (free).', 'Or tap a fleet, then tap a lit world.'] },
      { ic: '⟿', t: 'Hyperlanes', b: ['Long lanes have waypoints: the arrow follows the lane.', 'Far moves become routes: fleets keep going each turn.', '<b>■ Halt</b> on the fleet card stops a route (free).'] },
      { ic: '⚒', t: 'Worlds', b: ['Tap your world: <b>Build</b> ships, <b>Develop</b> projects.', 'Build into a fleet here, or raise a <b>new banner</b>.', `A fleet's second order in a turn costs ${R.orders.repeatFleetCredits}¢.`] },
      { ic: '◉', t: 'The strip', b: ['Five slots at the bottom; flick a chip up to drop it.', 'The big button: idle fleets, research, then <b>Seal</b>.', '<b>Ctrl+Z</b> undoes; 👁 previews against idle rivals.'] },
      { ic: '◎', t: 'Intel', b: ['Rivals see your moves within their sensor range.', '<b>Feint</b> fakes signals; <b>Scan</b> exposes feints and nebulae.', '<b>Conceal</b> hides you, but your capital jams loudly.'] },
      { ic: '✦', t: 'Influence & pacts', b: ['<b>Influence</b> pushes loyalty; at the threshold the world defects.', '<b>Pact</b>: both offer the same turn. Breaking costs ♛.', 'Add <b>sworn words</b>: break them and you are Oathbreaker.'] },
    ];
    case 'combat': return [
      { ic: '⚔', t: 'Battles take time', b: [`Each turn a battle fights ${R.combat.roundsPerTurn} rounds, then carries on.`, 'Bigger battles last longer; arrivals join in.', 'Leaving a battle costs a parting volley.'] },
      { ic: '⛨', t: 'Sieges', b: ['<b>Seize</b> keeps attacking the garrison every turn.', `Garrison armour: ${R.garrison.armor} + fortress level per hit.`, 'Only <b>siege</b> damage ignores armour: bring Bombards.'] },
      { ic: '⤺', t: 'Rout, not ruin', b: ['A beaten banner usually <b>routs</b>: it limps home scarred.', 'A limping fleet cannot attack, and dies if caught.', `A third scar breaks it; so does a second rout in ${S?.routRepeatTurns ?? 4} turns.`] },
      { ic: '➤', t: 'Ships', b: ['Hits can knock out engines, weapons or shields.', 'Ships repair in your space; a shipyard restores all.', 'Every ship has an origin trait from where it was built.'] },
    ];
    case 'soul': return [
      { ic: '⚑', t: 'Banners', b: [`Fleets fly banners: ${S?.bannersBase ?? 3}, +${S?.bannersPerCrown ?? 1} per Crown held.`, 'Founding: a sigil, a name, boons paid for with banes.', 'Scout-only fleets are pickets: no banner.'] },
      { ic: '✠', t: 'Vows', b: ['Swear one vow: a bonus while you keep it.', 'Keep it: an epithet. Break it: <b>Oathbreaker</b>, forever.'] },
      { ic: '❖', t: 'Ranks & honours', b: ['Commanders rank up by fighting: choose 1 of 2 honours.', `Storied and Legend fleets can <b>retire</b>: a Haven deed.`] },
      { ic: '◈', t: 'Worlds remember', b: [`At development ${S?.callingAtDev ?? 3} a world takes a <b>Calling</b>.`, `It grows with tenure: ${(S?.tenureTiers ?? [3, 6, 10]).join(', ')} turns held.`, `Captured: dormant ${S?.dormantTurns ?? 3} turns. Retake in ${S?.liberateWithin ?? 5}: Liberated.`, 'Deeds are earned; <b>engrave</b> one to keep it.'] },
      { ic: '♨', t: 'Raze', b: ['Right after a capture you may <b>raze</b> a world.', 'Loot now, development −1; its old owner swears vengeance.'] },
      { ic: '✒', t: 'The Herald', b: ['A front page every turn, printed from the events.', 'Plant one <b>dispatch</b> a turn: a boast, a threat, a lie.', 'Blood-debts: kill a commander, and their house hits back harder.'] },
      { ic: '⚜', t: 'The Saga', b: ['At the end: every banner’s story, reigns, the fallen.', 'Copy it or save the image for the group chat.'] },
    ];
    case 'bets': {
      const G = R.signature;
      return [
        { ic: '⛉', t: 'Postures', b: ['Each turn, bet on your rival with a fleet’s <b>posture</b>.', 'Right: you win the moment. Wrong: you pay. Steady never bets.', 'Secret: rivals see it only beside you or by scan.'] },
        { ic: '⚔', t: 'The reads', b: ['<b>Charge</b> (with a Seize) beats Steady; <b>Guarded</b> beats Charge.', '<b>Ambush</b> beats Running; not coming beats Ambush.', 'Nobody came? Guarded digs in; Ambush is exposed.'] },
        { ic: '⚑', t: 'World stances', b: ['<b>Levies</b>: a siege is coming. <b>Scorch</b>: you’ll lose it.', '<b>Gates</b>: an ally needs a yard. Wrong bets cost output.'] },
        { ic: '✪', t: 'Fate', b: [`${G?.fateStart ?? 3} tokens a game; ${G?.fatePerTurn ?? 1} a turn; spent in public.`, '<b>Last Stand</b>, <b>Twist</b>, <b>Hyperjump</b>, <b>Rally</b>, <b>Surge</b>.', `Far behind (${G?.fateComebackGap ?? 10}+ ♛)? One more, once.`] },
        { ic: '✓', t: 'In the replay', b: ['<b>CALLED IT</b> when a read pays; <b>CAUGHT OUT</b> when it backfires.', 'Gold flares: a first strike. Violet swirl: a Twist of Fate.'] },
      ];
    }
    case 'empire': return [
      { ic: '✺', t: 'Research', b: [`<b>One technology per turn</b>: a free action, costs ⚙ ¢.`, 'Tier III is a fork: one of two, forever.', '★ belongs to whoever buys it first.', 'An <b>Academy</b> cuts prices; capturing one steals a tech.'] },
      { ic: '⚑', t: 'Laws', b: [`Enact: 1 order + ${E.lawCost}✦. Switching sides costs double.`, `${E.lawSlotsStart} slot, +1 at turn ${E.lawSlotTurns.join(', ')}, +1 with Bureaucracy.`, 'Revoking is free.'] },
      { ic: '➤', t: 'Ships', b: ['Each class carries one <b>module</b>; new ships get it.', `<b>Refit</b> at a shipyard upgrades a fleet: ⚙${E.refitIndustryPerShip} per ship.`] },
      ...(R.systems?.enabled !== false && st.regions[0]?.star ? [
        { ic: '☉', t: 'Star systems', b: ['Each world is a system: a star and up to 3 bodies.', `<b>Citizens</b> cap comes from bodies + star (max ${R.systems.maxCitizens}).`, `A quiet <b>Core</b> grows a citizen every ${R.systems.growthEvery} turns.`, 'Civil slots come from bodies; a <b>Station</b> adds one.'] },
        { ic: '⛯', t: 'Gates & slots', b: [`Shipyard: ${R.systems.shipyardCitizens} citizens or a Station. Academy: ${R.systems.academyCitizens}.`, `Military slots: ${R.systems.milSlots}, +${R.systems.chokeSlots} at chokepoints.`, `Waystations (≤${R.systems.waystationCitizens} citizen): forts and depots −${Math.round(R.systems.waystationDiscount * 100)}%.`, 'A black hole stops every fleet entering it.'] },
        ...(R.systems.contested !== false ? [
          { ic: '⛓', t: 'Contested', b: ['An enemy warship in your system: <b>contested</b>, no growth.', `Whoever holds space takes the <b>orbitals</b> (gas giant, belt, Station): an attacker plunders ${Math.round((R.systems.plunderShare ?? 0.5) * 100)}%.`, `Lose space and the <b>surface</b> is blockaded: ⚙¢ ${Math.round((R.systems.blockadeIndustry ?? 0.5) * 100)}%, no ✦.`, `Every ${R.systems.refugeeTurns ?? 3} contested turns a citizen flees as <b>refugees</b>.`] },
          { ic: '⚖', t: 'Occupied & Tribute', b: [`Just taken from a house: <b>Occupied</b>, ${Math.round((R.systems.occupiedShare ?? 0.5) * 100)}% for ${R.systems.occupiedTurns ?? 3} turns.`, 'A capture’s lost citizen flees to its old owner.', `A besieger may <b>offer terms</b>: accept next turn, pay ⅓ for ${R.systems.tributeTurns ?? 5} turns, the siege lifts.`, 'Attacking it after: <b>Oathbreaker</b>.'] },
        ] : []),
      ] : []),
      { ic: '⚛', t: 'Veins & supply', b: ['⚛ Antimatter: Cruisers, Dreadnoughts. ◆ Crystals: Shields, Gates.', 'An <b>Extractor</b> on a connected vein gives access.', '<b>Cut off</b> from your capital: half yield, veins dark.', 'Out of supply, fleets stop repairing and wear down.'] },
    ];
    case 'live': return [
      { ic: '⏱', t: 'Real time', b: [`No turns to seal: a tick every ${R.live.tickMinutes} minutes.`, `Earn an order every ${R.live.orderEveryHours}h; bank up to ${R.live.bankCap}.`, 'A full bank wastes new orders: spend them.'] },
      { ic: '➤', t: 'Orders', b: ['Orders act at the <b>next tick</b>; take back before it.', 'Moves go any distance; fleets travel in real time.', `Every ${R.live.ticksPerCycle} ticks a <b>cycle</b> ends: income, scoring, the Herald.`] },
    ];
    default: return [
      { ic: '♛', t: 'Victory', b: [`First to <b>${V.vpTarget} ♛</b> wins.`, `Or most ♛ after turn ${V.turnLimit}.`, `Or hold <b>all three Crowns</b> for ${R.crowns.holdTurnsToWin} turns.`] },
      { ic: '♛', t: 'Scoring', b: [`<b>Crowns</b>: ${V.vpPerCrownPerTurn}♛ a turn each, +${V.crownMajorityVp} for two or more.`, 'The <b>Throne</b> pays 1, 2, 3… for each turn held.', 'Holdings pay only if held since the turn began.', `<b>Relics</b> ${V.vpPerRelic}♛; capitals ${V.vpCapitalCapture}♛; edicts and battle honours.`] },
      { ic: '⚠', t: 'Watch out', b: [`${R.warden.wakeAtLore} relics wake the <b>Warden</b>; it hunts the leader.`, 'Hitting the leader pays a <b>bounty</b>.', `Trailing by ${R.comeback.gap}+ ♛ gives +${Math.round(R.comeback.incomeBonus * 100)}% income.`] },
      { ic: '⚙', t: 'Economy', b: ['⚙ builds. ¢ pays upkeep and covers missing ⚙.', '✦ buys influence, scans, feints and pacts.'] },
    ];
  }
}

export function helpBody(c: Ctx): string {
  const cs = cards(c.g.st, c.tab);
  const credits = c.tab === 'win' ? `<section class="hc credits"><h3><span>${ic('dispatch')}</span>Credits</h3><ul>
    <li>Icons by <b>Lorc, Delapouite &amp; contributors</b>, ${A('https://game-icons.net', 'game-icons.net')}, ${A('https://creativecommons.org/licenses/by/3.0/', 'CC BY 3.0')} (recoloured; a few drawn for this game).</li>
    <li>Sound effects by <b>Kenney</b> (${A('https://kenney.nl', 'kenney.nl')}), ${A('https://creativecommons.org/publicdomain/zero/1.0/', 'CC0')}.</li>
    <li>Music from ${A('https://opengameart.org', 'OpenGameArt.org')}, CC0: <b>cynicmusic</b>, <b>SRG774</b>, <b>congusbongus</b>, <b>RandomMind</b>.</li>
    <li>Textures by <b>ambientCG</b> (${A('https://ambientcg.com', 'ambientcg.com')}), CC0. Fonts: Google Fonts, SIL OFL 1.1.</li></ul></section>` : '';
  const keys = c.tab === 'win' ? `<section class="hc keys"><h3><span>⌨</span>Keys</h3><div class="kgrid"><kbd>E</kbd><span>Empire</span><kbd>Q</kbd><span>Score</span><kbd>C</kbd><span>Chronicle</span><kbd>?</kbd><span>Help</span><kbd>Esc</kbd><span>Close</span><kbd>1–7</kbd><span>Tabs</span><kbd>Tab</kbd><span>Idle fleet</span><kbd>Enter</kbd><span>Seal</span><kbd>Space</kbd><span>Peek / skip</span><kbd>Shift+M</kbd><span>Mute sound</span></div></section>` : '';
  const restart = c.g.you !== null && (c.g.restartTips || c.g.restartTour) ? `<button class="mbtn m-ghost" data-a="tips">↻ Restart tips</button>` : '';
  const sound = `<button class="mbtn m-ghost" data-a="sound">${soundIcon(false)} Sound settings</button>`;
  return `<div class="m-help"><div class="hgrid">${c.tab === 'win' ? mapRead() : ''}${cs.map(x => `<section class="hc"><h3><span>${x.ic}</span>${x.t}</h3><ul>${x.b.map(b => `<li>${b}</li>`).join('')}</ul></section>`).join('')}${keys}${credits}</div><div class="help-foot">${sound}${restart}</div></div>`;
}

export function helpAct(c: Ctx, a: string): boolean {
  if (a === 'sound') { openSoundSettings(); return true; }
  if (a !== 'tips') return false;
  c.close();
  if (c.g.restartTips) c.g.restartTips(); else c.g.restartTour?.();
  return true;
}

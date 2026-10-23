// "How to play" (lobby button, and the HUD's fallback when the Help modal can't open): the whole game on one
// page, written for the UX v2 board (drag-to-order, the plan strip, the primary button, modals) and the Soul layer.
import type { GameState } from '../../../shared/sim/types.ts';
import { ORDER_INFO } from '../../../shared/sim/orders.ts';
import { ORDER_ICON } from '../hud/util.ts';
import { MAP_INTRO, MAP_LEGEND } from './modal-help.ts';
import { CR } from '../../../shared/sim/court.ts';

/** The Court (docs/SOUL.md §4): only in games that have one (st.court; an old save never does). */
function courtHelp(st: GameState): string {
  const K = CR(st);
  return `<h2>The Court</h2>
  <ul>
    <li><b>Captives.</b> Wipe out a fleet (or catch it limping) and its commander may be taken <b>captive</b>. The captor decides on the world's card, once a turn: <b>Ransom</b> (name the terms, credits or influence; the price rises with rank), <b>Turn</b> them (pay influence; they serve you, scars and all) or <b>Execute</b> them (a wax seal: a grievance that never clears). Nobody decides, and the captive walks home free after ${K.releaseTurns} turns.</li>
    <li><b>Ransom letters.</b> If your commander is held, the captor's terms reach you the next turn: <b>Pay</b> and they come home, or <b>Refuse</b> and the captor decides again.</li>
    <li><b>Kneel or Defy.</b> When a house takes the Hollow Throne, every rival answers in public within ${K.decreeTurns} turns. <b>Kneel</b>: +${K.kneelInfluence} influence now, but striking the holder later costs ${K.kneelBreakVp} VP. <b>Defy</b>: free, printed in the Herald. Silence is Defiance. The crests show who knelt and who defied.</li>
    <li><b>Exile.</b> A fallen house stays at the table. It <b>whispers</b> to the Warden (which hunts that house if it is near the lead), casts a <b>ghost vote</b> (+${K.ghostInfluence} influence a turn to that house, and it wins exact ties), and earns Exile points from what its mark loses: they count against the winner in the Saga and the League.</li>
  </ul>`;
}

export function helpHtml(st: GameState): string {
  const R = st.rules, S = R.soul;
  // the simplified world (rules.world, SIMPLIFY.md stage B): per-track caps instead of slots, no Stations, Engrave
  // or Open the Gates. Old saves without the layer keep the old text.
  const W = R.world && R.world.enabled !== false ? R.world : null;
  return `<h1 style="color:var(--gold)">How to play Three Crowns</h1>
  <p>Three heirs fight over the frontier of a dead empire. Everyone plans <b>at the same time</b>, in secret; then every order of all three players resolves together in <b>one step</b>, and you watch it happen on the board. You don't need to be online together: a turn resolves when all three have sealed.</p>
  <h2>Reading the map</h2>
  <p>${MAP_INTRO}</p>
  <ul>${MAP_LEGEND.map(([k, v]) => `<li><b>${k}</b>: ${v}</li>`).join('')}</ul>
  <h2>The board is the interface</h2>
  <ul>
    <li><b>Drag one of your fleets onto a world.</b> The target picks the verb: your own or an empty world means <b>Move</b>, a hostile or neutral one means <b>Seize</b>, your own fleet means <b>Merge</b> (free). A card at the arrow head says what will happen, with the odds; invalid targets never light up.</li>
    <li>Long hyperlanes have waypoint dots, and the arrow follows the lane. A move beyond this turn's reach becomes a <b>route</b>: the fleet keeps going on later turns without new orders (■ Halt on its card stops it).</li>
    <li>Prefer taps? Tap a fleet, then tap a lit world. Right-click or long-press anything for its <b>ring</b> of actions (Fortify, Scan, Feint, Split, Build, Develop, Influence, Pact…).</li>
    <li>Tap one of your worlds for its card: the <b>Build</b> tray (into a fleet already there, or a <b>new banner</b>) and the <b>Develop</b> tray. Tap a fleet for its ship fan: lift chips and drag them out to split.</li>
  </ul>
  <h2>A turn</h2>
  <ol>
    <li>Fill up to <b>${R.orders.perTurn} order slots</b> in the strip at the bottom. Your empire gets ${R.orders.perTurn} orders a turn forever: bigger empires mean more choices, not more actions. A fleet can take at most ${R.orders.maxPerFleet}, and its second costs ${R.orders.repeatFleetCredits}¢. Flick a chip up (or right-click it) to remove it; <b>Ctrl+Z</b> undoes.</li>
    <li>The big <b>primary button</b> walks you through what needs attention: idle fleets, research, then <b>Seal ✓</b>. Enter seals at once.</li>
    <li>When all three have sealed, the turn resolves and the <b>replay</b> plays on the board. Battles leave a chip bottom-left: tap it for the battle viewer. Space skips.</li>
    <li>Then <b>the Herald</b> prints the turn's front page. Read it, plant a dispatch if you like, and go back to the board.</li>
  </ol>
  <p class="dim">Free actions cost no order: doctrine, splits, merges, renames, research, vows, honours, callings, dispatches. The screens: <b>✺ Empire</b> (E: research, laws, ship designs), <b>♛ Score</b> (Q: standings, pacts, intel, chat), <b>☰ Chronicle</b> (C: every turn, replays, the Herald, the Saga), <b>?</b> Help. Keys 1–4 switch map lenses; hold Space to peek at every world's details. The first turns teach by doing: follow the gold callouts (Menu → Teach again restarts them).</p>
  <h2>Fleets are characters</h2>
  <ul>
    <li><b>Founding.</b> A new fleet raises a <b>banner</b>: pick one of 12 sigils, a name (three suggestions), and optional <b>boons</b> paid for with <b>banes</b> (at most 3 of each; one point is free). Banners are scarce: ${S?.bannersBase ?? 3}, plus ${S?.bannersPerCrown ?? 1} per Crown you hold. Scouts alone form a picket with no banner. <b>Quick</b> founds with the defaults.</li>
    <li><b>Vows.</b> A fleet may swear one vow (take the Throne, never retreat, guard a world, avenge a commander, bring a relic home). Keep it for an epithet; break it and the fleet is <b>Oathbreaker</b> for the rest of the game.</li>
    <li><b>Ranks and honours.</b> Commanders rank up by fighting (chevrons on the pennant). Each rank-up offers two honours: choose one on the fleet card. Storied and Legend fleets can <b>retire</b> at one of your worlds, which becomes their Haven.</li>
    <li><b>Defeat routs.</b> A beaten banner usually survives: it takes a <b>scar</b> and limps home (smoke, a drooping pennant, an ETA). A limping fleet cannot attack and dies if caught; a third scar breaks it.</li>
  </ul>
  <h2>Star systems</h2>
  <ul>
    <li>Every world is a <b>star system</b>: a star and up to three bodies (habitable worlds, gas giants, belts, moons, barren worlds, ruins). Its <b>role</b> (Core, Forge, Harbor, Waystation) is read from its bodies, never chosen.</li>
    <li><b>Citizens</b> (development) have a cap from the bodies and the star. An uncontested Core grows a citizen every few turns; Develop still buys one. A Shipyard needs 2 citizens (or a Station), an Academy 3.</li>
    ${W ? `<li>A system improves along <b>tracks</b>: <b>Works</b> (Mine, Trade Hub, Extractor, Academy: up to ${W.slots ? 'its slots' : `${W.worksCap} kinds, one per productive body`}), <b>Walls</b> (Fortress, Battery, Shield: ${W.wallsCap}, +${W.chokeWalls} at chokepoints) and <b>Outpost</b> (Depot, Sensor, Warp Gate: ${W.outpostCap}).${W.station === false ? ' No new Stations are built; old ones keep their extra citizen.' : ''} Walls and Outposts cost 30% less at a Waystation. Black holes stop fleets passing through; pulsars see further and make Warp Gates cheaper.</li>`
    : `<li>Civil buildings take a slot from a body (a Mine needs a belt, barren world or vein; a Trade Hub a habitable world or gas giant); a <b>Station</b> adds a slot and a citizen. Military buildings have 2 slots (3 at chokepoints) and cost 30% less at a Waystation. Black holes stop fleets passing through; pulsars see further and make Warp Gates cheaper.</li>`}
    <li>An enemy warship in your system makes it <b>contested</b>: no growth, and whoever holds space (the last battle's winner if still there, else the bigger fleet) takes the orbital output (gas giants, belts, a Station): an attacker plunders half. Without space your surface is <b>blockaded</b> (half industry and credits, no influence), and every 3 contested turns a citizen flees as <b>refugees</b> to your nearest system with room.</li>
    <li>A system just taken from a house is <b>Occupied</b>: half its output for 3 turns. A besieger can <b>offer terms</b>; accept them the next turn and the siege lifts while you pay a third of its output for 5 turns. Attacking it afterwards breaks the terms: Oathbreaker.</li>
    <li>Battles are fought over a body (“Battle of the Ashen Belt”); a body that sees two or more events earns a name (“Vel II, the Burned World”). A <b>Calling</b> needs the right ground: Granary a habitable world, Refinery a belt, gas giant or vein, Oracle a ruin or pulsar, Arsenal a shipyard, Cenotaph two battles.</li>
  </ul>
  <h2>Worlds with a story</h2>
  <ul>
    <li>Every world keeps a ledger (toil, blood, siege, relics, loss) that gives it an <b>epithet</b>. At development ${S?.callingAtDev ?? 3} it takes a <b>Calling</b> (one of two: from its nature or its history), which grows at ${(S?.tenureTiers ?? [3, 6, 10]).join(', ')} turns of continuous ownership: the ring around its medallion.</li>
    <li>Worlds earn up to two <b>deeds</b>${W?.engrave === false ? '' : '; <b>engrave</b> one to keep it forever'}. A captured world's calling goes dormant; retake it within ${S?.liberateWithin ?? 5} turns and it is Liberated. Right after a capture you may <b>raze</b> it: loot now, development −1, and its old owner swears vengeance.</li>
  </ul>
  <h2>Your friends are the antagonists</h2>
  <ul>
    <li><b>The Herald</b> prints headlines from what happened (and what your intel let you see). Each house may plant one dispatch per edition, under its own name or as "a source": a boast, a threat or a lie, printed as fact.</li>
    <li><b>Sworn pacts</b> can carry your own words. Break them and your crest is branded Oathbreaker, with your words beside the breach.</li>
    <li><b>Blood-debts</b>: kill a rival's commander and their house hits you harder until they get even (a drop of blood on the map).</li>
    <li>At the end, <b>the Saga</b> tells it all: every banner's story, the Throne's reigns, the memorial roll, broken oaths and debts. Copy it or save the image for the group chat.</li>
  </ul>
${st.court ? courtHelp(st) : ''}
  <h2>Postures and Fate: reading your friends</h2>
  <ul>
    <li>From turn ${3} each fleet card offers a <b>posture</b>: a secret bet on what your rival will do this turn. <b>Guarded</b> (they attack me here), <b>Running</b> (my path is clear), <b>Charge</b> (with a Seize: the defender isn't braced), <b>Ambush</b> (they come through here). Right, and you win the moment; wrong, and you pay. <b>Steady</b>, the default, never bets. Drop a Seize by drag and the board offers a Charge.</li>
    <li>Your worlds can take a stance too: <b>Call the Levies</b>, <b>Scorched Earth</b>${W?.gatesPosture === false ? '' : ', <b>Open the Gates</b>'}.</li>
    <li><b>Fate</b>: ${R.signature?.fateStart ?? 3} tokens a game (the coins at the top), at most ${R.signature?.fatePerTurn ?? 1} a turn, spent in public: Last Stand, Twist of Fate, Hyperjump, Rally (a limping fleet) and Surge (a world). The replay stamps CALLED IT and CAUGHT OUT.</li>
  </ul>
  <h2>Combat</h2>
  <ul>
    <li><b>Battles take time.</b> Each turn a battle fights ${R.combat.roundsPerTurn} rounds and then carries on, so reinforcements can arrive and sieges give defenders time to respond. Bigger battles last longer; leaving one costs a parting volley.</li>
    <li><b>Sieges persist</b>: a Seize keeps attacking the garrison every turn until it falls or you leave. Garrisons have armour (${R.garrison.armor} + fortress level per hit); only siege damage ignores it.</li>
    <li>Hits can knock out engines, weapons or shields. Ships repair in your space; a shipyard restores everything. Every battle still reaches a decision.</li>
  </ul>
  <h2>Live mode</h2>
  <ul>
    <li>No turns to seal: the world <b>ticks</b> on a real clock (every ${R.live.tickMinutes} minutes at normal speed). You earn an order every ${R.live.orderEveryHours} hours and bank up to ${R.live.bankCap}. Orders act at the next tick and can be taken back until then. Every ${R.live.ticksPerCycle} ticks a cycle ends: income, scoring and a new Herald.</li>
  </ul>
  <h2>Winning</h2>
  <ul><li>First to <b>${R.victory.vpTarget} VP</b>, or most VP after turn ${R.victory.turnLimit}, or hold <b>all three Crowns</b> for ${R.crowns.holdTurnsToWin} consecutive turns. Crowns pay ${R.victory.vpPerCrownPerTurn} VP a turn each; the Hollow Throne pays 1, 2, 3… for each turn held; relics, captured capitals, edicts and battle honours add more. Falling ${R.comeback.gap}+ VP behind gives +${Math.round(R.comeback.incomeBonus * 100)}% income.</li></ul>
  <h2>Orders reference</h2>
  <ul>${Object.entries(ORDER_INFO).filter(([k]) => !(k === 'engrave' && W?.engrave === false)).map(([k, o]) => `<li>${ORDER_ICON[k as keyof typeof ORDER_ICON]} <b>${o.name}</b>: ${o.help}</li>`).join('')}</ul>
  <h2>On a phone</h2>
  <p class="dim">The board fills the screen; the strip and the primary button sit in the thumb zone. Tap to select (the card is a bottom sheet: swipe it down), drag a fleet to order it (a loupe shows what is under your finger), pinch to zoom, drag empty space to pan, long-press for the ring. The screens fold into ≡.</p>
  <h2>Credits</h2>
  <p class="dim">Icons by Lorc, Delapouite &amp; contributors, <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a>, <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>. Sound effects by Kenney (kenney.nl); music by cynicmusic, SRG774, congusbongus and RandomMind (OpenGameArt.org); textures by ambientCG: all CC0. Fonts from Google Fonts (SIL OFL 1.1).</p>`;
}

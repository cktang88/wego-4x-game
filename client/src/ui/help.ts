import type { GameState } from '../../../shared/sim/types.ts';
import { ORDER_INFO } from '../../../shared/sim/orders.ts';

export function helpHtml(st: GameState): string {
  const R = st.rules;
  return `<h1 style="color:var(--gold)">How to play Three Crowns</h1>
  <p>Three heirs fight over the frontier of a dead empire. Everyone plans <b>at the same time</b>, in secret. Then all orders resolve together (WEGO). You don't need to be online together: the turn resolves when all three have sealed their orders${''}.</p>
  <h2>The one rule that matters: ${R.orders.perTurn} orders</h2>
  <ul>
    <li>Your whole empire gets <b>${R.orders.perTurn} orders per turn</b>, forever. It doesn't grow as your empire grows. Bigger empires mean more choices, not more actions.</li>
    <li>The order in slot <b>I</b> resolves in <b>pulse I</b> for every player at once, then pulse II, and so on. Sequencing matters: move in pulse I, then seize in pulse II.</li>
    <li>A fleet can take at most <b>${R.orders.maxPerFleet}</b> orders per turn, and the second one costs ${R.orders.repeatFleetCredits}¢ (fatigue).</li>
    <li>Anything you don't order still works: regions produce, garrisons regenerate, projects progress, and fleets follow their <b>doctrine</b> (free to change).</li>
  </ul>
  <h2>Live mode (if you picked it)</h2>
  <ul>
    <li>No turns to seal. The galaxy <b>ticks</b> on a real clock: a tick every ${R.live.tickMinutes} minutes at normal speed. Each tick is one pulse (below).</li>
    <li>You <b>earn one order every ${R.live.orderEveryHours} hours</b> and can bank up to ${R.live.bankCap}. Spend them right away or save them for a big turn. A full bank wastes new orders, so spend before it overflows.</li>
    <li>Spent orders act at the <b>next tick</b>. Until then you can take them back (refunded).</li>
    <li>Moves can go <b>any distance</b>. Fleets travel in real time, and you can see their route and arrival time. So can rivals whose sensors cover them. <b>Halt</b> is free.</li>
    <li>Every ${R.live.ticksPerCycle} ticks a <b>cycle</b> ends: income, upkeep, scoring and edicts. A cycle is the same as a WEGO turn.</li>
    <li>Doctrine, splits, merges and renames stay free.</li>
  </ul>
  <h2>Inside each pulse (always in this order)</h2>
  <ol>
    <li><b>Prepare</b>: Fortify, Scan, Feint, Conceal, Pact offers.</li>
    <li><b>Influence</b>: loyalty pushes (one per region per turn, capped at the threshold). A neutral at ${R.influence.flipThreshold} loyalty defects; a rival region needs ${R.influence.rivalFlipThreshold} (+${R.influenceLimits.perFortress} per fortress level; capitals never). Crowns and the Throne need ×${R.influenceLimits.crownMult}. It won't defect while another hostile fleet occupies it. Influencing your <b>own</b> region purges rival agents.</li>
    <li><b>Movement</b>: every moving fleet advances one region per step, simultaneously.
      <ul><li>Two hostile fleets moving through each other's regions <b>clash</b> on the border. There are no bounces: someone wins, and the winner keeps going.</li>
      <li>Entering a region with hostile fleets or a <b>rival-owned</b> garrison stops you. Neutral garrisons let you pass.</li>
      <li><b>Guard</b> fleets automatically jump into an adjacent region of yours that gets invaded (once per turn).</li>
      <li>Fleets that end up in the same region as hostiles are now in a battle (unless both sides are evasive). It is fought in the combat step below.</li></ul></li>
    <li><b>Siege</b>: fleets ordered to Seize begin a siege of the target. Other fleets adjacent to it can <b>join the assault</b> in the same order.</li>
    <li><b>Combat</b>: every battle in progress fights its rounds, new arrivals join in, and a besieger whose target has no garrison or defenders left captures it.</li>
    <li><b>Economy</b>: builds, projects, excavations.</li>
  </ol>
  <p class="dim">After pulse ${R.orders.pulses}: the Warden acts, then income and upkeep, then pacts. Then VP is scored on the <b>final</b> state.</p>
  <h2>Combat</h2>
  <ul>
    <li><b>Battles take time.</b> Every pulse, each battle fights ${R.combat.roundsPerPulse} round${R.combat.roundsPerPulse > 1 ? 's' : ''}, so a fight lasts through the turn and often into the next ones. Only part of a big fleet can fire at once (${R.combat.frontageBase} ships + 1 per ${Math.round(1 / R.combat.frontagePerShip)} ships), so <b>bigger battles last longer</b>. Ships that arrive mid-battle, whether moved in, guarding, or newly built, <b>join it</b>. A ⚔ marker shows battles in progress.</li>
    <li><b>Sieges are persistent.</b> Seize puts a fleet under siege orders. It keeps fighting the garrison every pulse, across turns, with no new orders, until the garrison falls (capture) or the fleet leaves or is driven off. Defenders have time to respond.</li>
    <li>Leaving a battle you are in costs a parting volley.</li>
    <li>Battles are automatic and deterministic from the game seed. Watch them in the replay (click a battle in the ticker or the Chronicle).</li>
    <li>Hits can knock out <b>engines</b> (the ship can't retreat and is left behind for a last stand), <b>weapons</b>, or <b>shields</b>. Ships repair in your own regions; a shipyard restores everything.</li>
    <li><b>Garrisons</b> have armor (${R.garrison.armor}+fortress level per hit). Only <b>siege</b> damage ignores armor. Bombards crack fortresses, frigates don't.</li>
    <li>Battles always reach a decision eventually: after ${R.combat.maxRoundsBase} + ${R.combat.roundsPerHull} round per ship committed, the weaker side is forced out. Retreating fleets take a parting volley.</li>
    <li>Commanders earn <b>traits through deeds</b> (Hunter, Giantkiller, Survivor, Stalwart…). Repeated foes become rivals, and whoever lost the last meeting gets <b>Vengeance</b>. Ships that survive ${R.combat.veteranBattles} fleet battles earn a name. The dead are remembered in memorials.</li>
  </ul>
  <h2>Economy</h2>
  <ul><li>⚙ Industry builds ships and projects. ¢ Credits pay ship upkeep, project costs, and a fleet's second order. Spare credits automatically cover an industry shortfall at ${R.economy.creditsPerIndustry}¢ per ⚙.</li>
  <li>✦ Influence buys subversion, scans, feints, conceal and pacts.</li>
  <li>Fleets and squadrons formed this turn (new builds, splits) can act from next turn.</li>
  <li>Garrisons fire on any hostile fleet inside their region, so parking in enemy territory is never free.</li></ul>
  <h2>Intel and deception</h2>
  <ul><li>Every order leaves traces. Within sensor range you see rival fleet movements with origin, destination, arrival pulse and a size band, plus construction and agents.</li>
  <li><b>Feint</b> broadcasts fake movements. <b>Scan</b> exposes feints and fleets hidden in nebulae. <b>Conceal</b> hides all your signals but makes your capital jam loudly.</li></ul>
  <h2>Winning</h2>
  <ul><li>First to <b>${R.victory.vpTarget} VP</b>, or most VP after turn ${R.victory.turnLimit}, or hold <b>all three Crowns</b> at the end of ${R.crowns.holdTurnsToWin} consecutive turns.</li>
  <li>Falling ${R.comeback.gap}+ VP behind the leader gives you +${Math.round(R.comeback.incomeBonus * 100)}% income (never extra orders).</li>
  <li>Crowns and the Throne only pay VP if you already held them when the turn began, so a last-pulse grab denies VP but doesn't score it.</li>
  <li>Crowns: ${R.victory.vpPerCrownPerTurn} VP/turn each, +${R.victory.crownMajorityVp} for holding 2 or more. The <b>Hollow Throne</b> pays 1, 2, 3… up to ${R.throne.streakMaxVp} VP for each consecutive turn held, and its occupants are visible to everyone.</li>
  <li>Relics: ${R.victory.vpPerRelic} VP, a permanent bonus, and a fragment of the truth. After ${R.warden.wakeAtLore} fragments, the Warden wakes in the Throne${R.wardenHunt.enabled ? ' and <b>marches on the VP leader</b>, razing their regions' : ''}. Killing it is worth ${R.warden.defeatVp} VP.</li>
  <li>Edicts are public objectives, announced a turn ahead. Taking regions from the VP leader pays a bounty. Winning big battles earns honors. Breaking a pact costs ${R.influence.pactBreakVp} VP.</li></ul>
  <h2>Orders reference</h2>
  <ul>${Object.values(ORDER_INFO).map(o => `<li>${o.icon} <b>${o.name}</b>: ${o.help}</li>`).join('')}</ul>
  <h2>Controls</h2>
  <p class="dim">Drag to pan, wheel or pinch to zoom. Click a fleet or region. <span class="kbd">M</span>/<span class="kbd">S</span>/<span class="kbd">F</span> move/seize/fortify the selected fleet. <span class="kbd">1</span>–<span class="kbd">5</span> choose which pulse the next order goes into. <span class="kbd">Shift</span>-click for Overdrive. <span class="kbd">I</span> toggles intel. <span class="kbd">R</span> replays. <span class="kbd">Ctrl+Enter</span> seals your orders. <span class="kbd">Esc</span> cancels.</p>`;
}

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
  <h2>Inside each pulse (always in this order)</h2>
  <ol>
    <li><b>Prepare</b>: Fortify, Scan, Feint, Conceal, Pact offers.</li>
    <li><b>Influence</b>: loyalty pushes. A neutral at ${R.influence.flipThreshold} loyalty defects (a rival region needs ${R.influence.rivalFlipThreshold}), unless someone else's fleet occupies it.</li>
    <li><b>Movement</b>: every moving fleet advances one region per step, simultaneously.
      <ul><li>Two hostile fleets moving through each other's regions <b>clash</b> on the border. There are no bounces: someone wins, and the winner keeps going.</li>
      <li>Entering a region with hostile fleets or a hostile garrison stops you.</li>
      <li><b>Guard</b> fleets automatically jump into an adjacent region of yours that gets invaded (once per turn).</li>
      <li>Battles break out wherever hostile fleets meet (unless both sides are evasive).</li></ul></li>
    <li><b>Seize</b>: fleets ordered to seize fight the garrison. If the garrison falls, the region is theirs.</li>
    <li><b>Economy</b>: builds, projects, excavations.</li>
  </ol>
  <p class="dim">After pulse ${R.orders.pulses}: the Warden acts, then income and upkeep, then pacts. Then VP is scored on the <b>final</b> state.</p>
  <h2>Combat</h2>
  <ul>
    <li>Battles are automatic and deterministic from the game seed. Watch them in the replay (click a battle in the ticker or the Chronicle).</li>
    <li>Hits can knock out <b>engines</b> (the ship can't retreat and is left behind for a last stand), <b>weapons</b>, or <b>shields</b>. Ships repair in your own regions; a shipyard restores everything.</li>
    <li><b>Garrisons</b> have armor (${R.garrison.armor}+fortress level per hit). Only <b>siege</b> damage ignores armor. Bombards crack fortresses, frigates don't.</li>
    <li>Battles always reach a decision: after ${R.combat.maxRounds} rounds the weaker side retreats. Retreating fleets take a parting volley.</li>
    <li>Commanders earn <b>traits through deeds</b> (Hunter, Giantkiller, Survivor, Stalwart…). Repeated foes become rivals, and whoever lost the last meeting gets <b>Vengeance</b>. Ships that survive ${R.combat.veteranBattles} fleet battles earn a name. The dead are remembered in memorials.</li>
  </ul>
  <h2>Intel and deception</h2>
  <ul><li>Every order leaves traces. Within sensor range you see rival fleet movements with origin, destination, arrival pulse and a size band, plus construction and agents.</li>
  <li><b>Feint</b> broadcasts fake movements. <b>Scan</b> exposes feints and fleets hidden in nebulae. <b>Conceal</b> hides all your signals but makes your capital jam loudly.</li></ul>
  <h2>Winning</h2>
  <ul><li>First to <b>${R.victory.vpTarget} VP</b>, or most VP after turn ${R.victory.turnLimit}, or hold <b>all three Crowns</b> at the end of a turn.</li>
  <li>Crowns: ${R.victory.vpPerCrownPerTurn} VP/turn each, +${R.victory.crownMajorityVp} for holding 2 or more. The <b>Hollow Throne</b> pays 1, 2, 3… up to ${R.throne.streakMaxVp} VP for each consecutive turn held, and its occupants are visible to everyone.</li>
  <li>Relics: ${R.victory.vpPerRelic} VP, a permanent bonus, and a fragment of the truth. After ${R.warden.wakeAtLore} fragments, the Warden wakes in the Throne. Killing it is worth ${R.warden.defeatVp} VP.</li>
  <li>Edicts are public objectives, announced a turn ahead. Taking regions from the VP leader pays a bounty. Winning big battles earns honors. Breaking a pact costs ${R.influence.pactBreakVp} VP.</li></ul>
  <h2>Orders reference</h2>
  <ul>${Object.values(ORDER_INFO).map(o => `<li>${o.icon} <b>${o.name}</b>: ${o.help}</li>`).join('')}</ul>
  <h2>Controls</h2>
  <p class="dim">Drag to pan, wheel or pinch to zoom. Click a fleet or region. <span class="kbd">M</span>/<span class="kbd">S</span>/<span class="kbd">F</span> move/seize/fortify the selected fleet. <span class="kbd">1</span>–<span class="kbd">5</span> choose which pulse the next order goes into. <span class="kbd">Shift</span>-click for Overdrive. <span class="kbd">I</span> toggles intel. <span class="kbd">R</span> replays. <span class="kbd">Ctrl+Enter</span> seals your orders. <span class="kbd">Esc</span> cancels.</p>`;
}

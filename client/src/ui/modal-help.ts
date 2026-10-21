// Help modal (?): a short encyclopedia. Every bullet ≤ 12 words; numbers come from the rules.
import type { GameState } from '../../../shared/sim/types.ts';
import { type Ctx } from './modal-util.ts';

export const HELP_TABS: [string, string, string][] = [['win', '♛', 'How to win'], ['orders', '➤', 'Orders'], ['combat', '⚔', 'Combat'], ['empire', '✺', 'Empire'], ['live', '⏱', 'Live mode']];

interface Card { ic: string; t: string; b: string[] }

function cards(st: GameState, tab: string): Card[] {
  const R = st.rules, V = R.victory, E = R.empire;
  switch (tab) {
    case 'orders': return [
      { ic: '➤', t: 'Five orders', b: [`<b>${R.orders.perTurn} orders</b> a turn, however big your empire.`, 'Everyone plans in secret, then all orders resolve together.', `Slot <b>I</b> acts in pulse I for everyone, then II…`] },
      { ic: '⚔', t: 'Drag to command', b: ['<b>Drag</b> a fleet onto a region: the target picks the verb.', 'Own or empty region: <b>Move</b>. Hostile neighbour: <b>Seize</b>.', 'Drop on your own fleet to <b>merge</b> (free).'] },
      { ic: '⚒', t: 'Worlds', b: ['Tap your world: <b>Build</b> ships, <b>Develop</b> projects.', 'Projects finish by themselves over the next turns.', `A fleet's second order in a turn costs ${R.orders.repeatFleetCredits}¢.`] },
      { ic: '◎', t: 'Intel', b: ['Rivals see your moves within their sensor range.', '<b>Feint</b> fakes signals; <b>Scan</b> exposes feints and nebulae.', '<b>Conceal</b> hides you, but your capital jams loudly.'] },
      { ic: '✦', t: 'Influence', b: ['<b>Influence</b> pushes loyalty; at the threshold the region defects.', '<b>Pact</b>: both sides offer the same turn. Breaking costs ♛.'] },
    ];
    case 'combat': return [
      { ic: '⚔', t: 'Battles take time', b: [`Each pulse every battle fights ${R.combat.roundsPerPulse} round${R.combat.roundsPerPulse > 1 ? 's' : ''}.`, 'Bigger battles last longer; arrivals join in.', 'Leaving a battle costs a parting volley.'] },
      { ic: '⛨', t: 'Sieges', b: ['<b>Seize</b> keeps attacking the garrison every pulse, across turns.', `Garrison armour: ${R.garrison.armor} + fortress level per hit.`, 'Only <b>siege</b> damage ignores armour: bring Bombards.'] },
      { ic: '➤', t: 'Ships', b: ['Hits can knock out engines, weapons or shields.', 'Ships repair in your space; a shipyard restores all.', 'Veterans earn names; commanders earn traits by deeds.'] },
    ];
    case 'empire': return [
      { ic: '✺', t: 'Research', b: [`<b>One technology per turn</b>: a free action, costs ⚙ ¢.`, 'Tier III is a fork: one of two, forever.', '★ belongs to whoever buys it first.', 'An <b>Academy</b> cuts prices; capturing one steals a tech.'] },
      { ic: '⚑', t: 'Laws', b: [`Enact: 1 order + ${E.lawCost}✦. Switching sides costs double.`, `${E.lawSlotsStart} slot, +1 at turn ${E.lawSlotTurns.join(', ')}, +1 with Bureaucracy.`, 'Revoking is free.'] },
      { ic: '➤', t: 'Ships', b: ['Each class carries one <b>module</b>; new ships get it.', `<b>Refit</b> at a shipyard upgrades a fleet: ⚙${E.refitIndustryPerShip} per ship.`] },
      { ic: '⚛', t: 'Veins & supply', b: ['⚛ Antimatter: Cruisers, Dreadnoughts. ◆ Crystals: Shields, Gates.', 'An <b>Extractor</b> on a connected vein gives access.', '<b>Cut off</b> from your capital: half yield, veins dark.', 'Out of supply, fleets stop repairing and wear down.'] },
    ];
    case 'live': return [
      { ic: '⏱', t: 'Real time', b: [`No turns to seal: a tick every ${R.live.tickMinutes} minutes.`, `Earn an order every ${R.live.orderEveryHours}h; bank up to ${R.live.bankCap}.`, 'A full bank wastes new orders: spend them.'] },
      { ic: '➤', t: 'Orders', b: ['Orders act at the <b>next tick</b>; take back before it.', 'Moves go any distance; fleets travel in real time.', `Every ${R.live.ticksPerCycle} ticks a <b>cycle</b> ends: income and scoring.`] },
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
  const keys = c.tab === 'win' ? `<section class="hc keys"><h3><span>⌨</span>Keys</h3><div class="kgrid"><kbd>E</kbd><span>Empire</span><kbd>Q</kbd><span>Score</span><kbd>C</kbd><span>Chronicle</span><kbd>?</kbd><span>Help</span><kbd>Esc</kbd><span>Close</span><kbd>1–5</kbd><span>Tabs</span></div></section>` : '';
  const restart = c.g.you !== null && (c.g.restartTips || c.g.restartTour) ? `<button class="mbtn m-ghost" data-a="tips">↻ Restart tips</button>` : '';
  return `<div class="m-help"><div class="hgrid">${cs.map(x => `<section class="hc"><h3><span>${x.ic}</span>${x.t}</h3><ul>${x.b.map(b => `<li>${b}</li>`).join('')}</ul></section>`).join('')}${keys}</div>${restart ? `<div class="help-foot">${restart}</div>` : ''}</div>`;
}

export function helpAct(c: Ctx, a: string): boolean {
  if (a !== 'tips') return false;
  c.close();
  if (c.g.restartTips) c.g.restartTips(); else c.g.restartTour?.();
  return true;
}

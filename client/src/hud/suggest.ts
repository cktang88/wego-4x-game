// The world card's one suggested action (docs/WORLD-CARD.md §2, §8.2 primaryAction): what the expert planner would
// do at this world this turn, for your own seat. It is computed once per view (turn, LIVE tick) in idle time, off the
// main path, and only ever *shown*: a gold "Suggested" edge on PC, the big button in the phone's peek. Nothing is
// queued until you tap it. No suggestion is ever made for a secret bet (Levies, Scorch, postures): a bet the AI
// picks for you is no longer a read of your friend.
import type { GameScreen } from '../game.ts';
import type { Order } from '../../../shared/sim/types.ts';
import { planTurn } from '../../../shared/sim/ai.ts';

let key = '';
let orders: Order[] = [];
let pending: number | null = null;

const viewKey = (g: GameScreen) => `${g.gameKey()}|${g.you}|${g.st.turn}|${g.st.live?.tick ?? ''}|${g.st.players[g.you ?? 0]?.techs?.length ?? 0}`;

/** Ask for this view's plan (idle time); the card re-renders when it lands. Cheap to call on every render. */
export function warmSuggestions(g: GameScreen) {
  if (g.you === null || !g.canPlan) return;
  const k = viewKey(g);
  if (k === key || pending !== null) return;
  const run = () => {
    pending = null;
    if (g.destroyed || g.you === null) return;
    const k2 = viewKey(g);
    if (k2 === key) return;
    try { orders = planTurn(g.st, g.you, 'expert').orders.filter((o): o is Order => !!o); } catch { orders = []; }
    key = k2;
    if (g.sel?.kind === 'region') g.renderAll();
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  pending = ric ? ric(run, { timeout: 1200 }) : window.setTimeout(run, 60);
}

const same = (a: Order, b: Order) => JSON.stringify(a) === JSON.stringify(b);
const myOrders = (g: GameScreen): Order[] => (g.live ? g.queue : g.plan.orders).filter((o): o is Order => !!o);

/** The planner's next build / develop order at region `rid` that you haven't queued yet and that is still legal now. */
export function suggestAt(g: GameScreen, rid: number): Order | null {
  if (g.you === null || !g.canPlan || key !== viewKey(g)) return null;
  const mine = myOrders(g);
  for (const o of orders) {
    if (o.type !== 'build' && o.type !== 'develop') continue;
    if (o.region !== rid) continue;
    // already queued: a build of the same class here, or the same project
    if (mine.some(m => m.type === o.type && m.region === rid && (o.type === 'build' ? m.type === 'build' && m.cls === o.cls : same(m, o)))) continue;
    // a build's fleet is the card's Into choice, so only the plan lock matters here; a project must still validate
    if (o.type === 'build' ? g.orderBlock() : g.orderWhy(o)) continue;
    return o;
  }
  return null;
}

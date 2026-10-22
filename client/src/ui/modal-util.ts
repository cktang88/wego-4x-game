// Shared plumbing for the full-screen modals (modals.ts): the slice of GameScreen they use,
// per-modal UI memory, and plan helpers (pending free actions, planned spend) computed from
// shared/ so the modals don't depend on GameScreen internals.
import type { GameSource } from '../net.ts';
import type { FreeAction, GameState, Order, Player, Submission, TurnResult } from '../../../shared/sim/types.ts';
import type { Res } from '../../../shared/config/rules.ts';
import { techCost } from '../../../shared/sim/empire.ts';
import { orderCost, canAfford } from '../../../shared/sim/orders.ts';
import { creditRate } from '../../../shared/sim/resolve.ts';

export type ModalName = 'empire' | 'score' | 'chronicle' | 'help';

/**
 * What the modals need from GameScreen. Required members are the public API the shell promised;
 * optional ones are used when present (older/newer shells may lack them).
 */
export interface Host {
  readonly st: GameState;
  readonly you: number | null;
  readonly live: boolean;
  readonly canPlan: boolean;
  plan: Submission;
  src: GameSource;
  pushFree(fa: FreeAction): void;
  addOrder(o: Order): void;
  pname(p: number | null | undefined): string;
  color(p: number | null | undefined): string;
  renderAll(): void;
  openBattle?(id: number): void;
  replayTurn?(turn: number, tick?: number): unknown;
  savePlan?(): void;
  select?(s: { kind: 'region' | 'fleet'; id: number }): void;
  focus?(p: { x: number; y: number }): void;
  restartTips?(): void;
  restartTour?(): void;
  openHerald?(turn?: number): void;
  openSaga?(): void;
  orderWhy?(o: Order): string | null;
  readonly submitted?: boolean;
}

/** UI memory that survives re-renders and re-opening (per page load). */
export const ui = {
  empPid: null as number | null,            // spectators: whose empire
  tech: null as string | null,              // expanded research node
  chatOpen: false,
  chatDraft: '',
  chatTo: '',
  chatSeen: 0,
  pactWords: {} as Record<number, string>,  // sworn words drafted for a pact offer, per partner
  chatEnter: false,                         // play the drawer's slide-in once
  chronFilter: 'all' as 'all' | 'battles' | 'mine',
  chronOpen: new Set<string>(),              // expanded chronicle entries
  tabs: { empire: 'research', help: 'win', score: '', chronicle: '' } as Record<ModalName, string>,
  prevTech: new Map<string, string>(),       // node state at the last render (purchase flash)
  prevLaw: new Map<number, string | null>(), // active side per pair at the last render (toggle slide)
  hist: new Map<number, TurnResult | null | 'loading'>(),
  histKey: '',
};

/**
 * The drafts in `ui` (chat, sworn pact words, which research node is open, whose empire a spectator reads) belong to
 * one seat of one game: in hotseat the next player must not find the last player's half-typed pact words for them
 * (a curtain leak), and a new game must not inherit the old one's. Call with the seat's key before rendering.
 */
let uiOwner = '';
export function uiFor(key: string) {
  if (key === uiOwner) return;
  const first = !uiOwner;
  uiOwner = key;
  if (first) return;
  ui.chatDraft = ''; ui.chatTo = ''; ui.pactWords = {}; ui.tech = null; ui.empPid = null; ui.chatOpen = false; ui.chatSeen = 0;
  ui.chronOpen.clear(); ui.prevTech.clear(); ui.prevLaw.clear();
}

export interface Ctx {
  g: Host;
  name: ModalName;
  tab: string;
  rerender(): void;
  close(): void;
  /** After a game action: let the shell update (HUD, strip), then re-render the modal. */
  acted(): void;
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const per = (g: Host) => (g.live ? 'cycle' : 'turn');

/** "⚙40 ¢20" with each part optionally marked short. */
export function costHtml(c: Partial<Res>, short?: Partial<Record<keyof Res, boolean>>): string {
  const parts: string[] = [];
  const ic: Record<keyof Res, string> = { industry: '⚙', credits: '¢', influence: '✦' };
  for (const k of ['industry', 'credits', 'influence'] as (keyof Res)[]) {
    const v = c[k];
    if (v) parts.push(`<span class="${short?.[k] ? 'neg' : ''}">${ic[k]}${v}</span>`);
  }
  return parts.join(' ') || '<span>free</span>';
}

// ------------------------------------------------------------------ the player's plan
export function freeList(g: Host): FreeAction[] {
  if (g.you === null) return [];
  return g.live ? g.st.live?.free[g.you] ?? [] : g.plan.free;
}
export function orderList(g: Host): (Order | null)[] {
  if (g.you === null) return [];
  return g.live ? g.st.live?.queue[g.you] ?? [] : g.plan.orders;
}
export function pendingResearch(g: Host): string | null {
  const fa = freeList(g).find(x => x.type === 'research');
  return fa && fa.type === 'research' ? fa.tech : null;
}
export const pendingRevoke = (g: Host, law: string) => freeList(g).some(x => x.type === 'revoke' && x.law === law);
export function pendingBlueprint(g: Host, cls: string): string | null {
  const fa = [...freeList(g)].reverse().find(x => x.type === 'blueprint' && x.cls === cls);
  return fa && fa.type === 'blueprint' ? fa.mod : null;
}
/** Slot (WEGO) or queue index (LIVE) of an order matching `pred`, or null. */
export function pendingOrder(g: Host, pred: (o: Order) => boolean): number | null {
  const i = orderList(g).findIndex(o => !!o && pred(o));
  return i >= 0 ? i : null;
}
/** Players with your pending free actions applied (they happen before pulse I). */
export function pendingPlayers(g: Host): Player[] {
  const you = g.you;
  const free = freeList(g);
  if (you === null || !free.some(x => x.type === 'research' || x.type === 'revoke' || x.type === 'blueprint')) return g.st.players;
  return g.st.players.map(p => {
    if (p.id !== you) return p;
    const q: Player = { ...p, techs: [...(p.techs ?? [])], laws: [...(p.laws ?? [])], blueprint: { ...(p.blueprint ?? {}) } };
    for (const fa of free) {
      if (fa.type === 'research' && !q.techs!.includes(fa.tech)) q.techs!.push(fa.tech);
      if (fa.type === 'revoke') q.laws = q.laws!.filter(x => x !== fa.law);
      if (fa.type === 'blueprint') q.blueprint![fa.cls] = fa.mod;
    }
    return q;
  });
}
export function costState(g: Host): GameState {
  const players = pendingPlayers(g);
  return players === g.st.players ? g.st : { ...g.st, players };
}
/** Resources your WEGO plan already spends (research first, then orders priced after free actions). */
export function plannedSpend(g: Host, ignoreResearch = false): Res {
  const tot: Res = { industry: 0, credits: 0, influence: 0 };
  if (g.you === null || g.live) return tot;
  const pr = pendingResearch(g);
  if (pr && !ignoreResearch) { const c = techCost(g.st, g.you, pr); tot.industry += c.industry ?? 0; tot.credits += c.credits ?? 0; }
  const cs = costState(g);
  const uses = new Map<number, number>();
  for (const o of g.plan.orders) {
    if (!o) continue;
    const c = orderCost(cs, o, g.you);
    tot.industry += c.industry ?? 0; tot.credits += c.credits ?? 0; tot.influence += c.influence ?? 0;
    const fl = 'fleet' in o && o.type !== 'build' ? [o.fleet, ...(o.type === 'seize' ? o.also ?? [] : [])] : [];
    for (const id of fl) { const u = uses.get(id) ?? 0; if (u > 0) tot.credits += g.st.rules.orders.repeatFleetCredits; uses.set(id, u + 1); }
  }
  return tot;
}
/** What is left to spend after your plan. */
export function leftover(g: Host, pid: number, ignoreResearch = false): Res {
  const res = g.st.players[pid]?.res ?? { industry: 0, credits: 0, influence: 0 };
  if (g.you !== pid) return { ...res };
  const sp = plannedSpend(g, ignoreResearch);
  return { industry: res.industry - sp.industry, credits: res.credits - sp.credits, influence: res.influence - sp.influence };
}
export function affordable(g: Host, pid: number, have: Res, cost: Partial<Res>): boolean {
  return canAfford(have, cost, creditRate(g.st, pid));
}
/** Which parts of a cost you are short of (credits cover missing industry at the credit rate). */
export function shortOf(g: Host, pid: number, have: Res, cost: Partial<Res>): Partial<Record<keyof Res, boolean>> {
  if (affordable(g, pid, have, cost)) return {};
  return { industry: (cost.industry ?? 0) > have.industry, credits: (cost.credits ?? 0) > have.credits || (cost.industry ?? 0) > have.industry, influence: (cost.influence ?? 0) > have.influence };
}

/** Remove free actions matching `pred` from the WEGO plan. */
export function dropFree(g: Host, pred: (fa: FreeAction) => boolean) {
  if (g.live) return;
  g.plan.free = g.plan.free.filter(x => !pred(x));
  g.savePlan?.();
}
/** Remove a queued order (WEGO slot / LIVE queue index). */
export function dropOrder(g: Host, i: number) {
  if (g.live) { g.src.liveCancel?.(i); return; }
  g.plan.orders[i] = null;
  g.savePlan?.();
}
/** Why the player can't plan right now ("" if they can). */
export function lockWhy(g: Host): string {
  if (g.you === null) return 'Spectating';
  if (g.st.winner !== null) return 'Game over';
  if (g.st.players[g.you]?.eliminated) return 'Eliminated';
  if (!g.canPlan) return 'Orders sealed';
  return '';
}

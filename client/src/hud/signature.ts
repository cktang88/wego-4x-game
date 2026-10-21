// Signature mechanics on the HUD (docs/SIGNATURE.md): fleet postures (a secret bet each turn), world postures on
// your systems, and Fate tokens. Pit of success: invalid choices are disabled with the reason, the default (Steady)
// costs nothing, Fate asks once more before it is spent, and a Seize dropped by drag offers a Charge on the spot.
// Postures are introduced from turn 3 (progressive disclosure); Fate shows when it matters.
import type { GameScreen } from '../game.ts';
import type { FateUse, Fleet, FreeAction, Order, Posture, Region, WorldPosture } from '../../../shared/sim/types.ts';
import { POSTURES, WORLD_POSTURES, FATE_USES } from '../../../shared/config/content.ts';
import { sigOn, posturesOn, worldPosturesOn, fateOn, postureBlock, wpostureBlock, fateBlock, fateLeft, regionIdle, isDugIn, isExposed, fateOf, POSTURE_IDS, WORLD_POSTURE_IDS, SG } from '../../../shared/sim/signature.ts';
import { esc, toast } from '../ui/dom.ts';
import { tip, shortWhy } from './util.ts';
import { setFree, dropFree } from './soul.ts';

/** Turn from which the posture selector appears (progressive disclosure: learn to move first). */
export const POSTURE_FROM_TURN = 3;
const T = (s: string) => `${s}︎`;

// ------------------------------------------------------------------ what's planned
const myOrders = (g: GameScreen): (Order | null)[] => (g.live ? g.queue : g.plan.orders);
export function pendingPosture(g: GameScreen, fid: number): Posture | null {
  const fa = [...g.myFree()].reverse().find(x => x.type === 'posture' && x.fleet === fid);
  return fa && fa.type === 'posture' ? fa.posture : null;
}
/** The posture a fleet of yours will take this turn: the planned one, else the one in force, else Steady. */
export function postureNow(g: GameScreen, f: Fleet): Posture {
  return pendingPosture(g, f.id) ?? f.posture ?? 'steady';
}
export function pendingWPosture(g: GameScreen, rid: number): WorldPosture | null {
  const fa = [...g.myFree()].reverse().find(x => x.type === 'wposture' && x.region === rid);
  return fa && fa.type === 'wposture' ? fa.posture : null;
}
export function pendingFate(g: GameScreen): Extract<FreeAction, { type: 'fate' }>[] {
  return g.myFree().filter((x): x is Extract<FreeAction, { type: 'fate' }> => x.type === 'fate');
}
/** Fate tokens left after what your plan already spends. */
export function fateAvail(g: GameScreen): number {
  if (g.you === null || !fateOn(g.st)) return 0;
  return fateLeft(g.st, g.you) - (g.live ? 0 : pendingFate(g).length);
}
const seizesThisTurn = (g: GameScreen, f: Fleet) =>
  myOrders(g).some(o => !!o && o.type === 'seize' && (o.fleet === f.id || (o.also ?? []).includes(f.id))) || (!!f.route && f.route.seize !== null) || (f.siege !== null && f.siege !== undefined && f.siege === f.region);
const movesThisTurn = (g: GameScreen, f: Fleet) => myOrders(g).some(o => !!o && o.type === 'move' && o.fleet === f.id) || !!f.route?.path.length;

/** Why this fleet can't take posture `p` (the rules, plus what your orders imply), or null. */
export function postureWhy(g: GameScreen, f: Fleet, p: Posture): string | null {
  if (g.you === null) return 'spectating';
  if (!g.canPlan) return g.planBlock() ?? 'not now';
  const b = postureBlock(g.st, g.you, f, p);
  if (b) return b;
  if (p === 'charge' && !seizesThisTurn(g, f)) return 'a Charge needs a Seize';
  if (p === 'ambush' && (seizesThisTurn(g, f) || movesThisTurn(g, f))) return 'an Ambush must lie still';
  if (p === 'guarded' && seizesThisTurn(g, f)) return 'a Guarded fleet cannot seize';
  return null;
}
/** Why `use` can't be spent on this fleet / region now, or null (counts Fate already in the plan). */
export function fateWhy(g: GameScreen, use: FateUse, fleet?: number, region?: number): string | null {
  if (g.you === null) return 'spectating';
  if (!g.canPlan) return g.planBlock() ?? 'not now';
  const b = fateBlock(g.st, g.you, use, fleet, region);
  if (b) return b;
  if (!g.live && pendingFate(g).length >= SG(g.st).fatePerTurn) return `${SG(g.st).fatePerTurn} Fate per turn`;
  if (fateAvail(g) <= 0) return 'no Fate left';
  return null;
}

// ------------------------------------------------------------------ fleet card: the posture selector
const betLines = (d: { bet: string; right: string; wrong: string; name?: string }) => d.name === 'Steady'
  ? `<span class="bt"><i>◎</i>no bet: nothing gained, nothing risked. The right call most turns.</span>`
  : `<span class="bt"><i>◎</i>${esc(d.bet)}</span><span class="ok"><i>✓</i>${esc(d.right)}</span><span class="no"><i>✗</i>${esc(d.wrong)}</span>`;

export function postureRow(g: GameScreen, f: Fleet): string {
  const st = g.st;
  if (!posturesOn(st) || f.owner !== g.you || !g.canPlan) return '';
  const cur = postureNow(g, f);
  if (st.turn < POSTURE_FROM_TURN && cur === 'steady') return '';
  const locked = !!f.postureFx?.set && f.postureFx.turn === st.turn && !pendingPosture(g, f.id);
  const chips = POSTURE_IDS.map(p => {
    const d = POSTURES[p];
    const why = p === cur ? null : locked ? 'it already took a posture this turn' : postureWhy(g, f, p);
    return `<button class="pzc ${p === cur ? 'on' : ''} pz-${p}" data-a="posture" data-p="${p}"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip(d.bet)}><i>${T(d.icon)}</i><span>${esc(d.name)}</span></button>`;
  }).join('');
  const bets = POSTURE_IDS.map(p => {
    const why = p === cur ? null : postureWhy(g, f, p);
    return `<div class="pzb ${p === cur ? 'cur' : ''}" data-p="${p}">${why ? `<span class="why">⊘ ${esc(why)}</span>` : betLines(POSTURES[p])}</div>`;
  }).join('');
  return `<div class="posture" data-posture-row><div class="pz-h"><b>${T('⛉')} Posture</b><small>secret · this turn</small></div><div class="pz">${chips}</div><div class="pzbs">${bets}</div></div>`;
}

/** Status chips for a fleet's posture state (dug in, exposed, Fate in force), any owner. */
export function postureStatus(g: GameScreen, f: Fleet): string[] {
  const st = g.st, out: string[] = [];
  if (!sigOn(st)) return out;
  if (isDugIn(st, f)) out.push(`<span class="warn"${tip('Guarded, nobody came: cannot move this turn')}>⛓ Dug in</span>`);
  if (isExposed(st, f)) out.push(`<span class="warn"${tip('Ambush, nobody came: seen by all, weaker')}>◉ Exposed</span>`);
  const fu = fateOf(st, f);
  if (fu) out.push(`<span class="fatechip"${tip(FATE_USES[fu]?.desc.split('.')[0] ?? '')}>✪ ${esc(FATE_USES[fu]?.name ?? fu)}</span>`);
  if (f.owner !== g.you && f.posture && f.posture !== 'steady') out.push(`<span class="war"${tip('Seen by your scouts or a scan')}>${T(POSTURES[f.posture]?.icon ?? '◇')} ${esc(POSTURES[f.posture]?.name ?? f.posture)}</span>`);
  return out;
}

// ------------------------------------------------------------------ Fate (fleet and world)
let armed: { key: string; at: number } | null = null;
const coins = (n: number, max: number) => `<span class="coins">${Array.from({ length: Math.max(max, n) }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
function fateBtn(g: GameScreen, use: FateUse, why: string | null, target: string): string {
  const d = FATE_USES[use];
  const key = `${use}:${target}`;
  const hot = armed && armed.key === key && performance.now() - armed.at < 4000;
  const label = use === 'laststand' ? 'Stand' : use === 'hyperjump' ? 'Jump' : use === 'twist' ? 'Twist' : use === 'rally' ? 'Rally' : 'Surge';
  return `<button class="fz ${hot ? 'armed' : ''}" data-a="fate" data-use="${use}" data-key="${esc(key)}"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip(`${d.name}: ${d.desc.split('.')[0]}`)}><i>${T(d.icon)}</i><span>${hot ? 'Spend?' : label}</span></button>`;
}
export function fateRow(g: GameScreen, f: Fleet): string {
  const st = g.st;
  if (!fateOn(st) || f.owner !== g.you || !g.canPlan) return '';
  const pend = pendingFate(g).find(x => x.fleet === f.id);
  const left = fateAvail(g);
  const engaged = (st.engagements ?? []).some(e => e.region === f.region);
  if (!pend && st.turn < POSTURE_FROM_TURN && !engaged && !f.limping) return '';
  if (pend) return `<div class="fate-row pend"><b>✪ ${esc(FATE_USES[pend.use]?.name ?? pend.use)}</b><small>spent at seal</small>${g.live ? '' : '<button class="mini" data-a="unfate">↶</button>'}</div>`;
  const uses: FateUse[] = f.limping ? ['rally', 'laststand', 'twist', 'hyperjump'] : ['laststand', 'twist', 'hyperjump'];
  return `<div class="fate-row"><span class="fz-h"${tip('Fate: rare tokens, spent in public')}>Fate ${coins(left, SG(st).fateStart)}</span>${uses.map(u => fateBtn(g, u, fateWhy(g, u, f.id), `f${f.id}`)).join('')}</div>`;
}

// ------------------------------------------------------------------ world card: world postures + Surge
export function worldSigRows(g: GameScreen, r: Region): string {
  const st = g.st;
  if (!sigOn(st) || r.owner !== g.you || g.you === null || r.kind === 'void' || (r.kind as string) === 'lane') return '';
  let html = '';
  const status: string[] = [];
  if (regionIdle(st, r)) status.push(`<span class="warn"${tip('Levies called in vain: no output')}>⚑ Idle to T${r.idleUntil}</span>`);
  if (r.surge === st.turn) status.push('<span class="gold">⚡ Surging ×2</span>');
  if (status.length) html += `<div class="cst">${status.join('')}</div>`;
  if (worldPosturesOn(st) && g.canPlan && (st.turn >= POSTURE_FROM_TURN || pendingWPosture(g, r.id))) {
    const cur = pendingWPosture(g, r.id) ?? (r.wposture && r.wposture.turn === st.turn ? r.wposture.kind : null);
    const chips = WORLD_POSTURE_IDS.map(p => {
      const d = WORLD_POSTURES[p];
      const why = p === cur ? null : cur && !pendingWPosture(g, r.id) ? 'already set this turn' : wpostureBlock(st, g.you!, r.id, p);
      return `<button class="pzc ${p === cur ? 'on' : ''}" data-a="wposture" data-p="${p}"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip(d.bet)}><i>${T(d.icon === '🔥' ? '♨' : d.icon)}</i><span>${esc(d.name.split(' ').slice(-1)[0])}</span></button>`;
    }).join('') + `<button class="pzc ${cur ? '' : 'on'}" data-a="wposture" data-p=""${cur && !pendingWPosture(g, r.id) ? ' aria-disabled="true"' : tip('No bet this turn')}><i>◇</i><span>None</span></button>`;
    const bets = WORLD_POSTURE_IDS.map(p => `<div class="pzb ${p === cur ? 'cur' : ''}" data-p="${p}">${betLines(WORLD_POSTURES[p])}</div>`).join('') + `<div class="pzb ${cur ? '' : 'cur'}" data-p=""><span class="bt"><i>◎</i>no bet: nothing gained, nothing risked</span></div>`;
    html += `<div class="posture world" data-wposture-row><div class="pz-h"><b>${T('⚑')} Stance</b><small>secret · this turn</small></div><div class="pz">${chips}</div><div class="pzbs">${bets}</div></div>`;
  }
  if (fateOn(st) && g.canPlan && st.turn >= POSTURE_FROM_TURN - 1) {
    const pend = pendingFate(g).find(x => x.use === 'surge' && x.region === r.id);
    html += pend ? `<div class="fate-row pend"><b>✪ Surge</b><small>spent at seal</small>${g.live ? '' : '<button class="mini" data-a="unfate">↶</button>'}</div>`
      : `<div class="fate-row"><span class="fz-h">Fate ${coins(fateAvail(g), SG(st).fateStart)}</span>${fateBtn(g, 'surge', fateWhy(g, 'surge', undefined, r.id), `r${r.id}`)}</div>`;
  }
  return html;
}

// ------------------------------------------------------------------ actions
export function sigAction(g: GameScreen, a: string, data: DOMStringMap): boolean {
  const sel = g.sel;
  if (!sel || !g.canPlan) return false;
  if (a === 'posture' && sel.kind === 'fleet') {
    const f = g.fleet(sel.id);
    const p = data.p as Posture;
    if (!f) return true;
    if (p === 'steady' && !f.posture) dropFree(g, x => x.type === 'posture' && x.fleet === f.id);
    else setFree(g, { type: 'posture', fleet: f.id, posture: p }, x => x.type === 'posture' && x.fleet === f.id);
    return true;
  }
  if (a === 'wposture' && sel.kind === 'region') {
    const p = data.p as WorldPosture | '';
    if (!p) dropFree(g, x => x.type === 'wposture' && x.region === sel.id);
    else setFree(g, { type: 'wposture', region: sel.id, posture: p }, x => x.type === 'wposture' && x.region === sel.id);
    return true;
  }
  if (a === 'unfate') {
    dropFree(g, x => x.type === 'fate' && (sel.kind === 'fleet' ? x.fleet === sel.id : x.region === sel.id));
    return true;
  }
  if (a === 'fate') {
    const use = data.use as FateUse, key = data.key ?? '';
    // scarce: the first tap arms the button ("Spend?"), the second spends
    if (!armed || armed.key !== key || performance.now() - armed.at > 4000) { armed = { key, at: performance.now() }; g.renderAll(); g.later(() => { if (armed?.key === key) { armed = null; g.renderAll(); } }, 4100); return true; }
    armed = null;
    const fa: FreeAction = use === 'surge' ? { type: 'fate', use, region: sel.id } : { type: 'fate', use, fleet: sel.id };
    setFree(g, fa, x => x.type === 'fate' && (use === 'surge' ? x.region === sel.id : x.fleet === sel.id));
    fateFlourish(g, use);
    return true;
  }
  return false;
}

/** The public reveal: a coin flips off the HUD pips, a banner names the Fate. */
export function fateFlourish(g: GameScreen, use: FateUse | 'bonus') {
  const pill = g.hud.h.res.querySelector<HTMLElement>('[data-k=fate]');
  if (pill) { pill.classList.remove('flip'); void pill.offsetWidth; pill.classList.add('flip'); }
  g.banner(use === 'bonus' ? '✪ FORTUNE' : `✪ ${(FATE_USES[use]?.name ?? use).toUpperCase()}`);
  toast(use === 'bonus' ? '✪ A Fate token, for the fallen' : `✪ ${FATE_USES[use]?.name ?? use}: spent when the turn resolves`);
}

// ------------------------------------------------------------------ drag-to-order: offer a Charge after a Seize
let offerEl: HTMLElement | null = null;
export function offerCharge(g: GameScreen, fleet: number, region: number) {
  const f = g.fleet(fleet);
  if (!f || !posturesOn(g.st) || g.st.turn < POSTURE_FROM_TURN || postureNow(g, f) !== 'steady' || postureWhy(g, f, 'charge')) return;
  offerEl?.remove();
  const el = document.createElement('button');
  el.className = 'chargeoffer';
  el.innerHTML = `<i>${T(POSTURES.charge.icon)}</i><b>Charge?</b><small>${esc(POSTURES.charge.bet)}</small>`;
  const p = g.map.toScreen(g.st.regions[region].site);
  el.style.transform = `translate(${Math.round(Math.max(8, Math.min(g.map.w - 220, p.x + 22)))}px, ${Math.round(Math.max(60, p.y - 70))}px)`;
  g.hud.h.res.parentElement!.appendChild(el);
  offerEl = el;
  el.addEventListener('click', () => {
    setFree(g, { type: 'posture', fleet, posture: 'charge' }, x => x.type === 'posture' && x.fleet === fleet);
    toast(`${POSTURES.charge.icon} ${f.name}: Charge`);
    el.remove();
  });
  g.later(() => { el.classList.add('out'); g.later(() => el.remove(), 250); }, 4500);
}

// ------------------------------------------------------------------ map: what each token shows
/** Fleet id → posture to draw (yours: planned or in force; rivals': only what your view reveals). */
export function postureMap(g: GameScreen): Map<number, string> {
  const out = new Map<number, string>();
  if (!posturesOn(g.st)) return out;
  for (const f of g.st.fleets) {
    const p = f.owner === g.you ? postureNow(g, f) : f.posture;
    if (p && p !== 'steady') out.set(f.id, p);
  }
  return out;
}

// ------------------------------------------------------------------ HUD: Fate coins
export function fatePill(g: GameScreen): string {
  if (g.you === null || !fateOn(g.st)) return '';
  const n = fateAvail(g), max = SG(g.st).fateStart;
  return `<button class="respill fatepill" data-k="fate" aria-label="Fate ${n}"${tip(`Fate: ${n} left · spend from a fleet or world`)}>${coins(n, max)}</button>`;
}
export function fatePop(g: GameScreen): string {
  const n = fateAvail(g);
  return `<div class="bd"><div class="h">✪ Fate ${n}</div>${(['laststand', 'twist', 'hyperjump', 'rally', 'surge'] as FateUse[]).map(u => `<div class="r"><span>${T(FATE_USES[u].icon)} ${esc(FATE_USES[u].name)}</span><b>${FATE_USES[u].target === 'region' ? 'world' : 'fleet'}</b></div>`).join('')}<div class="r"><span>Per turn</span><b>${SG(g.st).fatePerTurn}</b></div></div>`;
}

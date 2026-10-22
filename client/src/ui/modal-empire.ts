// Empire modal: Research (tech tree), Laws (four two-sided toggles), Ships (class cards + module
// picker). Design: docs/UX-V2.md §5, docs/EMPIRE.md. Icons + numbers; a sentence never.
import { BRANCHES, TECHS, TECH, LAWS, LAW, LAW_PAIRS, MODULES, MODULE, VEINS, type Branch, type TechDef } from '../../../shared/config/empire.ts';
import { techCost, researchBlock, lawSlots, lawCost, opposite, starOwner, connected, hasVein, blueprintFor, classBlock, shipStats, baseHp, shipCostMod, lawBlock } from '../../../shared/sim/empire.ts';
import type { Ship } from '../../../shared/sim/types.ts';
import { type Ctx, type Host, ui, esc, ROMAN, per, costHtml, pendingResearch, pendingRevoke, pendingBlueprint, pendingOrder, leftover, affordable, shortOf, dropFree, dropOrder, lockWhy, costState, pendingPlayers } from './modal-util.ts';
import { ic as icn, icFor } from '../art/icons.ts';
import { miniUrl, paintMinis } from './ship-plinth.ts';

const BRANCH_IDS = Object.keys(BRANCHES) as Branch[];
const TIER = ['', 'I', 'II', 'III', '★'];

/** One line per technology, ≤ 8 words. The full text lives in Help / the title attribute. */
const TECH_FX: Record<string, string> = {
  railguns: 'Module: +1 ⚔',
  cruisers: 'Build Cruisers',
  siege: '+3 siege damage · Bombards −25% ⚙',
  alpha: 'First round: +50% shots',
  sunhammer: 'All ships +1 ⚔',
  deflectors: 'Module: +2 shields',
  batteries: 'Garrison +2 shots, +2 damage',
  pshield: 'Garrison takes −3 per hit',
  regen: 'Repair +3 anywhere in supply',
  citadel: 'Garrisons +50% · Crowns +1 ♛',
  ion: 'Module: +1 ➤, harder to hit',
  depots: 'Upkeep −40% · Depot hubs',
  gates: 'Gates link fleets and supply',
  scanners: '+1 sensor range · +6% hit',
  jump: 'All fleets +1 ➤',
  trade: 'Hubs +3¢ · pacts pay 4¢',
  bureaucracy: '+1 law slot · +2 ✦',
  subversion: 'Influence −40% cost, +50% push',
  markets: '+15% ¢ · ¢ cover ⚙ 1:1',
  mandate: '+1 ♛ every turn',
};
/** What a technology unlocks, as chips: [icon, label]. */
const TECH_UNLOCK: Record<string, [string, string][]> = {
  railguns: [['railgun', 'Railgun']], deflectors: [['shield', 'Deflector']], ion: [['thruster', 'Ion Drive']],
  cruisers: [['ship:cruiser', 'Cruiser'], ['antimatter', 'needs']],
  siege: [['ship:dread', 'Dreadnought']], alpha: [['ship:dread', 'Dreadnought']],
  batteries: [['battery', 'Battery']], pshield: [['pshield', 'Shield'], ['crystal', 'needs']],
  depots: [['depot', 'Depot']], gates: [['gate', 'Warp Gate'], ['crystal', 'needs']],
  bureaucracy: [['law', '+1 slot']],
};
const LAW_FX: Record<string, string> = {
  bastion: 'Garrisons +30% · rebuild +3',
  vanguard: '+8% hit attacking · no fatigue',
  mercantile: '+20% ¢ · Hubs +2¢',
  industrial: '+20% ⚙ · ships −10% ⚙ · −10% ¢',
  central: 'Capital yields +50%',
  federal: 'Develop −35% · colonies +1 ⚙',
  martial: 'Immune to Influence · −1 ✦',
  open: '+3 ✦ · Scan, Feint, Conceal free',
};
const MOD_SHORT: Record<string, string> = { armor: 'Armor', railgun: 'Railgun', deflector: 'Deflector', ion: 'Ion' };

// ====================================================================== ship minis
/** A painted miniature as an <img> (unlock chips): the class in the viewer's house colours. */
function miniImg(cls: string, owner: number, color: string, w: number, h: number, cls2 = ''): string {
  return `<img class="mini-img ${cls2}" src="${miniUrl(cls, owner, color, w, h)}" width="${w}" height="${h}" alt="" draggable="false">`;
}
const unlockChip = (owner: number, color: string) => ([ic, label]: [string, string]) => ic.startsWith('ship:')
  ? `<span class="chipx">${miniImg(ic.slice(5), owner, color, 44, 26)}<b>${esc(label)}</b></span>`
  : label === 'needs' ? `<span class="chipx need" title="Needs ${ic === 'antimatter' ? 'Antimatter' : 'Crystals'}"><i style="color:${ic === 'antimatter' ? VEINS.antimatter.color : VEINS.crystal.color}">${icn(ic)}</i><b>needed</b></span>`
  : `<span class="chipx"><i>${icn(ic)}</i><b>${esc(label)}</b></span>`;

// ====================================================================== who / header
export function empirePid(g: Host): number {
  if (g.you !== null) return g.you;
  const n = g.st.players.length;
  return ui.empPid !== null && ui.empPid >= 0 && ui.empPid < n ? ui.empPid : 0;
}

/** Header extras: spectator player picker + one compact resource line. */
export function empireHead(c: Ctx): string {
  const g = c.g, st = g.st, pid = empirePid(g);
  const pick = g.you === null ? `<div class="mh-pick">${st.players.map(p => `<button class="crest-b ${p.id === pid ? 'on' : ''}" data-a="emp-pid" data-id="${p.id}" style="--pc:${esc(p.color)}">${esc(p.name)}</button>`).join('')}</div>` : '';
  if (st.rules.empire?.enabled === false) return pick;
  const conn = connected(st, pid);
  const cut = st.regions.filter(r => r.owner === pid && !conn.has(r.id)).length;
  const left = g.you === pid ? leftover(g, pid) : null;
  const veins = Object.entries(VEINS).map(([v, V]) => {
    const ok = hasVein(st, pid, v, conn);
    return `<span class="rs ${ok ? 'ok' : 'no'}" title="${V.name}: ${ok ? 'access' : 'no access'}"><i style="color:${V.color}">${V.icon}</i>${ok ? '✓' : '✗'}</span>`;
  }).join('');
  const res = left ? `<span class="rs" title="Industry after your plan">⚙<b>${Math.max(0, left.industry)}</b></span><span class="rs" title="Credits after your plan">¢<b>${Math.max(0, left.credits)}</b></span><span class="rs" title="Influence after your plan">✦<b>${Math.max(0, left.influence)}</b></span><span class="rsep"></span>` : '';
  return `${pick}<div class="mh-res">${res}${veins}${cut ? `<span class="rs neg" title="Regions cut off from the capital: half yield">✂<b>${cut}</b></span>` : ''}</div>`;
}

export const EMPIRE_TABS: [string, string, string][] = [['research', icn('research'), 'Research'], ['laws', icn('law'), 'Laws'], ['ships', icn('ships'), 'Ships']];

export function empireBody(c: Ctx): string {
  const g = c.g;
  if (g.st.rules.empire?.enabled === false) return `<div class="m-empty">Empire layer off in these rules</div>`;
  if (c.tab === 'laws') return lawsHtml(c);
  if (c.tab === 'ships') return shipsHtml(c);
  return researchHtml(c);
}

// ====================================================================== research
type TS = 'own' | 'pending' | 'avail' | 'short' | 'busy' | 'locked' | 'other' | 'rival' | 'open';
interface TInfo { s: TS; why: string; owner?: number }

function prevNeed(t: TechDef): string {
  const inB = TECHS.filter(x => x.branch === t.branch);
  if (t.tier === 4) return inB.filter(x => x.tier === 3).map(x => x.name.split(' ')[0]).join(' or ');
  return inB.find(x => x.tier === t.tier - 1)?.name ?? '';
}

function techInfo(g: Host, pid: number, t: TechDef): TInfo {
  const st = g.st;
  if (st.players[pid]?.techs?.includes(t.id)) return { s: 'own', why: 'Researched' };
  const mine = pid === g.you;
  const pend = mine ? pendingResearch(g) : null;
  if (pend === t.id) return { s: 'pending', why: g.live ? 'Next tick' : 'Queued' };
  const b = researchBlock(st, pid, t.id);
  if (b?.startsWith('you chose')) {
    const o = TECHS.find(x => x.branch === t.branch && x.tier === 3 && x.id !== t.id)!;
    return { s: 'other', why: `Chose ${o.name}` };
  }
  if (t.tier === 4) { const o = starOwner(st, t.id); if (o !== null && o !== pid) return { s: 'rival', why: `${st.players[o].name} owns it`, owner: o }; }
  if (b && !b.startsWith('one technology')) return { s: 'locked', why: `Needs ${prevNeed(t)}` };
  if (b) return { s: 'busy', why: `One per ${per(g)}` };
  if (pend && g.live) return { s: 'busy', why: `One per ${per(g)}` };
  if (!mine) return { s: 'open', why: '' };
  const cost = techCost(st, pid, t.id);
  if (!affordable(g, pid, leftover(g, pid, true), cost)) return { s: 'short', why: 'Not enough' };
  return { s: 'avail', why: '' };
}

function researchHtml(c: Ctx): string {
  const g = c.g, st = g.st, pid = empirePid(g), pl = st.players[pid];
  const editable = g.you === pid && g.canPlan;
  const left = leftover(g, pid, true);
  const flash = new Map<string, string>();
  const node = (t: TechDef | undefined, cls = '') => {
    if (!t) return '';
    const B = BRANCHES[t.branch], inf = techInfo(g, pid, t);
    const key = `${pid}.${t.id}`;
    const prev = ui.prevTech.get(key);
    flash.set(key, inf.s);
    const fx = prev && prev !== inf.s && (inf.s === 'pending' || inf.s === 'own') ? ' fx-buy' : '';
    const cost = techCost(st, pid, t.id);
    const showCost = inf.s === 'avail' || inf.s === 'short' || inf.s === 'busy' || inf.s === 'open' || inf.s === 'locked';
    const sub = inf.s === 'own' ? '<span class="ok">✓</span>' : inf.s === 'pending' ? `<span class="gold">${g.live ? 'next tick' : 'queued'}</span>`
      : inf.s === 'rival' ? `<span style="color:${esc(st.players[inf.owner!].color)}">♛ ${esc(st.players[inf.owner!].name)}</span>`
      : inf.s === 'other' ? '<span class="dim">forsaken</span>'
      : showCost ? costHtml(cost, inf.s === 'short' ? shortOf(g, pid, left, cost) : undefined) : '';
    const rivals = st.players.filter(p => p.id !== pid && p.techs?.includes(t.id) && !(inf.s === 'rival' && p.id === inf.owner));
    const dots = rivals.length ? `<span class="rn-dots">${rivals.map(p => `<i style="background:${esc(p.color)}" title="${esc(p.name)} has it"></i>`).join('')}</span>` : '';
    const rc = inf.owner !== undefined ? `;--rc:${esc(st.players[inf.owner].color)}` : '';
    return `<button class="rn s-${inf.s} t${t.tier}${ui.tech === t.id ? ' sel' : ''}${fx} ${cls}" data-a="tech" data-id="${t.id}" style="--bc:${B.color}${rc}" title="${esc(t.name)}" aria-label="${esc(`${t.name}, ${TIER[t.tier]}, ${inf.s}`)}">
      <span class="rn-disc"><span class="rn-ic">${icn(icFor('tech', t.id, t.icon))}</span><i class="rn-tier">${TIER[t.tier]}</i></span><span class="rn-nm">${esc(t.name.replace(/^The /, ''))}</span><span class="rn-sub">${sub}</span>${dots}</button>`;
  };
  const cols = BRANCH_IDS.map(b => {
    const B = BRANCHES[b];
    const ts = TECHS.filter(t => t.branch === b);
    const f = ts.filter(t => t.tier === 3);
    const owned = ts.filter(t => pl.techs?.includes(t.id)).length;
    return `<section class="rb" style="--bc:${B.color}" data-branch="${b}">
      <header class="rb-h"><span class="rb-ic">${icn(icFor('branch', b, B.icon))}</span><b>${B.name}</b><span class="rb-pips">${[0, 1, 2, 3].map(i => `<i class="${i < owned ? 'on' : ''}"></i>`).join('')}</span></header>
      <div class="rb-tree"><svg class="rb-lines" aria-hidden="true"></svg>
        <div class="rb-row">${node(ts.find(t => t.tier === 1))}</div>
        <div class="rb-row">${node(ts.find(t => t.tier === 2))}</div>
        <div class="rb-row rb-fork">${node(f[0])}<span class="rb-or">or</span>${node(f[1])}</div>
        <div class="rb-row">${node(ts.find(t => t.tier === 4))}</div>
      </div></section>`;
  }).join('');
  ui.prevTech = new Map([...ui.prevTech, ...flash]);
  // status strip: what's queued this turn
  const pend = g.you === pid ? pendingResearch(g) : null;
  let status = '';
  if (pend && TECH[pend]) status = `<span class="st-chip gold">✺ ${esc(TECH[pend].name)} · ${g.live ? 'next tick' : 'queued'}</span>${editable && !g.live ? '<button class="mbtn m-ghost sm" data-a="unresearch">↶ Undo</button>' : ''}`;
  else if (g.you === pid && (pl.researched ?? 0) > 0 && researchBlock(st, pid, 'railguns')?.startsWith('one technology')) status = `<span class="st-chip">✓ Researched this ${per(g)}</span>`;
  else if (editable) status = `<span class="st-chip">✺ 1 per ${per(g)}</span>`;
  else if (lockWhy(g)) status = `<span class="st-chip dim">${esc(lockWhy(g))}</span>`;
  return `<div class="rx"><div class="rx-status">${status}</div><div class="rx-tree" data-a="tree-bg">${cols}${techCard(c, pid, editable)}</div></div>`;
}

function techCard(c: Ctx, pid: number, editable: boolean): string {
  const g = c.g, id = ui.tech;
  const t = id ? TECH[id] : null;
  if (!t) return '';
  const st = g.st, B = BRANCHES[t.branch], inf = techInfo(g, pid, t), cost = techCost(st, pid, t.id);
  const left = leftover(g, pid, true);
  const unlock = TECH_UNLOCK[t.id] ?? [];
  let act = '';
  if (editable && inf.s === 'avail') {
    const pend = pendingResearch(g);
    act = `<button class="mbtn go" data-a="research" data-id="${t.id}" style="--bc:${B.color}">${pend ? 'Research instead' : 'Research'} <span class="cost">${costHtml(cost)}</span></button>`;
  } else if (editable && inf.s === 'pending' && !g.live) act = `<span class="m-why gold">✺ Queued</span><button class="mbtn m-ghost" data-a="unresearch">↶ Undo</button>`;
  else if (inf.s === 'short') act = `<span class="m-why neg">Need ${costHtml(cost, shortOf(g, pid, left, cost))}</span>`;
  else if (inf.s === 'own') act = `<span class="m-why ok">✓ Researched</span>`;
  else if (inf.s === 'open') act = `<span class="m-why">${costHtml(cost)}</span>`;
  else if (inf.why) act = `<span class="m-why ${inf.s === 'rival' || inf.s === 'locked' ? 'neg' : 'dim'}">${esc(inf.why)}</span>${inf.s === 'busy' || inf.s === 'locked' ? `<span class="m-why dim">${costHtml(cost)}</span>` : ''}`;
  if (g.you === pid && !g.canPlan && inf.s === 'avail') act = `<span class="m-why dim">${esc(lockWhy(g))}</span>`;
  const owners = st.players.filter(p => p.techs?.includes(t.id));
  return `<div class="tcard" data-a="noop" style="--bc:${B.color}" role="dialog" aria-label="${esc(t.name)}">
    <button class="tcard-x" data-a="tech-close" aria-label="Close">×</button>
    <div class="tcard-h"><span class="tcard-ic">${icn(icFor('tech', t.id, t.icon))}</span><div><b>${esc(t.name)}</b><small>${icn(icFor('branch', t.branch, B.icon))} ${B.name} ${TIER[t.tier]}${t.tier === 3 ? ' · pick one' : t.tier === 4 ? ' · one owner' : ''}</small></div></div>
    <div class="tcard-fx" title="${esc(t.desc)}">${esc(TECH_FX[t.id] ?? '')}</div>
    ${unlock.length ? `<div class="tcard-un">${unlock.map(unlockChip(pid, st.players[pid]?.color ?? '#888')).join('')}</div>` : ''}
    ${owners.length ? `<div class="tcard-own">${owners.map(p => `<span class="crest-dot" style="--pc:${esc(p.color)}">${esc(p.name)}</span>`).join('')}</div>` : ''}
    <div class="tcard-act">${act}</div></div>`;
}

/** After render: draw the branch connector lines and place the expanded card next to its node. */
export function empireAfter(c: Ctx, body: HTMLElement) {
  if (c.tab === 'laws') { lawsAfter(body); return; }
  if (c.tab === 'ships') { shipsAfter(body); return; }
  if (c.tab !== 'research') return;
  const pid = empirePid(c.g), mine = c.g.st.players[pid]?.techs ?? [];
  for (const tree of body.querySelectorAll<HTMLElement>('.rb-tree')) {
    const svg = tree.querySelector<SVGSVGElement>('.rb-lines');
    if (!svg) continue;
    const tr = tree.getBoundingClientRect();
    if (!tr.width) continue;
    const pos = (el: Element | null) => {
      if (!el) return null;
      const d = el.querySelector('.rn-disc')!.getBoundingClientRect(), n = el.getBoundingClientRect();
      // lines run from under a node's label/cost to the top of the next disc, never through text
      return { x: d.left - tr.left + d.width / 2, top: d.top - tr.top, bottom: n.bottom - tr.top, s: (el as HTMLElement).className };
    };
    const rows = [...tree.querySelectorAll('.rb-row')].map(r => [...r.querySelectorAll('.rn')].map(pos));
    const segs: string[] = [];
    const seg = (a: ReturnType<typeof pos>, b: ReturnType<typeof pos>) => {
      if (!a || !b) return;
      const lit = /s-own/.test(a.s) && /s-own/.test(b.s);
      const pend = /s-own/.test(a.s) && /s-pending/.test(b.s);
      const dead = /s-other/.test(b.s) || /s-other/.test(a.s);
      const ready = /s-own/.test(a.s) && /s-(avail|short|busy)/.test(b.s);
      const x1 = a.x, y1 = a.bottom + 3, x2 = b.x, y2 = b.top - 4;
      if (y2 - y1 < 4) return;
      segs.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="ln ${lit ? 'lit' : pend ? 'pend' : dead ? 'dead' : ready ? 'ready' : ''}"/>`);
    };
    seg(rows[0]?.[0], rows[1]?.[0]);
    for (const f of rows[2] ?? []) { seg(rows[1]?.[0], f); seg(f, rows[3]?.[0]); }
    svg.setAttribute('viewBox', `0 0 ${tr.width.toFixed(0)} ${tr.height.toFixed(0)}`);
    svg.setAttribute('width', tr.width.toFixed(0));
    svg.setAttribute('height', tr.height.toFixed(0));
    svg.innerHTML = segs.join('');
  }
  void mine;
  // the detail card: beside its node (desktop); phones dock it at the bottom (CSS)
  const card = body.querySelector<HTMLElement>('.tcard'), host = body.querySelector<HTMLElement>('.rx-tree');
  const node = ui.tech ? body.querySelector<HTMLElement>(`.rn[data-id="${ui.tech}"]`) : null;
  if (card && host && node && getComputedStyle(card).position === 'absolute') {
    const hr = host.getBoundingClientRect(), nr = node.getBoundingClientRect();
    const w = card.offsetWidth, h = card.offsetHeight;
    let x = nr.right - hr.left + 10 + host.scrollLeft;
    if (nr.right + 10 + w > hr.right - 4) x = nr.left - hr.left - w - 10 + host.scrollLeft;
    let y = nr.top - hr.top - 8;
    y = Math.max(0, Math.min(y, host.scrollHeight - h - 4));
    card.style.left = `${Math.max(4, x)}px`;
    card.style.top = `${y}px`;
  }
}

// ====================================================================== laws
/** Reasons that block every card alike (said once in the header, not on each card). */
const GENERAL = new Set(['Orders sealed', 'Spectating', 'Game over', 'Eliminated']);
interface LawSt { state: 'on' | 'revoking' | 'pending' | 'open'; why: string; cost: number; switching: boolean; slot: number | null; until?: number }
function shortWhy(s: string | null | undefined): string {
  if (!s) return '';
  if (/sealed/i.test(s)) return 'Orders sealed';
  if (/spectat/i.test(s)) return 'Spectating';
  if (/All \d+ orders|order slot/i.test(s)) return 'All orders used this turn';
  if (/banked/i.test(s)) return 'No order banked';
  if (/law slot/i.test(s)) return 'No free law slot';
  if (/already queued/i.test(s)) return 'Other side queued';
  if (/game is over/i.test(s)) return 'Game over';
  const w = s.replace(/\.$/, '').split(/\s+/);
  return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '');
}
/** LIVE: when your next order is banked (ms epoch), or 0. */
const nextOrderAt = (g: Host) => (g.live && g.you !== null ? g.st.live?.nextOrderAt?.[g.you] ?? 0 : 0);
const banked = (g: Host) => (g.live && g.you !== null ? Math.max(0, g.st.live?.bank?.[g.you] ?? 0) : 0);
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** A countdown that ticks in place (see the interval below). */
const countdown = (at: number) => `<span class="lw-cd" data-until="${at}">${mmss(at - Date.now())}</span>`;
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    for (const el of document.querySelectorAll<HTMLElement>('.mdl-root [data-until]')) el.textContent = mmss(Number(el.dataset.until) - Date.now());
  }, 1000);
}

function lawState(g: Host, pid: number, id: string): LawSt {
  const st = g.st, pl = st.players[pid];
  const cs = pid === g.you ? costState(g) : st;
  const cost = lawCost(cs, pid, id);
  const opp = opposite(id);
  const switching = !!opp && !!cs.players[pid].laws?.includes(opp);
  if (pl.laws?.includes(id)) {
    if (pid === g.you && pendingRevoke(g, id)) return { state: 'revoking', why: '', cost, switching, slot: null };
    return { state: 'on', why: '', cost, switching, slot: null };
  }
  const k = pid === g.you ? pendingOrder(g, o => o.type === 'law' && o.law === id) : null;
  if (k !== null) return { state: 'pending', why: '', cost, switching, slot: k };
  let why = '', until: number | undefined;
  if (pid !== g.you) why = shortWhy(lawBlock(st, pid, id)) || '';
  else if (!g.canPlan) why = lockWhy(g);
  else {
    if (g.live && banked(g) < 1) { why = 'No order banked'; until = nextOrderAt(g) || undefined; }
    else why = shortWhy(g.orderWhy ? g.orderWhy({ type: 'law', law: id }) : lawBlock(cs, pid, id));
    if (!why && opp && pendingOrder(g, o => o.type === 'law' && o.law === opp) !== null) why = 'Other side queued';
    if (!why && !switching) {
      const queued = LAWS.filter(l => l.id !== id && pendingOrder(g, o => o.type === 'law' && o.law === l.id) !== null && !pl.laws?.includes(opposite(l.id) ?? '')).length;
      const after = (pl.laws ?? []).filter(x => !pendingRevoke(g, x)).length + queued;
      if (queued && after >= lawSlots({ ...st, players: pendingPlayers(g) }, pid)) why = 'No free law slot';
    }
    const have = leftover(g, pid).influence;
    if ((!why || /influence/i.test(why)) && have < cost) why = `Need ✦${cost} (you have ${Math.max(0, have)})`;
  }
  return { state: 'open', why, cost, switching, slot: null, until };
}

function lawsHtml(c: Ctx): string {
  const g = c.g, st = g.st, pid = empirePid(g), pl = st.players[pid], E = st.rules.empire;
  const editable = g.you === pid && g.canPlan;
  const slots = lawSlots(pendingPlayers(g) === st.players ? st : { ...st, players: pendingPlayers(g) }, pid);
  const used = (pl.laws ?? []).length;
  const queued = pid === g.you ? LAWS.filter(l => pendingOrder(g, o => o.type === 'law' && o.law === l.id) !== null && !pl.laws?.includes(opposite(l.id) ?? '')).length : 0;
  const unit = g.live ? 'cycle' : 'turn';
  // ---- header: slots, how to gain more, what enacting costs
  const more: string[] = (Array.isArray(E.lawSlotTurns) ? E.lawSlotTurns : []).filter(t => st.turn < t).map(t => `+1 at ${unit} ${t}`);
  if (!pl.techs?.includes('bureaucracy')) more.push(`+1 by researching <button class="lw-link" data-a="emp-goto" data-id="bureaucracy">Bureaucracy</button>`);
  const bars = Array.from({ length: Math.max(slots, used + queued) }, (_, i) => `<i class="${i < used ? 'on' : i < used + queued ? 'q' : ''}"></i>`).join('');
  const slotLine = `<div class="lw-slots"><span class="lbl">Law slots</span><span class="lw-bars">${bars}</span><b>${used + queued}/${slots}</b>${queued ? '<span class="gold">incl. queued</span>' : ''}</div>`;
  const moreLine = `<div class="lw-more">${more.length ? `More slots: ${more.join(' · ')}` : 'All law slots unlocked'}</div>`;
  let rule = '';
  if (pid === g.you) {
    const gw = lockWhy(g);
    if (gw) rule = `<span class="lw-gen">${esc(gw)}: laws are read-only</span>`;
    else if (g.live) {
      const n = banked(g), at = nextOrderAt(g);
      rule = `Enacting costs <b>1 order</b> + ✦ influence. ${n > 0 ? `You have <b>${n}</b> banked.` : `<span class="lw-gen">No order banked.</span>`}${at ? ` Next order in ${countdown(at)}.` : ''}`;
    } else {
      const free = g.plan.orders.filter(o => !o).length;
      rule = `Enacting costs <b>1 order</b> (${free} of ${g.plan.orders.length} free this turn) + ✦ influence.`;
    }
    rule += ' Revoking is free; switching sides costs double.';
  }
  const head = `<div class="lw-top">${slotLine}${moreLine}${rule ? `<div class="lw-rule">${rule}</div>` : ''}</div>`;

  const rows = LAW_PAIRS.map((pairName, i) => {
    const pair = LAWS.filter(l => l.pair === i);
    const states = pair.map(l => lawState(g, pid, l.id));
    const activeIdx = states.findIndex(s => s.state === 'on' || s.state === 'pending');
    const prev = ui.prevLaw.get(i);
    const activeId = activeIdx >= 0 ? pair[activeIdx].id : null;
    const changed = prev !== undefined && prev !== activeId;
    ui.prevLaw.set(i, activeId);
    const card = (l: typeof pair[number], s: LawSt, other: typeof pair[number]) => {
      const rivals = st.players.filter(p => p.id !== pid && p.laws?.includes(l.id));
      const riv = rivals.length ? `<span class="lw-riv" title="Rivals with this law in force">${rivals.map(p => `<span><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span>`).join('')}</span>` : '';
      let foot = '';
      const costTx = `✦${s.cost}`;
      if (s.state === 'on') foot = `<span class="lw-tag on">${icn('check')} In force</span>${editable ? `<button class="mbtn m-ghost sm lw-btn" data-a="revoke" data-id="${l.id}" title="Revoke (free)">${icn('undo')} Revoke</button>` : ''}`;
      else if (s.state === 'revoking') foot = `<span class="lw-tag neg">Revoking ${g.live ? 'next tick' : 'this turn'}</span>${editable && !g.live ? `<button class="mbtn m-ghost sm lw-btn" data-a="unrevoke" data-id="${l.id}">${icn('undo')} Keep</button>` : ''}`;
      else if (s.state === 'pending') foot = `<span class="lw-tag gold">${icn('hourglass')} ${g.live ? 'Enacting next tick' : `Queued · order ${ROMAN[(s.slot ?? 0) + 1]}`}</span>${editable ? `<button class="mbtn m-ghost sm lw-btn" data-a="unlaw" data-id="${l.id}">${icn('undo')} Undo</button>` : ''}`;
      else if (editable && !s.why) foot = `<button class="mbtn go lw-btn lw-go" data-a="enact" data-id="${l.id}"${s.switching ? ` title="Replaces ${esc(other.name)}; switching sides costs double"` : ''}>${s.switching ? 'Switch' : 'Enact'} <span class="cost">${costTx}</span></button>${s.switching ? `<span class="lw-sub">Replaces ${esc(other.name)}</span>` : ''}`;
      else if (pid === g.you && s.why && !GENERAL.has(s.why)) {
        const why = s.why === 'No order banked' && s.until ? `Needs 1 order · next in ${countdown(s.until)}` : esc(s.why);
        foot = `<button class="mbtn lw-btn lw-off" data-a="noop" aria-disabled="true" title="${esc(s.why)}">${s.switching ? 'Switch' : 'Enact'} <span class="cost">${costTx}</span></button><span class="lw-why">${why}</span>`;
      } else foot = `<span class="lw-cost">${costTx}</span>`;
      return `<div class="lw-card s-${s.state}${s.why && s.state === 'open' && pid === g.you ? ' blocked' : ''}${changed && l.id === activeId ? ' fx-on' : ''}" data-law="${l.id}" title="${esc(l.desc)}">
        <div class="lw-hd"><span class="lw-ic">${icn(icFor('law', l.id, l.icon))}</span><div class="lw-tx"><b>${esc(l.name)}</b><span>${esc(LAW_FX[l.id] ?? '')}</span></div></div>
        ${riv}<div class="lw-foot">${foot}</div></div>`;
    };
    return `<section class="lw-pairc"><h4 class="lw-pair">${esc(pairName)}<small>hold one</small></h4><div class="lw-opts">${card(pair[0], states[0], pair[1])}<span class="lw-or" aria-hidden="true"><i>or</i></span>${card(pair[1], states[1], pair[0])}</div></section>`;
  }).join('');
  return `<div class="lw">${head}<div class="lw-grid">${rows}</div></div>`;
}
function lawsAfter(_body: HTMLElement) { /* the newly active side flashes via .fx-on (CSS) */ }

// ====================================================================== ships
/** One-line role per class (the rules' sentence is the tooltip). */
const ROLE: Record<string, string> = { scout: 'Fast picket', corvette: 'Raider', frigate: 'Line ship', bombard: 'Siege', cruiser: 'Heavy brawler', dread: 'Capital ship' };
/** Locked module the player tapped ('cls:mod'): its requirement shows on that card. */
let modWhy: string | null = null;
const RES_IC: [keyof ReturnType<typeof shipCostMod>, string, string][] = [['industry', 'industry', 'Industry'], ['credits', 'credits', 'Credits'], ['influence', 'influence', 'Influence']];
/** A technology name as a link that opens it in the Research tab. */
const techLink = (id: string) => TECH[id] ? `<button class="arm-link" data-a="emp-goto" data-id="${id}" title="Open ${esc(TECH[id].name)} in Research">${esc(TECH[id].name)}</button>` : esc(id);

function shipsHtml(c: Ctx): string {
  const g = c.g, st = g.st, R = st.rules, pid = empirePid(g), pl = st.players[pid];
  const editable = g.you === pid && g.canPlan;
  const conn = connected(st, pid);
  const cs = pid === g.you ? costState(g) : st;
  const color = pl.color;
  const when = g.live ? 'from next tick' : 'from next turn';
  const cards = Object.entries(R.ships).map(([k, d]) => {
    const block = classBlock(st, pid, k, conn);
    const saved = blueprintFor(st, pid, k) ?? 'armor';
    const queued = pid === g.you ? pendingBlueprint(g, k) : null;
    const cur = queued ?? saved;
    const pend = queued !== null && queued !== saved;
    const ship = { cls: k, mod: cur, maxHp: baseHp(cs, k, cur), hp: 0 } as unknown as Ship;
    const s = shipStats(cs, ship, pid);
    const cost = shipCostMod(cs, pid, k, d.cost);
    // ---- requirements (class)
    const needTech = (d.tech ?? []).length && !(d.tech ?? []).some(t => pl.techs?.includes(t)) ? d.tech! : [];
    const needVein = d.vein && !hasVein(st, pid, d.vein, conn) ? d.vein : null;
    const reqParts: string[] = [];
    if (needTech.length) reqParts.push(needTech.map(techLink).join(' <span class="dim">or</span> '));
    if (needVein) reqParts.push(`<span class="arm-vein" title="An Extractor on a ${esc(VEINS[needVein].name)} vein, connected to your capital"><i style="color:${VEINS[needVein].color}">${icn(needVein)}</i>${esc(VEINS[needVein].name)}</span>`);
    const req = block ? `<div class="arm-req">${icn('lock', { cls: 'arm-lk' })}<span>Requires ${reqParts.join(' <span class="dim">·</span> ') || esc(block)}</span></div>` : '';
    // ---- module selector
    const mods = MODULES.map(m => {
      const known = !m.tech || cs.players[pid].techs?.includes(m.tech);
      const on = m.id === cur;
      const tipTx = `${m.name}: ${m.desc}${known ? '' : ` Needs ${TECH[m.tech!]?.name}.`}${on && pend ? ` Chosen ${when}.` : ''}`;
      const act = !known ? `data-a="mod-why" data-id="${k}:${m.id}" aria-disabled="true"` : editable && !on ? `data-a="bp" data-id="${k}:${m.id}"` : '';
      return `<button class="mod ${on ? 'on' : ''}${on && pend ? ' pend' : ''}${known ? '' : ' lock'}" ${act} title="${esc(tipTx)}" aria-pressed="${on}" aria-label="${esc(`${m.name}${known ? '' : ' (locked)'}`)}"><i>${icn(icFor('module', m.id, m.icon))}</i><span>${MOD_SHORT[m.id] ?? m.name}</span>${known ? '' : `<em class="mod-lk">${icn('lock')}</em>`}</button>`;
    }).join('');
    // ---- the note under the selector: a locked module's requirement, else the pending change
    let note = '';
    const why = modWhy?.startsWith(`${k}:`) ? MODULE[modWhy.slice(k.length + 1)] : null;
    if (why?.tech) note = `<div class="arm-note lockn">${icn('lock')}<span>${esc(MOD_SHORT[why.id] ?? why.name)} needs ${techLink(why.tech)}</span></div>`;
    else if (pend) note = `<div class="arm-note pendn">${icn('hourglass')}<span><b>${esc(MOD_SHORT[cur] ?? cur)}</b> ${when}</span>${editable ? `<button class="arm-undo" data-a="bp" data-id="${k}:${saved}" title="Keep ${esc(MODULE[saved]?.name ?? saved)}">${icn('undo')} Undo</button>` : ''}</div>`;
    const pills = RES_IC.filter(([r]) => cost[r]).map(([r, icon, nm]) => `<span class="arm-pill r-${r}" title="${nm} ${cost[r]}">${icn(icon)}<b>${cost[r]}</b></span>`).join('') || '<span class="arm-pill">free</span>';
    const stat = (icon: string, label: string, val: string, t: string) => `<span class="arm-stat" title="${esc(t)}">${icn(icon)}<b>${val}</b><small>${label}</small></span>`;
    const atk = s.shots > 1 ? `${s.attack}<small>×${s.shots}</small>` : `${s.attack}`;
    return `<article class="arm-card${block ? ' locked' : ''}${pend ? ' pending' : ''}" data-cls="${k}" style="--pc:${esc(color)}">
      <div class="arm-art"><canvas data-mini data-cls="${k}" data-owner="${pid}" data-team="${esc(color)}" aria-hidden="true"></canvas>${block ? `<span class="arm-lock" title="Locked">${icn('lock')}</span>` : ''}</div>
      <div class="arm-body">
        <header class="arm-h"><div class="arm-tt"><h4 class="arm-nm">${esc(d.name)}</h4><span class="arm-role" title="${esc(d.role)}">${esc(ROLE[k] ?? d.role)}</span></div><div class="arm-cost">${pills}</div></header>
        <div class="arm-st">${stat('attack', 'Attack', atk, `Attack ${s.attack}${s.shots > 1 ? ` × ${s.shots} shots` : ''} per round`)}${stat('hull', 'Hull', `${s.hp}`, `Hull ${s.hp}`)}${stat('speed', 'Speed', `${s.speed}`, `Speed ${s.speed} (regions per move)`)}${stat('shield', 'Shield', `${s.shields}`, `Shields ${s.shields} (damage blocked per hit)`)}</div>
        ${block ? req : `<div class="arm-mods" role="group" aria-label="${esc(d.name)} module">${mods}</div>${note}`}
      </div>
    </article>`;
  }).join('');
  const old = st.fleets.filter(f => f.owner === pid).reduce((a, f) => a + f.ships.filter(s => s.mod !== blueprintFor(st, pid, s.cls)).length, 0);
  const ro = !editable && g.you === pid && lockWhy(g) ? `<span class="arm-ro">${esc(lockWhy(g))}</span>` : '';
  return `<div class="sx arm"><div class="arm-grid">${cards}</div>
    <footer class="arm-foot">${icn('refit', { cls: 'arm-fic' })}<span>New ships get the chosen module. Refit older fleets at a shipyard: <b>⚙${R.empire.refitIndustryPerShip}</b> per ship.</span>${old ? `<span class="arm-old">${old} outdated</span>` : ''}${ro}</footer></div>`;
}
function shipsAfter(body: HTMLElement) { paintMinis(body); }

// ====================================================================== actions
/** WEGO: drop queued ship designs whose module needs a technology you neither own nor research this turn. */
function dropStaleDesigns(g: Host) {
  if (g.live || g.you === null) return;
  const techs = g.st.players[g.you].techs ?? [], pend = pendingResearch(g);
  dropFree(g, x => x.type === 'blueprint' && !!MODULE[x.mod]?.tech && !techs.includes(MODULE[x.mod].tech!) && MODULE[x.mod].tech !== pend);
}
export function empireAct(c: Ctx, a: string, el: HTMLElement): boolean {
  const g = c.g, id = el.dataset.id ?? '';
  switch (a) {
    case 'noop': return true;
    case 'emp-pid': ui.empPid = Number(id); ui.tech = null; c.rerender(); return true;
    case 'tech': ui.tech = ui.tech === id ? null : id; c.rerender(); return true;
    case 'tech-close': case 'tree-bg': if (ui.tech) { ui.tech = null; c.rerender(); } return true;
    case 'research': {
      if (!g.canPlan || g.you === null || !TECH[id]) return true;
      if (techInfo(g, g.you, TECH[id]).s !== 'avail') return true;
      if (!g.live) dropFree(g, x => x.type === 'research');
      g.pushFree({ type: 'research', tech: id });
      if (!g.live) {
        // free actions apply in plan order: the research goes first, so a design that needs it can follow; a design
        // that needed the technology just dropped would fail at resolution, so it goes too
        const fa = g.plan.free.pop()!;
        g.plan.free.unshift(fa);
        dropStaleDesigns(g);
      }
      c.acted();
      return true;
    }
    case 'unresearch': if (g.canPlan) { dropFree(g, x => x.type === 'research'); dropStaleDesigns(g); c.acted(); } return true;
    case 'enact': if (g.canPlan) { g.addOrder({ type: 'law', law: id }); c.acted(); } return true;
    case 'unlaw': {
      const k = pendingOrder(g, o => o.type === 'law' && o.law === id);
      if (k !== null && g.canPlan) { dropOrder(g, k); c.acted(); }
      return true;
    }
    case 'revoke':
      if (!g.canPlan || !LAW[id]) return true;
      if (g.live && !confirm(`Revoke ${LAW[id].name}? Enacting it again costs an order.`)) return true;
      g.pushFree({ type: 'revoke', law: id });
      c.acted();
      return true;
    case 'unrevoke': if (g.canPlan) { dropFree(g, x => x.type === 'revoke' && x.law === id); c.acted(); } return true;
    case 'mod-why': modWhy = modWhy === id ? null : id; c.rerender(); return true;
    case 'emp-goto': if (TECH[id]) { modWhy = null; ui.tabs.empire = 'research'; ui.tech = id; el.closest('.mdl-body')?.scrollTo(0, 0); c.rerender(); } return true;
    case 'bp': {
      modWhy = null;
      const [cls, mod] = id.split(':');
      if (!g.canPlan || g.you === null || !MODULE[mod]) return true;
      if (g.live) g.pushFree({ type: 'blueprint', cls, mod });
      else {
        dropFree(g, x => x.type === 'blueprint' && x.cls === cls);
        if (mod !== blueprintFor(g.st, g.you, cls)) g.pushFree({ type: 'blueprint', cls, mod });
      }
      c.acted();
      return true;
    }
  }
  return false;
}

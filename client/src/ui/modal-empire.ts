// Empire modal: Research (tech tree), Laws (four two-sided toggles), Ships (class cards + module
// picker). Design: docs/UX-V2.md §5, docs/EMPIRE.md. Icons + numbers; a sentence never.
import { BRANCHES, TECHS, TECH, LAWS, LAW, LAW_PAIRS, MODULES, MODULE, VEINS, type Branch, type TechDef } from '../../../shared/config/empire.ts';
import { techCost, researchBlock, lawSlots, lawCost, opposite, starOwner, connected, hasVein, blueprintFor, classBlock, shipStats, baseHp, shipCostMod, lawBlock } from '../../../shared/sim/empire.ts';
import type { Ship } from '../../../shared/sim/types.ts';
import { type Ctx, type Host, ui, esc, ROMAN, per, costHtml, pendingResearch, pendingRevoke, pendingBlueprint, pendingOrder, leftover, affordable, shortOf, dropFree, dropOrder, lockWhy, costState, pendingPlayers } from './modal-util.ts';
import { ic as icn, icFor } from '../art/icons.ts';

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
  cruisers: [['ship:long', 'Cruiser'], ['antimatter', 'needs']],
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

// ====================================================================== ship silhouettes
const HULL: Record<string, string> = {
  dart: 'M22 30 L98 25 L110 30 L98 35 Z M34 30 L20 18 L30 30 L20 42 Z',
  arrow: 'M16 15 L100 30 L16 45 L32 30 Z',
  wedge: 'M12 15 L66 19 L106 30 L66 41 L12 45 L24 30 Z',
  block: 'M14 15 H80 L96 22 V38 L80 45 H14 L20 30 Z M96 26 H112 V34 H96 Z',
  long: 'M6 22 H74 L112 30 L74 38 H6 L14 30 Z M28 22 L40 9 H54 L50 22 Z M28 38 L40 51 H54 L50 38 Z',
  dread: 'M4 17 H66 L84 10 H96 L116 30 L96 50 H84 L66 43 H4 L12 30 Z M22 17 L30 6 H50 L54 17 Z M22 43 L30 54 H50 L54 43 Z',
};
export function shipSvg(glyph: string, color: string, size = 120): string {
  const d = HULL[glyph] ?? HULL.wedge;
  const id = `hg${glyph}${color.replace(/[^a-z0-9]/gi, '')}`;
  return `<svg class="hull" viewBox="0 0 120 60" width="${size}" height="${size / 2}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="${esc(color)}"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient></defs>
    <ellipse cx="9" cy="30" rx="9" ry="5" fill="${esc(color)}" opacity=".35"/><path d="${d}" fill="url(#${id})" stroke="${esc(color)}" stroke-width="1.6" stroke-linejoin="round"/><path d="${d}" fill="${esc(color)}" opacity=".35"/></svg>`;
}
const unlockChip = ([ic, label]: [string, string]) => ic.startsWith('ship:')
  ? `<span class="chipx">${shipSvg(ic.slice(5), '#cfc4ff', 46)}<b>${esc(label)}</b></span>`
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
    ${unlock.length ? `<div class="tcard-un">${unlock.map(unlockChip).join('')}</div>` : ''}
    ${owners.length ? `<div class="tcard-own">${owners.map(p => `<span class="crest-dot" style="--pc:${esc(p.color)}">${esc(p.name)}</span>`).join('')}</div>` : ''}
    <div class="tcard-act">${act}</div></div>`;
}

/** After render: draw the branch connector lines and place the expanded card next to its node. */
export function empireAfter(c: Ctx, body: HTMLElement) {
  if (c.tab === 'laws') { lawsAfter(body); return; }
  if (c.tab !== 'research') return;
  const pid = empirePid(c.g), mine = c.g.st.players[pid]?.techs ?? [];
  for (const tree of body.querySelectorAll<HTMLElement>('.rb-tree')) {
    const svg = tree.querySelector<SVGSVGElement>('.rb-lines');
    if (!svg) continue;
    const tr = tree.getBoundingClientRect();
    if (!tr.width) continue;
    const pos = (el: Element | null) => {
      if (!el) return null;
      const d = el.querySelector('.rn-disc')!.getBoundingClientRect();
      return { x: d.left - tr.left + d.width / 2, y: d.top - tr.top + d.height / 2, r: d.width / 2, s: (el as HTMLElement).className };
    };
    const rows = [...tree.querySelectorAll('.rb-row')].map(r => [...r.querySelectorAll('.rn')].map(pos));
    const segs: string[] = [];
    const seg = (a: ReturnType<typeof pos>, b: ReturnType<typeof pos>) => {
      if (!a || !b) return;
      const lit = /s-own/.test(a.s) && /s-own/.test(b.s);
      const pend = /s-own/.test(a.s) && /s-pending/.test(b.s);
      const dead = /s-other/.test(b.s) || /s-other/.test(a.s);
      const ready = /s-own/.test(a.s) && /s-(avail|short|busy)/.test(b.s);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const x1 = a.x + dx / L * (a.r + 3), y1 = a.y + dy / L * (a.r + 3), x2 = b.x - dx / L * (b.r + 3), y2 = b.y - dy / L * (b.r + 3);
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
/** Reasons that block every card alike: said once above the rows, not on each card. */
const GENERAL = new Set(['No law slot free', 'No order free', 'No order banked', 'Orders sealed', 'Spectating', 'Game over', 'Eliminated']);
interface LawSt { state: 'on' | 'revoking' | 'pending' | 'open'; why: string; cost: number; switching: boolean; slot: number | null }
function shortWhy(s: string | null | undefined): string {
  if (!s) return '';
  if (/sealed/i.test(s)) return 'Orders sealed';
  if (/spectat/i.test(s)) return 'Spectating';
  if (/All \d+ orders|order slot/i.test(s)) return 'No order free';
  if (/banked/i.test(s)) return 'No order banked';
  if (/law slot/i.test(s)) return 'No law slot free';
  if (/already queued/i.test(s)) return 'Pair already queued';
  if (/game is over/i.test(s)) return 'Game over';
  const w = s.replace(/\.$/, '').split(/\s+/);
  return w.slice(0, 5).join(' ') + (w.length > 5 ? '…' : '');
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
  let why = '';
  if (pid !== g.you) why = shortWhy(lawBlock(st, pid, id)) || '';
  else if (!g.canPlan) why = lockWhy(g);
  else {
    why = shortWhy(g.orderWhy ? g.orderWhy({ type: 'law', law: id }) : lawBlock(cs, pid, id));
    if (!why && opp && pendingOrder(g, o => o.type === 'law' && o.law === opp) !== null) why = 'Pair already queued';
    if (!why && !switching) {
      const queued = LAWS.filter(l => l.id !== id && pendingOrder(g, o => o.type === 'law' && o.law === l.id) !== null && !pl.laws?.includes(opposite(l.id) ?? '')).length;
      const after = (pl.laws ?? []).filter(x => !pendingRevoke(g, x)).length + queued;
      if (queued && after >= lawSlots({ ...st, players: pendingPlayers(g) }, pid)) why = 'No law slot free';
    }
    if (!why && leftover(g, pid).influence < cost) why = `Need ✦${cost}`;
  }
  return { state: 'open', why, cost, switching, slot: null };
}

function lawsHtml(c: Ctx): string {
  const g = c.g, st = g.st, pid = empirePid(g), pl = st.players[pid], E = st.rules.empire;
  const editable = g.you === pid && g.canPlan;
  const slots = lawSlots(pendingPlayers(g) === st.players ? st : { ...st, players: pendingPlayers(g) }, pid);
  const used = (pl.laws ?? []).length;
  const queued = pid === g.you ? LAWS.filter(l => pendingOrder(g, o => o.type === 'law' && o.law === l.id) !== null && !pl.laws?.includes(opposite(l.id) ?? '')).length : 0;
  const next = E.lawSlotTurns.find(t => st.turn < t);
  const meter = `<div class="lw-slots"><span class="lbl">Slots</span>${Array.from({ length: Math.max(slots, used + queued) }, (_, i) => `<i class="${i < used ? 'on' : i < used + queued ? 'q' : ''}"></i>`).join('')}<b>${used}/${slots}</b>${next ? `<span class="dim">+1 at ${g.live ? 'C' : 'T'}${next}</span>` : ''}${!pl.techs?.includes('bureaucracy') ? '<span class="dim">+1 Bureaucracy</span>' : ''}</div>`;
  const generalWhy = new Set<string>();
  const rows = LAW_PAIRS.map((pairName, i) => {
    const pair = LAWS.filter(l => l.pair === i);
    const states = pair.map(l => lawState(g, pid, l.id));
    const activeIdx = states.findIndex(s => s.state === 'on' || s.state === 'pending');
    const prev = ui.prevLaw.get(i);
    const activeId = activeIdx >= 0 ? pair[activeIdx].id : null;
    const from = prev !== undefined && prev !== activeId ? (prev === null ? 'none' : prev === pair[0].id ? '0' : '1') : '';
    ui.prevLaw.set(i, activeId);
    const card = (l: typeof pair[number], s: LawSt) => {
      const rivals = st.players.filter(p => p.id !== pid && p.laws?.includes(l.id));
      const dots = rivals.length ? `<span class="rn-dots">${rivals.map(p => `<i style="background:${esc(p.color)}" title="${esc(p.name)}"></i>`).join('')}</span>` : '';
      let foot = '';
      if (s.state === 'on') foot = `<span class="lw-tag on">In force</span>${editable ? `<button class="mbtn m-ghost sm" data-a="revoke" data-id="${l.id}" title="Revoke (free)">× Revoke</button>` : ''}`;
      else if (s.state === 'revoking') foot = `<span class="lw-tag neg">Revoking</span>${editable && !g.live ? `<button class="mbtn m-ghost sm" data-a="unrevoke" data-id="${l.id}">↶ Keep</button>` : ''}`;
      else if (s.state === 'pending') foot = `<span class="lw-tag gold">${g.live ? 'Next tick' : `Queued · ${ROMAN[(s.slot ?? 0) + 1]}`}</span>${editable ? `<button class="mbtn m-ghost sm" data-a="unlaw" data-id="${l.id}">↶ Undo</button>` : ''}`;
      else if (editable && !s.why) foot = `<button class="mbtn go" data-a="enact" data-id="${l.id}">${s.switching ? 'Switch' : 'Enact'} <span class="cost">✦${s.cost}${s.switching ? ` <s title="Switching sides costs double">✦${Math.round(s.cost / 2)}</s>` : ''} · 1 order</span></button>`;
      else {
        const general = GENERAL.has(s.why);
        if (general) generalWhy.add(s.why);
        foot = `<span class="lw-cost ${s.why && /Need/.test(s.why) ? 'neg' : ''}">✦${s.cost}${s.switching ? ` <s>✦${Math.round(s.cost / 2)}</s>` : ''}</span>${s.why && !general && pid === g.you ? `<span class="m-why neg">${esc(s.why)}</span>` : ''}`;
      }
      return `<div class="lw-card s-${s.state}" data-law="${l.id}" title="${esc(l.desc)}"><span class="lw-ic">${icn(icFor('law', l.id, l.icon))}</span><div class="lw-tx"><b>${esc(l.name)}</b><span>${esc(LAW_FX[l.id] ?? '')}</span></div>${dots}<div class="lw-foot">${foot}</div></div>`;
    };
    return `<div class="lw-row"><span class="lw-pair">${esc(pairName)}</span><div class="lw-toggle" data-active="${activeIdx < 0 ? 'none' : activeIdx}"${from ? ` data-from="${from}"` : ''}><i class="lw-thumb"></i>${card(pair[0], states[0])}<span class="lw-vs">⇄</span>${card(pair[1], states[1])}</div></div>`;
  }).join('');
  const note = pid === g.you && generalWhy.size ? `<div class="lw-note">${[...generalWhy].map(w => `<span class="m-why neg">${esc(w)}${w === 'No law slot free' ? ' · revoke one first' : ''}</span>`).join('')}</div>` : '';
  return `<div class="lw">${meter}${note}${rows}<div class="m-hint">Enact: 1 order + ✦ · switching sides costs double · revoke free</div></div>`;
}
function lawsAfter(body: HTMLElement) {
  // slide the lit thumb from the old side to the new one
  for (const t of body.querySelectorAll<HTMLElement>('.lw-toggle[data-from]')) {
    const to = t.dataset.active!;
    t.dataset.active = t.dataset.from!;
    t.removeAttribute('data-from');
    void t.offsetWidth;
    requestAnimationFrame(() => { t.dataset.active = to; });
  }
}

// ====================================================================== ships
function shipsHtml(c: Ctx): string {
  const g = c.g, st = g.st, R = st.rules, pid = empirePid(g), pl = st.players[pid];
  const editable = g.you === pid && g.canPlan;
  const conn = connected(st, pid);
  const cs = pid === g.you ? costState(g) : st;
  const color = pl.color;
  const cards = Object.entries(R.ships).map(([k, d]) => {
    const block = classBlock(st, pid, k, conn);
    const cur = (pid === g.you ? pendingBlueprint(g, k) : null) ?? blueprintFor(st, pid, k) ?? 'armor';
    const pend = pid === g.you && pendingBlueprint(g, k) !== null && pendingBlueprint(g, k) !== blueprintFor(st, pid, k);
    const ship = { cls: k, mod: cur, maxHp: baseHp(cs, k, cur), hp: 0 } as unknown as Ship;
    const s = shipStats(cs, ship, pid);
    const cost = shipCostMod(cs, pid, k, d.cost);
    const mods = MODULES.map(m => {
      const known = !m.tech || cs.players[pid].techs?.includes(m.tech);
      const on = m.id === cur;
      return `<button class="mod ${on ? 'on' : ''} ${known ? '' : 'lock'}" ${editable && known && !on ? `data-a="bp" data-id="${k}:${m.id}"` : ''} ${known ? '' : 'disabled'} title="${esc(`${m.name}: ${m.desc}${known ? '' : ` Needs ${TECH[m.tech!]?.name}.`}`)}" aria-pressed="${on}"><i>${icn(icFor('module', m.id, m.icon))}</i><span>${MOD_SHORT[m.id] ?? m.name}</span></button>`;
    }).join('');
    const why = block ? block.replace(/\s*\(.*\)\s*$/, '').replace(/^needs/, 'Needs') : '';
    const atk = s.shots > 1 ? `${s.attack}<small>×${s.shots}</small>` : `${s.attack}`;
    return `<article class="shc ${block ? 'locked' : ''}" style="--pc:${esc(color)}">
      <div class="sc-art">${shipSvg(d.glyph, block ? '#6f6796' : color, 150)}</div>
      <div class="sc-h"><b>${esc(d.name)}</b><span class="sc-cost">${costHtml(cost)}</span></div>
      <div class="sc-st"><span title="Attack × shots">⚔<b>${atk}</b></span><span title="Hull">❤<b>${s.hp}</b></span><span title="Speed">${icn('speed')}<b>${s.speed}</b></span><span title="Shields">${icn('shield')}<b>${s.shields}</b></span></div>
      ${block ? `<div class="sc-lock">${esc(why)}</div>` : `<div class="sc-mods" role="group" aria-label="Module">${mods}</div>${pend ? `<div class="sc-pend gold">${g.live ? 'Next tick' : 'New design queued'}</div>` : ''}`}
    </article>`;
  }).join('');
  const old = st.fleets.filter(f => f.owner === pid).reduce((a, f) => a + f.ships.filter(s => s.mod !== blueprintFor(st, pid, s.cls)).length, 0);
  return `<div class="sx"><div class="sx-grid">${cards}</div><div class="m-hint">New ships get the module · ⚒ Refit old fleets at a shipyard (⚙${R.empire.refitIndustryPerShip}/ship)${old ? ` · <b class="gold">${old} outdated</b>` : ''}</div></div>`;
}

// ====================================================================== actions
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
      c.acted();
      return true;
    }
    case 'unresearch': if (g.canPlan) { dropFree(g, x => x.type === 'research'); c.acted(); } return true;
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
    case 'bp': {
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

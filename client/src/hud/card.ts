// The selection card (docs/UX-V2.md §3, §6): shown only while something is selected. Desktop: floating above the
// strip on the side away from the selection. Phone: a half-height bottom sheet (swipe down to dismiss).
// Own fleet: header stats, a ship fan (tap chips to lift them, drag them onto the map to split), icon actions,
// a 3-way doctrine toggle, "⋯" for commander and record. Own planet: stats, build tray, develop tray.
// Enemy / neutral planet: owner, garrison, seize odds from your nearby fleets, influence / scan / feint / pact.
import type { GameScreen } from '../game.ts';
import type { Doctrine, Fleet, Order, Region } from '../../../shared/sim/types.ts';
import { fleetPower, fleetSpeed } from '../../../shared/sim/graph.ts';
import { orderCost, costText, canAfford } from '../../../shared/sim/orders.ts';
import { creditRate, flipThreshold } from '../../../shared/sim/resolve.ts';
import { maxGarrison } from '../../../shared/sim/setup.ts';
import { TRAITS as CMD_TRAITS } from '../../../shared/config/content.ts';
import { TECH, MODULE, TRAITS as WORLD_TRAITS, VEINS } from '../../../shared/config/empire.ts';
import { blueprintFor, classBlock, connected, hasTech, maxDevAt, supplied } from '../../../shared/sim/empire.ts';
import { etaTicks, tickMs } from '../../../shared/sim/live.ts';
import { esc } from '../ui/dom.ts';
import { intentFor, commitIntent, type Intent } from './verbs.ts';
import { shipSvg, shortWhy, tip, fmtDur } from './util.ts';
import { fleetBadge, fleetSubline, fleetSoulRows, honourChoice, sagaChips, fleetSoulActs, vowPicker, shipTraitBits, worldEpi, worldSoulRows, soulAction, openFounding, bannersLeft } from './soul.ts';
import { bannerSvg } from '../art/sigils.ts';
import { postureRow, fateRow, postureStatus, worldSigRows, sigAction } from './signature.ts';
import { systemRows } from './systems.ts';
import { starIndustry, sysOn, systemCostMult, worldFx } from '../../../shared/sim/systems.ts';

const PROJ_ICON: Record<string, string> = { station: '⬡', develop: '▲', shipyard: '⚒', fortress: '⛨', mine: '⚙', tradehub: '¢', sensor: '◎', academy: '✺', extractor: '⚛', battery: '⚔', pshield: '⛨', depot: '➤', gate: '◎' };
const MOD_COLOR: Record<string, string> = { armor: '#c9c3e6', railgun: '#ff9b6b', deflector: '#6fd0ff', ion: '#9dff8a' };
const STANCES: { id: Doctrine['stance']; icon: string; label: string; retreat: number; guard: boolean; tip: string }[] = [
  { id: 'aggressive', icon: '⚔', label: 'Attack', retreat: 0.15, guard: false, tip: 'Engages anything hostile; retreats late' },
  { id: 'defensive', icon: '⛨', label: 'Hold', retreat: 0.35, guard: true, tip: 'Fights when attacked; guards neighbours' },
  { id: 'evasive', icon: '➤', label: 'Evade', retreat: 0.6, guard: false, tip: 'Avoids fights; retreats early' },
];

/** The card's open "⋯" section, per fleet (kept across re-renders). */
let moreOpen = false;

export function renderCard(g: GameScreen, el: HTMLElement) {
  const s = g.sel;
  let html = '';
  let kind = '';
  if (s && !g.blockingReplay) {
    if (s.kind === 'fleet') { const f = g.fleet(s.id); if (f) { kind = f.owner === g.you ? 'own-fleet' : 'foe-fleet'; html = f.owner === g.you ? ownFleet(g, f) : foeFleet(g, f); } }
    else { const r = g.st.regions[s.id]; if (r) { kind = r.owner === g.you && g.you !== null ? 'own-planet' : 'planet'; html = r.owner === g.you && g.you !== null ? ownPlanet(g, r) : foreignPlanet(g, r); } }
  }
  el.classList.toggle('hidden', !html);
  if (!html) { g.setHtml(el, ''); g.root.classList.remove('card-left'); return; }
  el.dataset.kind = kind;
  g.keepInputs(el, () => g.setHtml(el, html));
  place(g, el);
}

/** Desktop: float above the strip on the side away from the selection. Phone: CSS bottom sheet. */
function place(g: GameScreen, el: HTMLElement) {
  if (g.phone) { g.root.classList.remove('card-left'); return; }
  const s = g.sel!;
  const site = s.kind === 'region' ? g.st.regions[s.id]?.site : (() => { const f = g.fleet(s.id); return f ? g.lastFleetPos.get(f.id) ?? g.st.regions[f.region].site : undefined; })();
  if (!site) return;
  const p = g.map.toScreen(site);
  const left = p.x > g.map.w * 0.5;
  el.classList.toggle('at-left', left);
  el.classList.toggle('at-right', !left);
  g.root.classList.toggle('card-left', left);
}

// ---------------------------------------------------------------- pieces
const ib = (a: string, icon: string, label: string, why: string | null, extra = '', tipText = '') =>
  `<button class="ib" data-a="${a}" ${extra}${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tipText ? tip(tipText) : ''}><i>${icon}</i><span>${label}</span></button>`;
const pips = (n: number, max: number) => `<span class="dpips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
function head(g: GameScreen, name: string, color: string, stats: string, extra = '', badge = '', sub = '') {
  return `<div class="ch" style="--pc:${esc(color)}">${badge || '<span class="crestdot"></span>'}<span class="nmw"><b class="nm">${esc(name)}</b>${sub}</span>${extra}<button class="cx" data-a="close" aria-label="Close">×</button></div><div class="cs">${stats}</div>`;
}
const stat = (icon: string, v: string, t: string, cls = '') => `<span class="st ${cls}"${tip(t)}><i>${icon}</i><b>${v}</b></span>`;

function ownFleet(g: GameScreen, f: Fleet): string {
  const st = g.st, R = st.rules;
  const power = fleetPower(st, f), speed = fleetSpeed(st, f);
  const hp = f.ships.reduce((a, s) => a + s.hp, 0), max = f.ships.reduce((a, s) => a + s.maxHp, 0) || 1;
  const hpPct = Math.round((hp / max) * 100);
  const c = f.commander;
  const trait = c.traits[c.traits.length - 1];
  const tword = trait ? CMD_TRAITS[trait]?.name ?? trait : '';
  const siblings = st.fleets.filter(x => x.owner === f.owner && x.region === f.region && x.ships.length);
  const sib = siblings.length > 1 ? `<span class="sib"><button data-a="sib" data-d="-1" aria-label="Previous fleet">‹</button><small>${siblings.indexOf(f) + 1}/${siblings.length}</small><button data-a="sib" data-d="1" aria-label="Next fleet">›</button></span>` : '';
  const stats = stat('⚔', String(power), 'Power') + stat('❤', `${hpPct}%`, 'Hull', hpPct < 50 ? 'bad' : '') + stat('➤', String(speed), 'Speed') +
    `<span class="cmd"${tip(`${c.name}${tword ? ` · ${tword}` : ''}`)}>${esc(c.name.split(' ').slice(-1)[0])}${tword ? ` · <em>${esc(tword)}</em>` : ''}</span>`;
  // one status line, icon-first
  const status: string[] = [];
  const war = (st.engagements ?? []).find(e => e.region === f.region);
  if (f.siege === f.region) status.push(`<span class="war">⚔ Siege${war ? ` · ${war.rounds}` : ''}</span>`);
  else if (war) status.push(`<span class="war">⚔ In battle</span>`);
  if (f.fatigued) status.push('<span class="warn">⚠ Fatigued</span>');
  status.push(...postureStatus(g, f));
  if (f.fortified) status.push('<span>⛨ Dug in</span>');
  if (st.rules.empire?.enabled !== false && f.ships.length && ((f.oos ?? 0) > 0 || !supplied(st, f.owner).has(f.region))) status.push('<span class="warn">⚠ No supply</span>');
  if (f.route && !f.limping && (f.route.path.length || f.route.seize !== null)) {
    const dest = f.route.seize ?? f.route.path[f.route.path.length - 1] ?? f.region;
    const left = Math.max(1, f.route.path.length);
    const eta = g.live ? fmtDur((etaTicks(st, f.id) ?? 0) * tickMs(st)) : `${Math.max(1, Math.ceil(left / Math.max(1, speed)))}t`;
    status.push(`<span${tip('Travelling: keeps going each turn')}>${f.route.seize !== null ? '⚔' : '➤'} ${esc(st.regions[dest]?.name ?? '?')} · ${eta}</span>${g.canPlan ? '<button class="mini" data-a="halt">■ Halt</button>' : ''}`);
  }
  // ship fan
  const lifted = g.lifted;
  const bpState = g.projectedState(g.nextSlot() ?? 0);
  const fan = f.ships.map(s => {
    const def = R.ships[s.cls];
    const pct = Math.max(0, Math.min(1, s.hp / s.maxHp));
    const bp = blueprintFor(bpState, f.owner, s.cls);
    const old = bp && s.mod && bp !== s.mod;
    const sys = !s.sys.engines || !s.sys.weapons || !s.sys.shields;
    const tr = shipTraitBits(s.traits);
    return `<button class="sc ${lifted.has(s.id) ? 'up' : ''}" data-ship="${s.id}"${tip(`${s.name} · ${def?.name ?? s.cls}${s.title ? ` ${s.title}` : ''}${tr.tip}`)}>${tr.icons}${shipSvg(s.cls, g.color(f.owner), 30)}<i class="hb"><i style="width:${(pct * 100).toFixed(0)}%;background:${pct < 0.4 ? 'var(--bad)' : 'var(--good)'}"></i></i>${s.mod ? `<i class="md ${old ? 'old' : ''}" style="background:${MOD_COLOR[s.mod] ?? '#ccc'}"></i>` : ''}${sys ? '<i class="sx">!</i>' : ''}</button>`;
  }).join('');
  const nLift = [...lifted].filter(id => f.ships.some(s => s.id === id)).length;
  // actions
  let acts = '';
  if (g.canPlan) {
    const here = st.regions[f.region];
    const why = (o: Order) => g.orderWhy(o);
    acts += ib('fortify', '⛨', 'Fortify', f.fortified ? 'already dug in' : why({ type: 'fortify', fleet: f.id }), '', 'Dig in: hits harder here');
    acts += ib('scan', '◎', 'Scan', why({ type: 'scan', target: f.region }), '', 'Reveal this area');
    if (here.owner === g.you && (here.buildings.shipyard ?? 0) > 0 && f.ships.some(s => s.mod !== blueprintFor(bpState, g.you!, s.cls) || s.hp < s.maxHp)) acts += ib('refit', '⚒', 'Refit', why({ type: 'refit', fleet: f.id }), '', 'Repair and upgrade');
    if (here.relic === 'unclaimed') acts += ib('excavate', '✧', 'Excavate', here.owner === g.you ? why({ type: 'excavate', fleet: f.id }) : 'you must own the region', '', 'Dig up the relic');
    if (f.ships.length > 1) acts += ib('split', '✂', nLift ? `Split ${nLift}` : 'Split ½', g.fleetUses(f.id) > 0 ? 'has orders' : null, '', 'Free: forms a new fleet');
    acts += fleetSoulActs(g, f, ib);
    const d = g.doctrineOf(f);
    acts += `<span class="seg" role="group" aria-label="Doctrine">${STANCES.map(x => `<button class="${d.stance === x.id ? 'on' : ''}" data-a="stance" data-s="${x.id}"${tip(x.tip)}><i>${x.icon}</i><span>${x.label}</span></button>`).join('')}</span>`;
  }
  const hint = g.canPlan && g.isIdle(f) ? `<div class="hint">➤ drag to a region</div>` : '';
  const more = moreOpen ? `<div class="more">
      <div class="r"><b>${esc(c.name)}</b> <small>rank ${c.rank} · ${c.deeds.wins}W ${c.deeds.losses}L · ${c.deeds.kills}⚔</small></div>
      ${c.traits.length ? `<div class="r">${c.traits.map(t => `<span class="trait"${tip(CMD_TRAITS[t]?.desc ?? '')}>${esc(CMD_TRAITS[t]?.name ?? t)}</span>`).join('')}</div>` : ''}
      ${g.canPlan ? `<div class="r"><input data-rename value="${esc(g.pendingName(f))}" maxlength="40" aria-label="Fleet name"></div>` : ''}
      ${f.history.length ? `<div class="hist">${f.history.slice(-4).reverse().map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}</div>` : '';
  return `${head(g, f.name, g.color(f.owner), stats, `${sib}<button class="cx more-btn ${moreOpen ? 'on' : ''}" data-a="more" aria-label="More"${tip('Commander & record')}>⋯</button>`, fleetBadge(g, f), fleetSubline(g, f))}
    ${status.length ? `<div class="cst">${status.join('')}</div>` : ''}
    ${honourChoice(g, f)}${fleetSoulRows(g, f)}${postureRow(g, f)}${fateRow(g, f)}
    <div class="fan" data-fleet="${f.id}">${fan}</div>
    ${acts ? `<div class="acts">${acts}</div>` : ''}${vowPicker(g, f)}
    ${sagaChips(g, f)}${hint}${more}`;
}

function foeFleet(g: GameScreen, f: Fleet): string {
  const st = g.st;
  const counts = new Map<string, number>();
  for (const s of f.ships) counts.set(s.cls, (counts.get(s.cls) ?? 0) + 1);
  const ships = [...counts].map(([cls, n]) => `<span class="cls"${tip(st.rules.ships[cls]?.name ?? cls)}>${shipSvg(cls, g.color(f.owner), 26)}<b>×${n}</b></span>`).join('');
  const trait = f.commander.traits[f.commander.traits.length - 1];
  const stats = stat('⚔', String(fleetPower(st, f)), 'Power') + stat('⛭', String(f.ships.length), 'Ships') +
    `<span class="cmd">${esc(shortOwner(g, f.owner))}${trait ? ` · <em>${esc(CMD_TRAITS[trait]?.name ?? trait)}</em>` : ''}</span>`;
  const ps = postureStatus(g, f);
  return `${head(g, f.name, g.color(f.owner), stats, '', fleetBadge(g, f), fleetSubline(g, f))}${ps.length ? `<div class="cst">${ps.join('')}</div>` : ''}${fleetSoulRows(g, f)}<div class="fan foe">${ships}</div>${sagaChips(g, f)}`;
}
const shortOwner = (g: GameScreen, o: number | null) => g.pname(o).split(' ')[0];

function regionStats(g: GameScreen, r: Region): string {
  const st = g.st, R = st.rules;
  const gmax = r.owner !== null && r.garrison >= 0 ? maxGarrison(st, r.id) : null;
  const y = R.economy.yields[r.kind];
  const conn = r.owner !== null && R.empire?.enabled !== false ? connected(st, r.owner) : null;
  const cut = !!conn && !conn.has(r.id);
  const half = cut ? R.empire.cutOffYield : 1;
  const mult = Math.max(1, r.dev);
  const wf = worldFx(st, r);   // the old traits (star systems: carried by bodies)
  const yi = y ? Math.round((y.industry * mult + (r.buildings.mine ?? 0) * R.economy.mineBonus + (wf.forge ? R.empire.forgePerDev * mult : 0) + starIndustry(st, r)) * half) : 0;
  const yc = y ? Math.round((y.credits * mult + (r.buildings.tradehub ?? 0) * R.economy.tradeHubBonus + (wf.gas ? R.empire.gasCredits : 0)) * half) : 0;
  const yf = y ? Math.round(((r.kind === 'void' ? 0 : y.influence) + (r.kind === 'home' ? Math.floor(r.dev / 2) : 0)) * half) : 0;
  const T = r.trait ? WORLD_TRAITS[r.trait] : null, V = r.vein ? VEINS[r.vein] : null;
  let s = stat('⛨', r.garrison < 0 ? '?' : gmax !== null ? `${r.garrison}/${gmax}` : String(r.garrison), 'Garrison');
  if (r.kind !== 'void' && y) s += `<span class="st yld"${tip('Yield per turn')}><i>⚙</i><b>${yi}</b><i>¢</i><b>${yc}</b><i>✦</i><b>${yf}</b></span>`;
  const sys = sysOn(st) && !!r.bodies;
  if (r.kind !== 'void' && !sys) s += `<span class="st"${tip(`Development ${r.dev}/${maxDevAt(st, r.id)}`)}>${pips(r.dev, maxDevAt(st, r.id))}</span>`;
  if (T && !sys) s += `<span class="st"${tip(`${T.name}: ${T.desc}`)}><i>${T.icon}</i></span>`;
  if (V) s += `<span class="st"${tip(`${V.name}: ${V.desc}`)}><i style="color:${V.color}">${V.icon}</i></span>`;
  if (cut) s += `<span class="st bad"${tip('Cut off: half yield')}><i>⚠</i><b>½</b></span>`;
  return s;
}
function regionStatus(g: GameScreen, r: Region): string {
  const st = g.st, out: string[] = [];
  const e = (st.engagements ?? []).find(x => x.region === r.id);
  if (e) out.push(`<span class="war">⚔ ${esc(e.name.split(' ').slice(0, 3).join(' '))}</span>`);
  else if (st.fleets.some(f => f.siege === r.id && f.region === r.id && f.ships.length)) out.push('<span class="war">⚔ Under siege</span>');
  if (r.project) out.push(`<span>${PROJ_ICON[r.project.key] ?? '▲'} ${esc(st.rules.projects[r.project.key]?.name ?? r.project.key)} ${r.project.progress}/${st.rules.projects[r.project.key]?.turns ?? '?'}</span>`);
  if (r.relic === 'unclaimed') out.push('<span class="gold">✧ Relic</span>');
  if (g.you !== null && r.owner === g.you) {
    const agents = st.players.filter(p => p.id !== g.you && (r.loyalty[p.id] ?? 0) > 0);
    if (agents.length) out.push(`<span class="warn"${tip('Rival agents: purge with Influence')}>⚠ Agents ${agents.map(p => `${r.loyalty[p.id]}/${flipThreshold(st, r.id)}`).join(' ')}</span>`);
  }
  return out.length ? `<div class="cst">${out.join('')}</div>` : '';
}

function ownPlanet(g: GameScreen, r: Region): string {
  const st = g.st, R = st.rules, you = g.you!;
  const block = g.canPlan ? g.orderBlock() : 'not planning';
  const left = g.live ? st.players[you].res : (() => { const sp = g.plannedSpend(), p = st.players[you].res; return { industry: p.industry - sp.industry, credits: p.credits - sp.credits, influence: p.influence - sp.influence }; })();
  const ps = g.projectedState(g.nextSlot() ?? 0);
  const yard = r.buildings.shipyard ?? 0;
  let trays = '';
  if (g.canPlan) {
    if (yard) {
      const tiles = Object.entries(R.ships).map(([k, d]) => {
        const cb = classBlock(ps, you, k);
        const why = cb ?? (yard < d.needsShipyard ? `needs shipyard ${d.needsShipyard}` : null) ?? block;
        const cost = orderCost(st, { type: 'build', region: r.id, cls: k, fleet: null }, you);
        const short = !canAfford(left, cost, creditRate(st, you));
        const m = R.empire?.enabled !== false ? MODULE[blueprintFor(ps, you, k) ?? 'armor'] : null;
        return `<button class="tile ${why ? 'locked' : ''} ${short ? 'short' : ''}" data-a="build" data-cls="${k}"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip(`${d.name}: ⚔${d.attack * d.shots} ❤${d.hp} ➤${d.speed}${m ? ` · ${m.name}` : ''}`)}>${shipSvg(k, why ? '#6f6796' : g.color(you), 34)}<span class="tname">${esc(d.name)}</span><span class="tcost">${costText(cost)}</span></button>`;
      }).join('');
      trays += `<div class="tray" data-tray="build"><div class="trh">⚒ Build</div>${intoRow(g, r)}<div class="tiles">${tiles}</div></div>`;
    }
    const projects = Object.entries(R.projects).filter(([k, p]) => !(p.vein && !r.vein) && (k !== 'station' || (sysOn(st) && r.kind !== 'lane'))).map(([k, p]) => {
      const lvl = k === 'develop' ? r.dev : (r.buildings[k] ?? 0);
      const max = k === 'develop' ? maxDevAt(st, r.id) : p.max;
      const o: Order = { type: 'develop', region: r.id, project: k };
      const techLock = p.tech && !hasTech(ps, you, p.tech) ? `needs ${TECH[p.tech]?.name ?? p.tech}` : null;
      const err = techLock ?? (lvl >= max ? (k === 'develop' && sysOn(st) ? g.orderWhy(o) ?? 'maxed' : 'maxed') : null) ?? g.orderWhy(o);
      if (lvl >= max && k !== 'develop' && max > 0 && !err?.startsWith('needs')) {
        return `<button class="tile done" data-a="develop" data-proj="${k}" aria-disabled="true"${tip(`${p.name}: ${p.desc}`)}><i class="pi">${PROJ_ICON[k] ?? '▲'}</i><span class="tname">${esc(p.name.split(' ')[0])}</span>${pips(lvl, max)}</button>`;
      }
      const cost = orderCost(st, o, you);
      const short = !canAfford(left, cost, creditRate(st, you));
      // star systems: a blocked tile says why (the cap, a gate, no site, no slot) instead of its price; a discounted one says so
      const sysWhy = err && !techLock && sysOn(st) && /citizens|slot|station|site|surface|trade hub/i.test(err) ? shortWhy(err) : null;
      const disc = !err && systemCostMult(st, r, k) < 1 ? `<em class="tdisc">−${Math.round((1 - systemCostMult(st, r, k)) * 100)}%</em>` : '';
      const label = k === 'develop' && sysOn(st) && r.bodies ? 'Citizen' : p.name.split(' ')[0];
      return `<button class="tile ${err ? 'locked' : ''} ${short ? 'short' : ''} ${sysWhy ? 'why' : ''}" data-a="develop" data-proj="${k}"${err ? ` aria-disabled="true"${tip(`⊘ ${techLock ?? shortWhy(err)}`)}` : tip(`${p.name}: ${p.desc}`)}><i class="pi">${PROJ_ICON[k] ?? '▲'}</i><span class="tname">${esc(label)}</span>${max > 1 ? pips(lvl, max) : ''}${sysWhy ? `<span class="twhy">${esc(sysWhy)}</span>` : `<span class="tcost">${costText(cost)}${disc}</span>`}</button>`;
    }).join('');
    const way = sysOn(st) && r.bodies && systemCostMult(st, r, 'fortress') < 1 ? ` <span class="trway"${tip('Waystation: few citizens, so military and logistics projects are cheaper here')}>⛯ military −${Math.round((1 - systemCostMult(st, r, 'fortress')) * 100)}%</span>` : '';
    trays += `<div class="tray" data-tray="develop"><div class="trh">▲ Develop${way}</div><div class="tiles">${projects}</div></div>`;
    const agents = st.players.some(p => p.id !== you && (r.loyalty[p.id] ?? 0) > 0);
    trays += `<div class="acts">${agents ? ib('influence', '✦', 'Purge', g.orderWhy({ type: 'influence', target: r.id }), '', 'Remove rival agents') : ''}${ib('scan', '◎', 'Scan', g.orderWhy({ type: 'scan', target: r.id }), '', 'Reveal this area')}</div>`;
  }
  const cap = st.players[you]?.capital === r.id ? ' <small class="tag">capital</small>' : '';
  return `${head(g, r.name, g.color(r.owner), regionStats(g, r), cap, '', worldEpi(g, r))}${regionStatus(g, r)}${systemRows(g, r)}${worldSoulRows(g, r)}${worldSigRows(g, r)}${trays}`;
}

/** Which fleet a build at r goes into: a fleet already here, or a new banner (the founding sheet). Per region. */
const intoChoice = new Map<number, number | 'new'>();
function joinable(g: GameScreen, r: Region) {
  const pos = g.projected(g.nextSlot() ?? 0);
  return g.st.fleets.filter(x => x.owner === g.you && pos.get(x.id) === r.id && x.ships.length && x.ships.length < g.st.rules.maxShipsPerFleet && x.bornTurn !== g.st.turn);
}
function intoOf(g: GameScreen, r: Region): number | 'new' {
  const js = joinable(g, r);
  const c = intoChoice.get(r.id);
  if (c === 'new') return 'new';
  if (c !== undefined && js.some(f => f.id === c)) return c;
  return js.find(f => f.banner)?.id ?? js[0]?.id ?? 'new';
}
function intoRow(g: GameScreen, r: Region): string {
  const js = joinable(g, r);
  const cur = intoOf(g, r);
  const left = bannersLeft(g, r.id);
  const chips = js.map(f => `<button class="into ${cur === f.id ? 'on' : ''}" data-a="into" data-id="${f.id}"${tip(`Build into ${f.name}`)}>${f.banner ? bannerSvg(f.banner.sigil, g.color(f.owner), 18) : '<i>◇</i>'}<span>${esc(f.name.replace(/^The /, '').split(' ').slice(0, 2).join(' '))}</span><small>${f.ships.length}</small></button>`).join('');
  return `<div class="intos">${chips}<button class="into new ${cur === 'new' ? 'on' : ''}" data-a="into" data-id="new"${tip('Found a new fleet: a new banner')}><i>⚑</i><span>New banner</span><small class="${left.free <= 0 ? 'bad' : ''}">${Math.max(0, left.free)}/${left.limit}</small></button></div>`;
}

/** Your fleets that could seize this region right now, best odds first. */
export function seizeOptions(g: GameScreen, r: Region): Intent[] {
  if (g.you === null || !g.canPlan) return [];
  const out: Intent[] = [];
  for (const f of g.st.fleets) {
    if (f.owner !== g.you || !f.ships.length) continue;
    const it = intentFor(g, { fleet: f.id }, r.id, null, 'seize');
    if (it?.ok && (it.verb === 'seize' || it.verb === 'join')) out.push(it);
  }
  return out.sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0)).slice(0, 2);
}

function foreignPlanet(g: GameScreen, r: Region): string {
  const st = g.st;
  const owner = r.owner;
  const kindWord = ({ home: 'Capital', colony: 'Colony', crown: 'Crown', throne: 'Throne', relic: 'Relic', void: 'Void' } as Record<string, string>)[r.kind] ?? '';
  const extra = `<small class="tag" style="color:${esc(g.color(owner))}">${esc(owner === null ? kindWord : `${shortOwner(g, owner)} · ${kindWord}`)}</small>`;
  let body = '';
  if (g.canPlan && g.you !== null) {
    const opts = seizeOptions(g, r);
    body += opts.map(it => {
      const f = g.fleet(it.join?.fleet ?? (it.order as { fleet?: number } | undefined)?.fleet ?? -1);
      const pct = Math.round((it.odds ?? 0) * 100);
      const col = pct >= 65 ? 'var(--good)' : pct >= 40 ? 'var(--gold)' : 'var(--bad)';
      return `<button class="odds" data-a="seizewith" data-with="${f?.id ?? -1}"${tip(`Seize with ${f?.name ?? 'fleet'}`)}><span class="ob"><i style="width:${pct}%;background:${col}"></i></span><b style="color:${col}">⚔ ${pct}%</b><small>${esc(f ? f.name.split(' ').slice(-1)[0] : '')}</small></button>`;
    }).join('');
    const isPlayer = owner !== null && owner >= 0 && owner !== g.you;
    body += `<div class="acts">${r.kind !== 'void' ? ib('influence', '✦', 'Influence', g.orderWhy({ type: 'influence', target: r.id }), '', 'Push loyalty toward you') : ''}${ib('scan', '◎', 'Scan', g.orderWhy({ type: 'scan', target: r.id }), '', 'Reveal this area')}${ib('feint', '☍', 'Feint', g.orderWhy({ type: 'feint', target: r.id }), '', 'Fake signals toward here')}${isPlayer ? ib('pact', '⚭', 'Pact', g.orderWhy({ type: 'pact', with: owner! }), '', `Offer a pact to ${g.pname(owner)}`) : ''}</div>`;
  }
  const foes = st.fleets.filter(f => f.region === r.id && f.owner !== g.you && f.ships.length);
  const fl = foes.length ? `<div class="fan foe">${foes.map(f => `<button class="cls" data-a="fleet" data-id="${f.id}"${tip(f.name)}>${shipSvg(f.ships[0]?.cls ?? 'frigate', g.color(f.owner), 26)}<b>⚔${fleetPower(st, f)}</b></button>`).join('')}</div>` : '';
  return `${head(g, r.name, g.color(owner), regionStats(g, r), extra, '', worldEpi(g, r))}${regionStatus(g, r)}${systemRows(g, r)}${worldSoulRows(g, r)}${fl}${body}`;
}

// ---------------------------------------------------------------- events (bound once)
export function bindCard(g: GameScreen, el: HTMLElement) {
  el.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-a]');
    if (!b || !el.contains(b)) return;
    if (b.getAttribute('aria-disabled') === 'true') { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); return; }
    cardAction(g, b.dataset.a!, b.dataset, e.shiftKey);
  });
  el.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-rename]') || g.sel?.kind !== 'fleet' || !g.canPlan) return;
    const v = t.value.trim().slice(0, 40);
    if (v && v !== g.fleet(g.sel.id)?.name) g.pushFree({ type: 'rename', fleet: g.sel.id, name: v });
    g.renderAll();
  });
  el.addEventListener('keydown', e => e.stopPropagation());
  // ship fan: tap lifts a chip; dragging chips out onto the map splits them off
  el.addEventListener('pointerdown', e => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-ship]');
    if (!chip || g.sel?.kind !== 'fleet' || !g.canPlan) return;
    const fid = g.sel.id, sid = Number(chip.dataset.ship);
    const x0 = e.clientX, y0 = e.clientY, pid = e.pointerId;
    const th = e.pointerType === 'mouse' ? 6 : 10;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid || started) return;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > th) {
        started = true;
        const ids = g.lifted.has(sid) ? [...g.lifted] : [...g.lifted, sid];
        g.gest.startShipDrag(fid, ids, ev);
        cleanup();
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      cleanup();
      if (!started) { if (g.lifted.has(sid)) g.lifted.delete(sid); else g.lifted.add(sid); g.renderAll(); }
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  // phone: swipe the sheet down to dismiss
  let sw: { y: number; id: number } | null = null;
  el.addEventListener('pointerdown', e => { if (g.phone && (e.target as HTMLElement).closest('.ch, .cs') && !(e.target as HTMLElement).closest('button')) sw = { y: e.clientY, id: e.pointerId }; });
  el.addEventListener('pointermove', e => { if (sw && e.pointerId === sw.id) el.style.transform = `translateY(${Math.max(0, e.clientY - sw.y)}px)`; });
  const swEnd = (e: PointerEvent) => { if (!sw || e.pointerId !== sw.id) return; const d = e.clientY - sw.y; sw = null; el.style.transform = ''; if (d > 70) g.deselect(); };
  el.addEventListener('pointerup', swEnd);
  el.addEventListener('pointercancel', swEnd);
}

/** Card / ring / keyboard actions on the current selection. */
export function cardAction(g: GameScreen, a: string, data: DOMStringMap, shift = false) {
  const sel = g.sel;
  if (a === 'close') { g.deselect(); return; }
  if (a === 'more') { moreOpen = !moreOpen; g.renderAll(); return; }
  if (!sel) return;
  if (a === 'record' && soulAction(g, a, data)) return;
  if (a === 'into' && sel.kind === 'region') { intoChoice.set(sel.id, data.id === 'new' ? 'new' : Number(data.id)); g.renderAll(); return; }
  if (g.canPlan && (sigAction(g, a, data) || soulAction(g, a, data))) return;
  if (a === 'fleet') { g.select({ kind: 'fleet', id: Number(data.id) }); return; }
  if (a === 'sib' && sel.kind === 'fleet') {
    const f = g.fleet(sel.id); if (!f) return;
    const sibs = g.st.fleets.filter(x => x.owner === f.owner && x.region === f.region && x.ships.length);
    const i = (sibs.indexOf(f) + Number(data.d) + sibs.length) % sibs.length;
    g.select({ kind: 'fleet', id: sibs[i].id });
    return;
  }
  if (!g.canPlan) return;
  if (sel.kind === 'fleet') {
    const f = g.fleet(sel.id);
    if (!f || f.owner !== g.you) return;
    switch (a) {
      case 'fortify': g.addOrder({ type: 'fortify', fleet: f.id }); break;
      case 'scan': g.addOrder({ type: 'scan', target: f.region }); break;
      case 'feint': g.addOrder({ type: 'feint', target: f.region }); break;
      case 'influence': g.addOrder({ type: 'influence', target: f.region }); break;
      case 'conceal': g.addOrder({ type: 'conceal' }); break;
      case 'excavate': g.addOrder({ type: 'excavate', fleet: f.id }); break;
      case 'refit': g.addOrder({ type: 'refit', fleet: f.id }); break;
      case 'halt': if (g.live) g.src.liveHalt?.(f.id); else { g.pushFree({ type: 'halt', fleet: f.id }); g.renderAll(); } break;
      case 'split': {
        const lifted = f.ships.filter(s => g.lifted.has(s.id)).map(s => s.id);
        const ids = lifted.length && lifted.length < f.ships.length ? lifted : f.ships.slice(Math.ceil(f.ships.length / 2)).map(s => s.id);
        if (!ids.length) return;
        g.pushFree({ type: 'split', fleet: f.id, ships: ids });
        g.lifted.clear();
        g.renderAll();
        break;
      }
      case 'stance': {
        const x = STANCES.find(s => s.id === data.s);
        if (!x) return;
        const d = g.doctrineOf(f);
        g.pushFree({ type: 'doctrine', fleet: f.id, doctrine: { ...d, stance: x.id, retreatAt: x.retreat, guard: x.guard } });
        g.renderAll();
        break;
      }
    }
    return;
  }
  const r = g.st.regions[sel.id];
  switch (a) {
    case 'build': {
      const into = intoOf(g, r);
      const cls = data.cls!;
      if (into !== 'new') { g.addOrder({ type: 'build', region: r.id, cls, fleet: into }); break; }
      // a scout alone forms a picket (no banner); anything else raises a banner: the founding ritual (Shift: quick)
      if (cls === 'scout' || g.st.rules.soul?.enabled === false) { g.addOrder({ type: 'build', region: r.id, cls, fleet: null }); break; }
      const block = g.orderWhy({ type: 'build', region: r.id, cls, fleet: null });
      if (block && !/banner/i.test(block)) { g.addOrder({ type: 'build', region: r.id, cls, fleet: null }); break; }
      openFounding(g, { region: r.id, cls }, shift);
      break;
    }
    case 'develop': g.addOrder({ type: 'develop', region: r.id, project: data.proj! }); break;
    case 'influence': g.addOrder({ type: 'influence', target: r.id }); break;
    case 'scan': g.addOrder({ type: 'scan', target: r.id }); break;
    case 'feint': g.addOrder({ type: 'feint', target: r.id }); break;
    case 'pact': if (r.owner !== null && r.owner >= 0) g.addOrder({ type: 'pact', with: r.owner }); break;
    case 'seizewith': {
      const it = intentFor(g, { fleet: Number(data.with) }, r.id, null, 'seize');
      if (it?.ok) commitIntent(g, it);
      break;
    }
  }
  void shift;
}

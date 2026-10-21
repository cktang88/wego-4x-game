// Score modal (♛): one column per player (VP, victory track, VP sources, laws, tech pips, pacts),
// diplomacy actions on rival columns, edicts, this turn's intel signals, and the chat drawer.
import { BRANCHES, TECHS, LAWS, type Branch } from '../../../shared/config/empire.ts';
import type { Player } from '../../../shared/sim/types.ts';
import { type Ctx, ui, esc, ROMAN, pendingOrder, dropOrder, leftover, lockWhy } from './modal-util.ts';

/** VP sources, matched on vpLog reasons (shared/sim/resolve.ts addVp calls). */
const CATS: { id: string; name: string; color: string; re: RegExp }[] = [
  { id: 'crown', name: 'Crowns', color: '#ffd86b', re: /Crown|Citadel/ },
  { id: 'throne', name: 'Throne', color: '#c79bff', re: /Throne/ },
  { id: 'war', name: 'War', color: '#ff6b6b', re: /Battle honors|Bounty|capital|Warden/ },
  { id: 'relic', name: 'Relics', color: '#6ff3ff', re: /Excavated/ },
  { id: 'tech', name: 'Mandate', color: '#7dffb0', re: /Imperial Mandate/ },
  { id: 'edict', name: 'Edicts', color: '#ffa94d', re: /./ },
];
function vpBreakdown(p: Player) {
  const sums = new Map<string, number>();
  let neg = 0;
  for (const v of p.vpLog) {
    if (v.amount < 0) { neg += v.amount; continue; }
    const c = CATS.find(x => x.re.test(v.why))!;
    sums.set(c.id, (sums.get(c.id) ?? 0) + v.amount);
  }
  return { sums, neg };
}

function signalIcon(text: string): string {
  if (/movement/i.test(text)) return '➤';
  if (/jamming|hidden/i.test(text)) return '◎';
  if (/siege|battle|assault/i.test(text)) return '⚔';
  if (/build|launch|construct|shipyard/i.test(text)) return '⚒';
  if (/agent|influence|loyal/i.test(text)) return '✦';
  return '◎';
}
function signalWords(text: string): string {
  const m = /Fleet movement \((\w+)\)\s*(.*?)\s*(?:,|$)/.exec(text);
  if (m) return `${m[1]} fleet · ${m[2]}`;
  const w = text.replace(/\.$/, '').split(/\s+/);
  return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '');
}

export function scoreHead(c: Ctx): string {
  const unread = Math.max(0, c.g.src.chat.length - ui.chatSeen);
  return `<button class="mbtn m-ghost chat-b ${ui.chatOpen ? 'on' : ''}" data-a="chat-toggle" aria-expanded="${ui.chatOpen}">Chat${unread && !ui.chatOpen ? ` <span class="badge">${unread}</span>` : ''}</button>`;
}

export function scoreBody(c: Ctx): string {
  const g = c.g, st = g.st, V = st.rules.victory;
  const target = V.vpTarget;
  const cols = st.players.map(p => {
    const you = p.id === g.you;
    const { sums, neg } = vpBreakdown(p);
    const bar = CATS.filter(x => sums.get(x.id)).map(x => `<i style="width:${Math.min(100, (sums.get(x.id)! / target) * 100).toFixed(2)}%;background:${x.color}" title="${x.name} +${sums.get(x.id)}"></i>`).join('');
    const legend = CATS.filter(x => sums.get(x.id)).map(x => `<span><i style="background:${x.color}"></i>${x.name} <b>+${sums.get(x.id)}</b></span>`).join('') + (neg ? `<span class="neg">Pact <b>${neg}</b></span>` : '');
    const crowns = st.regions.filter(r => r.kind === 'crown' && r.owner === p.id).length;
    const worlds = st.regions.filter(r => r.owner === p.id).length;
    const laws = LAWS.filter(l => p.laws?.includes(l.id)).map(l => `<span class="lawi" title="${esc(l.name)}">${l.icon}</span>`).join('') || '<span class="dim">no laws</span>';
    const tech = (Object.keys(BRANCHES) as Branch[]).map(b => {
      const ts = TECHS.filter(t => t.branch === b);
      const own = ts.filter(t => p.techs?.includes(t.id));
      return `<span class="tp" style="--bc:${BRANCHES[b].color}" title="${BRANCHES[b].name}: ${own.map(t => t.name).join(', ') || 'none'}"><em>${BRANCHES[b].icon}</em>${[1, 2, 3, 4].map(tier => `<i class="${own.some(t => t.tier === tier) ? 'on' : ''}${tier === 4 ? ' star' : ''}"></i>`).join('')}</span>`;
    }).join('');
    const hold = st.crownHold?.owner === p.id ? `<div class="pc-alert">♛ All Crowns ${st.crownHold.turns}/${st.rules.crowns.holdTurnsToWin}</div>` : '';
    return `<article class="pc ${you ? 'you' : ''} ${p.eliminated ? 'out' : ''}" style="--pc:${esc(p.color)}">
      <header class="pc-h"><span class="crest"></span><b>${esc(p.name)}</b>${you ? '<small class="m-tag">YOU</small>' : p.kind === 'ai' ? '<small class="m-tag dim">AI</small>' : ''}</header>
      <div class="pc-vp"><b data-num="mvp-${p.id}">${p.vp}</b><span class="gold">♛</span>${st.winner === p.id ? '<span class="m-tag gold">WINNER</span>' : ''}</div>
      <div class="pc-track" title="${p.vp} of ${target} to win">${bar}<span>${target}</span></div>
      ${hold}
      <div class="pc-leg">${legend || '<span class="dim">no VP yet</span>'}</div>
      <div class="pc-stats"><span>Crowns <b>${crowns}</b></span><span>Worlds <b>${worlds}</b></span></div>
      <div class="pc-sub"><span class="lbl">Laws</span><span class="pc-laws">${laws}</span></div>
      <div class="pc-sub"><span class="lbl">Tech</span><span class="pc-tech">${tech}</span></div>
      ${diplo(c, p)}
    </article>`;
  }).join('');
  return `<div class="sco"><div class="sco-cols" style="--n:${st.players.length}">${cols}</div><div class="sco-row">${edictsHtml(c)}${intelHtml(c)}</div></div>${ui.chatOpen ? chatHtml(c) : ''}`;
}

function diplo(c: Ctx, p: Player): string {
  const g = c.g, st = g.st, you = g.you;
  const theirPacts = st.pacts.filter(x => x.until >= st.turn && (x.a === p.id || x.b === p.id));
  const others = theirPacts.filter(x => you === null || (x.a !== you && x.b !== you)).map(x => {
    const o = x.a === p.id ? x.b : x.a;
    return `<span class="pact">⚭ <b style="color:${esc(g.color(o))}">${esc(g.pname(o))}</b> · T${x.until}</span>`;
  }).join('');
  if (you === null || p.id === you) return others ? `<div class="pc-dip">${others}</div>` : '';
  const withYou = theirPacts.find(x => x.a === you || x.b === you);
  if (withYou) return `<div class="pc-dip"><span class="pact on">⚭ Pact · until ${g.live ? 'C' : 'T'}${withYou.until}</span>${others}</div>`;
  if (p.eliminated) return '';
  const offered = (p.prevPactOffers ?? []).includes(you) || (p.pactOffers ?? []).includes(you);
  const k = pendingOrder(g, o => o.type === 'pact' && o.with === p.id);
  const cost = st.rules.influence.pactCost;
  let act = '';
  if (k !== null) act = `<span class="lw-tag gold">⚭ Offer ${g.live ? 'next tick' : `queued · ${ROMAN[k + 1]}`}</span>${g.canPlan ? '<button class="mbtn m-ghost sm" data-a="unpact" data-id="' + p.id + '">↶ Undo</button>' : ''}`;
  else if (g.canPlan) {
    const short = leftover(g, you).influence < cost;
    act = `<button class="mbtn go ${offered ? 'hot' : ''}" data-a="pact" data-id="${p.id}"${short ? ' disabled title="Not enough influence"' : ''}>${offered ? 'Accept pact' : 'Offer pact'} <span class="cost ${short ? 'neg' : ''}">✦${cost} · 1 order</span></button>`;
  } else act = `<span class="m-why dim">${esc(lockWhy(g))}</span>`;
  return `<div class="pc-dip">${offered && k === null ? '<span class="pact hot">⚭ Offers you a pact</span>' : ''}${act}${others}</div>`;
}

function edictsHtml(c: Ctx): string {
  const g = c.g, st = g.st, T = g.live ? 'C' : 'T';
  const ed = st.edicts.map(e => `<div class="ed"><div class="ed-h"><b>${esc(e.name)}</b><span class="gold">+${e.vp} ♛</span></div><div class="ed-d">${esc(e.desc)}</div><div class="ed-t ${e.scoresTurn === st.turn ? 'now' : ''}">${e.scoresTurn === st.turn ? 'This turn' : `Judged ${T}${e.scoresTurn}`}</div></div>`).join('')
    || `<div class="dim">First edict after ${T}${st.rules.edicts.firstReveal}</div>`;
  const th = st.throne.owner !== null ? `<b style="color:${esc(g.color(st.throne.owner))}">${esc(g.pname(st.throne.owner))}</b> · streak ${st.throne.streak}` : '<span class="dim">Unclaimed</span>';
  const wd = st.wardenAwake ? (st.wardenDefeated ? '<span class="dim">Destroyed</span>' : '<b class="neg">⚠ Awake</b>') : `<span class="dim">Asleep · ${st.loreFound}/${st.rules.warden.wakeAtLore} relics</span>`;
  return `<section class="mpanel"><h3>Edicts</h3>${ed}<div class="kvl"><span>Throne</span><span>${th}</span><span>Warden</span><span>${wd}</span></div></section>`;
}

function intelHtml(c: Ctx): string {
  const g = c.g, st = g.st;
  const sig = st.last?.signals ?? [];
  const rows = sig.slice(0, 24).map(s => {
    const r = st.regions[s.region];
    return `<button class="sig ${s.confidence}" data-a="region" data-id="${Number(s.region)}" style="--pc:${esc(g.color(s.about))}"><i class="sig-dot"></i><span class="sig-ic">${signalIcon(s.text)}</span><b>${esc(r?.name ?? '?')}</b><span class="sig-tx">${esc(signalWords(s.text))}</span><span class="sig-p">${ROMAN[s.pulse] ?? ''}${s.confidence === 'inferred' ? ' ?' : ''}</span></button>`;
  }).join('');
  return `<section class="mpanel intel"><h3>◎ Intel <span class="dim">${st.last ? `${g.live ? 'tick' : 'turn'} ${st.last.tick ?? st.last.turn}` : ''}</span></h3>${rows || '<div class="dim">No signals</div>'}${sig.length > 24 ? `<div class="dim">+${sig.length - 24} more</div>` : ''}</section>`;
}

function chatHtml(c: Ctx): string {
  const g = c.g, st = g.st;
  ui.chatSeen = g.src.chat.length;
  const enter = ui.chatEnter;
  ui.chatEnter = false;
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msgs = g.src.chat.slice(-120).map(m => `<div class="cm ${m.seat === g.you ? 'me' : ''}" style="--pc:${esc(g.color(m.seat))}"><div class="cm-h"><b>${esc(m.seat === null ? 'Spectator' : g.pname(m.seat))}</b>${m.to !== null ? `<span class="dim">→ ${esc(g.pname(m.to))}</span>` : ''}<time>${time(m.at)}</time></div><div class="cm-t">${esc(m.text)}</div></div>`).join('') || '<div class="dim cm-empty">No messages</div>';
  const tos: [string, string, string][] = [['', 'All', '#cfc4ff'], ...st.players.filter(p => p.id !== g.you).map(p => [String(p.id), p.name, p.color] as [string, string, string])];
  return `<aside class="chat${enter ? ' enter' : ''}" data-a="noop"><header><b>Chat</b><button class="mx sm" data-a="chat-toggle" aria-label="Close chat">×</button></header>
    <div class="chat-log" data-keep="chat-log">${msgs}</div>
    <div class="chat-to">${tos.map(([v, n, col]) => `<button class="to ${v === ui.chatTo ? 'on' : ''}" data-a="chat-to" data-id="${esc(v)}" style="--pc:${esc(col)}">${esc(n)}</button>`).join('')}</div>
    <form class="chat-in" data-form="chat"><input data-keep="chat-msg" data-chat-msg maxlength="500" placeholder="${ui.chatTo ? `To ${esc(g.pname(Number(ui.chatTo)))} only` : 'To everyone'}" value="${esc(ui.chatDraft)}" autocomplete="off"><button class="mbtn go" type="submit">Send</button></form></aside>`;
}

export function scoreAct(c: Ctx, a: string, el: HTMLElement): boolean {
  const g = c.g, id = el.dataset.id ?? '';
  switch (a) {
    case 'pact': if (g.canPlan) { g.addOrder({ type: 'pact', with: Number(id) }); c.acted(); } return true;
    case 'unpact': {
      const k = pendingOrder(g, o => o.type === 'pact' && o.with === Number(id));
      if (k !== null && g.canPlan) { dropOrder(g, k); c.acted(); }
      return true;
    }
    case 'chat-toggle': ui.chatOpen = !ui.chatOpen; ui.chatEnter = ui.chatOpen; c.rerender(); if (ui.chatOpen) setTimeout(() => document.querySelector<HTMLInputElement>('[data-chat-msg]')?.focus(), 30); return true;
    case 'chat-to': ui.chatTo = id; c.rerender(); document.querySelector<HTMLInputElement>('[data-chat-msg]')?.focus(); return true;
  }
  return false;
}

export function sendChat(c: Ctx) {
  const t = ui.chatDraft.trim();
  if (!t) return;
  c.g.src.sendChat(t, ui.chatTo === '' ? null : Number(ui.chatTo));
  ui.chatDraft = '';
  c.rerender();
}

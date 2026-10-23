// The League ledger (docs/LOOPS.md §3.1): the same friends, many games. Self-contained modules, each with one mount
// function (integration lines in /tmp/claude-0/loops2/hooks.md):
//   mountLeaguePanel({ leagueId? })     the ledger: Table, Hall of Crowns, Rivals, Oaths and banners
//   mountLeaguePicker(host, onChange)   the lobby's "which League" choice for a new online game
//   mountLeagueResult(host, gameId)     the end-of-game card: the ledger updated, and "Again, at the same table?"
import { sigilSvg } from '../art/sigils.ts';
import { leagueApi, leagueReq, rematch, type LeagueCard, type LeagueView } from './api.ts';
import { enamel, esc, tray } from './overlay.ts';
import type { CreateGameReq } from '../../../shared/protocol.ts';

const sound = async (k: 'open' | 'close' | 'click' | 'confirm' | 'page' | 'error') => {
  try { const { audio } = await import('../audio/audio.ts'); audio.ui(k); } catch { /* sound is never the only signal */ }
};

/** The Ugly Trophy: a dented tin goblet. */
const GOBLET = '<svg class="tcl-goblet" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 3h12l-1 6.5c-.6 3.2-2.6 5-5 5.3V19h3.5v2h-9v-2H10v-4.2C7.6 14.5 5.6 12.7 5 9.5Z" fill="#8d8f95" stroke="#2c2d33" stroke-width="1"/><path d="M8.2 5.2 9.4 8l-1.6 1.2" fill="none" stroke="#2c2d33" stroke-width="1.1" stroke-linecap="round"/><path d="M7 4h4" stroke="#d9dbe0" stroke-width="1" stroke-linecap="round" opacity=".7"/></svg>';
const crown = (n = 18) => sigilSvg('crown', n, 'gold', 'tcl-crown');
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };
const plural = (n: number, w: string) => `<span class="k-num">${n}</span> ${w}${n === 1 ? '' : 's'}`;
const boss = (color: string, label = '') => `<span class="tcl-boss ${enamel(color)}" aria-hidden="true">${esc(label)}</span>`;
const house = (name: string, color: string) => `<span class="tcl-house ${enamel(color)}">${esc(name)}</span>`;

// ============================================================================ the ledger
type Tab = 'table' | 'hall' | 'rivals' | 'oaths';
const TABS: { id: Tab; label: string }[] = [{ id: 'table', label: 'Table' }, { id: 'hall', label: 'Hall of Crowns' }, { id: 'rivals', label: 'Rivals' }, { id: 'oaths', label: 'Oaths' }];

function tableTab(v: LeagueView): string {
  if (!v.members.length) return `<p class="tcl-empty k-prose">No game has ended in this League yet. When one does, its houses take their places here.</p>`;
  const rows = v.members.map((m, i) => `<li class="tcl-row">
      <span class="tcl-rank k-num" aria-label="${ordinal(i + 1)}">${i + 1}</span>${boss(m.color)}
      <span class="tcl-who"><b>${house(m.name, m.color)}</b>${m.title ? `<small class="k-prose">${esc(m.title)}</small>` : ''}</span>
      <span class="tcl-stat" title="Crowns won"><span class="tcl-crowns">${crown(16)}</span><b class="k-num">${m.wins}</b></span>
      <span class="tcl-stat" title="Games played"><small>Games</small><b class="k-num">${m.games}</b></span>
      <span class="tcl-stat tcl-wide" title="Crown worlds held at the end of games"><small>Crowns held</small><b class="k-num">${m.crowns}</b></span>
      <span class="tcl-stat" title="Exile points: what this house cost the winners from exile"><small>Exile</small><b class="k-num">${m.exilePoints ?? 0}</b></span>
      ${m.ugly ? `<span class="tcl-ugly" title="The Ugly Trophy: last place in the latest game, kept until the next one">${GOBLET}</span>` : '<span class="tcl-ugly"></span>'}
    </li>`).join('');
  const ug = v.ugly ? `<p class="tcl-note k-prose">${GOBLET}<span><b>${esc(v.ugly.name)}</b> keeps the Ugly Trophy, a dented tin goblet, from game ${v.ugly.index}, until someone else finishes last.</span></p>` : '';
  const recent = v.games.slice(-5).reverse().map(g => `<li><span class="k-engraved">${esc(g.name)}</span> <span class="k-prose">${g.winner ? `${esc(g.winner)} crowned in ${g.turns} turns` : 'no crown'}</span></li>`).join('');
  return `<ol class="tcl-rows">${rows}</ol>${ug}${recent ? `<h3 class="k-engraved">Recent games</h3><ul class="tcl-list">${recent}</ul>` : ''}`;
}

function hallTab(v: LeagueView): string {
  if (!v.hall.length) return `<p class="tcl-empty k-prose">The Hall of Crowns is empty. The first house to win a game here gets the first plaque.</p>`;
  return `<ol class="tcl-hall">${[...v.hall].reverse().map(h => `<li class="tcl-plaque ${enamel(h.color)}">
      <span class="tcl-plaque-n k-engraved">Game ${h.index}</span>
      <span class="tcl-plaque-crown">${crown(26)}</span>
      <b class="tcl-plaque-house">${esc(h.house)}</b>
      ${h.banners.length ? `<span class="tcl-plaque-banners k-prose">under ${esc(h.banners.join(', '))}</span>` : ''}
      <small class="k-prose">${esc(h.reason || 'Crowned')} <span class="k-num">${h.turns}</span> turns, <span class="k-num">${h.vp}</span> VP.</small>
    </li>`).join('')}</ol>`;
}

function rivalsTab(v: LeagueView): string {
  const name = (k: string) => v.members.find(m => m.key === k);
  const nm = (k: string) => { const m = name(k); return m ? house(m.name, m.color) : esc(k); };
  const h2h = v.headToHead.map(h => `<li class="tcl-h2h">
      <span class="tcl-vs">${nm(h.a)} <b class="k-num">${h.ahead[0]}</b><i>–</i><b class="k-num">${h.ahead[1]}</b> ${nm(h.b)}</span>
      <small class="k-prose">${h.games} game${h.games === 1 ? '' : 's'} · ships sunk <span class="k-num">${h.kills[0]}–${h.kills[1]}</span> · worlds taken <span class="k-num">${h.captures[0]}–${h.captures[1]}</span>${h.betrayals[0] + h.betrayals[1] ? ` · oaths broken <span class="k-num">${h.betrayals[0]}–${h.betrayals[1]}</span>` : ''}</small>
    </li>`).join('');
  const nem = v.nemesis.map(n => `<li class="tcl-nem"><span class="tcl-mark" aria-hidden="true"></span><span class="k-prose">${nm(n.nemesis)} is the nemesis of ${nm(n.member)}: ${plural(n.kills, 'ship')} sunk, ${plural(n.captures, 'world')} taken${n.betrayals ? `, ${plural(n.betrayals, 'oath')} broken` : ''}.</span></li>`).join('');
  const feuds = v.feuds.map(f => `<li class="tcl-feud lvl-${f.level.replace(/\s+/g, '-')}"><b class="k-engraved">${esc(f.level)}</b><span class="k-prose">${nm(f.a)} and ${nm(f.b)}: worlds taken <span class="k-num">${f.captures[0]}–${f.captures[1]}</span>, blood-debts <span class="k-num">${f.debts[0]}–${f.debts[1]}</span>${f.betrayals[0] + f.betrayals[1] ? `, oaths broken <span class="k-num">${f.betrayals[0]}–${f.betrayals[1]}</span>` : ''}, over ${f.games} game${f.games === 1 ? '' : 's'}.</span></li>`).join('');
  if (!h2h) return `<p class="tcl-empty k-prose">No rivalries yet. They start the moment a game ends.</p>`;
  return `<h3 class="k-engraved">Head to head</h3><ul class="tcl-list">${h2h}</ul>
    ${nem ? `<h3 class="k-engraved">Nemesis marks</h3><ul class="tcl-list">${nem}</ul>` : ''}
    <h3 class="k-engraved">Feuds</h3>${feuds ? `<ul class="tcl-list">${feuds}</ul>` : '<p class="tcl-empty k-prose">No feuds yet: nobody has taken from someone who took back.</p>'}`;
}

function oathsTab(v: LeagueView): string {
  const kept = v.members.map(m => `<li class="tcl-oathrow">${boss(m.color)}<span class="tcl-who">${house(m.name, m.color)}</span>
      <span class="tcl-stat" title="Vows fulfilled and pacts kept"><small>Kept</small><b class="k-num">${m.oathsKept}</b></span>
      <span class="tcl-stat${m.oathsBroken ? ' bad' : ''}" title="Vows and pacts broken"><small>Broken</small><b class="k-num">${m.oathsBroken}</b></span></li>`).join('');
  const broken = [...v.oaths].reverse().slice(0, 8).map(o => `<li class="k-slip tcl-quote"><p>“${esc(o.words)}”</p><small>${esc(o.name)} to ${esc(o.victimName)}, game ${o.index}, turn ${o.turn}. Broken.</small></li>`).join('');
  const famous = v.famous.map(f => `<li><b class="tcl-fleet">${esc(f.name)}</b>${f.epithets.length ? ` <span class="k-prose">${esc(f.epithets[f.epithets.length - 1])}</span>` : ''}<small class="k-prose"> · ${esc(f.house)}, under ${esc(f.commander)}, game ${f.index}${f.fate !== 'alive' ? ` (${esc(f.fate)})` : ''}</small></li>`).join('');
  const r = v.records;
  const recs = [
    r.biggestBattle ? `<li><small class="k-engraved">Biggest battle</small> <span class="k-prose">${esc(r.biggestBattle.name)}, <span class="k-num">${r.biggestBattle.ships}</span> ships lost</span></li>` : '',
    r.fastestCrown ? `<li><small class="k-engraved">Fastest crown</small> <span class="k-prose">${esc(r.fastestCrown.house)}, <span class="k-num">${r.fastestCrown.turns}</span> turns</span></li>` : '',
    r.mostVp ? `<li><small class="k-engraved">Most VP</small> <span class="k-prose">${esc(r.mostVp.house)}, <span class="k-num">${r.mostVp.vp}</span></span></li>` : '',
  ].join('');
  if (!kept) return `<p class="tcl-empty k-prose">No oaths sworn or broken yet. Swear one in the next game; the League will remember.</p>`;
  return `<ul class="tcl-rows">${kept}</ul>
    ${broken ? `<h3 class="k-engraved">Words not kept</h3><ul class="tcl-quotes">${broken}</ul>` : ''}
    <h3 class="k-engraved">Famous banners</h3>${famous ? `<ul class="tcl-list">${famous}</ul>` : '<p class="tcl-empty k-prose">No banner has earned a name yet. Win battles, keep vows, and one will.</p>'}
    ${recs ? `<h3 class="k-engraved">Records</h3><ul class="tcl-list">${recs}</ul>` : ''}`;
}

function detail(body: HTMLElement, v: LeagueView, back: (() => void) | null) {
  let tab: Tab = 'table';
  try { const t = localStorage.getItem('tc.league.tab') as Tab | null; if (t && TABS.some(x => x.id === t)) tab = t; } catch { /* */ }
  const draw = () => {
    const content = tab === 'table' ? tableTab(v) : tab === 'hall' ? hallTab(v) : tab === 'rivals' ? rivalsTab(v) : oathsTab(v);
    body.innerHTML = `<header class="tcl-head">${back ? '<button class="k-btn ghost tcl-back" data-l="back" aria-label="All your Leagues">‹ Leagues</button>' : ''}
        <span class="k-engraved">The League ledger</span><h2 class="k-display">${esc(v.name)}</h2>
        <p class="k-prose">${v.played} game${v.played === 1 ? '' : 's'} played${v.running.length ? ` · ${v.running.length} running` : ''}</p></header>
      <div class="k-tabs tcl-tabs" role="tablist">${TABS.map(t => `<button class="k-tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${esc(t.label)}</button>`).join('')}</div>
      <section class="tcl-pane" role="tabpanel">${content}</section>`;
  };
  draw();
  body.onclick = e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (t) { tab = t.dataset.tab as Tab; try { localStorage.setItem('tc.league.tab', tab); } catch { /* */ } void sound('page'); draw(); body.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus(); return; }
    if ((e.target as HTMLElement).closest('[data-l="back"]') && back) back();
  };
}

function waiting(body: HTMLElement, text: string) {
  body.innerHTML = `<div class="tcl-wait"><span class="tcl-candle" aria-hidden="true"></span><p class="k-prose">${esc(text)}</p></div>`;
}
function failed(body: HTMLElement, what: string, retry: () => void) {
  body.innerHTML = `<div class="tcl-wait"><p class="k-prose">${esc(what)} The game server may be unreachable; local games are unaffected.</p><button class="k-btn" data-l="retry">Try again</button></div>`;
  body.querySelector('[data-l="retry"]')!.addEventListener('click', retry);
}

/**
 * Open the League ledger. With `leagueId`, that League; otherwise the list of Leagues this browser sits in (from the
 * seat tokens it holds), each opening its ledger.
 */
export function mountLeaguePanel(opts: { leagueId?: string } = {}): { close(): void } {
  const t = tray('tcl-ledger', 'League ledger', () => void sound('close'));
  void sound('open');
  const openOne = (id: string, back: (() => void) | null) => {
    waiting(t.body, 'Opening the ledger…');
    leagueApi.get(id).then(v => { if (t.root.isConnected) detail(t.body, v, back); })
      .catch(() => { if (t.root.isConnected) failed(t.body, 'The ledger could not be fetched.', () => openOne(id, back)); });
  };
  const list = () => {
    waiting(t.body, 'Finding your Leagues…');
    leagueApi.mine().then(cards => {
      if (!t.root.isConnected) return;
      if (cards.length === 1 && !opts.leagueId) return openOne(cards[0].id, null);
      t.body.innerHTML = `<header class="tcl-head"><span class="k-engraved">The League ledger</span><h2 class="k-display">Your Leagues</h2></header>
        ${cards.length ? `<ul class="tcl-cards">${cards.map(c => `<li><button class="k-card tcl-card" data-league="${esc(c.id)}">
            <b class="k-display">${esc(c.name)}</b>
            <span class="tcl-card-houses">${c.houses.map(h => `<span>${boss(h.color)}${house(h.name, h.color)}${h.wins ? ` <span class="tcl-crowns">${crown(14)}</span><span class="k-num">${h.wins}</span>` : ''}${h.ugly ? GOBLET : ''}</span>`).join('')}</span>
            <small class="k-prose">${c.played} game${c.played === 1 ? '' : 's'} played${c.running ? ` · ${c.running} running` : ''}${c.lastWinner ? ` · last crowned: ${esc(c.lastWinner)}` : ''}</small>
          </button></li>`).join('')}</ul>`
        : '<p class="tcl-empty k-prose">No League yet. Play an online game to its end and its table becomes a League; play again at the same table and the ledger keeps the score.</p>'}`;
      t.body.onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-league]'); if (b) { void sound('click'); openOne(b.dataset.league!, list); } };
    }).catch(() => { if (t.root.isConnected) failed(t.body, 'Your Leagues could not be fetched.', list); });
  };
  if (opts.leagueId) openOne(opts.leagueId, null); else list();
  return { close: t.close };
}

// ============================================================================ the lobby picker
/**
 * The "which League" choice for a new online game: a new League (the default) or one this browser sits in.
 * `onChange` gets the `league` field for POST /api/games (undefined = a new League). Renders nothing if the
 * browser sits in no League.
 */
export function mountLeaguePicker(host: HTMLElement, onChange: (league: CreateGameReq['league']) => void): { destroy(): void; value(): CreateGameReq['league'] } {
  const el = document.createElement('div');
  el.className = 'tcl-picker';
  host.appendChild(el);
  let cards: LeagueCard[] = [];
  let chosen: LeagueCard | null = null;
  const value = () => leagueReq(chosen);
  const draw = () => {
    if (!cards.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<span class="k-engraved" id="tcl-pick-l">League</span>
      <div class="k-seg tcl-seg" role="group" aria-labelledby="tcl-pick-l">
        <button type="button" data-pick="" aria-pressed="${!chosen}">New League</button>
        ${cards.map(c => `<button type="button" data-pick="${esc(c.id)}" aria-pressed="${chosen?.id === c.id}" title="${esc(c.name)}: ${c.played} games">${esc(c.houses.map(h => h.name).slice(0, 3).join(' · ') || c.name)}</button>`).join('')}
      </div>`;
  };
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    if (!b) return;
    chosen = cards.find(c => c.id === b.dataset.pick) ?? null;
    void sound('click');
    draw();
    onChange(value());
  });
  leagueApi.mine().then(c => { cards = c; draw(); }).catch(() => { /* offline: a new League, silently */ });
  return { destroy: () => el.remove(), value };
}

// ============================================================================ end of game
/**
 * The end-of-game card: the League this game counted for, the Hall of Crowns plaque it added, who carries the Ugly
 * Trophy, and two buttons ("Again, at the same table?" and the ledger). Renders nothing for games outside a League.
 * `onRematch` gets the new game's id (default: open it).
 */
export function mountLeagueResult(host: HTMLElement, gameId: string, onRematch: (id: string) => void = id => { location.hash = `#/g/${encodeURIComponent(id)}`; }): { destroy(): void } {
  const el = document.createElement('section');
  el.className = 'k-card riveted tcl-result';
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  host.appendChild(el);
  let gone = false;
  (async () => {
    const id = await leagueApi.leagueOf(gameId);
    if (!id || gone) return;
    let v: LeagueView | null = null;
    // the server records the game as it ends; allow a moment for a slow disk
    for (let i = 0; i < 4 && !gone; i++) {
      v = await leagueApi.get(id).catch(() => null);
      if (v?.games.some(g => g.game === gameId)) break;
      await new Promise(r => setTimeout(r, 700));
    }
    if (!v || gone) return;
    const idx = v.games.findIndex(g => g.game === gameId);
    const plaque = v.hall.find(h => h.game === gameId);
    const crowns = plaque ? v.hall.filter(h => h.member === plaque.member).length : 0;
    el.hidden = false;
    el.innerHTML = `<span class="k-engraved">Entered in the ledger</span><h3 class="k-display">${esc(v.name)}</h3>
      ${plaque ? `<p class="tcl-res-line">${crown(20)}<span class="k-prose"><b>${house(plaque.house, plaque.color)}</b> takes ${crowns === 1 ? 'a first' : `a ${ordinal(crowns)}`} crown${idx >= 0 ? ` in game ${idx + 1}` : ''}.</span></p>` : ''}
      ${v.ugly && v.ugly.game === gameId ? `<p class="tcl-res-line">${GOBLET}<span class="k-prose"><b>${esc(v.ugly.name)}</b> takes the Ugly Trophy home.</span></p>` : ''}
      ${v.feuds[0] ? `<p class="tcl-res-line"><span class="tcl-mark" aria-hidden="true"></span><span class="k-prose">${esc(v.members.find(m => m.key === v!.feuds[0].a)?.name ?? '')} and ${esc(v.members.find(m => m.key === v!.feuds[0].b)?.name ?? '')}: ${v.feuds[0].level === 'blood feud' ? 'a blood feud now' : v.feuds[0].level === 'bitter' ? 'the feud turns bitter' : 'the feud simmers on'}.</span></p>` : ''}
      <div class="tcl-res-btns"><button class="k-btn primary" data-l="again">Again?</button><button class="k-btn" data-l="ledger">The ledger</button></div>`;
    el.querySelector('[data-l="again"]')!.setAttribute('title', 'Again, at the same table: the same seats, the same galaxy, the same League');
  })().catch(() => { /* decoration: never in the way of the end screen */ });
  el.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-l]');
    if (!b) return;
    if (b.dataset.l === 'ledger') { const id = await leagueApi.leagueOf(gameId); if (id) mountLeaguePanel({ leagueId: id }); return; }
    if (b.dataset.l === 'again') {
      (b as HTMLButtonElement).disabled = true;
      b.textContent = 'Setting the table…';
      try { const id = await rematch(gameId); void sound('confirm'); onRematch(id); }
      catch (err) {
        void sound('error');
        (b as HTMLButtonElement).disabled = false;
        b.textContent = 'Again?';
        const p = document.createElement('p');
        p.className = 'tcl-err k-prose';
        p.textContent = `The table could not be set: ${(err as Error).message}. Try again.`;
        el.querySelector('.tcl-err')?.remove();
        el.appendChild(p);
      }
    }
  });
  return { destroy: () => { gone = true; el.remove(); } };
}

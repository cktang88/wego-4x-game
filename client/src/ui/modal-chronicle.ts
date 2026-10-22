// Chronicle modal (☰): a timeline, newest turn first. Each turn: ▶ replay, its battles (open the
// battle viewer), and its entries as icon + first sentence (click to read the rest).
import type { BattleReport, ChronicleEntry } from '../../../shared/sim/types.ts';
import { BODIES, STATION } from '../../../shared/config/systems.ts';
import { bodyKindAt, taggedBodyName } from '../../../shared/sim/systems.ts';
import { openBattleViewer } from '../render/battle.ts';
import { type Ctx, ui, esc } from './modal-util.ts';
import { ic, icFor } from '../art/icons.ts';

const sentence = (t: string) => { const m = /^(.+?[.!?])(\s|$)/.exec(t); return m ? m[1] : t; };
function clip(t: string, words = 10): { short: string; more: boolean } {
  const s = sentence(t);
  const w = s.split(/\s+/);
  if (w.length <= words + 2) return { short: s, more: s.length < t.length };
  return { short: w.slice(0, words).join(' ') + '…', more: true };
}
function entryIcon(e: ChronicleEntry): string {
  const t = e.text;
  if (/^Refugees/.test(t)) return '⇢';
  if (/\brouts\b|limps for home/i.test(t)) return '⤺';
  if (/tribute/i.test(t)) return '⚖';
  if (/battle|ends after|ships destroyed|held the field|defenders held|razes/i.test(t)) return '⚔';
  if (/takes .* from|claims|breaks its pact|is no more/i.test(t)) return '⚔';
  if (/defects|joins .* without/i.test(t)) return '✦';
  if (/pact/i.test(t)) return '✦';
  if (/enacts|repeal/i.test(t)) return '⚑';
  if (/completes|steals|researched|archives/i.test(t)) return '✺';
  if (/edict|judged/i.test(t)) return '♛';
  if (/unearths|relic|fragment/i.test(t)) return '♛';
  if (/Warden|CROWNS/i.test(t)) return '⚠';
  return '•';
}
const isBattle = (e: ChronicleEntry) => entryIcon(e) === '⚔';

/** Battle reports of a turn: the latest from state, older ones from history (WEGO; fetched lazily). */
function battlesOf(c: Ctx, turn: number): BattleReport[] | null {
  const g = c.g, st = g.st;
  if (st.last && st.last.turn === turn) return st.last.battles;
  if (g.live) return [];
  const key = `${st.id}:${st.seed}`;
  if (ui.histKey !== key) { ui.hist.clear(); ui.histKey = key; }
  const h = ui.hist.get(turn);
  if (h === 'loading') return null;
  if (h !== undefined) return h?.battles ?? [];
  ui.hist.set(turn, 'loading');
  Promise.resolve(g.src.history(turn)).then(r => { ui.hist.set(turn, r ?? null); c.rerender(); }, () => { ui.hist.set(turn, null); });
  return null;
}

export const CHRON_FILTERS: [string, string][] = [['all', 'All'], ['battles', '⚔ Battles'], ['mine', 'My empire']];

export function chronicleHead(c: Ctx): string {
  const soul = !!c.g.st.soul;
  const extra = soul ? `<button class="mbtn m-ghost sm herald-b" data-a="herald" title="The Herald: front pages">✒ Herald</button><button class="mbtn m-ghost sm saga-b" data-a="saga" title="The Saga so far">⚜ Saga</button>` : '';
  return `${extra}<div class="mh-seg" role="tablist">${CHRON_FILTERS.map(([id, n], i) => `<button class="m-seg ${ui.chronFilter === id ? 'on' : ''}" data-a="chron-f" data-id="${id}" role="tab" aria-selected="${ui.chronFilter === id}"><kbd>${i + 1}</kbd>${n}</button>`).join('')}</div>`;
}

export function chronicleBody(c: Ctx): string {
  const g = c.g, st = g.st, f = ui.chronFilter, T = g.live ? 'Cycle' : 'Turn';
  const latest = st.last?.turn ?? st.turn - 1;
  const byTurn = new Map<number, ChronicleEntry[]>();
  st.chronicle.forEach(e => { if (!byTurn.has(e.turn)) byTurn.set(e.turn, []); byTurn.get(e.turn)!.push(e); });
  const turns = [...new Set([...byTurn.keys(), ...(latest >= 1 ? [latest] : [])])].sort((a, b) => b - a).slice(0, 40);
  const rows = turns.map((turn, ti) => {
    let es = (byTurn.get(turn) ?? []).map((e, i) => ({ e, i }));
    if (f === 'battles') es = es.filter(x => isBattle(x.e));
    if (f === 'mine') es = es.filter(x => g.you !== null && x.e.players.includes(g.you));
    // battles: only fetch for the most recent turns (the list is long)
    const bs = ti < 8 ? battlesOf(c, turn) : [];
    const bsShown = (bs ?? []).filter(b => f !== 'mine' || (g.you !== null && b.sides.some(s => s.owner === g.you)));
    if (!es.length && !bsShown.length && turn !== latest) return '';
    const battles = bs === null ? '<span class="dim">Loading battles…</span>' : bsShown.map(b => {
      const lost = Object.values(b.losses).reduce((a, n) => a + n, 0);
      const w = b.winner;
      return `<button class="bchip" data-a="battle" data-id="${b.id}" data-turn="${turn}" style="--pc:${esc(w === null ? '#a59ccc' : g.color(w))}" title="${esc(b.name)}"><span class="bchip-ic">⚔</span><b>${esc(b.name.replace(/^(The )?Battle (of|for) /i, ''))}</b><span class="dim">${b.sides.map(s => `<i class="dot" style="background:${esc(g.color(s.owner))}"></i>`).join('')}${lost ? ` −${lost}` : ''}</span></button>`;
    }).join('');
    const entries = es.map(({ e, i }) => {
      const k = `${turn}:${i}`;
      const open = ui.chronOpen.has(k);
      const { short, more } = clip(e.text);
      const col = e.players.length === 1 ? g.color(e.players[0]) : e.players.length === 2 ? g.color(e.players[0]) : 'var(--m-line2)';
      // star systems: the body it happened on, with its tag once earned ("Vel II, the Burned World")
      const reg = e.region !== undefined ? st.regions[e.region] : undefined;
      const bk = reg && e.body !== undefined ? bodyKindAt(reg, e.body) : null;
      const bodyChip = reg && bk ? `<span class="ce-body" title="${esc(`${taggedBodyName(st, reg, e.body!)} (${reg.name})`)}"><i>${ic(bk === 'station' ? 'station' : icFor('body', bk, BODIES[bk].icon))}</i>${esc(taggedBodyName(st, reg, e.body!))}</span>` : '';
      return `<div class="ce ${e.major ? 'major' : ''} ${open ? 'open' : ''}" style="--pc:${esc(col)}"><button class="ce-b" data-a="chron-x" data-id="${k}"${more ? '' : ' data-static'}><span class="ce-ic">${entryIcon(e)}</span><span class="ce-t">${esc(open ? e.text : short)}${bodyChip}</span>${more ? `<span class="ce-more">${open ? '−' : '+'}</span>` : ''}</button>${e.region !== undefined ? `<button class="ce-go" data-a="region" data-id="${e.region}" title="Show on map" aria-label="Show on map">◎</button>` : ''}</div>`;
    }).join('');
    return `<section class="ct"><header class="ct-h"><span class="ct-n"><small>${T}</small><b>${turn}</b></span><button class="mbtn m-ghost sm" data-a="replay" data-id="${turn}" title="Replay ${T.toLowerCase()} ${turn}">▶ Replay</button></header>${battles ? `<div class="ct-bs">${battles}</div>` : ''}
      ${entries ? `<div class="ct-es">${entries}</div>` : bsShown.length ? '' : `<div class="ct-es"><div class="dim ce-quiet">Quiet</div></div>`}</section>`;
  }).join('');
  return `<div class="chron">${rows || '<div class="m-empty">The chronicle is empty</div>'}</div>`;
}

export function chronicleAct(c: Ctx, a: string, el: HTMLElement): boolean {
  const g = c.g, id = el.dataset.id ?? '';
  switch (a) {
    case 'herald': c.close(); g.openHerald?.(); return true;
    case 'saga': c.close(); g.openSaga?.(); return true;
    case 'chron-f': ui.chronFilter = id as typeof ui.chronFilter; c.rerender(); return true;
    case 'chron-x': if (el.hasAttribute('data-static')) return true; if (ui.chronOpen.has(id)) ui.chronOpen.delete(id); else ui.chronOpen.add(id); c.rerender(); return true;
    case 'replay': c.close(); g.replayTurn?.(Number(id)); return true;
    case 'battle': {
      const bid = Number(id), turn = Number(el.dataset.turn);
      const st = g.st;
      if (st.last && st.last.turn === turn && g.openBattle) { g.openBattle(bid); return true; }
      const h = ui.hist.get(turn);
      const rep = h && h !== 'loading' ? h.battles.find(b => b.id === bid) : st.last?.battles.find(b => b.id === bid);
      if (!rep) return true;
      openBattleViewer(rep, {
        rules: st.rules, you: g.you, live: g.live, regionName: r => st.regions[r]?.name ?? '?', playerColor: o => g.color(o),
        playerName: o => o === -1 ? (rep.sides.some(x => x.owner === -1 && x.fleets.length) ? 'The Warden' : 'Neutral garrison') : g.pname(o),
      });
      return true;
    }
  }
  return false;
}

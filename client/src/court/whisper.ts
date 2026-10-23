// The exile's panel: a fallen house still at the table. Whisper to the Warden (it hunts that house, if it is near
// the lead), cast a ghost vote at the Throne (a little influence a turn, and exact VP ties), and watch the Exile
// points: what the marked house has lost. Only points against the eventual winner count.
import type { FreeAction, PlayerId } from '../../../shared/sim/types.ts';
import { CR, exileBlock } from '../../../shared/sim/court.ts';
import { ic } from '../art/icons.ts';
import { esc, houseName, crest, turnWord, shell, pendingOf, type CourtMount, type CourtProps, type CourtHandlers } from './util.ts';

export type WhisperPanelProps = CourtProps;
const isExile = (fa: FreeAction) => fa.type === 'exile';

/** Is `you` in exile (so the panel has something to show)? */
export const exileDue = (p: CourtProps) => !!p.st.court?.exiles.some(e => e.p === p.you);

/** Mount the exile's whisper panel into `host`. */
export function mountWhisperPanel(host: HTMLElement, props: WhisperPanelProps, h: CourtHandlers): CourtMount<WhisperPanelProps> {
  const paint = (el: HTMLElement, p: WhisperPanelProps) => {
    const { st, you } = p;
    const e = st.court?.exiles.find(x => x.p === you);
    el.setAttribute('aria-label', 'In exile');
    if (!e) { el.innerHTML = `<p class="ct-empty">Your house still stands. The Warden does not listen to the living.</p>`; return; }
    const K = CR(st);
    const can = p.canPlan !== false && st.winner === null;
    const pend = pendingOf(p, isExile) as Extract<FreeAction, { type: 'exile' }> | undefined;
    const whisper = pend?.whisper ?? e.whisper;
    const vote = pend?.vote ?? e.vote;
    const live = st.players.filter(x => !x.eliminated && x.id !== you);
    const top = Math.max(0, ...live.map(x => x.vp));
    const btn = (q: PlayerId, kind: 'whisper' | 'vote', on: boolean) => {
      const far = kind === 'whisper' && st.players[q].vp < top - K.whisperGap;
      const why = can ? exileBlock(st, you, kind === 'whisper' ? q : undefined, kind === 'vote' ? q : undefined) : 'the game is over';
      return `<button type="button" class="ct-pick${on ? ' on' : ''}" data-kind="${kind}" data-p="${q}" aria-pressed="${on}" ${why ? `aria-disabled="true" title="${esc(why)}"` : ''}>
        ${crest(st, q, 30)}<span class="ct-pick-name">${houseName(st, q)}</span><span class="ct-pick-vp"><span class="k-num">${st.players[q].vp}</span> VP</span>
        ${far ? `<small class="ct-pick-note">Too far behind: the Warden ignores it</small>` : on ? `<small class="ct-pick-note">${kind === 'whisper' ? 'Marked' : 'Your vote'}</small>` : ''}</button>`;
    };
    const tally = st.players.filter(x => x.id !== you).map(x => `<li>${crest(st, x.id, 16)} ${houseName(st, x.id)} <b class="k-num">${e.tally[x.id] ?? 0}</b></li>`).join('');
    const warden = st.wardenDefeated ? 'The Warden is destroyed. Your mark still pays Exile points.'
      : st.wardenAwake ? 'The Warden is awake. It hunts the house you mark.'
      : 'The Warden sleeps. Your mark still pays Exile points; when it wakes, it hunts your mark.';
    el.innerHTML = `
      <header class="ct-head"><span class="k-engraved">${ic('ghost')} In exile</span><small class="ct-sub">since ${turnWord(st, e.since)}</small></header>
      <p class="ct-prose">${houseName(st, you)} has no worlds and no fleets. It still has a voice.</p>
      <h4 class="ct-h4">${ic('eye')} Whisper to the Warden</h4>
      <p class="ct-why">${esc(warden)} Every ship your mark loses is <b class="k-num">${K.exileShipPts}</b> point, every world <b class="k-num">${K.exileWorldPts}</b>; the Warden's work counts double.</p>
      <div class="ct-picks" role="group" aria-label="Whisper to the Warden">${live.map(x => btn(x.id, 'whisper', whisper === x.id)).join('')}</div>
      <h4 class="ct-h4">${ic('throne')} Ghost vote</h4>
      <p class="ct-why">That house gains <b class="k-num">+${K.ghostInfluence}</b> influence a turn, and wins an exact tie on VP.</p>
      <div class="ct-picks" role="group" aria-label="Ghost vote">${live.map(x => btn(x.id, 'vote', vote === x.id)).join('')}</div>
      <h4 class="ct-h4">${ic('skull')} Exile points</h4>
      <ul class="ct-tally">${tally}</ul>
      <p class="ct-why">${e.points !== undefined ? `Final: <b class="k-num">${e.points}</b>, against the winner.` : 'Only the points against the winner count, in the Saga and the League.'}</p>
      ${pend ? `<div class="ct-chosen" role="status">${ic('ghost')}<span>Your whisper reaches the Warden at the next turn.</span>${can && h.onClear ? `<button type="button" class="k-btn ghost" data-act="undo">${ic('undo')} Undo</button>` : ''}</div>` : ''}`;
  };
  const wire = (el: HTMLElement, get: () => WhisperPanelProps) => {
    const onClick = (ev: MouseEvent) => {
      const b = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      if (b.dataset.act === 'undo') { h.onClear?.(isExile); return; }
      const q = Number(b.dataset.p);
      if (!Number.isInteger(q)) return;
      // one exile action carries both choices: keep the other one already in the plan
      const prev = pendingOf(get(), isExile) as Extract<FreeAction, { type: 'exile' }> | undefined;
      const fa: FreeAction = b.dataset.kind === 'whisper'
        ? { type: 'exile', whisper: q, ...(prev?.vote !== undefined ? { vote: prev.vote } : {}) }
        : { type: 'exile', vote: q, ...(prev?.whisper !== undefined ? { whisper: prev.whisper } : {}) };
      h.onAction(fa);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  };
  return shell(host, 'ct-card k-card ct-whisper', props, paint, wire);
}

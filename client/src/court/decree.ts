// The Coronation decree: a new Throne holder; every rival answers in public before the countdown ends.
// Kneel (an engraved brass plate): influence now, but striking the holder later costs VP.
// Defy (a wax seal, irreversible and printed in the Herald): free. No answer by the deadline = Defy.
// The holder (and a house that already answered) sees the countdown and every answer so far.
import type { FreeAction, PlayerId } from '../../../shared/sim/types.ts';
import { CR, decreeBlock } from '../../../shared/sim/court.ts';
import { ic } from '../art/icons.ts';
import { esc, houseName, crest, turnWord, shell, pendingOf, type CourtMount, type CourtProps, type CourtHandlers } from './util.ts';

export type DecreePromptProps = CourtProps;
const isDecree = (fa: FreeAction) => fa.type === 'decree';

/** Is there a Coronation `you` should see (as a rival who may answer, or as the holder)? */
export function decreeDue(p: CourtProps): boolean {
  const cr = p.st.court?.coronation;
  return !!cr && !p.st.players[p.you]?.eliminated;
}

/** Mount the decree prompt into `host`. */
export function mountDecreePrompt(host: HTMLElement, props: DecreePromptProps, h: CourtHandlers): CourtMount<DecreePromptProps> {
  let armed = false;
  const paint = (el: HTMLElement, p: DecreePromptProps) => {
    const { st, you } = p;
    const cr = st.court?.coronation;
    el.setAttribute('aria-label', 'The Coronation');
    if (!cr) { el.innerHTML = `<p class="ct-empty">The Throne asks nothing of anyone this turn.</p>`; return; }
    const K = CR(st);
    const can = p.canPlan !== false;
    const left = Math.max(0, cr.until - st.turn + 1);
    const pend = pendingOf(p, isDecree) as Extract<FreeAction, { type: 'decree' }> | undefined;
    const mine = cr.answers[you] ?? null;
    const holder = you === cr.holder;
    const why = !can ? 'your orders are sealed' : decreeBlock(st, you, 'kneel');
    const rivals = st.players.filter(x => x.id !== cr.holder && !x.eliminated).map(x => x.id as PlayerId);
    const answerTok = (q: PlayerId) => {
      const a = cr.answers[q];
      const cls = a === 'kneel' ? 'warn' : a === 'defy' ? 'bad' : '';
      const word = a === 'kneel' ? 'Kneels' : a === 'defy' ? 'Defies' : 'Silent';
      return `<li>${crest(st, q, 18)} ${houseName(st, q)} <span class="k-token ${cls}"><span class="boss">${ic(a === 'kneel' ? 'crown' : a === 'defy' ? 'fist' : 'hourglass')}</span>${word}</span></li>`;
    };
    const pips = Array.from({ length: K.decreeTurns }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('');
    const top = `<header class="ct-head"><span class="k-engraved">${ic('throne')} The Coronation</span><span class="ct-clock" title="Answers close at the end of ${turnWord(st, cr.until)}">${ic('hourglass')}<span class="ct-pips" aria-hidden="true">${pips}</span><span class="k-num">${left}</span></span></header>
      <div class="ct-procl">${crest(st, cr.holder, 40)}<div><h3 class="ct-name">${houseName(st, cr.holder)} holds the Hollow Throne</h3>
      <p class="ct-sub">${holder ? 'Every rival must Kneel or Defy, in public.' : `Answer by the end of ${turnWord(st, cr.until)}. Silence is Defiance.`}</p></div></div>`;
    const list = `<ul class="ct-answers" aria-label="Answers so far">${rivals.map(answerTok).join('')}</ul>`;
    if (holder || mine) {
      el.innerHTML = `${top}${mine ? `<p class="ct-note">${ic(mine === 'kneel' ? 'crown' : 'fist')} You ${mine === 'kneel' ? 'knelt' : 'defied'}. The Herald has printed it.</p>` : ''}${list}`;
      return;
    }
    let choices: string;
    if (pend) {
      choices = `<div class="ct-chosen ${pend.answer === 'defy' ? 'grim' : ''}" role="status">${ic(pend.answer === 'kneel' ? 'crown' : 'fist')}<span>${pend.answer === 'kneel' ? `You kneel at the seal (+${K.kneelInfluence} influence).` : 'You defy at the seal.'}</span>${can && h.onClear ? `<button type="button" class="k-btn ghost" data-act="undo">${ic('undo')} Undo</button>` : ''}</div>`;
    } else {
      choices = `<div class="ct-choices two" role="group" aria-label="Kneel or Defy">
        <div class="ct-choice">
          <button type="button" class="k-btn primary" data-act="kneel" ${why ? `aria-disabled="true" title="${esc(why)}"` : ''}>${ic('crown')} Kneel</button>
          <small class="ct-why"><b class="k-num">+${K.kneelInfluence}</b> influence now. Strike ${houseName(st, cr.holder)} while it reigns: <b class="k-num">−${K.kneelBreakVp}</b> VP.</small>
        </div>
        <div class="ct-choice ct-exec">
          <button type="button" class="k-seal${armed ? ' armed' : ''}" data-act="defy" aria-label="${armed ? 'Press again to defy' : 'Defy (public, cannot be undone)'}" ${why ? `aria-disabled="true" title="${esc(why)}"` : ''}>${ic('fist')}</button>
          <small class="ct-why">${armed ? '<b>Press the seal again.</b> ' : ''}Defy: free, and printed in the Herald.</small>
        </div>
      </div>`;
    }
    el.innerHTML = `${top}${choices}${list}`;
  };
  const wire = (el: HTMLElement, get: () => DecreePromptProps) => {
    const onClick = (ev: MouseEvent) => {
      const b = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      const act = b.dataset.act;
      if (act === 'undo') { armed = false; h.onClear?.(isDecree); return; }
      if (act === 'kneel') { armed = false; h.onAction({ type: 'decree', answer: 'kneel' }); return; }
      if (act === 'defy') {
        if (!armed) { armed = true; paint(el, get()); (el.querySelector('.k-seal') as HTMLElement | null)?.focus(); return; }
        armed = false;
        el.querySelector('.k-seal')?.classList.add('stamped');
        h.onAction({ type: 'decree', answer: 'defy' });
      }
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && armed) { armed = false; paint(el, get()); } };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); };
  };
  return shell(host, 'ct-card k-card ct-decree', props, paint, wire);
}

// The ransom letter (the owner's decision): the captor's terms for one of your commanders. Pay (the commander comes
// home at the seal) or Refuse (the captor decides again: ransom, turn or execute). With no terms yet, it says what
// the captor may do and when the prisoner walks free anyway.
import type { FreeAction } from '../../../shared/sim/types.ts';
import { ransomBlock } from '../../../shared/sim/court.ts';
import { ic } from '../art/icons.ts';
import { esc, houseName, crest, turnWord, rankWord, shell, pendingOf, type CourtMount, type CourtProps, type CourtHandlers } from './util.ts';

export interface RansomOfferProps extends CourtProps {
  /** Your captured commander (GameState.court.captives[].id). */
  captiveId: number;
}

const isMine = (id: number) => (fa: FreeAction) => fa.type === 'ransom' && fa.id === id;

/** Mount the ransom letter into `host`. */
export function mountRansomOffer(host: HTMLElement, props: RansomOfferProps, h: CourtHandlers): CourtMount<RansomOfferProps> {
  const paint = (el: HTMLElement, p: RansomOfferProps) => {
    const { st, you } = p;
    const c = st.court?.captives.find(x => x.id === p.captiveId);
    el.setAttribute('aria-label', 'Ransom terms');
    if (!c || c.owner !== you) { el.innerHTML = `<p class="ct-empty">No letter waits for you.</p>`; return; }
    const can = p.canPlan !== false;
    const pend = pendingOf(p, isMine(c.id)) as Extract<FreeAction, { type: 'ransom' }> | undefined;
    const o = c.offer && c.offer.turn < st.turn ? c.offer : null;
    const have = Math.max(0, st.players[you].res[o?.res ?? 'credits']);
    const unit = (r: string, n: number) => (r === 'credits' ? `<span class="k-num">${n}</span>¢` : `<span class="k-num">${n}</span> influence`);
    const payWhy = !o ? 'no terms yet' : !can ? 'your orders are sealed' : ransomBlock(st, you, c.id, true);
    const head = `<header class="ct-letterhead">${crest(st, c.captor, 26)}<div><span class="ct-from">From the court of</span> ${houseName(st, c.captor)}</div></header>`;
    let body: string;
    if (!o) {
      body = `<p class="ct-letter-p">We hold <b>${esc(c.cmd.name)}</b>, ${rankWord(c.cmd.rank).toLowerCase()} of your house, taken when ${esc(c.fleet)} fell.</p>
        <p class="ct-letter-p">${c.offer ? 'Our terms will reach you next turn.' : 'We have not yet named our terms.'} We may ransom, turn or execute ${esc(c.cmd.name)}. If we do nothing, ${esc(c.cmd.name)} walks free at the end of ${turnWord(st, c.until)}.</p>`;
    } else {
      body = `<p class="ct-letter-p">For the return of <b>${esc(c.cmd.name)}</b>, ${rankWord(c.cmd.rank).toLowerCase()} of your house, we ask:</p>
        <p class="ct-terms">${unit(o.res, o.amount)}</p>
        <p class="ct-letter-p small">Refuse, and we decide again. Unpaid, ${esc(c.cmd.name)} walks free at the end of ${turnWord(st, c.until)}, if still alive.</p>`;
    }
    let foot = '';
    if (pend) {
      foot = `<div class="ct-chosen ${pend.pay ? '' : 'grim'}" role="status">${ic(pend.pay ? 'purse' : 'close')}<span>${pend.pay ? `Paying at the seal.` : 'Refusing the terms.'}</span>${can && h.onClear ? `<button type="button" class="k-btn ghost" data-act="undo">${ic('undo')} Undo</button>` : ''}</div>`;
    } else if (o) {
      foot = `<div class="ct-actions">
        <button type="button" class="k-btn primary" data-act="pay" ${payWhy ? `aria-disabled="true" title="${esc(payWhy)}"` : ''}>${ic('purse')} Pay ${unit(o.res, o.amount)}</button>
        <button type="button" class="k-btn ghost" data-act="refuse" ${can ? '' : 'aria-disabled="true"'}>${ic('close')} Refuse</button>
      </div>
      <small class="ct-why">${payWhy ? esc(payWhy) : `You have ${unit(o.res, have)}.`}</small>`;
    }
    el.innerHTML = `<div class="ct-letter">${head}${body}${foot}</div>`;
  };
  const wire = (el: HTMLElement, get: () => RansomOfferProps) => {
    const onClick = (ev: MouseEvent) => {
      const b = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      const id = get().captiveId;
      if (b.dataset.act === 'undo') h.onClear?.(isMine(id));
      else if (b.dataset.act === 'pay') h.onAction({ type: 'ransom', id, pay: true });
      else if (b.dataset.act === 'refuse') h.onAction({ type: 'ransom', id, pay: false });
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  };
  return shell(host, 'ct-card ct-ransom', props, paint, wire);
}

// The captive card (the captor's decision): Ransom (name the currency), Turn (pay influence), or Execute (a wax
// seal, pressed twice: it cannot be undone once the turn resolves). One decision a turn; the clock sends the
// prisoner home free if nobody decides.
import type { FreeAction, RansomRes } from '../../../shared/sim/types.ts';
import { ransomPrice, turnPrice, captiveBlock, CR } from '../../../shared/sim/court.ts';
import { SCARS } from '../../../shared/config/content.ts';
import { ic } from '../art/icons.ts';
import { portraitImg } from '../art/portraits.ts';
import { esc, houseName, crest, turnWord, rankWord, shell, pendingOf, type CourtMount, type CourtProps, type CourtHandlers } from './util.ts';

export interface CaptiveCardProps extends CourtProps {
  /** The captive (GameState.court.captives[].id) this card is about. */
  captiveId: number;
}

const isMine = (id: number) => (fa: FreeAction) => fa.type === 'captive' && fa.id === id;

/** Mount the captive card into `host`. */
export function mountCaptiveCard(host: HTMLElement, props: CaptiveCardProps, h: CourtHandlers): CourtMount<CaptiveCardProps> {
  let res: RansomRes = 'credits';
  let armed = false;
  const paint = (el: HTMLElement, p: CaptiveCardProps) => {
    const { st, you } = p;
    const c = st.court?.captives.find(x => x.id === p.captiveId);
    el.setAttribute('aria-label', 'Captive');
    if (!c || c.captor !== you) { el.innerHTML = `<p class="ct-empty">This prisoner is no longer in your hold.</p>`; return; }
    const can = p.canPlan !== false;
    const pend = pendingOf(p, isMine(c.id)) as Extract<FreeAction, { type: 'captive' }> | undefined;
    if (pend?.act === 'ransom' && pend.res) res = pend.res;
    const me = st.players[you];
    const owner = st.players[c.owner];
    const left = Math.max(0, c.until - st.turn + 1);
    const priceC = ransomPrice(st, c, 'credits'), priceI = ransomPrice(st, c, 'influence'), tp = turnPrice(st, c);
    const why = (act: 'ransom' | 'execute' | 'turn', r?: RansomRes) => (can ? captiveBlock(st, you, c.id, act, r) : 'your orders are sealed');
    const ransomWhy = why('ransom', res), turnWhy = why('turn'), execWhy = why('execute');
    const portrait = portraitImg({ name: c.cmd.name, color: owner?.color ?? '#888', scars: (c.scars ?? []).map(x => x.id), rank: c.cmd.rank, legend: c.cmd.rank >= 5 }, 72, 'ct-portrait', `${c.cmd.name}, prisoner`);
    const scars = (c.scars ?? []).map(x => `<span class="k-token bad"><span class="boss">${ic('scar')}</span>${esc(SCARS[x.id]?.name ?? x.id)}</span>`).join('');
    const pips = Array.from({ length: CR(st).releaseTurns + 1 }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('');
    let state = '';
    if (pend) {
      const what = pend.act === 'ransom' ? `Terms of ${pend.res === 'influence' ? `${priceI} influence` : `${priceC}¢`}` : pend.act === 'turn' ? `Turn ${esc(c.cmd.name)} (−${tp} influence)` : `Execute ${esc(c.cmd.name)}`;
      state = `<div class="ct-chosen ${pend.act === 'execute' ? 'grim' : ''}" role="status">${ic(pend.act === 'execute' ? 'skull' : pend.act === 'turn' ? 'banner' : 'purse')}<span>${what}, at the seal.</span>${can && h.onClear ? `<button type="button" class="k-btn ghost" data-act="undo">${ic('undo')} Undo</button>` : ''}</div>`;
    } else if (c.offer) {
      const amt = `${c.offer.amount} ${c.offer.res === 'credits' ? '¢' : 'influence'}`;
      state = `<p class="ct-note">${ic('purse')} Terms named: <b class="k-num">${esc(amt)}</b>. ${c.offer.turn < st.turn ? `${houseName(st, c.owner)} may pay ${turnWord(st, st.turn)}.` : `${houseName(st, c.owner)} may pay from ${turnWord(st, c.offer.turn + 1)}.`}</p>`;
    } else if (c.refused !== null && c.refused !== undefined) {
      state = `<p class="ct-note bad">${ic('close')} ${houseName(st, c.owner)} refused your terms. Decide again.</p>`;
    }
    const sel = (r: RansomRes) => (res === r ? 'true' : 'false');
    el.innerHTML = `
      <header class="ct-head"><span class="k-engraved">${ic('chain')} Prisoner</span><span class="ct-clock" title="Goes home free at the end of ${turnWord(st, c.until)}">${ic('hourglass')}<span class="ct-pips" aria-hidden="true">${pips}</span><span class="k-num">${left}</span></span></header>
      <div class="ct-who">${portrait}<div>
        <h3 class="ct-name">${esc(c.cmd.name)}</h3>
        <p class="ct-sub">${crest(st, c.owner, 20)} ${rankWord(c.cmd.rank)} of ${houseName(st, c.owner)}</p>
        <p class="ct-sub">Lost ${esc(c.fleet)}${st.regions[c.region] ? ` at ${esc(st.regions[c.region].name)}` : ''}, ${turnWord(st, c.turn)}.</p>
        ${scars ? `<div class="ct-tokens">${scars}</div>` : ''}
      </div></div>
      <p class="ct-prose">Free at the end of ${turnWord(st, c.until)} if you do nothing. One decision a turn.</p>
      ${state}
      <div class="ct-choices" role="group" aria-label="What becomes of ${esc(c.cmd.name)}">
        <div class="ct-choice">
          <div class="k-seg" role="radiogroup" aria-label="Terms">
            <button type="button" role="radio" aria-checked="${sel('credits')}" aria-pressed="${sel('credits')}" data-res="credits"><span class="k-num">${priceC}</span>¢</button>
            <button type="button" role="radio" aria-checked="${sel('influence')}" aria-pressed="${sel('influence')}" data-res="influence"><span class="k-num">${priceI}</span> ${ic('influence')}</button>
          </div>
          <button type="button" class="k-btn primary" data-act="ransom" ${ransomWhy ? `aria-disabled="true" title="${esc(ransomWhy)}"` : ''}>${ic('purse')} Ransom</button>
          <small class="ct-why">${ransomWhy && !owner?.eliminated ? esc(ransomWhy) : owner?.eliminated ? 'Its house is gone: nobody can pay.' : 'They pay, or you decide again.'}</small>
        </div>
        <div class="ct-choice">
          <button type="button" class="k-btn" data-act="turn" ${turnWhy ? `aria-disabled="true" title="${esc(turnWhy)}"` : ''}>${ic('banner')} Turn <span class="k-num">−${tp}</span>${ic('influence')}</button>
          <small class="ct-why">${turnWhy ? esc(turnWhy) : `Serves you, scars and all. You have <span class="k-num">${Math.max(0, me.res.influence)}</span>.`}</small>
        </div>
        <div class="ct-choice ct-exec">
          <button type="button" class="k-seal${armed ? ' armed' : ''}" data-act="execute" aria-label="${armed ? 'Press again to execute' : 'Execute (cannot be undone)'}" ${execWhy ? `aria-disabled="true" title="${esc(execWhy)}"` : ''}>${ic('skull')}</button>
          <small class="ct-why">${armed ? '<b>Press the seal again.</b> ' : ''}Execute: a grievance ${houseName(st, c.owner)} never forgets.</small>
        </div>
      </div>`;
  };
  const wire = (el: HTMLElement, get: () => CaptiveCardProps) => {
    const onClick = (ev: MouseEvent) => {
      const b = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      const p = get();
      const id = p.captiveId;
      if (b.dataset.res) { res = b.dataset.res as RansomRes; armed = false; paint(el, p); return; }
      const act = b.dataset.act;
      if (act === 'undo') { armed = false; h.onClear?.(isMine(id)); return; }
      if (act === 'execute' && !armed) { armed = true; paint(el, p); (el.querySelector('.k-seal') as HTMLElement | null)?.focus(); return; }
      if (act === 'ransom') h.onAction({ type: 'captive', id, act: 'ransom', res });
      else if (act === 'turn') h.onAction({ type: 'captive', id, act: 'turn' });
      else if (act === 'execute') {
        el.querySelector('.k-seal')?.classList.add('stamped');
        armed = false;
        h.onAction({ type: 'captive', id, act: 'execute' });
      }
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && armed) { armed = false; paint(el, get()); } };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); };
  };
  return shell(host, 'ct-card k-card riveted ct-captive', props, paint, wire);
}

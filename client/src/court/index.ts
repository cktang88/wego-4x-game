// The Court's client modules (Ransom, the Coronation, Exile). Each exposes one mount function; game.ts / the HUD
// decide where they live (see /tmp/claude-0/court/hooks.md). `courtPrompts` says which ones are due for a player.
import type { FreeAction, GameState, PlayerId } from '../../../shared/sim/types.ts';
export { mountCaptiveCard, type CaptiveCardProps } from './captive.ts';
export { mountRansomOffer, type RansomOfferProps } from './ransom.ts';
export { mountDecreePrompt, decreeDue, type DecreePromptProps } from './decree.ts';
export { mountWhisperPanel, exileDue, type WhisperPanelProps } from './whisper.ts';
export type { CourtMount, CourtProps, CourtHandlers } from './util.ts';

/** A Court prompt that is due for a player. `urgent`: it wants an answer this turn (a badge / a card on the strip). */
export type CourtPrompt =
  | { kind: 'captive'; id: number; urgent: boolean }    // you hold a prisoner: Ransom, Turn or Execute
  | { kind: 'ransom'; id: number; urgent: boolean }     // one of your commanders is held (urgent when terms can be paid)
  | { kind: 'decree'; urgent: boolean }                 // a Coronation is open (urgent when you have not answered)
  | { kind: 'exile'; urgent: boolean };                 // you are in exile (urgent while you have not whispered)

/** Every Court prompt due for `you` in this (fogged) view, most urgent first. */
export function courtPrompts(st: GameState, you: PlayerId | null): CourtPrompt[] {
  const ct = st.court;
  if (!ct || you === null || st.winner !== null) return [];
  const out: CourtPrompt[] = [];
  const me = st.players[you];
  if (me?.eliminated) {
    const e = ct.exiles.find(x => x.p === you);
    if (e) out.push({ kind: 'exile', urgent: e.whisper === null || e.vote === null });
    return out;
  }
  for (const c of ct.captives) {
    if (c.captor === you) out.push({ kind: 'captive', id: c.id, urgent: c.acted !== st.turn && (!c.offer || (c.refused ?? null) !== null) });
    if (c.owner === you) out.push({ kind: 'ransom', id: c.id, urgent: !!c.offer && c.offer.turn < st.turn });
  }
  const cr = ct.coronation;
  if (cr) out.push({ kind: 'decree', urgent: cr.holder !== you && !cr.answers[you] });
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

/** The plan entry a Court action replaces (same captive, the decree, the whisper): for setFree-style plumbing. */
export function sameCourtAction(fa: FreeAction): (x: FreeAction) => boolean {
  if (fa.type === 'captive' || fa.type === 'ransom') return x => x.type === fa.type && x.id === fa.id;
  if (fa.type === 'decree' || fa.type === 'exile') return x => x.type === fa.type;
  return () => false;
}

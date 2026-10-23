// AI for the Court (shared/sim/court.ts): what to do with a captive, whether to pay terms, Kneel or Defy, and what an
// exile whispers. Deterministic (no rng). Every choice is a free action, checked against the same validators the
// resolver uses, so the AI never sends one that would fail.
import { courtOn, coronationOn, exileOn, captiveBlock, ransomBlock, decreeBlock, exileBlock, turnPrice, strikesHolder, CR } from './court.ts';
import type { Captive, DecreeAnswer, FreeAction, GameState, Order, PlayerId } from './types.ts';

type Level = 'novice' | 'standard' | 'expert';

/** The Court's free actions for `pid` this turn (an exile's whisper and vote, or a living house's decisions). */
export function courtFree(s: GameState, pid: PlayerId, level?: Level): FreeAction[] {
  const out: FreeAction[] = [];
  const me = s.players[pid];
  const ct = s.court;
  if (!me || !ct || !courtOn(s) || s.winner !== null) return out;
  const lvl = level ?? me.aiLevel;
  if (me.eliminated) {
    const fa = exileChoice(s, pid);
    if (fa) out.push(fa);
    return out;
  }
  // what is left to spend: every payment below comes out of it (two sets of terms can't both use the same credits)
  const purse = { ...me.res };
  // ---- terms on our own commanders: pay for a veteran, or when it is cheap; otherwise say no (the captor decides again)
  for (const c of ct.captives) {
    if (c.owner !== pid || !c.offer || c.offer.turn >= s.turn) continue;
    const have = purse[c.offer.res];
    const pay = have >= c.offer.amount && (c.cmd.rank >= 2 || c.offer.amount <= have * 0.35);
    if (ransomBlock(s, pid, c.id, pay)) continue;
    out.push({ type: 'ransom', id: c.id, pay });
    if (pay) purse[c.offer.res] -= c.offer.amount;
  }
  // ---- our captives: one decision each, when there is one to make
  for (const c of ct.captives) {
    if (c.captor !== pid || c.acted === s.turn) continue;
    const fa = captorChoice(s, pid, c, lvl, purse.influence);
    if (!fa || fa.type !== 'captive' || captiveBlock(s, pid, fa.id, fa.act, fa.res)) continue;
    out.push(fa);
    if (fa.act === 'turn') purse.influence -= turnPrice(s, c);
  }
  // ---- the Coronation: answer in public (silence would count as Defy anyway)
  if (coronationOn(s) && ct.coronation && !decreeBlock(s, pid, 'defy')) out.push({ type: 'decree', answer: kneelOrDefy(s, pid, lvl) });
  return out;
}

/** The captor's choice: ransom first; a commander who owes us blood is executed; a veteran is turned when we can afford it. */
export function captorChoice(s: GameState, pid: PlayerId, c: Captive, lvl: Level, influence = s.players[pid].res.influence): FreeAction | null {
  const me = s.players[pid];
  const owner = s.players[c.owner];
  const canTurn = influence >= turnPrice(s, c) + 2;   // keep a little influence for everything else
  const act = (a: 'ransom' | 'execute' | 'turn', res?: 'credits' | 'influence'): FreeAction => ({ type: 'captive', id: c.id, act: a, ...(res ? { res } : {}) });
  if (!owner || owner.eliminated) return canTurn ? act('turn') : null;   // nobody can pay: take it into service, or let it go
  // it killed one of ours: blood for blood (an expert or standard captor; a grievance follows it)
  const killer = (s.soul?.debts ?? []).some(d => !d.cleared && d.creditor === pid && d.debtor === c.owner && d.killer === c.cmd.name);
  if (killer && lvl !== 'novice') return act('execute');
  if (c.offer) {
    if (c.offer.turn >= s.turn - 1) return null;   // the owner has not had its turn to answer yet
  }
  const spurned = c.refused !== null && c.refused !== undefined || !!c.offer;   // refused, or ignored for a whole turn
  if (spurned) {
    if (c.cmd.rank >= 3 && canTurn) return act('turn');
    if (c.cmd.rank >= 2 && lvl === 'expert') return act('execute');   // deny a veteran to a house that will not pay
    return null;                                                       // the clock will send it home
  }
  if (c.cmd.rank >= 3 && canTurn && lvl !== 'novice') return act('turn');
  return act('ransom', lvl === 'expert' && me.res.influence < 4 ? 'influence' : 'credits');
}

/**
 * Kneel when the holder is not about to win, we trail it clearly, and we share no border with it (we are unlikely
 * to have to strike it). Otherwise Defy.
 */
export function kneelOrDefy(s: GameState, pid: PlayerId, lvl: Level): DecreeAnswer {
  const cr = s.court?.coronation;
  if (!cr) return 'defy';
  const me = s.players[pid], h = s.players[cr.holder];
  const V = s.rules.victory;
  const nearWin = h.vp >= V.vpTarget * 0.6 || V.turnLimit - s.turn <= 4;
  if (nearWin || lvl === 'novice' && me.vp >= h.vp) return 'defy';
  const border = s.regions.some(r => r.owner === pid && (r.links ?? r.neighbors).some(n => s.regions[n]?.owner === cr.holder));
  return h.vp - me.vp >= 4 && !border ? 'kneel' : 'defy';
}

/** An exile marks the house most likely to win (the leader, or the Throne's holder); its ghost vote backs the other. */
export function exileChoice(s: GameState, pid: PlayerId): FreeAction | null {
  if (!exileOn(s)) return null;
  const e = s.court?.exiles.find(x => x.p === pid);
  if (!e) return null;
  const live = s.players.filter(p => !p.eliminated && p.id !== pid).sort((a, b) => b.vp - a.vp
    || Number(s.throne.owner === b.id) - Number(s.throne.owner === a.id) || a.id - b.id);
  if (!live.length) return null;
  const mark = live[0].id;
  const vote = live.length > 1 ? live[live.length - 1].id : undefined;
  const fa: FreeAction = { type: 'exile', ...(e.whisper !== mark ? { whisper: mark } : {}), ...(vote !== undefined && e.vote !== vote ? { vote } : {}) };
  if (!('whisper' in fa) && !('vote' in fa)) return null;   // nothing changes: send nothing
  return exileBlock(s, pid, (fa as { whisper?: number }).whisper, (fa as { vote?: number }).vote) ? null : fa;
}

/** Order value lost to a knee: a house that knelt pays court.kneelBreakVp to strike the holder (AI value units ~1.5 per VP). */
export function kneelPenalty(s: GameState, pid: PlayerId, o: Order): number {
  const k = s.court?.kneels.find(x => x.p === pid);
  if (!k || !coronationOn(s)) return 0;
  return strikesHolder(s, o, k.holder) ? CR(s).kneelBreakVp * 1.5 : 0;
}

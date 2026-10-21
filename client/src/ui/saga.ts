// The Saga (docs/SOUL.md §3): at the end of a game, a shareable page from sagaOf(state): a paragraph per fleet,
// the Throne's reigns, the memorial roll, the biggest moments, broken oaths and vows, and blood-debts. "Copy text"
// for the group chat, "Copy link" (online games: the finished game is public), "Save image" (a canvas render).
import type { GameScreen } from '../game.ts';
import { sagaOf, type Saga, type FleetSaga } from '../../../shared/sim/herald.ts';
import { BOONS, BANES, CALLINGS, SCARS } from '../../../shared/config/content.ts';
import { esc, toast } from './dom.ts';
import { bannerSvg, drawSigil, goldPaint } from '../art/sigils.ts';
import { headlineIcon } from './herald.ts';
import { beatIcon } from '../hud/soul.ts';
import { iconizeDom, ic, icFor } from '../art/icons.ts';

const FATE: Record<FleetSaga['fate'], [string, string]> = {
  alive: ['Still flies', 'alive'], destroyed: ['Destroyed', 'dead'], caught: ['Hunted down', 'dead'], broken: ['Broken', 'dead'], retired: ['Retired', 'retired'], merged: ['Merged', 'merged'],
};

let el: HTMLElement | null = null;
export const sagaOpen = () => !!el?.isConnected;
export function closeSaga() { if (!el) return; const e = el; el = null; e.classList.add('out'); setTimeout(() => e.remove(), 220); }

export function openSaga(g: GameScreen) {
  const st = g.st;
  const S = sagaOf(st);
  el?.remove();
  el = document.createElement('div');
  el.className = 'saga-ov';
  const pn = (p: number) => `<b style="color:${esc(g.color(p))}">${esc(g.pname(p))}</b>`;
  const winner = st.winner !== null ? st.players[st.winner] : null;
  const ranks = st.players.slice().sort((a, b) => b.vp - a.vp);
  const lastTurn = Math.max(1, st.winner !== null ? st.turn : st.turn - 1);
  // reigns as a bar over the game's turns
  const reigns = S.reigns.map(r => {
    const to = r.to ?? lastTurn + 1;
    return `<i style="left:${((r.from - 1) / lastTurn * 100).toFixed(2)}%;width:${(Math.max(0.6, (to - r.from) / lastTurn * 100)).toFixed(2)}%;background:${esc(g.color(r.player))}" title="${esc(r.name)} T${r.from}–${r.to ?? 'end'}"></i>`;
  }).join('');
  const fleets = S.fleets.map(f => {
    const [fw, fc] = FATE[f.fate];
    return `<article class="sg-fleet ${fc}" style="--pc:${esc(g.color(f.owner))}">
      <header>${bannerSvg(f.sigil || 'star', g.color(f.owner), 52, { rim: f.rank >= 4 ? 'gold' : 'silver', rank: f.rank, broken: f.oathbreaker })}
        <div><h3>${esc(f.name)}</h3>${f.epithets.length ? `<em>${esc(f.epithets.join(' · '))}</em>` : ''}<small>${esc(f.rankName)} · ${esc(f.commander)}</small></div>
        <span class="sg-fate">${fw}${f.fateTurn ? ` · T${f.fateTurn}` : ''}</span></header>
      <p>${esc(f.paragraph)}</p>
      <div class="sg-tags">${f.boons.map(b => `<span class="t boon" title="${esc(BOONS[b]?.name ?? b)}">${ic(icFor('boon', b, BOONS[b]?.icon))} ${esc(BOONS[b]?.name ?? b)}</span>`).join('')}${f.banes.map(b => `<span class="t bane">${ic(icFor('bane', b, BANES[b]?.icon))} ${esc(BANES[b]?.name ?? b)}</span>`).join('')}${f.scars.map(s => `<span class="t scar">${ic(icFor('scar', s, SCARS[s]?.icon))} ${esc(SCARS[s]?.name ?? s)}</span>`).join('')}</div>
      <div class="sg-beats">${f.beats.slice(-10).map(b => `<span title="${esc(b.text)}"><i>${beatIcon(b.kind)}</i>${b.turn}</span>`).join('')}</div></article>`;
  }).join('');
  const moments = S.moments.map((m, i) => `<figure class="sg-moment n${i}"><span class="mic">${headlineIcon(m.kind)}</span><blockquote>${esc(m.text)}</blockquote><figcaption>${g.live ? 'Cycle' : 'Turn'} ${m.turn}</figcaption></figure>`).join('');
  const mem = S.memorials.map(m => `<li><span>${esc(m.text)}</span></li>`).join('');
  const oaths = [
    ...S.oaths.map(o => `<li>${pn(o.player)} broke faith with ${pn(o.victim)} <small>T${o.turn}</small>${o.words ? `<q>${esc(o.words)}</q>` : ''}</li>`),
    ...S.vowsBroken.map(v => `<li>${esc(v.fleet)} <span class="dim">(${esc(g.pname(v.owner))})</span> forswore its vow <small>T${v.turn}</small></li>`),
  ].join('');
  const debts = S.debts.map(d => `<li>${pn(d.debtor)} owed ${pn(d.creditor)} for ${esc(d.victim)} <small>T${d.turn}</small> ${d.cleared ? `<span class="paid">avenged T${d.cleared}</span>` : '<span class="unpaid">unpaid</span>'}</li>`).join('');
  const worlds = S.worlds.slice(0, 12).map(w => `<li><b>${esc(w.name)}</b>${w.epithet ? ` <em>${esc(w.epithet)}</em>` : ''}${w.calling ? ` · ${ic(icFor('calling', w.calling, CALLINGS[w.calling]?.icon))} ${esc(CALLINGS[w.calling]?.name ?? w.calling)}` : ''}${w.deeds.length ? ` · ${w.deeds.map(esc).join(', ')}` : ''}</li>`).join('');
  const link = shareLink(g);
  el.innerHTML = `<div class="saga" role="dialog" aria-label="The Saga">
    <header class="sg-head"><small class="kicker">The Saga of</small><h1>The Three Crowns</h1>
      <div class="sg-win">${winner ? `<span style="color:${esc(winner.color)}">♛ ${esc(winner.name)}</span> <span class="dim">${esc(st.winReason || 'wins')}</span>` : `<span class="dim">${g.live ? 'Cycle' : 'Turn'} ${st.turn} · the game goes on</span>`}</div>
      <ol class="sg-ranks">${ranks.map(p => `<li style="--pc:${esc(p.color)}"><b>${esc(p.name)}</b><span>${p.vp} ♛</span>${(p.oathbreaker ?? []).length ? '<em>Oathbreaker</em>' : ''}</li>`).join('')}</ol></header>
    ${moments ? `<section class="sg-sec"><h2>The moments</h2><div class="sg-moments">${moments}</div></section>` : ''}
    <section class="sg-sec"><h2>The Hollow Throne</h2>${reigns ? `<div class="sg-reigns"><div class="bar">${reigns}</div><div class="axis"><span>T1</span><span>T${lastTurn}</span></div><ul>${S.reigns.map(r => `<li>${pn(r.player)} <small>T${r.from}–${r.to ?? (st.winner !== null ? 'end' : 'now')}</small></li>`).join('')}</ul></div>` : '<p class="dim">No one ever sat the Throne.</p>'}</section>
    <section class="sg-sec"><h2>The banners</h2><div class="sg-fleets">${fleets || '<p class="dim">No banners were raised.</p>'}</div></section>
    <div class="sg-grid">
      <section class="sg-sec"><h2>Oaths broken</h2>${oaths ? `<ul class="sg-list">${oaths}</ul>` : '<p class="dim">Every word was kept.</p>'}</section>
      <section class="sg-sec"><h2>Blood-debts</h2>${debts ? `<ul class="sg-list">${debts}</ul>` : '<p class="dim">No blood owed.</p>'}</section>
      <section class="sg-sec"><h2>Worlds remembered</h2>${worlds ? `<ul class="sg-list">${worlds}</ul>` : '<p class="dim">No world made history.</p>'}</section>
      <section class="sg-sec mem"><h2>The memorial roll</h2>${mem ? `<ul class="sg-mem">${mem}</ul>` : '<p class="dim">No names on the stone.</p>'}</section>
    </div>
    <footer class="sg-foot"><button class="hb" data-s="text">${ic('copy')} Copy text</button>${link ? '<button class="hb" data-s="link">⛓ Copy link</button>' : ''}<button class="hb" data-s="image">⤓ Save image</button><button class="hb go" data-s="close">Close</button></footer></div>`;
  iconizeDom(el);
  document.body.appendChild(el);
  requestAnimationFrame(() => el?.classList.add('show'));
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (!b) { if (e.target === el) closeSaga(); return; }
    switch (b.dataset.s) {
      case 'close': closeSaga(); break;
      case 'text': copy(sagaText(g, S), 'Saga copied'); break;
      case 'link': if (link) copy(link, 'Link copied'); break;
      case 'image': void saveImage(g, S); break;
    }
  });
  const onKey = (e: KeyboardEvent) => { if (!el?.isConnected) { window.removeEventListener('keydown', onKey, true); return; } if (e.key === 'Escape') { e.stopPropagation(); closeSaga(); } };
  window.addEventListener('keydown', onKey, true);
}

function shareLink(g: GameScreen): string {
  if (g.src.kind !== 'remote') return '';
  return `${location.origin}${location.pathname}#/g/${g.src.meta.id}`;
}
function copy(t: string, ok: string) {
  const done = () => toast(ok);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(done, () => fallback());
  else fallback();
  function fallback() {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Copy failed'); }
    ta.remove();
  }
}

/** The saga as plain text (the group chat). */
export function sagaText(g: GameScreen, S: Saga = sagaOf(g.st)): string {
  const st = g.st;
  const L: string[] = ['THE SAGA OF THE THREE CROWNS'];
  if (st.winner !== null) L.push(`${st.players[st.winner].name} wins: ${st.winReason}`);
  L.push(st.players.slice().sort((a, b) => b.vp - a.vp).map(p => `${p.name} ${p.vp}♛`).join(' · '), '');
  if (S.moments.length) { L.push('THE MOMENTS'); for (const m of S.moments) L.push(`· T${m.turn}: ${m.text}`); L.push(''); }
  if (S.reigns.length) { L.push('THE HOLLOW THRONE'); for (const r of S.reigns) L.push(`· ${r.name}, T${r.from}–${r.to ?? 'end'}`); L.push(''); }
  if (S.fleets.length) { L.push('THE BANNERS'); for (const f of S.fleets.slice(0, 12)) L.push(`${f.sigilGlyph} ${f.name}: ${f.paragraph}`); L.push(''); }
  if (S.oaths.length || S.vowsBroken.length) {
    L.push('OATHS BROKEN');
    for (const o of S.oaths) L.push(`· ${g.pname(o.player)} broke faith with ${g.pname(o.victim)} (T${o.turn})${o.words ? `: “${o.words}”` : ''}`);
    for (const v of S.vowsBroken) L.push(`· ${v.fleet} forswore its vow (T${v.turn})`);
    L.push('');
  }
  if (S.debts.length) { L.push('BLOOD-DEBTS'); for (const d of S.debts) L.push(`· ${g.pname(d.debtor)} owed ${g.pname(d.creditor)} for ${d.victim}${d.cleared ? ` (avenged T${d.cleared})` : ' (unpaid)'}`); L.push(''); }
  if (S.memorials.length) { L.push('THE MEMORIAL ROLL'); for (const m of S.memorials.slice(0, 20)) L.push(`· ${m.text}`); }
  return L.join('\n').trim();
}

// ------------------------------------------------------------------ the image (canvas)
function wrap(c: CanvasRenderingContext2D, t: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const tryL = line ? `${line} ${word}` : word;
    if (c.measureText(tryL).width > w && line) { out.push(line); line = word; } else line = tryL;
  }
  if (line) out.push(line);
  return out;
}
function shield(c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, sigil: string) {
  const k = s / 32;
  const p = new Path2D('M3 2h26a1 1 0 0 1 1 1v12c0 9-7 14-14 17C9 29 2 24 2 15V3a1 1 0 0 1 1-1Z');
  c.save(); c.translate(x, y); c.scale(k, k);
  c.fillStyle = color; c.fill(p);
  const gl = c.createLinearGradient(0, 0, 18, 32); gl.addColorStop(0, 'rgba(255,255,255,0.35)'); gl.addColorStop(0.45, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,0.35)');
  c.fillStyle = gl; c.fill(p);
  c.strokeStyle = '#d9c38a'; c.lineWidth = 1.6; c.stroke(p);
  c.restore();
  drawSigil(c, sigil || 'star', x + s / 2, y + s * 0.42, s * 0.56, goldPaint(c, y, y + s * 0.8));
}
export async function saveImage(g: GameScreen, S: Saga = sagaOf(g.st)) {
  const st = g.st;
  const W = 1080, P = 64;
  try { await document.fonts?.ready; } catch { /* */ }
  const serif = '"Cinzel", Georgia, serif', body = '"IM Fell English", Georgia, serif';
  // measure first, then draw at the final height
  const plan = (c: CanvasRenderingContext2D, draw: boolean) => {
    let y = P;
    const text = (t: string, font: string, color: string, x = P, align: CanvasTextAlign = 'left', lh = 0) => { c.font = font; if (draw) { c.fillStyle = color; c.textAlign = align; c.fillText(t, x, y); } y += lh; };
    text('THE SAGA OF', `600 22px ${serif}`, '#c9a964', W / 2, 'center', 52);
    text('THE THREE CROWNS', `700 54px ${serif}`, '#f4e6c4', W / 2, 'center', 44);
    if (st.winner !== null) text(`${st.players[st.winner].name} wins · ${st.winReason}`, `italic 24px ${body}`, st.players[st.winner].color, W / 2, 'center', 34);
    text(st.players.slice().sort((a, b) => b.vp - a.vp).map(p => `${p.name} ${p.vp}`).join('   ·   '), `600 20px ${serif}`, '#bfb29a', W / 2, 'center', 30);
    if (draw) { c.strokeStyle = 'rgba(217,180,106,0.6)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(P, y); c.lineTo(W - P, y); c.stroke(); }
    y += 40;
    if (S.moments.length) {
      text('THE MOMENTS', `700 20px ${serif}`, '#d9b46a', P, 'left', 34);
      for (const m of S.moments) {
        c.font = `italic 24px ${body}`;
        const ls = wrap(c, `“${m.text}”`, W - P * 2 - 60);
        text(`T${m.turn}`, `700 16px ${serif}`, '#9c8a6a', P, 'left', 0);
        for (const l of ls) text(l, `italic 24px ${body}`, '#efe3c8', P + 60, 'left', 30);
        y += 8;
      }
      y += 16;
    }
    if (S.reigns.length) {
      text('THE HOLLOW THRONE', `700 20px ${serif}`, '#d9b46a', P, 'left', 22);
      const last = Math.max(1, st.turn);
      if (draw) {
        c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(P, y, W - P * 2, 18);
        for (const r of S.reigns) { const to = r.to ?? last + 1; c.fillStyle = g.color(r.player); c.fillRect(P + ((r.from - 1) / last) * (W - P * 2), y, Math.max(3, ((to - r.from) / last) * (W - P * 2)), 18); }
      }
      y += 54;
    }
    text('THE BANNERS', `700 20px ${serif}`, '#d9b46a', P, 'left', 30);
    for (const f of S.fleets.slice(0, 6)) {
      const y0 = y;
      if (draw) shield(c, P, y - 4, 54, g.color(f.owner), f.sigil);
      text(`${f.name}${f.epithets.length ? `, ${f.epithets.join(', ')}` : ''}`, `700 24px ${serif}`, g.color(f.owner), P + 72, 'left', 28);
      c.font = `20px ${body}`;
      for (const l of wrap(c, f.paragraph, W - P * 2 - 72).slice(0, 4)) text(l, `20px ${body}`, '#dccfb4', P + 72, 'left', 25);
      y = Math.max(y, y0 + 62) + 14;
    }
    y += 10;
    if (S.oaths.length || S.debts.length) {
      text('OATHS & DEBTS', `700 20px ${serif}`, '#d9b46a', P, 'left', 30);
      for (const o of S.oaths.slice(0, 3)) text(`${g.pname(o.player)} broke faith with ${g.pname(o.victim)}${o.words ? ` — “${o.words}”` : ''}`, `italic 20px ${body}`, '#f0a090', P, 'left', 27);
      for (const d of S.debts.slice(0, 4)) text(`${g.pname(d.debtor)} owed ${g.pname(d.creditor)} for ${d.victim}${d.cleared ? ' — avenged' : ' — unpaid'}`, `20px ${body}`, '#dccfb4', P, 'left', 27);
      y += 10;
    }
    text('threecrowns · a game between three friends', `600 15px ${serif}`, '#7d7058', W / 2, 'center', 0);
    return y + P;
  };
  const m = document.createElement('canvas').getContext('2d')!;
  const H = Math.ceil(plan(m, false));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const bg = c.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#2a2620'); bg.addColorStop(0.5, '#161512'); bg.addColorStop(1, '#0c0b0a');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const lamp = c.createRadialGradient(W * 0.25, 120, 40, W * 0.3, 200, W);
  lamp.addColorStop(0, 'rgba(255,214,150,0.14)'); lamp.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = lamp; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#b8883e'; c.lineWidth = 3; c.strokeRect(18, 18, W - 36, H - 36);
  c.strokeStyle = 'rgba(184,136,62,0.45)'; c.lineWidth = 1; c.strokeRect(26, 26, W - 52, H - 52);
  c.textBaseline = 'alphabetic';
  plan(c, true);
  const url = cv.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = `three-crowns-saga-t${st.turn}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  (window as unknown as { __sagaImage?: string }).__sagaImage = url;
  toast('⤓ Saga image saved');
}

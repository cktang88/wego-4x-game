// The browser tab carries your seal state (DELIGHT #88): when it is your move, the crown in the tab wears a drop of
// red wax and the title says so; once your orders are sealed (or it is not your game to play) the plain brass crown
// returns. Cheap: the icon is swapped only when the state changes.
type TabState = 'move' | 'rest';
const CROWN = "<path d='M4 24V10l6 6 6-10 6 10 6-6v14z' fill='%23c8964a' stroke='%233a2810' stroke-width='1.2' stroke-linejoin='round'/>";
const WAX = "<circle cx='24' cy='24' r='7.5' fill='%238e1f1f' stroke='%234a0d0e' stroke-width='1.2'/><circle cx='21.6' cy='21.4' r='2.2' fill='%23e2705e' opacity='.7'/>";
const icon = (s: TabState) => `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>${CROWN}${s === 'move' ? WAX : ''}</svg>`;
let shown: string | null = null;

/** Set the tab for this screen: your move (turn n) or at rest. Leaves a pending "(!)" alert title alone. */
export function setTab(s: TabState, turn = 0, word = 'Turn') {
  const key = `${s}:${turn}:${word}`;
  if (key === shown) return;
  shown = key;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = icon(s);
  if (!document.title.startsWith('(!)')) document.title = s === 'move' ? `Your move · ${word} ${turn} · Three Crowns` : 'Three Crowns';
}
/** Back to the lobby: the plain crown. */
export function resetTab() { shown = null; setTab('rest'); }
/** Forget what the tab shows (after something else wrote the title), so the next render sets it again. */
export function forgetTab() { shown = null; }

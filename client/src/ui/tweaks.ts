// Auto-generated rules editor. Every number/boolean/string in the default rules
// becomes an input. Overrides are stored in localStorage and passed to new games.
import { defaultRules, isObj } from '../../../shared/config/rules.ts';
import { esc, overlay, toast } from './dom.ts';

const KEY = 'tc.rules.overrides';

export function loadOverrides(): Record<string, unknown> {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // only an object of rule groups is meaningful (a pasted string or array would count its characters as "groups")
    return isObj(o) ? o as Record<string, unknown> : {};
  } catch { return {}; }
}
function saveOverrides(o: unknown) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { toast('Could not save: browser storage is blocked or full.'); }
}

function get(o: any, path: string[]) { return path.reduce((a, k) => (a == null ? undefined : a[k]), o); }
function set(o: any, path: string[], v: unknown) {
  let cur = o;
  for (const k of path.slice(0, -1)) cur = cur[k] ?? (cur[k] = {});
  cur[path[path.length - 1]] = v;
}
function prune(o: any): any {
  if (!isObj(o)) return o;
  for (const k of Object.keys(o)) { o[k] = prune(o[k]); if (isObj(o[k]) && !Object.keys(o[k]).length) delete o[k]; }
  return o;
}

/** How many individual rules differ from the defaults (the lobby's Tweaks button shows it). */
export function countOverrides(): number {
  const n = (o: unknown): number => isObj(o) ? Object.values(o).reduce<number>((a, v) => a + n(v), 0) : 1;
  return n(loadOverrides());
}

/** "repeatFleetCredits" -> "repeat fleet credits"; the group name is the section heading, so it is left out. */
const human = (path: string[]) => path.slice(1).map(k => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()).join(' · ');
const groupTitle = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

export function openTweaks(onClose?: () => void) {
  const base = defaultRules() as any;
  const over = loadOverrides();
  const groups: string[] = [];
  const row = (p: string[], v: unknown, input: string, cur: unknown) => {
    const key = p.join('.');
    const def = Array.isArray(v) ? JSON.stringify(v) : String(v);
    // text and lists get a full-width field under their name (a 6rem box cut them off)
    const wide = typeof v === 'string' || (Array.isArray(v) && def.length > 12);
    return `<label class="tw-row${wide ? ' wide' : ''}${cur !== undefined ? ' changed' : ''}" data-key="${esc(key.toLowerCase())} ${esc(human(p))}" title="${esc(key)} (default ${esc(def)})">
      <span class="tw-name">${esc(human(p))}<small class="tw-def">default ${esc(def.length > 24 ? def.slice(0, 22) + '…' : def)}</small></span>${input}</label>`;
  };
  const walk = (obj: any, path: string[], out: string[]) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = [...path, k];
      if (isObj(v)) { walk(v, p, out); continue; }
      const cur = get(over, p);
      if (Array.isArray(v)) {
        out.push(row(p, v, `<input data-path="${esc(p.join('.'))}" data-type="json" spellcheck="false" value="${esc(JSON.stringify(cur ?? v))}" aria-label="${esc(p.join('.'))} (JSON)">`, cur));
        continue;
      }
      const val = cur ?? v;
      const type = typeof v;
      out.push(row(p, v, type === 'boolean'
        ? `<input type="checkbox" data-path="${esc(p.join('.'))}" data-type="boolean" ${val ? 'checked' : ''} aria-label="${esc(p.join('.'))}">`
        : `<input data-path="${esc(p.join('.'))}" data-type="${type}" ${type === 'number' ? 'inputmode="decimal"' : 'spellcheck="false"'} value="${esc(String(val))}" aria-label="${esc(p.join('.'))}">`, cur));
    }
  };
  for (const [k, v] of Object.entries(base)) {
    if (!isObj(v)) continue;
    const out: string[] = [];
    walk(v, [k], out);
    groups.push(`<section class="grp" data-grp="${esc(k)}"><h3>${esc(groupTitle(k))}</h3>${out.join('')}</section>`);
  }
  const o = overlay(`<div class="dialog wide tw-dlg" role="dialog" aria-label="Tweaks">
    <div class="tw-head"><h2>Tweaks <small>rules for new games</small></h2>
      <input type="search" class="tw-find" placeholder="Find a rule…" aria-label="Find a rule" spellcheck="false"><span class="tw-changed" aria-live="polite"></span></div>
    <p class="tw-note">Every balance number in the game. Changes apply to <b>new</b> games, local or online; each game keeps the rules it started with. Gold rules are changed. Ship stats are under <i>Ships</i>.</p>
    <div class="tweaks">${groups.join('')}<p class="tw-none" hidden>No rule matches.</p></div>
    <div class="tw-foot"><button data-x="reset" class="danger">Reset all</button><button data-x="export">Copy JSON</button><button data-x="import">Paste JSON</button><span class="grow"></span><button class="primary" data-x="close">Done</button></div></div>`);
  const bReset = o.querySelector<HTMLButtonElement>('[data-x="reset"]')!;
  const changed = o.querySelector<HTMLElement>('.tw-changed')!;
  const recount = () => {
    const n = countOverrides();
    changed.textContent = n ? `${n} changed` : 'All defaults';
    bReset.disabled = !n;
    bReset.title = n ? 'Put every rule back to its default' : 'Nothing to reset: every rule is at its default';
  };
  recount();
  const find = o.querySelector<HTMLInputElement>('.tw-find')!;
  find.addEventListener('input', () => {
    const t = find.value.trim().toLowerCase();
    let any = false;
    o.querySelectorAll<HTMLElement>('.tweaks .grp').forEach(gp => {
      const hitGroup = !!t && gp.dataset.grp!.toLowerCase().includes(t);
      let n = 0;
      gp.querySelectorAll<HTMLElement>('.tw-row').forEach(r => { const hit = !t || hitGroup || r.dataset.key!.includes(t); r.hidden = !hit; if (hit) n++; });
      gp.hidden = !n; if (n) any = true;
    });
    o.querySelector<HTMLElement>('.tw-none')!.hidden = any;
  });
  o.querySelectorAll<HTMLInputElement>('[data-path]').forEach(inp => inp.addEventListener('change', () => {
    const path = inp.dataset.path!.split('.');
    const def = get(base, path);
    let v: unknown;
    try {
      v = inp.dataset.type === 'boolean' ? inp.checked : inp.dataset.type === 'number' ? Number(inp.value) : inp.dataset.type === 'json' ? JSON.parse(inp.value) : inp.value;
    } catch { toast('Invalid JSON'); return; }
    // an emptied number field means "back to the default", not 0 (Number('') is 0: e.g. zero orders a turn)
    if (inp.dataset.type === 'number' && !inp.value.trim()) { v = def; inp.value = String(def); }
    if (typeof v === 'number' && Number.isNaN(v)) { toast('Not a number'); return; }
    const cur = loadOverrides();
    if (JSON.stringify(v) === JSON.stringify(def)) { set(cur, path, undefined); prune(JSON.parse(JSON.stringify(cur))); }
    else set(cur, path, v);
    saveOverrides(prune(JSON.parse(JSON.stringify(cur))));
    inp.closest('label')?.classList.toggle('changed', JSON.stringify(v) !== JSON.stringify(def));
    recount();
  }));
  if (onClose) o.addEventListener('fx-removed', () => onClose());
  o.querySelector('[data-x="close"]')!.addEventListener('click', () => o.remove());
  bReset.addEventListener('click', () => {
    if (!confirm(`Reset all ${countOverrides()} changed rules to their defaults?`)) return;
    saveOverrides({}); o.remove(); openTweaks(onClose); toast('Every rule is back to its default');
  });
  o.querySelector('[data-x="export"]')!.addEventListener('click', async () => {
    try { if (!navigator.clipboard) throw new Error('no clipboard'); await navigator.clipboard.writeText(JSON.stringify(loadOverrides(), null, 2)); toast('Copied the changed rules as JSON'); }
    catch { prompt('Copy the rule overrides', JSON.stringify(loadOverrides())); }
  });
  o.querySelector('[data-x="import"]')!.addEventListener('click', () => {
    const t = prompt('Paste rule overrides JSON');
    if (!t) return;
    let v: unknown;
    try { v = JSON.parse(t); } catch { toast('Invalid JSON'); return; }
    if (!isObj(v)) { toast('Expected a JSON object of rule groups, e.g. {"orders":{"perTurn":4}}'); return; }
    saveOverrides(v); o.remove(); openTweaks(onClose); toast('Rules pasted');
  });
}

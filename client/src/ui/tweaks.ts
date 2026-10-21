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

export function openTweaks() {
  const base = defaultRules() as any;
  const over = loadOverrides();
  const groups: string[] = [];
  const walk = (obj: any, path: string[], out: string[]) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = [...path, k];
      if (isObj(v)) { walk(v, p, out); continue; }
      if (Array.isArray(v)) {
        const cur = get(over, p);
        out.push(`<label class="${cur !== undefined ? 'changed' : ''}" title="${esc(p.join('.'))} (JSON)"><span>${esc(p.slice(1).join('.'))}</span><input data-path="${esc(p.join('.'))}" data-type="json" value="${esc(JSON.stringify(cur ?? v))}"></label>`);
        continue;
      }
      const cur = get(over, p);
      const val = cur ?? v;
      const type = typeof v;
      out.push(`<label class="${cur !== undefined ? 'changed' : ''}" title="${esc(p.join('.'))} (default ${esc(String(v))})"><span>${esc(p.slice(1).join('.'))}</span>${type === 'boolean'
        ? `<input type="checkbox" data-path="${esc(p.join('.'))}" data-type="boolean" ${val ? 'checked' : ''}>`
        : `<input data-path="${esc(p.join('.'))}" data-type="${type}" value="${esc(String(val))}">`}</label>`);
    }
  };
  for (const [k, v] of Object.entries(base)) {
    if (!isObj(v)) continue;
    const out: string[] = [];
    walk(v, [k], out);
    groups.push(`<div class="grp"><h3>${esc(k)}</h3>${out.join('')}</div>`);
  }
  const o = overlay(`<div class="dialog wide scroll" style="max-height:90vh">
    <div class="row"><h2 class="grow">Tweaks: rules for new games</h2><button data-x="reset" class="danger">Reset all</button><button data-x="export">Copy JSON</button><button data-x="import">Paste JSON</button><button class="primary" data-x="close">Done</button></div>
    <p class="dim" style="font-size:var(--fs-xs)">Every balance number in the game. Changes apply to <b>new</b> games (local or online). Each game keeps the rules it started with, so everyone in an online game plays by the same rules. Gold labels are changed from the default. Ship stats live under <i>ships.*</i>. You can also edit <code>shared/config/rules.ts</code> directly.</p>
    <div class="tweaks">${groups.join('')}</div></div>`);
  o.querySelectorAll<HTMLInputElement>('[data-path]').forEach(inp => inp.addEventListener('change', () => {
    const path = inp.dataset.path!.split('.');
    const def = get(base, path);
    let v: unknown;
    try {
      v = inp.dataset.type === 'boolean' ? inp.checked : inp.dataset.type === 'number' ? Number(inp.value) : inp.dataset.type === 'json' ? JSON.parse(inp.value) : inp.value;
    } catch { toast('Invalid JSON'); return; }
    if (typeof v === 'number' && Number.isNaN(v)) { toast('Not a number'); return; }
    const cur = loadOverrides();
    if (JSON.stringify(v) === JSON.stringify(def)) { set(cur, path, undefined); prune(JSON.parse(JSON.stringify(cur))); }
    else set(cur, path, v);
    saveOverrides(prune(JSON.parse(JSON.stringify(cur))));
    inp.closest('label')?.classList.toggle('changed', JSON.stringify(v) !== JSON.stringify(def));
  }));
  o.querySelector('[data-x="close"]')!.addEventListener('click', () => o.remove());
  o.querySelector('[data-x="reset"]')!.addEventListener('click', () => { saveOverrides({}); o.remove(); openTweaks(); });
  o.querySelector('[data-x="export"]')!.addEventListener('click', async () => { await navigator.clipboard?.writeText(JSON.stringify(loadOverrides(), null, 2)); toast('Copied rule overrides to clipboard'); });
  o.querySelector('[data-x="import"]')!.addEventListener('click', () => {
    const t = prompt('Paste rule overrides JSON');
    if (!t) return;
    let v: unknown;
    try { v = JSON.parse(t); } catch { toast('Invalid JSON'); return; }
    if (!isObj(v)) { toast('Expected a JSON object of rule groups, e.g. {"orders":{"perTurn":4}}'); return; }
    saveOverrides(v); o.remove(); openTweaks();
  });
}

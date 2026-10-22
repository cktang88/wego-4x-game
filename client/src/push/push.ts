// "Your turn" notifications with the tab closed (Web Push; server/push.ts, client/public/sw.js).
// Opt-in only: the prompt is offered once, after the player's first sealed turn, never on load.
// Mount functions (integration lines in /tmp/claude-0/loops2/hooks.md):
//   mountPushPrompt(host?)      the one-time offer after the first seal (call shouldOfferPush() first)
//   mountPushSettings(host)     the settings section: alerts on/off, LIVE arrivals, quiet hours
//   syncPush()                  re-bind this browser's seats (call after joining a game / on the lobby)
import { heldSeats } from '../league/api.ts';
import { esc, tray } from '../league/overlay.ts';

const KEY = 'tc.push.v1';
const ASKED = 'tc.push.asked';
interface Saved { on: boolean; endpoint: string | null; quiet: { from: number; to: number } | null; live: boolean }
const DEFAULTS: Saved = { on: false, endpoint: null, quiet: null, live: true };

const load = (): Saved => { try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}) }; } catch { return { ...DEFAULTS }; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: lasts this session */ } };
const asked = () => { try { return localStorage.getItem(ASKED) !== null; } catch { return true; } };
const markAsked = (v: string) => { try { localStorage.setItem(ASKED, v); } catch { /* */ } };

/** What this browser can do: 'ready', 'ios-install' (iPhone/iPad outside an installed web app), 'blocked' (denied), 'unsupported'. */
export function pushSupport(): 'ready' | 'ios-install' | 'blocked' | 'unsupported' {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (ios && !standalone) return 'ios-install';
  if (!has || !window.isSecureContext) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return 'ready';
}

/** Offer the prompt? Once per browser, only where it could work (or could, once installed), never if already on. */
export function shouldOfferPush(): boolean {
  const s = pushSupport();
  if (s === 'unsupported' || s === 'blocked' || asked() || load().on) return false;
  return s === 'ios-install' || Notification.permission === 'default';
}

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const tz = () => new Date().getTimezoneOffset();
async function post(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}
const quietBody = (q: Saved['quiet']) => (q ? { ...q, tz: tz() } : null);

/** Ask permission (must run from a click), subscribe, and bind every seat this browser holds. */
export async function enablePush(opts: { quiet?: Saved['quiet']; live?: boolean } = {}): Promise<void> {
  if (pushSupport() !== 'ready') throw new Error('This browser cannot receive notifications here.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site in the browser settings.' : 'No permission was given.');
  const key = await fetch('/api/push/key').then(r => (r.ok ? r.json() : Promise.reject(new Error('This server does not send notifications.'))));
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key.publicKey) });
  const s = load();
  const next: Saved = { on: true, endpoint: sub.endpoint, quiet: opts.quiet !== undefined ? opts.quiet : s.quiet, live: opts.live ?? s.live };
  await post('/api/push/subscribe', { subscription: sub.toJSON(), games: heldSeats().map(({ game, token }) => ({ game, token })), quiet: quietBody(next.quiet), live: next.live });
  save(next);
}

export async function disablePush(): Promise<void> {
  const s = load();
  save({ ...s, on: false, endpoint: null });
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    else if (s.endpoint) await post('/api/push/unsubscribe', { endpoint: s.endpoint }).catch(() => {});
  } catch { /* the browser forgot it already */ }
}

/** Re-bind every seat this browser holds (after joining a game), and refresh quiet hours for this timezone. Quiet no-op when off. */
export async function syncPush(): Promise<void> {
  const s = load();
  if (!s.on || pushSupport() !== 'ready' || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) { save({ ...s, on: false, endpoint: null }); return; }
    await post('/api/push/subscribe', { subscription: sub.toJSON(), games: heldSeats().map(({ game, token }) => ({ game, token })), quiet: quietBody(s.quiet), live: s.live });
    if (sub.endpoint !== s.endpoint) save({ ...s, endpoint: sub.endpoint });
  } catch { /* offline: next time */ }
}

async function updateSettings(s: Saved) {
  save(s);
  if (s.on && s.endpoint) await post('/api/push/settings', { endpoint: s.endpoint, quiet: quietBody(s.quiet), live: s.live }).catch(() => {});
}

// ============================================================================ the prompt
const IOS_STEPS = 'On iPhone and iPad, notifications need Three Crowns on your Home Screen: tap Share, then “Add to Home Screen”, open it from there, and turn this on in Settings.';

/**
 * The one-time offer after the first sealed turn: a vellum slip in the Herald's voice. Shown once per browser
 * whatever the answer. Returns a no-op where push can never work.
 */
export function mountPushPrompt(_host: HTMLElement = document.body): { close(): void } {
  const sup = pushSupport();
  if (sup === 'unsupported' || sup === 'blocked') return { close: () => {} };
  markAsked('shown');
  const t = tray('tcp-sheet', 'Turn notifications');
  const draw = (status = '', cls = '') => {
    const ios = sup === 'ios-install';
    t.body.innerHTML = `<header class="tcl-head"><span class="k-engraved">The Herald</span><h2 class="k-display">Send word when it’s your turn?</h2></header>
      <div class="k-slip tcp-slip">
        <p>Your seal is set. When your friends have moved and the turn is in, the Herald can knock, even with this tab closed.</p>
        <p class="tcp-sample">“Turn 12: the Crimson fleet is moving on Vel. Your seal is awaited.”</p>
        <p>It only ever says what your own house can see. Quiet hours and LIVE arrival alerts are in Settings.</p>
        ${ios ? `<p><b>${esc(IOS_STEPS)}</b></p>` : ''}
      </div>
      <p class="tcp-status ${cls}" role="status">${esc(status)}</p>
      <div class="tcp-btns">${ios
        ? '<button class="k-btn primary" data-p="ok" data-autofocus>Understood</button>'
        : '<button class="k-btn ghost" data-p="no">Not now</button><button class="k-btn primary" data-p="yes" data-autofocus>Send word</button>'}</div>`;
  };
  draw();
  t.body.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-p]');
    if (!b) return;
    if (b.dataset.p === 'no') { markAsked('no'); t.close(); return; }
    if (b.dataset.p === 'ok') { markAsked('ios'); t.close(); return; }
    b.disabled = true;
    draw('Asking your browser…');
    try {
      await enablePush();
      markAsked('yes');
      draw('Word will reach you here.', 'good');
      setTimeout(t.close, matchMedia('(prefers-reduced-motion: reduce)').matches ? 2500 : 1600);
    } catch (err) {
      markAsked('failed');
      draw(`${(err as Error).message} You can turn this on later in Settings.`, 'bad');
    }
  });
  return { close: t.close };
}

// ============================================================================ settings
const HOURS_FROM = [21, 22, 23, 0];
const HOURS_TO = [6, 7, 8, 9];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** The notifications section of Settings: on/off, LIVE arrivals, quiet hours. Explains itself where push can't work. */
export function mountPushSettings(host: HTMLElement): { destroy(): void } {
  const el = document.createElement('section');
  el.className = 'tcp-settings';
  host.appendChild(el);
  let busy = false;
  let note = '';
  const draw = () => {
    const s = load();
    const sup = pushSupport();
    const q = s.quiet;
    const toggle = (id: string, label: string, on: boolean, disabled = false) =>
      `<label class="k-toggle"><input type="checkbox" data-s="${id}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="lever"></span><span>${esc(label)}</span></label>`;
    if (sup === 'unsupported') { el.innerHTML = `<span class="k-engraved">Notifications</span><p class="tcp-note">This browser can’t receive turn notifications. The tab title still shows when it’s your move.</p>`; return; }
    if (sup === 'ios-install') { el.innerHTML = `<span class="k-engraved">Notifications</span><p class="tcp-note">${esc(IOS_STEPS)}</p>`; return; }
    if (sup === 'blocked') { el.innerHTML = `<span class="k-engraved">Notifications</span><p class="tcp-note">Notifications are blocked for this site. Allow them in the browser’s site settings, then come back here.</p>`; return; }
    el.innerHTML = `<span class="k-engraved">Notifications</span>
      ${toggle('on', 'Your turn', s.on, busy)}
      ${toggle('live', 'LIVE arrivals', s.live, !s.on || busy)}
      ${toggle('quiet', 'Quiet hours', !!q, !s.on || busy)}
      <div class="tcp-hours" ${q && s.on ? '' : 'hidden'}>
        <span class="k-seg" role="group" aria-label="Quiet from">${HOURS_FROM.map(h => `<button type="button" data-from="${h}" aria-pressed="${q?.from === h}">${hh(h)}</button>`).join('')}</span>
        <span class="k-prose">to</span>
        <span class="k-seg" role="group" aria-label="Quiet until">${HOURS_TO.map(h => `<button type="button" data-to="${h}" aria-pressed="${q?.to === h}">${hh(h)}</button>`).join('')}</span>
      </div>
      <p class="tcp-note" role="status">${esc(note || (s.on ? 'Turns held during quiet hours arrive when they end.' : 'Off. The Herald won’t knock.'))}</p>`;
  };
  draw();
  el.addEventListener('change', async e => {
    const i = e.target as HTMLInputElement;
    const s = load();
    note = '';
    if (i.dataset.s === 'on') {
      busy = true; draw();
      try { if (i.checked) await enablePush(); else await disablePush(); }
      catch (err) { note = (err as Error).message; }
      busy = false;
    } else if (i.dataset.s === 'live') await updateSettings({ ...s, live: i.checked });
    else if (i.dataset.s === 'quiet') await updateSettings({ ...s, quiet: i.checked ? { from: 22, to: 8 } : null });
    draw();
  });
  el.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-from], [data-to]');
    if (!b) return;
    const s = load();
    const q = s.quiet ?? { from: 22, to: 8 };
    await updateSettings({ ...s, quiet: b.dataset.from !== undefined ? { ...q, from: Number(b.dataset.from) } : { ...q, to: Number(b.dataset.to) } });
    draw();
  });
  return { destroy: () => el.remove() };
}

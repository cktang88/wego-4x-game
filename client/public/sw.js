// Three Crowns service worker: Web Push only ("your turn", LIVE arrivals), no caching.
// Payload (server/push.ts PushPayload): { title, body, tag, url, game, kind, turn? }.
// Written as plain JS (served as-is from /sw.js; Vite copies client/public verbatim).
/* eslint-disable no-restricted-globals */

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

const DEFAULT = { title: 'The Herald', body: 'The table waits for your seal.', tag: 'three-crowns', url: '/', game: '', kind: 'turn' };

/** A same-origin path (browsers read '/\\host' as '//host'), else '/'. */
function ownUrl(u) {
  if (typeof u !== 'string' || !u.startsWith('/')) return '/';
  try { const x = new URL(u, self.location.origin); return x.origin === self.location.origin ? x.pathname + x.search + x.hash : '/'; } catch { return '/'; }
}

function parse(e) {
  if (!e.data) return DEFAULT;
  try {
    const p = e.data.json();
    return {
      title: typeof p.title === 'string' ? p.title.slice(0, 120) : DEFAULT.title,
      body: typeof p.body === 'string' ? p.body.slice(0, 300) : DEFAULT.body,
      tag: typeof p.tag === 'string' ? p.tag.slice(0, 120) : DEFAULT.tag,
      // only ever open our own pages
      url: ownUrl(p.url),
      game: typeof p.game === 'string' ? p.game.slice(0, 40) : '',
      kind: typeof p.kind === 'string' ? p.kind : 'turn',
    };
  } catch {
    return { ...DEFAULT, body: e.data.text().slice(0, 300) || DEFAULT.body };
  }
}

/** A focused, visible tab already showing this game? Then the page tells the player itself. */
async function watching(game) {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const here = tabs.filter(c => c.visibilityState === 'visible' && c.focused && game && decodeURIComponent(new URL(c.url).hash).startsWith(`#/g/${game}`));
  for (const c of here) c.postMessage({ type: 'tc-push', game });
  return here.length > 0;
}

self.addEventListener('push', e => {
  const p = parse(e);
  e.waitUntil((async () => {
    if (p.kind !== 'test' && await watching(p.game)) return;
    await self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      renotify: p.kind === 'turn' || p.kind === 'reminder',
      data: { url: p.url, game: p.game },
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2307080c'/%3E%3Cpath d='M10 46V22l11 11 11-19 11 19 11-11v24z' fill='%23c8964a'/%3E%3C/svg%3E",
      lang: 'en',
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(ownUrl(e.notification.data?.url), self.location.origin).href;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = tabs.find(c => c.url === url) ?? tabs.find(c => new URL(c.url).origin === self.location.origin);
    if (!same) return self.clients.openWindow(url);
    // focus first: the click's permission to raise a window does not outlast the awaits below
    const focused = await same.focus().catch(() => same);
    if (same.url === url) return focused;
    let moved = null;
    if ('navigate' in same) { try { moved = await same.navigate(url); } catch { /* not controlled by this worker */ } }
    // an uncontrolled tab can't be navigated from here: the page moves itself (main.ts listens for tc-open)
    if (!moved) same.postMessage({ type: 'tc-open', url });
    return focused;
  })());
});

// the browser rotated the subscription: tell the server (bindings are re-sent by the page on its next visit)
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const old = e.oldSubscription;
      if (old) await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: old.endpoint }) });
    } catch { /* offline: the page re-subscribes */ }
  })());
});

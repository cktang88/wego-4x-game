// Multiplayer smoke test against a running server: node scripts/mp-test.mjs [base]
import WebSocket from 'ws';
const base = process.argv[2] ?? 'http://localhost:8787';
const j = async (p, b) => (await fetch(base + p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : undefined)).json();
const g = await j('/api/games', { name: 'mp test', seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }] });
const toks = [];
for (let i = 0; i < 3; i++) toks.push((await j(`/api/games/${g.id}/join`, { seat: i, name: `P${i}` })).token);
console.log('created', g.id, 'join again ->', (await j(`/api/games/${g.id}/join`, { seat: 0, name: 'x' })).error);
// seat 0 over websocket, others over REST
const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?game=${g.id}&token=${toks[0]}`);
const views = [];
ws.on('message', m => { const d = JSON.parse(m); if (d.type === 'view') views.push(d); });
await new Promise(r => ws.on('open', r));
await new Promise(r => setTimeout(r, 300));
const v0 = views.at(-1).view;
console.log('ws view: you', v0.you, 'turn', v0.state.turn, 'rival res hidden', v0.state.players[1].res.industry === -1, 'fleets seen', v0.state.fleets.length);
const myFleet = v0.state.fleets.find(f => f.owner === 0);
const target = v0.state.regions[myFleet.region].neighbors.find(n => v0.state.regions[n].owner === null);
ws.send(JSON.stringify({ type: 'submit', submission: { orders: [{ type: 'seize', fleet: myFleet.id, target }, null, null, null, null], free: [] } }));
await new Promise(r => setTimeout(r, 200));
for (const i of [1, 2]) {
  const r = await j(`/api/games/${g.id}/orders`, { token: toks[i], submission: { orders: [null, null, null, null, null], free: [] } });
  console.log('rest submit seat', i, r);
}
await new Promise(r => setTimeout(r, 400));
const last = views.at(-1);
console.log('after resolve turn', last.view.state.turn, 'events', last.view.state.last?.events.length, 'captures', last.view.state.last?.events.filter(e => e.k === 'capture').length);
const bad = await j(`/api/games/${g.id}/orders`, { token: 'nope', submission: {} });
console.log('bad token ->', bad.error);
ws.close();

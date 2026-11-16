// Concurrency proof for the claim arbiter: N buyers tap Claim on the same item at the same moment.
//
//   npm run dev:mock            (or any running ClaimIt server)
//   npx tsx scripts/race.ts [N] [baseUrl]
//
// Run it against a local/mock server only: it creates a test shop and drop.
// Asserts: exactly one winner, a gap-free waitlist in tap order, everyone else told "full",
// the public state agrees with what each buyer was told, and releasing the winner promotes #1.
const N = Number(process.argv[2] || 200);
const BASE = process.argv[3] || process.env.BASE || 'http://localhost:8787';

type Json = Record<string, any>;
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json }> {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
let failed = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++; };

const s = (await call('POST', '/api/sellers', { name: 'Race', shop: 'Race Test Shop', currency: 'USD', upi: 'https://paypal.me/racetest' })).json;
const sh = { 'x-seller-id': s.id, 'x-seller-key': s.key };
const drop = (await call('POST', '/api/seller/drops', { title: `Race ×${N}` }, sh)).json;
const item = (await call('POST', `/api/seller/drops/${drop.id}/items`, { name: 'Contested jacket', price: 42 }, sh)).json;
await call('POST', `/api/seller/drops/${drop.id}/items/${item.id}/drop`, {}, sh);
const before = (await call('GET', `/api/drops/${drop.id}`)).json.state[item.id]?.v ?? 0;

const buyers = await Promise.all(Array.from({ length: N }, (_, i) => call('POST', '/api/buyers', { name: `Racer ${i + 1}` }).then((r) => r.json)));
console.log(`${N} buyers ready — firing ${N} simultaneous claims at ${BASE}`);

const t0 = performance.now();
const results = await Promise.all(buyers.map((b) =>
  call('POST', `/api/drops/${drop.id}/items/${item.id}/claim`, {}, { 'x-buyer-id': b.id, 'x-buyer-key': b.key }).then((r) => ({ b, ...r }))));
const ms = Math.round(performance.now() - t0);

const won = results.filter((r) => r.status === 200 && r.json.position === 0);
const waiting = results.filter((r) => r.status === 200 && r.json.position > 0);
const full = results.filter((r) => r.status === 409 && r.json.error === 'FULL');
const other = results.filter((r) => !won.includes(r) && !waiting.includes(r) && !full.includes(r));
console.log(`settled in ${ms} ms: ${won.length} winner, ${waiting.length} waiting, ${full.length} told "full", ${other.length} other`);

check(won.length === 1, 'exactly one winner');
const positions = waiting.map((r) => r.json.position).sort((a, b) => a - b);
check(positions.every((p, i) => p === i + 1), `waitlist positions are 1..${positions.length} with no gaps or duplicates`);
check(other.length === 0, `every other buyer got a clear "waitlist full" answer${other.length ? ` (unexpected: ${JSON.stringify(other[0]?.json)})` : ''}`);

const st = (await call('GET', `/api/drops/${drop.id}`)).json.state[item.id];
check(st.holder?.id === won[0]?.b.id, 'public state shows the same winner the winner was told');
const byPos = [...waiting].sort((a, b) => a.json.position - b.json.position).map((r) => r.b.id);
check(JSON.stringify(st.waitlist.map((w: Json) => w.id)) === JSON.stringify(byPos), 'public waitlist order matches each buyer\'s position');
check(st.v > before, `state version advanced (${before} → ${st.v})`);

// The winner lets it go: the first in line must be promoted, and only them.
const w = won[0]!;
await call('POST', `/api/claims/${w.json.id}/release`, {}, { 'x-buyer-id': w.b.id, 'x-buyer-key': w.b.key });
const after = (await call('GET', `/api/drops/${drop.id}`)).json.state[item.id];
check(after.holder?.id === byPos[0], 'releasing the winner promotes #1 in line');
check(after.waitlist.length === byPos.length - 1 && after.v > st.v, 'waitlist shrank by one and the version advanced again');

// Close vs. pay: once the holder says they paid, the seller can't pull the item out from under them.
const holder2 = buyers.find((b) => b.id === after.holder?.id)!;
const mine = (await call('GET', `/api/drops/${drop.id}/me`, undefined, { 'x-buyer-id': holder2.id, 'x-buyer-key': holder2.key })).json as Json[];
const hc = mine.find((c) => c.itemId === item.id && c.status === 'holding')!;
const paid = await call('POST', `/api/claims/${hc.id}/paid`, { utr: 'RACE', phone: '+14155550123', address: '1 Test Street, Testville', pincode: '94103' },
  { 'x-buyer-id': holder2.id, 'x-buyer-key': holder2.key });
check(paid.status === 200, 'holder can mark the item paid');
const closePaying = await call('POST', `/api/seller/drops/${drop.id}/items/${item.id}/close`, {}, sh);
check(closePaying.status === 409, 'closing an item whose buyer says they paid is refused');
await call('POST', `/api/seller/claims/${hc.id}/confirm`, {}, sh);
const sold = (await call('GET', `/api/drops/${drop.id}`)).json.state[item.id];
check(sold.status === 'sold' && sold.holder?.id === holder2.id, 'seller confirms: sold to the promoted buyer');
const closeSold = await call('POST', `/api/seller/drops/${drop.id}/items/${item.id}/close`, {}, sh);
const redrop = await call('POST', `/api/seller/drops/${drop.id}/items/${item.id}/drop`, {}, sh);
check(closeSold.status === 409 && redrop.status === 409, 'a sold item can be neither closed nor dropped again');

// Confirm vs. reject at the same instant: exactly one decision wins, the other is refused.
const item3 = (await call('POST', `/api/seller/drops/${drop.id}/items`, { name: 'Contested scarf', price: 12 }, sh)).json;
await call('POST', `/api/seller/drops/${drop.id}/items/${item3.id}/drop`, {}, sh);
const b3 = buyers[10]!; const bh3 = { 'x-buyer-id': b3.id, 'x-buyer-key': b3.key };
const c3 = (await call('POST', `/api/drops/${drop.id}/items/${item3.id}/claim`, {}, bh3)).json;
await call('POST', `/api/claims/${c3.id}/paid`, { utr: '', phone: '+14155550123', address: '1 Test Street, Testville', pincode: '94103' }, bh3);
const [conf, rej] = await Promise.all([
  call('POST', `/api/seller/claims/${c3.id}/confirm`, {}, sh), call('POST', `/api/seller/claims/${c3.id}/reject`, {}, sh)]);
check([conf.status, rej.status].filter((x) => x === 200).length === 1, `confirm and reject racing: exactly one wins (${conf.status}/${rej.status})`);

// Run again never copies an item someone is still holding in the old drop (no selling one piece twice).
const item4 = (await call('POST', `/api/seller/drops/${drop.id}/items`, { name: 'Held jacket', price: 30 }, sh)).json;
await call('POST', `/api/seller/drops/${drop.id}/items/${item4.id}/drop`, {}, sh);
const b4 = buyers[11]!;
await call('POST', `/api/drops/${drop.id}/items/${item4.id}/claim`, {}, { 'x-buyer-id': b4.id, 'x-buyer-key': b4.key });
await call('POST', `/api/seller/drops/${drop.id}/end`, {}, sh);
const again = (await call('POST', `/api/seller/drops/${drop.id}/again`, {}, sh)).json;
const againItems = (await call('GET', `/api/seller/drops/${again.id}`, undefined, sh)).json.items as Json[];
check(!againItems.some((i) => i.name === 'Held jacket') && again.skippedHeld >= 1, 'Run again skips the item still on hold in the old drop');
await call('POST', `/api/seller/drops/${again.id}/end`, {}, sh);
// Run again is refused while the drop is still live.
const live2 = (await call('POST', '/api/seller/drops', { title: 'Still live' }, sh)).json;
check((await call('POST', `/api/seller/drops/${live2.id}/again`, {}, sh)).status === 409, 'Run again on a live drop is refused');

// Every queue value in the room's metadata is signed by the server, and a forged value fails verification.
const { createPublicKey, verify } = await import('node:crypto');
const cfg = (await call('GET', '/api/config')).json;
if (cfg.mode === 'mock' && cfg.metaKey) {
  const pub = createPublicKey({ key: Buffer.from(cfg.metaKey, 'base64'), format: 'der', type: 'spki' });
  const ok = (ch: string, k: string, v: string) => {
    const { d, g } = JSON.parse(v);
    return verify('sha256', Buffer.from(`${ch}|${k}|${d}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(g, 'base64'));
  };
  const ch = `drop_${drop.id}`;
  const meta = (await call('GET', `/api/mock/metadata?channelId=${ch}`)).json as Record<string, string>;
  const k = `i_${item.id}`;
  check(!!meta[k] && ok(ch, k, meta[k]!), 'queue metadata carries a valid server signature');
  const forged = JSON.stringify({ ...JSON.parse(meta[k]!), d: JSON.stringify({ ...JSON.parse(JSON.parse(meta[k]!).d), holder: { id: 'b_attacker', name: 'Attacker' } }) });
  check(!ok(ch, k, forged), 'a forged queue value (fake holder) fails verification');
  check(!ok(`drop_${again.id}`, k, meta[k]!), 'a genuine value replayed into another room fails verification');
  // Replay in the SAME room: an older, genuinely signed drop state must lose to a newer one (clients keep the highest v).
  const ch2 = `drop_${live2.id}`;
  const it2 = (await call('POST', `/api/seller/drops/${live2.id}/items`, { name: 'Versioned tee', price: 9 }, sh)).json;
  await call('POST', `/api/seller/drops/${live2.id}/items/${it2.id}/drop`, {}, sh);
  await new Promise((r) => setTimeout(r, 300));
  const before2 = (await call('GET', `/api/mock/metadata?channelId=${ch2}`)).json as Record<string, string>;
  await call('POST', `/api/seller/drops/${live2.id}/end`, {}, sh);
  await new Promise((r) => setTimeout(r, 300));
  const after2 = (await call('GET', `/api/mock/metadata?channelId=${ch2}`)).json as Record<string, string>;
  const dv = (v?: string) => (v ? JSON.parse(JSON.parse(v).d).v ?? 0 : 0);
  check(!!before2.drop && !!after2.drop && ok(ch2, 'drop', before2.drop!) && ok(ch2, 'drop', after2.drop!) && dv(after2.drop) > dv(before2.drop),
    'drop state is versioned: the newer "ended" state outranks a replay of the older "live" one');
}
await call('POST', `/api/seller/drops/${live2.id}/end`, {}, sh);
// The public drop response keeps every field the room relies on (a stray comment once dropped these silently).
const demo = (await call('GET', '/api/drops/demo')).json;
check(demo.demo === true && typeof demo.currency === 'string' && !!demo.trust && typeof demo.drop?.v === 'number', 'public drop response includes demo flag, currency, trust and a versioned drop state');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed: no double-claims under contention.');
process.exit(failed ? 1 : 0);
export {};

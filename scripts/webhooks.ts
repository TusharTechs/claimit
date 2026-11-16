// Proof for the Nexconn webhook path: signature, replay protection, and the pre-message rules, using the payload
// shapes from Nexconn's webhook docs (direct channels: `userId` = sender, `channelId` = recipient).
//
// Start a local server with test keys and the mock transport, then run this with the same keys:
//   NEXCONN_APP_KEY=testkey NEXCONN_APP_SECRET=testsecret FORCE_MOCK=1 DATA_DIR=./data-webhooks npm run dev
//   NEXCONN_APP_KEY=testkey NEXCONN_APP_SECRET=testsecret npx tsx scripts/webhooks.ts
import crypto from 'node:crypto';

const B = process.argv[2] || 'http://localhost:8787';
const appKey = process.env.NEXCONN_APP_KEY || '';
const appSecret = process.env.NEXCONN_APP_SECRET || '';
if (!appKey || !appSecret) { console.error('Set NEXCONN_APP_KEY and NEXCONN_APP_SECRET (same as the server).'); process.exit(1); }

let failed = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++; };
const post = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
  (await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })).json();

/** Sends a webhook the way Nexconn does: sha1(AppSecret + Nonce + Timestamp) in the Signature header. */
async function hook(type: string, data: Record<string, unknown>, o: { nonce?: string; ts?: number; sig?: string } = {}) {
  const nonce = o.nonce ?? crypto.randomUUID();
  const ts = String(o.ts ?? Date.now());
  const sig = o.sig ?? crypto.createHash('sha1').update(appSecret + nonce + ts).digest('hex');
  const res = await fetch(B + '/api/nexconn/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', AppKey: appKey, Nonce: nonce, Timestamp: ts, Signature: sig },
    body: JSON.stringify({ type, id: crypto.randomUUID(), time: Date.now(), data: [{ appKey, ...data }] }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, any> };
}
/** A pre-messaging payload shaped like the documented example. */
const msg = (userId: string, channelId: string | undefined, messageType: string, content: unknown, channelType = 1) => ({
  userId, ...(channelId === undefined ? {} : { channelId }), channelType, messageType, content: JSON.stringify(content),
  pushContent: '', disablePush: false, pushConfig: '{}', isMetadata: false, time: Date.now(), messageId: 'msg_' + crypto.randomUUID(), os: 'Websocket', clientIp: '127.0.0.1:1',
});

// A shop with a live drop, a buyer who claimed from it, and a stranger buyer.
const shop = await post('/api/sellers', { name: 'Hook', shop: `Hook Test ${Date.now() % 1e5}`, currency: 'USD', upi: 'https://paypal.me/hooktest' });
const SH = { 'x-seller-id': shop.id, 'x-seller-key': shop.key };
const drop = await post('/api/seller/drops', { title: 'Webhook drop' }, SH);
const item = await post(`/api/seller/drops/${drop.id}/items`, { name: 'Test tee', price: 12 }, SH);
await post(`/api/seller/drops/${drop.id}/items/${item.id}/drop`, {}, SH);
const buyer = await post('/api/buyers', { name: 'Customer One' });
const other = await post('/api/buyers', { name: 'Stranger Two' });
await post(`/api/drops/${drop.id}/items/${item.id}/claim`, {}, { 'x-buyer-id': buyer.id, 'x-buyer-key': buyer.key });
const other_shop = await post('/api/sellers', { name: 'Rogue', shop: `Rogue Shop ${Date.now() % 1e5}`, currency: 'USD', upi: 'https://paypal.me/rogueshop' });
const shopUser = `s_${shop.id}`;
const room = `drop_${drop.id}`;

// --- Authenticity
check((await hook('user:connection_status', { status: '0', userId: buyer.id, os: 'Websocket', time: Date.now() })).status === 200, 'a correctly signed webhook is accepted');
check((await hook('user:connection_status', { status: '0', userId: buyer.id }, { sig: 'deadbeef' })).status === 401, 'a wrong signature is rejected');
check((await hook('user:connection_status', { status: '0', userId: buyer.id }, { ts: Date.now() - 10 * 60_000 })).status === 401, 'a signature older than 5 minutes is rejected');
const nonce = crypto.randomUUID(); const ts = Date.now();
await hook('user:connection_status', { status: '0', userId: buyer.id }, { nonce, ts });
check((await hook('user:connection_status', { status: '1', userId: buyer.id }, { nonce, ts })).status === 401, 'captured headers replayed with a different body are rejected');

// --- Direct messages (direct_channel:pre_messaging)
const dm = async (from: string, to: string | undefined, type: string, content: unknown = { content: 'hi' }) => (await hook('direct_channel:pre_messaging', msg(from, to, type, content))).json.pass;
check((await dm(buyer.id, shopUser, 'RC:TxtMsg')) === 1, 'a buyer can message the shop');
check((await dm(buyer.id, other.id, 'RC:TxtMsg')) === 0, 'a buyer cannot message another buyer');
check((await dm(buyer.id, undefined, 'RC:TxtMsg')) === 0, 'a buyer message with no recipient is not delivered');
check((await dm(buyer.id, shopUser, 'CI:Order', { claimId: 'x' })) === 0, 'a buyer cannot send an order card');
check((await dm(shopUser, buyer.id, 'CI:Order', { claimId: 'x' })) === 1, "a shop can send an order card to its own customer");
check((await dm(`s_${other_shop.id}`, buyer.id, 'CI:Order', { claimId: 'x' })) === 0, "a shop cannot send order cards to another shop's customer");

// --- Room chat (open_channel:pre_messaging)
const chat = async (from: string, type: string, content: unknown) => (await hook('open_channel:pre_messaging', msg(from, room, type, content, 4))).json;
check((await chat(buyer.id, 'CI:Chat', { text: 'is it true to size?', name: 'Customer One' })).pass === 1, 'ordinary room chat passes');
const spoof = await chat(buyer.id, 'CI:Chat', { text: 'hello', name: shop.shop });
check(spoof.pass === 1 && JSON.parse(spoof.replaceContent || '{}').name === 'Customer One', "a sender name faked as the shop's is replaced with the real one");
const scam = await chat(other.id, 'CI:Chat', { text: 'pay me at scammer@okaxis instead', name: 'Stranger Two' });
check(scam.pass === 1 && String(JSON.parse(scam.replaceContent || '{}').text).includes('•••') && !String(scam.replaceContent).includes('okaxis'), 'payment details in room chat are masked before delivery');
check((await chat(buyer.id, 'CI:Event', { kind: 'sold', text: 'SOLD to me' })).pass === 0, 'a buyer cannot post a fake claim event');
check((await chat(buyer.id, 'CI:Drop', { name: 'Fake item', price: 1 })).pass === 0, 'a buyer cannot post a fake product drop');
check((await chat(shopUser, 'CI:SellerChat', { text: 'Welcome!', name: shop.shop })).pass === 1, "the shop's own messages pass");

await post(`/api/seller/drops/${drop.id}/end`, {}, SH);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll webhook checks passed.');
process.exit(failed ? 1 : 0);

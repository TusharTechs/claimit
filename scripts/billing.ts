// Pro billing proof against a local server started with the same webhook secret:
//
//   DODO_PRO_LINK=https://test.checkout.dodopayments.com/buy/pdt_x DODO_WEBHOOK_SECRET=whsec_... npm run dev:mock
//   DODO_WEBHOOK_SECRET=whsec_... npx tsx scripts/billing.ts
//
// Sends signed Dodo webhooks (Standard Webhooks) and checks the Pro time a shop ends up with.
import crypto from 'node:crypto';

const B = process.argv[2] || 'http://localhost:8787';
const secret = process.env.DODO_WEBHOOK_SECRET;
if (!secret) { console.error('Set DODO_WEBHOOK_SECRET (same as the server).'); process.exit(1); }

let failed = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++; };
const post = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
  (await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })).json();

const shop = await post('/api/sellers', { name: 'Billing', shop: `Billing Test ${Date.now() % 1e5}`, currency: 'USD', upi: 'https://paypal.me/billingtest' });
const H = { 'x-seller-id': shop.id, 'x-seller-key': shop.key };
const session = async () => post('/api/seller/session', {}, H);
const days = async () => { const u = (await session()).proUntil as number | null; return u && u > Date.now() ? Math.round((u - Date.now()) / 86_400_000) : 0; };
const price: number = (await session()).proPrice;

const send = async (type: string, data: Record<string, unknown>, sig?: string, msgId?: string) => {
  const raw = JSON.stringify({ business_id: 'bus_test', type, timestamp: new Date().toISOString(), data });
  const id = msgId ?? 'msg_' + crypto.randomUUID();
  const ts = String(Math.floor(Date.now() / 1000));
  const good = crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${raw}`).digest('base64');
  const r = await fetch(B + '/api/dodo/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig ?? `v1,${good}` }, body: raw });
  return r.status;
};
const pay = (id: string, cents: number, currency = 'USD') => send('payment.succeeded', { payment_id: id, total_amount: cents, currency, metadata: { sellerId: shop.id, kind: 'claimit_pro' } });
const u = `${shop.id}_${Date.now()}`;

check((await send('payment.succeeded', { payment_id: 'forged' }, 'v1,AAAA')) === 401, 'a forged signature is rejected');
await pay(`half_${u}`, Math.round(price * 50));
check((await days()) === 15, `half the price ($${price / 2}) buys 15 days`);
await pay(`half_${u}`, Math.round(price * 50));
check((await days()) === 15, 'the same payment delivered twice counts once');
await pay(`full_${u}`, Math.round(price * 100));
check((await days()) === 45, 'a full payment adds 30 more days');
const rid = 'msg_refund_' + u;
await send('refund.succeeded', { payment_id: `full_${u}`, amount: Math.round(price * 50), currency: 'USD' }, undefined, rid);
check((await days()) === 30, 'a half refund of that payment takes back 15 days');
await send('refund.succeeded', { payment_id: `full_${u}`, amount: Math.round(price * 50), currency: 'USD' }, undefined, rid);
check((await days()) === 30, 'the same refund event delivered again is applied once');
await send('dispute.opened', { payment_id: `full_${u}` });
check((await days()) === 15, 'a dispute on the partly refunded payment takes back its remaining 15 days');
await send('dispute.won', { payment_id: `full_${u}` });
check((await days()) === 30, 'winning the dispute restores exactly the time it removed');
await send('refund.succeeded', { payment_id: `full_${u}`, amount: Math.round(price * 100), currency: 'USD' });
check((await days()) === 15, 'refunding the rest after a won dispute takes back its remaining 15 days');
// Refund while a dispute is open: a later won dispute restores only what wasn't refunded.
await pay(`disp_${u}`, Math.round(price * 100));
check((await days()) === 45, 'another full payment adds 30 days');
await send('dispute.opened', { payment_id: `disp_${u}` });
check((await days()) === 15, 'a dispute takes those 30 days away');
await send('refund.succeeded', { payment_id: `disp_${u}`, amount: Math.round(price * 50), currency: 'USD' });
await send('dispute.won', { payment_id: `disp_${u}` });
check((await days()) === 30, 'after half was refunded during the dispute, winning it restores only the other 15 days');
await pay(`xyz_${u}`, 1200, 'XYZ');
const bill = await (await fetch(B + '/api/seller/pro/billing', { headers: H })).json();
check((await days()) === 30 && String(bill.pending?.ref || '').includes('review'), 'a payment in a currency without a known rate grants nothing and waits in the review queue');


// Operator approval (needs ADMIN_KEY, the same as the server's): a USD value is required and buys proportional days.
const adminKey = process.env.ADMIN_KEY;
if (adminKey) {
  const AH = { 'x-admin-key': adminKey, 'content-type': 'application/json' };
  const list = await (await fetch(B + '/api/admin/payments', { headers: AH })).json() as { id: string; sellerId: string; status: string }[];
  const pend = list.find((x) => x.sellerId === shop.id && x.status === 'pending');
  const blank = await fetch(B + `/api/admin/payments/${pend?.id}/decide`, { method: 'POST', headers: AH, body: JSON.stringify({ confirm: true }) });
  check(blank.status === 400, 'approving an unpriced payment without a USD value is refused');
  await fetch(B + `/api/admin/payments/${pend?.id}/decide`, { method: 'POST', headers: AH, body: JSON.stringify({ confirm: true, usd: price / 2 }) });
  check((await days()) === 45, `approving it at $${price / 2} (half the price) adds 15 days`);
}

// --- Auto-renewing subscription (a second shop): payments add the time, subscription events track the state.
const shop2 = await post('/api/sellers', { name: 'Sub', shop: `Sub Test ${Date.now() % 1e5}`, currency: 'USD', upi: 'https://paypal.me/subtest' });
const H2 = { 'x-seller-id': shop2.id, 'x-seller-key': shop2.key };
const sess2 = async () => post('/api/seller/session', {}, H2);
const days2 = async () => { const x = (await sess2()).proUntil as number | null; return x && x > Date.now() ? Math.round((x - Date.now()) / 86_400_000) : 0; };
const price2: number = (await sess2()).proPrice;
const subId = `sub_${shop2.id}`;
const meta2 = { sellerId: shop2.id, kind: 'claimit_pro' };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

await send('subscription.active', { subscription_id: subId, status: 'active', next_billing_date: inDays(31), cancel_at_next_billing_date: false, metadata: meta2 });
await send('payment.succeeded', { payment_id: `s1_${u}`, subscription_id: subId, total_amount: Math.round(price2 * 100), currency: 'USD', metadata: meta2 });
let a2 = await sess2();
check((await days2()) === 31 && a2.sub?.status === 'active' && !a2.sub.cancelAtEnd && a2.sub.renewsAt > Date.now(), 'subscribing turns Pro on for the month and shows the renewal date');
// A renewal charge carries only the subscription id (no checkout metadata): it must still reach the right shop.
await send('payment.succeeded', { payment_id: `s2_${u}`, subscription_id: subId, total_amount: Math.round(price2 * 100), currency: 'USD' });
await send('subscription.renewed', { subscription_id: subId, status: 'active', next_billing_date: inDays(62), cancel_at_next_billing_date: false });
check((await days2()) === 62, 'a renewal charge identified only by its subscription id adds the next month');
await send('subscription.on_hold', { subscription_id: subId, status: 'on_hold' });
a2 = await sess2();
check(a2.sub?.status === 'on_hold' && (await days2()) === 62, 'a failed renewal marks the subscription on hold without taking paid time away');
await send('subscription.cancelled', { subscription_id: subId, status: 'cancelled', cancelled_at: new Date().toISOString() });
a2 = await sess2();
check(a2.sub?.status === 'cancelled' && a2.sub.cancelAtEnd && (await days2()) === 62, 'cancelling keeps the days already paid for');
const before = await days();
check((await send('payment.succeeded', { payment_id: `stray_${u}`, subscription_id: 'sub_nobody', total_amount: 900, currency: 'USD' })) === 200 && (await days()) === before,
  'a charge for an unknown subscription is acknowledged and changes nothing');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll billing checks passed.');
process.exit(failed ? 1 : 0);

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

const send = async (type: string, data: Record<string, unknown>, sig?: string) => {
  const raw = JSON.stringify({ business_id: 'bus_test', type, timestamp: new Date().toISOString(), data });
  const id = 'msg_' + crypto.randomUUID();
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
await send('refund.succeeded', { payment_id: `full_${u}`, amount: Math.round(price * 50), currency: 'USD' });
check((await days()) === 30, 'a half refund of that payment takes back 15 days');
await send('dispute.opened', { payment_id: `full_${u}` });
check((await days()) === 15, 'a dispute on the partly refunded payment takes back its remaining 15 days');
await send('dispute.won', { payment_id: `full_${u}` });
check((await days()) === 30, 'winning the dispute restores exactly the time it removed');
await send('refund.succeeded', { payment_id: `full_${u}`, amount: Math.round(price * 100), currency: 'USD' });
check((await days()) === 15, 'refunding the rest after a won dispute takes back its remaining 15 days');
await pay(`xyz_${u}`, 1200, 'XYZ');
const bill = await (await fetch(B + '/api/seller/pro/billing', { headers: H })).json();
check((await days()) === 15 && String(bill.pending?.ref || '').includes('review'), 'a payment in a currency without a known rate grants nothing and waits in the review queue');


console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll billing checks passed.');
process.exit(failed ? 1 : 0);

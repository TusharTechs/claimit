// Seeds a realistic demo drop for screenshots and the demo video.
//   npm run seed:demo                      (against http://localhost:8787, mock mode)
//   BASE=http://localhost:8787 npm run seed:demo
// Refuses to run against a Nexconn-mode server unless ALLOW_NEXCONN=1, so demo users never inflate real MAU.
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8787';
const IMG_DIR = path.resolve('scripts/demo-images');

async function call<T = any>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}
const img = (file: string) => `data:image/jpeg;base64,${fs.readFileSync(path.join(IMG_DIR, file)).toString('base64')}`;

const cfg = await call('GET', '/api/config');
if (cfg.mode === 'nexconn' && process.env.ALLOW_NEXCONN !== '1') {
  console.error('Server is in Nexconn mode — demo users would count as real active users. Run the server in mock mode, or set ALLOW_NEXCONN=1.');
  process.exit(1);
}

const seller = await call('POST', '/api/sellers', { name: 'Asha', shop: "Asha's Thrift Closet", upi: 'asha.thrift@okicici' });
const S = { 'x-seller-id': seller.id, 'x-seller-key': seller.key };
const drop = await call('POST', '/api/seller/drops', { title: 'Sunday thrift drop · 6 hand-picked pieces', holdMinutes: 5 }, S);

const catalog = [
  ['Vintage denim jacket · M', 899, 'denim-jacket.jpg'],
  ['Hand-block floral kurti · S', 549, 'floral-kurti.jpg'],
  ['Canvas tote, unused', 299, 'canvas-tote.jpg'],
  ['Oxidised silver jhumkas', 349, 'silver-jhumkas.jpg'],
  ['White court sneakers · UK 7', 1199, 'white-sneakers.jpg'],
  ['Monstera in terracotta pot', 450, 'monstera-plant.jpg'],
] as const;
const items: { id: string; name: string }[] = [];
for (const [name, price, file] of catalog) items.push(await call('POST', `/api/seller/drops/${drop.id}/items`, { name, price, image: img(file) }, S));

const buyer = async (name: string) => {
  const b = await call('POST', '/api/buyers', { name });
  const H = { 'x-buyer-id': b.id, 'x-buyer-key': b.key };
  await call('POST', `/api/drops/${drop.id}/join`, {}, H);
  return { ...b, H };
};
const [priya, kavya, rahul, meera, arjun, sana] = await Promise.all(['Priya', 'Kavya', 'Rahul', 'Meera', 'Arjun', 'Sana'].map(buyer));

// #1 jacket: claimed by Priya, paid with delivery details, confirmed → SOLD
await call('POST', `/api/seller/drops/${drop.id}/items/${items[0].id}/drop`, {}, S);
const c1 = await call('POST', `/api/drops/${drop.id}/items/${items[0].id}/claim`, {}, priya.H);
await call('POST', `/api/drops/${drop.id}/items/${items[0].id}/claim`, {}, arjun.H);
await call('POST', `/api/claims/${c1.id}/paid`, { utr: '431209876512', phone: '9876500011', address: 'B-204, Lake View Apartments, Koramangala, Bengaluru', pincode: '560034' }, priya.H);
await call('POST', `/api/seller/claims/${c1.id}/confirm`, {}, S);

// #2 kurti: Kavya holds it, Rahul and Meera wait in line
await call('POST', `/api/seller/drops/${drop.id}/items/${items[1].id}/drop`, {}, S);
await call('POST', `/api/drops/${drop.id}/items/${items[1].id}/claim`, {}, kavya.H);
await call('POST', `/api/drops/${drop.id}/items/${items[1].id}/claim`, {}, rahul.H);
await call('POST', `/api/drops/${drop.id}/items/${items[1].id}/claim`, {}, meera.H);

// #3 tote: just dropped, open for the first tap
await call('POST', `/api/seller/drops/${drop.id}/items/${items[2].id}/drop`, {}, S);
void sana;

const web = process.env.WEB || 'http://localhost:5173';
console.log(`\nDemo drop ready.
  Buyer room:  ${web}/d/${drop.id}?as=demo
  Seller login: ${web}/sell/login#${seller.id}.${seller.key}
  Seller console (after login): ${web}/sell/${drop.id}\n`);

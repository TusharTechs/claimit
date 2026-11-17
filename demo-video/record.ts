// Drives the whole demo on a running ClaimIt (BASE), recording six real browsers at once.
//   BASE=https://… ADMIN_KEY=… npx tsx record.ts
// Nothing is scripted about who wins the race: the script reads the result off the screens and follows it.
import fs from 'node:fs';
import path from 'node:path';
import { Actor, mark, marks, sleep } from './lib/rec.ts';

const BASE = (process.env.BASE || 'http://localhost:8797').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const RUN = path.join('raw', process.env.RUN || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const PHOTOS = ['canvas-tote.jpg', 'denim-jacket.jpg', 'floral-kurti.jpg'].map((f) => path.resolve('../web/public/demo', f));
const ITEMS = [['Canvas tote', '18'], ['Vintage denim jacket · M', '42'], ['Floral summer dress · S', '29']] as const;
const SHIP = { phone: '+1 415 555 0123', address: '221 Valencia St, San Francisco, CA', zip: '94103' };

fs.mkdirSync(RUN, { recursive: true });
const t0 = Date.now();
const facts: Record<string, unknown> = { base: BASE, startedAt: t0 };
const step = async (name: string, fn: () => Promise<void>) => {
  console.log(`\n▶ ${name}  (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  try { await fn(); } catch (e) { console.error(`  ✗ ${name}: ${(e as Error).message.split('\n')[0]}`); facts[`failed:${name}`] = (e as Error).message.split('\n')[0]; }
};

const phone = { width: 390, height: 844, dsf: 2, mobile: true };
const [seller, feed, b1, b2, b3, b4] = await Promise.all([
  Actor.launch('seller', RUN, { width: 1280, height: 800, dsf: 1.5 }),
  Actor.launch('feed', RUN, { width: 900, height: 560, dsf: 2, trace: false }),
  Actor.launch('buyer1', RUN, phone), Actor.launch('buyer2', RUN, phone), Actor.launch('buyer3', RUN, phone), Actor.launch('buyer4', RUN, phone),
]);
const buyers = [b1, b2, b3];
const names = new Map<Actor, string>([[b1, 'Priya'], [b2, 'Leo'], [b3, 'Mei'], [b4, 'FastDeals']]);
mark('rolling');

/** Opens a link that pops a new tab (the seller's payment link) and closes the tab again. */
async function clickPopup(a: Actor, loc: ReturnType<Actor['text']>) {
  // The link leaves for the seller's own payment page (PayPal etc.) in a new tab. That tab is not part of the app, and opening
  // it resizes the recorded window, so the press is real but the new tab is held back.
  await loc.first().evaluate((el) => el.addEventListener('click', (e) => e.preventDefault(), { capture: true, once: true }));
  await a.click(loc);
}
async function fillShipping(a: Actor) {
  await a.type('input[id^="ph-"]', SHIP.phone, { delay: 22 });
  await a.type('textarea[id^="ad-"]', SHIP.address, { delay: 16 });
  await a.type('input[id^="pin-"]', SHIP.zip, { delay: 30 });
  await a.click(a.button('Save address'));
}
async function payAndTell(a: Actor) {
  await clickPopup(a, a.page.getByRole('link', { name: /^Pay \$/ }));
  await sleep(700);
  await a.click(a.button(/I've paid/));
}
async function nameAndClaim(a: Actor, trigger: RegExp) {
  await a.click(a.button(trigger), { pause: 500 });
  await a.type('#buyer-name', names.get(a)!, { delay: 70 });
  await a.click(a.button('Claim it'));
}
async function sellerConfirms(label: string) {
  await seller.click(seller.button('Payment received'), { timeout: 30_000 });
  await seller.click(seller.page.getByRole('dialog').getByRole('button', { name: 'Yes, payment received' }));
  mark(label);
}
/** Close the top sheet with its ✕ button (the backdrop also answers to "Close", but sits under the sheet). */
const closeSheet = async (a: Actor) => {
  const x = a.page.locator('[role="dialog"] button.size-9[aria-label="Close"]').last();
  if (await x.isVisible().catch(() => false)) await a.click(x);
};
const say = async (a: Actor, text: string) => {
  await a.type(a.page.getByPlaceholder(/Ask about size|Message the room/), text, { delay: 30, pause: 200 });
  await a.page.keyboard.press('Enter');
  await sleep(900);
};

let dropId = '';

// What the server and Nexconn say to each other during the run (Platform API calls out, webhooks in), collected as it happens.
type Act = { t: number; dir: string; what: string; ms?: number; code?: number | string; note?: string };
const acts: Act[] = [];
let actMode = '';
let actSince = t0 - 5000; // server time; trimmed to the run once the clock offset is known
let skew = 0, bestRtt = Infinity; // server clock minus this machine's clock, from the fastest round trip seen
const pollActivity = async () => {
  const sent = Date.now();
  const r = await fetch(`${BASE}/api/admin/nexconn?since=${actSince}`, { headers: { 'x-admin-key': ADMIN_KEY } }).then((x) => x.json()).catch(() => null) as { mode: string; now: number; events: Act[] } | null;
  const got = Date.now();
  if (!r?.events) return;
  if (got - sent < bestRtt) { bestRtt = got - sent; skew = r.now - (sent + got) / 2; }
  actMode = r.mode;
  for (const e of r.events) if (e.t > actSince) acts.push(e);
  if (r.events.length) actSince = Math.max(actSince, ...r.events.map((e) => e.t));
};
const actTimer = setInterval(() => { void pollActivity(); }, 4000);
/** Bring the room chat into view on a phone (it sits under the item card), or go back to the top. */
const toChat = (a: Actor) => a.page.locator('[role="log"]').first().evaluate((el) => el.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' })).catch(() => {});
const toTop = (a: Actor) => a.page.locator('[role="log"]').first().evaluate((el) => (el.closest('.overflow-y-auto') as HTMLElement | null)?.scrollTo({ top: 0, behavior: 'smooth' })).catch(() => {});

await step('operator opens the live Nexconn feed', async () => {
  await feed.page.goto(`${BASE}/admin?feed=1`);
  if (!ADMIN_KEY) throw new Error('no ADMIN_KEY');
  await feed.page.fill('#admin-key', ADMIN_KEY); // typed off-camera speed: it's a secret, shown as dots
  await feed.click(feed.button('Open'));
  await feed.text('Nexconn activity').waitFor({ timeout: 15_000 });
  mark('feed_open');
});

await step('seller sets up a shop', async () => {
  await seller.page.goto(`${BASE}/sell`);
  await seller.text('Set up your shop').waitFor();
  await sleep(900);
  mark('onboard_start');
  await seller.type(seller.page.getByPlaceholder('Asha', { exact: true }), 'Maya');
  await seller.type(seller.page.getByPlaceholder("Asha's Thrift Closet"), "Maya's Vintage");
  await seller.type('form textarea', 'https://paypal.me/mayasvintage', { delay: 22 });
  await seller.click(seller.button('Create my shop'));
  await seller.text(/is ready/).waitFor();
  mark('shop_ready');
  await sleep(900);
  await seller.click(seller.button('Copy login link'));
  await seller.click(seller.button('Go to my shop'));
  await seller.text('Start a new drop').waitFor();
});

await step('seller opens a drop and adds items', async () => {
  mark('drop_form');
  await seller.type(seller.page.getByPlaceholder(/Sunday thrift drop/), 'Sunday vintage drop');
  await seller.page.locator('form select').first().selectOption('2'); // 2 minutes to pay
  await sleep(500);
  await seller.click(seller.button('Create drop room'));
  await seller.page.waitForURL(/\/sell\/[a-z0-9]+$/);
  dropId = seller.page.url().split('/').pop()!;
  facts.dropId = dropId;
  await seller.text('SHARE THIS LINK').waitFor();
  mark('console_open');
  await sleep(1200);
  await seller.page.setInputFiles('input[type="file"]', PHOTOS);
  await sleep(1200);
  for (const [name, price] of ITEMS) {
    await seller.type('#item-name', name, { delay: 26 });
    await seller.type('#item-price', price, { delay: 60 });
    await seller.click(seller.button('Add'), { pause: 900 });
  }
  mark('items_ready');
});

await step('three buyers open the link', async () => {
  for (const b of buyers) { await b.page.goto(`${BASE}/d/${dropId}`); await sleep(350); }
  await Promise.all(buyers.map((b) => b.text('The drop starts soon').waitFor({ timeout: 30_000 })));
  await b4.page.goto(`${BASE}/d/${dropId}`);
  mark('buyers_in');
  await sleep(2500);
});

await step('item 1: join with a name, win, check out in chat', async () => {
  mark('drop1');
  await seller.click(seller.button(/Drop next/));
  await Promise.all(buyers.map((b) => b.button(/CLAIM ·/).waitFor({ timeout: 20_000 })));
  mark('drop1_seen');
  await sleep(1200);
  await nameAndClaim(b1, /CLAIM ·/);
  await b1.text(/IT'S YOURS/).first().waitFor({ timeout: 15_000 });
  mark('claim1_won');
  await sleep(1400);
  // The other two join the line, so the queue is visible on every screen.
  await nameAndClaim(b2, /Join the line/);
  await nameAndClaim(b3, /Join the line/);
  await b3.text(/You're #2 in line/).waitFor({ timeout: 15_000 });
  mark('queue1_visible');
  await sleep(1500);
  // Winner checks out: delivery details, pay the seller directly, tell the seller.
  if (!(await b1.text('Deliver to').isVisible().catch(() => false))) await b1.click(b1.button(/IT'S YOURS/));
  mark('checkout1');
  await fillShipping(b1);
  await payAndTell(b1);
  mark('paid1');
  await sleep(1200);
  await sellerConfirms('sold1');
  await b1.text(/Payment confirmed/).first().waitFor({ timeout: 15_000 });
  await sleep(1500);
  // The order chat: one card whose status changed in place.
  await b1.click(b1.button(/Message Maya/));
  mark('orderchat1');
  await sleep(3500);
  await closeSheet(b1);
});

let winner = b1, first = b2, second = b3;
await step('item 2: three phones tap at the same instant', async () => {
  await sleep(800);
  mark('drop2');
  await seller.click(seller.button(/Drop next/));
  const btns = buyers.map((b) => b.button(/CLAIM ·/));
  await Promise.all(btns.map((l) => l.waitFor({ timeout: 20_000 })));
  mark('drop2_seen');
  // Everyone hovers over the button…
  const boxes = await Promise.all(btns.map((l) => l.boundingBox()));
  await Promise.all(buyers.map((b, i) => b.page.mouse.move(boxes[i]!.x + boxes[i]!.width / 2, boxes[i]!.y + boxes[i]!.height / 2, { steps: 14 })));
  await sleep(1300);
  // …and taps in the same few milliseconds.
  mark('race');
  const taps = await Promise.all(buyers.map(async (b) => { const at = performance.now(); await b.page.mouse.down(); await b.page.mouse.up(); return at; }));
  await Promise.all(buyers.map((b) => b.text(/IT'S YOURS|in line/).first().waitFor({ timeout: 15_000 })));
  await sleep(600);
  const won = await Promise.all(buyers.map((b) => b.text(/IT'S YOURS/).first().isVisible().catch(() => false)));
  winner = buyers[won.indexOf(true)] ?? b1;
  const rest = buyers.filter((b) => b !== winner);
  const isFirst = await rest[0]!.text(/You're #1 in line/).first().isVisible().catch(() => false);
  [first, second] = isFirst ? [rest[0]!, rest[1]!] : [rest[1]!, rest[0]!];
  facts.race = { winner: names.get(winner), first: names.get(first), second: names.get(second), winners: won.filter(Boolean).length,
    spreadMs: +(Math.max(...taps) - Math.min(...taps)).toFixed(2), taps: Object.fromEntries(buyers.map((x, i) => [names.get(x), +(taps[i]! - Math.min(...taps)).toFixed(2)])) };
  mark('race_done', facts.race);
  await sleep(5200);
  // The winner gets distracted and never pays: close the order sheet if it opened.
  await closeSheet(winner);
});

await step('meanwhile: a scammer tries the room chat', async () => {
  await Promise.all([first, second, b4].map(toChat));
  await sleep(900);
  await say(first, 'Is the jacket true to size?');
  mark('scam_start');
  await say(b4, 'DM me to pay direct, cheaper: +1 415 555 0142');
  await say(b4, 'or send to paypal.me/fastdeals-official');
  await say(b4, 'pay here instead → fastdeals@okpay');
  await say(b4, 'hello? anyone?');
  mark('scam_end');
  await sleep(2500);
});

await step('seller answers the room', async () => {
  await seller.click(seller.page.getByRole('tab', { name: /Room/ }));
  mark('seller_room');
  await sleep(1500);
  await seller.type(seller.page.getByPlaceholder('Reply to the room…'), 'Yes, true to M. Only ever pay through your ClaimIt order 🙏', { delay: 24 });
  await seller.page.keyboard.press('Enter');
  mark('seller_reply');
  await sleep(2500);
  // Desktop inbox (Nexconn Chat UI kit) when it is available.
  const inbox = seller.page.getByRole('banner').getByRole('button', { name: /Inbox/ });
  if (await inbox.isVisible().catch(() => false)) {
    await seller.click(inbox);
    mark('inbox_open');
    await sleep(2500);
    // Chat UI renders its list as <nc-channel-list-item> web components.
    const rows = seller.page.locator('nc-channel-list-item');
    if (await rows.first().waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)) {
      await sleep(700);
      const priya = rows.filter({ hasText: 'Priya' }).first();
      await seller.click((await priya.isVisible().catch(() => false)) ? priya : rows.first());
      mark('inbox_chat');
      await sleep(5000);
    }
    mark('inbox_seen');
    await seller.click(seller.page.locator('[role="dialog"][aria-label="Inbox"]').getByRole('button', { name: 'Close', exact: true }));
  }
  await seller.click(seller.page.getByRole('tab', { name: /Payments/ }));
});

await step('the winner never pays: next in line is promoted', async () => {
  await sleep(2500);
  await Promise.all([first, second, b4].map(toTop));
  mark('waiting_expiry');
  await first.text("You're up!").waitFor({ timeout: 170_000 });
  mark('promoted', { to: names.get(first) });
  await sleep(3200);
  await first.click(first.button(/IT'S YOURS/), { timeout: 20_000 });
  mark('checkout2');
  await fillShipping(first);
  await payAndTell(first);
  mark('paid2');
  await sleep(1000);
  await sellerConfirms('sold2');
  await first.text(/Payment confirmed/).first().waitFor({ timeout: 15_000 });
  await sleep(2000);
  await closeSheet(first);
});

await step('seller ends the drop: the recap', async () => {
  await seller.click(seller.page.getByRole('button', { name: 'End drop', exact: true }).first());
  await seller.click(seller.page.getByRole('dialog').getByRole('button', { name: 'End drop' }));
  await seller.text('Drop recap').waitFor({ timeout: 15_000 });
  await seller.text('Drop recap').scrollIntoViewIfNeeded();
  mark('recap');
  await sleep(4500);
  const follow = second.button(/Follow Maya/);
  if (await follow.isVisible().catch(() => false)) { await second.click(follow); mark('followed'); await sleep(2500); }
});

let scheduledId = '';
await step('Pro: trial, co-host, scheduled drop, checkout', async () => {
  await seller.page.goto(`${BASE}/sell`);
  await seller.text('Go live with a co-host').scrollIntoViewIfNeeded();
  mark('pro_card');
  await sleep(1500);
  await seller.click(seller.button(/Start 14-day free trial/));
  await seller.text('Your team').waitFor({ timeout: 15_000 });
  mark('pro_on');
  await sleep(1200);
  await seller.type(seller.page.getByPlaceholder(/Co-host name/), 'Riya');
  await seller.click(seller.button(/^Add$|Add$/).last());
  await seller.text(/private login link/).waitFor({ timeout: 10_000 });
  mark('cohost_added');
  await sleep(3000);
  // Schedule the next drop three days out at 7 pm.
  await seller.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(900);
  await seller.type(seller.page.getByPlaceholder(/Sunday thrift drop/), 'Friday night drop');
  const d = new Date(Date.now() + 3 * 86_400_000); d.setHours(19, 0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await seller.page.fill('input[type="datetime-local"]', local);
  await sleep(900);
  await seller.click(seller.button('Schedule drop'));
  await seller.page.waitForURL(/\/sell\/[a-z0-9]+$/);
  scheduledId = seller.page.url().split('/').pop()!;
  mark('scheduled_console');
  await sleep(2200);
  await second.page.goto(`${BASE}/d/${scheduledId}`);
  await second.text('Scheduled drop').waitFor({ timeout: 20_000 });
  mark('scheduled_buyer');
  await sleep(4000);
  // Paying for Pro: the checkout is run by Dodo Payments.
  await seller.page.goto(`${BASE}/sell`);
  const keep = seller.button(/Keep Pro after the trial/);
  await keep.scrollIntoViewIfNeeded();
  await seller.click(keep);
  await seller.text('Get ClaimIt Pro').waitFor();
  mark('pay_sheet');
  await sleep(3500);
  const go = seller.page.getByRole('link', { name: /Subscribe ·|securely/ });
  if (await go.isVisible().catch(() => false)) {
    await seller.click(go);
    await seller.page.waitForURL(/dodopayments\.com/, { timeout: 25_000 });
    await seller.page.waitForLoadState('networkidle').catch(() => {});
    mark('dodo_checkout');
    await sleep(5000);
  }
});

await step('operator page: revenue and payments', async () => {
  await feed.page.goto(`${BASE}/admin`);
  await feed.text('Pro payments').waitFor({ timeout: 15_000 });
  mark('admin_full');
  await sleep(4000);
});

mark('cut');
clearInterval(actTimer);
await sleep(1200);
await pollActivity();
// Server timestamps are shifted onto this machine's clock so they line up with the footage.
const activity = { mode: actMode, skewMs: Math.round(skew), events: acts.map((e) => ({ ...e, t: Math.round(e.t - skew) })) };
const stats = Object.fromEntries(await Promise.all([seller, feed, b1, b2, b3, b4].map(async (a) => [a.name, await a.stop()] as const)));
fs.writeFileSync(path.join(RUN, 'marks.json'), JSON.stringify({ t0, facts, marks, stats, activity, names: Object.fromEntries([...names].map(([a, n]) => [a.name, n])) }, null, 1));
console.log('\nsaved', RUN, JSON.stringify(stats), '\nfacts', JSON.stringify(facts));

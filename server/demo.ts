// Always-on demo drop (/d/demo) so anyone — a judge, a curious seller — can feel a claim race alone.
// Bot buyers are clearly labelled in the UI, never connect to Nexconn (so they are not counted as users),
// never receive order messages, and the demo is excluded from all public impact numbers.
import { config } from './config.ts';
import { db, now } from './db.ts';
import { nexconn } from './nexconn.ts';
import { buyerMarkPaid, claim, q, sellerConfirm, sellerUserId } from './engine.ts';
import { MSG } from '../shared/types.ts';
import fs from 'node:fs';
import path from 'node:path';

export const DEMO_DROP = 'demo';
const SELLER = 'demoshop';
const BOTS = [
  { id: 'bot_aarav', name: 'Aarav (bot)' },
  { id: 'bot_diya', name: 'Sofia (bot)' },
  { id: 'bot_kabir', name: 'Kenji (bot)' },
];
const CHATTER = ['Is it true to size?', 'Ooh that colour 😍', 'Do you ship internationally?', 'Next one please!', 'So fast 😅'];
export const isBot = (buyerId: string) => buyerId.startsWith('bot_');

let phaseAt = 0;
let current: string | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void) => { timers.push(setTimeout(() => { try { fn(); } catch (e) { console.error('[demo]', (e as Error).message); } }, ms)); };

async function ensureDemo() {
  if (!q.seller(SELLER)) {
    db.prepare('INSERT INTO sellers (id, name, shop, upi, key, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(SELLER, 'Demo', 'ClaimIt Demo Shop', 'demo@claimit', 'demo-no-login-' + Math.random().toString(36).slice(2), now());
  }
  // Global demo: USD, international bot names (kept in sync on every boot).
  db.prepare(`UPDATE sellers SET currency = 'USD' WHERE id = ?`).run(SELLER);
  for (const b of BOTS) db.prepare('UPDATE buyers SET name = ? WHERE id = ?').run(b.name, b.id);
  [['demoit0', 'Canvas tote', 18], ['demoit1', 'Floral summer dress · S', 29], ['demoit2', 'Vintage denim jacket · M', 42]]
    .forEach(([id, name, price]) => db.prepare('UPDATE items SET name = ?, price = ? WHERE id = ?').run(name, price, id));
  for (const b of BOTS) db.prepare('INSERT OR IGNORE INTO buyers (id, name, key, created, is_guest) VALUES (?, ?, ?, ?, 0)').run(b.id, b.name, 'bot', now());
  if (!q.drop(DEMO_DROP)) {
    await nexconn.createOpenChannel(`drop_${DEMO_DROP}`).catch(() => {});
    db.prepare('INSERT INTO drops (id, seller_id, title, channel_id, status, created, hold_seconds, practice) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
      .run(DEMO_DROP, SELLER, 'Live demo — try to beat the bots', `drop_${DEMO_DROP}`, 'live', now(), 25);
    const dir = path.resolve(fs.existsSync('dist/web/demo') ? 'dist/web/demo' : 'web/public/demo');
    const items: [string, number, string][] = [['Canvas tote', 18, 'canvas-tote.jpg'], ['Floral summer dress · S', 29, 'floral-kurti.jpg'], ['Vintage denim jacket · M', 42, 'denim-jacket.jpg']];
    items.forEach(([name, price, file], i) => {
      const img = `demo${i}`;
      try { db.prepare('INSERT OR IGNORE INTO images (id, mime, data) VALUES (?, ?, ?)').run(img, 'image/jpeg', fs.readFileSync(path.join(dir, file))); } catch { /* no image */ }
      db.prepare('INSERT INTO items (id, drop_id, name, price, image_id, status, idx) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`demoit${i}`, DEMO_DROP, name, price, img, 'draft', i + 1);
    });
  }
  // The demo room never ends and stays open on Nexconn (re-created if Nexconn auto-destroyed it).
  db.prepare(`UPDATE drops SET status = 'live' WHERE id = ?`).run(DEMO_DROP);
  await nexconn.createOpenChannel(`drop_${DEMO_DROP}`).catch(() => {});
}

/** Put the next demo item up and let the bots race for it. */
async function nextRound() {
  timers.forEach(clearTimeout); timers = [];
  const items = db.prepare('SELECT id FROM items WHERE drop_id = ? ORDER BY idx').all(DEMO_DROP) as { id: string }[];
  const idx = current ? (items.findIndex((i) => i.id === current) + 1) % items.length : 0;
  const itemId = items[idx].id;
  // Reset the item: clear old claims so it can be dropped again.
  db.prepare(`DELETE FROM claims WHERE item_id = ?`).run(itemId);
  db.prepare(`UPDATE items SET status = 'closed' WHERE id = ?`).run(itemId);
  current = itemId;
  phaseAt = now();
  const { dropItem } = await import('./engine.ts');
  dropItem(DEMO_DROP, itemId);
  // Three bots tap within a second; the first one never pays (hold expires → next in line), the second pays.
  later(1400, () => claim(DEMO_DROP, itemId, BOTS[0]));
  later(1650, () => claim(DEMO_DROP, itemId, BOTS[1]));
  later(1900, () => claim(DEMO_DROP, itemId, BOTS[2]));
  later(4000, () => chat(BOTS[2], CHATTER[Math.floor(Math.random() * CHATTER.length)]));
}

function chat(bot: { id: string; name: string }, text: string) {
  nexconn.sendOpen(`drop_${DEMO_DROP}`, bot.id, MSG.CHAT, { text, name: bot.name }, 3).catch(() => {});
}

/** Called every second: drives bot payments, auto-confirms, and starts the next round. */
const confirming = new Set<string>();
function tick() {
  if (!current) return;
  const it = q.item(current);
  if (!it) return;
  const holder = q.activeClaims(current).find((c) => c.status === 'holding' || c.status === 'paying');
  // The second bot pays ~6s after being promoted.
  if (holder?.status === 'holding' && holder.buyer_id === BOTS[1].id && holder.hold_until && holder.hold_until - now() < (25 - 6) * 1000) {
    buyerMarkPaid(holder.id, holder.buyer_id, '', { phone: '+10000000000', address: 'Demo address, Demo City', pincode: '00000' });
  }
  // The demo shop confirms any payment (bot or a real visitor's) after 3s.
  if (holder?.status === 'paying' && !confirming.has(holder.id)) {
    confirming.add(holder.id);
    later(3000, () => { confirming.delete(holder.id); if (q.claim(holder.id)?.status === 'paying') sellerConfirm(holder.id, SELLER); });
  }
  const idleTooLong = it.status === 'live' && now() - phaseAt > 30_000;
  if (!pendingNext && ((it.status === 'sold' && now() - phaseAt > 8_000) || idleTooLong)) {
    pendingNext = true;
    later(6000, () => { pendingNext = false; nextRound().catch(() => {}); });
  }
}
let pendingNext = false;

export async function startDemo() {
  if (process.env.DEMO_ROOM === 'off') return;
  await ensureDemo();
  // Clean slate on boot: no stale demo claims.
  db.prepare(`DELETE FROM claims WHERE drop_id = ?`).run(DEMO_DROP);
  db.prepare(`UPDATE items SET status = 'draft' WHERE drop_id = ?`).run(DEMO_DROP);
  await nextRound();
  setInterval(tick, 1000);
  setInterval(() => nexconn.createOpenChannel(`drop_${DEMO_DROP}`).catch(() => {}), 6 * 3600_000); // keep the room alive
  void config; void sellerUserId;
}

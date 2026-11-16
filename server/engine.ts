// The claim arbiter. All state transitions run synchronously inside a SQLite transaction on a single
// Node process, so two buyers tapping "Claim" in the same millisecond can never both win.
// After each commit the new queue is published to the Nexconn open channel's metadata (live for every viewer),
// a priority event goes into the room, and the winner gets an order card in a 1:1 Direct channel.
import { config } from './config.ts';
import { db, now, rid, tx } from './db.ts';
import { nexconn } from './nexconn.ts';
import { presence } from './presence.ts';
import {
  MSG, itemKey,
  type ClaimStatus, type DropState, type EventContent, type Item, type ItemState, type ItemStatus,
  type MyClaim, type OrderContent, type OrderUpdateContent, type Person, type PublicDrop, type SellerTrust,
} from '../shared/types.ts';

export const fmtMoney = (n: number, currency = 'INR') =>
  new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

interface DropRow { id: string; seller_id: string; title: string; channel_id: string; status: 'live' | 'ended'; live_url: string | null; current_item: string | null; hold_seconds: number | null }
interface ItemRow { id: string; drop_id: string; name: string; price: number; image_id: string | null; status: ItemStatus; idx: number; dropped_at: number | null; version: number }
interface ClaimRow { id: string; item_id: string; drop_id: string; buyer_id: string; buyer_name: string; status: ClaimStatus; seq: number; hold_until: number | null; utr: string | null; order_msg_id: string | null }
interface SellerRow { id: string; name: string; shop: string; upi: string; currency: string; pay_link: string | null; pay_note: string | null }

export const sellerUserId = (sellerId: string) => `s_${sellerId}`;
/** Demo-room bot buyers: never messaged, never connected to Nexconn. */
const isBot = (buyerId: string) => buyerId.startsWith('bot_');
/** Seconds a claimer has to pay, set per drop by the seller (falls back to HOLD_SECONDS). Demo bots hold for 20s. */
export const holdSecondsFor = (dropId: string, buyerId?: string) => (buyerId?.startsWith('bot_') ? 20 : q.drop(dropId)?.hold_seconds || config.holdSeconds);
export const fmtHold = (s: number) => (s < 60 ? `${s}s` : s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s / 60} min`);
const imageUrl = (imageId: string | null) => (imageId ? `/img/${imageId}` : null);
const ACTIVE: ClaimStatus[] = ['holding', 'paying', 'waiting'];

export const q = {
  drop: (id: string) => db.prepare('SELECT * FROM drops WHERE id = ?').get(id) as DropRow | undefined,
  item: (id: string) => db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined,
  items: (dropId: string) => db.prepare('SELECT * FROM items WHERE drop_id = ? ORDER BY idx').all(dropId) as unknown as ItemRow[],
  seller: (id: string) => db.prepare('SELECT id, name, shop, upi, currency, pay_link, pay_note FROM sellers WHERE id = ?').get(id) as SellerRow | undefined,
  claim: (id: string) => db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as ClaimRow | undefined,
  activeClaims: (itemId: string) =>
    db.prepare(`SELECT * FROM claims WHERE item_id = ? AND status IN ('holding','paying','waiting') ORDER BY seq`).all(itemId) as unknown as ClaimRow[],
};

export function toItem(r: ItemRow): Item {
  return { id: r.id, dropId: r.drop_id, name: r.name, price: r.price, image: imageUrl(r.image_id), status: r.status, idx: r.idx, droppedAt: r.dropped_at };
}

export function itemState(itemId: string): ItemState {
  const item = q.item(itemId)!;
  const active = q.activeClaims(itemId);
  const holder = active.find((c) => c.status === 'holding' || c.status === 'paying')
    ?? (item.status === 'sold' ? (db.prepare(`SELECT * FROM claims WHERE item_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 1`).get(itemId) as ClaimRow | undefined) : undefined);
  // Only this round's claims (an item can be re-dropped after being closed, and the demo re-drops items forever).
  const total = (db.prepare('SELECT COUNT(*) AS n FROM claims WHERE item_id = ? AND created >= ?').get(itemId, item.dropped_at ?? 0) as { n: number }).n;
  return {
    id: itemId,
    status: item.status,
    holder: holder ? { id: holder.buyer_id, name: holder.buyer_name } : null,
    holdUntil: holder?.status === 'holding' ? holder.hold_until : null,
    waitlist: active.filter((c) => c.status === 'waiting').map((c) => ({ id: c.buyer_id, name: c.buyer_name })),
    claims: total,
    v: item.version,
  };
}

/** A seller's public track record: real (non-practice, non-demo) confirmed orders and how fast they confirm payments. */
export function sellerTrust(sellerId: string): SellerTrust {
  const r = db.prepare(`SELECT COUNT(*) AS n, AVG(c.paid_at - c.paying_at) AS avg FROM claims c JOIN drops d ON d.id = c.drop_id
    WHERE d.seller_id = ? AND d.practice = 0 AND c.status = 'paid' AND c.buyer_id NOT LIKE 'bot\\_%' ESCAPE '\\'`).get(sellerId) as { n: number; avg: number | null };
  const since = (db.prepare('SELECT created FROM sellers WHERE id = ?').get(sellerId) as { created: number } | undefined)?.created ?? now();
  return { orders: r.n, since, avgConfirmSec: r.avg ? Math.round(r.avg / 1000) : null };
}

export function publicDrop(dropId: string): PublicDrop {
  const d = q.drop(dropId);
  if (!d) throw new AppError(404, 'NO_DROP', 'Drop not found');
  const s = q.seller(d.seller_id)!;
  const items = q.items(dropId);
  const state: Record<string, ItemState> = {};
  for (const it of items) if (it.status !== 'draft') state[it.id] = itemState(it.id);
  return {
    id: d.id, title: d.title, shop: s.shop, sellerId: sellerUserId(s.id), channelId: d.channel_id,
    status: d.status, liveUrl: d.live_url, holdSeconds: holdSecondsFor(d.id),
    items: items.filter((i) => i.status !== 'draft').map(toItem),
    state, drop: { status: d.status, current: d.current_item }, demo: d.id === 'demo', currency: s.currency, trust: sellerTrust(s.id),
  };
}

export function myClaims(dropId: string, buyerId: string): MyClaim[] {
  const d = q.drop(dropId)!;
  const s = q.seller(d.seller_id)!;
  const rows = db.prepare(`SELECT c.*, i.name AS item_name, i.price, i.image_id FROM claims c JOIN items i ON i.id = c.item_id
    WHERE c.drop_id = ? AND c.buyer_id = ? ORDER BY c.created DESC`).all(dropId, buyerId) as unknown as (ClaimRow & { item_name: string; price: number; image_id: string | null })[];
  return rows.map((c) => {
    let position = 0;
    if (c.status === 'waiting') position = q.activeClaims(c.item_id).filter((x) => x.status === 'waiting').findIndex((x) => x.id === c.id) + 1;
    return {
      id: c.id, itemId: c.item_id, itemName: c.item_name, price: c.price, image: imageUrl(c.image_id),
      status: c.status, position, holdUntil: c.hold_until, upi: s.upi, shop: s.shop, currency: s.currency, payLink: s.pay_link, payNote: s.pay_note, demo: dropId === 'demo',
      shippedAt: (c as any).shipped_at ?? null, tracking: (c as any).tracking ?? null,
    };
  });
}

// ---------- side effects (Nexconn), serialized per channel so metadata versions arrive in order ----------

const chains = new Map<string, Promise<unknown>>();
function enqueue(channelId: string, job: () => Promise<unknown>) {
  const prev = chains.get(channelId) || Promise.resolve();
  const next = prev.then(job).catch((e) => console.error('[nexconn]', e?.message || e, e?.body ? JSON.stringify(e.body) : ''));
  chains.set(channelId, next);
  return next;
}

function bump(itemId: string) {
  db.prepare('UPDATE items SET version = version + 1 WHERE id = ?').run(itemId);
}

/** Metadata writes are idempotent (versioned state), so a failed write is retried with backoff instead of lost. */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
}

function publish(dropId: string, itemIds: string[], extra: Record<string, string> = {}) {
  const d = q.drop(dropId)!;
  const entries: Record<string, string> = { ...extra };
  for (const id of itemIds) entries[itemKey(id)] = JSON.stringify(itemState(id));
  return enqueue(d.channel_id, () => withRetry(() => nexconn.setMetadata(d.channel_id, sellerUserId(d.seller_id), entries)));
}

/** Boot: republish every live drop's full state, so a write lost in a crash/restart can't leave a room stale. */
export function republishLive() {
  const drops = db.prepare(`SELECT id, current_item FROM drops WHERE status = 'live'`).all() as { id: string; current_item: string | null }[];
  for (const d of drops) {
    const ids = q.items(d.id).filter((i) => i.status !== 'draft').map((i) => i.id);
    publish(d.id, ids, { drop: JSON.stringify({ status: 'live', current: d.current_item } satisfies DropState) });
  }
  return drops.length;
}

export const publishItems = (dropId: string, itemIds: string[]) => publish(dropId, itemIds);

/** Let the demo (and anything else) publish extra drop-level state. */
export function publishDrop(dropId: string, state: DropState) {
  return publish(dropId, [], { drop: JSON.stringify(state) });
}

function roomEvent(dropId: string, ev: EventContent) {
  const d = q.drop(dropId)!;
  return enqueue(d.channel_id, () => nexconn.sendOpen(d.channel_id, sellerUserId(d.seller_id), MSG.EVENT, ev, 2));
}

function sendOrder(claimId: string) {
  const c = q.claim(claimId)!;
  if (isBot(c.buyer_id)) return;
  const it = q.item(c.item_id)!;
  const d = q.drop(c.drop_id)!;
  const s = q.seller(d.seller_id)!;
  const order: OrderContent = {
    claimId: c.id, dropId: d.id, itemId: it.id, itemName: it.name, price: it.price,
    image: imageUrl(it.image_id), upi: s.upi, shop: s.shop, holdUntil: c.hold_until || now(), currency: s.currency, payLink: s.pay_link, payNote: s.pay_note,
  };
  return enqueue(`dm:${c.buyer_id}`, async () => {
    const id = await nexconn.sendDirect(sellerUserId(s.id), c.buyer_id, MSG.ORDER, order,
      `You got ${it.name}! Pay within ${fmtHold(holdSecondsFor(d.id))} to keep it.`, undefined, { s: 'holding' });
    if (id) db.prepare('UPDATE claims SET order_msg_id = ? WHERE id = ?').run(id, claimId);
    else console.warn('[order card] no messageId returned; live status updates disabled for claim', claimId);
  });
}

/** Seller marks a paid order as shipped (optional courier + tracking). */
export function markShipped(claimId: string, sellerId: string, tracking: string) {
  const c = q.claim(claimId);
  if (!c || q.drop(c.drop_id)?.seller_id !== sellerId) throw new AppError(404, 'NO_CLAIM', 'Order not found');
  if (c.status !== 'paid') throw new AppError(409, 'BAD_STATE', 'Only paid orders can be shipped');
  db.prepare('UPDATE claims SET shipped_at = ?, tracking = ? WHERE id = ?').run(now(), tracking.slice(0, 120) || null, claimId);
  const it = q.item(c.item_id)!;
  const sellerId_ = sellerUserId(q.drop(c.drop_id)!.seller_id);
  enqueue(`dm:${c.buyer_id}`, async () => {
    const fresh = q.claim(claimId)!;
    if (fresh.order_msg_id) await nexconn.setMessageMetadata(fresh.order_msg_id, sellerId_, fresh.buyer_id, { s: 'shipped', t: String(now()) });
    await nexconn.sendDirect(sellerId_, c.buyer_id, MSG.ORDER_UPDATE,
      { claimId, status: 'paid', text: `📦 ${it.name} is on its way!${tracking ? `\nTracking: ${tracking}` : ''}` }, `${it.name} has shipped`);
  });
}

/** The order card is one message whose status updates in place (Nexconn message metadata), on both sides. */
function updateOrderCard(claimId: string) {
  const c = q.claim(claimId);
  if (!c) return;
  const sellerId = sellerUserId(q.drop(c.drop_id)!.seller_id);
  return enqueue(`dm:${c.buyer_id}`, async () => {
    const fresh = q.claim(claimId)!;
    if (!fresh.order_msg_id) return;
    await nexconn.setMessageMetadata(fresh.order_msg_id, sellerId, fresh.buyer_id, { s: fresh.status, t: String(now()) });
  });
}

function sendOrderUpdate(claimId: string, text: string) {
  const c = q.claim(claimId)!;
  if (isBot(c.buyer_id)) return;
  updateOrderCard(claimId);
  const d = q.drop(c.drop_id)!;
  const seller = sellerUserId(d.seller_id);
  const content: OrderUpdateContent = { claimId, status: c.status, text };
  return enqueue(`dm:${c.buyer_id}`, () => nexconn.sendDirect(seller, c.buyer_id, MSG.ORDER_UPDATE, content, text));
}

export function logEvent(dropId: string, kind: string, userId?: string) {
  db.prepare('INSERT INTO events (drop_id, kind, user_id, at) VALUES (?, ?, ?, ?)').run(dropId, kind, userId ?? null, now());
}

// ---------- transitions ----------

/** Promote the first waiting claim to holder, or reopen the item. Must run inside a transaction. */
/** Offline buyers skipped while promoting (presence from Nexconn's connection-status webhook). */
let skippedOffline: { id: string; name: string }[] = [];

function promoteNext(itemId: string): ClaimRow | null {
  const waiting = q.activeClaims(itemId).filter((c) => c.status === 'waiting');
  // Presence-aware: pass over people who have left the room, so the item doesn't stall for minutes on a ghost.
  let next: ClaimRow | undefined;
  for (const w of waiting) {
    // Only skip people gone 10+ minutes: buyers watching the seller's Instagram/TikTok Live have this tab in the background,
    // which can drop the socket. Everyone else is promoted and gets a push-enabled order DM ("It's your turn").
    if (presence.isOffline(w.buyer_id, 600_000)) {
      db.prepare(`UPDATE claims SET status = 'expired' WHERE id = ?`).run(w.id);
      skippedOffline.push({ id: w.id, name: w.buyer_name });
      continue;
    }
    next = w;
    break;
  }
  if (next) {
    db.prepare(`UPDATE claims SET status = 'holding', hold_until = ? WHERE id = ?`).run(now() + holdSecondsFor(next.drop_id, next.buyer_id) * 1000, next.id);
    db.prepare(`UPDATE items SET status = 'held' WHERE id = ?`).run(itemId);
    return q.claim(next.id)!;
  }
  db.prepare(`UPDATE items SET status = 'live' WHERE id = ?`).run(itemId);
  return null;
}

export function dropItem(dropId: string, itemId: string) {
  const it = q.item(itemId);
  if (!it || it.drop_id !== dropId) throw new AppError(404, 'NO_ITEM', 'Item not found');
  if (it.status !== 'draft' && it.status !== 'closed') throw new AppError(409, 'ALREADY_LIVE', 'Item is already dropped');
  tx(() => {
    db.prepare(`UPDATE items SET status = 'live', dropped_at = ? WHERE id = ?`).run(now(), itemId);
    db.prepare('UPDATE drops SET current_item = ? WHERE id = ?').run(itemId, dropId);
    bump(itemId);
  });
  const fresh = q.item(itemId)!;
  const dropState: DropState = { status: 'live', current: itemId };
  publish(dropId, [itemId], { drop: JSON.stringify(dropState) });
  const d = q.drop(dropId)!;
  enqueue(d.channel_id, () => nexconn.sendOpen(d.channel_id, sellerUserId(d.seller_id), MSG.DROP,
    { itemId, name: fresh.name, price: fresh.price, image: imageUrl(fresh.image_id), idx: fresh.idx }, 2));
  logEvent(dropId, 'drop');
  return toItem(fresh);
}

export function claim(dropId: string, itemId: string, buyer: Person) {
  const result = tx(() => {
    const it = q.item(itemId);
    if (!it || it.drop_id !== dropId) throw new AppError(404, 'NO_ITEM', 'Item not found');
    if (q.drop(dropId)!.status !== 'live') throw new AppError(409, 'ENDED', 'This drop has ended');
    if (it.status === 'sold') throw new AppError(409, 'SOLD', 'Sold out');
    if (it.status === 'draft' || it.status === 'closed') throw new AppError(409, 'NOT_LIVE', 'Not available');
    const active = q.activeClaims(itemId);
    const mine = active.find((c) => c.buyer_id === buyer.id);
    if (mine) return { claim: mine, fresh: false };
    const holder = active.find((c) => c.status === 'holding' || c.status === 'paying');
    const waiting = active.filter((c) => c.status === 'waiting');
    if (holder && waiting.length >= config.maxWaitlist) throw new AppError(409, 'FULL', 'Waitlist is full');
    const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM claims WHERE item_id = ?').get(itemId) as { n: number }).n;
    const id = rid(12);
    const status: ClaimStatus = holder ? 'waiting' : 'holding';
    db.prepare(`INSERT INTO claims (id, item_id, drop_id, buyer_id, buyer_name, status, seq, created, hold_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, itemId, dropId, buyer.id, buyer.name, status, seq, now(),
      status === 'holding' ? now() + holdSecondsFor(dropId, buyer.id) * 1000 : null);
    if (status === 'holding') db.prepare(`UPDATE items SET status = 'held' WHERE id = ?`).run(itemId);
    bump(itemId);
    return { claim: q.claim(id)!, fresh: true };
  });
  logEvent(dropId, 'claim_attempt', buyer.id);
  if (result.fresh) {
    const it = q.item(itemId)!;
    publish(dropId, [itemId]);
    if (result.claim.status === 'holding') {
      roomEvent(dropId, { kind: 'claimed', itemId, itemName: it.name, actor: buyer.name, text: `${buyer.name} claimed ${it.name}` });
      sendOrder(result.claim.id);
    } else {
      const pos = q.activeClaims(itemId).filter((c) => c.status === 'waiting').length;
      roomEvent(dropId, { kind: 'waitlisted', itemId, itemName: it.name, actor: buyer.name, text: `${buyer.name} is #${pos} in line for ${it.name}` });
    }
  }
  return myClaims(dropId, buyer.id).find((c) => c.id === result.claim.id)!;
}

export interface ShipTo { phone: string; address: string; pincode: string }

export function buyerMarkPaid(claimId: string, buyerId: string, utr: string, ship: ShipTo) {
  const c = q.claim(claimId);
  if (!c || c.buyer_id !== buyerId) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  if (c.status !== 'holding') throw new AppError(409, 'BAD_STATE', 'This claim is no longer on hold');
  tx(() => {
    db.prepare(`UPDATE claims SET status = 'paying', paying_at = ?, utr = ?, ship_phone = ?, ship_address = ?, ship_pincode = ? WHERE id = ?`)
      .run(now(), utr.slice(0, 40), ship.phone, ship.address, ship.pincode, claimId);
    // Remember delivery details so the next order is one tap.
    db.prepare('UPDATE buyers SET phone = ?, address = ?, pincode = ? WHERE id = ?').run(ship.phone, ship.address, ship.pincode, buyerId);
    db.prepare(`UPDATE items SET status = 'paying' WHERE id = ?`).run(c.item_id);
    bump(c.item_id);
  });
  const it = q.item(c.item_id)!;
  publish(c.drop_id, [c.item_id]);
  roomEvent(c.drop_id, { kind: 'paying', itemId: it.id, itemName: it.name, actor: c.buyer_name, text: `${c.buyer_name} paid for ${it.name} — seller is confirming` });
  // Sent from the seller's id like every CI:* message (buyers can never forge order cards), worded as the buyer's report.
  sendOrderUpdate(claimId,
    `💸 ${c.buyer_name} says they paid ${fmtMoney(it.price, q.seller(q.drop(c.drop_id)!.seller_id)!.currency)} for ${it.name}${utr ? ` · ref ${utr}` : ''}\n📦 Ship to ${c.buyer_name}, ${ship.address} — ${ship.pincode} · ${ship.phone}`);
}

export function sellerConfirm(claimId: string, sellerId: string) {
  const c = q.claim(claimId);
  if (!c || q.drop(c.drop_id)?.seller_id !== sellerId) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  if (c.status !== 'paying' && c.status !== 'holding') throw new AppError(409, 'BAD_STATE', 'Nothing to confirm');
  const others = tx(() => {
    db.prepare(`UPDATE claims SET status = 'paid', paid_at = ? WHERE id = ?`).run(now(), claimId);
    const waiting = q.activeClaims(c.item_id).filter((x) => x.status === 'waiting');
    db.prepare(`UPDATE claims SET status = 'cancelled' WHERE item_id = ? AND status = 'waiting'`).run(c.item_id);
    db.prepare(`UPDATE items SET status = 'sold' WHERE id = ?`).run(c.item_id);
    bump(c.item_id);
    return waiting;
  });
  const it = q.item(c.item_id)!;
  publish(c.drop_id, [c.item_id]);
  roomEvent(c.drop_id, { kind: 'sold', itemId: it.id, itemName: it.name, actor: c.buyer_name, text: `SOLD to ${c.buyer_name} — ${it.name}` });
  sendOrderUpdate(claimId, `Payment received ✅ ${it.name} is yours. We'll message you about delivery.`);
  for (const w of others) sendOrderUpdate(w.id, `Sorry, ${it.name} sold out. Stay in the room — more drops coming!`);
}

/** Seller rejects a payment claim, or buyer releases, or hold expires: the item moves to the next person in line. */
export function release(claimId: string, reason: 'expired' | 'cancelled' | 'rejected' | 'offline') {
  const c = q.claim(claimId);
  if (!c) return;
  skippedOffline = [];
  const promoted = tx(() => {
    const cur = q.claim(claimId)!;
    if (!ACTIVE.includes(cur.status)) return undefined;
    const wasHolder = cur.status === 'holding' || cur.status === 'paying';
    db.prepare('UPDATE claims SET status = ? WHERE id = ?').run(reason === 'offline' ? 'expired' : reason, claimId);
    const p = wasHolder ? promoteNext(c.item_id) : null;
    bump(c.item_id);
    return { wasHolder, p };
  });
  if (!promoted) return;
  const it = q.item(c.item_id)!;
  publish(c.drop_id, [c.item_id]);
  const skipped = skippedOffline.length ? ` (skipped ${skippedOffline.map((x) => x.name).join(', ')} — offline)` : '';
  // Tell the people we passed over, so they aren't left wondering what happened to their place in line.
  for (const x of skippedOffline) sendOrderUpdate(x.id, `Your turn for ${it.name} came while you were away, so it went to the next person. Come back for the next drop!`);
  const msg = { expired: `⏱ ${c.buyer_name} ran out of time`, offline: `📴 ${c.buyer_name} left the room`, cancelled: `${c.buyer_name} let it go`, rejected: `${c.buyer_name}'s payment wasn't confirmed` }[reason] + skipped;
  if (reason !== 'cancelled' || promoted.wasHolder) {
    sendOrderUpdate(claimId, reason === 'offline'
      ? `You left the drop, so ${it.name} went to the next person in line. Come back for the next drop!`
      : reason === 'expired'
      ? `Your hold on ${it.name} expired, so it went to the next person in line.`
      : reason === 'rejected' ? `We couldn't confirm your payment for ${it.name}. Message us if this is a mistake.`
      : `You released ${it.name}.`);
  }
  if (promoted.p) {
    roomEvent(c.drop_id, { kind: 'promoted', itemId: it.id, itemName: it.name, actor: promoted.p.buyer_name, text: `${msg} → ${promoted.p.buyer_name}'s turn for ${it.name}` });
    sendOrder(promoted.p.id);
  } else if (promoted.wasHolder) {
    roomEvent(c.drop_id, { kind: 'released', itemId: it.id, itemName: it.name, text: `${msg} → ${it.name} is up for grabs again!` });
  }
}

export function closeItem(dropId: string, itemId: string) {
  const it = q.item(itemId);
  if (!it || it.drop_id !== dropId) throw new AppError(404, 'NO_ITEM', 'Item not found');
  const claims = tx(() => {
    // Re-read inside the transaction: only an item that's up for grabs or on hold can be pulled. A sold item can't be
    // re-sold, and an item whose buyer already says they paid must be confirmed or rejected, never silently cancelled.
    const cur = q.item(itemId)!;
    if (cur.status === 'paying') throw new AppError(409, 'PAYING', 'The buyer says they paid — confirm or reject the payment first');
    if (cur.status !== 'live' && cur.status !== 'held') throw new AppError(409, 'BAD_STATE', cur.status === 'sold' ? 'Already sold' : 'Not live');
    const active = q.activeClaims(itemId);
    db.prepare(`UPDATE claims SET status = 'cancelled' WHERE item_id = ? AND status IN ('holding','waiting')`).run(itemId);
    db.prepare(`UPDATE items SET status = 'closed' WHERE id = ?`).run(itemId);
    bump(itemId);
    return active;
  });
  publish(dropId, [itemId]);
  for (const c of claims) sendOrderUpdate(c.id, `${it.name} was taken off the drop.`);
}

export function endDrop(dropId: string) {
  tx(() => db.prepare(`UPDATE drops SET status = 'ended', ended = ? WHERE id = ?`).run(now(), dropId));
  const dropState: DropState = { status: 'ended', current: null };
  publish(dropId, [], { drop: JSON.stringify(dropState) });
  roomEvent(dropId, { kind: 'ended', text: 'This drop has ended. Thanks for shopping!' });
}

/** An order card whose send failed (no message id stored) is sent again once, so a winner is never left without checkout. */
const resent = new Set<string>();
function resendLostOrderCards() {
  const lost = db.prepare(`SELECT id, buyer_id FROM claims WHERE status = 'holding' AND order_msg_id IS NULL AND hold_until > ? AND buyer_id NOT LIKE 'bot\\_%' ESCAPE '\\'`)
    .all(now() + 30_000) as { id: string; buyer_id: string }[];
  for (const c of lost) {
    const at = firstSeenLost.get(c.id) ?? now();
    firstSeenLost.set(c.id, at);
    if (now() - at < 10_000 || resent.has(c.id)) continue;
    resent.add(c.id);
    sendOrder(c.id);
  }
}
const firstSeenLost = new Map<string, number>();

/** ClaimIt's own system sender for nudges to sellers (s_ prefix = trusted for CI:* messages; real seller ids are 10 chars). */
export const SYSTEM_USER = 's_claimit';

/**
 * A buyer said "I've paid" but the seller hasn't confirmed. We never auto-release a claim whose money may have moved —
 * instead we nudge the seller (5 min, then 15 min) and tell the people waiting that the item is still being confirmed.
 */
function remindSlowConfirms() {
  const slow = db.prepare(`SELECT c.*, i.name AS item_name FROM claims c JOIN items i ON i.id = c.item_id
    WHERE c.status = 'paying' AND c.paying_at IS NOT NULL AND ((c.reminded = 0 AND c.paying_at < ?) OR (c.reminded = 1 AND c.paying_at < ?))`)
    .all(now() - 5 * 60_000, now() - 15 * 60_000) as unknown as (ClaimRow & { item_name: string; reminded: number })[];
  for (const c of slow) {
    db.prepare('UPDATE claims SET reminded = reminded + 1 WHERE id = ?').run(c.id);
    if (isBot(c.buyer_id)) continue;
    const d = q.drop(c.drop_id)!;
    const mins = c.reminded === 0 ? 5 : 15;
    const content: OrderUpdateContent = { claimId: c.id, status: 'paying', text: `⏰ ${c.buyer_name} said they paid for ${c.item_name} ${mins} min ago. Check your payments and tap “Payment received” (or Skip) — ${q.activeClaims(c.item_id).filter((x) => x.status === 'waiting').length} people are waiting.` };
    enqueue(`dm:${SYSTEM_USER}`, () => nexconn.sendDirect(SYSTEM_USER, sellerUserId(d.seller_id), MSG.ORDER_UPDATE, content, content.text));
    if (c.reminded === 0) {
      for (const w of q.activeClaims(c.item_id).filter((x) => x.status === 'waiting')) {
        sendOrderUpdate(w.id, `${c.item_name}: the seller is still confirming ${c.buyer_name}'s payment. You keep your place in line if it falls through.`);
      }
    }
  }
}

/** Expire holds whose timer ran out. Runs every second. */
export function startExpiryLoop() {
  setInterval(() => {
    const expired = db.prepare(`SELECT id FROM claims WHERE status = 'holding' AND hold_until < ?`).all(now()) as { id: string }[];
    for (const e of expired) {
      try { release(e.id, 'expired'); } catch (err) { console.error('expiry', err); }
    }
    // A holder who left 3+ minutes ago and never opened the UPI step isn't coming back: pass the item on (if others wait).
    // Buyers who tapped "Pay with UPI" are expected to be offline (they're in GPay/PhonePe) and keep their full hold.
    const held = db.prepare(`SELECT c.id, c.buyer_id, c.item_id FROM claims c WHERE c.status = 'holding' AND c.pay_opened = 0 AND c.hold_until > ?`).all(now() + 15_000) as { id: string; buyer_id: string; item_id: string }[];
    remindSlowConfirms();
    resendLostOrderCards();
    for (const h of held) {
      if (!presence.isOffline(h.buyer_id, 180_000)) continue;
      const others = q.activeClaims(h.item_id).some((x) => x.status === 'waiting');
      if (!others) continue;
      try { release(h.id, 'offline'); } catch (err) { console.error('offline release', err); }
    }
  }, 1000);
}

// The claim arbiter. All state transitions run synchronously inside a SQLite transaction on a single
// Node process, so two buyers tapping "Claim" in the same millisecond can never both win.
// After each commit the new queue is published to the Nexconn open channel's metadata (live for every viewer),
// a priority event goes into the room, and the winner gets an order card in a 1:1 Direct channel.
import { config } from './config.ts';
import { db, now, rid, tx } from './db.ts';
import { nexconn } from './nexconn.ts';
import {
  MSG, itemKey,
  type ClaimStatus, type DropState, type EventContent, type Item, type ItemState, type ItemStatus,
  type MyClaim, type OrderContent, type OrderUpdateContent, type Person, type PublicDrop,
} from '../shared/types.ts';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

interface DropRow { id: string; seller_id: string; title: string; channel_id: string; status: 'live' | 'ended'; live_url: string | null; current_item: string | null }
interface ItemRow { id: string; drop_id: string; name: string; price: number; image_id: string | null; status: ItemStatus; idx: number; dropped_at: number | null; version: number }
interface ClaimRow { id: string; item_id: string; drop_id: string; buyer_id: string; buyer_name: string; status: ClaimStatus; seq: number; hold_until: number | null; utr: string | null }
interface SellerRow { id: string; name: string; shop: string; upi: string }

export const sellerUserId = (sellerId: string) => `s_${sellerId}`;
const imageUrl = (imageId: string | null) => (imageId ? `/img/${imageId}` : null);
const ACTIVE: ClaimStatus[] = ['holding', 'paying', 'waiting'];

export const q = {
  drop: (id: string) => db.prepare('SELECT * FROM drops WHERE id = ?').get(id) as DropRow | undefined,
  item: (id: string) => db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined,
  items: (dropId: string) => db.prepare('SELECT * FROM items WHERE drop_id = ? ORDER BY idx').all(dropId) as unknown as ItemRow[],
  seller: (id: string) => db.prepare('SELECT id, name, shop, upi FROM sellers WHERE id = ?').get(id) as SellerRow | undefined,
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
  const holder = active.find((c) => c.status === 'holding' || c.status === 'paying');
  const total = (db.prepare('SELECT COUNT(*) AS n FROM claims WHERE item_id = ?').get(itemId) as { n: number }).n;
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

export function publicDrop(dropId: string): PublicDrop {
  const d = q.drop(dropId);
  if (!d) throw new AppError(404, 'NO_DROP', 'Drop not found');
  const s = q.seller(d.seller_id)!;
  const items = q.items(dropId);
  const state: Record<string, ItemState> = {};
  for (const it of items) if (it.status !== 'draft') state[it.id] = itemState(it.id);
  return {
    id: d.id, title: d.title, shop: s.shop, sellerId: sellerUserId(s.id), channelId: d.channel_id,
    status: d.status, liveUrl: d.live_url, holdSeconds: config.holdSeconds,
    items: items.filter((i) => i.status !== 'draft').map(toItem),
    state, drop: { status: d.status, current: d.current_item },
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
      status: c.status, position, holdUntil: c.hold_until, upi: s.upi, shop: s.shop,
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

function publish(dropId: string, itemIds: string[], extra: Record<string, string> = {}) {
  const d = q.drop(dropId)!;
  const entries: Record<string, string> = { ...extra };
  for (const id of itemIds) entries[itemKey(id)] = JSON.stringify(itemState(id));
  return enqueue(d.channel_id, () => nexconn.setMetadata(d.channel_id, sellerUserId(d.seller_id), entries));
}

function roomEvent(dropId: string, ev: EventContent) {
  const d = q.drop(dropId)!;
  return enqueue(d.channel_id, () => nexconn.sendOpen(d.channel_id, sellerUserId(d.seller_id), MSG.EVENT, ev, 2));
}

function sendOrder(claimId: string) {
  const c = q.claim(claimId)!;
  const it = q.item(c.item_id)!;
  const d = q.drop(c.drop_id)!;
  const s = q.seller(d.seller_id)!;
  const order: OrderContent = {
    claimId: c.id, dropId: d.id, itemId: it.id, itemName: it.name, price: it.price,
    image: imageUrl(it.image_id), upi: s.upi, shop: s.shop, holdUntil: c.hold_until || now(),
  };
  return enqueue(`dm:${c.buyer_id}`, () =>
    nexconn.sendDirect(sellerUserId(s.id), c.buyer_id, MSG.ORDER, order, `You got ${it.name}! Pay within ${Math.round(config.holdSeconds / 60)} min to keep it.`));
}

function sendOrderUpdate(claimId: string, from: 'seller' | 'buyer', text: string) {
  const c = q.claim(claimId)!;
  const d = q.drop(c.drop_id)!;
  const seller = sellerUserId(d.seller_id);
  const content: OrderUpdateContent = { claimId, status: c.status, text };
  const [fromId, toId] = from === 'seller' ? [seller, c.buyer_id] : [c.buyer_id, seller];
  return enqueue(`dm:${c.buyer_id}`, () => nexconn.sendDirect(fromId, toId, MSG.ORDER_UPDATE, content, text));
}

export function logEvent(dropId: string, kind: string, userId?: string) {
  db.prepare('INSERT INTO events (drop_id, kind, user_id, at) VALUES (?, ?, ?, ?)').run(dropId, kind, userId ?? null, now());
}

// ---------- transitions ----------

/** Promote the first waiting claim to holder, or reopen the item. Must run inside a transaction. */
function promoteNext(itemId: string): ClaimRow | null {
  const next = q.activeClaims(itemId).find((c) => c.status === 'waiting');
  if (next) {
    db.prepare(`UPDATE claims SET status = 'holding', hold_until = ? WHERE id = ?`).run(now() + config.holdSeconds * 1000, next.id);
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
      status === 'holding' ? now() + config.holdSeconds * 1000 : null);
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

export function buyerMarkPaid(claimId: string, buyerId: string, utr: string) {
  const c = q.claim(claimId);
  if (!c || c.buyer_id !== buyerId) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  if (c.status !== 'holding') throw new AppError(409, 'BAD_STATE', 'This claim is no longer on hold');
  tx(() => {
    db.prepare(`UPDATE claims SET status = 'paying', utr = ? WHERE id = ?`).run(utr.slice(0, 40), claimId);
    db.prepare(`UPDATE items SET status = 'paying' WHERE id = ?`).run(c.item_id);
    bump(c.item_id);
  });
  const it = q.item(c.item_id)!;
  publish(c.drop_id, [c.item_id]);
  roomEvent(c.drop_id, { kind: 'paying', itemId: it.id, itemName: it.name, actor: c.buyer_name, text: `${c.buyer_name} paid for ${it.name} — seller is confirming` });
  sendOrderUpdate(claimId, 'buyer', `I've paid ₹${it.price} for ${it.name}. UTR: ${utr || 'n/a'}`);
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
  sendOrderUpdate(claimId, 'seller', `Payment received ✅ ${it.name} is yours. We'll message you about delivery.`);
  for (const w of others) sendOrderUpdate(w.id, 'seller', `Sorry, ${it.name} sold out. Stay in the room — more drops coming!`);
}

/** Seller rejects a payment claim, or buyer releases, or hold expires: the item moves to the next person in line. */
export function release(claimId: string, reason: 'expired' | 'cancelled' | 'rejected') {
  const c = q.claim(claimId);
  if (!c) return;
  const promoted = tx(() => {
    const cur = q.claim(claimId)!;
    if (!ACTIVE.includes(cur.status)) return undefined;
    const wasHolder = cur.status === 'holding' || cur.status === 'paying';
    db.prepare('UPDATE claims SET status = ? WHERE id = ?').run(reason, claimId);
    const p = wasHolder ? promoteNext(c.item_id) : null;
    bump(c.item_id);
    return { wasHolder, p };
  });
  if (!promoted) return;
  const it = q.item(c.item_id)!;
  publish(c.drop_id, [c.item_id]);
  const msg = { expired: `Time's up for ${c.buyer_name}`, cancelled: `${c.buyer_name} let go`, rejected: `${c.buyer_name}'s payment wasn't confirmed` }[reason];
  if (reason !== 'cancelled' || promoted.wasHolder) {
    sendOrderUpdate(claimId, 'seller', reason === 'expired'
      ? `Your hold on ${it.name} expired, so it went to the next person in line.`
      : reason === 'rejected' ? `We couldn't confirm your payment for ${it.name}. Message us if this is a mistake.`
      : `You released ${it.name}.`);
  }
  if (promoted.p) {
    roomEvent(c.drop_id, { kind: 'promoted', itemId: it.id, itemName: it.name, actor: promoted.p.buyer_name, text: `${msg} → ${promoted.p.buyer_name} now holds ${it.name}` });
    sendOrder(promoted.p.id);
  } else if (promoted.wasHolder) {
    roomEvent(c.drop_id, { kind: 'released', itemId: it.id, itemName: it.name, text: `${msg} → ${it.name} is up for grabs again!` });
  }
}

export function closeItem(dropId: string, itemId: string) {
  const it = q.item(itemId);
  if (!it || it.drop_id !== dropId) throw new AppError(404, 'NO_ITEM', 'Item not found');
  const claims = q.activeClaims(itemId);
  tx(() => {
    db.prepare(`UPDATE claims SET status = 'cancelled' WHERE item_id = ? AND status IN ('holding','paying','waiting')`).run(itemId);
    db.prepare(`UPDATE items SET status = 'closed' WHERE id = ?`).run(itemId);
    bump(itemId);
  });
  publish(dropId, [itemId]);
  for (const c of claims) sendOrderUpdate(c.id, 'seller', `${it.name} was taken off the drop.`);
}

export function endDrop(dropId: string) {
  tx(() => db.prepare(`UPDATE drops SET status = 'ended', ended = ? WHERE id = ?`).run(now(), dropId));
  const dropState: DropState = { status: 'ended', current: null };
  publish(dropId, [], { drop: JSON.stringify(dropState) });
  roomEvent(dropId, { kind: 'ended', text: 'This drop has ended. Thanks for shopping!' });
}

/** Expire holds whose timer ran out. Runs every second. */
export function startExpiryLoop() {
  setInterval(() => {
    const expired = db.prepare(`SELECT id FROM claims WHERE status = 'holding' AND hold_until < ?`).all(now()) as { id: string }[];
    for (const e of expired) {
      try { release(e.id, 'expired'); } catch (err) { console.error('expiry', err); }
    }
  }, 1000);
}

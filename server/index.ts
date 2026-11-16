import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import { db, now, rid, tx } from './db.ts';
import { nexconn } from './nexconn.ts';
import { mockbus } from './mockbus.ts';
import { presence } from './presence.ts';
import crypto from 'node:crypto';
import { CURRENCIES, MSG } from '../shared/types.ts';
import {
  AppError, SYSTEM_USER, republishLive, sellerTrust, buyerMarkPaid, markShipped, claim, closeItem, dropItem, endDrop, logEvent, myClaims, publicDrop,
  q, release, sellerConfirm, sellerUserId, startExpiryLoop, toItem,
} from './engine.ts';
import type { AppConfig } from '../shared/types.ts';

const app = express();
app.set('trust proxy', 'loopback'); // behind Caddy on the same host
app.use(express.json({ limit: '3mb' }));

// Tiny fixed-window rate limiter (single process). Lenient: campus Wi-Fi puts many buyers behind one IP.
const hits = new Map<string, { n: number; reset: number }>();
const limit = (bucket: string, max: number, windowMs: number) => (req: Request, _res: Response, next: NextFunction) => {
  const key = `${bucket}:${req.ip}:${bucket === 'claim' ? req.header('x-buyer-id') || '' : ''}`;
  const t = Date.now();
  const cur = hits.get(key);
  if (!cur || cur.reset < t) hits.set(key, { n: 1, reset: t + windowMs });
  else if (++cur.n > max) return next(new AppError(429, 'SLOW_DOWN', 'Too many requests — please wait a moment.'));
  next();
};
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, 60_000).unref();

const HOLD_CHOICES = [2, 3, 5, 10, 15];
const holdMinutes = (v: unknown): number | null => {
  const n = Number(v);
  if (v === undefined || v === null || v === '') return null;
  if (!HOLD_CHOICES.includes(n)) throw new AppError(400, 'BAD_HOLD', `Hold time must be one of ${HOLD_CHOICES.join(', ')} minutes`);
  return n;
};

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) { next(e); }
};

const str = (v: unknown, max: number, field: string, required = true) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new AppError(400, 'BAD_INPUT', `${field} is required`);
  return s.slice(0, max);
};

// ---------- auth helpers ----------

type SellerAuth = { id: string; name: string; shop: string; upi: string; currency: string; pay_link: string | null; pay_note: string | null;
  pro_until: number | null; trial_used: number; founding: number; ref_by: string | null; role: 'owner' | 'cohost'; cohostName: string | null; cohostId: string | null };
const SELLER_COLS = 'id, name, shop, upi, currency, pay_link, pay_note, pro_until, trial_used, founding, ref_by';

/** The shop's owner (seller key) or one of its co-hosts (own key, Pro). Never returns the owner's key. */
function seller(req: Request): SellerAuth {
  const id = req.header('x-seller-id') || '';
  const key = req.header('x-seller-key') || '';
  const owner = db.prepare(`SELECT ${SELLER_COLS} FROM sellers WHERE id = ? AND key = ?`).get(id, key) as Omit<SellerAuth, 'role' | 'cohostName'> | undefined;
  if (owner) return { ...owner, role: 'owner', cohostName: null, cohostId: null };
  const co = db.prepare('SELECT id, name FROM cohosts WHERE seller_id = ? AND key = ?').get(id, key) as { id: string; name: string } | undefined;
  if (co) {
    const s = db.prepare(`SELECT ${SELLER_COLS} FROM sellers WHERE id = ?`).get(id) as Omit<SellerAuth, 'role' | 'cohostName' | 'cohostId'>;
    if (isPro(s)) return { ...s, role: 'cohost', cohostName: co.name, cohostId: co.id };
    throw new AppError(401, 'NO_AUTH', 'Co-host access is paused: the shop\'s Pro plan has ended');
  }
  throw new AppError(401, 'NO_AUTH', 'Seller session not found');
}
const isPro = (s: { pro_until: number | null }) => !!s.pro_until && s.pro_until > now();
const cohostUserId = (cohostId: string) => `c_${cohostId}`;
/** A co-host chat identity is only valid while that co-host is on the team and the shop is on Pro. */
function activeCohost(userId: string) {
  if (!userId.startsWith('c_')) return null;
  const r = db.prepare('SELECT c.name, c.seller_id, s.pro_until FROM cohosts c JOIN sellers s ON s.id = c.seller_id WHERE c.id = ?').get(userId.slice(2)) as
    { name: string; seller_id: string; pro_until: number | null } | undefined;
  return r && isPro(r) ? r : null;
}
/** Account-level actions (team, plan) are for the shop owner only. */
function ownerOnly(req: Request) {
  const s = seller(req);
  if (s.role !== 'owner') throw new AppError(403, 'OWNER_ONLY', 'Only the shop owner can do this');
  return s;
}

function buyer(req: Request) {
  const id = req.header('x-buyer-id') || '';
  const key = req.header('x-buyer-key') || '';
  const row = db.prepare('SELECT id, name, is_guest AS isGuest FROM buyers WHERE id = ? AND key = ?').get(id, key) as { id: string; name: string; isGuest: number } | undefined;
  if (!row) throw new AppError(401, 'NO_AUTH', 'Please join the drop first');
  return row;
}

function ownDrop(req: Request) {
  const s = seller(req);
  const d = q.drop(String(req.params.dropId));
  if (!d || d.seller_id !== s.id) throw new AppError(404, 'NO_DROP', 'Drop not found');
  return { s, d };
}

// ---------- config & images ----------

app.get('/api/config', h((): AppConfig => ({ mode: config.mode, appKey: config.mode === 'nexconn' ? config.nexconn.appKey : null, area: config.nexconn.area })));

app.get('/img/:id', (req, res) => {
  const row = db.prepare('SELECT mime, data FROM images WHERE id = ?').get(req.params.id) as { mime: string; data: Uint8Array } | undefined;
  if (!row) return res.status(404).end();
  res.set('Content-Type', row.mime).set('Cache-Control', 'public, max-age=31536000, immutable').send(Buffer.from(row.data));
});

function saveImage(dataUrl: unknown): string | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new AppError(400, 'BAD_IMAGE', 'Unsupported image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1_500_000) throw new AppError(400, 'BAD_IMAGE', 'Image too large');
  const id = rid(16);
  db.prepare('INSERT INTO images (id, mime, data) VALUES (?, ?, ?)').run(id, m[1], buf);
  return id;
}

// ---------- seller ----------

app.post('/api/sellers', limit('seller', 10, 60 * 60_000), h(async (req) => {
  const name = str(req.body.name, 60, 'Your name');
  const shop = str(req.body.shop, 60, 'Shop name');
  // "How buyers pay you": a UPI ID (India) or any https payment link (PayPal.me, Venmo, Stripe, GCash…).
  const currency = (CURRENCIES as readonly string[]).includes(String(req.body.currency)) ? String(req.body.currency) : 'INR';
  const payInput = str(req.body.upi ?? req.body.pay, 300, 'How buyers pay you');
  // INR: a UPI ID. Anywhere: an https payment link. Otherwise: account details shown to the winner (GCash number, bank account, Zelle email…).
  const isLink = /^https:\/\/\S+\.\S+/i.test(payInput);
  const isUpi = !isLink && currency === 'INR' && /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(payInput);
  const upi = isUpi ? payInput : '';
  const payLink = isLink ? payInput : null;
  const payNote = !isLink && !isUpi ? payInput : null;
  const rawPhone = str(req.body.phone, 20, 'WhatsApp number', false).replace(/[\s-()]/g, '');
  const phone = currency === 'INR' ? rawPhone.replace(/^\+?91/, '') : rawPhone.replace(/^\+/, '');
  if (phone && (currency === 'INR' ? !/^[6-9]\d{9}$/.test(phone) : !/^\d{7,15}$/.test(phone))) {
    throw new AppError(400, 'BAD_PHONE', currency === 'INR' ? 'Enter a 10-digit WhatsApp number' : 'Enter your WhatsApp number with country code');
  }
  if (payNote && payNote.length < 6) throw new AppError(400, 'BAD_PAY', currency === 'INR' ? 'Enter a UPI ID (yourname@okicici), a payment link, or your account details' : 'Enter a payment link (https://…) or your account details');
  const id = rid(10);
  const key = rid(24);
  // Founding sellers (first 100 real shops) get 50% off Pro for a year. A shop that was invited remembers who invited it.
  const founding = (db.prepare(`SELECT COUNT(*) AS n FROM sellers WHERE id != 'demoshop'`).get() as { n: number }).n < 100 ? 1 : 0;
  const refBy = typeof req.body.ref === 'string' && q.seller(req.body.ref) && req.body.ref !== 'demoshop' ? req.body.ref : null;
  db.prepare('INSERT INTO sellers (id, name, shop, upi, key, created, phone, currency, pay_link, pay_note, founding, ref_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, shop, upi, key, now(), phone || null, currency, payLink, payNote, founding, refBy);
  const userId = sellerUserId(id);
  const token = await nexconn.token(userId, shop);
  return { id, key, name, shop, upi, payLink, payNote, currency, phone: phone || null, userId, token };
}));

app.post('/api/seller/session', h(async (req) => {
  const s = seller(req);
  // Co-hosts get their OWN chat identity (c_<id>), never the shop's: they act through the server (which checks they're still
  // on the team and the shop is still Pro), so removing a co-host or a lapsed plan cuts them off everywhere at once.
  const userId = s.cohostId ? cohostUserId(s.cohostId) : sellerUserId(s.id);
  return { id: s.id, name: s.name, shop: s.shop, upi: s.upi, currency: s.currency, payLink: s.pay_link, payNote: s.pay_note,
    role: s.role, cohostName: s.cohostName, pro: isPro(s), proUntil: s.pro_until, trialUsed: !!s.trial_used, founding: !!s.founding,
    referred: !!s.ref_by, referrals: (db.prepare('SELECT COUNT(*) AS n FROM sellers WHERE ref_by = ?').get(s.id) as { n: number }).n,
    userId, token: await nexconn.token(userId, s.cohostName ? `${s.cohostName} (${s.shop} team)` : s.shop) };
}));

// ---------- Pro: free trial + co-hosts ----------

/** 14-day Pro trial, once per shop. (Billing would extend pro_until; the plan check is the same either way.) */
app.post('/api/seller/pro/trial', h((req) => {
  const s = ownerOnly(req);
  if (isPro(s)) return { pro: true, proUntil: s.pro_until };
  if (s.trial_used) throw new AppError(409, 'TRIAL_USED', 'Your free trial has been used. Pro billing opens soon.');
  const until = now() + (s.ref_by ? 30 : 14) * 86_400_000; // invited shops get a month
  db.prepare('UPDATE sellers SET pro_until = ?, trial_used = 1 WHERE id = ?').run(until, s.id);
  return { pro: true, proUntil: until };
}));

/** Co-hosts: helpers who run the console (confirm payments, drop items, ship) on their own device with their own key. */
app.get('/api/seller/cohosts', h((req) => {
  const s = ownerOnly(req);
  return db.prepare('SELECT id, name, created FROM cohosts WHERE seller_id = ? ORDER BY created').all(s.id);
}));

app.post('/api/seller/cohosts', limit('cohost', 20, 60 * 60_000), h((req) => {
  const s = ownerOnly(req);
  if (!isPro(s)) throw new AppError(402, 'PRO_ONLY', 'Co-hosts are a Pro feature. Start your free trial to add one.');
  const name = str(req.body.name, 40, 'Co-host name');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM cohosts WHERE seller_id = ?').get(s.id) as { n: number }).n;
  if (n >= 5) throw new AppError(409, 'TOO_MANY', 'Up to 5 co-hosts per shop');
  const id = rid(8);
  const key = rid(24);
  db.prepare('INSERT INTO cohosts (id, seller_id, name, key, created) VALUES (?, ?, ?, ?, ?)').run(id, s.id, name, key, now());
  // The invite is a login link for this co-host only; removing them revokes it.
  return { id, name, link: `${config.publicUrl || ''}/sell/login#${s.id}.${key}` };
}));

app.delete('/api/seller/cohosts/:id', h((req) => {
  const s = ownerOnly(req);
  db.prepare('DELETE FROM cohosts WHERE id = ? AND seller_id = ?').run(String(req.params.id), s.id);
  db.prepare('DELETE FROM tokens WHERE user_id = ?').run(cohostUserId(String(req.params.id))); // no cached chat token survives removal
  return { ok: true };
}));

/** Names for Nexconn Chat UI (its reqUserProfiles hook): buyers who ordered from this seller, plus the seller. */
app.get('/api/seller/profiles', h((req) => {
  const s = seller(req);
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 100);
  return ids.map((userId) => {
    if (userId === sellerUserId(s.id)) return { userId, name: s.shop };
    if (userId === SYSTEM_USER) return { userId, name: 'ClaimIt' };
    const b = db.prepare(`SELECT b.name FROM buyers b WHERE b.id = ? AND EXISTS (
      SELECT 1 FROM claims c JOIN drops d ON d.id = c.drop_id WHERE c.buyer_id = b.id AND d.seller_id = ?)`).get(userId, s.id) as { name: string } | undefined;
    return { userId, name: b?.name ?? 'Buyer' };
  });
}));

app.get('/api/seller/drops', h((req) => {
  const s = seller(req);
  return db.prepare(`SELECT d.id, d.title, d.status, d.created,
      (SELECT COUNT(*) FROM items i WHERE i.drop_id = d.id) AS items,
      (SELECT COUNT(*) FROM items i WHERE i.drop_id = d.id AND i.status = 'sold') AS sold
    FROM drops d WHERE d.seller_id = ? ORDER BY d.created DESC`).all(s.id);
}));

app.post('/api/seller/drops', limit('drop', 20, 60 * 60_000), h(async (req) => {
  const s = seller(req);
  const title = str(req.body.title, 80, 'Drop title');
  const liveUrl = str(req.body.liveUrl, 300, 'Live link', false) || null;
  const hold = holdMinutes(req.body.holdMinutes) ?? Math.round(config.holdSeconds / 60);
  return openDrop(req, s, title, liveUrl, hold);
}));

/** "Run again": a new drop with the same settings and every item that didn't sell last time (photos, names, prices). */
app.post('/api/seller/drops/:dropId/again', limit('drop', 20, 60 * 60_000), h(async (req) => {
  const { s, d } = ownDrop(req);
  // Only items that are truly free: never dropped, pulled, or still up with nobody claiming. An item someone is holding or
  // paying for in the old drop can still be bought there, so copying it could sell the same piece twice.
  const left = db.prepare(`SELECT name, price, image_id FROM items i WHERE i.drop_id = ? AND (i.status IN ('draft','closed')
    OR (i.status = 'live' AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.item_id = i.id AND c.status IN ('holding','paying','waiting')))) ORDER BY idx`)
    .all(d.id) as { name: string; price: number; image_id: string | null }[];
  const held = (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE drop_id = ? AND status IN ('held','paying')`).get(d.id) as { n: number }).n;
  const title = d.title.replace(/ · again( \d+)?$/, '').slice(0, 70) + ' · again';
  const practice = !!(d as { practice?: number }).practice;
  const r = await openDrop(req, s, title, d.live_url, Math.round((d.hold_seconds || config.holdSeconds) / 60), practice);
  left.slice(0, MAX_ITEMS_PER_DROP).forEach((it, i) => db.prepare('INSERT INTO items (id, drop_id, name, price, image_id, status, idx) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(rid(8), r.id, it.name, it.price, it.image_id, 'draft', i + 1));
  return { ...r, items: Math.min(left.length, MAX_ITEMS_PER_DROP), skippedHeld: held };
}));

/** Followers hear about a shop's new drop at most once every 30 minutes, however many drops are opened. */
const lastNotified = new Map<string, number>();

async function openDrop(req: Request, s: { id: string; shop: string }, title: string, liveUrl: string | null, hold: number, practice = false) {
  const id = rid(8);
  const channelId = `drop_${id}`;
  await nexconn.createOpenChannel(channelId);
  db.prepare('INSERT INTO drops (id, seller_id, title, channel_id, status, live_url, created, hold_seconds, practice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, s.id, title, channelId, 'live', liveUrl, now(), hold * 60, practice ? 1 : 0);
  if (practice || now() - (lastNotified.get(s.id) ?? 0) < 30 * 60_000) return { id, notified: 0 };
  lastNotified.set(s.id, now());
  // Tell followers over Nexconn (1:1 message from the shop), in batches of up to 1000 recipients per call.
  const followers = (db.prepare('SELECT buyer_id FROM follows WHERE seller_id = ?').all(s.id) as { buyer_id: string }[]).map((r) => r.buyer_id);
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  for (let i = 0; i < followers.length; i += 1000) {
    nexconn.sendDirect(sellerUserId(s.id), '', 'RC:TxtMsg', { content: `🔴 ${s.shop} just opened a new drop: “${title}”. First tap wins → ${base}/d/${id}` },
      `${s.shop} is dropping live now`, followers.slice(i, i + 1000)).catch((e) => console.error('[notify followers]', e?.message));
  }
  return { id, notified: followers.length };
}

app.get('/api/seller/drops/:dropId', h(async (req) => {
  const { d } = ownDrop(req);
  const inRoom = await nexconn.participantCount(d.channel_id);
  const items = q.items(d.id).map(toItem);
  const claims = db.prepare(`SELECT c.id, c.item_id AS itemId, c.buyer_id AS buyerId, c.buyer_name AS buyerName, c.status, c.seq,
      c.created, c.hold_until AS holdUntil, c.utr, c.paid_at AS paidAt, c.paying_at AS payingAt,
      c.ship_phone AS shipPhone, c.ship_address AS shipAddress, c.ship_pincode AS shipPincode, c.shipped_at AS shippedAt, c.tracking
    FROM claims c WHERE c.drop_id = ? ORDER BY c.created DESC`).all(d.id);
  const count = (kind: string, distinct = false) => (db.prepare(
    `SELECT COUNT(${distinct ? 'DISTINCT user_id' : '*'}) AS n FROM events WHERE drop_id = ? AND kind = ?`).get(d.id, kind) as { n: number }).n;
  const revenue = (db.prepare(`SELECT COALESCE(SUM(i.price), 0) AS n FROM claims c JOIN items i ON i.id = c.item_id
    WHERE c.drop_id = ? AND c.status = 'paid'`).get(d.id) as { n: number }).n;
  return {
    drop: { ...publicDrop(d.id), inRoom },
    items,
    claims,
    stats: {
      viewers: count('join', true),
      claimAttempts: count('claim_attempt'),
      claimers: count('claim_attempt', true),
      sold: items.filter((i) => i.status === 'sold').length,
      revenue,
      viaShares: (db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE drop_id = ? AND kind = 'join' AND ref IS NOT NULL`).get(d.id) as { n: number }).n,
      followers: (db.prepare('SELECT COUNT(*) AS n FROM follows WHERE seller_id = ?').get(d.seller_id) as { n: number }).n,
      ...sellerRoi(d.id),
    },
  };
}));

/** What fair drops were worth to the seller: sales rescued from no-shows (a winner who never paid: only expired holds count,
 *  not buyers who let go or payments the seller rejected), races settled, how fast payments were confirmed. */
function sellerRoi(dropId: string) {
  const one = (sql: string) => Number(Object.values(db.prepare(sql).get(dropId) as object)[0] ?? 0);
  return {
    // Sold to someone further down the line after an earlier winner didn't pay: in "comment MINE" this sale is usually lost.
    recovered: one(`SELECT COALESCE(SUM(i.price),0) FROM items i WHERE i.drop_id = ? AND i.status = 'sold' AND EXISTS (
      SELECT 1 FROM claims c WHERE c.item_id = i.id AND c.status = 'expired' AND c.created >= COALESCE(i.dropped_at,0))`),
    recoveredItems: one(`SELECT COUNT(*) FROM items i WHERE i.drop_id = ? AND i.status = 'sold' AND EXISTS (
      SELECT 1 FROM claims c WHERE c.item_id = i.id AND c.status = 'expired' AND c.created >= COALESCE(i.dropped_at,0))`),
    // Items where 2+ people raced: each one a potential "I commented first!" argument.
    contested: one(`SELECT COUNT(*) FROM (SELECT item_id FROM claims WHERE drop_id = ? GROUP BY item_id HAVING COUNT(*) >= 2)`),
    avgConfirmSec: Math.round(one(`SELECT COALESCE(AVG(paid_at - paying_at),0) FROM claims WHERE drop_id = ? AND status = 'paid' AND paying_at IS NOT NULL`) / 1000),
  };
}

/**
 * Lifetime value of ClaimIt for this shop (all real drops). Everyone sees the headline (what fair drops rescued, and whether
 * that covers Pro); the deeper analytics (no-show rate, repeat buyers, time to pay, best drop hour) are a Pro feature.
 */
app.get('/api/seller/insights', h((req) => {
  const s = seller(req);
  const one = (sql: string, ...a: unknown[]) => Number(Object.values(db.prepare(sql).get(...(a as any[])) as object)[0] ?? 0);
  const REAL = `d.seller_id = ? AND d.practice = 0`;
  const monthAgo = now() - 30 * 86_400_000;
  const rescued = (since: number) => one(`SELECT COALESCE(SUM(i.price),0) FROM items i JOIN drops d ON d.id = i.drop_id WHERE ${REAL} AND i.status = 'sold'
    AND i.dropped_at >= ? AND EXISTS (SELECT 1 FROM claims c WHERE c.item_id = i.id AND c.status = 'expired' AND c.created >= COALESCE(i.dropped_at,0))`, s.id, since);
  const base = {
    currency: s.currency,
    drops: one(`SELECT COUNT(*) FROM drops d WHERE ${REAL}`, s.id),
    sold: one(`SELECT COUNT(*) FROM items i JOIN drops d ON d.id = i.drop_id WHERE ${REAL} AND i.status = 'sold'`, s.id),
    revenue: one(`SELECT COALESCE(SUM(i.price),0) FROM claims c JOIN items i ON i.id = c.item_id JOIN drops d ON d.id = c.drop_id WHERE ${REAL} AND c.status = 'paid'`, s.id),
    rescuedAllTime: rescued(0),
    rescuedThisMonth: rescued(monthAgo),
    pro: isPro(s),
  };
  if (!base.pro) return base;
  // Of all holds that ended in "paid" or "never paid", the share that never paid.
  const winners = one(`SELECT COUNT(*) FROM claims c JOIN drops d ON d.id = c.drop_id WHERE ${REAL} AND c.status IN ('paid','expired')`, s.id);
  const noShows = one(`SELECT COUNT(*) FROM claims c JOIN drops d ON d.id = c.drop_id WHERE ${REAL} AND c.status = 'expired'`, s.id);
  const buyers = db.prepare(`SELECT c.buyer_id, COUNT(DISTINCT c.drop_id) AS n FROM claims c JOIN drops d ON d.id = c.drop_id WHERE ${REAL} AND c.status = 'paid' GROUP BY c.buyer_id`).all(s.id) as { n: number }[];
  const hours = db.prepare(`SELECT CAST(strftime('%H', c.paid_at / 1000, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS n FROM claims c JOIN drops d ON d.id = c.drop_id
    WHERE ${REAL} AND c.status = 'paid' GROUP BY h ORDER BY n DESC LIMIT 1`).get(s.id) as { h: number; n: number } | undefined;
  return {
    ...base,
    noShowRate: winners ? Math.round((noShows / winners) * 100) : null,
    buyers: buyers.length,
    repeatBuyers: buyers.filter((b) => b.n > 1).length,
    avgPaySec: Math.round(one(`SELECT COALESCE(AVG(c.paying_at - c.created),0) FROM claims c JOIN drops d ON d.id = c.drop_id WHERE ${REAL} AND c.paying_at IS NOT NULL`, s.id) / 1000),
    ...(({ avgConfirmSec, rejectedPct, reports }) => ({ avgConfirmSec, rejectedPct, reports }))(sellerTrust(s.id)),
    bestHourUtc: hours ? hours.h : null,
  };
}));

app.patch('/api/seller/drops/:dropId', h((req) => {
  const { d } = ownDrop(req);
  if ('liveUrl' in req.body) db.prepare('UPDATE drops SET live_url = ? WHERE id = ?').run(str(req.body.liveUrl, 300, 'Live link', false) || null, d.id);
  const hold = holdMinutes(req.body.holdMinutes);
  if (hold) db.prepare('UPDATE drops SET hold_seconds = ? WHERE id = ?').run(hold * 60, d.id);
}));

/** Orders for shipping: everything paid or awaiting confirmation, as CSV. */
app.get('/api/seller/drops/:dropId/orders.csv', (req, res, next) => {
  try {
    const { d } = ownDrop(req);
    const rows = db.prepare(`SELECT c.id, i.idx, i.name AS item, i.price, c.buyer_name, c.ship_phone, c.ship_address, c.ship_pincode,
        c.utr, c.status, c.paid_at, c.created
      FROM claims c JOIN items i ON i.id = c.item_id WHERE c.drop_id = ? AND c.status IN ('paid','paying') ORDER BY i.idx`).all(d.id) as Record<string, unknown>[];
    const cell = (v: unknown) => {
      let t = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(t) && typeof v === 'string') t = `'${t}`; // no spreadsheet formula injection from buyer-typed fields
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const fmt = (ms: unknown) => (ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16) : '');
    const lines = [['Order ID', 'Item #', 'Item', `Price (${q.seller(d.seller_id)?.currency ?? 'USD'})`, 'Buyer', 'Phone', 'Address', 'Postal code', 'Payment ref', 'Status', 'Paid at (UTC)'].join(',')];
    for (const r of rows) {
      lines.push([r.id, r.idx, r.item, r.price, r.buyer_name, r.ship_phone, r.ship_address, r.ship_pincode, r.utr,
        r.status === 'paid' ? 'Payment confirmed' : 'Awaiting confirmation', fmt(r.paid_at)].map(cell).join(','));
    }
    res.set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="claimit-orders-${d.id}.csv"`)
      .send('\uFEFF' + lines.join('\r\n'));
  } catch (e) { next(e); }
});

app.post('/api/seller/drops/:dropId/items', h((req) => {
  const { d } = ownDrop(req);
  const name = str(req.body.name, 80, 'Item name');
  const price = Math.round(Number(req.body.price) * 100) / 100;
  if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) throw new AppError(400, 'BAD_PRICE', 'Enter a price');
  // Each item's live queue is one open-channel metadata key, and a channel holds at most 100 keys (one is the drop state).
  const count = (db.prepare('SELECT COUNT(*) AS n FROM items WHERE drop_id = ?').get(d.id) as { n: number }).n;
  if (count >= MAX_ITEMS_PER_DROP) throw new AppError(409, 'TOO_MANY', `A drop can hold ${MAX_ITEMS_PER_DROP} items — start a second drop for the rest`);
  const imageId = saveImage(req.body.image);
  const idx = (db.prepare('SELECT COALESCE(MAX(idx), 0) + 1 AS n FROM items WHERE drop_id = ?').get(d.id) as { n: number }).n;
  const id = rid(8);
  db.prepare('INSERT INTO items (id, drop_id, name, price, image_id, status, idx) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, d.id, name, price, imageId, 'draft', idx);
  return toItem(q.item(id)!);
}));

app.delete('/api/seller/drops/:dropId/items/:itemId', h((req) => {
  const { d } = ownDrop(req);
  const it = q.item(String(req.params.itemId));
  if (!it || it.drop_id !== d.id) throw new AppError(404, 'NO_ITEM', 'Item not found');
  if (it.status !== 'draft') throw new AppError(409, 'LIVE', 'Only items that have not been dropped can be deleted');
  db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
}));

app.post('/api/seller/drops/:dropId/items/:itemId/drop', h((req) => dropItem(ownDrop(req).d.id, String(req.params.itemId))));
app.post('/api/seller/drops/:dropId/items/:itemId/close', h((req) => closeItem(ownDrop(req).d.id, String(req.params.itemId))));
/** The shop replies to the room. Sent by the server as the shop, as a priority type, so it lands even when fan chat floods. */
app.post('/api/seller/drops/:dropId/say', limit('say', 60, 60_000), h(async (req) => {
  const { d, s } = ownDrop(req);
  const text = str(req.body.text, 200, 'Message');
  await nexconn.sendOpen(d.channel_id, sellerUserId(s.id), MSG.SELLER_CHAT, { text, name: s.shop }, 2);
  return { ok: true };
}));

app.post('/api/seller/drops/:dropId/end', h((req) => {
  const { d } = ownDrop(req);
  endDrop(d.id);
  rewardReferrer(d.seller_id);
}));

/** When an invited shop finishes its first real drop with a sale, the shop that invited it gets a month of Pro. */
function rewardReferrer(sellerId: string) {
  const s = db.prepare('SELECT ref_by, ref_rewarded FROM sellers WHERE id = ?').get(sellerId) as { ref_by: string | null; ref_rewarded: number } | undefined;
  if (!s?.ref_by || s.ref_rewarded) return;
  const sold = (db.prepare(`SELECT COUNT(*) AS n FROM claims c JOIN drops d ON d.id = c.drop_id WHERE d.seller_id = ? AND d.practice = 0 AND c.status = 'paid'`).get(sellerId) as { n: number }).n;
  if (!sold) return;
  tx(() => {
    const r = db.prepare('SELECT pro_until FROM sellers WHERE id = ?').get(s.ref_by) as { pro_until: number | null };
    db.prepare('UPDATE sellers SET pro_until = ? WHERE id = ?').run(Math.max(now(), r.pro_until ?? 0) + 30 * 86_400_000, s.ref_by);
    db.prepare('UPDATE sellers SET ref_rewarded = 1 WHERE id = ?').run(sellerId);
  });
}

app.post('/api/seller/claims/:claimId/confirm', h((req) => sellerConfirm(String(req.params.claimId), seller(req).id)));
app.post('/api/seller/claims/:claimId/shipped', h((req) => markShipped(String(req.params.claimId), seller(req).id, str(req.body.tracking, 120, 'Tracking', false))));

/** A private rehearsal: a drop with 3 sample items the seller can open as a buyer in another tab. */
app.post('/api/seller/practice', h(async (req) => {
  const s = seller(req);
  const id = rid(8);
  const channelId = `drop_${id}`;
  await nexconn.createOpenChannel(channelId);
  db.prepare('INSERT INTO drops (id, seller_id, title, channel_id, status, created, hold_seconds, practice) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .run(id, s.id, 'Practice drop (only you can see this)', channelId, 'live', now(), 120);
  const demo = path.resolve(fs.existsSync('dist/web/demo') ? 'dist/web/demo' : 'web/public/demo');
  const prices = s.currency === 'INR' ? [299, 549, 899] : s.currency === 'IDR' ? [150000, 250000, 450000] : s.currency === 'PHP' ? [450, 799, 1499] : [18, 29, 42];
  const samples: [string, number, string][] = [['Canvas tote (practice)', prices[0], 'canvas-tote.jpg'], ['Floral dress (practice)', prices[1], 'floral-kurti.jpg'], ['Denim jacket (practice)', prices[2], 'denim-jacket.jpg']];
  samples.forEach(([name, price, file], i) => {
    let imageId: string | null = null;
    try { imageId = rid(16); db.prepare('INSERT INTO images (id, mime, data) VALUES (?, ?, ?)').run(imageId, 'image/jpeg', fs.readFileSync(path.join(demo, file))); } catch { imageId = null; }
    db.prepare('INSERT INTO items (id, drop_id, name, price, image_id, status, idx) VALUES (?, ?, ?, ?, ?, ?, ?)').run(rid(8), id, name, price, imageId, 'draft', i + 1);
  });
  return { id };
}));

app.post('/api/seller/claims/:claimId/reject', h((req) => {
  const s = seller(req);
  const c = q.claim(String(req.params.claimId));
  if (!c || q.drop(c.drop_id)?.seller_id !== s.id) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  // Only a claim still waiting on a decision can be rejected: once confirmed (or released), the decision is final.
  if (c.status !== 'paying' && c.status !== 'holding') throw new AppError(409, 'BAD_STATE', c.status === 'paid' ? 'Already confirmed as paid' : 'Nothing to reject');
  release(c.id, 'rejected');
  return { ok: true };
}));

// ---------- buyer ----------

// Anyone with the link can watch immediately as a guest; a real name is only needed to claim.
// Generous per-IP limit: Jio/Airtel CGNAT and campus Wi-Fi put many real buyers behind one IP.
app.post('/api/buyers', limit('join', 600, 10 * 60_000), h(async (req) => {
  const given = str(req.body.name, 30, 'Your name', false);
  const guest = given.length < 2;
  const name = guest ? `Guest ${Math.floor(1000 + Math.random() * 9000)}` : given;
  const id = `b_${rid(10)}`;
  const key = rid(24);
  db.prepare('INSERT INTO buyers (id, name, key, created, is_guest) VALUES (?, ?, ?, ?, ?)').run(id, name, key, now(), guest ? 1 : 0);
  return { id, key, name, isGuest: guest, token: await nexconn.token(id, name) };
}));

app.patch('/api/buyer', h((req) => {
  const b = buyer(req);
  const name = str(req.body.name, 30, 'Your name');
  if (name.length < 2) throw new AppError(400, 'BAD_NAME', 'Name needs at least 2 letters');
  db.prepare('UPDATE buyers SET name = ?, is_guest = 0 WHERE id = ?').run(name, b.id);
  return { id: b.id, name, isGuest: false };
}));

app.post('/api/buyer/session', h(async (req) => {
  const b = buyer(req);
  return { id: b.id, name: b.name, isGuest: !!b.isGuest, token: await nexconn.token(b.id, b.name) };
}));

app.get('/demo', (_req, res) => res.redirect('/d/demo'));

app.get('/api/drops/:dropId', h(async (req) => {
  const d = publicDrop(String(req.params.dropId));
  return { ...d, inRoom: await nexconn.participantCount(d.channelId) };
}));

app.post('/api/drops/:dropId/join', h((req) => {
  const b = buyer(req);
  const d = q.drop(String(req.params.dropId));
  if (!d) throw new AppError(404, 'NO_DROP', 'Drop not found');
  const ref = typeof req.body.ref === 'string' && /^b_[a-z0-9]{6,16}$/.test(req.body.ref) && req.body.ref !== b.id ? req.body.ref : null;
  const seen = db.prepare(`SELECT 1 FROM events WHERE drop_id = ? AND kind = 'join' AND user_id = ? AND at > ?`).get(d.id, b.id, now() - 30 * 60_000);
  if (!seen) db.prepare('INSERT INTO events (drop_id, kind, user_id, at, ref) VALUES (?, ?, ?, ?, ?)').run(d.id, 'join', b.id, now(), ref);
}));

// ---------- shops, follow, impact, pricing waitlist, feedback ----------

function optionalBuyer(req: Request) {
  try { return buyer(req); } catch { return null; }
}

app.get('/api/shops/:sellerId', h((req) => {
  const s = q.seller(String(req.params.sellerId));
  if (!s) throw new AppError(404, 'NO_SHOP', 'Shop not found');
  const b = optionalBuyer(req);
  const drops = db.prepare(`SELECT d.id, d.title, d.status, d.created,
      (SELECT COUNT(*) FROM items i WHERE i.drop_id = d.id AND i.status != 'draft') AS items,
      (SELECT COUNT(*) FROM items i WHERE i.drop_id = d.id AND i.status = 'sold') AS sold,
      (SELECT image_id FROM items i WHERE i.drop_id = d.id AND i.image_id IS NOT NULL ORDER BY i.idx LIMIT 1) AS cover
    FROM drops d WHERE d.seller_id = ? AND d.practice = 0 ORDER BY d.created DESC LIMIT 30`).all(s.id) as { cover: string | null }[];
  const count = (sql: string) => Number(Object.values(db.prepare(sql).get(s.id) as object)[0] ?? 0);
  return {
    id: s.id, shop: s.shop, name: s.name,
    followers: count('SELECT COUNT(*) FROM follows WHERE seller_id = ?'),
    orders: count(`SELECT COUNT(*) FROM claims c JOIN drops d ON d.id = c.drop_id WHERE d.seller_id = ? AND c.status = 'paid'`),
    ...(({ avgConfirmSec, rejectedPct, reports }) => ({ avgConfirmSec, rejectedPct, reports }))(sellerTrust(s.id)),
    since: Number(Object.values(db.prepare('SELECT created FROM sellers WHERE id = ?').get(s.id) as object)[0]),
    following: b ? !!db.prepare('SELECT 1 FROM follows WHERE seller_id = ? AND buyer_id = ?').get(s.id, b.id) : false,
    drops: drops.map((d) => ({ ...d, cover: d.cover ? `/img/${d.cover}` : null })),
  };
}));

app.post('/api/shops/:sellerId/follow', h((req) => {
  const b = buyer(req);
  const s = q.seller(String(req.params.sellerId));
  if (!s) throw new AppError(404, 'NO_SHOP', 'Shop not found');
  if (req.body.follow === false) db.prepare('DELETE FROM follows WHERE seller_id = ? AND buyer_id = ?').run(s.id, b.id);
  else db.prepare('INSERT OR IGNORE INTO follows (seller_id, buyer_id, created) VALUES (?, ?, ?)').run(s.id, b.id, now());
  return { following: req.body.follow !== false, followers: Number(Object.values(db.prepare('SELECT COUNT(*) FROM follows WHERE seller_id = ?').get(s.id) as object)[0]) };
}));

/** Public, aggregate-only numbers (no personal data) — shown on /impact and the landing page. */
let impactCache: { at: number; data: unknown } | null = null;
const USD_RATE: Record<string, number> = { USD: 1, INR: 0.012, PHP: 0.017, IDR: 0.000062, SGD: 0.74, MYR: 0.21, THB: 0.028, AED: 0.27, GBP: 1.27, EUR: 1.08 };
app.get('/api/impact', h(() => {
  if (impactCache && Date.now() - impactCache.at < 30_000) return impactCache.data;
  const one = (sql: string) => Number(Object.values(db.prepare(sql).get() as object)[0] ?? 0);
  const data = {
    sellers: one(`SELECT COUNT(DISTINCT seller_id) FROM drops WHERE practice = 0`),
    drops: one('SELECT COUNT(*) FROM drops WHERE practice = 0'),
    buyers: one(`SELECT COUNT(DISTINCT e.user_id) FROM events e JOIN drops d ON d.id = e.drop_id WHERE e.kind = 'join' AND d.practice = 0`),
    claimsSettled: one(`SELECT COUNT(*) FROM claims c JOIN drops d ON d.id = c.drop_id WHERE d.practice = 0 AND c.status IN ('paid','expired','cancelled','rejected')`),
    contestedItems: one(`SELECT COUNT(*) FROM (SELECT c.item_id FROM claims c JOIN drops d ON d.id = c.drop_id WHERE d.practice = 0 GROUP BY c.item_id HAVING COUNT(*) > 1)`),
    itemsSold: one(`SELECT COUNT(*) FROM items i JOIN drops d ON d.id = i.drop_id WHERE d.practice = 0 AND i.status = 'sold'`),
    // Shops sell in many currencies: report an approximate USD total (static reference rates).
    gmvUsd: Math.round((db.prepare(`SELECT s.currency AS cur, COALESCE(SUM(i.price),0) AS total FROM claims c JOIN items i ON i.id = c.item_id
      JOIN drops d ON d.id = c.drop_id JOIN sellers s ON s.id = d.seller_id WHERE d.practice = 0 AND c.status = 'paid' GROUP BY s.currency`).all() as { cur: string; total: number }[])
      .reduce((a, r) => a + r.total * (USD_RATE[r.cur] ?? 0), 0)),
    // The always-on demo room is reported separately and clearly labelled (bots included), never mixed into real numbers.
    demo: {
      visitors: one(`SELECT COUNT(DISTINCT user_id) FROM events WHERE drop_id = 'demo' AND kind = 'join'`),
      claimTaps: one(`SELECT COUNT(*) FROM events WHERE drop_id = 'demo' AND kind = 'claim_attempt' AND user_id NOT LIKE 'bot\\_%' ESCAPE '\\'`),
      humanWins: one(`SELECT COUNT(*) FROM claims WHERE drop_id = 'demo' AND status = 'paid' AND buyer_id NOT LIKE 'bot\\_%' ESCAPE '\\'`),
    },
    proWaitlist: one('SELECT COUNT(*) FROM pro_waitlist'),
    liveNow: (db.prepare(`SELECT d.id, d.title, s.shop FROM drops d JOIN sellers s ON s.id = d.seller_id
      WHERE d.status = 'live' AND d.practice = 0 AND EXISTS (SELECT 1 FROM items i WHERE i.drop_id = d.id AND i.status != 'draft') ORDER BY d.created DESC LIMIT 5`).all()),
  };
  impactCache = { at: Date.now(), data };
  return data;
}));

app.post('/api/pro-waitlist', limit('waitlist', 20, 60 * 60_000), h((req) => {
  const contact = str(req.body.contact, 120, 'Phone or email');
  if (!/^(\S+@\S+\.\S+|\+?\d[\d\s-]{8,})$/.test(contact)) throw new AppError(400, 'BAD_CONTACT', 'Enter a phone number or email');
  const s = req.header('x-seller-id') ? (() => { try { return seller(req).id; } catch { return null; } })() : null;
  db.prepare('INSERT INTO pro_waitlist (seller_id, contact, created) VALUES (?, ?, ?)').run(s, contact, now());
  return { ok: true };
}));

/** Buyer protection for direct payments: report a shop. Reports are reviewed, and count against the shop's trust line. */
app.post('/api/shops/:sellerId/report', limit('report', 10, 60 * 60_000), h((req) => {
  const b = buyer(req);
  const s = q.seller(String(req.params.sellerId));
  if (!s) throw new AppError(404, 'NO_SHOP', 'Shop not found');
  const reason = ['no_item', 'payment_not_confirmed', 'scam', 'other'].includes(String(req.body.reason)) ? String(req.body.reason) : 'other';
  db.prepare('INSERT OR IGNORE INTO shop_reports (seller_id, buyer_id, reason, text, created) VALUES (?, ?, ?, ?, ?)')
    .run(s.id, b.id, reason, str(req.body.text, 500, 'Details', false) || null, now());
  return { ok: true };
}));

app.post('/api/feedback', limit('feedback', 30, 60 * 60_000), h((req) => {
  const role = req.body.role === 'seller' ? 'seller' : 'buyer';
  const who = role === 'seller' ? (() => { try { return seller(req).id; } catch { return null; } })() : optionalBuyer(req)?.id ?? null;
  const rating = Number.isFinite(Number(req.body.rating)) ? Math.max(0, Math.min(10, Math.round(Number(req.body.rating)))) : null;
  db.prepare('INSERT INTO feedback (drop_id, role, user_id, rating, text, quote_ok, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(str(req.body.dropId, 20, 'drop', false) || null, role, who, rating, str(req.body.text, 500, 'text', false) || null, req.body.quoteOk ? 1 : 0, now());
  return { ok: true };
}));

/** Display names for room senders, resolved server-side so nobody can chat as the seller by faking a name. */
app.get('/api/drops/:dropId/people', h((req) => {
  const d = q.drop(String(req.params.dropId));
  if (!d) throw new AppError(404, 'NO_DROP', 'Drop not found');
  const s = q.seller(d.seller_id)!;
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 100);
  const out: Record<string, { name: string; seller?: boolean }> = {};
  for (const id of ids) {
    if (id === sellerUserId(s.id)) out[id] = { name: s.shop, seller: true };
    else if (id.startsWith('c_')) { const co = activeCohost(id); if (co && co.seller_id === s.id) out[id] = { name: `${co.name} · ${s.shop} team`, seller: true }; }
    else {
      const b = db.prepare('SELECT name FROM buyers WHERE id = ?').get(id) as { name: string } | undefined;
      if (b) out[id] = { name: b.name };
    }
  }
  return out;
}));

app.get('/api/drops/:dropId/me', h((req) => myClaims(String(req.params.dropId), buyer(req).id)));

app.post('/api/drops/:dropId/items/:itemId/claim', limit('claim', 30, 60_000), h((req) => {
  const b = buyer(req);
  if (b.isGuest && String(req.params.dropId) !== 'demo') throw new AppError(409, 'NEED_NAME', 'Tell the seller your name to claim');
  return claim(String(req.params.dropId), String(req.params.itemId), { id: b.id, name: b.name });
}));

app.post('/api/claims/:claimId/paid', h((req) => {
  const cl = q.claim(String(req.params.claimId));
  const india = (cl ? q.seller(q.drop(cl.drop_id)!.seller_id)?.currency : 'INR') === 'INR';
  const rawPhone = str(req.body.phone, 20, 'Phone number').replace(/[\s-()]/g, '');
  const phone = india ? rawPhone.replace(/^\+?91/, '') : rawPhone;
  if (india ? !/^[6-9]\d{9}$/.test(phone) : !/^\+?\d{7,15}$/.test(phone)) throw new AppError(400, 'BAD_PHONE', india ? 'Enter a 10-digit mobile number' : 'Enter a phone number with country code');
  const address = str(req.body.address, 300, 'Delivery address');
  if (address.length < 10) throw new AppError(400, 'BAD_ADDRESS', 'Please enter your full delivery address');
  const pincode = str(req.body.pincode, 10, india ? 'PIN code' : 'Postal code');
  if (india ? !/^[1-9]\d{5}$/.test(pincode) : !/^[A-Za-z0-9 -]{3,10}$/.test(pincode)) throw new AppError(400, 'BAD_PIN', india ? 'Enter a 6-digit PIN code' : 'Enter a valid postal code');
  return buyerMarkPaid(String(req.params.claimId), buyer(req).id, str(req.body.utr, 40, 'Payment reference', false), { phone, address, pincode });
}));

/** Everything a buyer has claimed, across every shop and drop, plus the shops they follow (and which are live now). */
app.get('/api/buyer/orders', h((req) => {
  const b = buyer(req);
  const drops = db.prepare(`SELECT DISTINCT drop_id FROM claims WHERE buyer_id = ? ORDER BY created DESC LIMIT 30`).all(b.id) as { drop_id: string }[];
  const orders = drops.flatMap(({ drop_id }) => {
    const d = q.drop(drop_id);
    if (!d) return [];
    return myClaims(drop_id, b.id)
      .map((c) => ({ ...c, dropId: d.id, dropTitle: d.title, sellerId: d.seller_id, dropLive: d.status === 'live' }));
  });
  const following = (db.prepare(`SELECT s.id, s.shop, (SELECT d.id FROM drops d WHERE d.seller_id = s.id AND d.status = 'live' AND d.practice = 0 ORDER BY d.created DESC LIMIT 1) AS liveDrop,
      (SELECT d.title FROM drops d WHERE d.seller_id = s.id AND d.status = 'live' AND d.practice = 0 ORDER BY d.created DESC LIMIT 1) AS liveTitle
    FROM follows f JOIN sellers s ON s.id = f.seller_id WHERE f.buyer_id = ? ORDER BY f.created DESC`).all(b.id));
  return { orders, following };
}));

app.get('/api/buyer/shipping', h((req) => {
  const b = buyer(req);
  return db.prepare('SELECT phone, address, pincode FROM buyers WHERE id = ?').get(b.id) ?? {};
}));

/** Buyer tapped "Pay with UPI": they're about to leave for their UPI app, so presence must not cost them the hold. */
app.post('/api/claims/:claimId/paying-app', h((req) => {
  const b = buyer(req);
  const c = q.claim(String(req.params.claimId));
  if (!c || c.buyer_id !== b.id) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  db.prepare('UPDATE claims SET pay_opened = 1 WHERE id = ?').run(c.id);
}));

app.post('/api/claims/:claimId/release', h((req) => {
  const b = buyer(req);
  const c = q.claim(String(req.params.claimId));
  if (!c || c.buyer_id !== b.id) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  release(c.id, 'cancelled');
}));

// ---------- Nexconn webhooks: presence + pre-message moderation ----------
// Console → Chat → Chat settings → Webhooks: URL https://<host>/api/nexconn/webhook,
// events: user:connection_status, open_channel:pre_messaging, direct_channel:pre_messaging.

const seenWebhookTypes = new Set<string>();
const shopKnowsBuyer = (sellerId: string, buyerId: string) => !!db.prepare(`SELECT 1 FROM claims c JOIN drops d ON d.id = c.drop_id
  WHERE d.seller_id = ? AND c.buyer_id = ? UNION SELECT 1 FROM follows WHERE seller_id = ? AND buyer_id = ? LIMIT 1`).get(sellerId, buyerId, sellerId, buyerId);
const MAX_ITEMS_PER_DROP = 90;
const PAY_SCAM = /([\w.\-]{2,}@[a-z][\w-]*(?:\.[\w-]+)*)|((?:paypal\.me|venmo\.com|cash\.app|wa\.me|gcash\.me)\/\S+)|(\$[A-Za-z][\w]{2,})|(\+?\d[\d\s().-]{6,}\d)/gi;
/** Mask payment handles, emails and phone numbers (9+ digits, so sizes, prices and years stay readable). */
const maskPay = (text: string) => text.replace(PAY_SCAM, (m, _e, _l, _t, phone) => (phone && m.replace(/\D/g, '').length < 9 ? m : '•••'));

/** Room chat runs through this before Nexconn delivers it: mask off-platform payment details and stamp the real name. */
export function moderateRoomChat(senderId: string, channelId: string, messageType: string, rawContent: string) {
  const d = db.prepare('SELECT id, seller_id FROM drops WHERE channel_id = ?').get(channelId) as { id: string; seller_id: string } | undefined;
  if (!d) return { pass: 1 };
  if (senderId === sellerUserId(d.seller_id)) return { pass: 1 }; // the shop (and our server, which sends as the shop)
  if (senderId.startsWith('c_')) {
    // A co-host may chat in its own shop's rooms only, and only while it's still on the team and the shop is on Pro.
    const co = activeCohost(senderId);
    if (!co || co.seller_id !== d.seller_id || messageType !== MSG.CHAT) { logEvent(d.id, 'spoof_blocked', senderId); return { pass: 0, extra: 'not_on_team' }; }
    let cc: { text?: string } = {};
    try { cc = JSON.parse(rawContent); } catch { return { pass: 0, extra: 'bad_content' }; }
    return { pass: 1, replaceContent: JSON.stringify({ text: String(cc.text ?? '').slice(0, 200), name: `${co.name} (team)` }) };
  }
  // Buyers may only send room chat. Anything else (fake drop cards, fake "you won / pay here" events, built-in types) is dropped.
  if (messageType !== MSG.CHAT) { logEvent(d.id, 'spoof_blocked', senderId); return { pass: 0, extra: 'only_chat_allowed' }; }
  let c: { text?: string; name?: string } = {};
  try { c = JSON.parse(rawContent); } catch { return { pass: 0, extra: 'bad_content' }; }
  const real = (db.prepare('SELECT name FROM buyers WHERE id = ?').get(senderId) as { name: string } | undefined)?.name ?? 'Buyer';
  // Escalation: after 3 attempts to post payment details, this person is muted for the rest of the drop.
  const strikes = (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE drop_id = ? AND user_id = ? AND kind = 'scam_masked'`).get(d.id, senderId) as { n: number }).n;
  if (strikes >= 3) { logEvent(d.id, 'muted_blocked', senderId); return { pass: 0, extra: 'muted' }; }
  const text = String(c.text ?? '').slice(0, 200);
  const masked = maskPay(text);
  if (masked !== text) logEvent(d.id, 'scam_masked', senderId);
  if (masked === text && c.name === real) return { pass: 1 };
  return { pass: 1, replaceContent: JSON.stringify({ text: masked, name: real, ...(masked !== text ? { masked: true } : {}) }) };
}

app.post('/api/nexconn/webhook', express.json({ limit: '1mb' }), (req, res) => {
  const { appKey, appSecret } = config.nexconn;
  const nonce = req.header('Nonce') || '';
  const ts = req.header('Timestamp') || '';
  const sig = req.header('Signature') || '';
  const expected = crypto.createHash('sha1').update(appSecret + nonce + ts).digest('hex');
  if (!appKey || req.header('AppKey') !== appKey || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).json({ error: 'bad signature' });
  }
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return res.status(401).json({ error: 'stale' }); // replay protection
  const type = String(req.body?.type || '');
  if (!seenWebhookTypes.has(type)) { seenWebhookTypes.add(type); console.log('[webhook] first', type, JSON.stringify(req.body).slice(0, 400)); }
  const data: any[] = Array.isArray(req.body?.data) ? req.body.data : [];
  if (type === 'user:connection_status') {
    for (const e of data) presence.set(String(e.userId), String(e.status) === '0', Number(e.time) || Date.now());
    return res.json({ ok: true });
  }
  if (type === 'open_channel:pre_messaging') {
    const e = data[0] || {};
    return res.json(moderateRoomChat(String(e.userId), String(e.channelId), String(e.messageType), String(e.content ?? '')));
  }
  if (type === 'direct_channel:pre_messaging') {
    // Order cards and status lines (CI:*) may only come from a shop: a buyer can't forge "Payment confirmed".
    const e = data[0] || {};
    const from = String(e.userId ?? e.fromUserId ?? '');
    const to = String(e.toUserId ?? e.targetId ?? e.channelId ?? '');
    // Order cards from anyone but a shop are never delivered. (A shop's server-sent cards may arrive without a recipient
    // field, so those can't be failed closed here without risking every real order card; the relationship check below
    // and the clients' own sender checks cover them.)
    const fake = String(e.messageType ?? '').startsWith('CI:') && !from.startsWith('s_');
    if (!to) logEvent('', 'dm_unchecked', from);
    // Buyer ids are visible in the public queue, so buyers may only DM shops: no "pay me instead" DMs to people in line.
    const buyerToBuyer = !!to && !from.startsWith('s_') && !to.startsWith('s_');
    // Anyone can open a shop, so a shop may only message buyers it has a real relationship with (they claimed in one of
    // its drops, or follow it). A rogue "shop" can't send fake order cards to ids it scraped from someone else's queue.
    const strangerShop = from.startsWith('s_') && from !== SYSTEM_USER && !!to && !to.startsWith('s_') && !shopKnowsBuyer(from.slice(2), to);
    if (fake || buyerToBuyer || strangerShop) { logEvent('', fake ? 'spoof_blocked' : 'dm_blocked', from); return res.json({ pass: 0 }); }
    return res.json({ pass: 1 });
  }
  if (type.endsWith(':pre_messaging')) return res.json({ pass: 1 });
  res.json({ ok: true });
});

// ---------- admin: traction numbers for the submission (set ADMIN_KEY in .env) ----------

app.get('/api/admin/stats', h((req) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.header('x-admin-key') !== key) throw new AppError(404, 'NOT_FOUND', 'Not found');
  const one = (sql: string, ...args: unknown[]) => Number(Object.values(db.prepare(sql).get(...(args as any[])) as object)[0] ?? 0);
  // Real activity only: practice drops and the always-on demo (bots) are excluded everywhere.
  const REAL = `drop_id IN (SELECT id FROM drops WHERE practice = 0 AND id != 'demo')`;
  const day = 86_400_000;
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const end = now() - i * day; const start = end - day;
    daily.push({
      day: new Date(end).toISOString().slice(0, 10),
      activeBuyers: one(`SELECT COUNT(DISTINCT user_id) FROM events WHERE kind IN ('join','claim_attempt') AND ${REAL} AND at BETWEEN ? AND ?`, start, end),
      claims: one(`SELECT COUNT(*) FROM events WHERE kind = 'claim_attempt' AND ${REAL} AND at BETWEEN ? AND ?`, start, end),
    });
  }
  return {
    sellers: one(`SELECT COUNT(*) FROM sellers WHERE id != 'demoshop'`),
    drops: one(`SELECT COUNT(*) FROM drops WHERE practice = 0 AND id != 'demo'`),
    itemsDropped: one(`SELECT COUNT(*) FROM items WHERE status != 'draft' AND ${REAL}`),
    buyers: one(`SELECT COUNT(*) FROM buyers WHERE id NOT LIKE 'bot\\_%' ESCAPE '\\'`),
    buyersWhoJoinedADrop: one(`SELECT COUNT(DISTINCT user_id) FROM events WHERE kind = 'join' AND ${REAL}`),
    claimTaps: one(`SELECT COUNT(*) FROM events WHERE kind = 'claim_attempt' AND ${REAL}`),
    ordersPaid: one(`SELECT COUNT(*) FROM claims c WHERE c.status = 'paid' AND c.${REAL}`),
    salesByCurrency: db.prepare(`SELECT s.currency, COALESCE(SUM(i.price),0) AS total FROM claims c JOIN items i ON i.id = c.item_id JOIN drops d ON d.id = c.drop_id
      JOIN sellers s ON s.id = d.seller_id WHERE c.status = 'paid' AND d.practice = 0 AND d.id != 'demo' GROUP BY s.currency`).all(),
    joinsViaShares: one(`SELECT COUNT(*) FROM events WHERE kind = 'join' AND ref IS NOT NULL AND ${REAL}`),
    scamMessagesMasked: one(`SELECT COUNT(*) FROM events WHERE kind = 'scam_masked' AND ${REAL}`),
    demoVisitors: one(`SELECT COUNT(DISTINCT user_id) FROM events WHERE kind = 'join' AND drop_id = 'demo'`),
    spoofsBlocked: one(`SELECT COUNT(*) FROM events WHERE kind = 'spoof_blocked'`),
    follows: one('SELECT COUNT(*) FROM follows'),
    proWaitlist: one('SELECT COUNT(*) FROM pro_waitlist'),
    feedback: db.prepare('SELECT role, rating, text, quote_ok AS quoteOk, created FROM feedback ORDER BY created DESC LIMIT 50').all(),
    last7Days: daily,
  };
}));

// ---------- mock transport (only when no Nexconn keys are set) ----------

if (config.mode === 'mock') {
  const mockUser = (req: Request) => {
    const token = String(req.query.token || req.header('x-mock-token') || '');
    if (!token.startsWith('mock:')) throw new AppError(401, 'NO_AUTH', 'Bad mock token');
    return token.slice(5);
  };
  app.get('/api/mock/stream', (req, res) => {
    try { mockbus.attach(mockUser(req), res); } catch { res.status(401).end(); }
  });
  app.post('/api/mock/enter', h((req) => mockbus.enter(str(req.body.channelId, 64, 'channelId'), mockUser(req))));
  app.post('/api/mock/exit', h((req) => mockbus.exit(str(req.body.channelId, 64, 'channelId'), mockUser(req))));
  app.post('/api/mock/send-open', h((req) => {
    // Same moderation path as Nexconn's pre-message webhook.
    const channelId = str(req.body.channelId, 64, 'channelId');
    const type = str(req.body.type, 32, 'type');
    const verdict = moderateRoomChat(mockUser(req), channelId, type, JSON.stringify(req.body.content ?? {})) as { pass: number; replaceContent?: string };
    if (!verdict.pass) return { blocked: true };
    const content = verdict.replaceContent ? JSON.parse(verdict.replaceContent) : req.body.content;
    return { messageId: mockbus.sendOpen(channelId, mockUser(req), type, content) };
  }));
  app.post('/api/mock/send-direct', h((req) => ({
    messageId: mockbus.sendDirect(mockUser(req), str(req.body.to, 64, 'to'), str(req.body.type, 32, 'type'), req.body.content),
  })));
  app.get('/api/mock/history', h((req) => mockbus.history(mockUser(req), String(req.query.peer || ''))));
  app.get('/api/mock/peers', h((req) => mockbus.peers(mockUser(req))));
  app.get('/api/mock/metadata', h((req) => mockbus.getMetadata(String(req.query.channelId || ''))));
}

// ---------- static web app ----------

const webDist = path.resolve('dist/web');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  const indexHtml = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  // Rich link previews when a drop link is pasted into WhatsApp / Instagram / Telegram.
  app.get('/d/:dropId', (req, res) => {
    const d = q.drop(String(req.params.dropId));
    if (!d) return res.type('html').send(indexHtml);
    const s = q.seller(d.seller_id)!;
    const img = db.prepare(`SELECT image_id FROM items WHERE drop_id = ? AND image_id IS NOT NULL ORDER BY (status = 'draft'), idx DESC LIMIT 1`).get(d.id) as { image_id: string } | undefined;
    const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    const title = d.status === 'live' ? `🔴 ${s.shop} is dropping LIVE — first tap wins` : `${s.shop} on ClaimIt`;
    const desc = `${d.title}. Tap to join the drop: first tap wins, everyone sees the queue, pay the seller directly.`;
    const tags = [
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="ClaimIt" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(desc)}" />`,
      `<meta property="og:url" content="${esc(`${base}/d/${d.id}`)}" />`,
      `<meta property="og:image" content="${esc(img ? `${base}/img/${img.image_id}` : `${base}/og.png`)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    ].join('\n    ');
    res.type('html').send(indexHtml.replace('<title>ClaimIt — fair live drops</title>', `<title>${esc(title)}</title>\n    ${tags}`));
  });
  app.get(/^\/(?!api\/|img\/).*/, (req, res) => {
    const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    const tags = [
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="ClaimIt" />`,
      `<meta property="og:title" content="ClaimIt — fair live drops for social sellers" />`,
      `<meta property="og:description" content="Turn 'comment MINE to buy' into a fair claim queue everyone can see. First tap wins, pay the seller directly." />`,
      `<meta property="og:image" content="${base}/og.png" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    ].join('\n    ');
    res.type('html').send(indexHtml.replace('</title>', `</title>\n    ${tags}`));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message });
  console.error(err);
  res.status(500).json({ error: 'SERVER', message: 'Something went wrong. Please try again.' });
});

startExpiryLoop();
setTimeout(() => console.log(`[boot] republished ${republishLive()} live drop(s)`), 1500);
import('./demo.ts').then((m) => m.startDemo()).catch((e) => console.error('[demo] failed to start', e));
app.listen(config.port, () => {
  console.log(`ClaimIt server on http://localhost:${config.port} (mode: ${config.mode}${config.mode === 'nexconn' ? `, area ${config.nexconn.area}` : ''})`);
});

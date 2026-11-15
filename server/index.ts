import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import { db, now, rid } from './db.ts';
import { nexconn } from './nexconn.ts';
import { mockbus } from './mockbus.ts';
import {
  AppError, buyerMarkPaid, claim, closeItem, dropItem, endDrop, logEvent, myClaims, publicDrop,
  q, release, sellerConfirm, sellerUserId, startExpiryLoop, toItem,
} from './engine.ts';
import type { AppConfig } from '../shared/types.ts';

const app = express();
app.use(express.json({ limit: '3mb' }));

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

function seller(req: Request) {
  const id = req.header('x-seller-id') || '';
  const key = req.header('x-seller-key') || '';
  const row = db.prepare('SELECT * FROM sellers WHERE id = ? AND key = ?').get(id, key) as
    { id: string; name: string; shop: string; upi: string } | undefined;
  if (!row) throw new AppError(401, 'NO_AUTH', 'Seller session not found');
  return row;
}

function buyer(req: Request) {
  const id = req.header('x-buyer-id') || '';
  const key = req.header('x-buyer-key') || '';
  const row = db.prepare('SELECT id, name FROM buyers WHERE id = ? AND key = ?').get(id, key) as { id: string; name: string } | undefined;
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

app.post('/api/sellers', h(async (req) => {
  const name = str(req.body.name, 60, 'Your name');
  const shop = str(req.body.shop, 60, 'Shop name');
  const upi = str(req.body.upi, 80, 'UPI ID');
  if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) throw new AppError(400, 'BAD_UPI', 'That UPI ID looks off (e.g. yourname@okicici)');
  const id = rid(10);
  const key = rid(24);
  db.prepare('INSERT INTO sellers (id, name, shop, upi, key, created) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, shop, upi, key, now());
  const userId = sellerUserId(id);
  const token = await nexconn.token(userId, shop);
  return { id, key, name, shop, upi, userId, token };
}));

app.post('/api/seller/session', h(async (req) => {
  const s = seller(req);
  const userId = sellerUserId(s.id);
  return { ...s, userId, token: await nexconn.token(userId, s.shop) };
}));

/** Names for Nexconn Chat UI (its reqUserProfiles hook): buyers who ordered from this seller, plus the seller. */
app.get('/api/seller/profiles', h((req) => {
  const s = seller(req);
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 100);
  return ids.map((userId) => {
    if (userId === sellerUserId(s.id)) return { userId, name: s.shop };
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

app.post('/api/seller/drops', h(async (req) => {
  const s = seller(req);
  const title = str(req.body.title, 80, 'Drop title');
  const liveUrl = str(req.body.liveUrl, 300, 'Live link', false) || null;
  const id = rid(8);
  const channelId = `drop_${id}`;
  await nexconn.createOpenChannel(channelId);
  db.prepare('INSERT INTO drops (id, seller_id, title, channel_id, status, live_url, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, s.id, title, channelId, 'live', liveUrl, now());
  return { id };
}));

app.get('/api/seller/drops/:dropId', h(async (req) => {
  const { d } = ownDrop(req);
  const inRoom = await nexconn.participantCount(d.channel_id);
  const items = q.items(d.id).map(toItem);
  const claims = db.prepare(`SELECT c.id, c.item_id AS itemId, c.buyer_id AS buyerId, c.buyer_name AS buyerName, c.status, c.seq,
      c.created, c.hold_until AS holdUntil, c.utr, c.paid_at AS paidAt
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
    },
  };
}));

app.patch('/api/seller/drops/:dropId', h((req) => {
  const { d } = ownDrop(req);
  const liveUrl = str(req.body.liveUrl, 300, 'Live link', false) || null;
  db.prepare('UPDATE drops SET live_url = ? WHERE id = ?').run(liveUrl, d.id);
}));

app.post('/api/seller/drops/:dropId/items', h((req) => {
  const { d } = ownDrop(req);
  const name = str(req.body.name, 80, 'Item name');
  const price = Math.round(Number(req.body.price));
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) throw new AppError(400, 'BAD_PRICE', 'Enter a price in ₹');
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
app.post('/api/seller/drops/:dropId/end', h((req) => endDrop(ownDrop(req).d.id)));

app.post('/api/seller/claims/:claimId/confirm', h((req) => sellerConfirm(String(req.params.claimId), seller(req).id)));
app.post('/api/seller/claims/:claimId/reject', h((req) => {
  const s = seller(req);
  const c = q.claim(String(req.params.claimId));
  if (!c || q.drop(c.drop_id)?.seller_id !== s.id) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  release(c.id, 'rejected');
}));

// ---------- buyer ----------

app.post('/api/buyers', h(async (req) => {
  const name = str(req.body.name, 30, 'Your name');
  const id = `b_${rid(10)}`;
  const key = rid(24);
  db.prepare('INSERT INTO buyers (id, name, key, created) VALUES (?, ?, ?, ?)').run(id, name, key, now());
  return { id, key, name, token: await nexconn.token(id, name) };
}));

app.post('/api/buyer/session', h(async (req) => {
  const b = buyer(req);
  return { ...b, token: await nexconn.token(b.id, b.name) };
}));

app.get('/api/drops/:dropId', h(async (req) => {
  const d = publicDrop(String(req.params.dropId));
  return { ...d, inRoom: await nexconn.participantCount(d.channelId) };
}));

app.post('/api/drops/:dropId/join', h((req) => {
  const b = buyer(req);
  const d = q.drop(String(req.params.dropId));
  if (!d) throw new AppError(404, 'NO_DROP', 'Drop not found');
  const seen = db.prepare(`SELECT 1 FROM events WHERE drop_id = ? AND kind = 'join' AND user_id = ? AND at > ?`).get(d.id, b.id, now() - 30 * 60_000);
  if (!seen) logEvent(d.id, 'join', b.id);
}));

app.get('/api/drops/:dropId/me', h((req) => myClaims(String(req.params.dropId), buyer(req).id)));

app.post('/api/drops/:dropId/items/:itemId/claim', h((req) => claim(String(req.params.dropId), String(req.params.itemId), buyer(req))));

app.post('/api/claims/:claimId/paid', h((req) => buyerMarkPaid(String(req.params.claimId), buyer(req).id, str(req.body.utr, 40, 'UTR', false))));

app.post('/api/claims/:claimId/release', h((req) => {
  const b = buyer(req);
  const c = q.claim(String(req.params.claimId));
  if (!c || c.buyer_id !== b.id) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  release(c.id, 'cancelled');
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
  app.post('/api/mock/send-open', h((req) => ({
    messageId: mockbus.sendOpen(str(req.body.channelId, 64, 'channelId'), mockUser(req), str(req.body.type, 32, 'type'), req.body.content),
  })));
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
  app.get(/^\/(?!api\/|img\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message });
  console.error(err);
  res.status(500).json({ error: 'SERVER', message: 'Something went wrong. Please try again.' });
});

startExpiryLoop();
app.listen(config.port, () => {
  console.log(`ClaimIt server on http://localhost:${config.port} (mode: ${config.mode}${config.mode === 'nexconn' ? `, area ${config.nexconn.area}` : ''})`);
});

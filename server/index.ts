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
  const hold = holdMinutes(req.body.holdMinutes) ?? Math.round(config.holdSeconds / 60);
  const id = rid(8);
  const channelId = `drop_${id}`;
  await nexconn.createOpenChannel(channelId);
  db.prepare('INSERT INTO drops (id, seller_id, title, channel_id, status, live_url, created, hold_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, s.id, title, channelId, 'live', liveUrl, now(), hold * 60);
  return { id };
}));

app.get('/api/seller/drops/:dropId', h(async (req) => {
  const { d } = ownDrop(req);
  const inRoom = await nexconn.participantCount(d.channel_id);
  const items = q.items(d.id).map(toItem);
  const claims = db.prepare(`SELECT c.id, c.item_id AS itemId, c.buyer_id AS buyerId, c.buyer_name AS buyerName, c.status, c.seq,
      c.created, c.hold_until AS holdUntil, c.utr, c.paid_at AS paidAt,
      c.ship_phone AS shipPhone, c.ship_address AS shipAddress, c.ship_pincode AS shipPincode
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
      const t = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const fmt = (ms: unknown) => (ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16) : '');
    const lines = [['Order ID', 'Item #', 'Item', 'Price (INR)', 'Buyer', 'Phone', 'Address', 'PIN', 'UTR', 'Status', 'Paid at (UTC)'].join(',')];
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

/** Display names for room senders, resolved server-side so nobody can chat as the seller by faking a name. */
app.get('/api/drops/:dropId/people', h((req) => {
  const d = q.drop(String(req.params.dropId));
  if (!d) throw new AppError(404, 'NO_DROP', 'Drop not found');
  const s = q.seller(d.seller_id)!;
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 100);
  const out: Record<string, { name: string; seller?: boolean }> = {};
  for (const id of ids) {
    if (id === sellerUserId(s.id)) out[id] = { name: s.shop, seller: true };
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
  if (b.isGuest) throw new AppError(409, 'NEED_NAME', 'Tell the seller your name to claim');
  return claim(String(req.params.dropId), String(req.params.itemId), { id: b.id, name: b.name });
}));

app.post('/api/claims/:claimId/paid', h((req) => {
  const phone = str(req.body.phone, 20, 'Phone number').replace(/[\s-]/g, '').replace(/^\+?91/, '');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new AppError(400, 'BAD_PHONE', 'Enter a 10-digit mobile number');
  const address = str(req.body.address, 300, 'Delivery address');
  if (address.length < 10) throw new AppError(400, 'BAD_ADDRESS', 'Please enter your full delivery address');
  const pincode = str(req.body.pincode, 6, 'PIN code');
  if (!/^[1-9]\d{5}$/.test(pincode)) throw new AppError(400, 'BAD_PIN', 'Enter a 6-digit PIN code');
  return buyerMarkPaid(String(req.params.claimId), buyer(req).id, str(req.body.utr, 40, 'UTR', false), { phone, address, pincode });
}));

app.get('/api/buyer/shipping', h((req) => {
  const b = buyer(req);
  return db.prepare('SELECT phone, address, pincode FROM buyers WHERE id = ?').get(b.id) ?? {};
}));

app.post('/api/claims/:claimId/release', h((req) => {
  const b = buyer(req);
  const c = q.claim(String(req.params.claimId));
  if (!c || c.buyer_id !== b.id) throw new AppError(404, 'NO_CLAIM', 'Claim not found');
  release(c.id, 'cancelled');
}));

// ---------- admin: traction numbers for the submission (set ADMIN_KEY in .env) ----------

app.get('/api/admin/stats', h((req) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.header('x-admin-key') !== key) throw new AppError(404, 'NOT_FOUND', 'Not found');
  const one = (sql: string, ...args: unknown[]) => Number(Object.values(db.prepare(sql).get(...(args as any[])) as object)[0] ?? 0);
  const day = 86_400_000;
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const end = now() - i * day; const start = end - day;
    daily.push({
      day: new Date(end).toISOString().slice(0, 10),
      activeBuyers: one(`SELECT COUNT(DISTINCT user_id) FROM events WHERE kind IN ('join','claim_attempt') AND at BETWEEN ? AND ?`, start, end),
      claims: one(`SELECT COUNT(*) FROM events WHERE kind = 'claim_attempt' AND at BETWEEN ? AND ?`, start, end),
    });
  }
  return {
    sellers: one('SELECT COUNT(*) FROM sellers'),
    drops: one('SELECT COUNT(*) FROM drops'),
    itemsDropped: one(`SELECT COUNT(*) FROM items WHERE status != 'draft'`),
    buyers: one('SELECT COUNT(*) FROM buyers'),
    buyersWhoJoinedADrop: one(`SELECT COUNT(DISTINCT user_id) FROM events WHERE kind = 'join'`),
    claimTaps: one(`SELECT COUNT(*) FROM events WHERE kind = 'claim_attempt'`),
    ordersPaid: one(`SELECT COUNT(*) FROM claims WHERE status = 'paid'`),
    gmvInr: one(`SELECT COALESCE(SUM(i.price),0) FROM claims c JOIN items i ON i.id = c.item_id WHERE c.status = 'paid'`),
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
    const desc = `${d.title}. Tap to join the drop: claim items fairly, pay by UPI.`;
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
      `<meta property="og:description" content="Turn 'comment MINE to buy' into a fair claim queue everyone can see. First tap wins, pay by UPI." />`,
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
app.listen(config.port, () => {
  console.log(`ClaimIt server on http://localhost:${config.port} (mode: ${config.mode}${config.mode === 'nexconn' ? `, area ${config.nexconn.area}` : ''})`);
});

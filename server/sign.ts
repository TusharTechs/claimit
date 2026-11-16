// Server signatures for state that travels through client-writable Nexconn surfaces.
//
// Open-channel metadata and message metadata can also be written by clients through the SDK, so the browser can't
// trust a value just because it arrived. Every queue value and every order-card status the server writes is signed
// (ECDSA P-256, raw r||s, verifiable with WebCrypto in any browser); clients drop anything that doesn't verify.
import crypto from 'node:crypto';
import { db } from './db.ts';

db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');

function loadKeys() {
  const row = db.prepare(`SELECT v FROM kv WHERE k = 'meta_signing_key'`).get() as { v: string } | undefined;
  if (row) return crypto.createPrivateKey(row.v);
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  db.prepare(`INSERT INTO kv (k, v) VALUES ('meta_signing_key', ?)`).run(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
  return privateKey;
}

const privateKey = loadKeys();
/** Public key (SPKI, base64) that clients import to verify. Safe to publish. */
export const metaPublicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');

const sign = (data: string) => crypto.sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');

/** A metadata value bound to its channel and key, so a signed value can't be replayed into another item or room. */
export const seal = (channelId: string, key: string, json: string) => JSON.stringify({ d: json, g: sign(`${channelId}|${key}|${json}`) });

/** Signature for an order card's live status, bound to the claim. */
export const signStatus = (claimId: string, status: string) => sign(`order|${claimId}|${status}`);

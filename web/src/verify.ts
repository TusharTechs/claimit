// Verifies state the server signed (see server/sign.ts). Open-channel metadata and message metadata can also be written
// by other clients through the SDK, so the room only trusts values carrying a valid server signature.
import { rt } from './rt';

let keyPromise: Promise<CryptoKey | null> | null = null;
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function key() {
  keyPromise ??= rt.config().then((cfg) => cfg.metaKey
    ? crypto.subtle.importKey('spki', b64(cfg.metaKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    : null).catch(() => null);
  // A failed fetch/import must not disable live updates for the rest of the session: try again next time.
  keyPromise.then((k) => { if (!k) keyPromise = null; });
  return keyPromise;
}

async function verify(data: string, sigB64: string) {
  const k = await key();
  if (!k || !sigB64) return false;
  try { return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, b64(sigB64), new TextEncoder().encode(data)); }
  catch { return false; }
}

/** Opens a sealed metadata value: returns the inner JSON only if the server signed it for this channel and key. */
export async function openSealed(channelId: string, k: string, value: string | null): Promise<string | null> {
  if (!value) return null;
  try {
    const { d, g } = JSON.parse(value) as { d?: string; g?: string };
    if (typeof d !== 'string' || typeof g !== 'string') return null;
    return (await verify(`${channelId}|${k}|${d}`, g)) ? d : null;
  } catch { return null; }
}

const statusCache = new Map<string, Promise<boolean>>();
const newest = new Map<string, number>(); // claimId -> time of the newest verified status seen
/**
 * True if this order-card status was set by the server (not by a client editing its own message's metadata) AND is not
 * older than a status already seen for this claim — so a buyer can't roll "shipped" back to an earlier, also-signed state.
 */
export async function verifyOrderStatus(claimId: string, status: string | undefined, t: string | undefined, sig: string | undefined): Promise<boolean> {
  if (!claimId || !status || !sig || !t) return false;
  const ck = `${claimId}|${status}|${t}|${sig}`;
  if (!statusCache.has(ck)) statusCache.set(ck, verify(`order|${claimId}|${status}|${t}`, sig));
  if (!(await statusCache.get(ck))) { statusCache.delete(ck); return false; } // don't pin a failure (e.g. key not loaded yet)
  const time = Number(t);
  if (time < (newest.get(claimId) ?? 0)) return false;
  newest.set(claimId, time);
  return true;
}

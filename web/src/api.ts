import type { AppConfig, Item, MyClaim, PublicDrop } from '../../shared/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// ---------- local sessions ----------

export interface SellerSession { id: string; key: string; name: string; shop: string; upi: string }
export interface BuyerSession { id: string; key: string; name: string; isGuest?: boolean }

const read = <T,>(k: string): T | null => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
};
const write = (k: string, v: unknown) => {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
};

// sessionStorage override lets one browser act as several buyers for testing: open the room with ?as=<anything>
const buyerSlot = () => {
  // ?as=<slot> lets one browser act as several buyers — local development only, never in production
  // (it would let one person mint many Nexconn users).
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const as = local ? new URLSearchParams(location.search).get('as') : null;
  return as ? `claimit.buyer.${as}` : 'claimit.buyer';
};

export const sessions = {
  seller: () => read<SellerSession>('claimit.seller'),
  setSeller: (s: SellerSession | null) => write('claimit.seller', s),
  buyer: () => read<BuyerSession>(buyerSlot()),
  setBuyer: (b: BuyerSession | null) => write(buyerSlot(), b),
};

// ---------- fetch ----------

async function req<T>(method: string, path: string, body?: unknown, auth?: 'seller' | 'buyer'): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth === 'seller') {
    const s = sessions.seller();
    if (s) { headers['x-seller-id'] = s.id; headers['x-seller-key'] = s.key; }
  } else if (auth === 'buyer') {
    const b = sessions.buyer();
    if (b) { headers['x-buyer-id'] = b.id; headers['x-buyer-key'] = b.key; }
  }
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error || 'ERROR', json.message || 'Request failed');
  return json as T;
}

export interface SellerDropSummary { id: string; title: string; status: string; created: number; items: number; sold: number }
export interface SellerClaim {
  id: string; itemId: string; buyerId: string; buyerName: string; status: MyClaim['status'];
  seq: number; created: number; holdUntil: number | null; utr: string | null; paidAt: number | null;
  shipPhone: string | null; shipAddress: string | null; shipPincode: string | null;
}
export interface Shipping { phone: string; address: string; pincode: string }
export interface SellerDrop {
  drop: PublicDrop;
  items: Item[];
  claims: SellerClaim[];
  stats: { viewers: number; claimAttempts: number; claimers: number; sold: number; revenue: number; viaShares: number; followers: number };
}

export interface ShopDrop { id: string; title: string; status: 'live' | 'ended'; created: number; items: number; sold: number; cover: string | null }
export interface Shop { id: string; shop: string; name: string; followers: number; orders: number; since: number; following: boolean; drops: ShopDrop[] }
export interface Impact {
  sellers: number; drops: number; buyers: number; claimsSettled: number; contestedItems: number; itemsSold: number; gmvInr: number;
  liveNow: { id: string; title: string; shop: string }[];
}

export const api = {
  config: () => req<AppConfig>('GET', '/api/config'),

  createSeller: (b: { name: string; shop: string; upi: string }) =>
    req<SellerSession & { userId: string; token: string }>('POST', '/api/sellers', b),
  sellerSession: () => req<SellerSession & { userId: string; token: string }>('POST', '/api/seller/session', {}, 'seller'),
  sellerDrops: () => req<SellerDropSummary[]>('GET', '/api/seller/drops', undefined, 'seller'),
  sellerProfiles: (ids: string[]) =>
    req<{ userId: string; name: string }[]>('GET', `/api/seller/profiles?ids=${encodeURIComponent(ids.join(','))}`, undefined, 'seller'),
  createDrop: (b: { title: string; liveUrl?: string; holdMinutes?: number }) => req<{ id: string; notified: number }>('POST', '/api/seller/drops', b, 'seller'),
  /** Validate a seller id/key pair (used by the "open on another device" link) without storing it first. */
  sellerLogin: async (id: string, key: string) => {
    const res = await fetch('/api/seller/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-seller-id': id, 'x-seller-key': key }, body: '{}' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json.error || 'ERROR', json.message || 'That login link is not valid');
    return json as SellerSession;
  },
  downloadOrders: async (dropId: string) => {
    const s = sessions.seller();
    const res = await fetch(`/api/seller/drops/${dropId}/orders.csv`, { headers: s ? { 'x-seller-id': s.id, 'x-seller-key': s.key } : {} });
    if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Could not download orders');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `claimit-orders-${dropId}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
  sellerDrop: (id: string) => req<SellerDrop>('GET', `/api/seller/drops/${id}`, undefined, 'seller'),
  updateDrop: (id: string, b: { liveUrl?: string; holdMinutes?: number }) => req('PATCH', `/api/seller/drops/${id}`, b, 'seller'),
  addItem: (dropId: string, b: { name: string; price: number; image: string | null }) =>
    req<Item>('POST', `/api/seller/drops/${dropId}/items`, b, 'seller'),
  deleteItem: (dropId: string, itemId: string) => req('DELETE', `/api/seller/drops/${dropId}/items/${itemId}`, undefined, 'seller'),
  dropItem: (dropId: string, itemId: string) => req<Item>('POST', `/api/seller/drops/${dropId}/items/${itemId}/drop`, {}, 'seller'),
  closeItem: (dropId: string, itemId: string) => req('POST', `/api/seller/drops/${dropId}/items/${itemId}/close`, {}, 'seller'),
  endDrop: (dropId: string) => req('POST', `/api/seller/drops/${dropId}/end`, {}, 'seller'),
  confirm: (claimId: string) => req('POST', `/api/seller/claims/${claimId}/confirm`, {}, 'seller'),
  reject: (claimId: string) => req('POST', `/api/seller/claims/${claimId}/reject`, {}, 'seller'),

  createBuyer: (name?: string) => req<BuyerSession & { token: string }>('POST', '/api/buyers', { name: name ?? '' }),
  buyerSession: () => req<BuyerSession & { token: string }>('POST', '/api/buyer/session', {}, 'buyer'),
  renameBuyer: (name: string) => req<{ id: string; name: string; isGuest: boolean }>('PATCH', '/api/buyer', { name }, 'buyer'),
  people: (dropId: string, ids: string[]) =>
    req<Record<string, { name: string; seller?: boolean }>>('GET', `/api/drops/${dropId}/people?ids=${encodeURIComponent(ids.join(','))}`),
  drop: (id: string) => req<PublicDrop>('GET', `/api/drops/${id}`),
  join: (id: string, ref?: string | null) => req('POST', `/api/drops/${id}/join`, { ref: ref ?? null }, 'buyer'),
  shop: (sellerId: string) => req<Shop>('GET', `/api/shops/${sellerId}`, undefined, 'buyer'),
  follow: (sellerId: string, follow: boolean) => req<{ following: boolean; followers: number }>('POST', `/api/shops/${sellerId}/follow`, { follow }, 'buyer'),
  impact: () => req<Impact>('GET', '/api/impact'),
  proWaitlist: (contact: string) => req('POST', '/api/pro-waitlist', { contact }, 'seller'),
  feedback: (b: { role: 'buyer' | 'seller'; dropId?: string; rating?: number; text?: string; quoteOk?: boolean }) =>
    req('POST', '/api/feedback', b, b.role === 'seller' ? 'seller' : 'buyer'),
  myClaims: (id: string) => req<MyClaim[]>('GET', `/api/drops/${id}/me`, undefined, 'buyer'),
  claim: (dropId: string, itemId: string) => req<MyClaim>('POST', `/api/drops/${dropId}/items/${itemId}/claim`, {}, 'buyer'),
  markPaid: (claimId: string, b: Shipping & { utr: string }) => req('POST', `/api/claims/${claimId}/paid`, b, 'buyer'),
  shipping: () => req<Partial<Shipping>>('GET', '/api/buyer/shipping', undefined, 'buyer'),
  release: (claimId: string) => req('POST', `/api/claims/${claimId}/release`, {}, 'buyer'),
};

import type { AppConfig, Item, MyClaim, PublicDrop } from '../../shared/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// ---------- local sessions ----------

export interface SellerSession { id: string; key: string; name: string; shop: string; upi: string }
export interface BuyerSession { id: string; key: string; name: string }

const read = <T,>(k: string): T | null => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
};
const write = (k: string, v: unknown) => {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
};

// sessionStorage override lets one browser act as several buyers for testing: open the room with ?as=<anything>
const buyerSlot = () => {
  const as = new URLSearchParams(location.search).get('as');
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
}
export interface SellerDrop {
  drop: PublicDrop;
  items: Item[];
  claims: SellerClaim[];
  stats: { viewers: number; claimAttempts: number; claimers: number; sold: number; revenue: number };
}

export const api = {
  config: () => req<AppConfig>('GET', '/api/config'),

  createSeller: (b: { name: string; shop: string; upi: string }) =>
    req<SellerSession & { userId: string; token: string }>('POST', '/api/sellers', b),
  sellerSession: () => req<SellerSession & { userId: string; token: string }>('POST', '/api/seller/session', {}, 'seller'),
  sellerDrops: () => req<SellerDropSummary[]>('GET', '/api/seller/drops', undefined, 'seller'),
  createDrop: (b: { title: string; liveUrl?: string }) => req<{ id: string }>('POST', '/api/seller/drops', b, 'seller'),
  sellerDrop: (id: string) => req<SellerDrop>('GET', `/api/seller/drops/${id}`, undefined, 'seller'),
  updateDrop: (id: string, b: { liveUrl: string }) => req('PATCH', `/api/seller/drops/${id}`, b, 'seller'),
  addItem: (dropId: string, b: { name: string; price: number; image: string | null }) =>
    req<Item>('POST', `/api/seller/drops/${dropId}/items`, b, 'seller'),
  deleteItem: (dropId: string, itemId: string) => req('DELETE', `/api/seller/drops/${dropId}/items/${itemId}`, undefined, 'seller'),
  dropItem: (dropId: string, itemId: string) => req<Item>('POST', `/api/seller/drops/${dropId}/items/${itemId}/drop`, {}, 'seller'),
  closeItem: (dropId: string, itemId: string) => req('POST', `/api/seller/drops/${dropId}/items/${itemId}/close`, {}, 'seller'),
  endDrop: (dropId: string) => req('POST', `/api/seller/drops/${dropId}/end`, {}, 'seller'),
  confirm: (claimId: string) => req('POST', `/api/seller/claims/${claimId}/confirm`, {}, 'seller'),
  reject: (claimId: string) => req('POST', `/api/seller/claims/${claimId}/reject`, {}, 'seller'),

  createBuyer: (name: string) => req<BuyerSession & { token: string }>('POST', '/api/buyers', { name }),
  buyerSession: () => req<BuyerSession & { token: string }>('POST', '/api/buyer/session', {}, 'buyer'),
  drop: (id: string) => req<PublicDrop>('GET', `/api/drops/${id}`),
  join: (id: string) => req('POST', `/api/drops/${id}/join`, {}, 'buyer'),
  myClaims: (id: string) => req<MyClaim[]>('GET', `/api/drops/${id}/me`, undefined, 'buyer'),
  claim: (dropId: string, itemId: string) => req<MyClaim>('POST', `/api/drops/${dropId}/items/${itemId}/claim`, {}, 'buyer'),
  markPaid: (claimId: string, utr: string) => req('POST', `/api/claims/${claimId}/paid`, { utr }, 'buyer'),
  release: (claimId: string) => req('POST', `/api/claims/${claimId}/release`, {}, 'buyer'),
};

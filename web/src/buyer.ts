import { api, sessions, type BuyerSession } from './api';

// One guest identity per page load, even if React effects run twice — each guest becomes a real Nexconn user,
// so we never mint extras. A real name is only asked when the buyer claims something.
let guestPromise: Promise<BuyerSession> | null = null;

export function ensureBuyer(): Promise<BuyerSession> {
  const existing = sessions.buyer();
  if (existing) return Promise.resolve(existing);
  guestPromise ??= api.createBuyer().then((b) => {
    const s = { id: b.id, key: b.key, name: b.name, isGuest: b.isGuest };
    sessions.setBuyer(s);
    return s;
  }).catch((e) => { guestPromise = null; throw e; });
  return guestPromise;
}

/** Shop id from a Nexconn seller user id (`s_<id>`). */
export const shopIdOf = (sellerUserId: string) => sellerUserId.replace(/^s_/, '');

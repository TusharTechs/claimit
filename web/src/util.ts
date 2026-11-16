import { useEffect, useState } from 'react';

// Prices are shown in the shop's currency. Pages set it once when the drop/shop loads.
let currentCurrency = 'USD';
export const setCurrency = (c?: string | null) => { if (c) currentCurrency = c; };
export const getCurrency = () => currentCurrency;
/** "~2 min" / "~40 s" for a duration in seconds. */
export const approx = (sec: number) => (sec < 90 ? `~${Math.max(5, Math.round(sec / 5) * 5)} s` : `~${Math.round(sec / 60)} min`);
/** tel: link for a buyer's phone: Indian 10-digit numbers get +91, others are stored with their country code. */
export const telHref = (phone: string): string | undefined => phone.startsWith('+') ? `tel:${phone}` : currentCurrency === 'INR' && /^[6-9]\d{9}$/.test(phone) ? `tel:+91${phone}` : undefined; // unknown country code: no link
export const money = (n: number, currency = currentCurrency) => {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  } catch { return `${currency} ${n}`; }
};
export const currencySymbol = (currency = currentCurrency) =>
  (new Intl.NumberFormat('en', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value) ?? currency;

export function upiLink(upi: string, shop: string, amount: number, note: string) {
  const p = new URLSearchParams({ pa: upi, pn: shop, am: String(amount), cu: 'INR', tn: note.slice(0, 50) });
  return `upi://pay?${p.toString()}`;
}

/** Pre-fill the amount on links that support it (PayPal.me, Venmo, Cash App); other links are returned unchanged. */
export function payLinkFor(link: string, amount: number, currency = 'USD', note = '') {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (host === 'paypal.me' && parts.length === 1) return `https://paypal.me/${parts[0]}/${amount}${currency}`;
    if (host === 'venmo.com' && currency === 'USD' && parts.length >= 1) {
      const user = parts[0] === 'u' ? parts[1] : parts[0];
      if (user) return `https://venmo.com/${user}?txn=pay&amount=${amount}&note=${encodeURIComponent(note.slice(0, 60))}`;
    }
    if (host === 'cash.app' && currency === 'USD' && parts.length === 1 && parts[0]!.startsWith('$')) return `https://cash.app/${parts[0]}/${amount}`;
  } catch { /* not a URL */ }
  return link;
}

/** Seconds left until `until` (ms timestamp), ticking every 250ms. */
export function useCountdown(until: number | null | undefined) {
  const [left, setLeft] = useState(() => (until ? Math.max(0, until - Date.now()) : 0));
  useEffect(() => {
    if (!until) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, until - Date.now()));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

export const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Resize a picked photo to max 900px JPEG so uploads stay small on slow mobile data. */
export function resizeImage(file: File, max = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

export function useDebounced<T extends (...a: any[]) => void>(fn: T, ms: number) {
  const [state] = useState(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const ref = { fn };
    const call = (...a: any[]) => { clearTimeout(t); t = setTimeout(() => ref.fn(...a), ms); };
    return { ref, call };
  });
  state.ref.fn = fn;
  return state.call as T;
}

/** YouTube / Instagram link → embeddable URL (YouTube only; IG lives can't be embedded). */
export function embedUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop();
      if (id && id !== 'watch') return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;
    }
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}?autoplay=1&mute=1&playsinline=1`;
  } catch { /* not a URL */ }
  return null;
}

export const initials = (name: string) => name.replace(/\([^)]*\)/g, '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 2).map((s) => [...s][0]!.toUpperCase()).join('') || '?';

const HUES = [12, 28, 160, 200, 260, 320, 45, 100];
export const hueFor = (id: string) => HUES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

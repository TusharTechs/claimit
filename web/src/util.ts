import { useEffect, useState } from 'react';

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function upiLink(upi: string, shop: string, amount: number, note: string) {
  const p = new URLSearchParams({ pa: upi, pn: shop, am: String(amount), cu: 'INR', tn: note.slice(0, 50) });
  return `upi://pay?${p.toString()}`;
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

/** Resize a picked photo to max 900px JPEG so uploads stay small on Indian mobile data. */
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

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');

const HUES = [12, 28, 160, 200, 260, 320, 45, 100];
export const hueFor = (id: string) => HUES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

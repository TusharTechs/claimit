import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import { Package, X } from 'lucide-react';
import { hueFor, initials } from '../util';

/** ClaimIt mark: a "C" with a queue of dots and a check at the front of the line — first in line gets it. */
export function LogoMark({ className = 'size-7', tile = true }: { className?: string; tile?: boolean }) {
  const c = tile ? '#FFF7EE' : '#FF4A1C';
  return (
    <svg viewBox={tile ? '0 0 512 512' : '40 96 432 320'} className={className} aria-hidden>
      {tile && <rect width="512" height="512" rx="116" fill="#FF4A1C" />}
      <path d="M338 160 A128 128 0 1 0 338 352" fill="none" stroke={c} strokeWidth="66" strokeLinecap="round" />
      <circle cx="196" cy="256" r="11" fill={c} opacity=".45" />
      <circle cx="244" cy="256" r="15" fill={c} opacity=".72" />
      <circle cx="298" cy="256" r="20" fill={c} />
      <circle cx="396" cy="256" r="48" fill="#17120E" />
      <path d="M374 257 L390 273 L419 241" fill="none" stroke="#fff" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-extrabold ${className}`}>
      <LogoMark className="size-[1.6em]" />
      ClaimIt
    </span>
  );
}

export function Avatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  const h = hueFor(id);
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${h} 70% 48%)` }}
      aria-hidden
    >
      {initials(name) || '?'}
    </span>
  );
}

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function QR({ value, size = 168, className = '' }: { value: string; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, value, { width: size, margin: 1, color: { dark: '#17120e', light: '#ffffff' } });
  }, [value, size]);
  return <canvas ref={ref} className={`rounded-xl ${className}`} style={{ width: size, height: size }} />;
}

// Stack of open sheets so Escape only closes the top one.
const sheetStack: number[] = [];
let sheetSeq = 0;

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = ++sheetSeq;
    sheetStack.push(me);
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (sheetStack[sheetStack.length - 1] !== me) return;
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && panel.current) { // simple focus trap
        const f = panel.current.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-autofocus], button')?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      sheetStack.splice(sheetStack.indexOf(me), 1);
      prev?.focus?.();
    };
  }, [open]); // only on open/close — re-renders while open must never steal focus from inputs
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={typeof title === 'string' ? title : undefined}>
      <button className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div ref={panel} className="anim-sheet relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-paper shadow-2xl sm:rounded-[28px]">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <div className="font-display text-xl font-bold">{title}</div>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-line/60 text-ink-2 hover:bg-line" aria-label="Close">
            <X className="size-4" strokeWidth={2.6} />
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

/** Styled replacement for window.confirm(). */
export function ConfirmSheet({ open, title, body, confirmLabel, tone = 'hot', onConfirm, onClose }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; tone?: 'hot' | 'ink' | 'mint'; onConfirm: () => void; onClose: () => void;
}) {
  const cls = { hot: 'bg-hot', ink: 'bg-ink', mint: 'bg-mint' }[tone];
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="text-ink-2">{body}</div>
      <div className="mt-5 flex gap-2 pb-2">
        <button data-autofocus className="btn flex-1 bg-line/70 py-3 text-ink" onClick={onClose}>Cancel</button>
        <button className={`btn flex-1 py-3 text-white ${cls}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </div>
    </Sheet>
  );
}

/** Toasts via sonner (aria-live, stacking, swipe to dismiss). Same small API the pages already use. */
export function useToasts() {
  return {
    push: (text: string, tone: 'hot' | 'mint' | 'ink' = 'ink') => {
      if (tone === 'mint') toast.success(text, { id: text });
      else if (tone === 'hot') toast(text, { id: text, className: 'claimit-toast-hot' });
      else toast(text, { id: text });
    },
  };
}

/** Product image, or a branded tile when the seller hasn't added a photo. */
export function ItemThumb({ name, image, className = '', big = false }: { name: string; image: string | null; className?: string; big?: boolean }) {
  if (image) return <img src={image} alt={name} className={`size-full object-cover ${className}`} draggable={false} />;
  const h = hueFor(name);
  return (
    <div className={`grid size-full place-items-center ${className}`} style={{ background: `linear-gradient(135deg, hsl(${h} 80% 90%), hsl(${(h + 30) % 360} 75% 80%))` }} aria-label={name} role="img">
      <div className="flex flex-col items-center gap-1" style={{ color: `hsl(${h} 45% 32%)` }}>
        <Package className={big ? 'size-14' : 'size-6'} strokeWidth={1.6} />
        {big && <span className="font-display text-4xl font-extrabold">{initials(name)}</span>}
      </div>
    </div>
  );
}

export function celebrate(origin?: { x: number; y: number }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ff4a1c', '#ffb400', '#14a06a', '#fff7ee'];
  confetti({ particleCount: 90, spread: 75, startVelocity: 42, origin: origin ?? { x: 0.5, y: 0.7 }, colors, scalar: 0.9, disableForReducedMotion: true });
  setTimeout(() => confetti({ particleCount: 50, spread: 110, origin: origin ?? { x: 0.5, y: 0.6 }, colors, scalar: 0.7, disableForReducedMotion: true }), 180);
}

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`btn bg-ink px-4 py-2 text-sm text-white ${className}`}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    draft: ['Not dropped', 'bg-line/70 text-ink-2'],
    live: ['Up for grabs', 'bg-hot-soft text-hot-dark'],
    held: ['On hold', 'bg-sun-soft text-[#8a5a00]'],
    paying: ['Confirming pay', 'bg-sun-soft text-[#8a5a00]'],
    sold: ['Sold', 'bg-mint-soft text-mint'],
    closed: ['Closed', 'bg-line/70 text-muted'],
  };
  const [label, cls] = map[status] || [status, 'bg-line text-ink'];
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${cls}`}>{label}</span>;
}

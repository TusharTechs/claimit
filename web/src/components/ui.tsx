import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { hueFor, initials } from '../util';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-extrabold ${className}`}>
      <span className="grid size-7 place-items-center rounded-[9px] bg-hot text-white">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
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

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <button className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />
      <div className="anim-sheet relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-paper shadow-2xl sm:rounded-[28px]">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <div className="font-display text-xl font-bold">{title}</div>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-line/60 text-ink-2 hover:bg-line" aria-label="Close">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export function Toasts({ items }: { items: { id: number; text: string; tone: 'hot' | 'mint' | 'ink' }[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div key={t.id} className={`anim-pop rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg ${t.tone === 'hot' ? 'bg-hot' : t.tone === 'mint' ? 'bg-mint' : 'bg-ink'}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [items, setItems] = useState<{ id: number; text: string; tone: 'hot' | 'mint' | 'ink' }[]>([]);
  const push = (text: string, tone: 'hot' | 'mint' | 'ink' = 'ink') => {
    const id = Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3200);
  };
  return { items, push };
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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { api, type Impact as ImpactT } from '../api';
import { Logo, Spinner } from '../components/ui';
import { money } from '../util';

export function Counter({ value, format = (n: number) => n.toLocaleString('en') }: { value: number; format?: (n: number) => string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  useEffect(() => { const c = animate(mv, value, { duration: 1.2, ease: 'easeOut' }); return () => c.stop(); }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}

export default function Impact() {
  const [d, setD] = useState<ImpactT | null>(null);
  useEffect(() => {
    const load = () => api.impact().then(setD).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  const tiles: [string, number, string, ((n: number) => string)?][] = d ? [
    ['Buyers who joined a drop', d.buyers, 'real people, each a live Nexconn connection'],
    ['Items claimed & sold', d.itemsSold, 'every one to exactly one buyer'],
    ['Contested items settled fairly', d.contestedItems, 'items where 2+ people raced — 0 double-claims'],
    ['Claims resolved', d.claimsSettled, 'paid, released or auto-promoted to the next in line'],
    ['Sales through drops (≈ USD)', d.gmvUsd, 'paid straight to sellers in their own currency, 0% commission', (n: number) => money(n, 'USD')],
    ['Sellers running drops', d.sellers, `${d.drops} drops so far`],
  ] : [];
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/"><Logo className="text-xl" /></Link>
        <Link to="/sell" className="btn bg-ink px-4 py-2 text-sm text-white">Start a drop</Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <p className="mt-6 text-sm font-bold uppercase tracking-wider text-hot-dark">Live impact</p>
        <h1 className="mt-1 font-display text-5xl font-extrabold leading-none">Fair drops, counted.</h1>
        <p className="mt-3 max-w-xl text-lg text-ink-2">Every number below is computed live from real drops. No test accounts, no personal data.</p>
        {!d ? <Spinner className="mt-10 size-8 text-hot" /> : (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tiles.map(([label, value, sub, fmt]) => (
                <div key={label} className="rounded-[26px] border border-line bg-card p-6 shadow-[var(--shadow-card)]">
                  <div className="font-display text-5xl font-extrabold text-ink"><Counter value={value} format={fmt} /></div>
                  <div className="mt-2 font-semibold">{label}</div>
                  <div className="text-sm text-muted">{sub}</div>
                </div>
              ))}
            </div>
            {d.liveNow.length > 0 && (
              <div className="mt-10">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Live right now</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {d.liveNow.map((l) => (
                    <Link key={l.id} to={`/d/${l.id}`} className="btn bg-hot px-4 py-2 text-sm text-white"><span className="anim-live size-2 rounded-full bg-white" />{l.shop} · {l.title.length > 30 ? l.title.slice(0, 29) + '…' : l.title}</Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

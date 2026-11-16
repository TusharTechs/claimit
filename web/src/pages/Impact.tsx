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

/** Below this many real buyers we show an honest pilot-phase page instead of a wall of small numbers. */
const PILOT_THRESHOLD = 25;

function Pilot({ d }: { d: ImpactT }) {
  const demo = d.demo ?? { visitors: 0, claimTaps: 0, humanWins: 0 };
  return (
    <>
      <div className="mt-8 rounded-[26px] border-2 border-dashed border-line bg-card p-6">
        <div className="text-xs font-bold uppercase tracking-wider text-hot-dark">Pilot phase</div>
        <p className="mt-1 text-lg font-semibold">ClaimIt just launched. Real seller numbers appear here automatically once pilot shops have run their first drops.</p>
        <p className="mt-1 text-sm text-muted">{d.sellers} shop{d.sellers === 1 ? '' : 's'} running real drops · {d.proWaitlist ?? 0} on the Pro waitlist. Practice drops and the demo never count toward real numbers.</p>
        <Link to="/sell" className="btn mt-4 bg-ink px-5 py-2.5 text-white">Become a pilot shop — free</Link>
      </div>
      <h2 className="mt-10 text-xs font-bold uppercase tracking-wider text-muted">Meanwhile, in the always-on demo room (bots included, labelled)</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {([['People who tried the demo', demo.visitors], ['Claim taps by people', demo.claimTaps], ['Times a person beat the bots', demo.humanWins]] as const).map(([label, value]) => (
          <div key={label} className="rounded-[26px] border border-line bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="font-display text-5xl font-extrabold text-ink"><Counter value={value} /></div>
            <div className="mt-2 font-semibold">{label}</div>
          </div>
        ))}
      </div>
      <Link to="/d/demo" className="btn mt-6 bg-hot-dark px-5 py-3 text-white">Try to beat the bots →</Link>
    </>
  );
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
        {!d ? <Spinner className="mt-10 size-8 text-hot" /> : d.buyers < PILOT_THRESHOLD ? <Pilot d={d} /> : (
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
                    <Link key={l.id} to={`/d/${l.id}`} className="btn bg-hot-dark px-4 py-2 text-sm text-white"><span className="anim-live size-2 rounded-full bg-white" />{l.shop} · {l.title.length > 30 ? l.title.slice(0, 29) + '…' : l.title}</Link>
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

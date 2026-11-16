import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { BellPlus, BellRing, ChevronRight, Share2, ShieldCheck } from 'lucide-react';
import { api, ApiError, type Shop as ShopT } from '../api';
import { ensureBuyer } from '../buyer';
import { ItemThumb, Logo, LogoMark, Spinner, useToasts } from '../components/ui';
import { celebrate } from '../components/ui';
import { approx } from '../util';
import { ReportShop } from '../components/ReportShop';

export default function Shop() {
  const { sellerId = '' } = useParams();
  const [shop, setShop] = useState<ShopT | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toasts = useToasts();

  useEffect(() => {
    api.shop(sellerId).then(setShop).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'This shop does not exist.' : 'Could not load the shop.'));
  }, [sellerId]);

  if (error) return <div className="grid min-h-full place-items-center p-6 text-center"><div><p className="text-lg">{error}</p><Link to="/" className="btn mt-4 bg-ink px-5 py-2.5 text-white">Go home</Link></div></div>;
  if (!shop) return <div className="grid min-h-full place-items-center"><Spinner className="size-8 text-hot" /></div>;

  const live = shop.drops.find((d) => d.status === 'live' && d.items > 0);
  // A scheduled drop that hasn't started is "upcoming", not a past drop with 0/0 sold.
  // Scheduled (or opened) but nothing dropped yet: "upcoming" (or "starting soon" once its time has passed).
  const upcoming = shop.drops.filter((d) => d.status === 'live' && d !== live && d.items === 0);
  const past = shop.drops.filter((d) => d !== live && !upcoming.includes(d) && d.items > 0);
  const toggle = async () => {
    setBusy(true);
    try {
      await ensureBuyer();
      const r = await api.follow(shop.id, !shop.following);
      setShop({ ...shop, following: r.following, followers: r.followers });
      if (r.following) { celebrate({ x: 0.5, y: 0.3 }); toasts.push(`You'll hear when ${shop.shop} drops next`, 'mint'); }
    } catch (e) { toasts.push(e instanceof Error ? e.message : 'Could not follow', 'hot'); } finally { setBusy(false); }
  };
  const share = async () => {
    const url = location.href.split('?')[0];
    try { if (navigator.share) await navigator.share({ title: shop.shop, url }); else { await navigator.clipboard.writeText(url); toasts.push('Shop link copied'); } } catch { /* cancelled */ }
  };

  return (
    <div className="mx-auto min-h-full max-w-lg px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Link to="/"><Logo className="text-lg" /></Link>
        <button onClick={share} className="grid size-10 place-items-center rounded-full bg-white shadow-sm" aria-label="Share this shop"><Share2 className="size-[18px]" /></button>
      </header>

      <section className="mt-6 text-center">
        <div className="mx-auto grid size-20 place-items-center rounded-full bg-hot font-display text-3xl font-extrabold text-white shadow-[var(--shadow-pop)]">
          {shop.shop.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'S'}
        </div>
        <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight">{shop.shop}</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted">
          <ShieldCheck className="size-4 text-mint" /> Fair drops on ClaimIt since {new Date(shop.since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
        </p>
        {shop.avgConfirmSec ? <p className="mt-0.5 text-sm text-muted">Usually confirms payments in {approx(shop.avgConfirmSec)}</p> : null}
        {(shop.reports ?? 0) >= 1 || (shop.rejectedPct ?? 0) >= 20
          ? <p className="mt-0.5 text-sm font-bold text-hot-dark">⚠ {[(shop.reports ?? 0) >= 1 && `${shop.reports} upheld buyer report${shop.reports === 1 ? '' : 's'}`, (shop.rejectedPct ?? 0) >= 20 && `${shop.rejectedPct}% of payments not confirmed`].filter(Boolean).join(' · ')}</p>
          : null}
        {(shop.reportsUnderReview ?? 0) > 0 && <p className="mt-0.5 text-sm text-muted">{shop.reportsUnderReview} buyer report{shop.reportsUnderReview === 1 ? '' : 's'} under review</p>}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[['Followers', shop.followers], ['Drops', past.length + (live ? 1 : 0) + upcoming.length], ['Orders', shop.orders]].map(([k, v]) => (
            <div key={k as string} className="rounded-2xl bg-card py-3 shadow-[var(--shadow-card)]"><div className="font-display text-2xl font-extrabold">{v}</div><div className="text-xs text-muted">{k}</div></div>
          ))}
        </div>
        <motion.button whileTap={{ scale: 0.97 }} onClick={toggle} disabled={busy}
          className={`btn mt-4 w-full py-3.5 text-lg ${shop.following ? 'bg-white text-ink shadow-sm' : 'bg-ink text-white'}`}>
          {busy ? <Spinner /> : shop.following ? <><BellRing className="size-5" /> Following · we'll ping you</> : <><BellPlus className="size-5" /> Follow for the next drop</>}
        </motion.button>
      </section>

      {live && (
        <Link to={`/d/${live.id}`} className="mt-6 flex items-center gap-3 rounded-[22px] bg-hot-dark p-3 pr-4 text-white shadow-[var(--shadow-pop)]">
          <div className="size-16 shrink-0 overflow-hidden rounded-2xl bg-white/20"><ItemThumb name={live.title} image={live.cover} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"><span className="anim-live size-2 rounded-full bg-white" /> Live now</div>
            <div className="truncate font-display text-lg font-bold">{live.title}</div>
            <div className="text-sm text-white/85">{live.sold}/{live.items} claimed & paid</div>
          </div>
          <ChevronRight className="size-6" />
        </Link>
      )}

      {upcoming.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Upcoming</h2>
          <div className="mt-3 space-y-2">
            {upcoming.map((d) => (
              <Link key={d.id} to={`/d/${d.id}`} className="flex items-center gap-3 rounded-2xl bg-sun-soft p-4">
                <span className="text-2xl">📅</span>
                <div className="min-w-0 flex-1"><div className="truncate font-semibold">{d.title}</div>
                  <div className="text-sm text-[#6b4600]">{d.startsAt && d.startsAt > Date.now() ? new Date(d.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Starting soon'}</div></div>
                <span className="text-sm font-bold">Remind me →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className={`mt-8 ${live && past.length === 0 ? 'hidden' : ''}`}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">{live ? 'Past drops' : 'Drops'}</h2>
        {past.length === 0 && !live && upcoming.length === 0 && <p className="mt-3 rounded-2xl border-2 border-dashed border-line p-6 text-center text-muted">No drops yet. Follow to hear about the first one.</p>}
        <div className="mt-3 grid grid-cols-2 gap-3">
          {past.map((d) => (
            <Link key={d.id} to={`/d/${d.id}`} className="overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-card)]">
              <div className="aspect-[4/3] bg-line"><ItemThumb name={d.title} image={d.cover} /></div>
              <div className="p-2.5">
                <div className="line-clamp-2 text-sm font-semibold leading-tight">{d.title}</div>
                <div className="mt-1 text-xs text-muted">{d.sold}/{d.items} sold · {new Date(d.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer className="mt-12 flex flex-col items-center gap-2 text-center text-sm text-muted">
        <LogoMark className="size-8" />
        <p>Selling through Instagram or WhatsApp lives? <Link to={`/sell?ref=${shop.id}`} className="font-semibold text-hot-dark underline">Run your own fair drop — free</Link></p>
        <ReportShop sellerId={shop.id} shop={shop.shop} className="mt-2" />
      </footer>
    </div>
  );
}

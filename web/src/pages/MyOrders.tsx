import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Heart, ShoppingBag } from 'lucide-react';
import { api, sessions, type BuyerOrders } from '../api';
import { ItemThumb, Logo, Spinner } from '../components/ui';
import { money } from '../util';
import { ORDER_STATUS } from '../../../shared/types';

/** Everything a buyer has claimed, across every shop and drop, plus the shops they follow. Lives on this device (no password). */
export default function MyOrders() {
  const [d, setD] = useState<BuyerOrders | null>(null);
  const me = sessions.buyer();
  useEffect(() => {
    if (!me) { setD({ orders: [], following: [] }); return; }
    const load = () => api.buyerOrders().then(setD).catch(() => setD({ orders: [], following: [] }));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [me?.id]);

  const live = d?.following.filter((f) => f.liveDrop) ?? [];
  const tone = { sun: 'bg-sun-soft text-[#6b4600]', mint: 'bg-mint-soft text-mint', muted: 'bg-line text-ink-2', hot: 'bg-hot-soft text-hot-dark' } as const;

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
        <Link to="/"><Logo className="text-xl" /></Link>
        {me && <span className="text-sm font-semibold text-muted">Hi {me.isGuest ? 'there' : me.name}</span>}
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <h1 className="font-display text-4xl font-extrabold">My orders</h1>
        <p className="mt-1 text-ink-2">Every item you've claimed, from every shop, in one place.</p>
        {!d ? <Spinner className="mt-10 size-8 text-hot" /> : (
          <>
            {live.length > 0 && (
              <section className="mt-6">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Live now from shops you follow</h2>
                <div className="mt-2 space-y-2">
                  {live.map((f) => (
                    <Link key={f.id} to={`/d/${f.liveDrop}`} className="flex items-center gap-3 rounded-2xl bg-hot-dark p-4 text-white shadow-[var(--shadow-pop)]">
                      <span className="anim-live size-2.5 rounded-full bg-white" />
                      <div className="min-w-0 flex-1"><div className="font-bold">{f.shop}</div><div className="truncate text-sm text-white/85">{f.liveTitle}</div></div>
                      <span className="font-bold">Join →</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-6">
              {d.orders.length === 0 ? (
                <div className="rounded-[26px] border border-line bg-card p-8 text-center">
                  <ShoppingBag className="mx-auto size-8 text-muted" />
                  <p className="mt-2 font-semibold">No orders yet</p>
                  <p className="text-sm text-muted">Claims you make in any drop show up here.</p>
                  <Link to="/d/demo" className="btn mt-4 bg-ink px-5 py-2.5 text-white">Try the live demo</Link>
                </div>
              ) : (
                <ul className="space-y-2">
                  {d.orders.map((o) => {
                    const st = o.status === 'waiting' ? { label: `#${o.position} in line`, tone: 'sun' as const }
                      : o.status === 'paid' && o.shippedAt ? ORDER_STATUS.shipped! : ORDER_STATUS[o.status] ?? { label: o.status, tone: 'muted' as const };
                    return (
                      <li key={o.id}>
                        <Link to={`/d/${o.dropId}?order=${o.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-sm hover:border-ink/30">
                          <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-line"><ItemThumb name={o.itemName} image={o.image} /></div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{o.itemName}</div>
                            <div className="truncate text-sm text-muted">{o.shop} · {money(o.price, o.currency)}</div>
                            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${tone[st.tone]}`}>{st.label}</span>
                          </div>
                          <ChevronRight className="size-5 text-muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {d.following.length > 0 && (
              <section className="mt-8">
                <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted"><Heart className="size-3.5" /> Shops you follow</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.following.map((f) => <Link key={f.id} to={`/s/${f.id}`} className="btn bg-white px-4 py-2 text-sm shadow-sm">{f.shop}</Link>)}
                </div>
              </section>
            )}
            <p className="mt-8 text-center text-xs text-muted">Your orders are saved on this device — no account or password needed.</p>
          </>
        )}
      </main>
    </div>
  );
}

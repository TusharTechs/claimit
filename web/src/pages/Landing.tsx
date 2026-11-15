import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Banknote, BellRing, Check, ChevronDown, Clock, MessageCircle, MousePointerClick, Radio, ShieldCheck, Smartphone, Truck, Users, X, Zap,
} from 'lucide-react';
import { api, type Impact } from '../api';
import { Avatar, Logo, LogoMark } from '../components/ui';
import { Counter } from './Impact';
import { money } from '../util';

// ---------- animated claim race (the whole product in 8 seconds) ----------

const RACE = [
  { t: 0, phase: 'drop' },
  { t: 1400, phase: 'taps' },
  { t: 2300, phase: 'held' },
  { t: 4800, phase: 'promoted' },
  { t: 6800, phase: 'sold' },
] as const;
type Phase = (typeof RACE)[number]['phase'];

function useRace() {
  const [phase, setPhase] = useState<Phase>('drop');
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setPhase('held'); return; }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      timers = RACE.map((s) => setTimeout(() => setPhase(s.phase), s.t));
      timers.push(setTimeout(run, 9200));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, []);
  return phase;
}

function PhoneDemo() {
  const phase = useRace();
  const holder = phase === 'promoted' || phase === 'sold' ? { id: 'b_leo', name: 'Leo' } : { id: 'b_priya', name: 'Priya' };
  const queue = phase === 'promoted' || phase === 'sold' ? [{ id: 'b_sofia', name: 'Sofia' }] : [{ id: 'b_leo', name: 'Leo' }, { id: 'b_sofia', name: 'Sofia' }];
  const feed = {
    drop: ['🔥 Dropped #12: Denim jacket · $42'],
    taps: ['🔥 Dropped #12: Denim jacket · $42', 'Priya claimed Denim jacket'],
    held: ['Priya claimed Denim jacket', 'Leo is #1 in line', 'Sofia is #2 in line'],
    promoted: ['Sofia is #2 in line', "⏱ Priya ran out of time → Leo's turn"],
    sold: ["⏱ Priya ran out of time → Leo's turn", 'SOLD to Leo — Denim jacket'],
  }[phase];
  return (
    <div className="relative mx-auto w-[300px]" aria-label="Animated example of a ClaimIt drop" role="img">
      <div className="rounded-[44px] border-[10px] border-ink bg-paper p-3 shadow-[0_40px_80px_-30px_rgb(23_18_14/0.5)]">
        <div className="mx-auto mb-2 h-5 w-24 rounded-full bg-ink" />
        <div className="flex items-center justify-between px-1 text-[13px]">
          <span className="font-display font-extrabold">Maya's Vintage</span>
          <span className="flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-white"><span className="anim-live size-1.5 rounded-full bg-hot" />LIVE · 214</span>
        </div>
        <div className="relative mt-2 overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-card)]">
          <div className="relative aspect-[4/3]">
            <img src="/demo/denim-jacket.jpg" alt="" className="size-full object-cover" />
            <span className="absolute left-2 top-2 rounded-full bg-ink/85 px-2 py-0.5 text-[10px] font-bold text-white">#12 · JUST DROPPED</span>
            <AnimatePresence>
              {phase === 'sold' && (
                <motion.div className="absolute inset-0 grid place-items-center bg-white/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <motion.div initial={{ scale: 2.2, rotate: -14, opacity: 0 }} animate={{ scale: 1, rotate: -10, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}
                    className="rounded-xl border-4 border-mint bg-white px-4 py-1 font-display text-3xl font-extrabold text-mint">SOLD</motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="p-3">
            <div className="flex justify-between font-display text-base font-bold"><span>Vintage denim jacket · M</span><span>$42</span></div>
            <AnimatePresence>
              {phase !== 'drop' && phase !== 'taps' && phase !== 'sold' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-2 overflow-hidden rounded-xl bg-sun-soft p-2 text-[12px]">
                  <AnimatePresence mode="popLayout">
                    <motion.div key={holder.id} initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -30, opacity: 0 }} className="flex items-center gap-1.5 font-semibold text-[#6b4600]">
                      <Avatar id={holder.id} name={holder.name} size={18} /> {holder.name} is holding it <span className="ml-auto tabular-nums">{phase === 'promoted' ? '4:59' : '0:03'}</span>
                    </motion.div>
                  </AnimatePresence>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white">
                    <motion.div key={holder.id} className={`h-full rounded-full ${phase === 'promoted' ? 'bg-mint' : 'bg-hot'}`} initial={{ width: phase === 'promoted' ? '100%' : '12%' }} animate={{ width: phase === 'promoted' ? '96%' : '0%' }} transition={{ duration: 2.4, ease: 'linear' }} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 text-[#6b4600]"><b className="text-[10px] uppercase">Next</b>
                    {queue.map((q) => <motion.span key={q.id} layout><Avatar id={q.id} name={q.name} size={16} /></motion.span>)}
                    <span>{queue.map((q) => q.name).join(', ')}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="mt-2 h-[86px] space-y-1 overflow-hidden">
          <AnimatePresence initial={false}>
            {feed.map((f) => (
              <motion.div key={f} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`mx-auto w-fit rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${f.startsWith('SOLD') ? 'bg-mint-soft text-mint' : f.startsWith('🔥') ? 'bg-ink text-white' : 'bg-hot-soft text-hot-dark'}`}>{f}</motion.div>
            ))}
          </AnimatePresence>
        </div>
        <motion.div layout className={`mt-1 rounded-full py-3 text-center font-display text-lg font-bold text-white ${phase === 'drop' ? 'anim-ring bg-hot' : phase === 'sold' ? 'bg-line !text-ink-2' : 'bg-ink'}`}>
          {phase === 'drop' ? 'CLAIM · $42' : phase === 'sold' ? 'Sold to Leo' : `Join the line (#${queue.length + 1})`}
        </motion.div>
      </div>
      <AnimatePresence>
        {phase === 'taps' && ['b_priya', 'b_rahul', 'b_meera'].map((id, i) => (
          <motion.div key={id} className="absolute" style={{ left: 40 + i * 90, bottom: 40 }}
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.3, 1], opacity: [0, 1, 0] }} transition={{ delay: i * 0.12, duration: 0.8 }}>
            <MousePointerClick className="size-8 text-hot drop-shadow" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------- page ----------

const COMPARE: [string, string, string][] = [
  ['Who gets the item?', 'Whoever the seller spots first in a scrolling comment flood', 'First tap, decided by the server, visible to everyone'],
  ['Double-claims & fights', 'Weekly', 'Impossible: exactly one holder per item'],
  ['Buyer ghosts after claiming', 'Seller DMs, waits, re-posts', 'Timer runs out → next in line, automatically'],
  ['Getting paid', 'Chasing screenshots in DMs', 'Order card with your payment link, delivery address, “I’ve paid” button'],
  ['Knowing who to ship to', 'Scroll back through chats', 'One-click orders CSV with addresses'],
];

const FAQ: [string, string][] = [
  ['Do buyers need to install an app or sign up?', 'No. They tap your link and they’re in. A name is asked only when they claim something.'],
  ['Does ClaimIt take a cut of my sales?', 'No. Buyers pay you directly — PayPal, Venmo, Stripe, GCash, UPI or any payment link. The free plan is free forever; Pro is optional.'],
  ['Which countries and currencies work?', 'All of them. Pick your currency when you set up — dollars, euros, pounds, pesos, rupiah, rupees and more. The same “comment SOLD / MINE” chaos happens on every live-selling platform, and live rooms run on Nexconn’s global network.'],
  ['I go live on Instagram. How does this fit?', 'Keep going live on Instagram as usual. Put your ClaimIt link in your story, bio or pinned comment, and say “#12 is up!” — buyers claim in ClaimIt instead of commenting.'],
  ['What if the winner doesn’t pay?', 'You choose 2–15 minutes. When it runs out, the next person in line is promoted automatically and gets the order card.'],
  ['How many people can join a drop?', 'As many as you can bring. Live rooms run on Nexconn open channels built for huge live-stream audiences; product drops are priority messages that land even when chat is flooding.'],
];

export default function Landing() {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  useEffect(() => { api.impact().then(setImpact).catch(() => {}); }, []);
  const showImpact = impact && impact.buyers >= 10;

  return (
    <div className="min-h-full overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Logo className="text-xl" />
        <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-3">
          <Link to="/pricing" className="hidden rounded-full px-3 py-2 hover:bg-white sm:block">Pricing</Link>
          <Link to="/impact" className="hidden rounded-full px-3 py-2 hover:bg-white sm:block">Impact</Link>
          <Link to="/sell" className="btn bg-ink px-4 py-2 text-white">Seller login</Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-x-12 gap-y-8 px-4 pb-16 pt-6 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-12">
          <div className="md:col-start-1 md:row-start-1">
            {impact?.liveNow?.[0] ? (
              <Link to={`/d/${impact.liveNow[0].id}`} className="mb-5 inline-flex items-center gap-2 rounded-full bg-hot px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white">
                <span className="anim-live size-2 rounded-full bg-white" /> Live now: {impact.liveNow[0].shop}
              </Link>
            ) : (
              <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-hot-soft px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-hot-dark">
                <Radio className="size-3.5" /> For Instagram, TikTok, Facebook & WhatsApp live sellers
              </p>
            )}
            <h1 className="font-display text-[46px] font-extrabold leading-[0.95] tracking-tight sm:text-7xl">
              “Comment MINE”<br />is broken.<br /><span className="text-hot">Claim it fair.</span>
            </h1>
          </div>
          <div className="md:col-start-2 md:row-span-2 md:row-start-1"><PhoneDemo /></div>
          <div className="md:col-start-1 md:row-start-2">
            <p className="max-w-md text-lg text-ink-2">
              Share one link during your live. Buyers tap <b>Claim</b>, everyone watches the same queue, and the winner lands straight in a
              checkout chat with your payment link. If they don’t pay in time, the next person gets it — automatically.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/sell" className="btn anim-ring bg-hot px-7 py-4 text-lg text-white shadow-[var(--shadow-pop)]">Start a drop — free</Link>
              <Link to="/d/demo" className="btn border-2 border-ink px-6 py-3.5 text-lg">Try the live demo</Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-ink-2">
              {['No app for buyers', '0% commission', 'Any currency, any payment link'].map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="size-4 text-mint" />{t}</li>)}
            </ul>
          </div>
        </section>

        {showImpact && (
          <section className="border-y border-line bg-card">
            <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 text-center sm:grid-cols-4 sm:px-6">
              {([['Buyers in drops', impact.buyers], ['Items sold fairly', impact.itemsSold], ['Races settled, 0 double-claims', impact.contestedItems], ['Paid to sellers (≈ USD)', impact.gmvUsd, (n: number) => money(n, 'USD')]] as [string, number, ((n: number) => string)?][]).map(([k, v, f]) => (
                <div key={k}><div className="font-display text-4xl font-extrabold"><Counter value={v} format={f} /></div><div className="mt-1 text-sm text-muted">{k}</div></div>
              ))}
            </div>
            <p className="pb-6 text-center text-sm"><Link to="/impact" className="font-semibold text-hot-dark underline">See live impact →</Link></p>
          </section>
        )}

        {/* How it works with Instagram */}
        <section id="how" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-4xl font-extrabold sm:text-5xl">Keep your live. Lose the chaos.</h2>
          <p className="mt-3 max-w-2xl text-lg text-ink-2">ClaimIt sits next to the live you already do — Instagram, TikTok, Facebook, YouTube or a WhatsApp group — anywhere in the world.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              [Smartphone, 'Go live like always', 'Instagram, TikTok, Facebook, YouTube or your WhatsApp community. Add your ClaimIt link to your story, bio or pinned comment.'],
              [Zap, 'Tap “Drop now”', 'Show #12 on camera and drop it. Every viewer’s phone shows the item with one big Claim button, at the same instant.'],
              [Banknote, 'Get paid, ship it', 'The winner gets an order card with your payment link and a timer. Confirm in one tap, download addresses, ship.'],
            ].map(([Icon, t, d], i) => {
              const I = Icon as typeof Zap;
              return (
                <motion.div key={t as string} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                  className="rounded-[26px] border border-line bg-card p-6 shadow-[var(--shadow-card)]">
                  <div className="grid size-12 place-items-center rounded-2xl bg-hot text-white"><I className="size-6" /></div>
                  <div className="mt-4 font-display text-2xl font-bold">{t as string}</div>
                  <p className="mt-2 text-ink-2">{d as string}</p>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Comparison */}
        <section className="bg-ink py-16 text-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="font-display text-4xl font-extrabold sm:text-5xl">Comments vs. ClaimIt</h2>
            <div className="mt-8 overflow-hidden rounded-[26px] border border-white/10">
              <div className="grid grid-cols-[1fr_1fr_1fr] bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white/60 sm:px-6">
                <span /> <span className="flex items-center gap-1.5"><X className="size-4 text-hot" />“Comment MINE”</span><span className="flex items-center gap-1.5"><LogoMark className="size-4" />ClaimIt</span>
              </div>
              {COMPARE.map(([q, a, b]) => (
                <div key={q} className="grid grid-cols-[1fr_1fr_1fr] gap-3 border-t border-white/10 px-4 py-4 text-sm sm:px-6 sm:text-base">
                  <span className="font-semibold">{q}</span><span className="text-white/60">{a}</span><span className="text-white">{b}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-4xl font-extrabold sm:text-5xl">Everything a live seller needs</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [Users, 'A queue everyone can see', 'Holder, timer and who’s next, updated live on every phone. Fairness people can watch.'],
              [Clock, 'Auto-promotion', 'Unpaid holds pass to the next in line at the time limit you set — no more re-posting.'],
              [Truck, 'Delivery details built in', 'Phone, address and PIN come with every payment. Export all orders as CSV.'],
              [MessageCircle, 'One inbox for every order', 'Chat with each buyer in one place, with order cards in the thread.'],
              [ShieldCheck, 'Scam shield', 'Phone numbers, emails and payment handles are hidden in room chat, and only the real seller gets the Seller badge.'],
              [BellRing, 'Followers for next time', 'Buyers follow your shop and get pinged when your next drop opens.'],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Zap;
              return (
                <div key={t as string} className="rounded-[22px] bg-card p-5 shadow-[var(--shadow-card)]">
                  <I className="size-6 text-hot" />
                  <div className="mt-3 font-display text-xl font-bold">{t as string}</div>
                  <p className="mt-1 text-ink-2">{d as string}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
          <h2 className="font-display text-4xl font-extrabold">Questions</h2>
          <div className="mt-6 divide-y divide-line rounded-[22px] bg-card shadow-[var(--shadow-card)]">
            {FAQ.map(([q, a], i) => (
              <div key={q}>
                <button className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  {q}<ChevronDown className={`size-5 shrink-0 transition ${open === i ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence initial={false}>
                  {open === i && (
                    <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-5 text-ink-2">
                      <span className="block pb-4">{a}</span>
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto mb-16 max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 rounded-[32px] bg-hot p-8 text-white sm:flex-row sm:items-center sm:p-12">
            <div>
              <h2 className="font-display text-4xl font-extrabold leading-tight">Your next drop, minus the chaos.</h2>
              <p className="mt-2 text-white/85">Set up in 20 seconds, in any currency. Free forever — and no cut of your sales.</p>
            </div>
            <Link to="/sell" className="btn shrink-0 bg-white px-7 py-4 text-lg text-ink">Start a drop</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted sm:flex-row sm:px-6">
          <span className="flex items-center gap-2"><LogoMark className="size-5" /> ClaimIt · fair live drops for social sellers everywhere</span>
          <nav className="flex gap-4"><Link to="/pricing">Pricing</Link><Link to="/impact">Impact</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav>
          <span>Real-time by Nexconn</span>
        </div>
      </footer>
    </div>
  );
}

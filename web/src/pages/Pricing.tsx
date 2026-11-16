import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Sparkles } from 'lucide-react';
import { api, sessions, type SellerAccount } from '../api';
import { Logo, Spinner, celebrate, useToasts } from '../components/ui';

const FREE = [
  'Unlimited drops and items',
  'Live claim queue + automatic waitlist',
  'Buyers pay you directly (PayPal, Stripe, UPI, any link) — 0% fees',
  'Order chat, delivery details, CSV export',
  'Shop page with followers',
];
const PRO: [string, boolean][] = [
  ['Everything in Free', true],
  ['Co-hosts: up to 5 helpers confirm payments and drop items from their own phone while you present', true],
  ['Lifetime analytics: no-show rate, repeat buyers, time to pay, best hour to drop', true],
  ['Scheduled drops: a countdown page and calendar invites, so followers show up on time', true],
  ['Priority support on WhatsApp', true],
  ['Auto-confirm payments via Stripe, PayPal & UPI gateways — no manual checks', false],
  ['Custom shop link and your logo on the drop page', false],
];

export default function Pricing() {
  const [acct, setAcct] = useState<SellerAccount | null>(null);
  useEffect(() => { if (sessions.seller()) api.sellerSession().then(setAcct).catch(() => {}); }, []);
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const toasts = useToasts();
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/"><Logo className="text-xl" /></Link>
        <Link to="/sell" className="btn bg-ink px-4 py-2 text-sm text-white">Start free</Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <h1 className="mt-6 text-center font-display text-5xl font-extrabold leading-none">Free while you grow.</h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-lg text-ink-2">ClaimIt never touches your money: buyers pay you directly. Pro is for sellers doing several drops a week.</p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-[28px] border border-line bg-card p-7 shadow-[var(--shadow-card)]">
            <div className="font-display text-2xl font-bold">Free</div>
            <div className="mt-2 font-display text-5xl font-extrabold">$0</div>
            <div className="text-sm text-muted">forever, 0% commission</div>
            <ul className="mt-6 space-y-2.5">{FREE.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-5 shrink-0 text-mint" />{f}</li>)}</ul>
            <Link to="/sell" className="btn mt-7 w-full bg-ink py-3.5 text-white">Start a drop</Link>
          </div>
          <div className="relative rounded-[28px] bg-ink p-7 text-white shadow-[var(--shadow-pop)]">
            <div className="absolute -top-3 right-6 flex items-center gap-1 rounded-full bg-sun px-3 py-1 text-xs font-bold text-ink"><Sparkles className="size-3.5" /> Founding sellers: 50% off year one</div>
            <div className="font-display text-2xl font-bold">Pro</div>
            {acct?.founding
              ? <div className="mt-2 font-display text-5xl font-extrabold">$4.50<span className="text-xl font-bold text-white/70">/month</span> <span className="align-middle text-lg font-bold text-white/60 line-through">$9</span><div className="text-sm font-semibold text-sun">Your founding-seller price for year one</div></div>
              : <div className="mt-2 font-display text-5xl font-extrabold">$9<span className="text-xl font-bold text-white/70">/month</span></div>}
            <div className="text-sm text-white/70">Flat fee, still 0% commission · local pricing in every market</div>
            <ul className="mt-6 space-y-2.5">{PRO.map(([f, live]) => (
              <li key={f} className="flex gap-2"><Check className={`mt-0.5 size-5 shrink-0 ${live ? 'text-sun' : 'text-white/35'}`} />
                <span>{f}{!live && <span className="ml-1.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-bold">SOON</span>}</span></li>
            ))}</ul>
            <ProCta acct={acct} />
            {!(acct?.pro || acct?.role === 'cohost') && <>
            <p className="mt-5 text-sm font-semibold text-white/80">Get told when automatic payment confirmation launches:</p>
            {done ? (
              <div className="mt-2 rounded-2xl bg-white/10 p-4 text-center font-semibold">You're on the list 🎉 We'll tell you when it launches.</div>
            ) : (
              <form className="mt-2 flex gap-2" onSubmit={async (e) => {
                e.preventDefault(); setBusy(true);
                try { await api.proWaitlist(contact.trim()); setDone(true); celebrate({ x: 0.75, y: 0.6 }); }
                catch (e2) { toasts.push(e2 instanceof Error ? e2.message : 'Could not join', 'hot'); } finally { setBusy(false); }
              }}>
                <label className="sr-only" htmlFor="pro-contact">Phone or email</label>
                <input id="pro-contact" className="input !border-white/20 !bg-white/10 !text-white placeholder:!text-white/50" placeholder="Phone or email" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
                <button className="btn shrink-0 bg-hot-dark px-5 text-white" disabled={busy || contact.trim().length < 6}>{busy ? <Spinner /> : 'Notify me'}</button>
              </form>
            )}
            </>}
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-muted">Live rooms and chat run on Nexconn, so a drop with 5 or 5,000 buyers costs you the same: nothing.</p>
        <p className="mt-2 text-center text-sm"><Link to="/business" className="font-semibold text-hot-dark underline">See the full business model and unit economics →</Link></p>
      </main>
    </div>
  );
}

/** Logged-in shop owners start the trial right here; everyone else creates a shop first (the trial button is on their home). */
function ProCta({ acct }: { acct: SellerAccount | null }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const toasts = useToasts();
  const loggedIn = !!sessions.seller();
  if (!loggedIn) {
    return <Link to="/sell" className="btn mt-7 w-full bg-sun py-3.5 text-ink">Create a shop, then try Pro free for 14 days (30 if a shop invited you)</Link>;
  }
  if (!acct) return <div className="btn mt-7 w-full bg-white/10 py-3.5 text-white/70"><Spinner /></div>;
  if (acct.role === 'cohost') return <div className="mt-7 rounded-2xl bg-white/10 p-3.5 text-center text-sm font-semibold">You're a co-host. The shop owner manages the plan.</div>;
  if (acct.pro) {
    return <Link to="/sell" className="btn mt-7 w-full bg-white py-3.5 text-ink">You're on Pro{acct.proUntil ? ` until ${new Date(acct.proUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''} · See your team</Link>;
  }
  if (acct.trialUsed) {
    return (
      <div className="mt-7">
        <p className="text-center text-sm text-white/85">Your free trial has ended. Your shop is on Free, and nothing was lost.</p>
        <Link to="/sell" className="btn mt-2 w-full bg-sun py-3.5 text-ink">Get Pro · ${acct.founding ? '4.50' : '9'}/month →</Link>
      </div>
    );
  }
  return (
    <button className="btn mt-7 w-full bg-sun py-3.5 text-ink" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await api.proTrial(); celebrate({ x: 0.75, y: 0.6 }); toasts.push(`Pro trial started: ${acct.referred ? 30 : 14} days free`, 'mint'); nav('/sell'); }
      catch (e) { toasts.push(e instanceof Error ? e.message : 'Could not start the trial', 'hot'); } finally { setBusy(false); }
    }}>{busy ? <Spinner /> : `Start ${acct.referred ? 30 : 14}-day free trial — no card${acct.founding ? ', then $4.50/mo' : ''}`}</button>
  );
}

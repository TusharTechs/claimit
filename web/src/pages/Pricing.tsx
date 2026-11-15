import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Sparkles } from 'lucide-react';
import { api } from '../api';
import { Logo, Spinner, celebrate, useToasts } from '../components/ui';

const FREE = [
  'Unlimited drops and items',
  'Live claim queue + automatic waitlist',
  'Buyers pay your UPI directly — 0% fees',
  'Order chat, delivery details, CSV export',
  'Shop page with followers',
];
const PRO = [
  'Everything in Free',
  'Auto-confirm payments (UPI gateway, no manual checks)',
  'Co-hosts: a helper confirms payments while you’re live',
  'Advanced analytics: conversion, repeat buyers, best drop times',
  'Custom shop link and your logo on the drop page',
  'Priority support on WhatsApp',
];

export default function Pricing() {
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
        <p className="mx-auto mt-3 max-w-xl text-center text-lg text-ink-2">ClaimIt never touches your money: buyers pay your UPI directly. Pro is for sellers doing several drops a week.</p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-[28px] border border-line bg-card p-7 shadow-[var(--shadow-card)]">
            <div className="font-display text-2xl font-bold">Free</div>
            <div className="mt-2 font-display text-5xl font-extrabold">₹0</div>
            <div className="text-sm text-muted">forever, 0% commission</div>
            <ul className="mt-6 space-y-2.5">{FREE.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-5 shrink-0 text-mint" />{f}</li>)}</ul>
            <Link to="/sell" className="btn mt-7 w-full bg-ink py-3.5 text-white">Start a drop</Link>
          </div>
          <div className="relative rounded-[28px] bg-ink p-7 text-white shadow-[var(--shadow-pop)]">
            <div className="absolute -top-3 right-6 flex items-center gap-1 rounded-full bg-sun px-3 py-1 text-xs font-bold text-ink"><Sparkles className="size-3.5" /> Founding 100 sellers: free for life</div>
            <div className="font-display text-2xl font-bold">Pro</div>
            <div className="mt-2 font-display text-5xl font-extrabold">₹499<span className="text-xl font-bold text-white/70">/month</span></div>
            <div className="text-sm text-white/70">or 1.5% of sales, whichever is lower</div>
            <ul className="mt-6 space-y-2.5">{PRO.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-5 shrink-0 text-sun" />{f}</li>)}</ul>
            {done ? (
              <div className="mt-7 rounded-2xl bg-white/10 p-4 text-center font-semibold">You're on the list 🎉 We'll reach out when Pro opens.</div>
            ) : (
              <form className="mt-7 flex gap-2" onSubmit={async (e) => {
                e.preventDefault(); setBusy(true);
                try { await api.proWaitlist(contact.trim()); setDone(true); celebrate({ x: 0.75, y: 0.6 }); }
                catch (e2) { toasts.push(e2 instanceof Error ? e2.message : 'Could not join', 'hot'); } finally { setBusy(false); }
              }}>
                <label className="sr-only" htmlFor="pro-contact">Phone or email</label>
                <input id="pro-contact" className="input !border-white/20 !bg-white/10 !text-white placeholder:!text-white/50" placeholder="Phone or email" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
                <button className="btn shrink-0 bg-hot px-5 text-white" disabled={busy || contact.trim().length < 6}>{busy ? <Spinner /> : 'Get early access'}</button>
              </form>
            )}
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-muted">Live rooms and chat run on Nexconn, so a drop with 5 or 5,000 buyers costs you the same: nothing.</p>
      </main>
    </div>
  );
}

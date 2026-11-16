import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, sessions, type Cohost, type Insights, type SellerAccount, type SellerDropSummary, type SellerSession } from '../api';
import { approx, money, payLinkFor } from '../util';
import { ConfirmSheet, CopyButton, Logo, Sheet, Spinner } from '../components/ui';
import { Crown, Lock, RotateCcw, TrendingUp, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

export default function SellerHome() {
  const [seller, setSeller] = useState<SellerSession | null>(() => sessions.seller());
  const [confirmOut, setConfirmOut] = useState(false);
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/"><Logo className="text-xl" /></Link>
        {seller && (
          <button className="text-sm font-semibold text-muted hover:text-ink" onClick={() => setConfirmOut(true)}>Log out</button>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        {seller ? <Drops seller={seller} onLogout={() => setSeller(null)} /> : <Onboard onDone={(s) => { sessions.setSeller(s); setSeller(s); }} />}
      </main>
      <ConfirmSheet open={confirmOut} onClose={() => setConfirmOut(false)} title="Log out on this device?" tone="ink"
        body="You'll need your login link (Use on another device, in any drop) to get back in. Save it before logging out." confirmLabel="Log out"
        onConfirm={() => { sessions.setSeller(null); setSeller(null); }} />
    </div>
  );
}

/** Default market from the browser's region (sellers can change it). */
function guessCurrency() {
  const region = (navigator.languages?.[0] || navigator.language || '').split('-')[1]?.toUpperCase() ?? '';
  const map: Record<string, string> = { IN: 'INR', US: 'USD', PH: 'PHP', ID: 'IDR', SG: 'SGD', MY: 'MYR', TH: 'THB', AE: 'AED', GB: 'GBP',
    DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR' };
  return map[region] ?? 'USD';
}

function Onboard({ onDone }: { onDone: (s: SellerSession) => void }) {
  const [f, setF] = useState({ name: '', shop: '', upi: '', phone: '', currency: guessCurrency(), ref: new URLSearchParams(location.search).get('ref') });
  const india = f.currency === 'INR';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<(SellerSession & { phone: string | null }) | null>(null);
  const [saved, setSaved] = useState(false);

  if (created) {
    // Force a backup of the login link: the shop lives behind this key, so a cleared browser must never lose it.
    const link = `${location.origin}/sell/login#${created.id}.${created.key}`;
    const msg = `My ClaimIt seller login for ${created.shop} (keep private): ${link}`;
    return (
      <div className="mx-auto max-w-md pt-6">
        <div className="text-5xl">🎉</div>
        <h1 className="mt-2 font-display text-4xl font-extrabold leading-tight">{created.shop} is ready</h1>
        <p className="mt-2 text-ink-2">One last thing: save your private login link, so you can open your shop on any phone or laptop — even if this browser is cleared.</p>
        <div className="mt-5 space-y-2">
          <a className="btn w-full bg-[#075E54] py-3.5 text-white" target="_blank" rel="noreferrer" onClick={() => setSaved(true)}
            href={created.phone ? `https://wa.me/${created.currency === 'INR' ? '91' : ''}${created.phone.replace(/^\+/, '')}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`}>
            WhatsApp it to myself
          </a>
          <button className="btn w-full bg-white py-3 shadow-sm" onClick={async () => { try { await navigator.clipboard.writeText(link); setSaved(true); } catch { /* ignore */ } }}>
            {saved ? 'Saved ✓' : 'Copy login link'}
          </button>
        </div>
        <button className="btn mt-6 w-full bg-ink py-3.5 text-lg text-white" disabled={!saved} onClick={() => onDone(created)}>
          {saved ? 'Go to my shop' : 'Save the link first'}
        </button>
        <button className="mt-3 w-full text-center text-sm text-muted underline" onClick={() => onDone(created)}>Skip (not recommended)</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="font-display text-4xl font-extrabold leading-tight">Set up your shop</h1>
      <p className="mt-2 text-ink-2">Takes 20 seconds. Buyers pay you directly — by PayPal, UPI, GCash, bank transfer or any payment link. ClaimIt never touches your money.</p>
      <form className="mt-6 space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try { const s = await api.createSeller(f); setCreated({ id: s.id, key: s.key, name: s.name, shop: s.shop, upi: s.upi, currency: s.currency, payLink: s.payLink, payNote: (s as any).payNote ?? null, phone: (s as any).phone ?? null }); }
        catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Something went wrong'); } finally { setBusy(false); }
      }}>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Your name</span>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Asha" required maxLength={60} autoComplete="given-name" /></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Shop name (shown to buyers)</span>
          <input className="input" value={f.shop} onChange={(e) => setF({ ...f, shop: e.target.value })} placeholder="Asha's Thrift Closet" required maxLength={60} /></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Where you sell</span>
          <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {[['USD', '🇺🇸 United States · $ USD'], ['INR', '🇮🇳 India · ₹ INR'], ['PHP', '🇵🇭 Philippines · ₱ PHP'], ['IDR', '🇮🇩 Indonesia · Rp IDR'], ['SGD', '🇸🇬 Singapore · S$ SGD'],
              ['MYR', '🇲🇾 Malaysia · RM MYR'], ['THB', '🇹🇭 Thailand · ฿ THB'], ['AED', '🇦🇪 UAE · AED'], ['GBP', '🇬🇧 United Kingdom · £ GBP'], ['EUR', '🇪🇺 Europe · € EUR']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">How buyers pay you</span>
          <textarea className="input" rows={2} value={f.upi} onChange={(e) => setF({ ...f, upi: e.target.value.trimStart() })} required maxLength={300} autoCapitalize="none"
            placeholder={india ? 'UPI ID, e.g. asha@okicici' : 'https://paypal.me/yourshop  — or —  GCash 0917 555 0123 (Maya R.)'} />
          <span className="mt-1 block text-xs text-muted">{india
            ? 'Your UPI ID, any https:// payment link, or bank details'
            : 'A payment link (PayPal.me, Venmo, Cash App, Stripe, Wise…) — the amount is filled in for buyers where supported. No link? Type your account details (GCash, bank transfer, Zelle…) and winners see them at checkout.'}</span></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Your WhatsApp number <span className="font-normal text-muted">(to save your login link)</span></span>
          <input className="input" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 16) })} placeholder={india ? '98765 43210' : '+1 415 555 0123'} autoComplete="tel" /></label>
        {err && <p className="text-sm font-semibold text-hot-dark">{err}</p>}
        <button className="btn w-full bg-hot py-3.5 text-lg text-white" disabled={busy}>{busy ? <Spinner /> : 'Create my shop'}</button>
        <p className="text-center text-xs text-muted">By continuing you agree to our <Link to="/terms" className="underline">terms</Link> and <Link to="/privacy" className="underline">privacy policy</Link>.</p>
      </form>
    </div>
  );
}

function Drops({ seller, onLogout }: { seller: SellerSession; onLogout: () => void }) {
  const nav = useNavigate();
  const [drops, setDrops] = useState<SellerDropSummary[] | null>(null);
  const [again, setAgain] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const [hold, setHold] = useState(5);
  const [startsAt, setStartsAt] = useState(''); // datetime-local (Pro: schedule ahead)
  const [isPro, setIsPro] = useState(false);
  useEffect(() => { api.sellerSession().then((a) => setIsPro(a.pro)).catch(() => {}); }, []);
  const localInput = (ms: number) => { const d = new Date(ms - new Date().getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.sellerDrops().then(setDrops).catch((e) => {
      if (e instanceof ApiError && e.status === 401) { sessions.setSeller(null); onLogout(); }
      else setDrops([]);
    });
  }, [onLogout]);

  return (
    <div className="pt-4">
      <div className="text-sm font-semibold text-muted">Hi {seller.name} 👋</div>
      <h1 className="font-display text-4xl font-extrabold">{seller.shop}</h1>
      <p className="text-sm text-muted">Payments go to <b className="text-ink-2">{seller.upi || seller.payLink || seller.payNote}</b></p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <Link to={`/s/${seller.id}`} className="btn bg-white px-4 py-2 shadow-sm">Your shop page ↗</Link>
        <Link to="/pricing" className="btn bg-white px-4 py-2 shadow-sm">Pricing</Link>
        <button className="btn bg-white px-4 py-2 shadow-sm" onClick={async () => {
          try { const d = await api.practiceDrop(); nav(`/sell/${d.id}`); toast('Practice drop ready — open the buyer view in another tab and try claiming'); }
          catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create practice drop'); }
        }}>🎯 Try a practice drop</button>
      </div>

      <form className="mt-6 rounded-[26px] border border-line bg-card p-5 shadow-[var(--shadow-card)]" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try { const d = await api.createDrop({ title, liveUrl, holdMinutes: hold, startsAt: startsAt ? new Date(startsAt).getTime() : null }); if (d.notified) toast.success(`${d.notified} followers notified`); nav(`/sell/${d.id}`); }
        catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Could not create the drop'); setBusy(false); }
      }}>
        <div className="font-display text-xl font-bold">Start a new drop</div>
        <input className="input mt-3" placeholder="e.g. Sunday thrift drop — 20 pieces" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} />
        <input className="input mt-2" placeholder="YouTube live link (optional)" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} maxLength={300} />
        <label className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
          <span>Schedule it for later <span className="rounded-full bg-sun-soft px-1.5 py-0.5 text-[11px] font-bold text-[#6b4600]">PRO</span><br />
            <span className="text-xs text-muted">{isPro ? 'Your local time. Buyers get a countdown in theirs, plus a calendar invite' : <>Buyers get a countdown and a calendar invite. <Link to="/pricing" className="font-semibold underline">See Pro</Link></>}</span></span>
          <input type="datetime-local" className="rounded-lg border border-line bg-white px-2 py-1.5 text-ink disabled:opacity-50" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
            disabled={!isPro} min={localInput(Date.now() + 6 * 60_000)} max={localInput(Date.now() + 60 * 86_400_000)} aria-label="Scheduled start (optional, Pro)" />
        </label>
        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-ink-2">
          <span>Winner gets this long to pay before the next person in line is promoted</span>
          <select className="rounded-lg border border-line bg-white px-2 py-1.5 font-semibold text-ink" value={hold} onChange={(e) => setHold(Number(e.target.value))}>
            {[2, 3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        {err && <p className="mt-2 text-sm font-semibold text-hot-dark">{err}</p>}
        <button className="btn mt-3 w-full bg-hot-dark py-3 text-white" disabled={busy || !title.trim()}>{busy ? <Spinner /> : startsAt ? 'Schedule drop' : 'Create drop room'}</button>
      </form>

      <div className="mt-8">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Your drops</div>
        {drops === null && <Spinner className="size-6 text-hot" />}
        {drops?.length === 0 && <p className="text-muted">No drops yet.</p>}
        <div className="space-y-2">
          {drops?.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-2xl border border-line bg-card pr-2 hover:border-ink">
              <Link to={`/sell/${d.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{d.title}</div>
                  <div className="text-sm text-muted">{d.items} item{d.items === 1 ? '' : 's'} · {d.sold} sold · {new Date(d.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
                </div>
                <DropChip d={d} />
              </Link>
              {d.status === 'ended' && d.items > d.sold && (
                <button className="btn shrink-0 bg-paper px-3 py-2 text-sm" title="New drop with the unsold items" disabled={again === d.id} onClick={async () => {
                  if (again) return;
                  setAgain(d.id);
                  try { const r = await api.runAgain(d.id); toast.success(`New drop ready with ${r.items} unsold item${r.items === 1 ? '' : 's'}`); nav(`/sell/${r.id}`); }
                  catch (e) { toast.error(e instanceof Error ? e.message : 'Could not start the drop'); setAgain(null); }
                }}>{again === d.id ? <Spinner /> : <RotateCcw className="size-4" />} Run again</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Returning sellers reach their drops first; value, team and invites follow. */}
      <ValueCard />
      <ProTeam shop={seller.shop} onAccount={(a) => { setIsPro(a.pro); if (!a.pro) setStartsAt(''); }} />
      <InviteCard sellerId={seller.id} shop={seller.shop} />
    </div>
  );
}

/** Pro: a free 14-day trial and co-hosts (helpers who confirm payments and drop items from their own phone). */
function ProTeam({ shop, onAccount }: { shop: string; onAccount?: (a: SellerAccount) => void }) {
  const [acct, setAcct] = useState<SellerAccount | null>(null);
  const [team, setTeam] = useState<Cohost[]>([]);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ name: string; link: string } | null>(null);
  const [removing, setRemoving] = useState<Cohost | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [confirming, setConfirming] = useState(false); // a payment came back but its webhook hasn't landed yet
  const [busy, setBusy] = useState(false);
  // ?pro=pay opens checkout straight away (from Pricing). ?pro=return is the way back from Dodo's checkout:
  // read its status, and on success wait for the payment webhook to switch Pro on (usually seconds).
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const mode = sp.get('pro');
    if (!mode) return;
    history.replaceState(null, '', location.pathname);
    if (mode === 'pay') { setPayOpen(true); return; }
    if (mode !== 'return') return;
    const status = (sp.get('status') || '').toLowerCase();
    if (['failed', 'cancelled', 'canceled', 'requires_payment_method'].includes(status)) {
      try { localStorage.removeItem('claimit.checkout'); } catch { /* ignore */ }
      toast.error('The payment didn\'t go through, so nothing was charged. You can try again.');
      setPayOpen(true);
      return;
    }
    const tid = toast.loading(status === 'processing' ? 'Your payment is processing (UPI and bank payments can take a minute)…' : 'Confirming your payment…');
    const ref = sp.get('checkout') || '';
    setConfirming(true);
    // Ask about this checkout's own payment (works on any device, and even if the webhook landed before we got back).
    // Fast polling for a minute, then a slow poll for as long as the page is open.
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = ref ? await api.proCheckout(ref) : null;
        const a = await api.sellerSession();
        const landed = r ? r.arrived : a.pro && a.paidPro;
        if (landed) {
          try { localStorage.removeItem('claimit.checkout'); } catch { /* ignore */ }
          setConfirming(false);
          if (r?.status === 'pending') toast("Payment received. We're confirming the amount and will switch on Pro shortly.", { id: tid });
          else {
            const until = a.proUntil ? new Date(a.proUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
            toast.success(a.paidPro && r && r.days < 30 ? `${r.days} days of Pro added (partial amount). Pro runs until ${until}.` : `Payment confirmed. Pro runs until ${until}.`, { id: tid });
          }
          load();
          return;
        }
      } catch { /* retry */ }
      if (++n === 30) toast('Still confirming your payment. Pro will switch on by itself as soon as it does.', { id: tid });
      t = setTimeout(tick, n < 30 ? 2000 : 15_000);
    };
    t = setTimeout(tick, 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const load = async () => {
    try {
      const a = await api.sellerSession();
      setAcct(a);
      onAccount?.(a);
      if (a.role === 'owner' && a.pro) setTeam(await api.cohosts());
    } catch { /* offline: hide the card */ }
  };
  useEffect(() => { load(); }, []);
  if (!acct) return null;
  const trialDays = acct.referred ? 30 : 14; // invited shops get a month
  if (acct.role === 'cohost') {
    return <div className="mt-6 rounded-2xl bg-sun-soft px-4 py-3 text-sm font-semibold">You're a co-host for {shop}{acct.cohostName ? ` (as ${acct.cohostName})` : ''}: you can run drops and confirm payments.</div>;
  }
  const paySheet = <ProPaySheet open={payOpen} onClose={() => { setPayOpen(false); load(); }} paidBefore={acct.paidPro} />;
  const daysLeft = acct.proUntil ? Math.ceil((acct.proUntil - Date.now()) / 86_400_000) : 0;
  if (!acct.pro) {
    return (
      <>{paySheet}<section className="mt-6 flex flex-wrap items-start gap-3 rounded-[26px] bg-ink p-5 text-white">
        <Crown className="size-8 shrink-0 text-sun" />
        <div className="min-w-[14rem] flex-1">
          <div className="font-display text-xl font-bold">Go live with a co-host</div>
          <p className="text-sm text-white/75">Pro lets a helper confirm payments and drop items from their own phone while you present. {money(acct.proPrice ?? 9, 'USD')}/month, 0% commission. The trial needs no card: after {trialDays} days you're simply back on Free.</p>
          {acct.founding && <span className="mt-2 inline-block rounded-full bg-sun px-2.5 py-1 text-xs font-bold text-ink">Founding seller · 50% off Pro year one</span>}
        </div>
        {acct.trialUsed
          ? <div className="w-full text-sm text-white sm:w-auto sm:max-w-xs"><b className="text-white">Your trial has ended.</b> You're on Free and nothing was lost. Co-hosts are paused until Pro.
              <button className="btn mt-2 w-full bg-sun px-5 py-2.5 text-ink" onClick={() => setPayOpen(true)}>Get Pro · {money(acct.proPrice ?? 9, 'USD')}/month</button></div>
          : <button className="btn w-full shrink-0 self-center bg-sun px-5 py-2.5 text-ink sm:w-auto" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await api.proTrial(); toast.success(`Pro trial started: ${trialDays} days free`); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not start the trial'); } finally { setBusy(false); }
            }}>{busy ? <Spinner /> : `Start ${trialDays}-day free trial`}</button>}
        {confirming && <div className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm">⏳ Confirming your payment. Pro switches on by itself as soon as it's confirmed; no need to pay again.</div>}
        {!acct.trialUsed && <button className="w-full text-center text-sm font-semibold text-white underline sm:w-auto sm:self-center" onClick={() => setPayOpen(true)}>or pay now · {money(acct.proPrice ?? 9, 'USD')}/mo</button>}
      </section></>
    );
  }
  const link = invite ? (invite.link.startsWith('/') ? location.origin + invite.link : invite.link) : '';
  return (
    <section className="mt-6 rounded-[26px] border border-line bg-card p-5 shadow-[var(--shadow-card)]">
      {paySheet}
      {confirming && <div className="mb-3 rounded-2xl bg-sun-soft px-3 py-2 text-sm text-[#6b4600]">⏳ Confirming your payment. Your new days are added by themselves as soon as it's confirmed; no need to pay again.</div>}
      {daysLeft <= 5 && !confirming && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-sun-soft px-3 py-2 text-sm">
          <span className="flex-1"><b>{acct.paidPro ? 'Pro' : 'Your free trial'} ends in {daysLeft} day{daysLeft === 1 ? '' : 's'}.</b> After that you're back on Free: co-hosts pause, nothing is lost.</span>
          <button className="btn bg-ink px-4 py-1.5 text-sm text-white" onClick={() => setPayOpen(true)}>{acct.paidPro ? 'Renew' : 'Keep Pro'}</button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Crown className="size-5 text-[#b07a00]" />
        <div className="font-display text-xl font-bold">Your team</div>
        {acct.founding && <span className="ml-auto rounded-full bg-sun px-2.5 py-1 text-xs font-bold text-ink">Founding</span>}
        <span className={`${acct.founding ? '' : 'ml-auto '}rounded-full bg-sun-soft px-2.5 py-1 text-xs font-bold text-[#6b4600]`}>PRO{acct.proUntil ? ` · until ${new Date(acct.proUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</span>
        {!acct.paidPro && daysLeft > 5 && <button className="text-xs font-semibold text-ink-2 underline" onClick={() => setPayOpen(true)}>Keep Pro after the trial</button>}
      </div>
      <p className="mt-1 text-sm text-muted">Co-hosts use their own login link: they can drop items, confirm payments and ship. They can't change your plan or team.</p>
      <div className="mt-3 text-xs font-bold uppercase tracking-wider text-muted">Co-hosts · {team.length}/5</div>
      <ul className="mt-1.5 space-y-1.5">
        {team.length === 0 && <li className="rounded-xl bg-paper px-3 py-3 text-sm text-muted">No co-hosts yet. Add the friend who usually helps during your lives.</li>}
        {team.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-xl bg-paper py-1 pl-3 pr-1 text-sm">
            <span className="font-semibold">{c.name}</span>
            <button className="grid size-10 place-items-center rounded-full hover:bg-line" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)}><X className="size-4" /></button>
          </li>
        ))}
      </ul>
      <ConfirmSheet open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? ''}?`} tone="ink"
        body="Their login link stops working straight away. You can add them again later." confirmLabel="Remove co-host"
        onConfirm={async () => {
          if (!removing) return;
          try { await api.removeCohost(removing.id); toast.success(`${removing.name} removed`); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove'); }
          load();
        }} />
      <form className="mt-3 flex gap-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { const r = await api.addCohost(name.trim()); setInvite(r); setName(''); load(); } catch (e2) { toast.error(e2 instanceof Error ? e2.message : 'Could not add'); } finally { setBusy(false); }
      }}>
        <input className="input !py-2 text-sm" placeholder="Co-host name, e.g. Riya" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Co-host name" />
        <button className="btn shrink-0 bg-ink px-4 text-sm text-white" disabled={busy || name.trim().length < 2 || team.length >= 5}><UserPlus className="size-4" /> {team.length >= 5 ? 'Team full' : 'Add'}</button>
      </form>
      {invite && (
        <div className="mt-3 rounded-2xl bg-mint-soft p-3 text-sm">
          <div className="font-semibold">Send {invite.name} their private login link:</div>
          <div className="mt-1 break-all font-mono text-xs text-ink-2">{link}</div>
          <div className="mt-2 flex gap-2">
            <CopyButton text={link} label="Copy link" className="!py-1.5" />
            <a className="btn bg-[#075E54] px-4 py-1.5 text-sm text-white" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`You're a co-host for ${shop} on ClaimIt. Open this on your phone (keep it private): ${link}`)}`}>WhatsApp</a>
          </div>
        </div>
      )}
    </section>
  );
}

/** What ClaimIt has been worth to this shop, all-time. Pro unlocks the deeper analytics. */
function ValueCard() {
  const [v, setV] = useState<Insights | null>(null);
  useEffect(() => { api.insights().then(setV).catch(() => {}); }, []);
  if (!v || v.drops === 0) return null;
  const m = (n: number) => money(n, v.currency);
  const paysForPro = !!v.coversPro; // rescued this month, converted to USD, is at least the $9 Pro price
  return (
    <section className="mt-6 rounded-[26px] bg-mint p-5 text-white shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white"><TrendingUp className="size-4" /> What fair drops did for you</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <div><div className="font-display text-3xl font-extrabold">{m(v.rescuedAllTime)}</div><div className="text-sm text-white">rescued from no-shows, all time: sales comment-selling would have lost</div></div>
        <div><div className="font-display text-3xl font-extrabold">{m(v.revenue)}</div><div className="text-sm text-white">sold through {v.drops} drop{v.drops === 1 ? '' : 's'}, 0% commission</div></div>
        <div><div className="font-display text-3xl font-extrabold">{m(v.rescuedThisMonth)}</div><div className="text-sm text-white">rescued in the last 30 days{paysForPro ? ' — more than covers Pro' : ''}</div></div>
      </div>
      {v.pro ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([
            ['No-show rate', v.noShowRate != null ? `${v.noShowRate}%` : '—'],
            ['Repeat buyers', `${v.repeatBuyers ?? 0}/${v.buyers ?? 0}`],
            ['Avg time to pay', v.avgPaySec ? approx(v.avgPaySec) : '—'],
            ['Your avg confirm', v.avgConfirmSec ? approx(v.avgConfirmSec) : '—'],
            ['Best hour to drop', v.bestHourUtc != null ? new Date(Date.UTC(2020, 0, 1, v.bestHourUtc)).toLocaleTimeString(undefined, { hour: 'numeric' }) : '—'],
          ] as const).map(([k, val]) => (
            <div key={k} className="rounded-xl bg-[#075c3c] px-3 py-2"><div className="font-display text-lg font-extrabold">{val}</div><div className="text-xs text-white">{k}</div></div>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#075c3c] px-3 py-2 text-sm"><Lock className="size-4 shrink-0" />
          <span>Pro shows your no-show rate, repeat buyers, time to pay and the best hour to drop. <Link to="/pricing" className="font-semibold underline">See Pro</Link></span></div>
      )}
    </section>
  );
}

/** Seller-to-seller referrals: the channel that matters most for a tool sellers see each other use. */
function InviteCard({ sellerId, shop }: { sellerId: string; shop: string }) {
  const link = `${location.origin}/sell?ref=${sellerId}`;
  const msg = `I run my live drops with ClaimIt: first tap wins, no more "I commented first!" fights, and no-shows go to the next buyer automatically. Free to start: ${link}`;
  return (
    <section className="mt-4 flex flex-col gap-3 rounded-[26px] border border-line bg-card p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
      <div className="flex-1">
        <div className="font-display text-lg font-bold">Know another live seller?</div>
        <p className="text-sm text-muted">They get a 30-day Pro trial. Once they have 3 independent paying customers, {shop} gets a month of Pro free.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <CopyButton text={link} label="Copy invite link" className="!py-2" />
        <a className="btn bg-[#075E54] px-4 py-2 text-sm text-white" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(msg)}`}>WhatsApp</a>
      </div>
    </section>
  );
}

/** Pay for Pro: ClaimIt's own payment link/account plus a reference; the operator confirms and 30 days are added. */
function ProPaySheet({ open, onClose, paidBefore }: { open: boolean; onClose: () => void; paidBefore?: boolean }) {
  const [b, setB] = useState<Awaited<ReturnType<typeof api.proBilling>> | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const loadBilling = () => { setLoadErr(false); api.proBilling().then(setB).catch(() => setLoadErr(true)); };
  useEffect(() => { if (open) loadBilling(); }, [open]);
  const link = b?.link ? payLinkFor(b.link, b.price, 'USD', 'ClaimIt Pro') : null;
  return (
    <Sheet open={open} onClose={onClose} title="Get ClaimIt Pro">
      {loadErr ? (
        <div className="pb-4"><p className="text-ink-2">Couldn't load payment details.</p><button className="btn mt-3 bg-ink px-5 py-2.5 text-white" onClick={loadBilling}>Try again</button></div>
      ) : !b ? <Spinner className="my-6 size-6 text-hot" /> : !b.available ? (
        <p className="pb-4 text-ink-2">Paid Pro opens soon. You'll keep every feature of Free in the meantime.</p>
      ) : b.checkout ? (
        <div className="space-y-3 pb-4">
          <p className="text-ink-2"><b className="text-ink">{money(b.price, 'USD')} for 30 days</b> of Pro. Pro switches on automatically after payment. Renewals add 30 days, and if you don't renew you're simply back on Free.</p>
          {b.testMode && (
            <div className="rounded-xl bg-sun-soft p-3 text-sm text-[#6b4600]">
              <b>Test mode: no real money moves.</b> Pay with card <span className="font-mono">4242 4242 4242 4242</span>, expiry 06/32, CVV 123 (India: <span className="font-mono">4576 2389 1277 1450</span>, or UPI <span className="font-mono">success@upi</span>).
            </div>
          )}
          <a className="btn w-full bg-mint py-3 text-white" href={b.checkout} onClick={() => {
            // Remember where Pro stood, so the return page can tell when this payment's days have landed.
            try { localStorage.setItem('claimit.checkout', JSON.stringify({ until: b.proUntil ?? 0, paidBefore: !!paidBefore, at: Date.now() })); } catch { /* ignore */ }
          }}>Pay {money(b.price, 'USD')} securely ↗</a>
          <p className="text-center text-xs text-muted">Checkout by Dodo Payments. ClaimIt never sees your card.</p>
        </div>
      ) : b.pending ? (
        <div className="pb-4"><p className="font-semibold">Thanks! We're confirming your payment (ref {b.pending.ref}).</p><p className="mt-1 text-sm text-muted">Pro turns on as soon as it's confirmed, usually within a day.</p></div>
      ) : (
        <form className="space-y-3 pb-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { await api.proPay(ref.trim()); toast.success('Sent — we\'ll confirm your payment shortly'); setB(await api.proBilling()); }
          catch (e2) { toast.error(e2 instanceof Error ? e2.message : 'Could not send'); } finally { setBusy(false); }
        }}>
          <p className="text-ink-2"><b className="text-ink">{money(b.price, 'USD')} for 30 days</b> of Pro. Renewals add 30 days on top, and if you don't renew you're simply back on Free.</p>
          {link && <a className="btn w-full bg-mint py-3 text-white" href={link} target="_blank" rel="noreferrer">Pay {money(b.price, 'USD')} ↗</a>}
          {b.note && <div className="rounded-xl bg-paper p-3 text-sm"><div className="text-muted">Or send it to</div><div className="whitespace-pre-line font-semibold">{b.note}</div></div>}
          <label className="block text-sm font-semibold" htmlFor="pro-ref">Then add your payment reference</label>
          <input id="pro-ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} placeholder="Transaction ID or the name you paid from" />
          <button className="btn w-full bg-ink py-3 text-white" disabled={busy || ref.trim().length < 4}>{busy ? <Spinner /> : "I've paid — turn on Pro"}</button>
        </form>
      )}
    </Sheet>
  );
}

/** One status per drop, the same way buyers see it: SOON (scheduled, nothing dropped), STARTING (opened, nothing dropped
 *  yet), LIVE (items are being dropped) or ENDED. Re-renders at the scheduled start so SOON flips on time. */
function DropChip({ d }: { d: SellerDropSummary }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!d.startsAt || d.startsAt <= Date.now()) return;
    const t = setTimeout(() => tick((n) => n + 1), d.startsAt - Date.now() + 500);
    return () => clearTimeout(t);
  }, [d.startsAt]);
  const base = 'whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold';
  if (d.status !== 'live') return <span className={`${base} bg-line text-ink-2`}>ENDED</span>;
  if ((d.dropped ?? 0) > 0) return <span className={`${base} bg-hot-dark text-white`}>LIVE</span>;
  if (d.startsAt && d.startsAt > Date.now()) {
    return <span className={`${base} bg-sun-soft text-[#6b4600]`}>SOON · {new Date(d.startsAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>;
  }
  return <span className={`${base} bg-sun-soft text-[#6b4600]`}>STARTING SOON</span>;
}

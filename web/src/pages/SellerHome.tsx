import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, sessions, type SellerDropSummary, type SellerSession } from '../api';
import { ConfirmSheet, Logo, Spinner } from '../components/ui';
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
  const [f, setF] = useState({ name: '', shop: '', upi: '', phone: '', currency: guessCurrency() });
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
          <a className="btn w-full bg-[#25D366] py-3.5 text-white" target="_blank" rel="noreferrer" onClick={() => setSaved(true)}
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
  const [title, setTitle] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const [hold, setHold] = useState(5);
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
        try { const d = await api.createDrop({ title, liveUrl, holdMinutes: hold }); if (d.notified) toast.success(`${d.notified} followers notified`); nav(`/sell/${d.id}`); }
        catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Could not create the drop'); setBusy(false); }
      }}>
        <div className="font-display text-xl font-bold">Start a new drop</div>
        <input className="input mt-3" placeholder="e.g. Sunday thrift drop — 20 pieces" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} />
        <input className="input mt-2" placeholder="YouTube live link (optional)" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} maxLength={300} />
        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-ink-2">
          <span>Winner gets this long to pay before the next person in line is promoted</span>
          <select className="rounded-lg border border-line bg-white px-2 py-1.5 font-semibold text-ink" value={hold} onChange={(e) => setHold(Number(e.target.value))}>
            {[2, 3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        {err && <p className="mt-2 text-sm font-semibold text-hot-dark">{err}</p>}
        <button className="btn mt-3 w-full bg-hot py-3 text-white" disabled={busy || !title.trim()}>{busy ? <Spinner /> : 'Create drop room'}</button>
      </form>

      <div className="mt-8">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Your drops</div>
        {drops === null && <Spinner className="size-6 text-hot" />}
        {drops?.length === 0 && <p className="text-muted">No drops yet.</p>}
        <div className="space-y-2">
          {drops?.map((d) => (
            <Link key={d.id} to={`/sell/${d.id}`} className="flex items-center justify-between rounded-2xl border border-line bg-card px-4 py-3 hover:border-ink">
              <div className="min-w-0">
                <div className="truncate font-semibold">{d.title}</div>
                <div className="text-sm text-muted">{d.items} items · {d.sold} sold · {new Date(d.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${d.status === 'live' ? 'bg-hot text-white' : 'bg-line text-ink-2'}`}>{d.status === 'live' ? 'LIVE' : 'ENDED'}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

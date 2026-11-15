import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, sessions, type SellerDropSummary, type SellerSession } from '../api';
import { Logo, Spinner } from '../components/ui';

export default function SellerHome() {
  const [seller, setSeller] = useState<SellerSession | null>(() => sessions.seller());
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/"><Logo className="text-xl" /></Link>
        {seller && (
          <button className="text-sm font-semibold text-muted hover:text-ink" onClick={() => {
            if (confirm('Log out of this seller account on this device? Save your drop links first.')) { sessions.setSeller(null); setSeller(null); }
          }}>Log out</button>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        {seller ? <Drops seller={seller} onLogout={() => setSeller(null)} /> : <Onboard onDone={(s) => { sessions.setSeller(s); setSeller(s); }} />}
      </main>
    </div>
  );
}

function Onboard({ onDone }: { onDone: (s: SellerSession) => void }) {
  const [f, setF] = useState({ name: '', shop: '', upi: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="font-display text-4xl font-extrabold leading-tight">Set up your shop</h1>
      <p className="mt-2 text-ink-2">Takes 20 seconds. Buyers pay you directly over UPI — ClaimIt never touches your money.</p>
      <form className="mt-6 space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try { const s = await api.createSeller(f); onDone({ id: s.id, key: s.key, name: s.name, shop: s.shop, upi: s.upi }); }
        catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Something went wrong'); setBusy(false); }
      }}>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Your name</span>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Asha" required maxLength={60} /></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Shop name (shown to buyers)</span>
          <input className="input" value={f.shop} onChange={(e) => setF({ ...f, shop: e.target.value })} placeholder="Asha's Thrift Closet" required maxLength={60} /></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">UPI ID for payments</span>
          <input className="input" value={f.upi} onChange={(e) => setF({ ...f, upi: e.target.value.trim() })} placeholder="asha@okicici" required maxLength={80} autoCapitalize="none" /></label>
        {err && <p className="text-sm font-semibold text-hot-dark">{err}</p>}
        <button className="btn w-full bg-hot py-3.5 text-lg text-white" disabled={busy}>{busy ? <Spinner /> : 'Create my shop'}</button>
      </form>
    </div>
  );
}

function Drops({ seller, onLogout }: { seller: SellerSession; onLogout: () => void }) {
  const nav = useNavigate();
  const [drops, setDrops] = useState<SellerDropSummary[] | null>(null);
  const [title, setTitle] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
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
      <p className="text-sm text-muted">Payments go to <b className="text-ink-2">{seller.upi}</b></p>

      <form className="mt-6 rounded-[26px] border border-line bg-card p-5 shadow-[var(--shadow-card)]" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try { const d = await api.createDrop({ title, liveUrl }); nav(`/sell/${d.id}`); }
        catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Could not create the drop'); setBusy(false); }
      }}>
        <div className="font-display text-xl font-bold">Start a new drop</div>
        <input className="input mt-3" placeholder="e.g. Sunday thrift drop — 20 pieces" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} />
        <input className="input mt-2" placeholder="YouTube live link (optional)" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} maxLength={300} />
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
                <div className="text-sm text-muted">{d.items} items · {d.sold} sold · {new Date(d.created).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${d.status === 'live' ? 'bg-hot text-white' : 'bg-line text-ink-2'}`}>{d.status === 'live' ? 'LIVE' : 'ENDED'}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

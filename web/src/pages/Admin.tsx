import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmSheet, Logo, Spinner, useToasts } from '../components/ui';

// Operator console: confirm Pro payments and review shop reports. Protected by ADMIN_KEY (kept in this tab only).
interface Payment { id: string; sellerId: string; shop: string; amount: number; ref: string; status: string; created: number; proUntil: number | null }
interface Revenue { shops: number; payingShops: number; mrrUsd: number; onTrial: number; trialToPaidPct: number | null; renewingShops: number; churnedShops: number; revenueUsd: number; refundRatePct: number }
interface Report { sellerId: string; shop: string; buyerId: string; reason: string; text: string | null; status: string; created: number }

const REASON: Record<string, string> = { no_item: "Paid, didn't get the item", payment_not_confirmed: 'Paid, never confirmed', scam: 'Asked to pay outside the order', other: 'Other' };
const when = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Admin() {
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem('claimit.admin') || ''; } catch { return ''; } });
  const [draft, setDraft] = useState('');
  const [data, setData] = useState<{ payments: Payment[]; reports: Report[]; revenue?: Revenue } | null>(null);
  const [err, setErr] = useState('');
  const toasts = useToasts();

  const call = useCallback(async (method: string, path: string, body?: unknown) => {
    const res = await fetch(path, { method, headers: { 'x-admin-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    // Surface the server's own reason ("Already decided"...); a 404 on a read means the key is wrong.
    if (!res.ok) throw new Error(res.status === 404 && method === 'GET' ? 'Wrong admin key' : json.message || 'Request failed');
    return json;
  }, [key]);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const [payments, reports, revenue] = await Promise.all([call('GET', '/api/admin/payments'), call('GET', '/api/admin/reports'), call('GET', '/api/admin/revenue')]);
      setData({ payments, reports, revenue }); setErr('');
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); setData(null); }
  }, [key, call]);
  useEffect(() => { load(); }, [load]);

  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; question: string; run: () => Promise<unknown>; ok: string } | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const act = (id: string, question: string, run: () => Promise<unknown>, ok: string, label = '') => { if (!busy) { setBusyLabel(label); setPending({ id, question, run, ok }); } };
  const confirmPending = async () => {
    if (!pending) return;
    const p = pending;
    setPending(null); setBusy(p.id);
    try { await p.run(); toasts.push(p.ok, 'mint'); load(); } catch (e) { toasts.push(e instanceof Error ? e.message : 'Failed', 'hot'); } finally { setBusy(null); }
  };
  const badge = (st: string) => (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${st === 'confirmed' || st === 'upheld' ? 'bg-mint text-white' : st === 'pending' || st === 'open' ? 'bg-sun-soft text-[#6b4600]' : 'bg-line text-ink-2'}`}>{st}</span>
  );

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4"><Link to="/"><Logo className="text-xl" /></Link><span className="text-sm font-semibold text-muted">Operator</span></header>
      <main className="mx-auto max-w-4xl px-4 pb-16">
        {!key || err ? (
          <form className="mx-auto mt-10 max-w-sm space-y-2" onSubmit={(e) => { e.preventDefault(); try { sessionStorage.setItem('claimit.admin', draft); } catch { /* ignore */ } setKey(draft); }}>
            <h1 className="font-display text-3xl font-extrabold">Operator sign-in</h1>
            {err && <p className="text-sm font-semibold text-hot-dark" role="alert">{err}</p>}
            <label className="block text-sm font-semibold" htmlFor="admin-key">Admin key</label>
            <input id="admin-key" className="input" type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
            <button className="btn w-full bg-ink py-3 text-white" disabled={draft.length < 8}>Open</button>
          </form>
        ) : !data ? <Spinner className="mt-10 size-8 text-hot" /> : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <h1 className="flex-1 font-display text-4xl font-extrabold">Operator</h1>
              <button className="btn bg-white px-4 py-2 text-sm shadow-sm" onClick={() => load()}>Refresh</button>
              <button className="btn bg-white px-4 py-2 text-sm shadow-sm" onClick={() => { try { sessionStorage.removeItem('claimit.admin'); } catch { /* ignore */ } setKey(''); setDraft(''); setData(null); }}>Sign out</button>
            </div>
            {data.revenue && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ['MRR', `$${data.revenue.mrrUsd.toFixed(2)}`, `${data.revenue.payingShops} paying shop${data.revenue.payingShops === 1 ? '' : 's'}`],
                  ['On trial', String(data.revenue.onTrial), `trial → paid ${data.revenue.trialToPaidPct ?? '—'}${data.revenue.trialToPaidPct != null ? '%' : ''}`],
                  ['Renewing', String(data.revenue.renewingShops), `${data.revenue.churnedShops} lapsed after paying`],
                  ['Collected', `$${data.revenue.revenueUsd.toFixed(2)}`, `refunds/disputes ${data.revenue.refundRatePct}%`],
                ] as const).map(([k, v, sub]) => (
                  <div key={k} className="rounded-2xl border border-line bg-card p-3 shadow-[var(--shadow-card)]">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted">{k}</div>
                    <div className="font-display text-2xl font-extrabold">{v}</div>
                    <div className="text-xs text-muted">{sub}</div>
                  </div>
                ))}
              </div>
            )}
            <h2 className="mt-6 font-display text-2xl font-extrabold">Pro payments</h2>
            <p className="text-sm text-muted">Dodo Payments confirm themselves through the webhook and appear here as confirmed. Only manual payments (payment link + reference) wait for you: check the reference, then confirm (adds 30 days; renewals stack).</p>
            <ul className="mt-3 space-y-2">
              {data.payments.length === 0 && <li className="text-sm text-muted">No payments yet.</li>}
              {data.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card p-3">
                  <div className="min-w-0 flex-1"><div className="font-semibold">{p.shop} · ${p.amount}</div><div className="text-sm text-muted">ref {p.ref} · {when(p.created)}</div></div>
                  {p.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button className="btn bg-mint px-4 py-2 text-sm text-white" disabled={!!busy} onClick={() => act(p.id, `Confirm ${p.shop}'s payment (ref ${p.ref})? This adds 30 days of Pro.`, () => call('POST', `/api/admin/payments/${p.id}/decide`, { confirm: true }), `${p.shop}: Pro extended`, 'Confirm')}>{busy === p.id && busyLabel === 'Confirm' ? <Spinner /> : 'Confirm'}</button>
                      <button className="btn bg-paper px-4 py-2 text-sm" disabled={!!busy} onClick={() => act(p.id, `Reject ${p.shop}'s payment (ref ${p.ref})?`, () => call('POST', `/api/admin/payments/${p.id}/decide`, { confirm: false }), 'Rejected', 'Reject')}>{busy === p.id && busyLabel === 'Reject' ? <Spinner /> : 'Reject'}</button>
                    </div>
                  ) : badge(p.status)}
                </li>
              ))}
            </ul>

            <h2 className="mt-10 font-display text-2xl font-extrabold">Shop reports</h2>
            <p className="text-sm text-muted">Only buyers with a confirmed order (or a rejected payment backed by a reference) can report. Upheld reports show on the shop's trust line; open ones show as "under review".</p>
            <ul className="mt-3 space-y-2">
              {data.reports.length === 0 && <li className="text-sm text-muted">No reports.</li>}
              {data.reports.map((r) => (
                <li key={`${r.sellerId}-${r.buyerId}`} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card p-3">
                  <div className="min-w-0 flex-1"><div className="font-semibold">{r.shop} · {REASON[r.reason] ?? r.reason}</div>{r.text && <div className="text-sm text-ink-2">{r.text}</div>}<div className="text-xs text-muted">{when(r.created)}</div></div>
                  {r.status === 'open' ? (
                    <div className="flex gap-2">
                      <button className="btn bg-hot-dark px-4 py-2 text-sm text-white" disabled={!!busy} onClick={() => act(`${r.sellerId}-${r.buyerId}`, `Uphold this report? It will show on ${r.shop}'s trust line.`, () => call('POST', '/api/admin/reports/resolve', { sellerId: r.sellerId, buyerId: r.buyerId, status: 'upheld' }), 'Upheld', 'Uphold')}>{busy === `${r.sellerId}-${r.buyerId}` && busyLabel === 'Uphold' ? <Spinner /> : 'Uphold'}</button>
                      <button className="btn bg-paper px-4 py-2 text-sm" disabled={!!busy} onClick={() => act(`${r.sellerId}-${r.buyerId}`, 'Dismiss this report? It will no longer count against the shop.', () => call('POST', '/api/admin/reports/resolve', { sellerId: r.sellerId, buyerId: r.buyerId, status: 'dismissed' }), 'Dismissed', 'Dismiss')}>{busy === `${r.sellerId}-${r.buyerId}` && busyLabel === 'Dismiss' ? <Spinner /> : 'Dismiss'}</button>
                    </div>
                  ) : badge(r.status)}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      <ConfirmSheet open={!!pending} onClose={() => setPending(null)} title="Are you sure?" tone="ink"
        body={pending?.question ?? ''} confirmLabel="Yes, do it" onConfirm={confirmPending} />
    </div>
  );
}

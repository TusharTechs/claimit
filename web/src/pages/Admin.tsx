import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo, Spinner, useToasts } from '../components/ui';

// Operator console: confirm Pro payments and review shop reports. Protected by ADMIN_KEY (kept in this tab only).
interface Payment { id: string; sellerId: string; shop: string; amount: number; ref: string; status: string; created: number; proUntil: number | null }
interface Report { sellerId: string; shop: string; buyerId: string; reason: string; text: string | null; status: string; created: number }

const REASON: Record<string, string> = { no_item: "Paid, didn't get the item", payment_not_confirmed: 'Paid, never confirmed', scam: 'Asked to pay outside the order', other: 'Other' };
const when = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Admin() {
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem('claimit.admin') || ''; } catch { return ''; } });
  const [draft, setDraft] = useState('');
  const [data, setData] = useState<{ payments: Payment[]; reports: Report[] } | null>(null);
  const [err, setErr] = useState('');
  const toasts = useToasts();

  const call = useCallback(async (method: string, path: string, body?: unknown) => {
    const res = await fetch(path, { method, headers: { 'x-admin-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(res.status === 404 ? 'Wrong admin key' : 'Request failed');
    return res.json();
  }, [key]);

  const load = useCallback(async () => {
    if (!key) return;
    try { setData({ payments: await call('GET', '/api/admin/payments'), reports: await call('GET', '/api/admin/reports') }); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); setData(null); }
  }, [key, call]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toasts.push(ok, 'mint'); load(); } catch (e) { toasts.push(e instanceof Error ? e.message : 'Failed', 'hot'); } };

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
            <h2 className="mt-4 font-display text-2xl font-extrabold">Pro payments</h2>
            <p className="text-sm text-muted">Check the reference against ClaimIt's payment account, then confirm (adds 30 days, renewals stack).</p>
            <ul className="mt-3 space-y-2">
              {data.payments.length === 0 && <li className="text-sm text-muted">No payments yet.</li>}
              {data.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card p-3">
                  <div className="min-w-0 flex-1"><div className="font-semibold">{p.shop} · ${p.amount}</div><div className="text-sm text-muted">ref {p.ref} · {when(p.created)}</div></div>
                  {p.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button className="btn bg-mint px-4 py-2 text-sm text-white" onClick={() => act(() => call('POST', `/api/admin/payments/${p.id}/decide`, { confirm: true }), `${p.shop}: Pro extended`)}>Confirm</button>
                      <button className="btn bg-paper px-4 py-2 text-sm" onClick={() => act(() => call('POST', `/api/admin/payments/${p.id}/decide`, { confirm: false }), 'Rejected')}>Reject</button>
                    </div>
                  ) : <span className="rounded-full bg-line px-2.5 py-1 text-xs font-bold uppercase">{p.status}</span>}
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
                      <button className="btn bg-hot-dark px-4 py-2 text-sm text-white" onClick={() => act(() => call('POST', '/api/admin/reports/resolve', { sellerId: r.sellerId, buyerId: r.buyerId, status: 'upheld' }), 'Upheld')}>Uphold</button>
                      <button className="btn bg-paper px-4 py-2 text-sm" onClick={() => act(() => call('POST', '/api/admin/reports/resolve', { sellerId: r.sellerId, buyerId: r.buyerId, status: 'dismissed' }), 'Dismissed')}>Dismiss</button>
                    </div>
                  ) : <span className="rounded-full bg-line px-2.5 py-1 text-xs font-bold uppercase">{r.status}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

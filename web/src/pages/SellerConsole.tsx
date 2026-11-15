import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, sessions, type SellerClaim, type SellerDrop } from '../api';
import { rt, type RtMessage } from '../rt';
import { Avatar, CopyButton, Logo, QR, Spinner, StatusChip, Toasts, useToasts } from '../components/ui';
import { DMThread } from '../components/DMThread';
import { mmss, resizeImage, rupees, useCountdown, useDebounced } from '../util';
import { MSG, type ChatContent, type EventContent, type Item } from '../../../shared/types';

type Tab = 'pay' | 'room' | 'inbox';

export default function SellerConsole() {
  const { dropId = '' } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<SellerDrop | null>(null);
  const [tab, setTab] = useState<Tab>('pay');
  const [feed, setFeed] = useState<{ id: string; text: string; who?: string; kind: string }[]>([]);
  const [viewers, setViewers] = useState<number | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [inboxPeer, setInboxPeer] = useState<string | null>(null);
  const toasts = useToasts();
  const seller = sessions.seller();

  const load = useCallback(async () => {
    try {
      const d = await api.sellerDrop(dropId);
      setData(d);
      if (typeof d.drop.inRoom === 'number' && d.drop.inRoom > 0) setViewers(d.drop.inRoom);
    }
    catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 404)) nav('/sell'); }
  }, [dropId, nav]);
  const refresh = useDebounced(load, 200);

  useEffect(() => { if (!seller) nav('/sell'); else load(); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const channelId = data?.drop.channelId;
  const peerRef = useRef(inboxPeer);
  peerRef.current = inboxPeer;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Seller connects to Nexconn too: watches the room and receives buyers' DMs.
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.sellerSession();
        await rt.connect(s.token, s.userId);
        if (cancelled) return;
        const r = await rt.enterOpen(channelId);
        setViewers(r.count);
      } catch (e) { toasts.push(e instanceof Error ? e.message : 'Realtime connection failed', 'hot'); }
    })();
    const offMeta = rt.onMetadata((cid) => cid === channelId && refresh());
    const offCount = rt.onParticipants((cid, n) => cid === channelId && setViewers(n));
    const offMsg = rt.onMessage((m: RtMessage) => {
      if (m.kind === 'open' && m.channelId === channelId) {
        if (m.type === MSG.CHAT) { const c = m.content as ChatContent; setFeed((f) => [...f.slice(-120), { id: m.id, text: c.text, who: c.name, kind: 'chat' }]); }
        else if (m.type === MSG.EVENT) { const ev = m.content as EventContent; setFeed((f) => [...f.slice(-120), { id: m.id, text: ev.text, kind: ev.kind }]); refresh(); }
      } else if (m.kind === 'direct' && !m.mine) {
        if (!(tabRef.current === 'inbox' && peerRef.current === m.channelId)) setUnread((u) => ({ ...u, [m.channelId]: (u[m.channelId] || 0) + 1 }));
        if (m.type === MSG.ORDER_UPDATE) toasts.push('💸 A buyer says they paid', 'mint');
        refresh();
      }
    });
    return () => { cancelled = true; offMeta(); offCount(); offMsg(); rt.exitOpen(channelId).catch(() => {}); };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const claimsByItem = useMemo(() => {
    const m = new Map<string, SellerClaim[]>();
    for (const c of data?.claims ?? []) { if (!m.has(c.itemId)) m.set(c.itemId, []); m.get(c.itemId)!.push(c); }
    for (const l of m.values()) l.sort((a, b) => a.seq - b.seq);
    return m;
  }, [data?.claims]);

  const buyers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of data?.claims ?? []) if (!seen.has(c.buyerId)) seen.set(c.buyerId, c.buyerName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [data?.claims]);

  if (!data) return <div className="grid min-h-full place-items-center"><Spinner className="size-8 text-hot" /></div>;

  const { drop, items, stats } = data;
  const link = `${location.origin}/d/${drop.id}`;
  const toConfirm = data.claims.filter((c) => c.status === 'paying' || c.status === 'holding');
  const ended = drop.status === 'ended';
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toasts.push(ok, 'mint'); load(); }
    catch (e) { toasts.push(e instanceof Error ? e.message : 'Failed', 'hot'); }
  };

  return (
    <div className="min-h-full">
      <Toasts items={toasts.items} />
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/sell"><Logo className="text-lg" /></Link>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-lg font-bold leading-tight">{drop.title}</div>
            <div className="truncate text-xs text-muted">{drop.shop}</div>
          </div>
          {ended ? <span className="rounded-full bg-line px-2.5 py-1 text-xs font-bold">ENDED</span> : (
            <span className="flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white"><span className="anim-live size-1.5 rounded-full bg-hot" />LIVE{viewers ? ` · ${viewers} in room` : ''}</span>
          )}
          <a href={link} target="_blank" rel="noreferrer" className="btn hidden border-2 border-ink px-3 py-1.5 text-sm sm:inline-flex">Open buyer view ↗</a>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 lg:grid-cols-[1fr_400px]">
        <div className="space-y-5">
          {/* Share + stats */}
          <section className="grid gap-4 rounded-[26px] border border-line bg-card p-4 shadow-[var(--shadow-card)] sm:grid-cols-[auto_1fr]">
            <QR value={link} size={128} className="mx-auto" />
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-muted">Share this link in your story / group</div>
              <div className="mt-1 truncate rounded-xl bg-paper px-3 py-2 font-mono text-sm">{link}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyButton text={link} label="Copy link" />
                <a className="btn bg-[#25D366] px-4 py-2 text-sm text-white" target="_blank" rel="noreferrer"
                  href={`https://wa.me/?text=${encodeURIComponent(`🔥 ${drop.shop} is dropping LIVE now — first tap wins! ${link}`)}`}>WhatsApp</a>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[['Joined', stats.viewers], ['Claim taps', stats.claimAttempts], ['Sold', stats.sold], ['Revenue', rupees(stats.revenue)]].map(([k, v]) => (
                  <div key={k as string} className="rounded-xl bg-paper px-1 py-2">
                    <div className="font-display text-lg font-extrabold leading-none">{v}</div>
                    <div className="mt-1 text-[11px] text-muted">{k}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {!ended && <AddItem dropId={drop.id} onAdded={load} toast={toasts.push} />}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-muted">Items ({items.length})</div>
              {!ended && (
                <button className="text-sm font-semibold text-muted hover:text-hot-dark" onClick={() => {
                  if (confirm('End this drop? Buyers will no longer be able to claim.')) act(() => api.endDrop(drop.id), 'Drop ended');
                }}>End drop</button>
              )}
            </div>
            <div className="space-y-2.5">
              {items.length === 0 && <p className="rounded-2xl border-2 border-dashed border-line p-6 text-center text-muted">Add your first item above, then hit <b>Drop now</b> when you show it on your live.</p>}
              {[...items].sort((a, b) => sortKey(a) - sortKey(b) || a.idx - b.idx).map((it) => (
                <ItemRow key={it.id} it={it} claims={claimsByItem.get(it.id) ?? []} ended={ended}
                  onDrop={() => act(() => api.dropItem(drop.id, it.id), `Dropped ${it.name}!`)}
                  onClose={() => act(() => api.closeItem(drop.id, it.id))}
                  onDelete={() => act(() => api.deleteItem(drop.id, it.id))}
                  onConfirm={(c) => act(() => api.confirm(c.id), `Sold to ${c.buyerName} ✓`)}
                  onReject={(c) => act(() => api.reject(c.id), 'Moved to next in line')} />
              ))}
            </div>
          </section>
        </div>

        {/* Right panel */}
        <aside className="lg:sticky lg:top-[76px] lg:h-[calc(100dvh-96px)]">
          <div className="flex h-full min-h-[420px] flex-col rounded-[26px] border border-line bg-card p-3 shadow-[var(--shadow-card)]">
            <div className="flex gap-1 rounded-full bg-paper p-1">
              {([['pay', `Payments${toConfirm.length ? ` (${toConfirm.length})` : ''}`], ['room', 'Room'], ['inbox', `Inbox${totalUnread ? ` (${totalUnread})` : ''}`]] as [Tab, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-full py-2 text-sm font-semibold ${tab === k ? 'bg-ink text-white' : 'text-ink-2'}`}>{l}</button>
              ))}
            </div>
            <div className="mt-3 flex min-h-0 flex-1 flex-col">
              {tab === 'pay' && (
                <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {toConfirm.length === 0 && <p className="py-8 text-center text-sm text-muted">When a buyer claims and pays, confirm it here.</p>}
                  {toConfirm.map((c) => {
                    const it = items.find((i) => i.id === c.itemId)!;
                    return <PayRow key={c.id} c={c} it={it} onConfirm={() => act(() => api.confirm(c.id), `Sold to ${c.buyerName} ✓`)}
                      onReject={() => act(() => api.reject(c.id), 'Moved to next in line')}
                      onChat={() => { setInboxPeer(c.buyerId); setTab('inbox'); setUnread((u) => ({ ...u, [c.buyerId]: 0 })); }} />;
                  })}
                </div>
              )}
              {tab === 'room' && (
                <div className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                  {feed.length === 0 && <p className="py-8 text-center text-sm text-muted">Live chat and claims from the room appear here.</p>}
                  {feed.map((f) => f.kind === 'chat'
                    ? <div key={f.id} className="text-[14px]"><b>{f.who}</b> <span className="text-ink-2">{f.text}</span></div>
                    : <div key={f.id} className={`w-fit rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${f.kind === 'sold' ? 'bg-mint-soft text-mint' : 'bg-hot-soft text-hot-dark'}`}>{f.text}</div>)}
                </div>
              )}
              {tab === 'inbox' && (
                inboxPeer ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <button className="mb-1 flex items-center gap-2 text-left text-sm font-semibold" onClick={() => setInboxPeer(null)}>
                      ← <Avatar id={inboxPeer} name={buyers.find((b) => b.id === inboxPeer)?.name ?? '?'} size={24} /> {buyers.find((b) => b.id === inboxPeer)?.name}
                    </button>
                    <DMThread peerId={inboxPeer} peerName={buyers.find((b) => b.id === inboxPeer)?.name ?? 'buyer'} />
                  </div>
                ) : (
                  <div className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto">
                    {buyers.length === 0 && <p className="py-8 text-center text-sm text-muted">Order chats with buyers show up here.</p>}
                    {buyers.map((b) => (
                      <button key={b.id} onClick={() => { setInboxPeer(b.id); setUnread((u) => ({ ...u, [b.id]: 0 })); }}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-paper">
                        <Avatar id={b.id} name={b.name} size={32} />
                        <span className="flex-1 font-semibold">{b.name}</span>
                        {unread[b.id] ? <span className="grid size-5 place-items-center rounded-full bg-hot text-[11px] font-bold text-white">{unread[b.id]}</span> : null}
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

const sortKey = (it: Item) => ({ held: 0, paying: 0, live: 1, draft: 2, sold: 3, closed: 4 }[it.status] ?? 5);

function AddItem({ dropId, onAdded, toast }: { dropId: string; onAdded: () => void; toast: (t: string, tone?: 'hot' | 'mint' | 'ink') => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-[26px] border border-line bg-card p-4 shadow-[var(--shadow-card)]" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try {
        await api.addItem(dropId, { name, price: Number(price), image });
        setName(''); setPrice(''); setImage(null); if (fileRef.current) fileRef.current.value = '';
        onAdded();
      } catch (e2) { toast(e2 instanceof Error ? e2.message : 'Could not add', 'hot'); } finally { setBusy(false); }
    }}>
      <button type="button" onClick={() => fileRef.current?.click()} className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-paper text-xs font-semibold text-muted">
        {image ? <img src={image} alt="" className="size-full object-cover" /> : <span>+ Photo</span>}
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) { try { setImage(await resizeImage(f)); } catch (err) { toast(err instanceof Error ? err.message : 'Bad image', 'hot'); } }
      }} />
      <div className="min-w-40 flex-1">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Add item</span>
        <input className="input" placeholder="Item name, size" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </div>
      <div className="w-28">
        <input className="input" placeholder="₹ Price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} required />
      </div>
      <button className="btn bg-ink px-5 py-3 text-white" disabled={busy || !name.trim() || !price}>{busy ? <Spinner /> : 'Add'}</button>
    </form>
  );
}

function ItemRow({ it, claims, ended, onDrop, onClose, onDelete, onConfirm, onReject }: {
  it: Item; claims: SellerClaim[]; ended: boolean; onDrop: () => void; onClose: () => void; onDelete: () => void;
  onConfirm: (c: SellerClaim) => void; onReject: (c: SellerClaim) => void;
}) {
  const holder = claims.find((c) => c.status === 'holding' || c.status === 'paying');
  const waiting = claims.filter((c) => c.status === 'waiting');
  const winner = claims.find((c) => c.status === 'paid');
  const left = useCountdown(holder?.status === 'holding' ? holder.holdUntil : null);
  return (
    <div className={`rounded-2xl border bg-card p-3 ${it.status === 'live' ? 'border-hot' : 'border-line'}`}>
      <div className="flex items-center gap-3">
        <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-line">{it.image && <img src={it.image} alt="" className="size-full object-cover" />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="text-xs font-bold text-muted">#{it.idx}</span><StatusChip status={it.status} /></div>
          <div className="truncate font-semibold">{it.name}</div>
          <div className="text-sm text-ink-2">{rupees(it.price)}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {(it.status === 'draft' || it.status === 'closed') && !ended && <button className="btn anim-ring bg-hot px-4 py-2 text-sm text-white" onClick={onDrop}>Drop now</button>}
          {it.status === 'draft' && <button className="text-xs font-semibold text-muted hover:text-hot-dark" onClick={onDelete}>Delete</button>}
          {it.status === 'live' && <button className="text-xs font-semibold text-muted hover:text-ink" onClick={onClose}>Close</button>}
        </div>
      </div>
      {holder && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-sun-soft px-3 py-2 text-sm">
          <Avatar id={holder.buyerId} name={holder.buyerName} size={22} />
          <span className="font-semibold">{holder.buyerName}</span>
          <span className="text-[#6b4600]">{holder.status === 'paying' ? `says paid${holder.utr ? ` · UTR ${holder.utr}` : ''}` : `holding · ${mmss(left)}`}</span>
          <span className="flex-1" />
          <button className="btn bg-mint px-3 py-1.5 text-xs text-white" onClick={() => onConfirm(holder)}>Payment received</button>
          <button className="btn bg-white px-3 py-1.5 text-xs" onClick={() => onReject(holder)}>Next in line</button>
        </div>
      )}
      {waiting.length > 0 && <div className="mt-2 text-xs text-muted">Waitlist: {waiting.map((w) => w.buyerName).join(' → ')}</div>}
      {winner && <div className="mt-2 text-sm font-semibold text-mint">Sold to {winner.buyerName}</div>}
    </div>
  );
}

function PayRow({ c, it, onConfirm, onReject, onChat }: { c: SellerClaim; it: Item; onConfirm: () => void; onReject: () => void; onChat: () => void }) {
  const left = useCountdown(c.status === 'holding' ? c.holdUntil : null);
  return (
    <div className={`rounded-2xl border p-3 ${c.status === 'paying' ? 'border-mint bg-mint-soft/40' : 'border-line'}`}>
      <div className="flex items-center gap-2">
        <Avatar id={c.buyerId} name={c.buyerName} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{c.buyerName} · {it?.name}</div>
          <div className="text-xs text-ink-2">{rupees(it?.price ?? 0)} · {c.status === 'paying' ? `says paid${c.utr ? ` (UTR ${c.utr})` : ''}` : `waiting for payment · ${mmss(left)}`}</div>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button className="btn flex-1 bg-mint py-2 text-sm text-white" onClick={onConfirm}>Payment received</button>
        <button className="btn bg-paper px-3 py-2 text-sm" onClick={onReject}>Next</button>
        <button className="btn bg-paper px-3 py-2 text-sm" onClick={onChat}>Chat</button>
      </div>
    </div>
  );
}

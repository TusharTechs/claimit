import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, sessions, type BuyerSession } from '../api';
import { rt, type RtMessage } from '../rt';
import { Avatar, Logo, QR, Sheet, Spinner, Toasts, useToasts } from '../components/ui';
import { DMThread } from '../components/DMThread';
import { embedUrl, mmss, rupees, upiLink, useCountdown, useDebounced } from '../util';
import {
  MSG, itemKey,
  type ChatContent, type DropCardContent, type DropState, type EventContent, type Item, type ItemState, type MyClaim, type PublicDrop,
} from '../../../shared/types';

type FeedEntry =
  | { id: string; kind: 'chat'; name: string; sender: string; text: string; mine: boolean }
  | { id: string; kind: 'event'; ev: EventContent }
  | { id: string; kind: 'drop'; card: DropCardContent };

export default function Room() {
  const { dropId = '' } = useParams();
  const [drop, setDrop] = useState<PublicDrop | null>(null);
  const [state, setState] = useState<Record<string, ItemState>>({});
  const [dropState, setDropState] = useState<DropState | null>(null);
  const [error, setError] = useState('');
  const [me, setMe] = useState<BuyerSession | null>(() => sessions.buyer());
  const [connected, setConnected] = useState(false);
  const [viewers, setViewers] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [claims, setClaims] = useState<MyClaim[]>([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const toasts = useToasts();
  const meRef = useRef(me);
  meRef.current = me;

  const loadDrop = useCallback(async () => {
    try {
      const d = await api.drop(dropId);
      setDrop(d);
      if (typeof d.inRoom === 'number' && d.inRoom > 0) setViewers(d.inRoom);
      setState((cur) => {
        const next = { ...cur };
        for (const [k, v] of Object.entries(d.state)) if (!next[k] || next[k].v <= v.v) next[k] = v;
        return next;
      });
      setDropState((cur) => cur ?? d.drop);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'This drop link is not valid.' : 'Could not load the drop. Check your connection.');
    }
  }, [dropId]);

  const loadClaims = useCallback(async () => {
    if (!meRef.current) return;
    try { setClaims(await api.myClaims(dropId)); } catch { /* ignore */ }
  }, [dropId]);
  const refreshClaims = useDebounced(loadClaims, 250);
  const refreshDrop = useDebounced(loadDrop, 400);

  useEffect(() => { loadDrop(); }, [loadDrop]);
  useEffect(() => {
    const open = () => setOrdersOpen(true);
    document.addEventListener('claimit:orders', open);
    return () => document.removeEventListener('claimit:orders', open);
  }, []);

  // Connect to Nexconn and enter the live room once we know who the buyer is.
  useEffect(() => {
    if (!me || !drop) return;
    let cancelled = false;
    (async () => {
      try {
        const sess = await api.buyerSession().catch(async (e) => {
          if (e instanceof ApiError && e.status === 401) { sessions.setBuyer(null); setMe(null); throw e; }
          throw e;
        });
        await rt.connect(sess.token, sess.id);
        if (cancelled) return;
        const { count, metadata } = await rt.enterOpen(drop.channelId);
        setViewers(count);
        applyMeta(metadata);
        setConnected(true);
        api.join(dropId).catch(() => {});
        loadClaims();
      } catch (e) {
        if (!cancelled) toasts.push(e instanceof Error ? e.message : 'Could not connect to the live room', 'hot');
      }
    })();
    return () => { cancelled = true; rt.exitOpen(drop.channelId).catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, drop?.channelId]);

  const applyMeta = (entries: Record<string, string | null>) => {
    setState((cur) => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(entries)) {
        if (!k.startsWith('i_') || !v) continue;
        try {
          const s = JSON.parse(v) as ItemState;
          if (!next[s.id] || next[s.id].v <= s.v) next[s.id] = s;
        } catch { /* ignore */ }
      }
      return next;
    });
    if (entries.drop) { try { setDropState(JSON.parse(entries.drop)); } catch { /* ignore */ } }
  };

  // Live events from Nexconn.
  useEffect(() => {
    if (!drop) return;
    const offMeta = rt.onMetadata((channelId, changes) => {
      if (channelId !== drop.channelId) return;
      const entries: Record<string, string | null> = {};
      for (const c of changes) entries[c.key] = c.value;
      applyMeta(entries);
      if (Object.keys(entries).some((k) => k.startsWith('i_') && !drop.items.some((i) => itemKey(i.id) === k))) refreshDrop();
      refreshClaims();
    });
    const offCount = rt.onParticipants((channelId, n) => channelId === drop.channelId && setViewers(n));
    const offMsg = rt.onMessage((m: RtMessage) => {
      if (m.kind === 'open' && m.channelId === drop.channelId) {
        if (m.type === MSG.CHAT) {
          const c = m.content as ChatContent;
          pushFeed({ id: m.id, kind: 'chat', name: c.name, sender: m.sender, text: c.text, mine: m.sender === meRef.current?.id });
        } else if (m.type === MSG.EVENT) {
          const ev = m.content as EventContent;
          pushFeed({ id: m.id, kind: 'event', ev });
          if (ev.kind === 'ended') refreshDrop();
        } else if (m.type === MSG.DROP) {
          const card = m.content as DropCardContent;
          pushFeed({ id: m.id, kind: 'drop', card });
          setSelected(null);
          toasts.push(`New drop: ${card.name}`, 'hot');
          if ('vibrate' in navigator) navigator.vibrate?.(60);
          refreshDrop();
        }
      } else if (m.kind === 'direct' && m.channelId === drop.sellerId) {
        refreshClaims();
        if (m.type === MSG.ORDER && !m.mine) {
          toasts.push(`🎉 You got ${m.content.itemName}! Pay to keep it.`, 'mint');
          setOrdersOpen(true);
        }
      }
    });
    const poll = setInterval(loadDrop, 15000);
    return () => { offMeta(); offCount(); offMsg(); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop?.channelId]);

  const pushFeed = (e: FeedEntry) => setFeed((f) => (f.some((x) => x.id === e.id) ? f : [...f.slice(-80), e]));

  const items = drop?.items ?? [];
  const currentId = selected ?? dropState?.current ?? items[items.length - 1]?.id ?? null;
  const current = items.find((i) => i.id === currentId) ?? null;
  const activeClaims = claims.filter((c) => c.status === 'holding' || c.status === 'paying' || c.status === 'waiting');
  const ended = (dropState?.status ?? drop?.status) === 'ended';

  if (error) return <Centered><p className="text-lg">{error}</p><Link to="/" className="btn mt-4 bg-ink px-5 py-2.5 text-white">Go home</Link></Centered>;
  if (!drop) return <Centered><Spinner className="size-8 text-hot" /></Centered>;

  const embed = embedUrl(drop.liveUrl);

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col bg-paper">
      <Toasts items={toasts.items} />

      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-extrabold leading-tight">{drop.shop}</div>
          <div className="truncate text-xs text-muted">{drop.title}</div>
        </div>
        {ended ? (
          <span className="rounded-full bg-line px-2.5 py-1 text-xs font-bold text-ink-2">ENDED</span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white">
            <span className={`size-1.5 rounded-full ${connected ? 'anim-live bg-hot' : 'bg-white/40'}`} />
            LIVE{viewers ? ` · ${viewers}` : ''}
          </span>
        )}
        {me && (
          <button onClick={() => setOrdersOpen(true)} className="relative btn bg-white px-3 py-1.5 text-sm shadow-sm">
            My orders
            {activeClaims.length > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-hot text-[11px] text-white">{activeClaims.length}</span>}
          </button>
        )}
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {embed && (
          <div className="mx-4 mb-3 overflow-hidden rounded-2xl bg-ink">
            <iframe src={embed} title="Live video" className="aspect-video w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          </div>
        )}

        {/* Now dropping */}
        <div className="px-4">
          {current ? (
            <ItemHero key={current.id} item={current} st={state[current.id]} me={me} claims={claims} ended={ended} dropId={dropId}
              isLatest={current.id === (dropState?.current ?? items[items.length - 1]?.id)}
              onClaimed={(c) => { setClaims((x) => [c, ...x.filter((y) => y.id !== c.id)]); if (c.position === 0) setOrdersOpen(true); }}
              onNeedJoin={() => setMe(null)} toast={toasts.push} />
          ) : (
            <div className="grid aspect-[4/3] place-items-center rounded-[26px] border-2 border-dashed border-line bg-card text-center">
              <div>
                <div className="font-display text-2xl font-bold">Drop starts soon</div>
                <p className="mt-1 text-muted">Stay here — items appear the moment {drop.shop} drops them.</p>
              </div>
            </div>
          )}
        </div>

        {/* Earlier items */}
        {items.length > 1 && (
          <div className="mt-4">
            <div className="px-4 pb-2 text-xs font-bold uppercase tracking-wider text-muted">All drops</div>
            <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-4 pb-1">
              {[...items].reverse().map((it) => {
                const st = state[it.id];
                const active = it.id === currentId;
                return (
                  <button key={it.id} onClick={() => setSelected(it.id)}
                    className={`relative w-24 shrink-0 overflow-hidden rounded-2xl border-2 bg-card text-left ${active ? 'border-ink' : 'border-transparent'}`}>
                    <div className="aspect-square bg-line">{it.image && <img src={it.image} alt="" className="size-full object-cover" />}</div>
                    <div className="px-2 py-1.5">
                      <div className="truncate text-[12px] font-semibold">{it.name}</div>
                      <div className="text-[11px] text-muted">{rupees(it.price)}</div>
                    </div>
                    {st?.status === 'sold' && <div className="absolute inset-0 grid place-items-center bg-white/60 font-display text-lg font-extrabold text-mint">SOLD</div>}
                    {(st?.status === 'held' || st?.status === 'paying') && <div className="absolute left-1.5 top-1.5 rounded-full bg-sun px-1.5 text-[10px] font-bold">HELD</div>}
                    {st?.status === 'live' && <div className="absolute left-1.5 top-1.5 rounded-full bg-hot px-1.5 text-[10px] font-bold text-white">OPEN</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Feed */}
        <Feed feed={feed} />
      </div>

      {me ? (
        <ChatInput disabled={!connected || ended} onSend={async (text) => {
          const sent = await rt.sendOpen(drop.channelId, MSG.CHAT, { text, name: me.name });
          if (sent) pushFeed({ id: sent.id, kind: 'chat', name: me.name, sender: me.id, text, mine: true });
        }} />
      ) : null}

      {!me && <JoinGate shop={drop.shop} onJoined={(b) => { sessions.setBuyer(b); setMe(b); }} />}

      <Sheet open={ordersOpen} onClose={() => setOrdersOpen(false)} title="My orders">
        <Orders claims={claims} sellerId={drop.sellerId} shop={drop.shop} onChange={loadClaims} toast={toasts.push} />
      </Sheet>
    </div>
  );
}

// ---------- pieces ----------

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-full place-items-center p-6 text-center"><div className="flex flex-col items-center">{children}</div></div>;
}

function ItemHero({ item, st, me, claims, ended, dropId, isLatest, onClaimed, onNeedJoin, toast }: {
  item: Item; st?: ItemState; me: BuyerSession | null; claims: MyClaim[]; ended: boolean; dropId: string; isLatest: boolean;
  onClaimed: (c: MyClaim) => void; onNeedJoin: () => void; toast: (t: string, tone?: 'hot' | 'mint' | 'ink') => void;
}) {
  const [busy, setBusy] = useState(false);
  const status = st?.status ?? item.status;
  const holder = st?.holder;
  const left = useCountdown(st?.holdUntil);
  const mine = claims.find((c) => c.itemId === item.id && ['holding', 'paying', 'waiting', 'paid'].includes(c.status));
  const myPos = mine?.status === 'waiting' ? (st?.waitlist.findIndex((w) => w.id === me?.id) ?? -1) + 1 || mine.position : 0;
  const waitCount = st?.waitlist.length ?? 0;

  const doClaim = async () => {
    if (!me) return onNeedJoin();
    setBusy(true);
    try {
      const c = await api.claim(dropId, item.id);
      onClaimed(c);
      if ('vibrate' in navigator) navigator.vibrate?.(c.position === 0 ? [40, 40, 80] : 40);
      toast(c.position === 0 ? `It's yours for ${mmss((c.holdUntil ?? Date.now()) - Date.now())} — pay to keep it!` : `You're #${c.position} in line`, c.position === 0 ? 'mint' : 'ink');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not claim', 'hot');
    } finally { setBusy(false); }
  };

  let cta: React.ReactNode;
  if (ended && status !== 'sold') cta = <Cta tone="muted" disabled>Drop ended</Cta>;
  else if (status === 'sold') cta = <Cta tone={mine?.status === 'paid' ? 'mint' : 'muted'} disabled>{mine?.status === 'paid' ? 'Yours! 🎉' : `Sold to ${holder?.name ?? 'someone'}`}</Cta>;
  else if (status === 'closed') cta = <Cta tone="muted" disabled>No longer available</Cta>;
  else if (mine?.status === 'holding') cta = <Cta tone="mint" onClick={() => document.dispatchEvent(new CustomEvent('claimit:orders'))}>You've got it — pay now · {mmss(left)}</Cta>;
  else if (mine?.status === 'paying') cta = <Cta tone="mint" disabled>Paid · seller confirming</Cta>;
  else if (mine?.status === 'waiting') cta = <Cta tone="sun" disabled>You're #{myPos} in line</Cta>;
  else if (status === 'live') cta = <Cta tone="hot" ring onClick={doClaim} busy={busy}>CLAIM · {rupees(item.price)}</Cta>;
  else if (waitCount >= 5) cta = <Cta tone="muted" disabled>Waitlist full</Cta>;
  else cta = <Cta tone="ink" onClick={doClaim} busy={busy}>Join waitlist (#{waitCount + 1})</Cta>;

  return (
    <div className="anim-pop overflow-hidden rounded-[26px] border border-line bg-card shadow-[var(--shadow-card)]">
      <div className="relative aspect-[4/3] bg-line">
        {item.image ? <img src={item.image} alt={item.name} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-muted">No photo</div>}
        <div className="absolute left-3 top-3 rounded-full bg-ink/85 px-2.5 py-1 text-xs font-bold text-white">#{item.idx}{isLatest && !ended ? ' · JUST DROPPED' : ''}</div>
        {status === 'sold' && <div className="anim-stamp absolute right-4 top-4 rounded-xl border-4 border-mint bg-white/95 px-3 py-1 font-display text-2xl font-extrabold text-mint">SOLD</div>}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="font-display text-2xl font-bold leading-tight">{item.name}</div>
          <div className="font-display text-2xl font-extrabold">{rupees(item.price)}</div>
        </div>

        {(holder || waitCount > 0) && status !== 'sold' && (
          <div className="anim-rise mt-3 rounded-2xl bg-sun-soft p-3 text-sm">
            {holder && (
              <div className="flex items-center gap-2 font-semibold text-[#6b4600]">
                <Avatar id={holder.id} name={holder.name} size={22} />
                <span className="min-w-0 flex-1 truncate">{holder.id === me?.id ? (status === 'paying' ? 'You paid · confirming' : "You're holding it") : `${holder.name} ${status === 'paying' ? 'paid · confirming' : 'is holding it'}`}</span>
                {status === 'held' && <span className="tabular-nums">{mmss(left)}</span>}
              </div>
            )}
            {waitCount > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-[#6b4600]">
                <span className="text-xs font-bold uppercase tracking-wide">Next:</span>
                <div className="flex -space-x-1.5">{st!.waitlist.slice(0, 5).map((w) => <span key={w.id} className="rounded-full ring-2 ring-sun-soft"><Avatar id={w.id} name={w.name} size={22} /></span>)}</div>
                <span className="text-xs">{st!.waitlist.map((w) => (w.id === me?.id ? 'you' : w.name.split(' ')[0])).join(', ')}</span>
              </div>
            )}
          </div>
        )}
        <div className="mt-4">{cta}</div>
        {st && st.claims > 1 && status !== 'live' && <div className="mt-2 text-center text-xs text-muted">{st.claims} people tapped Claim on this</div>}
      </div>
    </div>
  );
}

function Cta({ children, tone, onClick, disabled, busy, ring }: {
  children: React.ReactNode; tone: 'hot' | 'ink' | 'mint' | 'sun' | 'muted'; onClick?: () => void; disabled?: boolean; busy?: boolean; ring?: boolean;
}) {
  const cls = {
    hot: 'bg-hot text-white shadow-[var(--shadow-pop)]', ink: 'bg-ink text-white', mint: 'bg-mint text-white',
    sun: 'bg-sun text-ink', muted: 'bg-line text-ink-2',
  }[tone];
  return (
    <button onClick={onClick} disabled={disabled || busy}
      className={`btn w-full py-4 font-display text-xl tracking-tight ${cls} ${ring && !busy ? 'anim-ring' : ''} disabled:!opacity-100`}>
      {busy ? <Spinner /> : children}
    </button>
  );
}

function Feed({ feed }: { feed: FeedEntry[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [feed.length]);
  return (
    <div className="space-y-1.5 px-4 pb-3 pt-4">
      {feed.length === 0 && <div className="py-4 text-center text-sm text-muted">Say hi 👋 Claims and chat show up here live.</div>}
      {feed.map((f) => {
        if (f.kind === 'event') {
          const tone = f.ev.kind === 'sold' ? 'bg-mint-soft text-mint' : f.ev.kind === 'claimed' || f.ev.kind === 'promoted' ? 'bg-hot-soft text-hot-dark' : 'bg-line/60 text-ink-2';
          return <div key={f.id} className={`anim-rise mx-auto w-fit max-w-full rounded-full px-3 py-1 text-center text-[13px] font-semibold ${tone}`}>{f.ev.text}</div>;
        }
        if (f.kind === 'drop') {
          return <div key={f.id} className="anim-rise mx-auto w-fit rounded-full bg-ink px-3 py-1 text-[13px] font-semibold text-white">🔥 Dropped #{f.card.idx}: {f.card.name} · {rupees(f.card.price)}</div>;
        }
        return (
          <div key={f.id} className="anim-rise flex items-start gap-2">
            <Avatar id={f.sender} name={f.name} size={24} />
            <div className="min-w-0 text-[15px] leading-snug"><span className="font-semibold">{f.mine ? 'You' : f.name}</span> <span className="text-ink-2">{f.text}</span></div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function ChatInput({ onSend, disabled }: { onSend: (t: string) => Promise<void>; disabled: boolean }) {
  const [text, setText] = useState('');
  return (
    <form className="flex gap-2 border-t border-line bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5"
      onSubmit={async (e) => { e.preventDefault(); const t = text.trim(); if (!t) return; setText(''); await onSend(t).catch(() => {}); }}>
      <input className="input !rounded-full !py-2.5" placeholder={disabled ? 'Connecting…' : 'Ask about size, colour…'} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} disabled={disabled} />
      <button className="btn bg-ink px-4 text-white" disabled={disabled || !text.trim()} aria-label="Send">
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9z" /></svg>
      </button>
    </form>
  );
}

function JoinGate({ shop, onJoined }: { shop: string; onJoined: (b: BuyerSession) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center">
      <form className="anim-sheet w-full max-w-lg rounded-t-[28px] bg-paper p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-[28px]"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr('');
          try { const b = await api.createBuyer(name); onJoined({ id: b.id, key: b.key, name: b.name }); }
          catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Could not join'); setBusy(false); }
        }}>
        <Logo className="text-lg" />
        <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight">You're in {shop}'s live drop</h2>
        <p className="mt-2 text-ink-2">First tap wins. Everyone sees the queue, so it's fair. What should we call you?</p>
        <input className="input mt-5" autoFocus placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
        {err && <p className="mt-2 text-sm font-semibold text-hot-dark">{err}</p>}
        <button className="btn mt-4 w-full bg-hot py-4 font-display text-xl text-white" disabled={busy || name.trim().length < 2}>
          {busy ? <Spinner /> : 'Join the drop'}
        </button>
        <p className="mt-3 text-center text-xs text-muted">No app, no password. Your name is shown when you claim.</p>
      </form>
    </div>
  );
}

function Orders({ claims, sellerId, shop, onChange, toast }: {
  claims: MyClaim[]; sellerId: string; shop: string; onChange: () => void; toast: (t: string, tone?: 'hot' | 'mint' | 'ink') => void;
}) {
  const visible = useMemo(() => claims.filter((c) => c.status !== 'cancelled' || c.position === 0), [claims]);
  return (
    <div className="space-y-3">
      {visible.length === 0 && <p className="py-4 text-center text-muted">Nothing yet. Tap Claim on an item to grab it.</p>}
      {visible.map((c) => <OrderCard key={c.id} c={c} onChange={onChange} toast={toast} />)}
      <div className="rounded-2xl border border-line bg-card p-3">
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Chat with {shop}</div>
        <DMThread peerId={sellerId} peerName={shop} compact />
      </div>
    </div>
  );
}

function OrderCard({ c, onChange, toast }: { c: MyClaim; onChange: () => void; toast: (t: string, tone?: 'hot' | 'mint' | 'ink') => void }) {
  const left = useCountdown(c.status === 'holding' ? c.holdUntil : null);
  const [utr, setUtr] = useState('');
  const [ship, setShip] = useState({ phone: '', address: '', pincode: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c.status !== 'holding') return;
    api.shipping().then((s) => setShip((cur) => ({ phone: cur.phone || s.phone || '', address: cur.address || s.address || '', pincode: cur.pincode || s.pincode || '' }))).catch(() => {});
  }, [c.status]);
  const shipOk = /^[6-9]\d{9}$/.test(ship.phone.replace(/\D/g, '').slice(-10)) && ship.address.trim().length >= 10 && /^[1-9]\d{5}$/.test(ship.pincode);
  const link = upiLink(c.upi, c.shop, c.price, `ClaimIt ${c.itemName}`);
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);
  const label: Record<string, [string, string]> = {
    holding: ['Pay to keep it', 'text-mint'], paying: ['Seller is confirming', 'text-[#8a5a00]'], waiting: [`#${c.position} in line`, 'text-[#8a5a00]'],
    paid: ['Paid ✓', 'text-mint'], expired: ['Hold expired', 'text-muted'], cancelled: ['Released', 'text-muted'], rejected: ['Payment not confirmed', 'text-hot-dark'],
  };
  const [text, cls] = label[c.status] || [c.status, ''];
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok, 'mint'); onChange(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'hot'); } finally { setBusy(false); }
  };
  return (
    <div className={`rounded-2xl border bg-card p-3 ${c.status === 'holding' ? 'border-mint shadow-[0_0_0_3px_rgb(20_160_106/0.15)]' : 'border-line'}`}>
      <div className="flex items-center gap-3">
        <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-line">{c.image && <img src={c.image} alt="" className="size-full object-cover" />}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.itemName}</div>
          <div className="text-sm text-ink-2">{rupees(c.price)}</div>
          <div className={`text-sm font-bold ${cls}`}>{text}</div>
        </div>
        {c.status === 'holding' && <div className="text-right"><div className="font-display text-2xl font-extrabold tabular-nums text-mint">{mmss(left)}</div><div className="text-[11px] text-muted">left to pay</div></div>}
      </div>
      {c.status === 'holding' && (
        <div className="mt-3 space-y-2">
          <a href={link} className="btn w-full bg-mint py-3 text-white">Pay {rupees(c.price)} with UPI</a>
          {!isMobile && (
            <div className="flex items-center gap-3 rounded-xl bg-paper p-2">
              <QR value={link} size={96} />
              <p className="text-sm text-ink-2">Scan with any UPI app to pay <b>{c.upi}</b></p>
            </div>
          )}
          <div className="space-y-2 rounded-xl bg-paper p-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-muted">Deliver to</div>
            <input className="input !py-2 text-sm" type="tel" inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile number" value={ship.phone}
              onChange={(e) => setShip({ ...ship, phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 14) })} />
            <textarea className="input !py-2 text-sm" rows={2} autoComplete="street-address" placeholder="House / street / area / city" value={ship.address}
              onChange={(e) => setShip({ ...ship, address: e.target.value.slice(0, 300) })} />
            <input className="input !py-2 text-sm" inputMode="numeric" autoComplete="postal-code" placeholder="PIN code" value={ship.pincode}
              onChange={(e) => setShip({ ...ship, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
          </div>
          <div className="flex gap-2">
            <input className="input !py-2 text-sm" placeholder="UPI ref / UTR (optional)" value={utr} onChange={(e) => setUtr(e.target.value)} maxLength={40} />
            <button className="btn shrink-0 bg-ink px-4 text-sm text-white" disabled={busy || !shipOk}
              onClick={() => act(() => api.markPaid(c.id, { utr, ...ship }), 'Sent to seller for confirmation')}>I've paid</button>
          </div>
          {!shipOk && <p className="text-center text-xs text-muted">Add your phone, address and PIN so the seller can ship.</p>}
          <button className="w-full py-1 text-center text-sm font-semibold text-muted underline-offset-2 hover:underline" disabled={busy}
            onClick={() => act(() => api.release(c.id), 'Released to the next person')}>Let it go</button>
        </div>
      )}
      {c.status === 'waiting' && (
        <button className="mt-2 w-full py-1 text-center text-sm font-semibold text-muted hover:underline" disabled={busy}
          onClick={() => act(() => api.release(c.id), 'Left the waitlist')}>Leave waitlist</button>
      )}
    </div>
  );
}

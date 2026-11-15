import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, Lock, MessageCircle, Share2, ShoppingBag, Truck, WifiOff } from 'lucide-react';
import { api, ApiError, sessions, type BuyerSession, type Shipping } from '../api';
import { rt, type RtMessage } from '../rt';
import { Avatar, ConfirmSheet, ItemThumb, Logo, LogoMark, QR, Sheet, Spinner, celebrate, useToasts } from '../components/ui';
import { DMThread } from '../components/DMThread';
import { ensureBuyer, shopIdOf } from '../buyer';
import { embedUrl, mmss, money, rupees, setCurrency, upiLink, useCountdown, useDebounced } from '../util';
import {
  MSG, itemKey,
  type ChatContent, type DropCardContent, type DropState, type EventContent, type Item, type ItemState, type MyClaim, type PublicDrop,
} from '../../../shared/types';

type FeedEntry =
  | { id: string; kind: 'chat'; sender: string; text: string; fallbackName: string }
  | { id: string; kind: 'event'; ev: EventContent }
  | { id: string; kind: 'drop'; card: DropCardContent };

type People = Record<string, { name: string; seller?: boolean }>;

type Toast = (t: string, tone?: 'hot' | 'mint' | 'ink') => void;

const involves = (s: ItemState | undefined, id: string | undefined) =>
  !!s && !!id && (s.holder?.id === id || s.waitlist.some((w) => w.id === id));

/** Hide phone numbers and UPI IDs in buyer chat: the #1 scam is "pay me directly at …". */
const PAY_SCAM = /([\w.\-]{2,}@[a-z][\w-]*(?:\.[\w-]+)*)|((?:paypal\.me|venmo\.com|cash\.app|wa\.me|gcash\.me)\/\S+)|(\$[A-Za-z][\w]{2,})|(\+?\d[\d\s().-]{7,}\d)/gi;
const scrub = (t: string) => t.replace(PAY_SCAM, '•••');

export default function Room() {
  const { dropId = '' } = useParams();
  const [drop, setDrop] = useState<PublicDrop | null>(null);
  const [state, setState] = useState<Record<string, ItemState>>({});
  const [dropState, setDropState] = useState<DropState | null>(null);
  const [error, setError] = useState('');
  const [me, setMe] = useState<BuyerSession | null>(() => sessions.buyer());
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(true);
  const [viewers, setViewers] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [people, setPeople] = useState<People>({});
  const [claims, setClaims] = useState<MyClaim[]>([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [nameFor, setNameFor] = useState<string | null>(null); // item waiting for the buyer's name before claiming
  const [yourTurn, setYourTurn] = useState<string | null>(null);
  const toasts = useToasts();
  const meRef = useRef(me);
  meRef.current = me;
  const stateRef = useRef(state);
  stateRef.current = state;
  const claimedHere = useRef(new Set<string>()); // items this tab just won (skip duplicate celebrations)

  const loadDrop = useCallback(async () => {
    try {
      const d = await api.drop(dropId);
      setCurrency(d.currency);
      setDrop(d);
      if (typeof d.inRoom === 'number' && d.inRoom > 0) setViewers(d.inRoom);
      setState((cur) => {
        const next = { ...cur };
        for (const [k, v] of Object.entries(d.state)) if (!next[k] || next[k].v <= v.v) next[k] = v;
        return next;
      });
      setDropState((cur) => (cur && cur.status === 'ended' ? cur : d.drop));
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

  // Everyone with the link watches immediately as a guest; a name is asked only when they first tap Claim.
  useEffect(() => {
    if (me || !drop) return;
    ensureBuyer().then(setMe).catch(() => setError('Could not join the drop. Check your connection.'));
  }, [me, drop]);

  // Connect to Nexconn and enter the live room.
  useEffect(() => {
    if (!me || !drop) return;
    let cancelled = false;
    (async () => {
      try {
        const sess = await api.buyerSession().catch((e) => {
          if (e instanceof ApiError && e.status === 401) { sessions.setBuyer(null); setMe(null); }
          throw e;
        });
        await rt.connect(sess.token, sess.id);
        if (cancelled) return;
        const { count, metadata } = await rt.enterOpen(drop.channelId);
        setViewers(count);
        applyMeta(metadata);
        setConnected(true);
        api.join(dropId, new URLSearchParams(location.search).get('r')).catch(() => {});
        loadClaims();
      } catch (e) {
        if (!cancelled && !(e instanceof ApiError && e.status === 401)) toasts.push(e instanceof Error ? e.message : 'Could not connect to the live room', 'hot');
      }
    })();
    return () => { cancelled = true; rt.exitOpen(drop.channelId).catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, drop?.channelId]);

  useEffect(() => rt.onStatus(setOnline), []);

  const applyMeta = (entries: Record<string, string | null>) => {
    let mineChanged = false;
    const myId = meRef.current?.id;
    setState((cur) => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(entries)) {
        if (!k.startsWith('i_') || !v) continue;
        try {
          const s = JSON.parse(v) as ItemState;
          if (!next[s.id] || next[s.id].v <= s.v) {
            if (involves(next[s.id], myId) !== involves(s, myId) || (s.holder?.id === myId) !== (next[s.id]?.holder?.id === myId)) mineChanged = true;
            next[s.id] = s;
          }
        } catch { /* ignore */ }
      }
      return next;
    });
    if (entries.drop) { try { setDropState(JSON.parse(entries.drop)); } catch { /* ignore */ } }
    // Only fetch my claims when my own position changed — every viewer refetching on every change would undo Nexconn's fan-out.
    if (mineChanged) refreshClaims();
  };

  // Resolve sender names server-side (cannot be spoofed by message content).
  const wanted = useRef(new Set<string>());
  const resolvePeople = useDebounced(async () => {
    const ids = [...wanted.current];
    wanted.current.clear();
    if (!ids.length) return;
    try { const r = await api.people(dropId, ids); setPeople((p) => ({ ...p, ...r })); } catch { /* ignore */ }
  }, 300);

  // Live events from Nexconn.
  useEffect(() => {
    if (!drop) return;
    const offMeta = rt.onMetadata((channelId, changes) => {
      if (channelId !== drop.channelId) return;
      const entries: Record<string, string | null> = {};
      for (const c of changes) entries[c.key] = c.value;
      applyMeta(entries);
      if (Object.keys(entries).some((k) => k.startsWith('i_') && !drop.items.some((i) => itemKey(i.id) === k))) refreshDrop();
    });
    const offCount = rt.onParticipants((channelId, n) => channelId === drop.channelId && setViewers(n));
    const offMsg = rt.onMessage((m: RtMessage) => {
      if (m.kind === 'open' && m.channelId === drop.channelId) {
        if (m.type === MSG.CHAT) {
          const c = m.content as ChatContent;
          wanted.current.add(m.sender); resolvePeople();
          pushFeed({ id: m.id, kind: 'chat', sender: m.sender, text: c.text, fallbackName: c.name });
        } else if ((m.type === MSG.EVENT || m.type === MSG.DROP) && m.sender !== drop.sellerId) {
          return; // only the shop (our server) may post drops and claim events — ignore anything else
        } else if (m.type === MSG.EVENT) {
          const ev = m.content as EventContent;
          pushFeed({ id: m.id, kind: 'event', ev });
          if (ev.kind === 'ended') refreshDrop();
        } else if (m.type === MSG.DROP) {
          const card = m.content as DropCardContent;
          pushFeed({ id: m.id, kind: 'drop', card });
          setSelected(null);
          toasts.push(`🔥 Just dropped: ${card.name}`, 'hot');
          navigator.vibrate?.(60);
          refreshDrop();
        }
      } else if (m.kind === 'direct' && m.channelId === drop.sellerId) {
        refreshClaims();
        if (m.type === MSG.ORDER && !m.mine) {
          const itemId = m.content.itemId as string;
          if (claimedHere.current.has(itemId)) return; // this tab already celebrated the win
          // Promoted from the waitlist.
          setYourTurn(m.content.itemName);
          celebrate();
          navigator.vibrate?.([40, 40, 120]);
          setTimeout(() => { setYourTurn(null); setOrdersOpen(true); }, 1800);
        }
      }
    });
    const poll = setInterval(loadDrop, 30000 + Math.random() * 10000); // safety net only; Nexconn delivers the live state
    return () => { offMeta(); offCount(); offMsg(); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop?.channelId]);

  const pushFeed = (e: FeedEntry) => setFeed((f) => (f.some((x) => x.id === e.id) ? f : [...f.slice(-80), e]));

  const items = drop?.items ?? [];
  const latestId = dropState?.current ?? items[items.length - 1]?.id ?? null;
  const currentId = selected ?? latestId;
  const current = items.find((i) => i.id === currentId) ?? null;
  const activeClaims = claims.filter((c) => c.status === 'holding' || c.status === 'paying' || c.status === 'waiting');
  const ended = (dropState?.status ?? drop?.status) === 'ended';

  const doClaim = async (item: Item) => {
    if (!me) return;
    if (me.isGuest) { setNameFor(item.id); return; }
    claimedHere.current.add(item.id); // the order DM can arrive before this response — don't treat it as a promotion
    setTimeout(() => claimedHere.current.delete(item.id), 20_000);
    try {
      const before = stateRef.current[item.id];
      const c = await api.claim(dropId, item.id);
      setClaims((x) => [c, ...x.filter((y) => y.id !== c.id)]);
      if (c.position === 0) {
        celebrate();
        navigator.vibrate?.([40, 40, 120]);
        setTimeout(() => setOrdersOpen(true), 900);
      } else {
        claimedHere.current.delete(item.id);
        navigator.vibrate?.(40);
        const winner = stateRef.current[item.id]?.holder?.name ?? before?.holder?.name;
        toasts.push(winner ? `${winner} got it first — you're #${c.position} in line` : `You're #${c.position} in line`);
      }
    } catch (e) {
      claimedHere.current.delete(item.id);
      if (e instanceof ApiError && e.code === 'NEED_NAME') setNameFor(item.id);
      else toasts.push(e instanceof Error ? e.message : 'Could not claim', 'hot');
    }
  };

  const share = async () => {
    if (!drop) return;
    const url = `${location.origin}/d/${drop.id}${me ? `?r=${me.id}` : ''}`; // attribution: who brought whom
    const text = `🔴 ${drop.shop} is dropping LIVE — first tap wins, everyone sees the queue.`;
    try {
      if (navigator.share) await navigator.share({ title: drop.shop, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toasts.push('Link copied — paste it in your group'); }
    } catch { /* cancelled */ }
  };

  if (error) return <Centered><p className="text-lg">{error}</p><Link to="/" className="btn mt-4 bg-ink px-5 py-2.5 text-white">Go home</Link></Centered>;
  if (!drop) return <RoomSkeleton />;

  const embed = embedUrl(drop.liveUrl);
  const curState = current ? state[current.id] : undefined;
  const myClaim = current ? claims.find((c) => c.itemId === current.id && ['holding', 'paying', 'waiting', 'paid'].includes(c.status)) : undefined;
  const sold = items.filter((i) => (state[i.id]?.status ?? i.status) === 'sold').length;

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col bg-paper">
      {/* Top bar */}
      <header className="flex items-center gap-2.5 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <Link to={`/s/${shopIdOf(drop.sellerId)}`} className="line-clamp-1 font-display text-lg font-extrabold leading-tight hover:underline" title={`${drop.shop} — see shop`}>{drop.shop}</Link>
          <div className="line-clamp-1 text-xs text-muted" title={drop.title}>{drop.title}</div>
        </div>
        {ended ? (
          <span className="rounded-full bg-line px-2.5 py-1 text-xs font-bold text-ink-2">ENDED</span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white" aria-live="polite">
            <span className={`size-1.5 rounded-full ${connected && online ? 'anim-live bg-hot' : 'bg-white/40'}`} />
            LIVE{viewers && viewers >= 3 ? ` · ${viewers} watching` : ''}
          </span>
        )}
        <button onClick={share} className="grid size-10 shrink-0 place-items-center rounded-full bg-white shadow-sm" aria-label="Share this drop">
          <Share2 className="size-[18px]" />
        </button>
        <button onClick={() => setOrdersOpen(true)} className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white shadow-sm" aria-label={`My orders${activeClaims.length ? `, ${activeClaims.length} active` : ''}`}>
          <ShoppingBag className="size-[18px]" />
          {activeClaims.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-hot text-[11px] font-bold text-white">{activeClaims.length}</span>}
        </button>
      </header>

      {drop.demo && (
        <div className="mx-4 mb-2 rounded-2xl bg-plum px-3 py-2 text-center text-sm font-semibold text-white">
          🤖 Live demo — the other buyers are bots. Tap Claim fast to beat them!
        </div>
      )}

      <AnimatePresence>
        {connected && !online && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="flex items-center justify-center gap-2 bg-sun px-4 py-1.5 text-sm font-semibold text-ink" role="status">
              <WifiOff className="size-4" /> Reconnecting… your place in line is safe
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {embed && (
          <div className="mx-4 mb-3 overflow-hidden rounded-2xl bg-ink">
            <iframe src={embed} title="Live video" className="aspect-video w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          </div>
        )}

        <div className="px-4">
          {current ? (
            <ItemHero key={current.id} item={current} st={curState} me={me} compact={!!embed}
              isLatest={current.id === latestId && !ended} holdSeconds={drop.holdSeconds} />
          ) : ended ? null : (
            <div className="grid aspect-[4/3] place-items-center rounded-[26px] border-2 border-dashed border-line bg-card px-6 text-center">
              <div>
                <LogoMark className="mx-auto size-12" />
                <div className="mt-3 font-display text-2xl font-bold">The drop starts soon</div>
                <p className="mt-1 text-muted">Stay on this page — items appear the moment {drop.shop} drops them. Turn your sound on 🔔</p>
              </div>
            </div>
          )}
        </div>

        {ended && <EndedCard shop={drop.shop} shopId={shopIdOf(drop.sellerId)} sold={sold} total={items.length} toast={toasts.push} />}

        {items.length > 1 && (
          <div className="mt-4">
            <div className="px-4 pb-2 text-xs font-bold uppercase tracking-wider text-muted">All drops · {sold}/{items.length} sold</div>
            <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-4 pb-1">
              {[...items].reverse().map((it) => {
                const st = state[it.id];
                const active = it.id === currentId;
                return (
                  <button key={it.id} onClick={() => setSelected(it.id)} aria-pressed={active}
                    className={`relative w-28 shrink-0 overflow-hidden rounded-2xl border-2 bg-card text-left transition ${active ? 'border-ink' : 'border-transparent'}`}>
                    <div className="aspect-square bg-line"><ItemThumb name={it.name} image={it.image} /></div>
                    <div className="px-2 py-1.5">
                      <div className="line-clamp-2 text-[12px] font-semibold leading-tight">{it.name}</div>
                      <div className="text-[11px] text-muted">{rupees(it.price)}</div>
                    </div>
                    {st?.status === 'sold' && <div className="absolute inset-0 grid place-items-center bg-white/55 font-display text-lg font-extrabold text-mint">SOLD</div>}
                    {(st?.status === 'held' || st?.status === 'paying') && <div className="absolute left-1.5 top-1.5 rounded-full bg-sun px-1.5 text-[10px] font-bold">HELD</div>}
                    {st?.status === 'live' && <div className="absolute left-1.5 top-1.5 rounded-full bg-hot px-1.5 text-[10px] font-bold text-white">OPEN</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Feed feed={feed} people={people} meId={me?.id} sellerId={drop.sellerId} />
      </div>

      {/* Pinned action area: claim bar + chat. Always in thumb reach, never pushed below the fold. */}
      <div className="border-t border-line bg-paper/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur">
        {current && !ended && (
          <ClaimBar item={current} st={curState} myClaim={myClaim} me={me} disabled={!connected}
            onClaim={() => doClaim(current)} onPay={() => setOrdersOpen(true)} />
        )}
        <ChatInput disabled={!connected || ended || !me} ended={ended} onSend={async (text) => {
          if (!me) return;
          const sent = await rt.sendOpen(drop.channelId, MSG.CHAT, { text, name: me.name });
          if (sent) pushFeed({ id: sent.id, kind: 'chat', sender: me.id, text, fallbackName: me.name });
        }} />
      </div>

      <Sheet open={ordersOpen} onClose={() => setOrdersOpen(false)} title="My orders">
        <Orders claims={claims} sellerId={drop.sellerId} shop={drop.shop} buyerName={me?.name ?? ''} onChange={loadClaims} toast={toasts.push} />
      </Sheet>

      <NameSheet open={!!nameFor} shop={drop.shop} onClose={() => setNameFor(null)} onDone={async (name) => {
        const r = await api.renameBuyer(name);
        const s = { ...(me as BuyerSession), name: r.name, isGuest: false };
        sessions.setBuyer(s); setMe(s);
        const item = items.find((i) => i.id === nameFor);
        setNameFor(null);
        if (item) { meRef.current = s; setTimeout(() => doClaimAs(item), 0); }
      }} />

      <AnimatePresence>
        {yourTurn && (
          <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-mint/95 px-8 text-center text-white" role="alert"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ scale: 0.6, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
              <div className="mx-auto grid size-20 place-items-center rounded-full bg-white text-mint"><Check className="size-11" strokeWidth={3} /></div>
              <div className="mt-5 font-display text-5xl font-extrabold leading-none">You're up!</div>
              <p className="mt-3 text-lg font-semibold opacity-95">{yourTurn} is yours for {Math.round(drop.holdSeconds / 60)} min. Pay to keep it.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // Claim right after the name sheet (session state has just changed).
  async function doClaimAs(item: Item) {
    claimedHere.current.add(item.id);
    setTimeout(() => claimedHere.current.delete(item.id), 20_000);
    try {
      const c = await api.claim(dropId, item.id);
      setClaims((x) => [c, ...x.filter((y) => y.id !== c.id)]);
      if (c.position === 0) { celebrate(); setTimeout(() => setOrdersOpen(true), 900); }
      else { claimedHere.current.delete(item.id); toasts.push(`${stateRef.current[item.id]?.holder?.name ?? 'Someone'} got it first — you're #${c.position} in line`); }
    } catch (e) { claimedHere.current.delete(item.id); toasts.push(e instanceof Error ? e.message : 'Could not claim', 'hot'); }
  }
}

// ---------- pieces ----------

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-full place-items-center p-6 text-center"><div className="flex flex-col items-center">{children}</div></div>;
}

function RoomSkeleton() {
  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col gap-3 p-4" aria-busy aria-label="Loading the drop">
      <div className="flex items-center gap-3"><div className="h-6 w-40 animate-pulse rounded-lg bg-line" /><div className="ml-auto h-7 w-16 animate-pulse rounded-full bg-line" /></div>
      <div className="aspect-[4/3] animate-pulse rounded-[26px] bg-line" />
      <div className="h-7 w-2/3 animate-pulse rounded-lg bg-line" />
      <div className="mt-auto h-14 animate-pulse rounded-full bg-line" />
    </div>
  );
}

function HoldBar({ until, total }: { until: number | null | undefined; total: number }) {
  const left = useCountdown(until);
  if (!until) return null;
  const pct = Math.max(0, Math.min(1, left / (total * 1000)));
  const s = left / 1000;
  const color = s < 30 ? 'bg-hot' : s < 90 ? 'bg-sun' : 'bg-mint';
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(s)} aria-label="Time left to pay">
      <div className={`h-full rounded-full transition-[width] duration-300 ease-linear ${color} ${s < 10 ? 'anim-urgent' : ''}`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

function ItemHero({ item, st, me, compact, isLatest, holdSeconds }: {
  item: Item; st?: ItemState; me: BuyerSession | null; compact: boolean; isLatest: boolean; holdSeconds: number;
}) {
  const status = st?.status ?? item.status;
  const holder = st?.holder;
  const left = useCountdown(st?.holdUntil);
  const waitlist = st?.waitlist ?? [];
  const isMe = (id?: string) => !!id && id === me?.id;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-[26px] border border-line bg-card shadow-[var(--shadow-card)]">
      <div className={`relative bg-line ${compact ? 'aspect-[16/9]' : 'aspect-[4/3]'}`}>
        <ItemThumb name={item.name} image={item.image} big />
        <div className="absolute left-3 top-3 rounded-full bg-ink/85 px-2.5 py-1 text-xs font-bold text-white">#{item.idx}{isLatest ? ' · JUST DROPPED' : ''}</div>
        {status === 'sold' && (
          <>
            <div className="anim-flash absolute inset-0 bg-mint" />
            <div className="absolute inset-0 grid place-items-center bg-white/35">
              <div className="anim-stamp rounded-2xl border-[6px] border-mint bg-white/95 px-6 py-2 font-display text-5xl font-extrabold tracking-tight text-mint shadow-lg">SOLD</div>
            </div>
          </>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-bold leading-tight">{item.name}</h1>
          <div className="font-display text-2xl font-extrabold">{rupees(item.price)}</div>
        </div>

        <AnimatePresence initial={false}>
          {(holder || waitlist.length > 0) && status !== 'sold' && (
            <motion.div layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="mt-3 overflow-hidden rounded-2xl bg-sun-soft p-3 text-sm" aria-live="polite">
              <AnimatePresence mode="popLayout" initial={false}>
                {holder && (
                  <motion.div key={holder.id} layout initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }}
                    className="flex items-center gap-2 font-semibold text-[#6b4600]">
                    <Avatar id={holder.id} name={holder.name} size={24} />
                    <span className="min-w-0 flex-1 truncate">
                      {isMe(holder.id) ? (status === 'paying' ? 'You paid · seller confirming' : "You're holding it") : `${holder.name} ${status === 'paying' ? 'paid · seller confirming' : 'is holding it'}`}
                    </span>
                    {status === 'held' && <span className="tabular-nums" role="timer">{mmss(left)}</span>}
                  </motion.div>
                )}
              </AnimatePresence>
              {status === 'held' && <HoldBar until={st?.holdUntil} total={holdSeconds} />}
              {waitlist.length > 0 && (
                <div className="mt-2.5 flex items-center gap-2 text-[#6b4600]">
                  <span className="text-xs font-bold uppercase tracking-wide">Next</span>
                  <div className="flex -space-x-1.5">
                    <AnimatePresence initial={false}>
                      {waitlist.slice(0, 5).map((w) => (
                        <motion.span key={w.id} layout initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="rounded-full ring-2 ring-sun-soft">
                          <Avatar id={w.id} name={w.name} size={22} />
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                  <span className="truncate text-xs">{waitlist.map((w) => (isMe(w.id) ? 'you' : w.name.split(' ')[0])).join(', ')}</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {st && st.claims > 1 && <div className="mt-2 text-xs text-muted">{st.claims} people tapped Claim on this</div>}
      </div>
    </motion.div>
  );
}

function ClaimBar({ item, st, myClaim, me, disabled, onClaim, onPay }: {
  item: Item; st?: ItemState; myClaim?: MyClaim; me: BuyerSession | null; disabled: boolean; onClaim: () => Promise<void>; onPay: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const status = st?.status ?? item.status;
  const left = useCountdown(myClaim?.status === 'holding' ? myClaim.holdUntil : null);
  const waitCount = st?.waitlist.length ?? 0;
  const myPos = myClaim?.status === 'waiting' ? (st?.waitlist.findIndex((w) => w.id === me?.id) ?? -1) + 1 || myClaim.position : 0;
  const run = async () => { setBusy(true); try { await onClaim(); } finally { setBusy(false); } };
  if (disabled && !myClaim) {
    return <div className="btn mb-2.5 w-full bg-line py-4 font-display text-xl text-ink-2"><Spinner /> Connecting to the live room…</div>;
  }

  let tone: 'hot' | 'ink' | 'mint' | 'sun' | 'muted' = 'muted';
  let label: React.ReactNode = '';
  let action: (() => void) | undefined;
  let ring = false;
  if (status === 'sold') { tone = myClaim?.status === 'paid' ? 'mint' : 'muted'; label = myClaim?.status === 'paid' ? 'Yours! 🎉' : `Sold to ${st?.holder?.name ?? 'someone'}`; }
  else if (status === 'closed') label = 'No longer available';
  else if (myClaim?.status === 'holding') { tone = 'mint'; label = <>IT'S YOURS ✓ · Pay now <span className="tabular-nums">{mmss(left)}</span></>; action = onPay; }
  else if (myClaim?.status === 'paying') { tone = 'mint'; label = 'Paid · seller confirming'; action = onPay; }
  else if (myClaim?.status === 'waiting') { tone = 'sun'; label = `You're #${myPos} in line`; }
  else if (status === 'live') { tone = 'hot'; label = `CLAIM · ${rupees(item.price)}`; action = run; ring = true; }
  else if (waitCount >= 5) label = 'Waitlist full';
  else { tone = 'ink'; label = `Join the line (#${waitCount + 1})`; action = run; }

  const cls = { hot: 'bg-hot text-white shadow-[var(--shadow-pop)]', ink: 'bg-ink text-white', mint: 'bg-mint text-white', sun: 'bg-sun text-ink', muted: 'bg-line text-ink-2' }[tone];
  return (
    <motion.button layout onClick={action} disabled={!action || busy || disabled} whileTap={action ? { scale: 0.96 } : undefined}
      className={`btn mb-2.5 w-full py-4 font-display text-xl tracking-tight ${cls} ${ring && !busy ? 'anim-ring' : ''} disabled:!opacity-100`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(tone)} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.18 }}>
          {busy ? <Spinner /> : label}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function Feed({ feed, people, meId, sellerId }: { feed: FeedEntry[]; people: People; meId?: string; sellerId: string }) {
  const end = useRef<HTMLDivElement>(null);
  const lastId = feed[feed.length - 1]?.id;
  useEffect(() => {
    // Follow new activity only if the viewer is already near the bottom — never yank the item card out of view.
    const el = end.current; const scroller = el?.closest('.overflow-y-auto') as HTMLElement | null;
    if (!el || !scroller) return;
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140) el.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lastId]);
  return (
    <div className="space-y-1.5 px-4 pb-3 pt-4" aria-live="polite" aria-label="Live room activity">
      {feed.length === 0 && <div className="py-4 text-center text-sm text-muted">Claims and chat show up here live. Ask about size or colour 👇</div>}
      {feed.map((f) => {
        if (f.kind === 'event') {
          const tone = f.ev.kind === 'sold' ? 'bg-mint-soft text-mint' : f.ev.kind === 'claimed' || f.ev.kind === 'promoted' ? 'bg-hot-soft text-hot-dark' : 'bg-line/60 text-ink-2';
          return <div key={f.id} className={`anim-rise mx-auto w-fit max-w-full rounded-full px-3 py-1 text-center text-[13px] font-semibold ${tone}`}>{f.ev.text}</div>;
        }
        if (f.kind === 'drop') {
          return <div key={f.id} className="anim-rise mx-auto w-fit rounded-full bg-ink px-3 py-1 text-[13px] font-semibold text-white">🔥 Dropped #{f.card.idx}: {f.card.name} · {rupees(f.card.price)}</div>;
        }
        const isSeller = f.sender === sellerId;
        const name = f.sender === meId ? 'You' : people[f.sender]?.name ?? '…';
        const text = isSeller ? f.text : scrub(f.text);
        return (
          <div key={f.id} className="anim-rise flex items-start gap-2">
            <Avatar id={f.sender} name={people[f.sender]?.name ?? f.fallbackName} size={24} />
            <div className="min-w-0 text-[15px] leading-snug">
              <span className="font-semibold">{name}</span>
              {isSeller && <span className="ml-1 rounded bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-white">Seller</span>}{' '}
              <span className="text-ink-2">{text}</span>
              {text !== f.text && <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-muted"><Lock className="size-3" />pay only via your ClaimIt order</span>}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function ChatInput({ onSend, disabled, ended }: { onSend: (t: string) => Promise<void>; disabled: boolean; ended?: boolean }) {
  const [text, setText] = useState('');
  return (
    <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); const t = text.trim(); if (!t) return; setText(''); await onSend(t).catch(() => {}); }}>
      <label className="sr-only" htmlFor="room-chat">Message the room</label>
      <input id="room-chat" className="input !rounded-full !py-2.5" placeholder={ended ? 'This drop has ended' : disabled ? 'Connecting…' : 'Ask about size, colour…'} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} disabled={disabled} />
      <button className="btn size-11 shrink-0 bg-ink text-white" disabled={disabled || !text.trim()} aria-label="Send">
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9z" /></svg>
      </button>
    </form>
  );
}

function NameSheet({ open, shop, onClose, onDone }: { open: boolean; shop: string; onClose: () => void; onDone: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title="One tap left">
      <form className="pb-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try { await onDone(name.trim()); setName(''); } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Could not save'); } finally { setBusy(false); }
      }}>
        <p className="text-ink-2">{shop} shows your name in the queue so everyone can see it's fair.</p>
        <label htmlFor="buyer-name" className="mt-4 block text-sm font-semibold">Your name</label>
        <input id="buyer-name" data-autofocus className="input mt-1" autoComplete="given-name" placeholder="e.g. Priya" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
        <p className="mt-1 text-xs text-muted">At least 2 letters. No app, no password.</p>
        {err && <p className="mt-2 text-sm font-semibold text-hot-dark">{err}</p>}
        <button className="btn mt-4 w-full bg-hot py-4 font-display text-xl text-white" disabled={busy || name.trim().length < 2}>{busy ? <Spinner /> : 'Claim it'}</button>
      </form>
    </Sheet>
  );
}

function EndedCard({ shop, shopId, sold, total, toast }: { shop: string; shopId: string; sold: number; total: number; toast: Toast }) {
  const [following, setFollowing] = useState(false);
  return (
    <div className="mx-4 mt-3 rounded-[26px] bg-ink p-5 text-white">
      <div className="text-xs font-bold uppercase tracking-wider text-white/60">Drop ended</div>
      <div className="mt-1 font-display text-3xl font-extrabold leading-tight">{shop} sold {sold} of {total}</div>
      <p className="mt-1 text-white/75">Fair and square — every claim was first-come, in front of everyone.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={`btn px-5 py-3 ${following ? 'bg-white/15 text-white' : 'bg-hot text-white'}`} disabled={following} onClick={async () => {
          try { await ensureBuyer(); await api.follow(shopId, true); setFollowing(true); celebrate({ x: 0.5, y: 0.4 }); toast(`You'll hear when ${shop} drops next`, 'mint'); }
          catch (e) { toast(e instanceof Error ? e.message : 'Could not follow', 'hot'); }
        }}>{following ? <><Check className="size-4" /> Following</> : `Follow ${shop} for the next drop`}</button>
        <Link to="/sell" className="btn bg-white/10 px-5 py-3 text-white">Run your own drop <ChevronRight className="size-4" /></Link>
      </div>
    </div>
  );
}

function ReportProblem({ c, toast }: { c: MyClaim; toast: Toast }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <>
      <button className="mt-2 w-full text-center text-xs font-semibold text-muted underline-offset-2 hover:underline" onClick={() => setOpen(true)}>Report a problem with this order</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Report a problem">
        <form className="pb-2" onSubmit={async (e) => {
          e.preventDefault();
          try { await api.feedback({ role: 'buyer', rating: 0, text: `[order ${c.id}] ${text}` }); toast('Thanks — the ClaimIt team will look into it', 'mint'); setOpen(false); setText(''); }
          catch { toast('Could not send', 'hot'); }
        }}>
          <label htmlFor={`rp-${c.id}`} className="block text-sm font-semibold">What went wrong with “{c.itemName}”?</label>
          <textarea id={`rp-${c.id}`} data-autofocus className="input mt-1" rows={3} maxLength={480} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Paid 2 days ago, no reply from the seller" />
          <button className="btn mt-3 w-full bg-ink py-3 text-white" disabled={text.trim().length < 5}>Send report</button>
        </form>
      </Sheet>
    </>
  );
}

function PaidExtras({ c, toast }: { c: MyClaim; toast: Toast }) {
  const [voted, setVoted] = useState<null | boolean>(null);
  const share = async () => {
    const text = `I just claimed “${c.itemName}” from ${c.shop} — fairly, first tap wins 🎉`;
    const url = location.href.split('?')[0] + (sessions.buyer() ? `?r=${sessions.buyer()!.id}` : '');
    try { if (navigator.share) await navigator.share({ title: 'ClaimIt', text, url }); else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Copied — paste it in your story'); } } catch { /* cancelled */ }
  };
  return (
    <div className="mt-3 space-y-2">
      <button className="btn w-full bg-hot-soft py-2.5 text-sm text-hot-dark" onClick={share}><Share2 className="size-4" /> Share your win</button>
      {voted === null ? (
        <div className="flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm">
          <span className="flex-1 font-semibold">Fairer than “comment MINE”?</span>
          {[true, false].map((v) => (
            <button key={String(v)} className="btn bg-white px-3 py-1.5 shadow-sm" aria-label={v ? 'Yes' : 'No'}
              onClick={() => { setVoted(v); api.feedback({ role: 'buyer', rating: v ? 10 : 0 }).catch(() => {}); }}>{v ? '👍' : '👎'}</button>
          ))}
        </div>
      ) : <p className="text-center text-sm text-muted">Thanks for the feedback {voted ? '💚' : '🙏'}</p>}
    </div>
  );
}

// ---------- orders ----------

function Orders({ claims, sellerId, shop, buyerName, onChange, toast }: {
  claims: MyClaim[]; sellerId: string; shop: string; buyerName: string; onChange: () => void; toast: Toast;
}) {
  const visible = useMemo(() => claims.filter((c) => c.status !== 'cancelled' || c.position === 0), [claims]);
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <div className="space-y-3">
      {visible.length === 0 && <p className="py-4 text-center text-muted">Nothing yet. Tap Claim on an item to grab it.</p>}
      {visible.map((c) => <OrderCard key={c.id} c={c} buyerName={buyerName} onChange={onChange} toast={toast} />)}
      <div className="rounded-2xl border border-line bg-card">
        <button className="flex w-full items-center gap-3 px-3 py-3 text-left" onClick={() => setChatOpen((o) => !o)} aria-expanded={chatOpen}>
          <span className="grid size-9 place-items-center rounded-full bg-paper"><MessageCircle className="size-[18px]" /></span>
          <span className="flex-1 font-semibold">Message {shop}</span>
          <ChevronRight className={`size-5 text-muted transition ${chatOpen ? 'rotate-90' : ''}`} />
        </button>
        {chatOpen && <div className="border-t border-line px-3 pb-3"><DMThread peerId={sellerId} peerName={shop} compact /></div>}
      </div>
    </div>
  );
}

const STEPS = ['Claimed', 'Paid', 'Confirmed', 'Shipping'] as const;

function Stepper({ at }: { at: number }) {
  return (
    <ol className="mt-3 flex items-center gap-1" aria-label="Order progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col items-center gap-1">
          <div className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${i < at ? 'bg-mint text-white' : i === at ? 'bg-sun text-ink' : 'bg-line text-muted'}`}>
            {i < at ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
          </div>
          <span className={`text-[11px] ${i <= at ? 'font-semibold text-ink' : 'text-muted'}`}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function OrderCard({ c, buyerName, onChange, toast }: { c: MyClaim; buyerName: string; onChange: () => void; toast: Toast }) {
  const left = useCountdown(c.status === 'holding' ? c.holdUntil : null);
  const [txn, setTxn] = useState('');
  const [ship, setShip] = useState<Shipping>({ phone: '', address: '', pincode: '' });
  const [editing, setEditing] = useState(true);
  const [payTapped, setPayTapped] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const paidRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (c.status !== 'holding') return;
    api.shipping().then((s) => {
      setShip((cur) => ({ phone: cur.phone || s.phone || '', address: cur.address || s.address || '', pincode: cur.pincode || s.pincode || '' }));
      if (s.phone && s.address && s.pincode) setEditing(false);
    }).catch(() => {});
  }, [c.status]);

  // Coming back from the UPI app: make "I've paid" the obvious next step.
  useEffect(() => {
    if (!payTapped) return;
    const onVis = () => { if (document.visibilityState === 'visible') setTimeout(() => paidRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [payTapped]);

  const india = (c.currency ?? 'INR') === 'INR';
  const phoneDigits = india ? ship.phone.replace(/\D/g, '').slice(-10) : ship.phone.replace(/[^\d+]/g, '');
  const shipOk = (india ? /^[6-9]\d{9}$/.test(phoneDigits) : /^\+?\d{7,15}$/.test(phoneDigits))
    && ship.address.trim().length >= 10 && (india ? /^[1-9]\d{5}$/.test(ship.pincode) : /^[A-Za-z0-9 -]{3,10}$/.test(ship.pincode.trim()));
  // India: UPI deep link (any UPI app). Elsewhere: the seller's payment link (PayPal.me, Venmo, Stripe, GCash…).
  const link = c.upi ? upiLink(c.upi, c.shop, c.price, `ClaimIt ${c.itemName}`) : c.payLink || '';
  const price = money(c.price, c.currency);
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok, 'mint'); onChange(); } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'hot'); } finally { setBusy(false); }
  };
  const stepAt = c.status === 'holding' ? 1 : c.status === 'paying' ? 2 : c.status === 'paid' ? (c.shippedAt ? 4 : 3) : 0;
  const label: Record<string, [string, string]> = {
    holding: ['Pay to keep it', 'text-mint'], paying: ['Seller is confirming your payment', 'text-[#8a5a00]'], waiting: [`#${c.position} in line`, 'text-[#8a5a00]'],
    paid: [c.shippedAt ? `📦 Shipped${c.tracking ? ` · ${c.tracking}` : ''}` : 'Payment confirmed — preparing to ship', 'text-mint'], expired: ['Hold expired', 'text-muted'], cancelled: ['Released', 'text-muted'], rejected: ['Payment not confirmed', 'text-hot-dark'],
  };
  const [text, cls] = label[c.status] || [c.status, ''];

  return (
    <div className={`rounded-2xl border bg-card p-3 ${c.status === 'holding' ? 'border-mint shadow-[0_0_0_3px_rgb(11_132_87/0.15)]' : 'border-line'}`}>
      <div className="flex items-center gap-3">
        <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-line"><ItemThumb name={c.itemName} image={c.image} /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.itemName}</div>
          <div className="text-sm text-ink-2">{rupees(c.price)}</div>
          <div className={`text-sm font-bold ${cls}`}>{text}</div>
        </div>
        {c.status === 'holding' && <div className="text-right"><div className="font-display text-2xl font-extrabold tabular-nums text-mint" role="timer">{mmss(left)}</div><div className="text-[11px] text-muted">left to pay</div></div>}
      </div>

      {['holding', 'paying', 'paid'].includes(c.status) && <Stepper at={stepAt} />}

      {c.status === 'holding' && (
        <div className="mt-3 space-y-2.5">
          {/* ① Delivery */}
          <section className="rounded-xl bg-paper p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted"><Truck className="size-4" /> Deliver to</div>
            {!editing && shipOk ? (
              <div className="mt-1.5 flex items-start gap-2 text-sm">
                <div className="min-w-0 flex-1"><b>{buyerName}</b>, {ship.address} — {ship.pincode} · {phoneDigits}</div>
                <button className="font-semibold text-hot-dark" onClick={() => setEditing(true)}>Edit</button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <label className="block text-sm font-semibold" htmlFor={`ph-${c.id}`}>Mobile number</label>
                <input id={`ph-${c.id}`} className="input !py-2 text-sm" type="tel" inputMode="tel" autoComplete="tel" placeholder={india ? '98765 43210' : '+1 415 555 0123'} value={ship.phone}
                  onChange={(e) => setShip({ ...ship, phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 14) })} />
                <label className="block text-sm font-semibold" htmlFor={`ad-${c.id}`}>Address</label>
                <textarea id={`ad-${c.id}`} className="input !py-2 text-sm" rows={2} autoComplete="street-address" placeholder={india ? 'Flat / street / area / city' : 'Street, apt, city, state'} value={ship.address}
                  onChange={(e) => setShip({ ...ship, address: e.target.value.slice(0, 300) })} />
                <label className="block text-sm font-semibold" htmlFor={`pin-${c.id}`}>{india ? 'PIN code' : 'Postal / ZIP code'}</label>
                <input id={`pin-${c.id}`} className="input !py-2 text-sm" inputMode={india ? 'numeric' : 'text'} autoComplete="postal-code" placeholder={india ? '560034' : '94103'} value={ship.pincode}
                  onChange={(e) => setShip({ ...ship, pincode: india ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value.slice(0, 10) })} />
                {shipOk && <button className="btn w-full bg-ink py-2 text-sm text-white" onClick={() => setEditing(false)}>Save address</button>}
              </div>
            )}
          </section>

          {/* ② Pay */}
          <section className={`rounded-xl p-3 ${shipOk ? 'bg-mint-soft/60' : 'bg-paper opacity-60'}`}>
            <div className="text-xs font-bold uppercase tracking-wider text-muted">Pay {c.shop}</div>
            <a href={shipOk ? link : undefined} aria-disabled={!shipOk} target={c.upi ? undefined : '_blank'} rel="noreferrer"
              onClick={() => { if (!shipOk) return; setPayTapped(true); api.payingApp(c.id).catch(() => {}); }}
              className={`btn mt-2 w-full py-3 text-white ${shipOk ? 'bg-mint' : 'pointer-events-none bg-muted'}`}>
              {c.upi ? `Pay ${price} with any UPI app` : `Pay ${price} via ${c.shop}'s payment link ↗`}
            </a>
            {!isMobile && shipOk && c.upi && (
              <div className="mt-2 flex items-center gap-3 rounded-xl bg-white p-2">
                <QR value={link} size={88} />
                <p className="text-sm text-ink-2">On a laptop? Scan with your phone's UPI app to pay <b>{c.upi}</b></p>
              </div>
            )}
            {!c.upi && shipOk && <p className="mt-1.5 text-xs text-muted">Pay exactly {price}. Add “{c.itemName}” as the note.</p>}
          </section>

          {/* ③ Confirm */}
          <section className="rounded-xl bg-paper p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-muted">Then tell {c.shop} you've paid</div>
            <label className="mt-2 block text-sm font-semibold" htmlFor={`txn-${c.id}`}>{c.upi ? 'UPI transaction ID' : 'Payment reference'} <span className="font-normal text-muted">(optional, speeds up confirmation)</span></label>
            <input id={`txn-${c.id}`} className="input mt-1 !py-2 text-sm" placeholder={c.upi ? '12-digit ref from your UPI app' : 'Transaction ID or the name you paid from'} value={txn} onChange={(e) => setTxn(e.target.value)} maxLength={40} />
            <button ref={paidRef} className={`btn mt-2 w-full py-3 text-white ${payTapped ? 'anim-ring bg-ink' : 'bg-ink'}`} disabled={busy || !shipOk}
              onClick={() => act(() => api.markPaid(c.id, { utr: txn, ...ship, phone: phoneDigits }), 'Sent — the seller will confirm shortly')}>
              {busy ? <Spinner /> : "I've paid"}
            </button>
            {!shipOk && <p className="mt-1.5 text-center text-xs text-muted">Add your delivery details first.</p>}
          </section>

          <button className="w-full py-1 text-center text-sm font-semibold text-muted hover:underline" onClick={() => setConfirmRelease(true)}>Let it go to the next person</button>
          <ConfirmSheet open={confirmRelease} onClose={() => setConfirmRelease(false)} title={`Release ${c.itemName}?`}
            body="The next person in line gets it straight away. You can't undo this." confirmLabel="Release it"
            onConfirm={() => act(() => api.release(c.id), 'Released to the next person')} />
        </div>
      )}
      {c.status === 'paid' && <PaidExtras c={c} toast={toast} />}
      {['paying', 'paid', 'rejected'].includes(c.status) && <ReportProblem c={c} toast={toast} />}
      {c.status === 'waiting' && (
        <button className="mt-2 w-full py-1 text-center text-sm font-semibold text-muted hover:underline" disabled={busy}
          onClick={() => act(() => api.release(c.id), 'Left the line')}>Leave the line</button>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, sessions, type SellerClaim, type SellerDrop } from '../api';
import { rt, type RtMessage } from '../rt';
import { Avatar, ConfirmSheet, CopyButton, ItemThumb, Logo, QR, Sheet, Spinner, StatusChip, useToasts } from '../components/ui';
import { Play } from 'lucide-react';
import { DMThread } from '../components/DMThread';
import { chatUIReady, mountChatUI, openDirect, setupChatUI } from '../chatui';
import { currencySymbol, mmss, money, resizeImage, setCurrency, telHref, useCountdown, useDebounced } from '../util';
import { MSG, type ChatContent, type EventContent, type Item } from '../../../shared/types';

type Tab = 'pay' | 'room' | 'inbox';

export default function SellerConsole() {
  const { dropId = '' } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<SellerDrop | null>(null);
  const [tab, setTab] = useState<Tab>('pay');
  const [feed, setFeed] = useState<{ id: string; text: string; who?: string; from?: string; mine?: boolean; kind: string }[]>([]);
  // Chat names come from the server by sender id, never from the message body (which a buyer controls).
  const [people, setPeople] = useState<Record<string, { name: string; seller?: boolean }>>({});
  const wantedNames = useRef(new Set<string>());
  const resolveNames = useDebounced(async () => {
    const ids = [...wantedNames.current]; wantedNames.current.clear();
    if (ids.length) try { const r = await api.people(dropId, ids); setPeople((p) => ({ ...p, ...r })); } catch { /* ignore */ }
  }, 300);
  const [viewers, setViewers] = useState<number | null>(null);
  const [role, setRole] = useState<'owner' | 'cohost'>('owner');
  const [mobileSection, setMobileSection] = useState<'items' | 'panel'>('items'); // which part the phone tab bar shows as current
  // Keep the phone tab bar honest when the seller scrolls by hand, not just when they tap it.
  useEffect(() => {
    const el = document.getElementById('seller-panel');
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setMobileSection(e.isIntersecting ? 'panel' : 'items'), { threshold: 0.05, rootMargin: '0px 0px -30% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [data?.drop.id]);
  // Buyer questions that arrive while the seller is on another tab.
  const [roomUnread, setRoomUnread] = useState(0);
  const roomScroll = useRef<HTMLDivElement>(null);
  const lastFeedId = feed[feed.length - 1]?.id;
  useEffect(() => {
    const el = roomScroll.current; // follow new messages only when already near the bottom
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [lastFeedId]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [inboxPeer, setInboxPeer] = useState<string | null>(null);
  const [chatUI, setChatUI] = useState(false); // Nexconn Chat UI inbox available (desktop + Nexconn mode)
  const [inboxOpen, setInboxOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmPay, setConfirmPay] = useState<SellerClaim | null>(null);
  const [confirmSkip, setConfirmSkip] = useState<SellerClaim | null>(null);
  const inboxBox = useRef<HTMLDivElement>(null);
  const toasts = useToasts();
  const seller = sessions.seller();

  const load = useCallback(async () => {
    try {
      const d = await api.sellerDrop(dropId);
      setCurrency(d.drop.currency);
      setData(d);
      if (typeof d.drop.inRoom === 'number' && d.drop.inRoom > 0) setViewers(d.drop.inRoom);
    }
    catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 404)) nav('/sell'); }
  }, [dropId, nav]);
  const refresh = useDebounced(load, 500); // metadata bursts (a claim race) collapse into one refetch

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
        const wide = window.matchMedia('(min-width: 1024px)').matches;
        setRole(s.role);
        // Buyer chats belong to the shop owner; co-hosts run the room and payments under their own identity.
        if (wide && !rt.me && s.role === 'owner') rt.beforeConnect(() => setupChatUI(s.userId, s.shop));
        await rt.connect(s.token, s.userId);
        if (cancelled) return;
        setChatUI(chatUIReady());
        const r = await rt.enterOpen(channelId);
        setViewers(r.count);
      } catch (e) { toasts.push(e instanceof Error ? e.message : 'Realtime connection failed', 'hot'); }
    })();
    const offMeta = rt.onMetadata((cid) => cid === channelId && refresh());
    const offCount = rt.onParticipants((cid, n) => cid === channelId && setViewers(n));
    const offMsg = rt.onMessage((m: RtMessage) => {
      if (m.kind === 'open' && m.channelId === channelId) {
        if (m.type === MSG.CHAT || (m.type === MSG.SELLER_CHAT && m.sender === data?.drop.sellerId)) {
          const c = m.content as ChatContent;
          if (!m.mine) { wantedNames.current.add(m.sender); resolveNames(); if (tabRef.current !== 'room') setRoomUnread((n) => n + 1); }
          setFeed((f) => f.some((x) => x.id === m.id) ? f : [...f.slice(-120), { id: m.id, text: c.text, from: m.sender, mine: m.mine, kind: 'chat' }]);
        }
        else if (m.type === MSG.EVENT) { const ev = m.content as EventContent; setFeed((f) => [...f.slice(-120), { id: m.id, text: ev.text, kind: ev.kind }]); refresh(); }
      } else if (m.kind === 'direct' && !m.mine) {
        if (!(tabRef.current === 'inbox' && peerRef.current === m.channelId)) setUnread((u) => ({ ...u, [m.channelId]: (u[m.channelId] || 0) + 1 }));
        if (m.type === MSG.ORDER_UPDATE) toasts.push('💸 A buyer says they paid', 'mint');
        refresh();
      }
    });
    return () => { cancelled = true; offMeta(); offCount(); offMsg(); rt.exitOpen(channelId).catch(() => {}); };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (inboxOpen && inboxBox.current) mountChatUI(inboxBox.current);
  }, [inboxOpen]);

  const openInbox = (buyerId?: string) => {
    setInboxOpen(true);
    if (buyerId) { setUnread((u) => ({ ...u, [buyerId]: 0 })); openDirect(buyerId).catch(() => {}); }
  };

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

  // "D" drops the next item — sellers are juggling a live video, so one key matters.
  const nextDraft = data && data.drop.status !== 'ended' ? [...data.items].filter((i) => i.status === 'draft').sort((a, b) => a.idx - b.idx)[0] : undefined;
  const dropNextRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'd' || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || t.closest('nc-chat-ui-app-provider')) return;
      dropNextRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!data) return <div className="grid min-h-full place-items-center"><Spinner className="size-8 text-hot" /></div>;

  const { drop, items, stats } = data;
  const link = `${location.origin}/d/${drop.id}`;
  const toConfirm = data.claims.filter((c) => c.status === 'paying' || c.status === 'holding');
  const needsAction = data.claims.filter((c) => c.status === 'paying').length;
  const ended = drop.status === 'ended';
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toasts.push(ok, 'mint'); load(); }
    catch (e) { toasts.push(e instanceof Error ? e.message : 'Failed', 'hot'); }
  };
  dropNextRef.current = () => { if (nextDraft) act(() => api.dropItem(drop.id, nextDraft.id), `Dropped #${nextDraft.idx} ${nextDraft.name}!`); };

  // A scheduled drop that hasn't started reads as "scheduled" everywhere the seller shares it, never "live now".
  const [, tickAtStart] = useState(0);
  useEffect(() => {
    const at = drop?.startsAt ?? 0;
    if (at <= Date.now()) return;
    const t = setTimeout(() => tickAtStart((n) => n + 1), at - Date.now() + 500);
    return () => clearTimeout(t);
  }, [drop?.startsAt]);
  const upcoming = !!drop?.startsAt && drop.startsAt > Date.now() && !items.some((i) => i.status !== 'draft');
  const whenText = drop?.startsAt ? new Date(drop.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const goPanel = (k: Tab) => { setTab(k); if (k === 'room') setRoomUnread(0); document.getElementById('seller-panel')?.scrollIntoView({ behavior: 'smooth' }); };
  return (
    <div className="min-h-full pb-[calc(140px+env(safe-area-inset-bottom))] lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/sell"><Logo className="text-lg" /></Link>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-lg font-bold leading-tight">{drop.title}</div>
            <div className="truncate text-xs text-muted">{drop.shop}</div>
          </div>
          {ended ? <span className="rounded-full bg-line px-2.5 py-1 text-xs font-bold">ENDED</span> : upcoming ? (
            <span className="whitespace-nowrap rounded-full bg-sun-soft px-2.5 py-1 text-xs font-bold text-[#6b4600]">SCHEDULED · {new Date(drop.startsAt!).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          ) : (
            <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white"><span className="anim-live size-1.5 rounded-full bg-hot" />LIVE{viewers ? <> · {viewers}<span className="hidden sm:inline">&nbsp;in room</span></> : ''}</span>
          )}
          {chatUI && (
            <button onClick={() => openInbox()} className="btn relative bg-ink px-3 py-1.5 text-sm text-white">
              Inbox
              {totalUnread > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-hot-dark text-[11px]">{totalUnread}</span>}
            </button>
          )}
          <a href={link} target="_blank" rel="noreferrer" className="btn whitespace-nowrap border-2 border-ink px-3 py-1.5 text-sm"><span className="sm:hidden">Buyer view ↗</span><span className="hidden sm:inline">Open buyer view ↗</span></a>
        </div>
      </header>

      {needsAction > 0 && (
        <button onClick={() => { setMobileSection('panel'); goPanel('pay'); }}
          className="sticky top-[64px] z-20 flex w-full items-center justify-center gap-2 bg-mint px-4 py-2.5 text-sm font-bold text-white lg:hidden">
          💸 {needsAction} payment{needsAction > 1 ? 's' : ''} to confirm →
        </button>
      )}
      {drop.startsAt && drop.startsAt > Date.now() && !ended && (
        <div className="mx-auto mt-3 max-w-6xl px-4">
          <div className="rounded-2xl bg-sun-soft px-4 py-2.5 text-sm text-[#6b4600]">
            📅 <b>Scheduled for {new Date(drop.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.</b> Buyers see a countdown and can add it to their calendar. Dropping an item starts it early.
          </div>
        </div>
      )}
      <main className="mx-auto grid max-w-6xl gap-5 px-4 pt-5 lg:grid-cols-[1fr_400px] lg:pb-28">
        <div className="space-y-5">
          {/* Share + stats */}
          <section className="grid gap-4 rounded-[26px] border border-line bg-card p-4 shadow-[var(--shadow-card)] sm:grid-cols-[auto_1fr]">
            <QR value={link} size={128} className="mx-auto" />
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-muted">Share this link in your story / group</div>
              <div className="mt-1 truncate rounded-xl bg-paper px-3 py-2 font-mono text-sm">{link}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyButton text={link} label="Copy link" />
                <a className="btn bg-[#075E54] px-4 py-2 text-sm text-white" target="_blank" rel="noreferrer"
                  href={`https://wa.me/?text=${encodeURIComponent(upcoming ? `📅 ${drop.shop} drops ${whenText} — tap to get a reminder. First tap wins! ${link}` : `🔥 ${drop.shop} is dropping LIVE now — first tap wins! ${link}`)}`}>WhatsApp</a>
                <button className="btn border-2 border-ink px-4 py-1.5 text-sm" onClick={() => act(() => api.downloadOrders(drop.id))}>Orders CSV</button>
                <button className="btn border-2 border-line px-4 py-1.5 text-sm text-ink-2" onClick={() => setDeviceOpen(true)}>Use on another device</button>
              </div>
              <details className="mt-2 rounded-xl bg-paper px-3 py-2 text-sm">
                <summary className="cursor-pointer font-semibold">Copy for Instagram / WhatsApp</summary>
                {[
                  ['Pinned comment', `🛍️ Don't comment MINE — tap here to claim, first tap wins & everyone sees the queue: ${link}`],
                  ['Story link sticker', upcoming ? `DROP ${whenText.toUpperCase()} 📅 Tap for a reminder` : `LIVE DROP NOW 🔴 Tap to claim`],
                  ['Say on your live', `“Link is in my pinned comment / story — open it in another tab, keep watching here, tap CLAIM when I say the number!”`],
                ].map(([k, v]) => (
                  <div key={k} className="mt-2 flex items-start gap-2">
                    <div className="min-w-0 flex-1"><div className="text-xs font-bold text-muted">{k}</div><div className="text-ink-2">{v}</div></div>
                    <CopyButton text={v} label="Copy" className="!px-3 !py-1 !text-xs" />
                  </div>
                ))}
              </details>
              <label className="mt-2 flex items-center gap-2 text-sm text-ink-2">
                Time to pay after winning:
                <select className="rounded-lg border border-line bg-white px-2 py-1 font-semibold text-ink" value={Math.round(drop.holdSeconds / 60)}
                  onChange={(e) => act(() => api.updateDrop(drop.id, { holdMinutes: Number(e.target.value) }), `Buyers now get ${e.target.value} min to pay`)}>
                  {[2, 3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </label>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                {[['Joined', stats.viewers], ['Via shares', stats.viaShares], ['Claim taps', stats.claimAttempts], ['Sold', stats.sold], ['Revenue', money(stats.revenue)], ['Followers', stats.followers]].map(([k, v]) => (
                  <div key={k as string} className="rounded-xl bg-paper px-1 py-2">
                    <div className="font-display text-lg font-extrabold leading-none">{v}</div>
                    <div className="mt-1 text-[11px] text-muted">{k}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {ended && <Recap stats={stats} items={items} claims={data.claims} shop={drop.shop} />}
          {!ended && <AddItem dropId={drop.id} onAdded={load} toast={toasts.push} />}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-muted">Items ({items.length})</div>
              {!ended && (
                <button className="text-sm font-semibold text-muted hover:text-hot-dark" onClick={() => setConfirmEnd(true)}>End drop</button>
              )}
            </div>
            <div className="space-y-2.5">
              {items.length === 0 && <p className="rounded-2xl border-2 border-dashed border-line p-6 text-center text-muted">Add your first item above, then hit <b>Drop now</b> when you show it on your live.</p>}
              {[...items].sort((a, b) => sortKey(a) - sortKey(b) || a.idx - b.idx).map((it) => (
                <ItemRow key={it.id} it={it} claims={claimsByItem.get(it.id) ?? []} ended={ended} isNext={it.id === nextDraft?.id}
                  holdSeconds={drop.holdSeconds}
                  onDrop={() => act(() => api.dropItem(drop.id, it.id), `Dropped ${it.name}!`)}
                  onClose={() => act(() => api.closeItem(drop.id, it.id))}
                  onDelete={() => act(() => api.deleteItem(drop.id, it.id))} />
              ))}
            </div>
          </section>
        </div>

        {/* Right panel */}
        <aside id="seller-panel" className={`${needsAction > 0 ? 'scroll-mt-28' : 'scroll-mt-20'} lg:sticky lg:top-[76px] lg:h-[calc(100dvh-96px)]`}>
          <div className="flex h-full min-h-[420px] flex-col rounded-[26px] border border-line bg-card p-3 shadow-[var(--shadow-card)]">
            <div className="flex gap-1 rounded-full bg-paper p-1" role="tablist" aria-label="Seller panel" onKeyDown={(e) => {
              // Arrow keys move between tabs (WAI-ARIA tabs pattern).
              const order: Tab[] = ['pay', 'room', 'inbox'];
              const i = order.indexOf(tab);
              const next = e.key === 'ArrowRight' ? order[(i + 1) % 3] : e.key === 'ArrowLeft' ? order[(i + 2) % 3] : e.key === 'Home' ? order[0] : e.key === 'End' ? order[2] : null;
              if (!next) return;
              e.preventDefault(); setTab(next); if (next === 'room') setRoomUnread(0);
              requestAnimationFrame(() => document.getElementById(`seller-tab-${next}`)?.focus());
            }}>
              {([['pay', `Payments${needsAction ? ` (${needsAction})` : ''}`], ['room', `Room${roomUnread ? ` (${roomUnread})` : ''}`], ['inbox', `Inbox${totalUnread ? ` (${totalUnread})` : ''}`]] as [Tab, string][]).map(([k, l]) => (
                <button key={k} id={`seller-tab-${k}`} role="tab" aria-selected={tab === k} aria-controls="seller-tabpanel" tabIndex={tab === k ? 0 : -1} onClick={() => { setTab(k); if (k === 'room') setRoomUnread(0); }}
                  className={`flex-1 rounded-full py-2 text-sm font-semibold ${tab === k ? 'bg-ink text-white' : 'text-ink-2'}`}>{l}</button>
              ))}
            </div>
            <div className="mt-3 flex min-h-0 flex-1 flex-col" id="seller-tabpanel" role="tabpanel" aria-labelledby={`seller-tab-${tab}`}>
              {tab === 'pay' && (
                <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {toConfirm.length === 0 && <p className="py-8 text-center text-sm text-muted">When a buyer claims and pays, confirm it here.</p>}
                  {toConfirm.map((c) => {
                    const it = items.find((i) => i.id === c.itemId)!;
                    return <PayRow key={c.id} c={c} it={it} holdSeconds={drop.holdSeconds} onConfirm={() => setConfirmPay(c)}
                      onReject={() => setConfirmSkip(c)}
                      onChat={() => {
                        if (chatUI) openInbox(c.buyerId);
                        else { setInboxPeer(c.buyerId); setTab('inbox'); setUnread((u) => ({ ...u, [c.buyerId]: 0 })); }
                      }} />;
                  })}
                </div>
              )}
              {tab === 'room' && (
                <div ref={roomScroll} className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                  {feed.length === 0 && <p className="py-8 text-center text-sm text-muted">Live chat and claims from the room appear here.</p>}
                  {feed.map((f) => f.kind === 'chat'
                    ? <div key={f.id} className="text-[14px]">{f.mine
                        ? <><span className="rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">You</span> <span className="text-ink">{f.text}</span></>
                        : <><b>{people[f.from ?? '']?.name ?? '…'}</b> <span className="text-ink-2">{f.text}</span></>}</div>
                    : <div key={f.id} className={`w-fit rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${f.kind === 'sold' ? 'bg-mint-soft text-mint' : 'bg-hot-soft text-hot-dark'}`}>{f.text}</div>)}
                </div>
              )}
              {tab === 'room' && channelId && (
                <RoomReply shopId={data?.drop.sellerId ?? ''} onSend={async (text) => {
                  try { await api.sellerSay(dropId, text); } // arrives back via the room (echo) with its real message id
                  catch (e) { toasts.push(e instanceof Error ? e.message : 'Could not send', 'hot'); }
                }} />
              )}
              {tab === 'inbox' && role === 'cohost' && (
                <p className="py-8 text-center text-sm text-muted">Buyer chats go to the shop owner's inbox. As a co-host you can drop items, confirm payments and reply in the room.</p>
              )}
              {tab === 'inbox' && role === 'owner' && chatUI && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <button className="btn w-full bg-ink py-3 text-white" onClick={() => openInbox()}>Open full inbox</button>
                  <p className="mt-2 text-center text-xs text-muted">Powered by Nexconn Chat UI: every order chat, with read receipts, images and history.</p>
                  <div className="scroll-thin mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
                    {buyers.map((b) => (
                      <button key={b.id} onClick={() => openInbox(b.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-paper">
                        <Avatar id={b.id} name={b.name} size={32} />
                        <span className="flex-1 font-semibold">{b.name}</span>
                        {unread[b.id] ? <span className="grid size-5 place-items-center rounded-full bg-hot-dark text-[11px] font-bold text-white">{unread[b.id]}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tab === 'inbox' && role === 'owner' && !chatUI && (
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
                        {unread[b.id] ? <span className="grid size-5 place-items-center rounded-full bg-hot-dark text-[11px] font-bold text-white">{unread[b.id]}</span> : null}
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </aside>
      </main>

      <Sheet open={deviceOpen} onClose={() => setDeviceOpen(false)} title="Open your shop on another device">
        {seller && (() => {
          const loginLink = `${location.origin}/sell/login#${seller.id}.${seller.key}`;
          return (
            <div className="space-y-3 pb-2">
              <p className="text-ink-2">Scan this with your phone (or laptop) to manage drops there too — handy when you go live on your phone and confirm payments on a laptop.</p>
              <div className="flex justify-center"><QR value={loginLink} size={200} /></div>
              <CopyButton text={loginLink} label="Copy login link" className="w-full" />
              <p className="rounded-xl bg-hot-soft px-3 py-2 text-sm font-semibold text-hot-dark">Keep this private: anyone with this link can manage your shop.</p>
            </div>
          );
        })()}
      </Sheet>

      {/* Phones: the panel sits below the item list, so a thumb-reach tab bar jumps straight to it. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden" aria-label="Seller sections">
        {([['items', 'Items', 0], ['pay', 'Payments', needsAction], ['room', 'Room', roomUnread], ['inbox', 'Inbox', totalUnread]] as const).map(([k, l, n]) => (
          <button key={k} aria-current={(k === 'items' ? mobileSection === 'items' : mobileSection === 'panel' && tab === k) ? 'true' : undefined}
            className={`relative flex-1 rounded-xl py-2 text-sm font-semibold ${(k === 'items' ? mobileSection === 'items' : mobileSection === 'panel' && tab === k) ? 'bg-ink text-white' : 'text-ink-2'}`}
            onClick={() => { if (k === 'items') { setMobileSection('items'); window.scrollTo({ top: 0, behavior: 'smooth' }); } else { setMobileSection('panel'); goPanel(k); } }}>
            {l}
            {n > 0 && <span className="absolute right-[18%] top-0.5 grid min-w-5 place-items-center rounded-full bg-hot-dark px-1 text-[11px] font-bold text-white">{n}</span>}
          </button>
        ))}
      </nav>

      {nextDraft && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-4 lg:justify-start lg:pl-[max(1rem,calc((100vw-72rem)/2+1rem))]">
          <button className="btn anim-ring pointer-events-auto bg-hot-dark px-6 py-3.5 text-white shadow-[var(--shadow-pop)]" onClick={() => dropNextRef.current()}>
            <Play className="size-4 fill-current" /> Drop next: #{nextDraft.idx} {nextDraft.name.length > 28 ? nextDraft.name.slice(0, 27) + '…' : nextDraft.name}
            <kbd className="ml-1 hidden rounded-md bg-white/25 px-1.5 text-xs font-bold sm:inline">D</kbd>
          </button>
        </div>
      )}

      <ConfirmSheet open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End this drop?" tone="ink"
        body="Buyers won't be able to claim anything else. Orders already claimed stay as they are." confirmLabel="End drop"
        onConfirm={() => act(() => api.endDrop(drop.id), 'Drop ended — here is your recap')} />
      <ConfirmSheet open={!!confirmPay} onClose={() => setConfirmPay(null)} title={`Did ${money(items.find((i) => i.id === confirmPay?.itemId)?.price ?? 0)} arrive?`} tone="mint"
        body={<>Check your payment app for a payment from <b>{confirmPay?.buyerName}</b>{confirmPay?.utr ? <> with reference <b>{confirmPay.utr}</b></> : null}. Confirming marks the item sold and tells the buyer.</>}
        confirmLabel="Yes, payment received" onConfirm={() => confirmPay && act(() => api.confirm(confirmPay.id), `Sold to ${confirmPay.buyerName} ✓`)} />
      <ConfirmSheet open={!!confirmSkip} onClose={() => setConfirmSkip(null)} title={`Skip ${confirmSkip?.buyerName}?`} tone="ink"
        body="The item goes to the next person in line straight away and they get the order card." confirmLabel="Give it to the next person"
        onConfirm={() => confirmSkip && act(() => api.reject(confirmSkip.id), 'Moved to the next person in line')} />

      {/* Nexconn Chat UI inbox (desktop). Kept mounted so Chat UI keeps its state between opens. */}
      {chatUI && (
        <div className={`fixed inset-0 z-50 items-center justify-center p-6 ${inboxOpen ? 'flex' : 'hidden'}`} role="dialog" aria-modal aria-label="Inbox">
          <button className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]" onClick={() => setInboxOpen(false)} aria-label="Close inbox" />
          <div className="relative flex h-[min(820px,88dvh)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <div className="font-display text-xl font-bold">Inbox</div>
                <div className="text-xs text-muted">Order chats with your buyers · Nexconn Chat UI</div>
              </div>
              <button onClick={() => setInboxOpen(false)} className="grid size-9 place-items-center rounded-full bg-line/60 hover:bg-line" aria-label="Close">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div ref={inboxBox} className="min-h-0 flex-1" />
          </div>
        </div>
      )}
    </div>
  );
}

const sortKey = (it: Item) => ({ held: 0, paying: 0, live: 1, draft: 2, sold: 3, closed: 4 }[it.status] ?? 5);

function AddItem({ dropId, onAdded, toast }: { dropId: string; onAdded: () => void; toast: (t: string, tone?: 'hot' | 'mint' | 'ink') => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]); // photos picked in one go: each pre-fills the next item
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <form className="rounded-[26px] border border-line bg-card p-4 shadow-[var(--shadow-card)]" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try {
        await api.addItem(dropId, { name, price: Number(price), image });
        setName(''); setPrice('');
        const [next, ...rest] = queue;
        setImage(next ?? null); setQueue(rest);
        if (fileRef.current) fileRef.current.value = '';
        onAdded();
        if (next) nameRef.current?.focus();
      } catch (e2) { toast(e2 instanceof Error ? e2.message : 'Could not add', 'hot'); } finally { setBusy(false); }
    }}>
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" onClick={() => fileRef.current?.click()} className="relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-paper text-xs font-semibold text-muted">
          {image ? <img src={image} alt="" className="size-full object-cover" /> : <span className="px-1 text-center">+ Photos</span>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, 40);
          if (!files.length) return;
          try {
            const imgs = await Promise.all(files.map((f) => resizeImage(f)));
            setImage(imgs[0]); setQueue(imgs.slice(1));
            if (imgs.length > 1) toast(`${imgs.length} photos ready — name & price each one`);
            nameRef.current?.focus();
          } catch (err) { toast(err instanceof Error ? err.message : 'Bad image', 'hot'); }
        }} />
        <div className="min-w-40 flex-1">
          <label htmlFor="item-name" className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Add item</label>
          <input id="item-name" ref={nameRef} className="input" placeholder="Item name, size" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </div>
        <div className="w-28">
          <label htmlFor="item-price" className="sr-only">Price</label>
          <input id="item-price" className="input" placeholder={`${currencySymbol()} Price`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} required />
        </div>
        <button className="btn bg-ink px-5 py-3 text-white" disabled={busy || !name.trim() || !price}>{busy ? <Spinner /> : 'Add'}</button>
      </div>
      {queue.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted">
          <div className="flex -space-x-2">{queue.slice(0, 6).map((q, i) => <img key={i} src={q} alt="" className="size-8 rounded-lg border-2 border-white object-cover" />)}</div>
          {queue.length} more photo{queue.length > 1 ? 's' : ''} queued — each one fills in after you add this item
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Tip: pick all your photos at once before going live, then just type name + price for each.</p>
    </form>
  );
}

function ItemRow({ it, claims, ended, isNext, holdSeconds, onDrop, onClose, onDelete }: {
  it: Item; claims: SellerClaim[]; ended: boolean; isNext: boolean; holdSeconds: number; onDrop: () => void; onClose: () => void; onDelete: () => void;
}) {
  const holder = claims.find((c) => c.status === 'holding' || c.status === 'paying');
  const waiting = claims.filter((c) => c.status === 'waiting');
  const winner = claims.find((c) => c.status === 'paid');
  const left = useCountdown(holder?.status === 'holding' ? holder.holdUntil : null);
  return (
    <div className={`rounded-2xl border bg-card p-3 ${it.status === 'live' ? 'border-hot' : 'border-line'}`}>
      <div className="flex items-center gap-3">
        <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-line"><ItemThumb name={it.name} image={it.image} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="text-xs font-bold text-muted">#{it.idx}</span><StatusChip status={it.status} /></div>
          <div className="truncate font-semibold">{it.name}</div>
          <div className="text-sm text-ink-2">{money(it.price)}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {(it.status === 'draft' || it.status === 'closed') && !ended && (
            <button className={`btn px-4 py-2 text-sm ${isNext ? 'anim-ring bg-hot-dark text-white' : 'border-2 border-hot text-hot-dark'}`} onClick={onDrop}>Drop now</button>
          )}
          {it.status === 'draft' && <button className="text-xs font-semibold text-muted hover:text-hot-dark" onClick={onDelete}>Delete</button>}
          {it.status === 'live' && <button className="text-xs font-semibold text-muted hover:text-ink" onClick={onClose}>Close</button>}
        </div>
      </div>
      {holder && (
        <div className="mt-3 rounded-xl bg-sun-soft px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Avatar id={holder.buyerId} name={holder.buyerName} size={22} />
            <span className="font-semibold">{holder.buyerName}</span>
            <span className="text-[#6b4600]">{holder.status === 'paying' ? 'says they paid — confirm in Payments →' : `has ${mmss(left)} to pay`}</span>
          </div>
          {holder.status === 'holding' && holder.holdUntil && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80"><div className="h-full rounded-full bg-sun transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, (left / (holdSeconds * 1000)) * 100))}%` }} /></div>
          )}
        </div>
      )}
      {waiting.length > 0 && <div className="mt-2 text-xs text-muted">Next in line: {waiting.map((w) => w.buyerName).join(' → ')}</div>}
      {winner && <div className="mt-2 text-sm font-semibold text-mint">Sold to {winner.buyerName}{winner.shippedAt ? ' · 📦 shipped' : ''}</div>}
      {winner && <ShipTo c={winner} />}
      {winner && !winner.shippedAt && <ShipButton c={winner} />}
      {winner?.shippedAt && winner.tracking && <div className="mt-1 text-xs text-muted">Tracking: {winner.tracking}</div>}
    </div>
  );
}

function ShipButton({ c }: { c: SellerClaim }) {
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState('');
  const toasts = useToasts();
  return (
    <>
      <button className="btn mt-2 bg-ink px-4 py-2 text-sm text-white" onClick={() => setOpen(true)}>📦 Mark shipped</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Ship to ${c.buyerName}`}>
        <form className="pb-2" onSubmit={async (e) => {
          e.preventDefault();
          try { await api.markShipped(c.id, tracking.trim()); toasts.push(`${c.buyerName} has been told it's on its way`, 'mint'); setOpen(false); }
          catch (err) { toasts.push(err instanceof Error ? err.message : 'Failed', 'hot'); }
        }}>
          <label htmlFor={`trk-${c.id}`} className="block text-sm font-semibold">Courier & tracking number <span className="font-normal text-muted">(optional)</span></label>
          <input id={`trk-${c.id}`} data-autofocus className="input mt-1" placeholder="e.g. DHL 1234567890" value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={120} />
          <button className="btn mt-4 w-full bg-ink py-3 text-white">Mark shipped & notify</button>
        </form>
      </Sheet>
    </>
  );
}

function ShipTo({ c }: { c: SellerClaim }) {
  if (!c.shipAddress) return null;
  return (
    <div className="mt-2 rounded-xl bg-paper px-3 py-2 text-[13px] leading-snug text-ink-2">
      <span className="font-semibold text-ink">Ship to {c.buyerName}:</span> {c.shipAddress} — {c.shipPincode}
      {c.shipPhone && <> · <a className="font-semibold text-ink underline" href={telHref(c.shipPhone)}>{c.shipPhone}</a></>}
    </div>
  );
}

function PayRow({ c, it, holdSeconds, onConfirm, onReject, onChat }: {
  c: SellerClaim; it: Item; holdSeconds: number; onConfirm: () => void; onReject: () => void; onChat: () => void;
}) {
  const left = useCountdown(c.status === 'holding' ? c.holdUntil : null);
  const paying = c.status === 'paying';
  return (
    <div className={`rounded-2xl border p-3 ${paying ? 'border-mint bg-mint-soft/50' : 'border-line'}`}>
      <div className="flex items-center gap-2">
        <Avatar id={c.buyerId} name={c.buyerName} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{c.buyerName} · {it?.name}</div>
          <div className="text-xs text-ink-2">{money(it?.price ?? 0)} · {paying ? <b className="text-mint">says they paid{c.utr ? ` · ref ${c.utr}` : ''}</b> : <>waiting for payment · <span className="tabular-nums">{mmss(left)}</span></>}</div>
        </div>
      </div>
      {!paying && c.holdUntil && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-sun transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, (left / (holdSeconds * 1000)) * 100))}%` }} /></div>
      )}
      <ShipTo c={c} />
      <div className="mt-2 flex gap-2">
        {paying
          ? <button className="btn flex-1 bg-mint py-2 text-sm text-white" onClick={onConfirm}>Payment received</button>
          : <span className="flex-1 self-center text-xs text-muted">Confirm unlocks when {c.buyerName.split(' ')[0]} taps “I've paid”.</span>}
        <button className="btn bg-paper px-3 py-2 text-sm" onClick={onReject}>Skip</button>
        <button className="btn bg-paper px-3 py-2 text-sm" onClick={onChat}>Chat</button>
      </div>
    </div>
  );
}

function Recap({ stats, items, claims, shop }: { stats: SellerDrop['stats']; items: Item[]; claims: SellerClaim[]; shop: string }) {
  const sold = items.filter((i) => i.status === 'sold').length;
  const dropped = items.filter((i) => i.status !== 'draft').length;
  const raced = new Set(claims.map((c) => c.itemId)).size ? items.filter((i) => claims.filter((c) => c.itemId === i.id).length > 1).length : 0;
  const paid = claims.filter((c) => c.status === 'paid' && c.paidAt && c.created);
  const avgPay = paid.length ? Math.round(paid.reduce((a, c) => a + ((c.paidAt as number) - c.created), 0) / paid.length / 1000) : null;
  const text = `🔥 ${shop}'s drop: ${sold}/${dropped} sold · ${money(stats.revenue)}${stats.recovered ? ` (${money(stats.recovered)} rescued from no-shows)` : ''} · ${raced} races settled fairly · 0 double-claims. Run fair live drops with ClaimIt.`;
  return (
    <section className="overflow-hidden rounded-[26px] bg-ink p-5 text-white shadow-[var(--shadow-card)]">
      <div className="text-xs font-bold uppercase tracking-wider text-white/60">Drop recap</div>
      <div className="mt-1 font-display text-4xl font-extrabold leading-none">{sold}/{dropped} sold · {money(stats.revenue)}</div>
      {/* What fairness was worth: sales "comment MINE" would have lost, and arguments that never happened. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-mint px-3 py-2.5">
          <div className="font-display text-2xl font-extrabold">{money(stats.recovered ?? 0)}</div>
          <div className="text-xs text-white/90">rescued from no-shows: {stats.recoveredItems ?? 0} item{stats.recoveredItems === 1 ? '' : 's'} sold to the next in line automatically</div>
        </div>
        <div className="rounded-xl bg-white/10 px-3 py-2.5">
          <div className="font-display text-2xl font-extrabold">{raced}</div>
          <div className="text-xs text-white/80">races settled with zero “I commented first!” disputes</div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[['Buyers joined', stats.viewers], ['Claim taps', stats.claimAttempts], ['Items with a race', raced], ['Avg time to pay', avgPay !== null ? mmss(avgPay * 1000) : '—'], ['Your avg confirm', stats.avgConfirmSec ? mmss(stats.avgConfirmSec * 1000) : '—']].map(([k, v]) => (
          <div key={k as string} className="rounded-xl bg-white/10 px-3 py-2"><div className="font-display text-xl font-extrabold">{v}</div><div className="text-[11px] text-white/70">{k}</div></div>
        ))}
      </div>
      <p className="mt-3 text-sm text-white/75">Zero double-claims: every item went to exactly one person, in front of everyone.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <CopyButton text={text} label="Copy recap" className="!bg-white !text-ink" />
        <a className="btn bg-[#075E54] px-4 py-2 text-sm text-white" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>Share on WhatsApp</a>
      </div>
    </section>
  );
}

/** The shop answers the room: buyers see these with a "Seller" badge (server-verified sender). */
const DEFAULT_REPLIES = ['Checking for you… ⏳', 'Yes! 🙌', 'Next item in 1 min', 'Sorry, sold out 🙏', 'Payment received, thank you! 💚'];

function RoomReply({ shopId, onSend }: { shopId: string; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // Quick replies are the shop's own words (saved on this device): the app never promises shipping or sizing for them.
  const storeKey = `claimit.replies.${shopId}`;
  const [replies, setReplies] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(storeKey) || 'null'); return Array.isArray(v) && v.length ? v : DEFAULT_REPLIES; } catch { return DEFAULT_REPLIES; }
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const saveReplies = (list: string[]) => {
    const clean = list.map((r) => r.trim().slice(0, 80)).filter(Boolean).slice(0, 8);
    setReplies(clean.length ? clean : DEFAULT_REPLIES);
    try { localStorage.setItem(storeKey, JSON.stringify(clean)); } catch { /* private mode */ }
  };
  const send = async (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    setBusy(true);
    try { await onSend(v.slice(0, 200)); setText(''); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 border-t border-line pt-2">
      {editing ? (
        <div className="pb-2">
          <label className="text-xs font-semibold text-muted" htmlFor="quick-replies">Your quick replies, one per line</label>
          <textarea id="quick-replies" className="input mt-1 text-sm" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-1.5 flex gap-2">
            <button className="btn bg-ink px-3 py-1.5 text-xs text-white" onClick={() => { saveReplies(draft.split('\n')); setEditing(false); }}>Save</button>
            <button className="btn bg-paper px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1.5">
          {replies.map((q) => (
            <button key={q} className="shrink-0 rounded-full bg-paper px-3 py-1 text-xs font-semibold hover:bg-line" disabled={busy} onClick={() => send(q)}>{q}</button>
          ))}
          <button className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted" onClick={() => { setDraft(replies.join('\n')); setEditing(true); }}>Edit</button>
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="input !py-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Reply to the room…" aria-label="Reply to the room" />
        <button className="btn bg-ink px-4 text-sm text-white" disabled={busy || !text.trim()}>{busy ? <Spinner /> : 'Send'}</button>
      </form>
    </div>
  );
}

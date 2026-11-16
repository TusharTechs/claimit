import { useEffect, useRef, useState } from 'react';
import { rt, type RtMessage } from '../rt';
import { MSG, ORDER_STATUS, type OrderContent, type OrderUpdateContent } from '../../../shared/types';
import { money } from '../util';

/** 1:1 Direct channel between a buyer and the seller: order cards, status updates and free text. */
export function DMThread({ peerId, peerName, onActivity, compact = false }: {
  peerId: string; peerName: string; onActivity?: (m: RtMessage) => void; compact?: boolean;
}) {
  const [msgs, setMsgs] = useState<RtMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const activity = useRef(onActivity);
  activity.current = onActivity;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    rt.history(peerId).then((h) => { if (alive) { setMsgs(h); setLoading(false); } }).catch(() => setLoading(false));
    const off = rt.onMessage((m) => {
      if (m.kind !== 'direct' || m.channelId !== peerId) return;
      setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m]));
      activity.current?.(m);
    });
    // The order card's status chip updates in place when the server changes its Nexconn message metadata.
    const offMeta = rt.onMessageMeta((messageId, peer, md) => {
      if (peer !== peerId) return;
      setMsgs((x) => x.map((m) => (m.id === messageId ? { ...m, meta: { ...(m.meta || {}), ...md } } : m)));
    });
    return () => { alive = false; off(); offMeta(); };
  }, [peerId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const sent = await rt.sendDirect(peerId, MSG.TEXT, { text: t });
    if (sent) setMsgs((x) => [...x, sent]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto ${compact ? 'max-h-72' : ''} py-2`}>
        {loading && <div className="py-6 text-center text-sm text-muted">Loading chat…</div>}
        {!loading && msgs.length === 0 && <div className="py-6 text-center text-sm text-muted">No messages with {peerName} yet.</div>}
        {msgs.map((m) => <Bubble key={m.id} m={m} peerId={peerId} />)}
        <div ref={endRef} />
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="input !rounded-full !py-2.5" placeholder={`Message ${peerName}…`} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <button className="btn bg-ink px-4 text-white" disabled={!text.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9z" /></svg>
        </button>
      </form>
    </div>
  );
}

function Bubble({ m, peerId }: { m: RtMessage; peerId: string }) {
  // Order cards only count when they come from the shop this thread is with (or ClaimIt itself, or yourself as that shop).
  // Anyone else — another buyer, or a different "shop" — is shown as a fake.
  const trusted = m.sender === peerId || m.sender === 's_claimit' || (m.mine && m.sender.startsWith('s_'));
  if ((m.type === MSG.ORDER || m.type === MSG.ORDER_UPDATE) && !trusted) {
    return <div className="mx-auto max-w-xs rounded-xl bg-hot-soft px-3 py-2 text-center text-[13px] text-hot-dark">⚠️ Hidden: a fake order message</div>;
  }
  if (m.type === MSG.ORDER) {
    const o = m.content as OrderContent;
    const st = ORDER_STATUS[m.meta?.s ?? ''];
    const chip = st ? { sun: 'bg-sun-soft text-[#6b4600]', mint: 'bg-mint text-white', muted: 'bg-line text-ink-2', hot: 'bg-hot-soft text-hot-dark' }[st.tone] : '';
    return (
      <div className="anim-rise mx-auto w-full max-w-xs rounded-2xl border-2 border-mint/40 bg-mint-soft p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wider text-mint">Order card</div>
          {st && <span key={m.meta?.s} className={`anim-pop rounded-full px-2 py-0.5 text-[11px] font-bold ${chip}`}>{st.label}</span>}
        </div>
        <div className="mt-1 flex items-center gap-3">
          {o.image && <img src={o.image} alt="" className="size-12 rounded-xl object-cover" />}
          <div className="min-w-0">
            <div className="truncate font-semibold">{o.itemName}</div>
            <div className="text-sm text-ink-2">{money(o.price, o.currency)} · {o.upi ? `UPI ${o.upi}` : o.payLink ? 'payment link' : 'bank / wallet transfer'}</div>
          </div>
        </div>
      </div>
    );
  }
  if (m.type === MSG.ORDER_UPDATE) {
    const u = m.content as OrderUpdateContent;
    return <div className="mx-auto max-w-xs whitespace-pre-line rounded-xl bg-line/50 px-3 py-2 text-center text-[13px] text-ink-2">{u.text}</div>;
  }
  const text = m.content?.text ?? m.content?.content ?? '';
  return (
    <div className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] ${m.mine ? 'rounded-br-md bg-ink text-white' : 'rounded-bl-md bg-white text-ink shadow-sm'}`}>{text}</div>
    </div>
  );
}

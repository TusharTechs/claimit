import { useEffect, useRef, useState } from 'react';
import { rt, type RtMessage } from '../rt';
import { MSG, type OrderContent, type OrderUpdateContent } from '../../../shared/types';
import { rupees } from '../util';

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
    return () => { alive = false; off(); };
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
        {msgs.map((m) => <Bubble key={m.id} m={m} />)}
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

function Bubble({ m }: { m: RtMessage }) {
  if (m.type === MSG.ORDER) {
    const o = m.content as OrderContent;
    return (
      <div className="anim-rise mx-auto w-full max-w-xs rounded-2xl border-2 border-mint/40 bg-mint-soft p-3">
        <div className="text-xs font-bold uppercase tracking-wider text-mint">Order card</div>
        <div className="mt-1 flex items-center gap-3">
          {o.image && <img src={o.image} alt="" className="size-12 rounded-xl object-cover" />}
          <div className="min-w-0">
            <div className="truncate font-semibold">{o.itemName}</div>
            <div className="text-sm text-ink-2">{rupees(o.price)} · pay to {o.upi}</div>
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

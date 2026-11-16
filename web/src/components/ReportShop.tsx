import { useState } from 'react';
import { Flag } from 'lucide-react';
import { api } from '../api';
import { ensureBuyer } from '../buyer';
import { Sheet, Spinner } from './ui';

const REASONS: [string, string][] = [
  ['no_item', "I paid but didn't get the item"],
  ['payment_not_confirmed', 'I paid but the shop never confirmed'],
  ['scam', 'Someone asked me to pay outside my order'],
  ['other', 'Something else'],
];

/** Buyer protection for direct payments: report a shop. Reports count against the shop's public trust line. */
export function ReportShop({ sellerId, shop, className = '' }: { sellerId: string; shop: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('no_item');
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  return (
    <>
      <button className={`inline-flex items-center gap-1.5 text-sm font-semibold text-muted underline ${className}`} onClick={() => setOpen(true)}>
        <Flag className="size-3.5" /> Report this shop
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Report ${shop}`}>
        {state === 'done' ? (
          <div className="py-4 text-center">
            <p className="font-semibold">Thanks, we've got it.</p>
            <p className="mt-1 text-sm text-muted">Reports show on the shop's trust line so other buyers can see them, and we review every one.</p>
          </div>
        ) : (
          <form className="space-y-2 pb-2" onSubmit={async (e) => {
            e.preventDefault(); setState('busy');
            try { await ensureBuyer(); await api.reportShop(sellerId, reason, text.trim()); setState('done'); } catch { setState('error'); }
          }}>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-semibold">What happened?</legend>
              {REASONS.map(([v, l]) => (
                <label key={v} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${reason === v ? 'border-ink bg-white' : 'border-line'}`}>
                  <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => setReason(v)} className="accent-ink" /> {l}
                </label>
              ))}
            </fieldset>
            <label className="block text-sm font-semibold" htmlFor="report-text">Details <span className="font-normal text-muted">(optional)</span></label>
            <textarea id="report-text" className="input text-sm" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Item, date, amount paid…" />
            {state === 'error' && <p className="text-sm font-semibold text-hot-dark">Couldn't send the report. Try again.</p>}
            <button className="btn w-full bg-ink py-3 text-white" disabled={state === 'busy'}>{state === 'busy' ? <Spinner /> : 'Send report'}</button>
          </form>
        )}
      </Sheet>
    </>
  );
}

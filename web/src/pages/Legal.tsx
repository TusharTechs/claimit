import { Link } from 'react-router-dom';
import { Logo } from '../components/ui';

export default function Legal({ page }: { page: 'privacy' | 'terms' }) {
  return (
    <div className="mx-auto min-h-full max-w-2xl px-4 pb-16 sm:px-6">
      <header className="py-4"><Link to="/"><Logo className="text-xl" /></Link></header>
      {page === 'privacy' ? (
        <article className="space-y-4 text-ink-2">
          <h1 className="font-display text-4xl font-extrabold text-ink">Privacy</h1>
          <p><b>What we collect.</b> The name you choose, and — only when you pay for an item — your phone number and delivery address, so the seller can ship it. Sellers give us their name, shop name and how buyers pay them (a payment link or UPI ID).</p>
          <p><b>Who sees it.</b> Your name is shown in a drop's live queue. Your phone and address are shown only to the seller you bought from. We never sell data or show ads.</p>
          <p><b>Payments.</b> You pay the seller directly — through the seller's own payment link or UPI ID. ClaimIt never sees your bank or card details and never holds money.</p>
          <p><b>Chat.</b> Messages are delivered through Nexconn, our real-time messaging provider. Room chat is not stored after a drop; order chats are kept so you and the seller can refer back.</p>
          <p><b>Deleting your data.</b> Ask the seller in your order chat, or contact us, and we'll remove your details.</p>
        </article>
      ) : (
        <article className="space-y-4 text-ink-2">
          <h1 className="font-display text-4xl font-extrabold text-ink">Terms</h1>
          <p><b>What ClaimIt does.</b> ClaimIt runs the claim queue for a seller's live drop, anywhere in the world: first tap wins, the queue is visible to everyone, and an unpaid hold passes to the next person after the seller's time limit.</p>
          <p><b>Sales are between buyer and seller.</b> The seller sets prices, takes payment (through their own payment link or UPI) and ships the item. ClaimIt is not a party to the sale and doesn't hold funds.</p>
          <p><b>Fair use.</b> One person, one identity. Don't claim items you don't intend to buy, impersonate a seller, or post payment details in room chat — we hide them to protect buyers.</p>
          <p><b>Sellers</b> must only list items they own and can ship, and must confirm payments honestly.</p>
        </article>
      )}
      <p className="mt-10 text-sm text-muted"><Link to="/privacy" className="underline">Privacy</Link> · <Link to="/terms" className="underline">Terms</Link> · <Link to="/pricing" className="underline">Pricing</Link></p>
    </div>
  );
}

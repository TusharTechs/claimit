import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  BarChart3, Boxes, Cog, Gem, Handshake, HeartHandshake, PieChart, Truck, Users, type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/ui';

/** One canvas block. `live` points at the part of the product that already delivers it. */
interface Block { n: number; title: string; icon: LucideIcon; points: (string | [string, string])[]; live?: [string, string][]; area: string; tone: string; assume?: string }

const BLOCKS: Block[] = [
  {
    n: 8, title: 'Key partners', icon: Handshake, area: 'lg:[grid-area:kp]', tone: 'bg-card',
    points: [
      ['Nexconn', 'real-time infrastructure: open channels and metadata for the live queue, priority messages, direct channels with message metadata for order cards, pre-message webhooks for anti-scam, and Chat UI for the seller inbox.'],
      ['Payment rails the seller already has', 'PayPal, Venmo, Cash App, Stripe links, UPI, GCash and bank transfer. No integration or contract is needed to launch, and money never touches ClaimIt.'],
      ['Social platforms', 'Instagram, TikTok, Facebook and YouTube Live are where the audience already is. ClaimIt works beside them with just a link, so a platform API change can\'t break it.'],
      ['Seller communities', 'reseller Discords, Facebook groups and live-selling coaches, who are the distribution channel for new sellers.'],
    ],
  },
  {
    n: 7, title: 'Key activities', icon: Cog, area: 'lg:[grid-area:ka]', tone: 'bg-card',
    points: [
      'Running a fair, real-time claim arbiter: one winner per item, every time',
      'Trust and safety: masking scam payment details, blocking forged order cards, a seller track record',
      'Seller onboarding and community: practice drops, the demo room, founding-seller program',
      'Product: payment automation, co-host tools, analytics',
    ],
    live: [['Practice drop', '/sell']],
  },
  {
    n: 6, title: 'Key resources', icon: Boxes, area: 'lg:[grid-area:kr]', tone: 'bg-card',
    points: [
      'The claim engine: transactional queue, presence-aware promotion, coalesced metadata fan-out (proprietary)',
      'Seller trust data: confirmed orders and confirm speed, which compound with every drop',
      'Nexconn infrastructure: rooms of any size with no servers to scale',
      'A follower graph per shop: every drop notifies its followers',
    ],
  },
  {
    n: 2, title: 'Value propositions', icon: Gem, area: 'lg:[grid-area:vp]', tone: 'bg-hot-soft',
    points: [
      ['For sellers: no double-sells or "I commented first!" fights.', 'The first tap wins, and everyone watches the queue.'],
      ['Sales rescued from no-shows.', 'If a winner doesn\'t pay in time, the next person is promoted automatically. Every recap shows how much money that rescued.'],
      ['Keep 100% of the money.', 'Buyers pay your own PayPal, UPI or bank account. 0% commission.'],
      ['Set up in 20 seconds.', 'One link, no store, no app for buyers, on any platform.'],
      ['For buyers: a real, visible fair shot.', 'You see your place in line and the seller\'s track record, and the chat is cleaned of scam payment details.'],
      ['Versus the alternatives:', 'comment threads are chaos. Store-based live-selling tools need a full shop and a monthly contract. Live marketplaces take a commission and own the customer. ClaimIt is the only option that is link-based, works on any platform, charges 0% commission, and lets the seller keep the customer.'],
    ],
    live: [['Try the demo', '/d/demo']],
  },
  {
    n: 4, title: 'Customer relationships', icon: HeartHandshake, area: 'lg:[grid-area:cr]', tone: 'bg-card',
    points: [
      'Self-serve and product-led, with no sales calls',
      'Retention loop: buyers follow a shop and get notified of its next drop, and the seller reuses the last drop\'s items with "Run again"',
      'A recap after every drop shows the value delivered',
      'Buyers keep all their orders in one place, with no account needed',
      'Founding sellers get 50% off for a year and help shape the roadmap',
    ],
    live: [['My orders', '/orders']],
    assume: 'Retention rates are unmeasured until pilots run.',
  },
  {
    n: 3, title: 'Channels', icon: Truck, area: 'lg:[grid-area:ch]', tone: 'bg-card',
    points: [
      'Built-in virality: every drop is shared to stories and WhatsApp. Buyers share their wins, and every recap says "Run fair drops with ClaimIt"',
      'A self-serve trial through the public demo room and practice drops',
      'Seller-to-seller referrals: an invite link gives the new shop a 30-day trial, and the inviter a month of Pro once the new shop has 3 independent paying customers and no disputes',
      'Seller communities and live-selling coaches, plus buyer share links that track which shares bring people in',
      'Every shop has a public page with its drops and followers, which is a link sellers put in their bio',
    ],
  },
  {
    n: 1, title: 'Customer segments', icon: Users, area: 'lg:[grid-area:cs]', tone: 'bg-card',
    points: [
      ['Primary: independent social sellers', 'who run live sales of one-of-a-kind stock, such as thrift and vintage, boutique fashion, sneakers, jewellery, plants and collectibles. Typically 1–5 people who sell weekly and have no full online store.'],
      ['Their jobs:', 'sell 20–100 items in an hour, get paid and ship.'],
      ['Their pains:', 'double claims, ghosting winners, scrolling comments, chasing payments, and scammers who pose as the seller.'],
      ['The free side:', 'their buyers, who want a fair shot.'],
      ['Launch markets:', '"mine" comment-selling is already a habit in the Philippines, Indonesia and Malaysia, alongside US resale lives and Indian Instagram thrift with UPI.'],
      ['Sizing (bottom-up):', 'shops × $108 a year. Every 10,000 Pro shops is about $1.1M in annual recurring revenue. Shop counts per market are an assumption to validate in pilots.'],
      ['Next:', 'live-selling agencies and co-host teams.'],
    ],
  },
  {
    n: 9, title: 'Cost structure', icon: PieChart, area: 'lg:[grid-area:co]', tone: 'bg-card',
    points: [
      ['Variable:', 'Nexconn messaging, which is priced per monthly active user (MAU). At launch, Nexconn\'s free plan covers the first 10,000 MAU, which is roughly 50 shops with about 200 buyers a month each. Confirm the current limit in the Console.'],
      ['Fixed:', 'one small VM and a domain. One Node process settled 200 simultaneous claims in about 40 ms in our race test.'],
      ['Costs ClaimIt never has:', 'payment processing, holding funds, chargebacks or money-transmitter licensing, because buyers pay sellers directly.'],
      ['Key drivers:', 'MAU above the free plan, and support time. Both grow more slowly than revenue as sellers move to Pro.'],
    ],
    assume: 'Nexconn per-MAU price above the free plan is to be confirmed.',
  },
  {
    n: 5, title: 'Revenue streams', icon: BarChart3, area: 'lg:[grid-area:rs]', tone: 'bg-mint-soft',
    points: [
      ['Pro at $9 a month, flat, with 0% commission.', 'Live today: co-hosts (up to 5 helpers who confirm payments and drop items while you present), lifetime analytics (no-show rate, repeat buyers, time to pay, best hour) and scheduled drops with a countdown and calendar invites. Pro is paid through ClaimIt\'s own payment link with operator confirmation, and a card processor\'s webhook can replace that step later. Coming next: automatic payment confirmation through gateways, and a custom shop link.'],
      ['Terms:', 'a 14-day free trial with no card (30 days for invited shops), then monthly. The first 100 shops are flagged as founding sellers with 50% off year one. Each referral earns a month free once the invited shop has 3 independent paying customers.'],
      ['What drives revenue:', 'sellers who run several drops a week, who need co-hosts and automation. That group is also the most active on the free tier.'],
      ['Later:', 'a team plan for agencies that run drops for several shops.'],
    ],
    live: [['Pricing', '/pricing']],
    assume: 'Payment is collected through a link and confirmed by an operator, not yet by a card processor.',
  },
];

/** Acquisition cost per new Pro shop, by channel. LTV is $145 (or $97 for a founding shop). All inputs are assumptions. */
const CAC: [string, string, string][] = [
  ['Buyer sees ClaimIt in a drop', '≈ $0: built into every drop and recap', '—'],
  ['Seller invites seller', '≈ $1: one month of Pro costs about 10% of $9 to serve', '≈ 97–145 : 1'],
  ['Live-selling coach or community', '≈ $11–22: 20% of a first year ($4.50 founding / $9 standard)', '≈ 6.6–8.8 : 1'],
  ['Paid social ads (not planned at launch)', '≈ $40–60 (assumed)', '≈ 1.6–3.6 : 1'],
];

export default function Business() {
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/"><Logo className="text-xl" /></Link>
        <nav className="flex items-center gap-2 text-sm font-semibold">
          <Link to="/pricing" className="rounded-full px-3 py-2 hover:bg-white">Pricing</Link>
          <Link to="/d/demo" className="btn bg-ink px-4 py-2 text-white">Try the demo</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <p className="mt-4 text-sm font-bold uppercase tracking-wider text-hot-dark">Business model</p>
        <h1 className="mt-1 font-display text-4xl font-extrabold leading-none sm:text-5xl">How ClaimIt creates, delivers and captures value</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-2">ClaimIt's model on one page. Anything not yet proven by real drops is marked as an assumption.</p>

        <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-5 lg:[grid-template-areas:'kp_ka_vp_cr_cs'_'kp_kr_vp_ch_cs'_'co_co_co_rs_rs']">
          {BLOCKS.map((b, i) => (
            <motion.section key={b.n} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.03 }}
              style={{ order: b.n }}
              className={`rounded-[22px] border border-line p-5 shadow-[var(--shadow-card)] lg:!order-none ${b.tone} ${b.area}`}>
              <h2 className="flex items-center gap-2.5 font-display text-lg font-bold">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-white"><b.icon className="size-4.5" /></span>
                <span><span className="text-muted">{b.n}.</span> {b.title}</span>
              </h2>
              <ul className="mt-3 space-y-2 text-[14px] leading-snug text-ink-2">
                {b.points.map((p, j) => (
                  <li key={j} className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-hot" />
                    {typeof p === 'string' ? <span>{p}</span> : <span><b className="text-ink">{p[0]}</b> {p[1]}</span>}
                  </li>
                ))}
              </ul>
              {b.assume && <p className="mt-3 rounded-xl bg-sun-soft px-3 py-2 text-xs font-semibold text-[#6b4600]">Assumption: {b.assume}</p>}
              {b.live && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {b.live.map(([label, href]) => (
                    <Link key={href} to={href} className="rounded-full bg-mint px-2.5 py-1 text-xs font-bold text-white hover:bg-ink">● Live: {label} →</Link>
                  ))}
                </div>
              )}
            </motion.section>
          ))}
        </div>

        {/* Unit economics: explicit, checkable arithmetic, with assumptions labelled. */}
        <section className="mt-10 grid gap-4 lg:grid-cols-3">
          <div className="rounded-[26px] bg-ink p-6 text-white lg:col-span-2">
            <h2 className="font-display text-2xl font-extrabold">Unit economics of a Pro seller</h2>
            <p className="mt-1 text-sm text-white/70">Illustrative. The inputs are assumptions until pilot shops report real numbers.</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['$9', 'revenue per month'], ['4', 'drops a month (assumed)'], ['~150', 'unique buyers = MAU (assumed)'], ['$0', 'payment cost: buyers pay the seller directly']].map(([v, k]) => (
                <div key={k} className="rounded-2xl bg-white/10 p-3"><dt className="font-display text-2xl font-extrabold">{v}</dt><dd className="text-xs text-white/75">{k}</dd></div>
              ))}
            </dl>
            <p className="mt-4 text-[15px] text-white/90">
              <b>Break-even:</b> a Pro seller pays for itself as long as Nexconn's price is below <b>$9 ÷ 150 ≈ $0.06 per monthly active user</b>, plus a share of one small server.
              Within the free plan (the first 10,000 MAU), each Pro seller is nearly all margin. And what the seller saves pays for Pro on its own: a <b>single sale rescued from a no-show</b> each month usually covers $9.
            </p>
            <p className="mt-3 text-[15px] text-white/90">
              <b>LTV vs. acquisition cost:</b> at roughly 90% gross margin and an assumed 18-month lifetime, a Pro shop is worth about <b>$145</b> ($9 × 0.9 × 18).
              A founding shop is worth about <b>$97</b> ($4.50 × 0.9 × 12 + $9 × 0.9 × 6). The 18 months is an assumption: tools sellers use every week tend to be sticky, and pilots will measure it.
            </p>
            {/* Phones: one card per channel; wider screens: a table. */}
            <ul className="mt-3 space-y-2 sm:hidden">
              {CAC.map(([ch, cost, ratio]) => (
                <li key={ch} className="rounded-xl bg-white/10 p-3 text-sm"><div className="font-semibold">{ch}</div><div className="text-white/85">{cost}</div><div className="mt-0.5 font-bold">LTV : CAC {ratio}</div></li>
              ))}
            </ul>
            <table className="mt-3 hidden w-full text-left text-sm sm:table">
              <thead className="text-white/70"><tr><th scope="col" className="py-1 font-semibold">Channel</th><th scope="col" className="font-semibold">Cost per new Pro shop (assumed)</th><th scope="col" className="whitespace-nowrap font-semibold">LTV : CAC</th></tr></thead>
              <tbody className="text-white">
                {CAC.map(([ch, cost, ratio]) => (
                  <tr key={ch} className="border-t border-white/15"><td className="py-1.5 pr-3">{ch}</td><td className="pr-3">{cost}</td><td className="whitespace-nowrap">{ratio}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-white/70">A blended acquisition cost under $25 keeps LTV : CAC above 5 : 1. Every figure here is an assumption until pilot shops report real numbers.</p>
          </div>
          <div className="rounded-[26px] border border-line bg-card p-6 shadow-[var(--shadow-card)]">
            <h2 className="font-display text-2xl font-extrabold">Impact</h2>
            <ul className="mt-3 space-y-2 text-[15px] text-ink-2">
              <li><b className="text-ink">Micro-sellers keep their income.</b> 0% commission, compared with marketplace fees on every sale.</li>
              <li><b className="text-ink">Buyers get a fair shot.</b> The queue is public, so no favouritism and no "I was first!" fights.</li>
              <li><b className="text-ink">Fewer scams.</b> Payment details posted in chat are masked, fake order cards are blocked, and every shop shows its track record.</li>
              <li><b className="text-ink">It works in any market,</b> with any currency and any payment method.</li>
            </ul>
            <Link to="/impact" className="mt-4 inline-block text-sm font-bold text-hot-dark underline">Live impact numbers →</Link>
          </div>
        </section>

        <section className="mt-10 rounded-[26px] border border-line bg-card p-6 shadow-[var(--shadow-card)]">
          <h2 className="font-display text-2xl font-extrabold">Why now, and why it's defensible</h2>
          <div className="mt-3 grid gap-4 text-[15px] text-ink-2 md:grid-cols-3">
            <p><b className="text-ink">Why now:</b> live selling has moved from big brands to one-person shops on every social platform, but their checkout is still a comment thread. Real-time infrastructure like Nexconn makes a fair, shared queue cheap enough to give away.</p>
            <p><b className="text-ink">Moat:</b> each shop's followers and track record (confirmed orders, confirm speed) live in ClaimIt and grow with every drop, which makes switching costly. Buyers also learn the same Claim button across every shop they follow.</p>
            <p><b className="text-ink">Risks and answers:</b> platforms could build this natively, but ClaimIt works across all of them, and sellers sell on several. Direct payment carries trust risk, which the trust line, scam masking and forged-card blocking address. Nexconn costs rise past the free plan, which the break-even above covers.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

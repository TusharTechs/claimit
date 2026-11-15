import { Link } from 'react-router-dom';
import { Logo } from '../components/ui';

const steps = [
  { n: '1', t: 'Drop', d: 'Share one link to your Instagram story or WhatsApp group. Buyers join in a tap — no app, no signup.' },
  { n: '2', t: 'Claim', d: 'Post an item. Everyone sees one big Claim button and a live queue: who has it, who is next.' },
  { n: '3', t: 'Get paid', d: 'The winner gets a private order chat with your UPI link and a timer. Miss it? The next person in line gets it, automatically.' },
];

export default function Landing() {
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo className="text-xl" />
        <Link to="/sell" className="btn bg-ink px-4 py-2 text-sm text-white">Seller login</Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <section className="grid items-center gap-10 pt-6 sm:pt-12 md:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-hot-soft px-3 py-1 text-xs font-bold uppercase tracking-wider text-hot-dark">
              <span className="anim-live size-2 rounded-full bg-hot" /> For live & WhatsApp sellers
            </p>
            <h1 className="font-display text-[44px] font-extrabold leading-[0.95] sm:text-6xl">
              "Comment MINE"<br />is broken.<br /><span className="text-hot">Claim it fair.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg text-ink-2">
              No more scrolling comments, double-claims and chasing payment in DMs. ClaimIt turns your live sale into a
              first-come queue everyone can see — and hands the winner straight to checkout.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/sell" className="btn anim-ring bg-hot px-6 py-3.5 text-lg text-white shadow-[var(--shadow-pop)]">Start a drop — free</Link>
              <a href="#how" className="btn border-2 border-ink px-6 py-3 text-lg">How it works</a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-sm">
            <div className="rounded-[30px] border border-line bg-card p-4 shadow-[var(--shadow-card)]">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-display font-bold">Asha's Thrift</span>
                <span className="flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white"><span className="anim-live size-1.5 rounded-full bg-hot" />LIVE · 214</span>
              </div>
              <div className="aspect-[4/3] rounded-2xl bg-[linear-gradient(135deg,#ffd9c7,#ffb59a_45%,#ff7a52)]" />
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="font-display text-lg font-bold">Vintage denim jacket</div>
                  <div className="text-sm text-muted">#12 · Size M</div>
                </div>
                <div className="font-display text-2xl font-extrabold">₹899</div>
              </div>
              <div className="mt-3 rounded-2xl bg-sun-soft px-3 py-2 text-sm font-semibold text-[#8a5a00]">Held by Priya · 4:12 left · 2 in line</div>
              <button className="btn mt-3 w-full bg-ink py-3.5 text-white" tabIndex={-1}>Join waitlist (#3)</button>
            </div>
            <div className="anim-stamp absolute -right-3 -top-4 rounded-xl border-4 border-mint bg-white px-3 py-1 font-display text-xl font-extrabold text-mint">FAIR</div>
          </div>
        </section>

        <section id="how" className="mt-20 grid gap-4 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="rounded-3xl border border-line bg-card p-6 shadow-[var(--shadow-card)]">
              <div className="mb-3 grid size-10 place-items-center rounded-full bg-hot font-display text-lg font-extrabold text-white">{s.n}</div>
              <div className="font-display text-2xl font-bold">{s.t}</div>
              <p className="mt-2 text-ink-2">{s.d}</p>
            </div>
          ))}
        </section>

        <section className="mt-14 rounded-[32px] bg-plum p-8 text-white sm:p-10">
          <h2 className="font-display text-3xl font-extrabold">Built for a room of 500, not 5.</h2>
          <p className="mt-3 max-w-2xl text-white/80">
            Live rooms run on Nexconn open channels. Product drops and claims are priority messages, so they land even when
            hundreds of people are chatting at once; fan chatter is the first thing shed under load. The claim queue is shared
            live state that every viewer sees update at the same moment.
          </p>
        </section>
      </main>

      <footer className="border-t border-line py-6 text-center text-sm text-muted">ClaimIt · made for India's social sellers</footer>
    </div>
  );
}

import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Series, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FPS, display, mono, sans } from './theme';
import { M, actorOf, data, has } from './data';
import { Backdrop, Browser, Captions, Heading, Logo, NexTag, Phone, Pop, Rise, Speed, Terminal, Wire, parts, srcAt, wireRows, type Part } from './components';

const HOST = '35-224-27-222.sslip.io';
const TINT: Record<string, string> = { buyer1: '#ff4a1c', buyer2: '#2f6fed', buyer3: '#b4531f', buyer4: '#6b6259', seller: '#0b8457' };
const nameOf = (a: string) => data.names[a] ?? a;
const frames = (id: string, pad = 0.9) => Math.ceil(((data.vo[id] ?? 4) + pad) * FPS);
const VO_AT = 7;

const hookSeen = data.activity.some((e) => e.dir === 'webhook' && /pre_messaging/.test(e.what));
const inboxSeen = has('inbox_open') && has('inbox_seen');
const SCAM = hookSeen ? 'scam_hook' : 'scam_mask';
const REPLY = inboxSeen ? 'reply' : 'reply_noinbox';
const race = data.facts.race ?? { winner: 'Priya', first: 'Leo', second: 'Mei', winners: 1 };
const aWinner = actorOf(race.winner), aFirst = actorOf(race.first), aSecond = actorOf(race.second);

// ---------- scene shell ----------
const Scene: React.FC<{ vo?: string; dark?: boolean; children: React.ReactNode; top?: React.ReactNode; ps?: Part[]; logo?: boolean }> = ({ vo, dark, children, top, ps, logo = true }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fade = Math.min(interpolate(f, [0, 7], [0, 1], { extrapolateRight: 'clamp' }), interpolate(f, [durationInFrames - 5, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' }));
  return (
    <AbsoluteFill>
      <Backdrop dark={dark} />
      <AbsoluteFill style={{ opacity: fade }}>
        {children}
        {logo && <div style={{ position: 'absolute', left: 44, top: 32 }}><Logo size={30} light={dark} /></div>}
        {top && <div style={{ position: 'absolute', left: 0, right: 0, top: 26, display: 'flex', justifyContent: 'center', gap: 12 }}>{top}</div>}
        {ps && <Speed ps={ps} />}
      </AbsoluteFill>
      {vo && <Sequence from={VO_AT} layout="none"><Audio src={staticFile(`vo/${vo}.wav`)} /></Sequence>}
      {vo && <Captions text={data.voText[vo] ?? ''} start={VO_AT} frames={Math.round((data.vo[vo] ?? 0) * FPS)} dark={dark} />}
    </AbsoluteFill>
  );
};
const Row: React.FC<{ children: React.ReactNode; gap?: number; align?: React.CSSProperties['alignItems'] }> = ({ children, gap = 48, align = 'center' }) => (
  <AbsoluteFill style={{ display: 'flex', flexDirection: 'row', alignItems: align, justifyContent: 'center', gap, padding: '92px 50px 128px' }}>{children}</AbsoluteFill>
);

// ---------- 1. cold open: the problem ----------
const COMMENTS = ['MINE', 'mine!!', 'MINE 🙋‍♀️', 'Mine', 'MINE MINE', 'me!! mine', 'MINE pls', 'mine 🔥', 'MINEEE', 'Mine!', 'i was first', 'MINE', 'mine??', 'MINE 😭', 'no I was first', 'Mine', 'MINE!!!', 'mine', 'still available?', 'MINE'];
const WHO = ['priya.k', 'leo_thrifts', 'mei.w', 'sana', 'jo.b', 'ana_r', 'dev', 'kim', 'rae', 'tess', 'omar', 'liv', 'noor', 'max', 'isa', 'ben', 'zoe', 'ray', 'ida', 'sol'];
const ColdOpen: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flood = 128; // "Then forty people comment in the same second"
  const n = Math.max(0, Math.min(40, Math.floor((f - flood) * 1.1)));
  const ask = spring({ frame: f - 212, fps, config: { damping: 14 } });
  const shake = f > flood && f < flood + 50 ? Math.sin(f * 2.1) * 3 : 0;
  return (
    <Scene vo="cold" logo={false}>
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 56, paddingBottom: 90, filter: `blur(${ask * 7}px)`, opacity: 1 - ask * 0.45 }}>
        <Rise delay={4} y={40}>
          <div style={{ width: 520, borderRadius: 28, background: C.card, boxShadow: '0 50px 100px -40px rgba(23,18,14,.45)', overflow: 'hidden', transform: `translateX(${shake}px)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', fontFamily: sans, fontWeight: 700, fontSize: 20, color: C.ink }}>
              <span style={{ width: 40, height: 40, borderRadius: '50%', background: C.mint, color: '#fff', display: 'grid', placeItems: 'center' }}>M</span>mayas.vintage
              <span style={{ marginLeft: 'auto', fontWeight: 500, fontSize: 16, color: C.muted }}>8:00 PM</span>
            </div>
            <Img src={staticFile('denim-jacket.jpg')} style={{ width: 520, height: 470, objectFit: 'cover', display: 'block' }} />
            <div style={{ padding: '18px 22px 24px', fontFamily: sans, fontSize: 23, lineHeight: 1.4, color: C.ink }}>
              <b>Vintage denim jacket · M · $42.</b><br />First to comment <b style={{ color: C.hot }}>MINE</b> gets it! 🧥
            </div>
          </div>
        </Rise>
        <div style={{ width: 560, height: 700, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10 }}>
          {Array.from({ length: n }).map((_, i) => {
            const s = spring({ frame: f - flood - i / 1.1, fps, config: { damping: 16, mass: 0.5 } });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderRadius: 16, background: C.card, boxShadow: '0 8px 20px -14px rgba(23,18,14,.4)', fontFamily: sans, fontSize: 21, color: C.ink, opacity: s, transform: `translateX(${(1 - s) * 60}px)`, flexShrink: 0 }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: ['#ff4a1c', '#2f6fed', '#b4531f', '#0b8457', '#2b1838'][i % 5], flexShrink: 0 }} />
                <b>{WHO[i % WHO.length]}</b><span>{COMMENTS[i % COMMENTS.length]}</span>
                <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 15, color: C.hot, fontWeight: 700 }}>8:00:01 PM</span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ display: 'grid', placeItems: 'center', paddingBottom: 90 }}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: 150, letterSpacing: -5, color: C.ink, opacity: ask, transform: `scale(${0.85 + 0.15 * ask})` }}>Who was <span style={{ color: C.hot }}>first?</span></div>
      </AbsoluteFill>
    </Scene>
  );
};

// ---------- 2. title ----------
const Title: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 13 } });
  const beats = [['One link.', 44], ['One tap.', 64], ['One winner.', 84]] as const;
  return (
    <Scene vo="title" logo={false}>
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34, paddingBottom: 80 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 34, transform: `scale(${0.7 + 0.3 * s})`, opacity: Math.min(1, s * 1.4) }}>
          <Img src={staticFile('logo-mark.svg')} style={{ height: 170 }} />
          <span style={{ fontFamily: display, fontWeight: 800, fontSize: 190, letterSpacing: -8, color: C.ink }}>ClaimIt</span>
        </div>
        <div style={{ display: 'flex', gap: 26, fontFamily: display, fontWeight: 700, fontSize: 64, letterSpacing: -1.5, color: C.ink }}>
          {beats.map(([t, at], i) => <Pop key={t} delay={at}><span style={{ color: i === 2 ? C.hot : C.ink }}>{t}</span></Pop>)}
        </div>
        <Rise delay={104}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 24, color: C.muted, marginRight: 6 }}>Built on Nexconn</span>
            {['Chat SDK', 'Chat UI kit', 'Platform API', 'Webhooks'].map((t) => <span key={t} style={{ padding: '9px 16px', borderRadius: 12, background: C.plum, color: '#fff', fontFamily: mono, fontSize: 19 }}>{t}</span>)}
          </div>
        </Rise>
      </AbsoluteFill>
    </Scene>
  );
};

// ---------- 3. seller sets up ----------
const Setup: React.FC<{ F: number }> = ({ F }) => {
  const ps = parts(F, [{ a: M('onboard_start', -300), b: M('items_ready', 1400) }]);
  return (
    <Scene vo="setup" ps={ps} top={<NexTag kit="PLATFORM API" what="one open channel per drop" delay={Math.round(F * 0.45)} />}>
      <Row><Browser actor="seller" ps={ps} w={1236} url={`${HOST}/sell`} /></Row>
    </Scene>
  );
};

// ---------- 4. buyers join ----------
const Join: React.FC<{ F: number }> = ({ F }) => {
  const ps = parts(F, [{ a: Math.max(M('items_ready', 400), M('buyers_in', -7000)), b: M('drop1', -250) }]);
  const now = srcAt(ps, useCurrentFrame());
  return (
    <Scene vo="join" ps={ps} top={<NexTag kit="CHAT SDK" what="OpenChannel.enterChannel()" delay={20} />}>
      <Row gap={34}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Browser actor="seller" ps={ps} w={860} url={`${HOST}/sell`} />
          <Wire rows={wireRows(ps[0]!.a, ps[0]!.b, { sdk: /enterChannel|connect$|onParticipantChanged/, api: /^$/, hooks: /operation|connection/ })} now={now} w={860} max={4} delay={10} />
        </div>
        {['buyer1', 'buyer2', 'buyer3'].map((a, i) => <Phone key={a} actor={a} ps={ps} w={272} label={nameOf(a)} tint={TINT[a]} delay={8 + i * 5} />)}
      </Row>
    </Scene>
  );
};

// ---------- 5. first claim + queue ----------
const Claim: React.FC<{ F: number }> = ({ F }) => {
  const ps = parts(F, [{ a: M('drop1', -300), b: M('queue1_visible', 2000) }]);
  const now = srcAt(ps, useCurrentFrame());
  return (
    <Scene vo="claim" ps={ps}>
      <Row gap={40}>
        <Heading kicker="The queue" title={<>One tap.<br />It's yours.</>} sub="Everyone else sees their place in line, the moment it changes." width={500}>
          <NexTag kit="OPEN CHANNEL" what="metadata = the queue" delay={18} />
          <Wire rows={wireRows(ps[0]!.a, ps[0]!.b, { sdk: /onMetadataChanged/, api: /metadata|message/, hooks: /metadata/ })} now={now} w={500} max={6} delay={24} title="Signed by our server, verified in every browser" />
        </Heading>
        {['buyer1', 'buyer2', 'buyer3'].map((a, i) => <Phone key={a} actor={a} ps={ps} w={338} label={nameOf(a)} tint={TINT[a]} delay={4 + i * 4} />)}
      </Row>
    </Scene>
  );
};

// ---------- 6. checkout + live order card ----------
const Checkout: React.FC<{ F: number }> = ({ F }) => {
  const ps = parts(F, [{ a: M('checkout1', -300), b: M('sold1', 1300), w: 3 }, { a: M('orderchat1', -150), b: M('orderchat1', 3700), w: 1.15 }]);
  return (
    <Scene vo="checkout" ps={ps} top={<NexTag kit="DIRECT CHANNEL" what="message metadata → the order card updates in place" delay={ps[1]!.from - 40} />}>
      <Row gap={44}>
        <Phone actor="buyer1" ps={ps} w={352} label={nameOf('buyer1')} tint={TINT.buyer1} />
        <Browser actor="seller" ps={ps} w={1180} url={`${HOST}/sell`} delay={5} />
      </Row>
    </Scene>
  );
};

// ---------- 7. the race ----------
const Race: React.FC<{ F: number }> = ({ F }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ps = parts(F, [
    { a: M('drop2_seen', -200), b: M('race', -120), frames: 62 },
    { a: M('race', -120), b: M('race_done', 500), frames: Math.round((((M('race_done', 500) - M('race', -120)) / 1000) * FPS) / 0.4) },
    { a: M('race_done', 500), b: M('race_done', 500) + 4300 },
  ]);
  const now = srcAt(ps, f);
  const done = now >= M('race_done', -150);
  const tapF = ps[1]!.from + Math.round(((120 / 1000) * FPS) / 0.4);
  const flash = interpolate(f, [tapF - 1, tapF + 2, tapF + 14], [0, 0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const taps = race.taps ?? {};
  const badge = (a: string) => {
    if (!done) return null;
    const [txt, bg, fg] = a === aWinner ? ['WINNER', C.mint, '#fff'] : a === aFirst ? ['#1 in line', C.sun, C.ink] : ['#2 in line', C.sunSoft, C.ink];
    return <Pop><span style={{ padding: '7px 14px', borderRadius: 999, background: bg, color: fg, fontFamily: sans, fontWeight: 800, fontSize: 18 }}>{txt}</span></Pop>;
  };
  const stamp = spring({ frame: f - (ps[2]!.from + 6), fps, config: { damping: 11 } });
  return (
    <Scene vo="race" ps={ps}>
      <Row gap={40}>
        <Heading kicker="The real test" title={<>Three taps.<br />Same instant.</>} width={500}>
          <Rise delay={14}>
            <div style={{ borderRadius: 18, background: C.card, padding: '18px 20px', boxShadow: '0 20px 50px -30px rgba(23,18,14,.5)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 16, letterSpacing: 1.5, color: C.muted }}>TAP SENT · MEASURED IN THIS TAKE</div>
              {['buyer1', 'buyer2', 'buyer3'].map((a) => (
                <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: sans, fontSize: 24, fontWeight: 700, color: C.ink }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: TINT[a] }} />{nameOf(a)}
                  <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 24, color: f >= tapF ? C.ink : C.line }}>{f >= tapF ? `+${taps[nameOf(a)] ?? 0} ms` : '· · ·'}</span>
                </div>
              ))}
              <div style={{ marginTop: 6, paddingTop: 12, borderTop: `2px dashed ${C.line}`, fontFamily: display, fontWeight: 800, fontSize: 34, letterSpacing: -0.8, color: C.hot, opacity: stamp, transform: `scale(${0.8 + 0.2 * stamp})`, transformOrigin: 'left center' }}>
                {race.winners} winner. Never two.
              </div>
            </div>
          </Rise>
          <NexTag kit="OPEN CHANNEL" what="one signed queue" delay={ps[2]!.from + 20} />
          <Rise delay={ps[2]!.from + 30}><div style={{ fontFamily: sans, fontSize: 20, color: C.muted }}>First tap to reach the server wins. Everyone else is queued in arrival order.</div></Rise>
        </Heading>
        {['buyer1', 'buyer2', 'buyer3'].map((a, i) => <Phone key={a} actor={a} ps={ps} w={338} label={nameOf(a)} tint={TINT[a]} badge={badge(a)} delay={4 + i * 4} />)}
      </Row>
      <AbsoluteFill style={{ background: '#fff', opacity: flash, pointerEvents: 'none' }} />
    </Scene>
  );
};

// ---------- 8. scammer in the room ----------
const Scam: React.FC<{ F: number }> = ({ F }) => {
  const ps = parts(F, [{ a: M('scam_start', -500), b: M('scam_end', 2200) }]);
  const now = srcAt(ps, useCurrentFrame());
  const rows = wireRows(ps[0]!.a, ps[0]!.b, { sdk: /OpenChannel\.sendMessage|onMessageReceived/, type: /CI:Chat/, api: /mute|ban|expire/, hooks: /pre_messaging/ });
  return (
    <Scene vo={SCAM} ps={ps}>
      <Row gap={40}>
        <Phone actor="buyer4" ps={ps} w={338} label="Scammer" tint={TINT.buyer4} />
        <Phone actor={aSecond} ps={ps} w={338} label={`${nameOf(aSecond)} sees`} tint={TINT[aSecond]} delay={5} />
        <Heading kicker="Trust" title={hookSeen ? <>Pay-me-direct<br />never lands.</> : <>The number<br />never shows.</>} width={720}>
          <NexTag kit={hookSeen ? 'WEBHOOKS' : 'CHAT SDK'} what={hookSeen ? 'pre-messaging → our rules → pass / rewrite / block' : 'low-priority type CI:Chat · scrubbed on arrival'} delay={16} />
          <Wire rows={rows} now={now} w={720} max={7} delay={22} title={hookSeen ? 'Nexconn asks our server before delivering' : 'Nexconn, live'} />
        </Heading>
      </Row>
    </Scene>
  );
};

// ---------- 9. seller replies (+ Chat UI kit inbox) ----------
const Reply: React.FC<{ F: number }> = ({ F }) => {
  const defs = [{ a: M('seller_room', -200), b: M('seller_reply', 2300), w: 1 }];
  if (inboxSeen) defs.push({ a: M('inbox_open', -400), b: M('inbox_seen', 200), w: 1.4 });
  const ps = parts(F, defs);
  return (
    <Scene vo={REPLY} ps={ps} top={<>
      <NexTag kit="CHAT SDK" what="priority message type CI:SellerChat" delay={14} />
      {inboxSeen && <NexTag kit="CHAT UI KIT" what="the seller's inbox" delay={ps[1]!.from + 6} />}
    </>}>
      <Row gap={44}>
        <Browser actor="seller" ps={ps} w={1180} url={`${HOST}/sell`} />
        <Phone actor={aSecond} ps={ps} w={352} label={nameOf(aSecond)} tint={TINT[aSecond]} delay={5} />
      </Row>
    </Scene>
  );
};

// ---------- 10. the winner never pays ----------
const Promote: React.FC<{ F: number }> = ({ F }) => {
  const lapse = 70;
  const ps = parts(F, [{ a: M('waiting_expiry', 500), b: M('promoted', -900), frames: lapse }, { a: M('promoted', -900), b: M('promoted', -900) + ((F - lapse) / FPS) * 1000 }]);
  return (
    <Scene vo="promote" ps={ps}>
      <Row gap={40}>
        <Heading kicker="No-shows" title={<>Didn't pay?<br />Next in line.</>} sub="The hold runs out on the server. The queue moves itself, on every screen." width={500}>
          <NexTag kit="PLATFORM API" what="hold timer → metadata" delay={lapse + 10} />
        </Heading>
        <Phone actor={aWinner} ps={ps} w={338} label={`${nameOf(aWinner)} · never paid`} tint={TINT[aWinner]} />
        <Phone actor={aFirst} ps={ps} w={338} label={`${nameOf(aFirst)} · was #1`} tint={TINT[aFirst]} delay={4} />
        <Phone actor={aSecond} ps={ps} w={338} label={`${nameOf(aSecond)} · was #2`} tint={TINT[aSecond]} delay={8} />
      </Row>
    </Scene>
  );
};

// ---------- 11. recap ----------
const Recap: React.FC<{ F: number }> = ({ F }) => {
  const ps = parts(F, [{ a: M('recap', -300), b: M('recap', -300) + (F / FPS) * 1000 }]);
  return <Scene vo="recap" ps={ps}><Row><Browser actor="seller" ps={ps} w={1236} url={`${HOST}/sell`} /></Row></Scene>;
};

// ---------- 12. Pro + checkout ----------
const Pro: React.FC<{ F: number }> = ({ F }) => {
  const dodo = has('dodo_checkout');
  const cuts = [
    { a: M('pro_card', -200), b: M('cohost_added', 2600), w: 3 },
    { a: M('scheduled_console', -300), b: M('scheduled_buyer', 3600), w: 2.8 },
    { a: M('pay_sheet', -200), b: M('pay_sheet', 2600), w: 2 },
    ...(dodo ? [{ a: M('dodo_checkout', 300), b: M('dodo_checkout', 4600), w: 2.4 }] : []),
    ...(has('admin_full') ? [{ a: M('admin_full', 500), b: M('admin_full', 3700), w: 2.6 }] : []),
  ];
  const adminAt = dodo ? 4 : 3;
  const all = parts(F, cuts);
  const one = (i: number) => [{ ...all[i]!, from: 0 }];
  const labels = ['Free 14-day trial · add a co-host', 'Schedule the next drop', 'Founding price · $4.50 / month', ...(dodo ? ['Dodo Payments · test mode'] : []), 'Operator page · test payments received'];
  return (
    <Scene vo="pro">
      {all.map((p, i) => (
        <Sequence key={i} from={p.from} durationInFrames={p.frames}>
          <Row gap={44}>
            {i === adminAt
              ? <Browser actor="feed" ps={one(i)} enter={false} w={1230} aspect={560 / 900} url={`${HOST}/admin`} />
              : <Browser actor="seller" ps={one(i)} enter={i === 0} w={i === 1 ? 1180 : 1236} url={dodo && i === 3 ? 'test.checkout.dodopayments.com' : `${HOST}/sell`} />}
            {i === 1 && <Phone actor={aSecond} ps={one(i)} w={352} label={nameOf(aSecond)} tint={TINT[aSecond]} delay={3} />}
          </Row>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 26, display: 'flex', justifyContent: 'center' }}>
            <Rise delay={3} y={14}><span style={{ padding: '10px 18px', borderRadius: 14, background: C.ink, color: '#fff', fontFamily: sans, fontWeight: 700, fontSize: 20 }}>ClaimIt Pro · {labels[i]}</span></Rise>
          </div>
          <Speed ps={one(i)} />
        </Sequence>
      ))}
    </Scene>
  );
};

// ---------- 13. proof ----------
const Proof: React.FC<{ F: number }> = ({ F }) => {
  const f = useCurrentFrame();
  const A = Math.round(5.7 * FPS);
  const api = data.activity.filter((e) => e.dir === 'api');
  const busy = M('drop2', -2500);
  const feedPs = [{ a: busy, b: busy + 22_000, from: 0, frames: A, rate: 22_000 / 1000 / (A / FPS) }];
  const ms = api.map((e) => e.ms ?? 0).filter(Boolean).sort((x, y) => x - y);
  const median = ms.length ? ms[Math.floor(ms.length / 2)] : 0;
  const T = data.tests;
  const pick = (l: string[], n: number) => { const ok = l.filter((x) => x.startsWith('✓')); return [...l.filter((x) => !x.startsWith('✓') && !x.startsWith('All')).slice(0, 2), ...ok.slice(0, n), ...(ok.length > n ? [`  … ${ok.length - n} more ✓`] : []), ...l.filter((x) => x.startsWith('All'))]; };
  const count = (l: string[]) => l.filter((x) => x.startsWith('✓')).length;
  const total = count(T.race) + count(T.billing) + count(T.webhooks);
  const shown = Math.min(total, Math.max(0, Math.round(interpolate(f, [A + 30, F - 50], [0, total], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))));
  return (
    <Scene vo="proof" dark>
      <Sequence durationInFrames={A}>
        <Row gap={44}>
          <Browser actor="feed" ps={feedPs} w={1180} aspect={560 / 900} url={`${HOST}/admin`} />
          <div style={{ width: 440, display: 'flex', flexDirection: 'column', gap: 18, color: '#fff' }}>
            <Rise><div style={{ fontFamily: sans, fontWeight: 700, fontSize: 18, letterSpacing: 2.2, color: C.sun }}>IN THIS ONE TAKE</div></Rise>
            {[[String(api.length), 'Platform API calls'], [String(data.activity.length - api.length), 'webhooks received'], [String(data.traces.length), 'SDK events in the browsers'], [median ? `${median} ms` : '—', 'median API round trip']].map(([n, l], i) => (
              <Rise key={l} delay={8 + i * 7}><div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}><span style={{ fontFamily: display, fontWeight: 800, fontSize: 62, letterSpacing: -2, minWidth: 190, whiteSpace: 'nowrap' }}>{n}</span><span style={{ fontFamily: sans, fontSize: 22, color: 'rgba(255,255,255,.7)' }}>{l}</span></div></Rise>
            ))}
          </div>
        </Row>
        <Speed ps={feedPs} />
      </Sequence>
      <Sequence from={A}>
        <Row gap={44}>
          <Terminal w={1240} h={800} blocks={[
            { cmd: 'npm run test:race', lines: pick(T.race, 9), at: 6, per: 2.2 },
            { cmd: 'npm run test:billing', lines: pick(T.billing, 3), at: 110, per: 2.2 },
            { cmd: 'npm run test:webhooks', lines: pick(T.webhooks, 3), at: 160, per: 2.2 },
          ]} />
          <div style={{ width: 380, color: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 190, letterSpacing: -8, lineHeight: 1, color: shown === total ? '#7be3b5' : '#fff' }}>{shown}</div>
            <div style={{ fontFamily: sans, fontSize: 26, color: 'rgba(255,255,255,.75)', lineHeight: 1.35 }}>automated checks,<br />all passing</div>
            <Rise delay={50}><div style={{ marginTop: 22, padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,.08)', fontFamily: mono, fontSize: 18, lineHeight: 1.5 }}>200 claims at once<br /><span style={{ color: C.sun }}>→ exactly 1 winner</span></div></Rise>
          </div>
        </Row>
      </Sequence>
    </Scene>
  );
};

// ---------- 14. end card ----------
const End: React.FC = () => {
  const used = ['Chat SDK', 'Chat UI kit', 'Platform API', 'Open channels', 'Channel metadata', 'Direct channels', 'Message metadata', 'Priority messages', 'Webhooks', 'Native mute / ban'];
  return (
    <Scene vo="end" logo={false}>
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30, paddingBottom: 90 }}>
        <Pop delay={3}><Logo size={120} /></Pop>
        <Rise delay={14}><div style={{ fontFamily: display, fontWeight: 800, fontSize: 84, letterSpacing: -2.5, color: C.ink }}>Fair drops, built on <span style={{ color: C.hot }}>Nexconn</span>.</div></Rise>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, maxWidth: 1300 }}>
          {used.map((t, i) => <Pop key={t} delay={30 + i * 3}><span style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 12, background: C.plum, color: '#fff', fontFamily: mono, fontSize: 21 }}>{t}</span></Pop>)}
        </div>
        <Rise delay={70}><div style={{ marginTop: 16, padding: '16px 30px', borderRadius: 999, background: C.ink, color: '#fff', fontFamily: mono, fontSize: 32, fontWeight: 500 }}>https://{HOST}</div></Rise>
        <Rise delay={80}><div style={{ fontFamily: sans, fontSize: 22, color: C.muted }}>Every screen in this film is the live app, recorded in real browsers. Nothing staged.</div></Rise>
      </AbsoluteFill>
    </Scene>
  );
};

// ---------- timeline ----------
export const SCENES: { id: string; frames: number; el: (F: number) => React.ReactNode }[] = [
  { id: 'cold', frames: frames('cold', 0.9), el: () => <ColdOpen /> },
  { id: 'title', frames: frames('title', 1.1), el: () => <Title /> },
  { id: 'setup', frames: frames('setup'), el: (F) => <Setup F={F} /> },
  { id: 'join', frames: frames('join'), el: (F) => <Join F={F} /> },
  { id: 'claim', frames: frames('claim', 1.2), el: (F) => <Claim F={F} /> },
  { id: 'checkout', frames: frames('checkout'), el: (F) => <Checkout F={F} /> },
  { id: 'race', frames: frames('race', 1.6), el: (F) => <Race F={F} /> },
  { id: 'scam', frames: frames(SCAM, 1.0), el: (F) => <Scam F={F} /> },
  { id: 'reply', frames: frames(REPLY), el: (F) => <Reply F={F} /> },
  { id: 'promote', frames: frames('promote', 1.2), el: (F) => <Promote F={F} /> },
  { id: 'recap', frames: frames('recap', 1.0), el: (F) => <Recap F={F} /> },
  { id: 'pro', frames: frames('pro', 1.0), el: (F) => <Pro F={F} /> },
  { id: 'proof', frames: frames('proof', 1.2), el: (F) => <Proof F={F} /> },
  { id: 'end', frames: frames('end', 2.6), el: () => <End /> },
];
export const TOTAL = SCENES.reduce((s, x) => s + x.frames, 0);

export const Demo: React.FC = () => (
  <AbsoluteFill style={{ background: C.paper }}>
    <Series>{SCENES.map((s) => <Series.Sequence key={s.id} durationInFrames={s.frames}>{s.el(s.frames)}</Series.Sequence>)}</Series>
    <Audio src={staticFile('music.wav')} volume={(f) => interpolate(f, [0, 30, TOTAL - 75, TOTAL - 5], [0, 0.1, 0.1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} loop />
  </AbsoluteFill>
);

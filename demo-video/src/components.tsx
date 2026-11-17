import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FPS, display, mono, sans } from './theme';
import { data, type Activity, type Trace } from './data';

// ---------- footage on the shared timeline ----------
export interface PartDef { a: number; b: number; w?: number; frames?: number }
export interface Part { a: number; b: number; from: number; frames: number; rate: number }
/** Split `total` frames between source windows (ms): fixed `frames` first, the rest by weight `w`. */
export function parts(total: number, defs: PartDef[]): Part[] {
  const fixed = defs.reduce((s, d) => s + (d.frames ?? 0), 0);
  const wsum = defs.reduce((s, d) => s + (d.frames ? 0 : d.w ?? 1), 0) || 1;
  let from = 0;
  return defs.map((d, i) => {
    let frames = d.frames ?? Math.round(((total - fixed) * (d.w ?? 1)) / wsum);
    if (i === defs.length - 1) frames = Math.max(1, total - from);
    const p = { a: d.a, b: d.b, from, frames, rate: (d.b - d.a) / 1000 / (frames / FPS) };
    from += frames;
    return p;
  });
}
const partAt = (ps: Part[], f: number) => ps.find((p) => f >= p.from && f < p.from + p.frames) ?? ps[ps.length - 1]!;
/** Recording time (ms) shown at a frame of the scene. */
export const srcAt = (ps: Part[], f: number) => { const p = partAt(ps, f); return p.a + ((f - p.from) / FPS) * 1000 * p.rate; };
export const rateAt = (ps: Part[], f: number) => partAt(ps, f).rate;

export const Footage: React.FC<{ actor: string; ps: Part[]; w: number; h: number }> = ({ actor, ps, w, h }) => (
  <div style={{ width: w, height: h, position: 'relative', background: C.paper, overflow: 'hidden' }}>
    {ps.map((p, i) => (
      <Sequence key={i} from={p.from} durationInFrames={p.frames} layout="none">
        <OffthreadVideo muted src={staticFile(`raw/${data.run}/${actor}.mp4`)} startFrom={Math.max(0, Math.round((p.a / 1000) * FPS))} playbackRate={p.rate}
          style={{ width: w, height: h, objectFit: 'cover', display: 'block', position: 'absolute', inset: 0 }} />
      </Sequence>
    ))}
  </div>
);

// ---------- motion helpers ----------
export const useEnter = (delay = 0, damping = 200) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping, mass: 0.7 } });
};
export const Rise: React.FC<{ delay?: number; y?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, y = 26, children, style }) => {
  const s = useEnter(delay);
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * y}px)`, ...style }}>{children}</div>;
};
export const Pop: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, children, style }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 12, mass: 0.6 } });
  return <div style={{ opacity: Math.min(1, s * 1.5), transform: `scale(${0.6 + 0.4 * s})`, ...style }}>{children}</div>;
};

// ---------- stage ----------
export const Backdrop: React.FC<{ dark?: boolean }> = ({ dark }) => {
  const f = useCurrentFrame();
  const drift = Math.sin(f / 90) * 40;
  return (
    <AbsoluteFill style={{ background: dark ? C.ink : C.paper }}>
      <div style={{ position: 'absolute', width: 900, height: 900, left: -260 + drift, top: -380, borderRadius: '50%', background: dark ? 'rgba(255,74,28,.20)' : C.hotSoft, filter: 'blur(120px)', opacity: 0.9 }} />
      <div style={{ position: 'absolute', width: 820, height: 820, right: -240 - drift, bottom: -420, borderRadius: '50%', background: dark ? 'rgba(255,180,0,.14)' : C.sunSoft, filter: 'blur(130px)' }} />
    </AbsoluteFill>
  );
};

export const Phone: React.FC<{ actor: string; ps: Part[]; w?: number; label?: string; tint?: string; badge?: React.ReactNode; delay?: number; dim?: boolean }> = ({ actor, ps, w = 350, label, tint = C.hot, badge, delay = 0, dim }) => {
  const h = Math.round((w * 844) / 390);
  const s = useEnter(delay);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, opacity: s * (dim ? 0.55 : 1), transform: `translateY(${(1 - s) * 40}px)` }}>
      {label !== undefined && (
        <div style={{ height: 40, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px 6px 6px', borderRadius: 999, background: C.card, boxShadow: '0 4px 14px -6px rgba(23,18,14,.25)', fontFamily: sans, fontWeight: 700, fontSize: 20, color: C.ink }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: tint, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15 }}>{label[0]}</span>{label}
          </div>
          {badge}
        </div>
      )}
      <div style={{ padding: 9, borderRadius: 46, background: C.ink, boxShadow: '0 40px 80px -30px rgba(23,18,14,.55), 0 0 0 2px rgba(255,255,255,.08) inset' }}>
        <div style={{ borderRadius: 38, overflow: 'hidden', width: w, height: h }}><Footage actor={actor} ps={ps} w={w} h={h} /></div>
      </div>
    </div>
  );
};

export const Browser: React.FC<{ actor: string; ps: Part[]; w: number; url: string; delay?: number; aspect?: number; enter?: boolean }> = ({ actor, ps, w, url, delay = 0, aspect = 800 / 1280, enter = true }) => {
  const h = Math.round(w * aspect);
  const sp = useEnter(delay);
  const s = enter ? sp : 1;
  return (
    <div style={{ borderRadius: 18, overflow: 'hidden', background: '#fff', boxShadow: '0 50px 100px -40px rgba(23,18,14,.5), 0 0 0 1px rgba(23,18,14,.08)', opacity: s, transform: `translateY(${(1 - s) * 40}px)` }}>
      <div style={{ height: 40, background: '#f3e9de', display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />)}
        <div style={{ marginLeft: 18, flex: 1, maxWidth: 520, height: 24, borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 12px', fontFamily: sans, fontSize: 13, color: C.muted }}>🔒 {url}</div>
      </div>
      <Footage actor={actor} ps={ps} w={w} h={h} />
    </div>
  );
};

/** A purple chip naming the Nexconn capability at work in the shot. */
export const NexTag: React.FC<{ kit: string; what: string; delay?: number }> = ({ kit, what, delay = 0 }) => (
  <Rise delay={delay} y={16}>
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '10px 18px 10px 10px', borderRadius: 14, background: C.plum, color: '#fff', boxShadow: '0 14px 30px -16px rgba(43,24,56,.8)' }}>
      <span style={{ padding: '5px 10px', borderRadius: 8, background: 'rgba(255,255,255,.14)', fontFamily: sans, fontWeight: 700, fontSize: 16, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>NEXCONN · {kit}</span>
      <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 500, whiteSpace: 'nowrap' }}>{what}</span>
    </div>
  </Rise>
);

export const Heading: React.FC<{ kicker: string; title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; width?: number }> = ({ kicker, title, sub, children, width = 520 }) => (
  <div style={{ width, display: 'flex', flexDirection: 'column', gap: 18 }}>
    <Rise><div style={{ fontFamily: sans, fontWeight: 700, fontSize: 18, letterSpacing: 2.2, color: C.hot, textTransform: 'uppercase' }}>{kicker}</div></Rise>
    <Rise delay={3}><div style={{ fontFamily: display, fontWeight: 800, fontSize: 62, lineHeight: 1.02, letterSpacing: -1.6, color: C.ink }}>{title}</div></Rise>
    {sub && <Rise delay={7}><div style={{ fontFamily: sans, fontSize: 24, lineHeight: 1.4, color: C.ink2 }}>{sub}</div></Rise>}
    {children}
  </div>
);

export const Speed: React.FC<{ ps: Part[] }> = ({ ps }) => {
  const f = useCurrentFrame();
  const r = rateAt(ps, f);
  if (r > 0.7 && r < 1.3) return null;
  const txt = r >= 8 ? `time-lapse ${Math.round(r)}×` : r > 1 ? `${r.toFixed(1).replace('.0', '')}× speed` : `slow motion ${r.toFixed(1)}×`;
  return <div style={{ position: 'absolute', right: 44, top: 36, padding: '7px 14px', borderRadius: 999, background: 'rgba(23,18,14,.82)', color: '#fff', fontFamily: mono, fontSize: 16, fontWeight: 500 }}>{r > 1 ? '▶▶' : '◐'} {txt}</div>;
};

/** Narration as on-screen captions, a phrase at a time. */
export const Captions: React.FC<{ text: string; start: number; frames: number; dark?: boolean }> = ({ text, start, frames, dark }) => {
  const f = useCurrentFrame() - start;
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > 58 || (cur.length > 26 && /[.,:?!]$/.test(cur))) { chunks.push(cur); cur = w; } else cur = next;
  }
  if (cur) chunks.push(cur);
  // No stranded one-word captions: fold a short tail into the phrase before it.
  if (chunks.length > 1 && chunks[chunks.length - 1]!.length < 16) { const tail = chunks.pop()!; chunks[chunks.length - 1] += ` ${tail}`; }
  const total = chunks.reduce((s, c) => s + c.length + 6, 0);
  let acc = 0, shown = '';
  for (const c of chunks) { const span = ((c.length + 6) / total) * frames; if (f >= acc && f < acc + span) shown = c; acc += span; }
  if (f < 0 || f >= frames || !shown) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 44, display: 'flex', justifyContent: 'center' }}>
      <div style={{ padding: '12px 26px', borderRadius: 16, background: dark ? 'rgba(255,255,255,.12)' : 'rgba(23,18,14,.88)', color: '#fff', fontFamily: sans, fontWeight: 600, fontSize: 30, letterSpacing: -0.2 }}>{shown}</div>
    </div>
  );
};

// ---------- the live wire: real calls and callbacks from this recording ----------
const clock = (ms: number) => { const s = Math.max(0, ms) / 1000; return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };
type Row = { t: number; tone: string; arrow: string; label: string; right: string };
export function wireRows(from: number, to: number, o: { sdk?: RegExp; api?: RegExp; hooks?: RegExp; type?: RegExp } = {}): Row[] {
  const rows: Row[] = [];
  for (const e of data.activity as Activity[]) {
    if (e.t < from || e.t > to) continue;
    if ((e.note ?? '').includes('drop_demo')) continue; // the always-on practice room next door
    if (e.dir === 'api') { if (o.api && !o.api.test(e.what)) continue; rows.push({ t: e.t, tone: C.hot, arrow: '→', label: `POST ${e.what}`, right: `${e.code ?? ''} · ${e.ms ?? '?'} ms` }); }
    else { if (o.hooks && !o.hooks.test(e.what)) continue; rows.push({ t: e.t, tone: '#39d39b', arrow: '←', label: `webhook ${e.what}`, right: (e.note ?? '').split(' · ').slice(-1)[0]!.slice(0, 22) }); }
  }
  if (o.sdk) for (const e of data.traces as Trace[]) {
    if (e.t < from || e.t > to || !o.sdk.test(e.kind)) continue;
    if (o.type && e.d.type !== undefined && !o.type.test(String(e.d.type))) continue;
    const who = data.names[e.actor] ?? (e.actor === 'seller' ? 'Maya' : e.actor);
    const d = e.d as Record<string, unknown>;
    const extra = d.type ? String(d.type) : Array.isArray(d.keys) ? `${(d.keys as string[]).length} key${(d.keys as string[]).length === 1 ? '' : 's'}` : d.participantCount !== undefined ? `${d.participantCount} in room` : d.participants !== undefined ? `${d.participants} in room` : d.status !== undefined ? String(d.status) : '';
    rows.push({ t: e.t, tone: C.sun, arrow: '◆', label: `${e.kind}`, right: `${who}${extra ? ' · ' + extra : ''}` });
  }
  return rows.sort((a, b) => a.t - b.t);
}
export const Wire: React.FC<{ rows: Row[]; now: number; w: number; max?: number; title?: string; delay?: number }> = ({ rows, now, w, max = 8, title = 'Nexconn, live', delay = 0 }) => {
  const seen = rows.filter((r) => r.t <= now);
  const show = seen.slice(-max);
  return (
    <Rise delay={delay}>
      <div style={{ width: w, borderRadius: 18, background: C.ink, color: '#fff', padding: '16px 18px 18px', boxShadow: '0 40px 80px -40px rgba(23,18,14,.7)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: sans, fontWeight: 700, fontSize: 17, marginBottom: 12 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5a36', boxShadow: '0 0 0 4px rgba(255,90,54,.25)' }} />{title}
          <span style={{ marginLeft: 'auto', fontFamily: mono, fontWeight: 400, fontSize: 13, color: 'rgba(255,255,255,.5)' }}>{seen.length} events</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: max * 31 }}>
          {show.map((r, i) => {
            const age = now - r.t;
            return (
              <div key={`${r.t}-${i}-${r.label}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontFamily: mono, fontSize: 15.5, height: 26, opacity: interpolate(age, [0, 250], [0.2, 1], { extrapolateRight: 'clamp' }), background: age < 500 ? 'rgba(255,255,255,.07)' : 'transparent', borderRadius: 6, padding: '0 6px' }}>
                <span style={{ color: 'rgba(255,255,255,.4)', fontSize: 13 }}>{clock(r.t)}</span>
                <span style={{ color: r.tone, fontWeight: 700 }}>{r.arrow}</span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{r.label}</span>
                <span style={{ color: 'rgba(255,255,255,.62)', fontSize: 13.5, whiteSpace: 'nowrap' }}>{r.right}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Rise>
  );
};

export const Logo: React.FC<{ size?: number; light?: boolean }> = ({ size = 34, light }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
    <Img src={staticFile('logo-mark.svg')} style={{ height: size }} />
    <span style={{ fontFamily: display, fontWeight: 800, fontSize: size * 0.95, letterSpacing: -1, color: light ? '#fff' : C.ink }}>ClaimIt</span>
  </div>
);

/** A terminal that types a command and prints real output. */
export const Terminal: React.FC<{ w: number; h: number; blocks: { cmd: string; lines: string[]; at: number; per?: number }[] }> = ({ w, h, blocks }) => {
  const f = useCurrentFrame();
  const out: { text: string; kind: 'cmd' | 'out' }[] = [];
  for (const b of blocks) {
    if (f < b.at) continue;
    const typed = Math.min(b.cmd.length, Math.floor((f - b.at) * 2.2));
    out.push({ text: `$ ${b.cmd.slice(0, typed)}${typed < b.cmd.length ? '▍' : ''}`, kind: 'cmd' });
    if (typed < b.cmd.length) continue;
    const since = f - b.at - Math.ceil(b.cmd.length / 2.2) - 4;
    const n = Math.max(0, Math.min(b.lines.length, Math.floor(since / (b.per ?? 1.6))));
    for (const l of b.lines.slice(0, n)) out.push({ text: l, kind: 'out' });
  }
  const lineH = 27;
  const max = Math.floor((h - 70) / lineH);
  return (
    <div style={{ width: w, height: h, borderRadius: 18, background: '#0f0c0a', boxShadow: '0 50px 100px -40px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.08)', overflow: 'hidden' }}>
      <div style={{ height: 40, background: '#1d1814', display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />)}
        <span style={{ marginLeft: 14, fontFamily: mono, fontSize: 13, color: 'rgba(255,255,255,.45)' }}>claimit — zsh</span>
      </div>
      <div style={{ padding: '14px 20px', fontFamily: mono, fontSize: 17, lineHeight: `${lineH}px`, color: '#e9e2da' }}>
        {out.slice(-max).map((l, i) => (
          <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: l.kind === 'cmd' ? '#fff' : l.text.startsWith('✓') ? '#7be3b5' : l.text.startsWith('All') ? C.sun : '#cfc6bc', fontWeight: l.kind === 'cmd' || l.text.startsWith('All') ? 700 : 400 }}>{l.text}</div>
        ))}
      </div>
    </div>
  );
};

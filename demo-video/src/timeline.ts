// The film's timing, as plain maths with no rendering in it, so the picture (Demo.tsx) and the soundtrack
// (cues.ts → voice/score.py) read the same clock.
import { M, data, has } from './data';

export const FPS = 30;
/** Frames into a scene before its narration starts. */
export const VO_AT = 7;

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
/** The scene frame at which a moment of the recording (ms) is on screen, or -1 if the scene never shows it. */
export const frameOf = (ps: Part[], ms: number) => {
  for (const p of ps) if (ms >= p.a && ms < p.b) return Math.round(p.from + ((ms - p.a) / 1000 / p.rate) * FPS);
  return -1;
};

// Which narration a take earns: the stronger lines only if the take really contains the evidence.
export const hookSeen = data.activity.some((e) => e.dir === 'webhook' && /pre_messaging/.test(e.what));
export const inboxSeen = has('inbox_open') && has('inbox_seen');
export const SCAM = hookSeen ? 'scam_hook' : 'scam_mask';
export const REPLY = inboxSeen ? 'reply' : 'reply_noinbox';

const TABLE: [id: string, vo: string, pad: number][] = [
  ['cold', 'cold', 0.9], ['title', 'title', 1.1], ['setup', 'setup', 0.9], ['join', 'join', 0.9], ['claim', 'claim', 1.2],
  ['checkout', 'checkout', 0.9], ['race', 'race', 1.6], ['scam', SCAM, 1.0], ['reply', REPLY, 0.9], ['promote', 'promote', 1.2],
  ['recap', 'recap', 1.0], ['pro', 'pro', 1.0], ['proof', 'proof', 1.2], ['end', 'end', 2.6],
];
export interface SceneTime { id: string; vo: string; from: number; frames: number; voFrames: number }
export const TIMES: SceneTime[] = [];
{
  let from = 0;
  for (const [id, vo, pad] of TABLE) {
    const frames = Math.ceil(((data.vo[vo] ?? 4) + pad) * FPS);
    TIMES.push({ id, vo, from, frames, voFrames: Math.round((data.vo[vo] ?? 0) * FPS) });
    from += frames;
  }
}
export const TOTAL = TIMES.reduce((s, x) => s + x.frames, 0);
export const timeOf = (id: string) => TIMES.find((s) => s.id === id)!;

// Fixed beats inside the hand-animated scenes.
export const COLD = { flood: 128, ask: 212 };
export const TITLE = { beats: [44, 64, 84], chips: 104 };

export const racePs = (F: number) => parts(F, [
  { a: M('drop2_seen', -200), b: M('race', -120), frames: 62 },
  { a: M('race', -120), b: M('race_done', 500), frames: Math.round((((M('race_done', 500) - M('race', -120)) / 1000) * FPS) / 0.4) },
  { a: M('race_done', 500), b: M('race_done', 500) + 4300 },
]);
export const raceTap = (ps: Part[]) => ps[1]!.from + Math.round(((120 / 1000) * FPS) / 0.4);
export const raceStamp = (ps: Part[]) => ps[2]!.from + 6;

export const LAPSE = 70;
export const promotePs = (F: number) => parts(F, [
  { a: M('waiting_expiry', 500), b: M('promoted', -900), frames: LAPSE },
  { a: M('promoted', -900), b: M('promoted', -900) + ((F - LAPSE) / FPS) * 1000 },
]);

// Where each scene looks in the recording. Kept here so the soundtrack can find the same moments.
export const setupPs = (F: number) => parts(F, [{ a: M('onboard_start', -300), b: M('items_ready', 1400) }]);
export const joinPs = (F: number) => parts(F, [{ a: Math.max(M('items_ready', 400), M('buyers_in', -7000)), b: M('drop1', -250) }]);
export const claimPs = (F: number) => parts(F, [{ a: M('drop1', -300), b: M('queue1_visible', 2000) }]);
export const checkoutPs = (F: number) => parts(F, [{ a: M('checkout1', -300), b: M('sold1', 1300), w: 3 }, { a: M('orderchat1', -150), b: M('orderchat1', 3700), w: 1.15 }]);
export const scamPs = (F: number) => parts(F, [{ a: M('scam_start', -500), b: M('scam_end', 2200) }]);
export const replyPs = (F: number) => {
  const defs: PartDef[] = [{ a: M('seller_room', -200), b: M('seller_reply', 2300), w: 1 }];
  if (inboxSeen) defs.push({ a: M('inbox_open', -400), b: M('inbox_seen', 200), w: 1.4 });
  return parts(F, defs);
};
export const recapPs = (F: number) => parts(F, [{ a: M('recap', -300), b: M('recap', -300) + (F / FPS) * 1000 }]);
export const proHasDodo = has('dodo_checkout');
export const proAdminAt = proHasDodo ? 4 : 3;
export const proPs = (F: number) => parts(F, [
  { a: M('pro_card', -200), b: M('cohost_added', 2600), w: 3 },
  { a: M('scheduled_console', -300), b: M('scheduled_buyer', 3600), w: 2.8 },
  { a: M('pay_sheet', -200), b: M('pay_sheet', 2600), w: 2 },
  ...(proHasDodo ? [{ a: M('dodo_checkout', 300), b: M('dodo_checkout', 4600), w: 2.4 }] : []),
  ...(has('admin_full') ? [{ a: M('admin_full', 500), b: M('admin_full', 3700), w: 2.6 }] : []),
]);
export const PROOF = { A: Math.round(5.7 * FPS), blocks: [6, 110, 160], cmds: ['npm run test:race', 'npm run test:billing', 'npm run test:webhooks'] };

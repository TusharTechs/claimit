// The soundtrack's cue list: which effect plays at which frame of the film, and how the score sits under the voice.
// Every cue is found the same way the picture finds it: from marks and SDK events of the recorded take.
import { M, data, has } from './data';
import {
  COLD, FPS, LAPSE, PROOF, TIMES, TITLE, VO_AT, checkoutPs, claimPs, frameOf, inboxSeen, joinPs, proAdminAt, proPs, promotePs,
  racePs, raceStamp, raceTap, recapPs, replyPs, scamPs, setupPs, timeOf, type Part,
} from './timeline';

export interface Sound { name: string; at: number; v: number }
const list: Sound[] = [];
/** Add a sound `local` frames into a scene (skipped if that moment is not in the scene). */
const add = (scene: string, local: number, name: string, v: number) => { if (local >= 0 && Number.isFinite(local)) list.push({ name, at: Math.round(timeOf(scene).from + local), v }); };
const at = (ps: Part[], mark: string, off = 0) => (has(mark) ? frameOf(ps, M(mark, off)) : -1);
const F = (id: string) => timeOf(id).frames;
const sdk = (kind: string, actors: string[], ps: Part[]) => data.traces.filter((e) => e.kind === kind && actors.includes(e.actor)).map((e) => frameOf(ps, e.t)).filter((f) => f >= 0);

// 1. the problem
add('cold', 4, 'pop', 0.22);
add('cold', COLD.flood, 'flood', 0.42);
add('cold', COLD.ask, 'boom', 0.36);
// 2. title: one pop per promise, a step higher each time
add('title', 0, 'whoosh', 0.2);
TITLE.beats.forEach((b, i) => add('title', b, `pop${i + 1}`, 0.34));
add('title', TITLE.chips, 'tick', 0.3);
// a soft whoosh on every cut into live footage
for (const id of ['setup', 'join', 'claim', 'checkout', 'scam', 'reply', 'recap', 'pro', 'proof']) add(id, 0, 'whoosh', 0.14);

// 3. the room is created
{ const ps = setupPs(F('setup')); add('setup', at(ps, 'console_open'), 'ding', 0.2); }
// 4. each buyer's real OpenChannel.enterChannel()
{ const ps = joinPs(F('join')); [...new Set(sdk('OpenChannel.enterChannel', ['buyer1', 'buyer2', 'buyer3'], ps))].slice(0, 3).forEach((f, i) => add('join', f, `pop${i + 1}`, 0.24)); }
// 5. drop, claim
{ const ps = claimPs(F('claim')); add('claim', at(ps, 'drop1'), 'tap', 0.3); add('claim', at(ps, 'claim1_won'), 'win', 0.4); add('claim', at(ps, 'queue1_visible'), 'pop', 0.2); }
// 6. paid, confirmed, the card updates
{ const ps = checkoutPs(F('checkout')); add('checkout', at(ps, 'paid1'), 'bloop', 0.24); add('checkout', at(ps, 'sold1'), 'coin', 0.28); add('checkout', ps[1]!.from + 8, 'sparkle', 0.21); }
// 7. the race
{ const ps = racePs(F('race')); add('race', raceTap(ps), 'taps3', 0.6); add('race', raceTap(ps) + 3, 'slowdown', 0.36); add('race', raceStamp(ps), 'thud', 0.3); add('race', raceStamp(ps) + 1, 'win', 0.34); }
// 8. each message the scammer really sent: payment details get the dull "no"
{ const ps = scamPs(F('scam')); sdk('OpenChannel.sendMessage', ['buyer4'], ps).forEach((f, i) => add('scam', f, i < 3 ? 'denied' : 'bloop', i < 3 ? 0.22 : 0.16)); }
// 9. the seller's reply, the inbox
{ const ps = replyPs(F('reply')); add('reply', at(ps, 'seller_reply'), 'bloop', 0.24); if (inboxSeen) { add('reply', at(ps, 'inbox_open'), 'pop', 0.24); add('reply', at(ps, 'inbox_chat'), 'tick', 0.4); } }
// 10. the hold runs out
{ const ps = promotePs(F('promote')); add('promote', 0, 'ticks', 0.5); add('promote', at(ps, 'promoted'), 'fanfare', 0.44); add('promote', at(ps, 'promoted') + 2, 'sparkle', 0.16); void LAPSE; }
// 11. recap
{ const ps = recapPs(F('recap')); add('recap', at(ps, 'recap') + 6, 'coin', 0.26); }
// 12. Pro
{
  const ps = proPs(F('pro'));
  ps.slice(1).forEach((p) => add('pro', p.from, 'tick', 0.32));
  add('pro', at(ps, 'pro_on'), 'sparkle', 0.22); add('pro', at(ps, 'cohost_added'), 'pop', 0.26); add('pro', at(ps, 'pay_sheet'), 'pop', 0.22);
  if (ps[proAdminAt]) add('pro', ps[proAdminAt]!.from + 12, 'coin', 0.27);
}
// 13. proof: numbers land, commands are typed, checks print
[0, 1, 2, 3].forEach((i) => add('proof', 8 + i * 7, `pop${(i % 3) + 1}`, 0.22));
PROOF.blocks.forEach((b, i) => { add('proof', PROOF.A + b, 'typing', 0.45); add('proof', PROOF.A + b + Math.ceil(PROOF.cmds[i]!.length / 2.2) + 4, 'checks', i === 0 ? 0.24 : 0.16); });
add('proof', F('proof') - 50, 'ding', 0.32);
// 14. end card
add('end', 3, 'pop', 0.26); add('end', 30, 'chips', 0.3); add('end', 70, 'ding', 0.26);

export const SOUNDS = list.sort((a, b) => a.at - b.at);

// ---- the score under the voice ----
const VO = TIMES.map((t) => [t.from + VO_AT, t.from + VO_AT + t.voFrames] as const);
const race = timeOf('race'), promote = timeOf('promote');
const HITS = [timeOf('title').from, race.from + raceStamp(racePs(race.frames)), promote.from + frameOf(promotePs(promote.frames), M('promoted')), timeOf('end').from];
const UNDER = 0.1, OPEN = 0.24, TAIL = 0.7;
/** Quiet while someone is speaking, opening up in the gaps, with a push on the four big downbeats and room to ring at the end. */
export const musicVolume = (f: number) => {
  let d = Infinity;
  for (const [a, b] of VO) { if (f >= a && f <= b) { d = 0; break; } d = Math.min(d, f < a ? a - f : f - b); }
  let v = UNDER + (OPEN - UNDER) * Math.min(1, d / 9);
  for (const h of HITS) { const k = f - h; if (k >= -2 && k < 28) v *= 1 + 0.6 * (1 - Math.max(0, k) / 28); }
  const end = VO[VO.length - 1]![1];
  if (f > end) v = Math.max(v, UNDER + (TAIL - UNDER) * Math.min(1, (f - end) / 18));
  return v;
};
void FPS;

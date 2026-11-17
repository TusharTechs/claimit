// Writes the film's sound cues (in seconds) for the score generator.   npx tsx cues.ts
import fs from 'node:fs';
import { COLD, FPS, LAPSE, TIMES, TOTAL, VO_AT, frameOf, promotePs, racePs, raceStamp, raceTap, timeOf } from './src/timeline';
import { M } from './src/data';

const s = (f: number) => +(f / FPS).toFixed(4);
const race = timeOf('race'), promote = timeOf('promote');
const rp = racePs(race.frames), pp = promotePs(promote.frames);
const cues = {
  total: s(TOTAL),
  scenes: TIMES.map((t) => ({ id: t.id, from: s(t.from), to: s(t.from + t.frames), voFrom: s(t.from + VO_AT), voTo: s(t.from + VO_AT + t.voFrames) })),
  flood: s(COLD.flood), ask: s(COLD.ask),
  title: s(timeOf('title').from),
  race: s(race.from), raceTap: s(race.from + raceTap(rp)), raceResult: s(race.from + raceStamp(rp)),
  promote: s(promote.from), lapseEnd: s(promote.from + LAPSE), promoted: s(promote.from + frameOf(pp, M('promoted'))),
  proof: s(timeOf('proof').from), end: s(timeOf('end').from),
};
fs.writeFileSync('raw/cues.json', JSON.stringify(cues, null, 1));
console.log(JSON.stringify({ ...cues, scenes: cues.scenes.map((x) => `${x.id}@${x.from}`).join(' ') }));

// Pull the frame each actor showed at a mark (plus an offset in ms), tiled into one image for a quick look.
//   npx tsx peek.ts <run> <mark> [offsetMs] [actors=comma list]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [run, markName, off = '0', who = 'seller,buyer1,buyer2,buyer3,buyer4,feed'] = process.argv.slice(2);
const dir = path.join('raw', run!);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'marks.json'), 'utf8')) as { marks: { name: string; t: number }[] };
const m = meta.marks.find((x) => x.name === markName);
if (!m) { console.error('marks:', meta.marks.map((x) => x.name).join(' ')); process.exit(1); }
const t = m.t + Number(off);
const inputs: string[] = [];
for (const a of who.split(',')) {
  const idx = JSON.parse(fs.readFileSync(path.join(dir, a, 'frames.json'), 'utf8')) as { n: number; t: number }[];
  let best = idx[0]!;
  for (const f of idx) { if (f.t <= t) best = f; else break; }
  inputs.push(path.join(dir, a, `f${String(best.n).padStart(6, '0')}.jpg`));
}
const out = path.join(dir, `peek-${markName}${off === '0' ? '' : off}.jpg`);
const args = inputs.flatMap((i) => ['-i', i]);
const filter = inputs.length === 1 ? '[0:v]scale=-2:1000' : inputs.map((_, i) => `[${i}:v]scale=-2:700[v${i}]`).join(';') + ';' + inputs.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${inputs.length}`;
execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-filter_complex', filter, '-q:v', '4', out]);
console.log(out);

// Gathers everything the edit needs from one recorded run into src/data.json:
// marks (ms from t0), the run's facts, the server's Nexconn activity log, each browser's SDK trace,
// narration lengths and the real test-suite output.   npx tsx prepare.ts <run>
import fs from 'node:fs';
import path from 'node:path';

const run = process.argv[2]!;
const dir = path.join('public/raw', run);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'marks.json'), 'utf8'));
const t0: number = meta.t0;
const marks: Record<string, number> = {};
for (const m of meta.marks) if (!(m.name in marks)) marks[m.name] = m.t - t0;
const names: Record<string, string> = meta.names;
const traces: { t: number; actor: string; kind: string; d: Record<string, unknown> }[] = [];
for (const actor of Object.keys(meta.stats)) {
  const f = path.join(dir, `${actor}.trace.json`);
  if (!fs.existsSync(f)) continue;
  for (const e of JSON.parse(fs.readFileSync(f, 'utf8'))) { const { t, kind, ...d } = e; traces.push({ t: t - t0, actor, kind, d }); }
}
traces.sort((a, b) => a.t - b.t);
// The SDK reports some callbacks twice in the same millisecond; keep one.
for (let i = traces.length - 1; i > 0; i--) { const x = traces[i]!, y = traces[i - 1]!; if (x.t === y.t && x.actor === y.actor && x.kind === y.kind) traces.splice(i, 1); }
const activity = ((meta.activity?.events ?? []) as { t: number; dir: string; what: string; ms?: number; code?: number | string; note?: string }[])
  .map((e) => ({ ...e, t: e.t - t0 })).filter((e) => e.t >= 0);
const vo = Object.fromEntries((JSON.parse(fs.readFileSync('public/vo/durations.json', 'utf8')) as { id: string; sec: number }[]).map((x) => [x.id, x.sec]));
const voText = Object.fromEntries((JSON.parse(fs.readFileSync('src/vo.json', 'utf8')) as { id: string; text: string }[]).map((x) => [x.id, x.text]));
const test = (n: string) => (fs.existsSync(`raw/test-${n}.txt`) ? fs.readFileSync(`raw/test-${n}.txt`, 'utf8').split('\n').filter((l) => l.trim()) : []);
const data = { run, mode: meta.activity?.mode ?? 'mock', marks, facts: meta.facts, names, traces, activity, vo, voText,
  tests: { race: test('race'), billing: test('billing'), webhooks: test('webhooks') } };
fs.writeFileSync('src/data.json', JSON.stringify(data));
const kinds: Record<string, number> = {};
for (const e of activity) kinds[`${e.dir} ${e.what}`] = (kinds[`${e.dir} ${e.what}`] ?? 0) + 1;
for (const e of traces) kinds[`sdk ${e.kind}`] = (kinds[`sdk ${e.kind}`] ?? 0) + 1;
console.log('marks', Object.keys(marks).length, 'activity', activity.length, 'traces', traces.length, '\n', kinds, '\nfacts', JSON.stringify(meta.facts));

// Turns each actor's timestamped frames into one constant-frame-rate video on the shared timeline (t=0 is marks.t0),
// so the edit can cut every screen at the same instant.   npx tsx assemble.ts <run>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const run = process.argv[2]!;
const dir = path.resolve('raw', run);
const out = path.resolve('public/raw', run);
fs.mkdirSync(out, { recursive: true });
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'marks.json'), 'utf8')) as { t0: number; marks: { name: string; t: number }[]; stats: Record<string, unknown> };
const end = meta.marks[meta.marks.length - 1]!.t + 500;

const FPS = 30;
const SIZE: Record<string, string> = { seller: '1920:1200' };
for (const actor of Object.keys(meta.stats)) {
  const idx = (JSON.parse(fs.readFileSync(path.join(dir, actor, 'frames.json'), 'utf8')) as { n: number; t: number }[])
    .filter((f) => f.t < end).sort((x, y) => x.t - y.t || x.n - y.n);
  if (!idx.length) continue;
  const target = path.join(out, `${actor}.mp4`);
  // One JPEG per output frame, piped in: for each 1/30 s tick, the newest frame captured by then (held if nothing changed).
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `scale=${SIZE[actor] ?? 'trunc(iw/2)*2:trunc(ih/2)*2'}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.ceil(((end - meta.t0) / 1000) * FPS);
  let i = 0, buf: Buffer | null = null, loaded = -1;
  for (let k = 0; k < total; k++) {
    const t = meta.t0 + (k * 1000) / FPS;
    while (i + 1 < idx.length && idx[i + 1]!.t <= t) i++;
    if (loaded !== i) { buf = fs.readFileSync(path.join(dir, actor, `f${String(idx[i]!.n).padStart(6, '0')}.jpg`)); loaded = i; }
    if (!ff.stdin.write(buf!)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  console.log(actor, idx.length, 'captured →', total, 'frames', target);
}
fs.copyFileSync(path.join(dir, 'marks.json'), path.join(out, 'marks.json'));
for (const actor of Object.keys(meta.stats)) {
  const tr = path.join(dir, actor, 'trace.json');
  if (fs.existsSync(tr)) fs.copyFileSync(tr, path.join(out, `${actor}.trace.json`));
}

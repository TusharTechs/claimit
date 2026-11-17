// Review helper: bundle once, render a list of frames, and tile them into contact sheets.
//   npx tsx stills.ts 120,400,900 [sheetName]
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const list = process.argv[2]!.split(',').map(Number);
const name = process.argv[3] || 'sheet';
fs.mkdirSync('out/stills', { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'Demo' });
console.log('duration', composition.durationInFrames, 'frames');
const files: string[] = [];
for (const f of list) {
  const output = path.resolve(`out/stills/${name}-${String(f).padStart(5, '0')}.jpg`);
  await renderStill({ composition, serveUrl, output, frame: Math.min(f, composition.durationInFrames - 1), imageFormat: 'jpeg', jpegQuality: 88 });
  files.push(output);
}
for (let i = 0; i < files.length; i += 4) {
  const chunk = files.slice(i, i + 4);
  const out = `out/stills/${name}-sheet${i / 4}.jpg`;
  if (chunk.length === 1) { fs.copyFileSync(chunk[0]!, out); console.log(out); continue; }
  const cols = 2, rows = Math.ceil(chunk.length / 2);
  const layout = chunk.map((_, k) => `${(k % cols) * 1920}_${Math.floor(k / cols) * 1080}`).join('|');
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...chunk.flatMap((c) => ['-i', c]), '-filter_complex', `${chunk.map((_, k) => `[${k}:v]`).join('')}xstack=inputs=${chunk.length}:layout=${layout}:fill=white[o];[o]scale=${1920}:-2[s]`, '-map', '[s]', '-q:v', '3', out]);
  console.log(out, rows);
}

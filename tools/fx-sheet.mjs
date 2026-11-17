/*
 * Looks at the effects of Fate of the Galaxy (data/effects: a text .eff file and a numbered row of .dds frames for each): turns a few frames of
 * each effect into one picture, for choosing among them.
 * Usage: node tools/fx-sheet.mjs <effects folder> <out.png> <folder/effect> [folder/effect ...]     (e.g. exp/Exp_Det_Shp_01_Gld)
 * Options (environment): FRAMES=12 (how many pictures of each effect), COLS=6, CELL=170
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { readDds } from './dds.mjs';

const [root, out, ...names] = process.argv.slice(2);
if (!root || !out || names.length === 0) {
  console.error('Usage: node tools/fx-sheet.mjs <effects folder> <out.png> <folder/effect> ...');
  process.exit(1);
}
const FRAMES = Number(process.env.FRAMES ?? 12);
const COLS = Number(process.env.COLS ?? 6);
const CELL = Number(process.env.CELL ?? 170);
const rows = [];
for (const name of names) {
  const [folder, effect] = name.split('/');
  const dir = join(root, folder);
  const files = readdirSync(dir).filter((f) => f.startsWith(`${effect}_`) && f.endsWith('.dds')).sort();
  const meta = readFileSync(join(dir, `${effect}.eff`), 'utf8');
  const fps = /\$FPS:\s*(\d+)/.exec(meta)?.[1];
  const picks = Array.from({ length: Math.min(FRAMES, files.length) }, (_, i) => files[Math.floor((i * files.length) / Math.min(FRAMES, files.length))]);
  const cells = [];
  for (const f of picks) {
    const { width, height, rgba } = readDds(join(dir, f));
    cells.push(await sharp(rgba, { raw: { width, height, channels: 4 } }).removeAlpha().resize(CELL, CELL, { fit: 'contain', background: '#000' }).png().toBuffer());
  }
  console.log(`${name}: ${files.length} frames at ${fps} fps`);
  rows.push({ name, cells });
}
const perRow = Math.ceil(Math.max(...rows.map((r) => r.cells.length)) / 1);
const rowsPerEffect = Math.ceil(perRow / COLS);
const W = COLS * CELL;
const H = rows.length * rowsPerEffect * CELL;
const composite = [];
rows.forEach((r, ri) => {
  r.cells.forEach((buf, i) => composite.push({ input: buf, left: (i % COLS) * CELL, top: (ri * rowsPerEffect + Math.floor(i / COLS)) * CELL }));
});
await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite(composite).png().toFile(out);
console.log(`wrote ${out} (${W}x${H}); rows in order: ${rows.map((r) => r.name).join(', ')}`);

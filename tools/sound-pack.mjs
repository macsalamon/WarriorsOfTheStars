// Packs the sounds the game uses: every file picked in data/sounds.json is converted from the Fate of the Galaxy sounds folder (WAV)
// into a small mono MP3 in public/assets/sounds. The mod itself is not part of this repository (see CREDITS.md).
//
//   node tools/sound-pack.mjs [folder of the mod's sounds]
//
// The folder can also be given as FOTG_SOUNDS. ffmpeg has to be installed. MP3s that are no longer picked are removed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? process.env.FOTG_SOUNDS ?? 'D:/Games/kn_portable/Library/FotG_2/FotG_2-2.0.2/data/sounds';
const out = join(root, 'public', 'assets', 'sounds');

if (!existsSync(source)) {
  console.error(`The sounds folder was not found: ${source}\nGive it as an argument or set FOTG_SOUNDS.`);
  process.exit(1);
}
const table = JSON.parse(readFileSync(join(root, 'data', 'sounds.json'), 'utf8'));
// file names in the folder, by lower-case name without the ending
const have = new Map(readdirSync(source).filter((f) => /\.wav$/i.test(f)).map((f) => [f.replace(/\.wav$/i, '').toLowerCase(), f]));

// each picked file once; the shortest 'max' of the entries that use it; loops (the engines) are never faded
const wanted = new Map();
for (const entry of table.sounds) {
  for (const name of entry.pick ?? []) {
    const old = wanted.get(name);
    const max = entry.max ?? null;
    wanted.set(name, { max: old && old.max !== null && (max === null || old.max < max) ? old.max : max, loop: (old?.loop ?? false) || entry.id.startsWith('engine.') });
  }
}

mkdirSync(out, { recursive: true });
let failed = 0;
let bytes = 0;
for (const [name, how] of wanted) {
  const file = have.get(name.toLowerCase());
  if (!file) {
    console.error(`  missing in the sounds folder: ${name}`);
    failed++;
    continue;
  }
  const target = join(out, `${name}.mp3`);
  const args = ['-y', '-v', 'error', '-i', join(source, file)];
  if (how.max !== null && !how.loop) args.push('-t', String(how.max), '-af', `afade=t=out:st=${Math.max(0, how.max - 0.4)}:d=0.4`);
  args.push('-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '6', target);
  try {
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    bytes += statSync(target).size;
  } catch {
    console.error(`  could not convert: ${name}`);
    failed++;
  }
}
// what is no longer picked goes
for (const f of readdirSync(out)) {
  if (f.endsWith('.mp3') && !wanted.has(f.slice(0, -4))) {
    rmSync(join(out, f));
    console.log(`  removed ${f}`);
  }
}
console.log(`${wanted.size - failed} sounds packed into public/assets/sounds (${(bytes / 1024).toFixed(0)} KB)${failed ? `, ${failed} failed` : ''}.`);
process.exit(failed ? 1 : 0);

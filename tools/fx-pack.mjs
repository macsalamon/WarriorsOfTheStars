/*
 * Packs the effects of Fate of the Galaxy that the board uses (explosions, hit flashes, puffs and bolt streaks) into sprite sheets in
 * public/assets/fx: one .webp for each effect, with the frames in a grid, and fx.json that says how each is laid out and how long it plays.
 * The frames are DXT1 pictures on black, made to be added to what is behind them, so the sheets keep them as they are (the board draws them
 * with additive blending). Frames are thinned and the pictures reduced; see the table below. Nothing of the mod is stored in this repository
 * except these pictures (see CREDITS.md).
 * Usage: node tools/fx-pack.mjs <path to the FotG data/effects folder>
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { readDds } from './dds.mjs';

const root = process.argv[2];
if (!root) {
  console.error('Usage: node tools/fx-pack.mjs <path to the FotG data/effects folder>');
  process.exit(1);
}
const out = resolve(import.meta.dirname, '../public/assets/fx');
mkdirSync(out, { recursive: true });

/**
 * name: [folder/effect, first frame, last frame, step, picture width, picture height, [columns]]
 * What is played is the span first..last of the effect's own frame rate, whatever the step.
 */
const EFFECTS = {
  // a ship destroyed: the fireball, and for the large ships a flash and smoke that go on after it
  'shipfire-gld': ['exp/Exp_Det_Shp_02_Gld', 0, 109, 2, 256, 256],
  'shipfire-wht': ['exp/Exp_Det_Shp_02_Wht', 0, 109, 2, 256, 256],
  'shipfire-yel': ['exp/Exp_Det_Shp_02_Yel', 0, 109, 2, 256, 256],
  'shipsmoke-gld': ['exp/Exp_Det_Shp_01_Gld', 0, 149, 5, 256, 256],
  'shipsmoke-wht': ['exp/Exp_Det_Shp_01_Wht', 0, 149, 5, 256, 256],
  'shipsmoke-yel': ['exp/Exp_Det_Shp_01_Yel', 0, 149, 5, 256, 256],
  // torpedoes, missiles and bombs landing, and an asteroid breaking
  'boom-ptn': ['exp/Exp_Ipt_Ptn_01_Orn', 0, 89, 3, 256, 256],
  'boom-rkt': ['exp/Exp_Ipt_Rkt_01_Orn', 0, 119, 4, 256, 256],
  'boom-trb': ['exp/Exp_Ipt_Trb_01_Orn', 0, 89, 3, 256, 256],
  // a hit that does not destroy: a flash, and a puff by how much it did
  'flash-lsr-1': ['fls/Fls_Hit_Lsr_1', 0, 19, 2, 128, 128],
  'flash-lsr-2': ['fls/Fls_Hit_Lsr_2', 0, 19, 2, 128, 128],
  'flash-lsr-3': ['fls/Fls_Hit_Lsr_3', 0, 19, 2, 128, 128],
  'flash-lsr-4': ['fls/Fls_Hit_Lsr_4', 0, 19, 2, 128, 128],
  'flash-lsr-5': ['fls/Fls_Hit_Lsr_5', 0, 19, 2, 128, 128],
  'flash-lsr-6': ['fls/Fls_Hit_Lsr_6', 0, 19, 2, 128, 128],
  'flash-ion': ['fls/Fls_Hit_Ion_01_Blu', 0, 19, 2, 128, 128],
  'puff-shield': ['prt/Prt_Trl_MG7_01_Blu', 0, 29, 2, 192, 192],
  'puff-hull': ['prt/Prt_Trl_Rkt_01_Yel', 0, 35, 2, 192, 192],
  'puff-heavy': ['prt/Prt_Trl_NG2_01_Wht', 0, 35, 2, 192, 192],
  'puff-red': ['prt/Prt_Trl_Rkt_01_Red', 0, 35, 2, 192, 192],
  // the streaks that are the bolts in flight: lasers, ion cannons, torpedoes, missiles
  'streak-laser': ['prt/Prt_Trl_HM6_01_Orn', 0, 29, 3, 256, 128],
  'streak-ion': ['prt/Prt_Trl_HM6_01_Blu', 0, 29, 3, 256, 128],
  'streak-torpedo': ['prt/Prt_Trl_HM6_01_Yel', 0, 29, 3, 256, 128],
  'streak-missile': ['prt/Prt_Trl_HM6_01_Tel', 0, 29, 3, 256, 128],
};

const meta = {};
let bytes = 0;
for (const [name, [path, first, last, step, cw, ch]] of Object.entries(EFFECTS)) {
  const [folder, effect] = path.split('/');
  const dir = join(root, folder);
  const files = readdirSync(dir).filter((f) => f.startsWith(`${effect}_`) && f.endsWith('.dds')).sort();
  const fps = Number(/\$FPS:\s*(\d+)/.exec(readFileSync(join(dir, `${effect}.eff`), 'utf8'))?.[1] ?? 30);
  const picks = [];
  for (let i = first; i <= Math.min(last, files.length - 1); i += step) picks.push(files[i]);
  const cols = Math.ceil(Math.sqrt(picks.length * (ch / cw) * 1.4)) || 1;
  const rows = Math.ceil(picks.length / cols);
  const composite = [];
  for (let i = 0; i < picks.length; i++) {
    const { width, height, rgba } = readDds(join(dir, picks[i]));
    const input = await sharp(rgba, { raw: { width, height, channels: 4 } }).removeAlpha().resize(cw, ch, { fit: 'fill' }).png().toBuffer();
    composite.push({ input, left: (i % cols) * cw, top: Math.floor(i / cols) * ch });
  }
  const file = `${name}.webp`;
  const sheet = await sharp({ create: { width: cols * cw, height: rows * ch, channels: 3, background: '#000' } }).composite(composite).webp({ quality: 80, effort: 5 }).toBuffer();
  writeFileSync(join(out, file), sheet);
  bytes += sheet.length;
  // how long it plays: the span of frames, at the effect's own rate
  meta[name] = { file, frames: picks.length, cols, cw, ch, seconds: Number((((Math.min(last, files.length - 1) - first + 1)) / fps).toFixed(2)) };
  console.log(`${name}: ${picks.length} frames, ${cols}x${rows} of ${cw}x${ch}, ${meta[name].seconds}s, ${(sheet.length / 1024).toFixed(0)} KB`);
}
writeFileSync(join(out, 'fx.json'), JSON.stringify(meta, null, 1));
console.log(`total ${(bytes / 1e6).toFixed(1)} MB`);

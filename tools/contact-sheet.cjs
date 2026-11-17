/*
 * Puts the renders of every ship into one picture, to look at them side by side: node tools/contact-sheet.cjs [suffix] [out.png]
 * suffix: f0 (the default: nose up), f1 .. f5, or front. The ships are in the order of ships.js, four to a row, on a mid-grey ground.
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const ids = ['x-wing', 'a-wing', 'y-wing', 'y-wing-2seat', 'b-wing', 'tie-fighter', 'tie-interceptor', 'tie-interceptor-prototype', 'tie-bomber', 'imperial-shuttle', 'stock-freighter', 'millennium-falcon', 'slave-i', 'pirate-pinnace'];
const suffix = process.argv[2] ?? 'f0';
const out = path.resolve(process.argv[3] ?? path.join(root, 'Models/renders/sheet.png'));
const CELL = 380;
const COLS = 4;

(async () => {
  const have = ids.filter((id) => fs.existsSync(path.join(root, 'Models/renders', `${id}-3d-${suffix}.png`)));
  const rows = Math.ceil(have.length / COLS);
  const layers = [];
  for (let i = 0; i < have.length; i++) {
    const file = path.join(root, 'Models/renders', `${have[i]}-3d-${suffix}.png`);
    const trimmed = await sharp(file).trim({ threshold: 5 }).resize(CELL - 20, CELL - 20, { fit: 'inside' }).toBuffer();
    layers.push({ input: trimmed, left: (i % COLS) * CELL + 10, top: Math.floor(i / COLS) * CELL + 10, gravity: 'centre' });
  }
  await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 4, background: { r: 70, g: 78, b: 96, alpha: 1 } } }).composite(layers).png().toFile(out);
  console.log(out, have.join(', '));
})();

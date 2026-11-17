/*
 * Turns the renders of the asteroid models (ast-1 .. ast-9, six views each, made by tools/render3d.html) into the pictures the board draws asteroids with:
 *   <outDir>/rock-<model>-<view>.webp   the rock trimmed to its outline on a square canvas
 * Run it from the project folder: node tools/assemble-rocks.cjs [outDir]    (default public/assets/rocks)
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const renders = path.join(root, 'Models/renders');
const out = path.resolve(process.argv[2] ?? path.join(root, 'public/assets/rocks'));
fs.mkdirSync(out, { recursive: true });
const SIDE = 192;

(async () => {
  for (let model = 1; model <= 9; model++) {
    for (let view = 0; view < 6; view++) {
      const file = path.join(renders, `ast-${model}-3d-f${view}.png`);
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * 4 + 3] > 24) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const side = Math.max(w, h);
      // a little darker than the render, to sit in space; the rock is centred in a square so that it can be turned freely
      const trimmed = await sharp(file).extract({ left: x0, top: y0, width: w, height: h }).modulate({ brightness: 0.82 }).toBuffer();
      const square = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: trimmed, left: Math.round((side - w) / 2), top: Math.round((side - h) / 2) }])
        .png()
        .toBuffer();
      await sharp(square)
        .resize(SIDE, SIDE)
        .webp({ quality: 88, alphaQuality: 100 })
        .toFile(path.join(out, `rock-${model}-${view}.webp`));
    }
    console.log(`model ${model} done`);
  }
})();

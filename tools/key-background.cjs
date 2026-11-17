/*
 * Cuts the black background out of hand-made screenshots of a model (taken in Sketchfab's viewer on black): the pictures in Models/PNGs
 * become transparent ones in Models/keyed, numbered x-wing-0 ... in file-name order. Black that is not connected to the picture's edge
 * (a canopy, an engine) stays; the edge is softened by how bright each pixel is.
 * Usage: node tools/key-background.cjs [prefix, default x-wing]
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const prefix = process.argv[2] ?? 'x-wing';
const dir = path.resolve(__dirname, '../Models/PNGs');
const out = path.resolve(__dirname, '../Models/keyed');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const files = fs.readdirSync(dir).sort();
  for (const [i, f] of files.entries()) {
    const { data, info } = await sharp(path.join(dir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const mx = (p) => Math.max(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    // background = near-black pixels connected to the border
    const bg = new Uint8Array(W * H);
    const stack = [];
    const push = (x, y) => {
      const p = y * W + x;
      if (!bg[p] && mx(p) < 14) { bg[p] = 1; stack.push(p); }
    };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0;
      if (x > 0) push(x - 1, y);
      if (x < W - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < H - 1) push(x, y + 1);
    }
    // soften the edge: pixels within 2 px of the background fade with their brightness
    const near = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (bg[p]) continue;
      for (let dy = -2; dy <= 2 && !near[p]; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && bg[yy * W + xx]) { near[p] = 1; break; }
      }
    }
    for (let p = 0; p < W * H; p++) {
      data[p * 4 + 3] = bg[p] ? 0 : near[p] ? Math.min(255, Math.round((mx(p) / 60) * 255)) : 255;
    }
    await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(out, `${prefix}-${i}.png`));
    console.log(`${f} -> ${prefix}-${i}.png`);
  }
})();

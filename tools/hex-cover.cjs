/*
 * Which hexes a ship's picture covers (for the footprint of a capital ship): the picture, seen from straight above with its nose up, is scaled to a length in
 * hex radii and put with its tip at the top of the nose hex; every hex of the grid facing north is then given the share of its area the ship covers.
 * Usage: node tools/hex-cover.cjs <top-down render> <length in hex radii> [offset of the middle in radii, default 0]
 * (the ISD footprint is 7.8 radii long; the render comes from tools/render3d.html with &elev=89.5)
 */
const sharp = require('sharp');

const [file, lengthArg, shiftArg] = process.argv.slice(2);
const LENGTH = Number(lengthArg);
const SHIFT = Number(shiftArg ?? 0);
const SQ3 = Math.sqrt(3);

(async () => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < info.height && data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 128;
  let x0 = W, x1 = -1, y0 = info.height, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < W; x++) if (inside(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const k = LENGTH / (y1 - y0); // radii per pixel
  const cx = (x0 + x1) / 2;
  const covered = (px, py) => inside(cx + px / k, y0 + (py + SQ3 / 2 - SHIFT) / k);
  const rows = [];
  const picked = [];
  for (let r = -1; r <= 8; r++) {
    let line = '';
    for (let q = -4; q <= 4; q++) {
      const hx = 1.5 * q, hy = SQ3 * (r + q / 2);
      let n = 0, hit = 0;
      for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) {
        const px = (i / 10) * 1, py = (j / 10) * (SQ3 / 2);
        // inside the hexagon (flat top): |y| <= sqrt3/2 and |x|*sqrt3/2 + |y|/2 <= sqrt3/2
        if (Math.abs(px) * (SQ3 / 2) + Math.abs(py) / 2 > SQ3 / 2) continue;
        n++;
        if (covered(hx + px, hy + py)) hit++;
      }
      const share = hit / n;
      if (share >= 0.5) picked.push({ q, r, share });
      line += share >= 0.5 ? ` ${Math.round(share * 100)}`.padStart(4) : share > 0.1 ? ` (${Math.round(share * 100)})`.padStart(6) : '   .';
    }
    rows.push(`r=${r}: ${line}`);
  }
  console.log(rows.join('\n'));
  console.log(`${picked.length} hexes with at least half covered: ${picked.map((h) => `(${h.q},${h.r})`).join(' ')}`);
  console.log(`width ${((x1 - x0) * k).toFixed(2)} radii, length ${LENGTH}`);
})();

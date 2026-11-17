/*
 * Turns the renders (and the hand-made X-Wing screenshots) into the game's pictures:
 *   <id>-f0..f5.png   the ship at each hex facing (0 = nose up, then clockwise), all on one canvas size with the ship's
 *                     turning centre in the middle, so a ship that changes facing does not jump
 *   <id>-front.png    the picture for the ship card
 * Run it from the project folder: node tools/assemble-sprites.cjs [outDir]
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const renders = path.join(root, 'Models/renders');
const keyed = path.join(root, 'Models/keyed');
const out = path.resolve(process.argv[2] ?? path.join(root, 'Models/sprites'));
fs.mkdirSync(out, { recursive: true });
const TARGET = 512;
// Hand-made pictures can stand in for a ship's renders: { 'ship-id': { front: n, facings: [n, ...] } } with the pictures cut out in Models/keyed
// (see register-xwing.cjs). None is used now that every ship is rendered from its model.
const USER = {};

async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (data[(y * W + x) * 4 + 3] > 128) { n++; sx += x; sy += y; }
  }
  return { data, W, H, box: { x0, y0, x1, y1 }, area: n, centroid: [sx / n, sy / n] };
}

/** Copy `img` into a transparent canvas so that its point `anchor` lands on the canvas centre. */
function centred(img, anchor, CW, CH) {
  const buf = Buffer.alloc(CW * CH * 4);
  const dx = Math.round(CW / 2 - anchor[0]), dy = Math.round(CH / 2 - anchor[1]);
  for (let y = img.box.y0; y <= img.box.y1; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= CH) continue;
    for (let x = img.box.x0; x <= img.box.x1; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= CW) continue;
      const s = (y * img.W + x) * 4, t = (ty * CW + tx) * 4;
      buf[t] = img.data[s]; buf[t + 1] = img.data[s + 1]; buf[t + 2] = img.data[s + 2]; buf[t + 3] = img.data[s + 3];
    }
  }
  return buf;
}

/** The front picture: trimmed, on a square canvas. */
async function frontPicture(img, file) {
  const w = img.box.x1 - img.box.x0 + 1, h = img.box.y1 - img.box.y0 + 1;
  const side = Math.max(w, h) + 24;
  const buf = Buffer.alloc(side * side * 4);
  const ox = Math.round((side - w) / 2), oy = Math.round((side - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y + img.box.y0) * img.W + x + img.box.x0) * 4, t = ((y + oy) * side + x + ox) * 4;
    buf[t] = img.data[s]; buf[t + 1] = img.data[s + 1]; buf[t + 2] = img.data[s + 2]; buf[t + 3] = img.data[s + 3];
  }
  await sharp(buf, { raw: { width: side, height: side, channels: 4 } }).resize(512, 512).png({ compressionLevel: 9, effort: 10 }).toFile(file);
}

(async () => {
  const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['x-wing', 'a-wing', 'y-wing', 'y-wing-2seat', 'b-wing', 'tie-fighter', 'tie-interceptor', 'tie-interceptor-prototype', 'tie-bomber', 'imperial-shuttle', 'stock-freighter', 'millennium-falcon', 'slave-i', 'pirate-pinnace'];
  for (const id of ids) {
    const meta = JSON.parse(fs.readFileSync(path.join(renders, `${id}-3d.json`), 'utf8'));
    const mine = [];
    for (let f = 0; f < 6; f++) mine.push(await load(path.join(renders, `${id}-3d-f${f}.png`)));
    let imgs, anchors, front;
    if (USER[id]?.facings) {
      imgs = [];
      for (const k of USER[id].facings) imgs.push(await load(path.join(keyed, `${id}-${k}.png`)));
      // where the turning centre is: our own render of the same pose says where it lies relative to the silhouette's centroid
      const ratios = imgs.map((u, f) => Math.sqrt(u.area / mine[f].area)).sort((a, b) => a - b);
      const s = ratios[Math.floor(ratios.length / 2)];
      anchors = imgs.map((u, f) => [
        u.centroid[0] + s * (meta.facings[f].anchor[0] - mine[f].centroid[0]),
        u.centroid[1] + s * (meta.facings[f].anchor[1] - mine[f].centroid[1]),
      ]);
      console.log(id, 'hand-made pictures, scale vs our render', s.toFixed(2));
      front = await load(path.join(keyed, `${id}-${USER[id].front}.png`));
    } else {
      imgs = mine;
      anchors = meta.facings.map((m) => m.anchor);
      front = USER[id] ? await load(path.join(keyed, `${id}-${USER[id].front}.png`)) : await load(path.join(renders, `${id}-3d-front.png`));
    }
    let hw = 0, hh = 0;
    imgs.forEach((im, f) => {
      hw = Math.max(hw, anchors[f][0] - im.box.x0, im.box.x1 + 1 - anchors[f][0]);
      hh = Math.max(hh, anchors[f][1] - im.box.y0, im.box.y1 + 1 - anchors[f][1]);
    });
    const CW = Math.ceil(hw * 2) + 4, CH = Math.ceil(hh * 2) + 4;
    const k = TARGET / Math.max(CW, CH);
    for (let f = 0; f < 6; f++) {
      const buf = centred(imgs[f], anchors[f], CW, CH);
      await sharp(buf, { raw: { width: CW, height: CH, channels: 4 } }).resize(Math.round(CW * k), Math.round(CH * k)).png({ compressionLevel: 9, effort: 10 }).toFile(path.join(out, `${id}-f${f}.png`));
    }
    await frontPicture(front, path.join(out, `${id}-front.png`));
    console.log(id, `sprites ${Math.round(CW * k)}x${Math.round(CH * k)}`);
  }
})();

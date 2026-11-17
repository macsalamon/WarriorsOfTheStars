/*
 * How far is each hand-made X-Wing picture turned from where it should be? Our own render of the same facing (nose exactly
 * where the board's speed line points) is the reference: the screenshot's silhouette is rotated until it covers the
 * reference best. Prints the turn in degrees (positive = clockwise) that puts each picture right.
 */
const sharp = require('sharp');
const path = require('path');
const root = path.resolve(__dirname, '..');
const order = [3, 4, 5, 0, 1, 2]; // keyed picture of facing 0..5
const N = 400;

async function mask(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0, n = 0, sx = 0, sy = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 128) {
    n++; sx += x; sy += y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const cx = sx / n, cy = sy / n;
  return { data, W: info.width, H: info.height, cx, cy, area: n, span: Math.max(x1 - x0, y1 - y0) };
}

/** A set of points (relative to the centroid, in units of sqrt(area)) that are inside the silhouette. */
function points(m, step) {
  const pts = [];
  const k = Math.sqrt(m.area);
  for (let y = 0; y < m.H; y += step) for (let x = 0; x < m.W; x += step) if (m.data[(y * m.W + x) * 4 + 3] > 128) pts.push([(x - m.cx) / k, (y - m.cy) / k]);
  return pts;
}

function inside(m, u, v) {
  const k = Math.sqrt(m.area);
  const x = Math.round(m.cx + u * k), y = Math.round(m.cy + v * k);
  return x >= 0 && y >= 0 && x < m.W && y < m.H && m.data[(y * m.W + x) * 4 + 3] > 128;
}

(async () => {
  for (let f = 0; f < 6; f++) {
    const theirs = await mask(path.join(root, 'Models/keyed', `x-wing-${order[f]}.png`));
    const ref = await mask(path.join(root, 'Models/renders', `x-wing-3d-f${f}.png`));
    const pts = points(theirs, 4);
    let best = { iou: 0, deg: 0 };
    const scores = [];
    for (let deg = -40; deg <= 40; deg += 1) {
      const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
      let hit = 0;
      for (const [u, v] of pts) if (inside(ref, u * c - v * s, u * s + v * c)) hit++;
      const iou = hit / (pts.length * 2 - hit);
      scores.push(iou);
      if (iou > best.iou) best = { iou, deg };
    }
    const at0 = scores[40];
    // the sampling above maps the screenshot onto the reference by turning it clockwise by deg (the picture y axis points down)
    console.log(`facing ${f}: overlap ${at0.toFixed(2)} as taken, ${best.iou.toFixed(2)} after turning it ${best.deg} degrees clockwise`);
  }
})();

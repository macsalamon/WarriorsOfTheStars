/*
 * The pictures of the Star Destroyer (Rules: Star Destroyers): the six renders of the model (Models/renders/star-destroyer-3d-f0..f5.png, made by
 * tools/render3d.html with ?m=star-destroyer&elev=50: seen from above at an angle, lit from the left so that the superstructure throws shadows on the body,
 * the ship turned to each hex facing) cut to one square size with the ship's centre in the middle, so that the board can put each picture on the middle of
 * the eight hexes and the ship does not jump when it turns.
 * It also makes ${kind}-front.png, the picture for the ship's window (from the render seen from the front and above).
 * Run it from the project folder: node tools/assemble-destroyer.cjs [star-destroyer|mon-calamari|nebulon-b] [outDir]   (default: the Star Destroyer, into public/assets/ships)
 * It prints the span for CAPITAL_PICTURE in src/ui/board.ts: how wide the square is in hex radii. The Star Destroyer is scaled to be as wide as its eight hexes (5 radii);
 * the frigate, which is long and thin, to be as long as its two hexes (3.46 radii, a little less).
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const renders = path.join(root, 'Models/renders');
const kind = ['star-destroyer', 'mon-calamari', 'nebulon-b'].includes(process.argv[2]) ? process.argv[2] : 'star-destroyer';
const outArg = ['star-destroyer', 'mon-calamari', 'nebulon-b'].includes(process.argv[2]) ? process.argv[3] : process.argv[2];
const out = path.resolve(outArg ?? path.join(root, 'public/assets/ships'));
const SQUARE = 1300; // of the 1400 pixel render, round the centre
const SIZE = 800;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(path.join(renders, `${kind}-3d.json`), 'utf8'));
  let shipWidth = 0;
  let shipLength = 0;
  for (let f = 0; f < 6; f++) {
    const [ax, ay] = meta.facings[f].anchor;
    const file = path.join(renders, `${kind}-3d-f${f}.png`);
    const BIG = 2400;
    const canvas = await sharp({ create: { width: BIG, height: BIG, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: file, left: Math.round(BIG / 2 - ax), top: Math.round(BIG / 2 - ay) }])
      .png()
      .toBuffer();
    const half = SQUARE / 2;
    await sharp(canvas)
      .extract({ left: BIG / 2 - half, top: BIG / 2 - half, width: SQUARE, height: SQUARE })
      .resize(SIZE, SIZE)
      .png({ compressionLevel: 9 })
      .toFile(path.join(out, `${kind}-f${f}.png`));
    if (f === 0) {
      const trimmed = await sharp(file).trim({ threshold: 8 }).toBuffer({ resolveWithObject: true });
      shipWidth = trimmed.info.width;
      shipLength = trimmed.info.height;
    }
  }
  // the Star Destroyer is as wide as its footprint (5 radii), the Mon Calamari cruiser as wide as its seven hexes on the Star Destroyer's length (3.38, see tools/hex-cover.cjs), the frigate as long as its two hexes
  // the picture for the ship's window: the render from the front and above, cut to the ship and put in a square
  const front = await sharp(path.join(renders, `${kind}-3d-front.png`)).trim({ threshold: 8 }).resize({ width: 480, height: 480, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(out, `${kind}-front.png`), front);
  const radii = kind === 'star-destroyer' ? 5 * (SQUARE / shipWidth) : kind === 'mon-calamari' ? 3.38 * (SQUARE / shipWidth) : 3.29 * (SQUARE / shipLength);
  console.log(`six pictures of ${SIZE} x ${SIZE} for the ${kind} (${shipWidth} x ${shipLength} px in a square of ${SQUARE}): span ${radii.toFixed(3)} hex radii`);
})();

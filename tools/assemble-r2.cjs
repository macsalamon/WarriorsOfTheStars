/*
 * The picture of the R2 unit for the crew icons (public/assets/crew/r2.png): the render of the droid from the front and above (Models/renders/r2d2-3d-front.png,
 * made by tools/render3d.html with ?m=r2d2; only the droid's own parts of the model are shown, see droidOnly in tools/ships.js), cut to the droid and put in a square on dark grey.
 * Run it from the project folder: node tools/assemble-r2.cjs
 */
const sharp = require('sharp');
const path = require('path');

const root = path.resolve(__dirname, '..');
(async () => {
  const trimmed = await sharp(path.join(root, 'Models/renders/r2d2-3d-front.png')).trim({ threshold: 8 }).toBuffer();
  await sharp(trimmed)
    // on dark grey: the droid is white and would vanish on the light discs of the crew icons
    .resize({ width: 200, height: 200, fit: 'contain', background: { r: 45, g: 50, b: 60, alpha: 1 } })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 45, g: 50, b: 60, alpha: 1 } })
    .flatten({ background: { r: 45, g: 50, b: 60 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, 'public/assets/crew/r2.png'));
  console.log('public/assets/crew/r2.png: 220 x 220');
})();

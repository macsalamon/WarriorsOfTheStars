/*
 * Turns the ship models of Fate of the Galaxy (Rebellion, the Star Wars mod for FreeSpace Open; they are .pof files with .dds textures) into
 * .glb files in Models/converted/ (one for each ship of the game, with its squadron markings from tools/paint.mjs), which tools/render3d.html can render.
 * Usage: node tools/fotg-to-glb.mjs <path to the FotG "data" folder> [ship ...]   (ids of the game's ships; all by default)
 * Only the ship at its best detail level is read, with its base texture (diffuse map). Nothing from the mod is stored in this repository
 * except the pictures rendered from the models (see CREDITS.md).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { readDds } from './dds.mjs';
import { PAINT, POSE } from './paint.mjs';
import { readPof, shipGeometry, writeGlb } from './pof.mjs';

const root = resolve(import.meta.dirname, '..');
const data = process.argv[2];
if (!data) {
  console.error('Usage: node tools/fotg-to-glb.mjs <path to the FotG data folder> [model ...]');
  process.exit(1);
}

/** The game's ships and the FotG model each one is made from. */
const SHIPS = {
  'x-wing': 'x-wing',
  'a-wing': 'a-wing',
  'b-wing': 'b-wing',
  // the same model with the cockpit pod turned, for the board pictures
  'b-wing-side': 'b-wing',
  'y-wing': 'y-wing',
  'y-wing-2seat': 'y-wing',
  'tie-fighter': 't-fighter',
  'tie-interceptor': 't-interc',
  'tie-interceptor-prototype': 't-advanced',
  'tie-bomber': 't-bomber',
  'imperial-shuttle': 'lambda',
  'stock-freighter': 'yt1300',
  'millennium-falcon': 'yt1300_falcon',
  'slave-i': 'firespray_s1',
  'pirate-pinnace': 'skipray',
  // the Star Destroyer (Rules: Star Destroyers)
  'star-destroyer': 'isd',
  // the Rebels' frigate
  'nebulon-b': 'nebulon-b',
  // the Mon Calamari cruiser (the Liberty)
  'mon-calamari': 'liberty',
  // the asteroids of the field (Rules: Asteroid fields): big, medium and small rocks in brown, blue and grey
  'ast-1': 'da/AstBig01_brown',
  'ast-2': 'da/AstBig02_blue',
  'ast-3': 'da/AstBig03_grey',
  'ast-4': 'da/AstMed01_brown',
  'ast-5': 'da/AstMed02_blue',
  'ast-6': 'da/AstMed03_grey',
  'ast-7': 'da/AstSml01_brown',
  'ast-8': 'da/AstSml02_blue',
  'ast-9': 'da/AstSml03_grey',
};

const maps = new Map(readdirSync(join(data, 'maps')).map((f) => [f.toLowerCase(), f]));
const out = join(root, 'Models', 'converted');
mkdirSync(out, { recursive: true });
const wanted = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SHIPS);

for (const id of wanted) {
  const name = SHIPS[id];
  if (!name) throw new Error(`Unknown ship ${id}`);
  const paint = PAINT[id];
  const pof = readPof(join(data, 'models', `${name}.pof`));
  const geometry = shipGeometry(pof);
  // the cockpit pod turned about the spine, for ships that need it
  const pose = POSE[id];
  if (pose) {
    const [px, py, pz] = pose.pivot;
    const c = Math.cos((pose.degrees * Math.PI) / 180);
    const sn = Math.sin((pose.degrees * Math.PI) / 180);
    for (const g of geometry.groups) {
      for (let t = 0; t < g.owners.length; t++) {
        if (g.owners[t] !== pose.part) continue;
        for (let v = 0; v < 3; v++) {
          const i = (t * 3 + v) * 3;
          // a turn about the line of flight (z) or the spine (y), about the pivot for the positions
          const [a, b] = pose.axis === 'z' ? [0, 1] : [2, 0];
          const origin = [px, py, pz];
          const da = g.positions[i + a] - origin[a];
          const db = g.positions[i + b] - origin[b];
          g.positions[i + a] = origin[a] + da * c - db * sn;
          g.positions[i + b] = origin[b] + da * sn + db * c;
          const na = g.normals[i + a];
          const nb = g.normals[i + b];
          g.normals[i + a] = na * c - nb * sn;
          g.normals[i + b] = na * sn + nb * c;
        }
      }
    }
  }
  // how wide each part is at each length, to tell the middle of a part from its edges
  const width = new Map();
  const bin = (z) => Math.round(z / 0.3);
  for (const g of geometry.groups) {
    for (let t = 0; t < g.owners.length; t++) {
      for (let v = 0; v < 3; v++) {
        const key = `${g.owners[t]}|${bin(g.positions[(t * 3 + v) * 3 + 2])}`;
        width.set(key, Math.max(width.get(key) ?? 0, Math.abs(g.positions[(t * 3 + v) * 3])));
      }
    }
  }
  // squadron markings: a colour for every triangle that has one, as vertex colours
  if (paint?.triangle) {
    for (const g of geometry.groups) {
      g.colors = [];
      for (let t = 0; t < g.owners.length; t++) {
        const p = g.positions.slice(t * 9, t * 9 + 9);
        const nn = g.normals.slice(t * 9, t * 9 + 9);
        const c = [0, 1, 2].map((k) => (p[k] + p[3 + k] + p[6 + k]) / 3);
        const n = [0, 1, 2].map((k) => (nn[k] + nn[3 + k] + nn[6 + k]) / 3);
        const wide = width.get(`${g.owners[t]}|${bin(c[2])}`) || 1;
        const colour = paint.triangle({ part: g.owners[t], c, n, rel: Math.abs(c[0]) / wide }) ?? [1, 1, 1];
        for (let v = 0; v < 3; v++) g.colors.push(colour[0], colour[1], colour[2], 1);
      }
    }
  }
  const materials = [];
  for (let i = 0; i < pof.textures.length; i++) {
    const texture = pof.textures[i];
    const file = maps.get(`${texture.toLowerCase()}.dds`);
    let png = null;
    if (file && geometry.groups.some((g) => g.texture === i)) {
      const { width, height, rgba } = readDds(join(data, 'maps', file));
      // a texture is changed for the ship's own markings only when the rule says so (the R2 unit's picture is left alone)
      if (paint?.texture && !/^r2/i.test(texture)) paint.texture(rgba, width, height);
      png = await sharp(rgba, { raw: { width, height, channels: 4 } }).resize(1024, 1024, { fit: 'inside' }).png().toBuffer();
    } else if (geometry.groups.some((g) => g.texture === i)) console.warn(`  ${id}: no texture file for "${texture}"`);
    materials.push({ name: texture, png, colour: [0.6, 0.6, 0.6] });
  }
  const glb = writeGlb(geometry, materials);
  writeFileSync(join(out, `${id}.glb`), glb);
  console.log(`${id}: ${geometry.polygons} polygons, ${materials.filter((m) => m.png).length} textures, ${(glb.length / 1e6).toFixed(1)} MB`);
}
void existsSync;

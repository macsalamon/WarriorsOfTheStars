/*
 * Reads where the engines of the ships are from the models of Fate of the Galaxy (the thruster points of the .pof files) and writes them to
 * public/assets/models/engines.json, for the glow of the engines on the 3D board: for each model file a list of [x, y, z, radius] in the
 * model's own measure (metres), in the same axes as the converted models (tools/fotg-to-glb.mjs: the sign of x is flipped).
 *
 * Usage: node tools/engines.mjs <path to the FotG "data" folder>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = process.argv[2];
if (!data) {
  console.error('Usage: node tools/engines.mjs <path to the FotG data folder>');
  process.exit(1);
}

/** The model files of public/assets/models and the FotG model each one is made from (as in tools/fotg-to-glb.mjs). */
const SHIPS = {
  'x-wing': 'x-wing',
  'a-wing': 'a-wing',
  'b-wing': 'b-wing',
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
  'star-destroyer': 'isd',
  'nebulon-b': 'nebulon-b',
  'mon-calamari': 'liberty',
};

/** The thruster points of a .pof file: the FUEL chunk, a list of thrusters each with its glow points (position, direction, radius). */
function thrusters(file) {
  const buf = readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.toString('ascii', 0, 4) !== 'PSPO') throw new Error(`${file} is not a POF file`);
  const version = dv.getInt32(4, true);
  const points = [];
  for (let p = 8; p + 8 <= buf.length; ) {
    const id = buf.toString('ascii', p, p + 4);
    const len = dv.getInt32(p + 4, true);
    if (id === 'FUEL') {
      let q = p + 8;
      const count = dv.getInt32(q, true);
      q += 4;
      for (let i = 0; i < count; i++) {
        const glows = dv.getInt32(q, true);
        q += 4;
        // newer files name the engine the thruster belongs to
        if (version >= 2117) q += 4 + dv.getInt32(q, true);
        for (let g = 0; g < glows; g++) {
          const f = (k) => dv.getFloat32(q + k * 4, true);
          const round = (n) => Math.round(n * 100) / 100;
          points.push([round(-f(0)), round(f(1)), round(f(2)), round(f(6))]);
          q += 28;
        }
      }
    }
    p += 8 + len;
  }
  return points;
}

const out = {};
for (const [name, model] of Object.entries(SHIPS)) {
  const file = join(data, 'models', `${model}.pof`);
  if (!existsSync(file)) {
    console.log(`missing: ${file}`);
    continue;
  }
  out[name] = thrusters(file);
  console.log(`${name}: ${out[name].length} engine points`, JSON.stringify(out[name].slice(0, 4)));
}
writeFileSync(join(ROOT, 'public/assets/models/engines.json'), `${JSON.stringify(out)}\n`);

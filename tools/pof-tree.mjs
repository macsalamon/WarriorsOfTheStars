/* Lists the sub-objects of Fate of the Galaxy models and how many polygons were read: node tools/pof-tree.mjs <model name> ... (edit `root` to the mod's data/models folder). */
import { readPof, bodyObjects, shipGeometry } from './pof.mjs';

const root = 'D:/Games/kn_portable/Library/FotG_R/FotG_R-1.1.2/data/models';
for (const name of process.argv.slice(2)) {
  const pof = readPof(`${root}/${name}.pof`);
  console.log(`== ${name}: details ${pof.details.join(',')} debris ${pof.debris.join(',')} textures ${pof.textures.join(',')}`);
  const body = new Set(bodyObjects(pof).map((o) => o.number));
  for (const o of pof.objects) console.log(`  ${String(o.number).padStart(2)} parent ${String(o.parent).padStart(2)} ${body.has(o.number) ? 'USED' : '    '} ${o.name.padEnd(28)} move ${o.movement} axis ${o.axis} bsp ${o.bsp.size} off ${o.offset.map((v) => v.toFixed(1)).join(',')}`);
  const g = shipGeometry(pof);
  console.log(`  polygons ${g.polygons}, groups ${g.groups.map((x) => `${x.texture}:${x.positions.length / 9}tri`).join(' ')}`);
}

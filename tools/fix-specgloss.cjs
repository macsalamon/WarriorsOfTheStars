/*
 * Some Sketchfab models use the old "specular-glossiness" material extension, which the viewer library no longer reads, so they come out grey.
 * This copies such a model to Models/converted/ with the diffuse colour and picture as the ordinary base colour.
 * Usage: node tools/fix-specgloss.cjs Models/some-model.glb
 */
const fs = require('fs');
const path = require('path');
const src = path.resolve(process.argv[2]);
const out = path.join(path.dirname(src), 'converted', path.basename(src));
const b = fs.readFileSync(src);
const jsonLen = b.readUInt32LE(12);
const json = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8'));
let fixed = 0;
for (const m of json.materials ?? []) {
  const sg = m.extensions?.KHR_materials_pbrSpecularGlossiness;
  if (!sg) continue;
  m.pbrMetallicRoughness = { baseColorFactor: sg.diffuseFactor ?? [1, 1, 1, 1], metallicFactor: 0.25, roughnessFactor: 0.55 };
  if (sg.diffuseTexture) m.pbrMetallicRoughness.baseColorTexture = sg.diffuseTexture;
  delete m.extensions.KHR_materials_pbrSpecularGlossiness;
  if (!Object.keys(m.extensions).length) delete m.extensions;
  fixed++;
}
json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => e !== 'KHR_materials_pbrSpecularGlossiness');
if (!json.extensionsUsed.length) delete json.extensionsUsed;
let text = Buffer.from(JSON.stringify(json), 'utf8');
const pad = (4 - (text.length % 4)) % 4;
text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
const rest = b.slice(20 + jsonLen); // the binary chunk
const total = 12 + 8 + text.length + rest.length;
const head = Buffer.alloc(20);
b.copy(head, 0, 0, 12);
head.writeUInt32LE(total, 8);
head.writeUInt32LE(text.length, 12);
head.writeUInt32LE(0x4e4f534a, 16);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, text, rest]));
console.log(`${path.basename(src)}: ${fixed} material(s) converted -> ${out}`);

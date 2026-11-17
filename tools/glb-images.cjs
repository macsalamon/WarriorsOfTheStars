/* Saves the pictures inside a GLB model and says which material uses which. Usage: node tools/glb-images.cjs Models/x.glb outDir */
const fs = require('fs');
const path = require('path');
const [file, outDir] = process.argv.slice(2);
const b = fs.readFileSync(file);
const jl = b.readUInt32LE(12);
const j = JSON.parse(b.slice(20, 20 + jl).toString('utf8'));
const bin = b.slice(20 + jl + 8);
fs.mkdirSync(outDir, { recursive: true });
const users = {};
(j.materials ?? []).forEach((m, mi) => {
  const pm = m.pbrMetallicRoughness ?? {};
  for (const [slot, t] of Object.entries({ base: pm.baseColorTexture, mr: pm.metallicRoughnessTexture, normal: m.normalTexture, emissive: m.emissiveTexture, occlusion: m.occlusionTexture })) {
    if (!t) continue;
    const img = j.textures[t.index].source;
    (users[img] ??= []).push(`${m.name ?? mi}:${slot}`);
  }
});
(j.images ?? []).forEach((im, i) => {
  const bv = j.bufferViews[im.bufferView];
  const ext = im.mimeType === 'image/png' ? 'png' : 'jpg';
  fs.writeFileSync(path.join(outDir, `img${i}.${ext}`), bin.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  console.log(`img${i}.${ext}`, im.mimeType, (users[i] ?? []).join(', '));
});

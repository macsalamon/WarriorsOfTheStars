/*
 * Packs the models for the 3D board: the files of Models/converted (made by tools/fotg-to-glb.mjs from the Fate of the Galaxy models, with the
 * markings of tools/paint.mjs) are copied to public/assets/models with their pictures turned from PNG into WebP, which makes them five to ten
 * times smaller. Nothing else in the model changes. The turret guns and the ground target are other people's models (see CREDITS.md), taken
 * from Models/ itself; of the Death Star surface model only the two pieces the game shows are kept.
 *
 * Usage: npm run models
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FROM = join(ROOT, 'Models');
const TO = join(ROOT, 'public/assets/models');

/**
 * The file in public/assets/models, and the model in Models/ it is made from. The B-wing is the one with its cockpit pod turned back (it
 * flies on its side). `keep` names the only children of a node that are kept (the names as the 3D loader reads them).
 */
const MODELS = {
  'x-wing': { from: 'converted/x-wing' },
  'a-wing': { from: 'converted/a-wing' },
  'y-wing': { from: 'converted/y-wing' },
  'y-wing-2seat': { from: 'converted/y-wing-2seat' },
  'b-wing': { from: 'converted/b-wing-side' },
  'tie-fighter': { from: 'converted/tie-fighter' },
  'tie-interceptor': { from: 'converted/tie-interceptor' },
  'tie-interceptor-prototype': { from: 'converted/tie-interceptor-prototype' },
  'tie-bomber': { from: 'converted/tie-bomber' },
  'imperial-shuttle': { from: 'converted/imperial-shuttle' },
  'stock-freighter': { from: 'converted/stock-freighter' },
  'millennium-falcon': { from: 'converted/millennium-falcon' },
  'slave-i': { from: 'converted/slave-i' },
  'pirate-pinnace': { from: 'converted/pirate-pinnace' },
  'star-destroyer': { from: 'converted/star-destroyer' },
  'mon-calamari': { from: 'converted/mon-calamari' },
  'nebulon-b': { from: 'converted/nebulon-b' },
  // the asteroids: big, medium and small rocks in brown, blue and grey
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`ast-${n}`, { from: `converted/ast-${n}` }])),
  'turret-single': { from: 'hoth_defense_turret_-_star_wars' },
  // the cannon tower (the double turret) and the round building (the ground target)
  'base-parts': { from: 'star_wars_death_star_surface_parts', keep: { under: 'Root', names: ['CannonTower', 'Cube000'] } },
};

/** A node's name as the 3D loader makes it. */
const plain = (name = '') => name.replace(/\s/g, '_').replace(/[\[\].:/]/g, '');

const pad4 = (n) => (n + 3) & ~3;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/**
 * Keeps only some children of a node, and of the data only what the pieces that are left use: the model's data lies in a few large blocks
 * shared by all its pieces, so every list of numbers still used is copied out into a block of its own. Gives the new data.
 */
function prune(json, bin, keep) {
  const parent = json.nodes.find((n) => plain(n.name) === keep.under);
  if (!parent) throw new Error(`no node ${keep.under}`);
  parent.children = (parent.children ?? []).filter((i) => keep.names.includes(plain(json.nodes[i].name)));
  if (parent.children.length !== keep.names.length) throw new Error('not every kept piece was found');
  delete json.animations;
  const accessors = new Set();
  const images = new Set();
  const texture = (info) => {
    const tex = json.textures?.[info.index];
    const image = tex?.source ?? tex?.extensions?.EXT_texture_webp?.source;
    if (image !== undefined) images.add(image);
  };
  const textures = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const [key, value] of Object.entries(o)) {
      if (/Texture$/.test(key) && value && typeof value.index === 'number') texture(value);
      else textures(value);
    }
  };
  const walk = (i) => {
    const node = json.nodes[i];
    const mesh = json.meshes?.[node.mesh];
    for (const primitive of mesh?.primitives ?? []) {
      for (const a of Object.values(primitive.attributes ?? {})) accessors.add(a);
      if (primitive.indices !== undefined) accessors.add(primitive.indices);
      for (const target of primitive.targets ?? []) for (const a of Object.values(target)) accessors.add(a);
      if (primitive.material !== undefined) textures(json.materials[primitive.material]);
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const scene of json.scenes ?? []) for (const i of scene.nodes ?? []) walk(i);

  const old = json.bufferViews;
  const views = [];
  const parts = [];
  let offset = 0;
  const add = (bytes, more = {}) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...more });
    parts.push(bytes);
    const gap = pad4(bytes.length) - bytes.length;
    if (gap) parts.push(Buffer.alloc(gap));
    offset += bytes.length + gap;
    return views.length - 1;
  };
  json.accessors.forEach((accessor, i) => {
    if (!accessors.has(i) || accessor.bufferView === undefined) {
      delete accessor.bufferView;
      delete accessor.byteOffset;
      return;
    }
    if (accessor.sparse) throw new Error('a sparse list of numbers: not handled');
    const view = old[accessor.bufferView];
    const size = COMPONENTS[accessor.type] * BYTES[accessor.componentType];
    const stride = view.byteStride ?? size;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const bytes = Buffer.alloc(size * accessor.count);
    for (let n = 0; n < accessor.count; n++) bin.copy(bytes, n * size, start + n * stride, start + n * stride + size);
    accessor.bufferView = add(bytes, view.target ? { target: view.target } : {});
    accessor.byteOffset = 0;
  });
  (json.images ?? []).forEach((image, i) => {
    if (image.bufferView === undefined) return;
    const view = old[image.bufferView];
    image.bufferView = add(images.has(i) ? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength) : PIXEL);
  });
  json.bufferViews = views;
  return Buffer.concat(parts);
}

/** A picture of one pixel, in the place of the pictures nothing uses any more. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64');

/** The old way of saying how shiny a material is, which the 3D library no longer reads: said the ordinary way (as tools/fix-specgloss.cjs does). */
function plainMaterials(json) {
  for (const m of json.materials ?? []) {
    const sg = m.extensions?.KHR_materials_pbrSpecularGlossiness;
    if (!sg) continue;
    m.pbrMetallicRoughness = { baseColorFactor: sg.diffuseFactor ?? [1, 1, 1, 1], metallicFactor: 0.25, roughnessFactor: 0.55 };
    if (sg.diffuseTexture) m.pbrMetallicRoughness.baseColorTexture = sg.diffuseTexture;
    delete m.extensions.KHR_materials_pbrSpecularGlossiness;
    if (!Object.keys(m.extensions).length) delete m.extensions;
  }
  const gone = (list) => (list ?? []).filter((e) => e !== 'KHR_materials_pbrSpecularGlossiness');
  json.extensionsUsed = gone(json.extensionsUsed);
  json.extensionsRequired = gone(json.extensionsRequired);
}

async function pack(source, keep) {
  const file = readFileSync(source);
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
  let bin = file.subarray(20 + jsonLength + 8);
  plainMaterials(json);
  if (keep) bin = prune(json, bin, keep);

  const imageViews = new Map((json.images ?? []).map((image, i) => [image.bufferView, i]));
  const parts = [];
  let offset = 0;
  for (let i = 0; i < json.bufferViews.length; i++) {
    const view = json.bufferViews[i];
    if ((view.buffer ?? 0) !== 0) throw new Error('more than one buffer');
    let bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    if (imageViews.has(i)) {
      bytes = await sharp(bytes).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toBuffer();
      json.images[imageViews.get(i)].mimeType = 'image/webp';
    }
    view.byteOffset = offset;
    view.byteLength = bytes.length;
    parts.push(bytes);
    const gap = pad4(bytes.length) - bytes.length;
    if (gap) parts.push(Buffer.alloc(gap));
    offset += bytes.length + gap;
  }
  // the pictures are WebP now: said the way the glTF format wants it
  for (const texture of json.textures ?? []) {
    texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: texture.source } };
    delete texture.source;
  }
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_texture_webp'])];
  json.buffers = [{ byteLength: offset }];

  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc(pad4(text.length) - text.length, 0x20)]);
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
  const chunk = (length, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([header, chunk(text.length, 0x4e4f534a), text, chunk(body.length, 0x004e4942), body]);
}

mkdirSync(TO, { recursive: true });
let total = 0;
for (const [name, { from, keep }] of Object.entries(MODELS)) {
  const source = join(FROM, `${from}.glb`);
  if (!existsSync(source)) {
    console.log(`missing: ${source}`);
    continue;
  }
  const packed = await pack(source, keep);
  writeFileSync(join(TO, `${name}.glb`), packed);
  total += packed.length;
  console.log(`${name}.glb  ${(packed.length / 1024).toFixed(0)} KB`);
}
console.log(`${(total / 1024 / 1024).toFixed(1)} MB in public/assets/models`);

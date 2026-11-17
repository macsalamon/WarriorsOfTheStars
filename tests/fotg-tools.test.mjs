import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDds } from '../tools/dds.mjs';
import { writeGlb } from '../tools/pof.mjs';

/** A DDS file of one 4x4 DXT1 block: colour 0 pure red, colour 1 pure blue, the pixels of the first row 0, 1, 2, 3. */
function dxt1(width = 4, height = 4) {
  const header = Buffer.alloc(128);
  header.write('DDS ', 0);
  header.writeUInt32LE(124, 4);
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);
  header.writeUInt32LE(4, 80);
  header.write('DXT1', 84);
  const block = Buffer.alloc(8);
  block.writeUInt16LE(0xf800, 0); // red
  block.writeUInt16LE(0x001f, 2); // blue
  block.writeUInt32LE(0b11100100, 4); // pixels 0..3 of the first row: indexes 0, 1, 2, 3
  return Buffer.concat([header, block]);
}

describe('the tools that read the Fate of the Galaxy models', () => {
  it('decodes a DXT1 picture', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dds-')), 'x.dds');
    writeFileSync(file, dxt1());
    const { width, height, rgba } = readDds(file);
    expect([width, height]).toEqual([4, 4]);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]); // red
    expect([...rgba.subarray(4, 8)]).toEqual([0, 0, 255, 255]); // blue
    // the two colours in between: a third and two thirds of the way
    expect([...rgba.subarray(8, 12)]).toEqual([170, 0, 85, 255]);
    expect([...rgba.subarray(12, 16)]).toEqual([85, 0, 170, 255]);
  });

  it('writes a binary glTF that holds a mesh with one primitive for each texture', () => {
    const triangle = { texture: 0, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1] };
    const glb = writeGlb({ groups: [triangle, { ...triangle, texture: 1 }], polygons: 2 }, [{ name: 'a', png: null, colour: [1, 0, 0] }, { name: 'b', png: null, colour: [0, 1, 0] }]);
    expect(glb.toString('ascii', 0, 4)).toBe('glTF');
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
    expect(json.meshes[0].primitives).toHaveLength(2);
    expect(json.materials.map((m) => m.name)).toEqual(['a', 'b']);
    expect(json.accessors[0].count).toBe(3);
    expect(json.accessors[0].max).toEqual([1, 1, 0]);
  });
});

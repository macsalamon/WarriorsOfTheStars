import { readFileSync } from 'node:fs';

/** Reads the first (largest) picture of a DDS file as 8-bit RGBA. Supports DXT1, DXT3, DXT5 and plain 32-bit and 24-bit pictures. */
export function readDds(file) {
  const d = readFileSync(file);
  if (d.toString('ascii', 0, 4) !== 'DDS ') throw new Error(`${file} is not a DDS file`);
  const height = d.readUInt32LE(12);
  const width = d.readUInt32LE(16);
  const pfFlags = d.readUInt32LE(80);
  const fourcc = d.toString('ascii', 84, 88);
  const rgba = Buffer.alloc(width * height * 4);
  const rgb565 = (v) => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31].map(Math.round);

  if (fourcc === 'DXT1' || fourcc === 'DXT3' || fourcc === 'DXT5') {
    const block = fourcc === 'DXT1' ? 8 : 16;
    let p = 128;
    for (let by = 0; by < height; by += 4) {
      for (let bx = 0; bx < width; bx += 4) {
        const colourAt = fourcc === 'DXT1' ? p : p + 8;
        const c0 = d.readUInt16LE(colourAt);
        const c1 = d.readUInt16LE(colourAt + 2);
        const a = rgb565(c0);
        const b = rgb565(c1);
        const palette = [[...a, 255], [...b, 255]];
        if (c0 > c1 || fourcc !== 'DXT1') {
          palette.push([...a.map((v, i) => Math.round((2 * v + b[i]) / 3)), 255], [...a.map((v, i) => Math.round((v + 2 * b[i]) / 3)), 255]);
        } else {
          palette.push([...a.map((v, i) => Math.round((v + b[i]) / 2)), 255], [0, 0, 0, 0]);
        }
        const bits = d.readUInt32LE(colourAt + 4);
        // alpha of DXT3 (explicit) and DXT5 (interpolated)
        const alpha = new Array(16).fill(255);
        if (fourcc === 'DXT3') {
          for (let i = 0; i < 16; i++) alpha[i] = ((d[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
        } else if (fourcc === 'DXT5') {
          const a0 = d[p];
          const a1 = d[p + 1];
          const table = [a0, a1];
          if (a0 > a1) for (let i = 1; i <= 6; i++) table.push(Math.round(((7 - i) * a0 + i * a1) / 7));
          else {
            for (let i = 1; i <= 4; i++) table.push(Math.round(((5 - i) * a0 + i * a1) / 5));
            table.push(0, 255);
          }
          let abits = 0n;
          for (let i = 0; i < 6; i++) abits |= BigInt(d[p + 2 + i]) << BigInt(8 * i);
          for (let i = 0; i < 16; i++) alpha[i] = table[Number((abits >> BigInt(3 * i)) & 7n)];
        }
        for (let i = 0; i < 16; i++) {
          const x = bx + (i & 3);
          const y = by + (i >> 2);
          if (x >= width || y >= height) continue;
          const c = palette[(bits >> (2 * i)) & 3];
          const o = (y * width + x) * 4;
          rgba[o] = c[0];
          rgba[o + 1] = c[1];
          rgba[o + 2] = c[2];
          rgba[o + 3] = fourcc === 'DXT1' ? c[3] : alpha[i];
        }
        p += block;
      }
    }
    return { width, height, rgba };
  }
  const bpp = d.readUInt32LE(88);
  if ((pfFlags & 0x40) && (bpp === 32 || bpp === 24)) {
    const bytes = bpp / 8;
    for (let i = 0; i < width * height; i++) {
      const o = 128 + i * bytes;
      rgba[i * 4] = d[o + 2];
      rgba[i * 4 + 1] = d[o + 1];
      rgba[i * 4 + 2] = d[o];
      rgba[i * 4 + 3] = bytes === 4 ? d[o + 3] : 255;
    }
    return { width, height, rgba };
  }
  throw new Error(`${file}: unsupported DDS format ${fourcc || `${bpp} bit`}`);
}

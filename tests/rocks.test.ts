import { describe, expect, it } from 'vitest';
import { STANDARD_MAP, createField, createRng, driftTurn, hasHole, isAllowedShape, keyOf, neighbor, fromOffset, reduceRock, spawnLost, type AsteroidField, type Hex, type MapSpec, type Rock } from '../src/engine';
import { composeRock, rockOutline } from '../src/ui/rocks';

const R = 26;
const toPixel = (h: Hex): { x: number; y: number } => ({ x: R * 1.5 * h.q, y: R * Math.sqrt(3) * (h.r + h.q / 2) });
const map: MapSpec = { ...STANDARD_MAP, mode: 'static' };

/** The area an outline path encloses, with its curves followed. */
function areaOf(d: string): number {
  let total = 0;
  for (const loop of d.split('Z').filter(Boolean)) {
    const nums = loop.match(/-?\d+\.?\d*/g)!.map(Number);
    const pts: [number, number][] = [];
    // the loop is: M a Q c b, then L a Q c b ... with six numbers for each corner
    for (let i = 0; i + 5 < nums.length; i += 6) {
      const [ax, ay, cx, cy, bx, by] = nums.slice(i, i + 6) as [number, number, number, number, number, number];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        pts.push([(1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t * t * by]);
      }
    }
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      a += p[0] * q[1] - q[0] * p[1];
    }
    total += Math.abs(a) / 2;
  }
  return total;
}

const HEX_AREA = (3 * Math.sqrt(3) / 2) * R * R;

describe('the outline of an asteroid', () => {
  const shapes: Record<string, Hex[]> = {
    one: [fromOffset(5, 5)],
    line: [fromOffset(5, 5), fromOffset(5, 6), fromOffset(5, 7), fromOffset(5, 8)],
    lump: [fromOffset(5, 5), fromOffset(5, 6), fromOffset(6, 5), fromOffset(6, 6), fromOffset(4, 5), fromOffset(4, 6), fromOffset(5, 4)],
    bent: [fromOffset(5, 5), fromOffset(5, 6), fromOffset(6, 6), fromOffset(7, 6), fromOffset(7, 7)],
  };

  for (const [name, hexes] of Object.entries(shapes)) {
    it(`fills at least four fifths of every hex of a ${name} rock, and not much more than the hexes`, () => {
      const area = areaOf(rockOutline(hexes, toPixel, R, 7));
      expect(area / (hexes.length * HEX_AREA)).toBeGreaterThan(0.8);
      expect(area / (hexes.length * HEX_AREA)).toBeLessThan(1.05);
    });
  }

  it('is one closed loop for a solid shape', () => {
    const d = rockOutline(shapes.lump!, toPixel, R, 3);
    expect(d.split('Z').filter(Boolean)).toHaveLength(1);
  });

  it('puts the centre of mass of every rock at the middle of its hexes', () => {
    const look = composeRock({ id: 1, hexes: shapes.line!, vel: { q: 0, r: 0 }, look: 5 }, toPixel, R);
    const p = shapes.line!.map(toPixel);
    expect(look.centre.x).toBeCloseTo(p.reduce((s, q) => s + q.x, 0) / p.length, 6);
    expect(look.centre.y).toBeCloseTo(p.reduce((s, q) => s + q.y, 0) / p.length, 6);
  });
});

describe('the shapes of the field', () => {
  it('has no rock that encloses an empty hex', () => {
    expect(hasHole([fromOffset(5, 5), fromOffset(5, 6), fromOffset(5, 7)])).toBe(false);
    // a ring of six around one empty hex
    const centre = fromOffset(6, 6);
    const ring = [0, 1, 2, 3, 4, 5].map((d) => neighbor(centre, d));
    expect(hasHole(ring)).toBe(true);
    for (let seed = 1; seed <= 6; seed++) {
      const f = createField(map, [], { density: 'dense', motion: 'drift' }, createRng(seed));
      for (const r of f.rocks) expect(hasHole(r.hexes)).toBe(false);
    }
  });

  it('keeps asteroids from touching each other where there is room, so that each reads as one rock', () => {
    for (const density of ['sparse', 'medium'] as const) {
      const f = createField(map, [], { density, motion: 'drift' }, createRng(12));
      const owner = new Map<string, number>();
      for (const r of f.rocks) for (const h of r.hexes) owner.set(keyOf(h), r.id);
      let touching = 0;
      for (const r of f.rocks) {
        const others = new Set<number>();
        for (const h of r.hexes) for (let d = 0; d < 6; d++) {
          const o = owner.get(keyOf(neighbor(h, d)));
          if (o !== undefined && o !== r.id) others.add(o);
        }
        if (others.size > 0) touching += 1;
      }
      expect(touching / f.rocks.length).toBeLessThan(0.05);
    }
  });
});

const H = (q: number, r: number): Hex => ({ q, r });

describe('the shapes asteroids may have', () => {
  it('allows the compact ones and nothing long or bent', () => {
    expect(isAllowedShape([H(0, 0)])).toBe(true);
    expect(isAllowedShape([H(0, 0), H(1, 0)])).toBe(true);
    // size 3: a triangle or a straight line, not an L
    expect(isAllowedShape([H(0, 0), H(1, 0), H(0, 1)])).toBe(true);
    expect(isAllowedShape([H(0, 0), H(1, 0), H(2, 0)])).toBe(true);
    expect(isAllowedShape([H(0, 0), H(0, 1), H(0, 2)])).toBe(true);
    expect(isAllowedShape([H(0, 0), H(1, 0), H(1, 1)])).toBe(false);
    // size 4: only the diamond
    expect(isAllowedShape([H(0, 0), H(1, 0), H(0, 1), H(1, -1)])).toBe(true);
    expect(isAllowedShape([H(0, 0), H(1, 0), H(2, 0), H(3, 0)])).toBe(false);
    expect(isAllowedShape([H(0, 0), H(1, 0), H(2, 0), H(2, 1)])).toBe(false);
    expect(isAllowedShape([H(0, 0), H(1, 0), H(2, 0), H(1, 1)])).toBe(false);
    // size 5: a diamond and a hex that touches two of its hexes, not a sickle
    expect(isAllowedShape([H(0, 0), H(1, 0), H(0, 1), H(1, -1), H(2, -1)])).toBe(true);
    expect(isAllowedShape([H(0, 0), H(1, 0), H(0, 1), H(1, -1), H(2, -2)])).toBe(false);
    expect(isAllowedShape([H(0, 0), H(1, 0), H(2, 0), H(3, 0), H(4, 0)])).toBe(false);
    // sizes 6 and 7: the chunk of a hex and its six neighbours, with at most one of those missing
    const centre = H(0, 0);
    const ring = [0, 1, 2, 3, 4, 5].map((d) => neighbor(centre, d));
    expect(isAllowedShape([centre, ...ring])).toBe(true);
    expect(isAllowedShape([centre, ...ring.slice(1)])).toBe(true);
    expect(isAllowedShape(ring)).toBe(false);
    expect(isAllowedShape([centre, ring[0]!, ring[2]!, ring[3]!, ring[4]!, ring[5]!, H(3, 3)])).toBe(false);
  });

  it('makes only those shapes, of every size, at the start and when new asteroids come in', () => {
    const sizes = new Set<number>();
    for (let seed = 1; seed <= 6; seed++) {
      const rng = createRng(seed);
      const f = createField(map, [], { density: 'dense', motion: 'drift' }, rng);
      f.lost = 40;
      spawnLost(f, map, rng, []);
      for (const r of f.rocks) {
        expect(isAllowedShape(r.hexes)).toBe(true);
        sizes.add(r.hexes.length);
      }
    }
    expect([...sizes].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('leaves a shape of the next size down when a hex is lost: a diamond becomes a triangle', () => {
    const f = { density: 'medium', motion: 'drift', chaos: 4, rocks: [] as Rock[], nextId: 9, lost: 0 } as AsteroidField;
    for (let toward = 0; toward < 6; toward++) {
      const diamond: Rock = { id: 1, hexes: [H(10, 10), H(11, 10), H(10, 11), H(11, 9)], vel: H(0, 0), look: 1 };
      f.rocks = [diamond];
      reduceRock(f, diamond, neighbor(H(10, 10), toward), []);
      expect(diamond.hexes).toHaveLength(3);
      expect(touchingTriangle(diamond.hexes)).toBe(true);
    }
    // from the top of the scale down to nothing, every step is an allowed shape
    for (let seed = 1; seed <= 20; seed++) {
      const g = createField(map, [], { density: 'sparse', motion: 'drift' }, createRng(seed));
      const rng = createRng(seed);
      for (const r of g.rocks) {
        while (r.hexes.length > 1) {
          reduceRock(g, r, r.hexes[Math.floor(rng.next() * r.hexes.length)]!, []);
          expect(isAllowedShape(r.hexes)).toBe(true);
        }
      }
    }
  });

  it('keeps every asteroid an allowed shape through collisions that break pieces off', () => {
    const rng = createRng(77);
    const f = createField(map, [], { density: 'dense', motion: 'drift' }, rng);
    const log = { log: () => {}, entered: () => {} };
    for (let turn = 0; turn < 40; turn++) {
      driftTurn(f, map, rng, log, []);
      spawnLost(f, map, rng, []);
      for (const r of f.rocks) expect(isAllowedShape(r.hexes)).toBe(true);
    }
  });
});

function touchingTriangle(hexes: Hex[]): boolean {
  return hexes.length === 3 && hexes.every((a) => hexes.filter((b) => b !== a).every((b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r)) === 1));
}

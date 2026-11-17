import { DIRECTIONS, type Hex, type Rock } from '../engine';

/*
 * How an asteroid is drawn. The shape of an asteroid is the shape of the hexes it covers: its outline follows them (with rounded, slightly
 * ragged corners), so that every hex it covers is filled and the shape can be read at a glance. The inside is the picture of a model of
 * Fate of the Galaxy (public/assets/rocks, see CREDITS.md), blown up so that it fills the whole outline. What is drawn depends only on the
 * asteroid's own number (`look`) and its hexes, so that it looks the same wherever it drifts.
 */

export interface RockPart {
  /** Picture: model 1 to 9 (big, medium and small rocks in brown, blue and grey) and one of its six views. */
  model: number;
  view: number;
  /** Centre of the picture and its size (a square, turned by `angle` degrees and perhaps mirrored). */
  x: number;
  y: number;
  size: number;
  angle: number;
  flip: boolean;
}

export interface RockLook {
  /** The outline of the asteroid, as the data of an SVG path. */
  outline: string;
  parts: RockPart[];
  /** The colour under the pictures, for the family of the models used. */
  base: string;
  /** The centre of mass, in board pixels. */
  centre: { x: number; y: number };
}

export const rockUrl = (model: number, view: number): string => `${import.meta.env.BASE_URL}assets/rocks/rock-${model}-${view}.webp`;

/** The small seeded random source for a rock's looks. */
function seeded(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The colour of each family of models (brown, blue, grey), for what shows where a picture does not reach. */
const BASE = ['#76654f', '#6b6a86', '#6e6e6b'];

/** A hex's side, between its corners i and i+1, faces the neighbour in the direction (i + 2) mod 6 (corners at 0, 60, ... degrees, flat-top). */
const sideOf = (direction: number): number => (direction + 4) % 6;

type Pt = { x: number; y: number };

/**
 * The outline of a group of hexes: the sides that no other hex of the group shares, chained into loops, with the corners rounded and
 * moved about a little so that the rock does not look like a tile. Every hex is covered by at least four fifths of its area.
 */
export function rockOutline(hexes: Hex[], toPixel: (h: Hex) => Pt, R: number, seed: number): string {
  const rand = seeded(seed ^ 0x9e3779b9);
  const have = new Set(hexes.map((h) => `${h.q},${h.r}`));
  const corner = (c: Pt, i: number): Pt => ({ x: c.x + R * Math.cos((Math.PI / 3) * i), y: c.y + R * Math.sin((Math.PI / 3) * i) });
  const keyOf = (p: Pt): string => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  const edges = new Map<string, { from: Pt; to: Pt; used: boolean }[]>();
  for (const h of hexes) {
    const c = toPixel(h);
    DIRECTIONS.forEach((d, direction) => {
      if (have.has(`${h.q + d.q},${h.r + d.r}`)) return;
      const i = sideOf(direction);
      const from = corner(c, i);
      const to = corner(c, i + 1);
      const k = keyOf(from);
      edges.set(k, [...(edges.get(k) ?? []), { from, to, used: false }]);
    });
  }
  // one jitter for every corner, shared by the loops that meet there
  const jitter = new Map<string, Pt>();
  const moved = (p: Pt): Pt => {
    const k = keyOf(p);
    let j = jitter.get(k);
    if (!j) {
      const a = rand() * Math.PI * 2;
      const m = R * 0.17 * rand();
      j = { x: Math.cos(a) * m, y: Math.sin(a) * m };
      jitter.set(k, j);
    }
    return { x: p.x + j.x, y: p.y + j.y };
  };
  let d = '';
  for (const list of edges.values()) {
    for (const start of list) {
      if (start.used) continue;
      const loop: Pt[] = [];
      let edge: { from: Pt; to: Pt; used: boolean } | undefined = start;
      while (edge && !edge.used) {
        edge.used = true;
        loop.push(moved(edge.from));
        edge = edges.get(keyOf(edge.to))?.find((e) => !e.used);
      }
      if (loop.length < 3) continue;
      const t = 0.3;
      const mix = (a: Pt, b: Pt): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const prev = loop[(i + n - 1) % n]!;
        const cur = loop[i]!;
        const next = loop[(i + 1) % n]!;
        const a = mix(cur, prev);
        const b = mix(cur, next);
        d += `${i === 0 ? 'M' : 'L'}${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      }
      d += 'Z';
    }
  }
  return d;
}

/** Which of the nine models fits a size: big rocks for big asteroids, one colour family for the whole asteroid. */
const modelFor = (size: number, family: number): number => (size >= 5 ? 0 : size >= 3 ? 1 : 2) * 3 + family + 1;

/** What an asteroid looks like: its outline, the pictures inside it and its centre of mass. */
export function composeRock(rock: Rock, toPixel: (h: Hex) => Pt, R: number): RockLook {
  const rand = seeded(rock.look);
  const n = rock.hexes.length;
  const pts = rock.hexes.map(toPixel);
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  // the long axis of the shape
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  const theta = n === 1 ? 0 : 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    const u = (p.x - cx) * ux + (p.y - cy) * uy;
    const v = -(p.x - cx) * uy + (p.y - cy) * ux;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const pad = R * 0.9;
  const length = maxU - minU + 2 * pad;
  const width = maxV - minV + 2 * pad;
  const family = [0, 0, 0, 1, 1, 1, 2, 2, 0, 1][Math.floor(rand() * 10)]! % 3;
  // the picture is much larger than the outline, so that the outline cuts out the middle of it: one picture for a compact rock, two for a long one
  const count = length > width * 2.2 && n >= 5 ? 2 : 1;
  const parts: RockPart[] = [];
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? (minU + maxU) / 2 : minU + (maxU - minU) * (i === 0 ? 0.28 : 0.72);
    const along = count === 1 ? Math.max(length, width) : Math.max(length / 1.5, width);
    parts.push({
      model: modelFor(n, family),
      view: Math.floor(rand() * 6),
      x: cx + ux * u,
      y: cy + uy * u,
      size: along * 1.45,
      angle: rand() * 360,
      flip: rand() < 0.5,
    });
  }
  return { outline: rockOutline(rock.hexes, toPixel, R, rock.look), parts, base: BASE[family]!, centre: { x: cx, y: cy } };
}

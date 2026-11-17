import { DIRECTIONS, hexDistance, hexEquals, neighbor, type Hex } from './hex';
import { fromOffset, isOnMap, toOffset, type MapSpec } from './movement';
import type { Rng } from './rng';

/*
 * Asteroid fields (Rules: Asteroid fields): the field is made by the game, not placed by the players, and moves by
 * itself. Two kinds of motion can be chosen:
 *   - 'drift': every asteroid has a speed and direction of its own, changed only by collisions (which follow a simple momentum model);
 *   - 'events': each game-turn a few random drift events move all asteroids of one size by a die roll (Rules: Asteroid fields; the game rolls the dice).
 * An asteroid covers one or more hexes (its size is the number of hexes). Whatever is lost from the field (shot down, broken off in a
 * collision, drifted off the map) comes back as new asteroids of the same total size at the map edge.
 */

export type AsteroidDensity = 'sparse' | 'medium' | 'dense';
export type AsteroidMotion = 'drift' | 'events';
export type Chaos = 2 | 4 | 6;

/** The share of the map's hexes the field covers. */
export const DENSITY_SHARE: Record<AsteroidDensity, number> = { sparse: 0.05, medium: 0.1, dense: 0.15 };
export const DENSITY_NAMES: Record<AsteroidDensity, string> = { sparse: 'Sparse', medium: 'Medium', dense: 'Dense' };

export const MAX_ASTEROID_SIZE = 7;
/** The fastest an asteroid drifts: hexes per game-turn. */
export const MAX_SPEED = 3;
/** How hard asteroids bounce off each other (1 would be a perfect bounce, 0 a lump). */
const RESTITUTION = 0.6;

export interface Rock {
  id: number;
  /** The hexes it covers; its size is how many. */
  hexes: Hex[];
  /** Hexes it drifts each game-turn (drifting motion): any step on the hex grid, at most `MAX_SPEED` long. */
  vel: Hex;
  /** Chooses the pictures it is drawn with. */
  look: number;
}

export interface AsteroidField {
  density: AsteroidDensity;
  motion: AsteroidMotion;
  /** Events per game-turn with the dice-driven motion. */
  chaos: Chaos;
  rocks: Rock[];
  nextId: number;
  /** Size lost from the field and not yet replaced. */
  lost: number;
}

export interface AsteroidOptions {
  density: AsteroidDensity;
  motion: AsteroidMotion;
  chaos?: Chaos;
}

/** One moment of an asteroid movement, for playback: rocks that moved, rocks that are gone and rocks that came in. */
export interface RockFrame {
  moves?: { id: number; hexes: Hex[] }[];
  gone?: number[];
  born?: Rock[];
}

export const keyOf = (h: Hex): string => `${h.q},${h.r}`;
export const rockSize = (r: Rock): number => r.hexes.length;
export const rockName = (r: Rock): string => `asteroid ${r.id} (size ${r.hexes.length})`;
export const speedOf = (v: Hex): number => hexDistance({ q: 0, r: 0 }, v);

export function rockAt(field: AsteroidField, hex: Hex): Rock | undefined {
  return field.rocks.find((r) => r.hexes.some((h) => hexEquals(h, hex)));
}

export function coveredHexes(field: AsteroidField): Set<string> {
  const out = new Set<string>();
  for (const r of field.rocks) for (const h of r.hexes) out.add(keyOf(h));
  return out;
}

/** Total size of the field. */
export const fieldMass = (field: AsteroidField): number => field.rocks.reduce((sum, r) => sum + r.hexes.length, 0);

/** The hex of an asteroid nearest to a point (the range to an asteroid is counted to its nearest hex, see Rules: Asteroid fields). */
export function nearestHex(rock: Rock, from: Hex): Hex {
  return rock.hexes.reduce((best, h) => (hexDistance(from, h) < hexDistance(from, best) ? h : best));
}

// ---------------------------------------------------------------- geometry

const SQRT3 = Math.sqrt(3);

export function toXY(h: Hex): { x: number; y: number } {
  return { x: 1.5 * h.q, y: SQRT3 * (h.r + h.q / 2) };
}

function cubeRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

function fromXY(x: number, y: number): Hex {
  const q = x / 1.5;
  return cubeRound(q, y / SQRT3 - q / 2);
}

/** The middle of an asteroid, in plane coordinates. */
export function centreOf(rock: Rock): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const h of rock.hexes) {
    const p = toXY(h);
    x += p.x;
    y += p.y;
  }
  return { x: x / rock.hexes.length, y: y / rock.hexes.length };
}

/** The hexes an asteroid centre passes on a drift of `vel`, one at a time: the displacement after each step. */
export function stepsOf(vel: Hex): Hex[] {
  const n = speedOf(vel);
  const out: Hex[] = [];
  for (let i = 1; i <= n; i++) out.push(cubeRound((vel.q * i) / n + 1e-6, (vel.r * i) / n + 2e-6));
  return out;
}

const shift = (hexes: Hex[], d: Hex): Hex[] => hexes.map((h) => ({ q: h.q + d.q, r: h.r + d.r }));
const sub = (a: Hex, b: Hex): Hex => ({ q: a.q - b.q, r: a.r - b.r });

/** A velocity in plane coordinates, as a step on the hex grid no longer than the speed limit. */
function latticeVelocity(x: number, y: number): Hex {
  let v = fromXY(x, y);
  for (let guard = 0; guard < 30 && speedOf(v) > MAX_SPEED; guard++) {
    x *= 0.9;
    y *= 0.9;
    v = fromXY(x, y);
  }
  return v;
}

function connected(hexes: Hex[]): boolean {
  if (hexes.length <= 1) return true;
  const keys = new Set(hexes.map(keyOf));
  const seen = new Set<string>([keyOf(hexes[0]!)]);
  const stack = [hexes[0]!];
  while (stack.length > 0) {
    const h = stack.pop()!;
    for (let d = 0; d < 6; d++) {
      const n = neighbor(h, d);
      const k = keyOf(n);
      if (keys.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push(n);
      }
    }
  }
  return seen.size === hexes.length;
}

// ---------------------------------------------------------------- making a field

/** How often each size is wanted, by number of asteroids (size 1 to 7). */
const SIZE_WEIGHTS = [0, 40, 25, 15, 9, 6, 3, 2];

function pickSize(rng: Rng, max: number): number {
  const top = Math.min(MAX_ASTEROID_SIZE, max);
  let total = 0;
  for (let s = 1; s <= top; s++) total += SIZE_WEIGHTS[s]!;
  let x = rng.next() * total;
  for (let s = 1; s <= top; s++) {
    x -= SIZE_WEIGHTS[s]!;
    if (x < 0) return s;
  }
  return 1;
}

// ---------------------------------------------------------------- the shapes of asteroids

/*
 * Asteroids are compact lumps, never long or bent (the owner's wish): a domino for size 2; a triangle or a straight line of three; a
 * "diamond" (two triangles side by side) for size 4; a diamond with a fifth hex that touches two of its hexes; a full size-7 chunk (a hex and
 * its six neighbours) with one outer hex missing for size 6; and the size-7 chunk itself. When an asteroid loses a hex it becomes one of
 * the shapes of the next size down (a diamond can only become a triangle).
 */

const rotate60 = (h: Hex): Hex => ({ q: -h.r, r: h.q + h.r });
const mirrorHex = (h: Hex): Hex => ({ q: h.r, r: h.q });

/** The same shape moved so that its first hex (in order of q, then r) is at the origin: equal shapes have equal keys. */
function normalised(shape: Hex[]): Hex[] {
  const sorted = [...shape].sort((x, y) => x.q - y.q || x.r - y.r);
  const o = sorted[0]!;
  return sorted.map((h) => ({ q: h.q - o.q, r: h.r - o.r }));
}

/** Every turn and mirror image of a shape, once each. */
function orientations(base: Hex[]): Hex[][] {
  const seen = new Map<string, Hex[]>();
  for (const flip of [false, true]) {
    let cur = flip ? base.map(mirrorHex) : base;
    for (let i = 0; i < 6; i++) {
      const n = normalised(cur);
      seen.set(n.map(keyOf).join(';'), n);
      cur = cur.map(rotate60);
    }
  }
  return [...seen.values()];
}

/** How many pairs of hexes of a shape touch. */
function touchingPairs(shape: Hex[]): number {
  let n = 0;
  for (let i = 0; i < shape.length; i++) for (let j = i + 1; j < shape.length; j++) if (hexDistance(shape[i]!, shape[j]!) === 1) n += 1;
  return n;
}

const isDiamond = (shape: Hex[]): boolean => shape.length === 4 && touchingPairs(shape) === 5;

/** Is this one of the shapes an asteroid of its size may have? */
export function isAllowedShape(shape: Hex[]): boolean {
  const n = shape.length;
  if (n === 1) return true;
  if (n === 2) return hexDistance(shape[0]!, shape[1]!) === 1;
  if (n === 3) {
    const pairs = touchingPairs(shape);
    if (pairs === 3) return true; // a triangle
    if (pairs !== 2) return false;
    // a line: the two ends are two hexes apart in a straight line, not round a bend
    const ends = shape.filter((h) => shape.filter((o) => hexDistance(o, h) === 1).length === 1);
    if (ends.length !== 2) return false;
    const dq = ends[1]!.q - ends[0]!.q;
    const dr = ends[1]!.r - ends[0]!.r;
    return DIRECTIONS.some((d) => d.q * 2 === dq && d.r * 2 === dr);
  }
  if (n === 4) return isDiamond(shape);
  if (n === 5) {
    // a diamond, and a fifth hex that touches at least two of its hexes
    return shape.some((h) => {
      const rest = shape.filter((x) => x !== h);
      return isDiamond(rest) && rest.filter((x) => hexDistance(x, h) === 1).length >= 2;
    });
  }
  // size 6 or 7: one hex touches all the others (the chunk's middle)
  if (n === 6 || n === 7) return shape.some((c) => shape.filter((x) => x !== c && hexDistance(x, c) === 1).length === n - 1);
  return false;
}

/** For each size, the kinds of shape it may have, each with every turn and mirror image. */
const SHAPES: Hex[][][][] = (() => {
  const flower = [{ q: 0, r: 0 }, ...DIRECTIONS];
  const diamond = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: -1 }];
  // a fifth hex next to the diamond that touches two of its hexes
  const fifths = new Map<string, Hex[]>();
  for (const h of diamond) {
    for (let d = 0; d < 6; d++) {
      const n = neighbor(h, d);
      if (diamond.some((x) => hexEquals(x, n))) continue;
      const shape = [...diamond, n];
      if (isAllowedShape(shape)) fifths.set(normalised(shape).map(keyOf).join(';'), shape);
    }
  }
  return [
    [],
    [orientations([{ q: 0, r: 0 }])],
    [orientations([{ q: 0, r: 0 }, { q: 1, r: 0 }])],
    [orientations([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]), orientations([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }])],
    [orientations(diamond)],
    // the fifth hex: every arrangement is its own kind, so that each is as likely as any other
    [...fifths.values()].map((shape) => orientations(shape)),
    [orientations(flower.slice(0, 6))],
    [orientations(flower)],
  ];
})();

/** An allowed shape of `size` hexes, turned at random, with one of its hexes on `start`; null when it does not fit where `ok` says. */
function placeShape(rng: Rng, size: number, start: Hex, ok: (h: Hex) => boolean): Hex[] | null {
  const kinds = SHAPES[size]!;
  for (let attempt = 0; attempt < 8; attempt++) {
    const variants = kinds[Math.floor(rng.next() * kinds.length)]!;
    const variant = variants[Math.floor(rng.next() * variants.length)]!;
    const anchor = variant[Math.floor(rng.next() * variant.length)]!;
    const shape = variant.map((h) => ({ q: h.q - anchor.q + start.q, r: h.r - anchor.r + start.r }));
    if (shape.every(ok)) return shape;
  }
  return null;
}

/** Does a shape enclose an empty hex? (A ring of hexes would read as a gap in the rock.) */
export function hasHole(shape: Hex[]): boolean {
  if (shape.length < 6) return false;
  const inShape = new Set(shape.map(keyOf));
  const qs = shape.map((h) => h.q);
  const rs = shape.map((h) => h.r);
  const [q0, q1, r0, r1] = [Math.min(...qs) - 1, Math.max(...qs) + 1, Math.min(...rs) - 1, Math.max(...rs) + 1];
  const seen = new Set<string>([keyOf({ q: q0, r: r0 })]);
  const stack: Hex[] = [{ q: q0, r: r0 }];
  while (stack.length > 0) {
    const h = stack.pop()!;
    for (let d = 0; d < 6; d++) {
      const n = neighbor(h, d);
      const k = keyOf(n);
      if (n.q < q0 || n.q > q1 || n.r < r0 || n.r > r1 || inShape.has(k) || seen.has(k)) continue;
      seen.add(k);
      stack.push(n);
    }
  }
  for (let q = q0; q <= q1; q++) for (let r = r0; r <= r1; r++) if (!inShape.has(keyOf({ q, r })) && !seen.has(keyOf({ q, r }))) return true;
  return false;
}

/** The hexes next to a rock's, which a new rock should keep clear of so that the two read as two. */
function addHalo(halo: Set<string>, shape: Hex[]): void {
  for (const h of shape) for (let d = 0; d < 6; d++) halo.add(keyOf(neighbor(h, d)));
}

const velocityOf = (dir: number, speed: number): Hex => ({ q: DIRECTIONS[dir]!.q * speed, r: DIRECTIONS[dir]!.r * speed });

const BLOCK = 8;

/**
 * The field at the start of a game. The map is cut into blocks and each gets its own share of the asteroids, so the field is clumpy; the
 * blocks that hold part of a set-up area get the average share, so that those areas are as crowded as the rest of the map.
 */
export function createField(map: MapSpec, zones: Hex[][], options: AsteroidOptions, rng: Rng): AsteroidField {
  const field: AsteroidField = { density: options.density, motion: options.motion, chaos: options.chaos ?? 4, rocks: [], nextId: 1, lost: 0 };
  const target = Math.round(map.cols * map.rows * DENSITY_SHARE[options.density]);
  const zoneKeys = new Set(zones.flat().map(keyOf));
  const taken = new Set<string>();
  // asteroids are placed so that no two touch where there is room, so that each reads as one rock
  const halo = new Set<string>();
  const margin = 2;
  const inside = (h: Hex): boolean => {
    const { col, row } = toOffset(h);
    return col >= margin && col < map.cols - margin && row >= margin && row < map.rows - margin;
  };

  interface Block { cells: Hex[]; zone: boolean; weight: number }
  const blocks: Block[] = [];
  for (let c0 = 0; c0 < map.cols; c0 += BLOCK) {
    for (let r0 = 0; r0 < map.rows; r0 += BLOCK) {
      const cells: Hex[] = [];
      for (let col = c0; col < Math.min(map.cols, c0 + BLOCK); col++) {
        for (let row = r0; row < Math.min(map.rows, r0 + BLOCK); row++) {
          const h = fromOffset(col, row);
          if (inside(h)) cells.push(h);
        }
      }
      if (cells.length === 0) continue;
      const zone = cells.some((h) => zoneKeys.has(keyOf(h)));
      // clumps: some blocks are thin, some thick; the blocks of the set-up areas stay at the average
      const u = rng.next();
      blocks.push({ cells, zone, weight: zone ? 1 : 0.25 + 1.6 * u * u });
    }
  }
  const total = blocks.reduce((sum, b) => sum + b.cells.length * b.weight, 0);
  for (const block of blocks) {
    const exact = (target * block.cells.length * block.weight) / total;
    const mass = Math.floor(exact) + (rng.next() < exact - Math.floor(exact) ? 1 : 0);
    const centre = block.cells[Math.floor(rng.next() * block.cells.length)]!;
    let placed = 0;
    for (let attempt = 0; attempt < 90 && placed < mass; attempt++) {
      const size = pickSize(rng, mass - placed);
      // most asteroids lie near a clump centre in their block, the others anywhere in it
      const near = block.cells.filter((h) => hexDistance(h, centre) <= 3);
      const pool = rng.next() < 0.6 && near.length > 0 ? near : block.cells;
      const start = pool[Math.floor(rng.next() * pool.length)]!;
      const roomy = attempt < 55;
      const shape = placeShape(rng, size, start, (h) => inside(h) && !taken.has(keyOf(h)) && !(roomy && halo.has(keyOf(h))));
      if (!shape) continue;
      for (const h of shape) taken.add(keyOf(h));
      addHalo(halo, shape);
      field.rocks.push({ id: field.nextId++, hexes: shape, vel: initialVelocity(options.motion, rng), look: Math.floor(rng.next() * 1e6) });
      placed += size;
    }
  }
  return field;
}

/** A direction (1d6) and a speed (1d4-1) for each asteroid at the start; stationary asteroids are possible. Dice-driven fields have no velocities. */
function initialVelocity(motion: AsteroidMotion, rng: Rng): Hex {
  if (motion !== 'drift') return { q: 0, r: 0 };
  const dir = Math.floor(rng.next() * 6);
  const speed = Math.floor(rng.next() * 4);
  return velocityOf(dir, speed);
}

/**
 * New asteroids for the size that has been lost, at random places on the map edge, drifting inward. The shapes and sizes are made the way
 * the field's are. Whatever cannot be placed now stays owed.
 */
export function spawnLost(field: AsteroidField, map: MapSpec, rng: Rng, blocked: Hex[] = []): Rock[] {
  const born: Rock[] = [];
  const taken = coveredHexes(field);
  for (const h of blocked) taken.add(keyOf(h));
  const halo = new Set<string>();
  for (const r of field.rocks) addHalo(halo, r.hexes);
  const sides: { start: () => Hex; inward: number[] }[] = [
    { start: () => fromOffset(0, Math.floor(rng.next() * map.rows)), inward: [1, 2] },
    { start: () => fromOffset(map.cols - 1, Math.floor(rng.next() * map.rows)), inward: [4, 5] },
    { start: () => fromOffset(Math.floor(rng.next() * map.cols), 0), inward: [2, 3, 4] },
    { start: () => fromOffset(Math.floor(rng.next() * map.cols), map.rows - 1), inward: [5, 0, 1] },
  ];
  const weights = [map.rows, map.rows, map.cols, map.cols];
  let giveUp = 0;
  while (field.lost > 0 && giveUp < 40) {
    const size = pickSize(rng, field.lost);
    let x = rng.next() * weights.reduce((a, b) => a + b, 0);
    let side = sides[0]!;
    for (let i = 0; i < sides.length; i++) {
      x -= weights[i]!;
      if (x < 0) {
        side = sides[i]!;
        break;
      }
    }
    const roomy = giveUp < 20;
    const shape = placeShape(rng, size, side.start(), (h) => isOnMap(map, h) && !taken.has(keyOf(h)) && !(roomy && halo.has(keyOf(h))));
    if (!shape) {
      giveUp += 1;
      continue;
    }
    const dir = side.inward[Math.floor(rng.next() * side.inward.length)]!;
    const vel = field.motion === 'drift' ? velocityOf(dir, 1 + Math.floor(rng.next() * MAX_SPEED)) : { q: 0, r: 0 };
    const rock: Rock = { id: field.nextId++, hexes: shape, vel, look: Math.floor(rng.next() * 1e6) };
    for (const h of shape) taken.add(keyOf(h));
    addHalo(halo, shape);
    field.rocks.push(rock);
    born.push(rock);
    field.lost -= size;
  }
  return born;
}

// ---------------------------------------------------------------- losing mass

function dropRock(field: AsteroidField, rock: Rock, frames: RockFrame[]): void {
  field.rocks = field.rocks.filter((r) => r.id !== rock.id);
  field.lost += rock.hexes.length;
  frames.push({ gone: [rock.id] });
}

/**
 * Takes one hex off an asteroid, the one nearest `towards` that leaves the rest in one piece (it is the broken-off corner); a size-one
 * asteroid is gone. The size lost is owed to the field. Returns false if the asteroid is gone.
 */
export function reduceRock(field: AsteroidField, rock: Rock, towards: Hex | null, frames: RockFrame[] = []): boolean {
  if (rock.hexes.length <= 1) {
    dropRock(field, rock, frames);
    return false;
  }
  const order = [...rock.hexes].sort((a, b) => (towards ? hexDistance(a, towards) - hexDistance(b, towards) : 0));
  // the shape that is left is one of the shapes of the next size down (a diamond can only become a triangle); for an odd shape, any piece that holds together
  const cut = order.find((h) => isAllowedShape(rock.hexes.filter((x) => x !== h))) ?? order.find((h) => connected(rock.hexes.filter((x) => x !== h))) ?? order[0]!;
  rock.hexes = rock.hexes.filter((x) => x !== cut);
  field.lost += 1;
  frames.push({ moves: [{ id: rock.id, hexes: rock.hexes.map((h) => ({ ...h })) }] });
  return true;
}

// ---------------------------------------------------------------- motion

export interface MotionHooks {
  /** A line for the log. */
  log(text: string, detail?: boolean): void;
  /** An asteroid has moved a step and now covers `entered` hexes it did not cover before, coming from the side `delta` points away from. */
  entered(rock: Rock, entered: Hex[], delta: Hex): void;
  /** Is the game over (a ship destroyed by an asteroid may end it)? Movement stops. */
  stop?(): boolean;
}

const enteredHexes = (before: Hex[], after: Hex[]): Hex[] => {
  const had = new Set(before.map(keyOf));
  return after.filter((h) => !had.has(keyOf(h)));
};

/** Which of the field's rocks (other than `except`) cover any of these hexes? */
function blockers(field: AsteroidField, hexes: Hex[], except: number): Rock[] {
  const keys = new Set(hexes.map(keyOf));
  return field.rocks.filter((r) => r.id !== except && r.hexes.some((h) => keys.has(keyOf(h))));
}

/**
 * The dice-driven motion: `chaos` events, each moving every asteroid of one randomly chosen size by one die roll in one random direction
 * (Rules: Asteroid fields), one asteroid at a time in random order. Collisions work as in Rules: Asteroid fields: the mover rebounds by the size of the asteroid it hit, which
 * moves on in the mover's direction by the same roll; on a six the smaller one is removed instead.
 */
export function moveEvents(field: AsteroidField, map: MapSpec, rng: Rng, hooks: MotionHooks, frames: RockFrame[]): void {
  let budget = 400;
  const dir6 = (): number => Math.floor(rng.next() * 6);
  const die = (): number => 1 + Math.floor(rng.next() * 6);

  const advance = (rock: Rock, dir: number, distance: number, roll: number, depth: number): void => {
    const d = DIRECTIONS[dir]!;
    for (let i = 0; i < distance; i++) {
      if (budget-- <= 0 || hooks.stop?.() || !field.rocks.includes(rock)) return;
      const next = shift(rock.hexes, d);
      // an asteroid cannot move off the edge of the map: it stops in the edge hex (Rules: Asteroid fields)
      if (next.some((h) => !isOnMap(map, h))) return;
      const hit = blockers(field, next, rock.id)[0];
      if (hit) {
        collide(rock, hit, dir, distance - i, roll, depth);
        return;
      }
      const before = rock.hexes;
      rock.hexes = next;
      frames.push({ moves: [{ id: rock.id, hexes: next.map((h) => ({ ...h })) }] });
      hooks.entered(rock, enteredHexes(before, next), d);
    }
  };

  const collide = (rock: Rock, hit: Rock, dir: number, remaining: number, roll: number, depth: number): void => {
    if (depth > 10) return;
    hooks.log(`${cap(rockName(rock))} runs into ${rockName(hit)}.`, true);
    if (roll === 6) {
      // a six: the smaller one is removed, the larger carries on; two of a size are both removed (Rules: Asteroid fields)
      const a = rockSize(rock);
      const b = rockSize(hit);
      if (a === b) {
        hooks.log(`Both are destroyed.`, true);
        dropRock(field, rock, frames);
        dropRock(field, hit, frames);
      } else if (a < b) {
        hooks.log(`${cap(rockName(rock))} is destroyed.`, true);
        dropRock(field, rock, frames);
      } else {
        hooks.log(`${cap(rockName(hit))} is destroyed; ${rockName(rock)} flies on.`, true);
        dropRock(field, hit, frames);
        advance(rock, dir, remaining, roll, depth + 1);
      }
      return;
    }
    // the mover retraces its path by the size of what it struck, and the other one moves on by the roll (Rules: Asteroid fields)
    advance(rock, (dir + 3) % 6, rockSize(hit), roll, depth + 1);
    advance(hit, dir, roll, roll, depth + 1);
  };

  for (let event = 1; event <= field.chaos; event++) {
    if (hooks.stop?.()) return;
    const sizes = [...new Set(field.rocks.map(rockSize))].sort((a, b) => a - b);
    if (sizes.length === 0) return;
    const size = sizes[Math.floor(rng.next() * sizes.length)]!;
    const dir = dir6();
    const roll = die();
    const movers = field.rocks.filter((r) => rockSize(r) === size).map((r) => r.id);
    // the order is random
    for (let i = movers.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [movers[i], movers[j]] = [movers[j]!, movers[i]!];
    }
    hooks.log(`Drift ${event} of ${field.chaos}: the asteroids of size ${size} move ${roll} hex${roll === 1 ? '' : 'es'} ${DIRECTION_WORDS[dir]}.`);
    for (const id of movers) {
      const rock = field.rocks.find((r) => r.id === id);
      if (rock) advance(rock, dir, roll, roll, 0);
    }
  }
}

const DIRECTION_WORDS = ['up', 'up and to the right', 'down and to the right', 'down', 'down and to the left', 'up and to the left'];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The drifting motion: asteroids move together in up to three sub-steps. Two asteroids that would overlap stay where they were and bounce
 * off each other by a momentum model (size is mass, the bounce is along the line between their centres); a die roll of six on the impact
 * breaks a hex off the smaller one first.
 */
export function driftTurn(field: AsteroidField, map: MapSpec, rng: Rng, hooks: MotionHooks, frames: RockFrame[]): void {
  const paths = new Map<number, Hex[]>();
  for (const r of field.rocks) paths.set(r.id, stepsOf(r.vel));
  const stopped = new Set<number>();
  const die = (): number => 1 + Math.floor(rng.next() * 6);

  for (let step = 1; step <= MAX_SPEED; step++) {
    if (hooks.stop?.()) return;
    // every asteroid that still has a step to take moves one hex
    const moved = new Map<number, { before: Hex[]; delta: Hex }>();
    for (const r of field.rocks) {
      const path = paths.get(r.id)!;
      if (stopped.has(r.id) || step > path.length) continue;
      const delta = sub(path[step - 1]!, step > 1 ? path[step - 2]! : { q: 0, r: 0 });
      moved.set(r.id, { before: r.hexes, delta });
      r.hexes = shift(r.hexes, delta);
    }
    if (moved.size === 0) continue;

    // overlaps: the movers go back, the pair bounces
    for (let pass = 0; pass < 8; pass++) {
      const seen = new Map<string, number>();
      const pairs = new Map<string, [Rock, Rock]>();
      for (const r of field.rocks) {
        for (const h of r.hexes) {
          const k = keyOf(h);
          const other = seen.get(k);
          if (other === undefined) seen.set(k, r.id);
          else if (other !== r.id) {
            const a = field.rocks.find((x) => x.id === other)!;
            pairs.set(`${Math.min(a.id, r.id)}-${Math.max(a.id, r.id)}`, a.id < r.id ? [a, r] : [r, a]);
          }
        }
      }
      if (pairs.size === 0) break;
      for (const [a, b] of pairs.values()) {
        if (!field.rocks.includes(a) || !field.rocks.includes(b)) continue;
        for (const r of [a, b]) {
          const m = moved.get(r.id);
          if (m) {
            r.hexes = m.before;
            moved.delete(r.id);
          }
        }
        bounce(a, b);
      }
    }

    // asteroids that have left the map altogether are gone
    for (const r of [...field.rocks]) {
      if (r.hexes.every((h) => !isOnMap(map, h))) {
        moved.delete(r.id);
        hooks.log(`${cap(rockName(r))} drifts off the map.`, true);
        dropRock(field, r, frames);
      }
    }

    const frame: RockFrame = { moves: [...moved.keys()].map((id) => ({ id, hexes: field.rocks.find((r) => r.id === id)!.hexes.map((h) => ({ ...h })) })) };
    if (frame.moves!.length > 0) frames.push(frame);
    for (const [id, m] of moved) {
      const rock = field.rocks.find((r) => r.id === id);
      if (!rock) continue;
      const entered = enteredHexes(m.before, rock.hexes);
      if (entered.length > 0) hooks.entered(rock, entered, m.delta);
      if (hooks.stop?.()) return;
    }
  }

  function bounce(a: Rock, b: Rock): void {
    hooks.log(`${cap(rockName(a))} and ${rockName(b)} collide.`, true);
    stopped.add(a.id);
    stopped.add(b.id);
    const roll = die();
    if (roll === 6) {
      const small = rockSize(a) < rockSize(b) ? a : rockSize(b) < rockSize(a) ? b : rng.next() < 0.5 ? a : b;
      const big = small === a ? b : a;
      hooks.log(`A rolled six breaks a piece off ${rockName(small)}.`, true);
      const kept = reduceRock(field, small, nearestHex(big, centreHex(small)), frames);
      if (!kept) return;
    }
    const ca = centreOf(a);
    const cb = centreOf(b);
    let nx = cb.x - ca.x;
    let ny = cb.y - ca.y;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) {
      const angle = rng.next() * Math.PI * 2;
      nx = Math.cos(angle);
      ny = Math.sin(angle);
    } else {
      nx /= len;
      ny /= len;
    }
    const va = toXY(a.vel);
    const vb = toXY(b.vel);
    const closing = (va.x - vb.x) * nx + (va.y - vb.y) * ny;
    if (closing <= 0) return;
    const ma = rockSize(a);
    const mb = rockSize(b);
    const j = ((1 + RESTITUTION) * closing) / (1 / ma + 1 / mb);
    a.vel = latticeVelocity(va.x - (j / ma) * nx, va.y - (j / ma) * ny);
    b.vel = latticeVelocity(vb.x + (j / mb) * nx, vb.y + (j / mb) * ny);
  }
}

/** The hex of an asteroid nearest to its own middle. */
function centreHex(rock: Rock): Hex {
  const c = centreOf(rock);
  return fromXY(c.x, c.y);
}

import { describe, expect, it } from 'vitest';
import { playRandomGame } from '../src/ai/random';
import { playGame } from '../src/ai/player';
import { tacticalAi, TUNING } from '../src/ai/tactical';
import {
  STANDARD_MAP,
  applyCommand,
  coveredHexes,
  createField,
  createGame,
  createRng,
  dogfightOptions,
  driftTurn,
  emptyPlan,
  fieldMass,
  fromOffset,
  hexEquals,
  keyOf,
  moveEvents,
  previewRockShot,
  rockTargetId,
  rocksForCrew,
  SPECIAL,
  reduceRock,
  rockAt,
  scriptedRng,
  shipById,
  speedOf,
  spawnLost,
  toOffset,
  type AsteroidDensity,
  type AsteroidField,
  type AsteroidMotion,
  type Command,
  type GameState,
  type MapSpec,
  type Rock,
  type RockFrame,
} from '../src/engine';

const map: MapSpec = { ...STANDARD_MAP, mode: 'static' };
const hooks = (log: string[] = []) => ({ log: (t: string) => void log.push(t), entered: () => {} });

const rock = (id: number, hexes: [number, number][], vel = { q: 0, r: 0 }): Rock => ({ id, hexes: hexes.map(([c, r]) => fromOffset(c, r)), vel, look: 0 });
const field = (rocks: Rock[], motion: AsteroidMotion = 'events'): AsteroidField => ({ density: 'medium', motion, chaos: 1 as never, rocks, nextId: 100, lost: 0 });
const cells = (r: Rock): [number, number][] => r.hexes.map((h) => [toOffset(h).col, toOffset(h).row]);

describe('making a field', () => {
  it.each(['sparse', 'medium', 'dense'] as AsteroidDensity[])('covers about its share of the map without overlaps (%s)', (density) => {
    const share = { sparse: 0.05, medium: 0.1, dense: 0.15 }[density];
    for (let seed = 1; seed <= 5; seed++) {
      const f = createField(map, [], { density, motion: 'drift' }, createRng(seed));
      const mass = fieldMass(f);
      expect(mass).toBeGreaterThan(map.cols * map.rows * share * 0.85);
      expect(mass).toBeLessThan(map.cols * map.rows * share * 1.1);
      const seen = new Set<string>();
      for (const r of f.rocks) {
        expect(r.hexes.length).toBeLessThanOrEqual(7);
        for (const h of r.hexes) {
          expect(seen.has(keyOf(h))).toBe(false);
          seen.add(keyOf(h));
          const { col, row } = toOffset(h);
          expect(col >= 2 && col < map.cols - 2 && row >= 2 && row < map.rows - 2).toBe(true);
        }
        expect(speedOf(r.vel)).toBeLessThanOrEqual(3);
      }
    }
  });

  it('starts some drifting asteroids standing still, and none with the dice-driven motion', () => {
    const drifting = createField(map, [], { density: 'dense', motion: 'drift' }, createRng(3));
    expect(drifting.rocks.some((r) => speedOf(r.vel) === 0)).toBe(true);
    expect(drifting.rocks.some((r) => speedOf(r.vel) === 3)).toBe(true);
    const dice = createField(map, [], { density: 'dense', motion: 'events' }, createRng(3));
    expect(dice.rocks.every((r) => speedOf(r.vel) === 0)).toBe(true);
  });

  it('is the same field for the same seed', () => {
    const a = createField(map, [], { density: 'medium', motion: 'drift' }, createRng(9));
    const b = createField(map, [], { density: 'medium', motion: 'drift' }, createRng(9));
    expect(a).toEqual(b);
  });

  it('keeps the set-up areas as crowded as the rest of the map', () => {
    const g = createGame({ seed: 4, asteroids: { density: 'medium', motion: 'drift' }, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    const covered = coveredHexes(g.asteroids!);
    const share = (hexes: { q: number; r: number }[]): number => hexes.filter((h) => covered.has(keyOf(h))).length / hexes.length;
    for (const zone of g.zones) expect(share(zone)).toBeGreaterThan(0.05);
    expect(g.map.mode).toBe('static');
  });

  it('does not let a ship start in an asteroid hex', () => {
    const g = createGame({ seed: 4, asteroids: { density: 'dense', motion: 'drift' }, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    const covered = coveredHexes(g.asteroids!);
    const taken = g.zones[0].find((h) => covered.has(keyOf(h)))!;
    const free = g.zones[0].find((h) => !covered.has(keyOf(h)))!;
    expect(taken).toBeDefined();
    expect(applyCommand(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: taken, facing: 0 }] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: free, facing: 0 }] }).ok).toBe(true);
  });
});

describe('losing and replacing size', () => {
  it('takes a hex off, leaves the rest in one piece, and removes a size-one asteroid', () => {
    const f = field([rock(1, [[10, 10], [10, 11], [10, 12]]), rock(2, [[20, 20]])]);
    const frames: RockFrame[] = [];
    expect(reduceRock(f, f.rocks[0]!, fromOffset(10, 9), frames)).toBe(true);
    expect(cells(f.rocks[0]!)).toEqual([[10, 11], [10, 12]]);
    expect(f.lost).toBe(1);
    expect(reduceRock(f, f.rocks[1]!, null, frames)).toBe(false);
    expect(f.rocks.map((r) => r.id)).toEqual([1]);
    expect(f.lost).toBe(2);
  });

  it('brings the same size back at the edge, drifting inward', () => {
    const f = field([rock(1, [[15, 20]])], 'drift');
    f.lost = 12;
    const born = spawnLost(f, map, createRng(5), []);
    expect(born.reduce((s, r) => s + r.hexes.length, 0)).toBe(12);
    expect(f.lost).toBe(0);
    for (const r of born) {
      expect(speedOf(r.vel)).toBeGreaterThanOrEqual(1);
      const onEdge = r.hexes.some((h) => {
        const { col, row } = toOffset(h);
        return col === 0 || row === 0 || col === map.cols - 1 || row === map.rows - 1;
      });
      expect(onEdge).toBe(true);
    }
  });

  it('does not bring them back on a ship', () => {
    const f = field([], 'drift');
    f.lost = 40;
    const ships = Array.from({ length: 45 }, (_, row) => fromOffset(0, row));
    const born = spawnLost(f, map, createRng(5), ships);
    for (const r of born) for (const h of r.hexes) expect(ships.some((s) => hexEquals(s, h))).toBe(false);
  });
});

describe('dice-driven motion', () => {
  it('moves the asteroids of the chosen size, and an asteroid stops at the edge of the map', () => {
    // sizes present: 1 only, so the first number picks the only size; direction 5 is up and to the left
    const f = field([rock(1, [[0, 10]])]);
    moveEvents(f, map, scriptedRng([1, 6, 3]), hooks(), []);
    expect(cells(f.rocks[0]!)).toEqual([[0, 10]]);
    const g = field([rock(1, [[10, 20]])]);
    moveEvents(g, map, scriptedRng([1, 1, 3]), hooks(), []);
    expect(cells(g.rocks[0]!)).toEqual([[10, 17]]);
  });

  it('makes the mover rebound by the size of what it hit, and the other one move on by the roll', () => {
    const f = field([rock(1, [[10, 20]]), rock(2, [[10, 18], [10, 17]])]);
    // size one (the smaller of the two present), straight up, a four
    moveEvents(f, map, scriptedRng([1, 1, 4]), hooks(), []);
    expect(cells(f.rocks.find((r) => r.id === 1)!)).toEqual([[10, 21]]);
    expect(cells(f.rocks.find((r) => r.id === 2)!)).toEqual([[10, 14], [10, 13]]);
  });

  it('removes the smaller asteroid on a six, and lets the larger one carry on', () => {
    const f = field([rock(1, [[10, 20]]), rock(2, [[10, 18], [10, 17]])]);
    moveEvents(f, map, scriptedRng([1, 1, 6]), hooks(), []);
    expect(f.rocks.map((r) => r.id)).toEqual([2]);
    expect(f.lost).toBe(1);
    const g = field([rock(1, [[10, 20]]), rock(2, [[10, 25], [10, 26]])]);
    // size two moves up, six: it hits the one-hex asteroid, which is removed, and flies on
    moveEvents(g, map, scriptedRng([4, 1, 6]), hooks(), []);
    expect(g.rocks.map((r) => r.id)).toEqual([2]);
    expect(g.lost).toBe(1);
  });
});

describe('drifting motion', () => {
  it('bounces two asteroids that meet head on, without ever overlapping them', () => {
    const f = field([rock(1, [[10, 20]], { q: 0, r: -1 }), rock(2, [[10, 18]], { q: 0, r: 1 })], 'drift');
    driftTurn(f, map, createRng(1), hooks(), []);
    expect(cells(f.rocks[0]!)).toEqual([[10, 20]]);
    expect(cells(f.rocks[1]!)).toEqual([[10, 18]]);
    // the equal masses send each other back the way they came
    expect(f.rocks[0]!.vel).toEqual({ q: 0, r: 1 });
    expect(f.rocks[1]!.vel).toEqual({ q: 0, r: -1 });
  });

  it('gives a heavy asteroid hardly any speed when a light one hits it', () => {
    const heavy = rock(2, [[10, 18], [10, 17], [11, 17], [9, 17], [11, 18], [9, 18], [10, 16]]);
    const f = field([rock(1, [[10, 20]], { q: 0, r: -2 }), heavy], 'drift');
    driftTurn(f, map, createRng(1), hooks(), []);
    expect(f.rocks[0]!.vel.r).toBeGreaterThan(0);
    expect(speedOf(f.rocks[1]!.vel)).toBeLessThanOrEqual(1);
  });

  it('keeps the size of the field whole: what leaves or breaks is owed and comes back', () => {
    const rng = createRng(21);
    const f = createField(map, [], { density: 'dense', motion: 'drift' }, rng);
    const total = fieldMass(f);
    for (let turn = 0; turn < 40; turn++) {
      driftTurn(f, map, rng, hooks(), []);
      expect(fieldMass(f) + f.lost).toBe(total);
      spawnLost(f, map, rng, []);
      const seen = new Set<string>();
      for (const r of f.rocks) {
        for (const h of r.hexes) {
          expect(seen.has(keyOf(h))).toBe(false);
          seen.add(keyOf(h));
        }
        expect(speedOf(r.vel)).toBeLessThanOrEqual(3);
      }
    }
    // it stays a lively field: not frozen, not racing
    const mean = f.rocks.reduce((s, r) => s + speedOf(r.vel), 0) / f.rocks.length;
    expect(mean).toBeGreaterThan(0.6);
    expect(mean).toBeLessThan(2.4);
    expect(fieldMass(f)).toBeGreaterThan(total * 0.85);
  });
});

describe('ships and asteroids', () => {
  function scene(): GameState {
    const g = createGame({ seed: 3, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    g.asteroids = field([rock(1, [[10, 22], [10, 21], [10, 20], [11, 21], [9, 21], [11, 22], [9, 22]])], 'drift');
    g.map = { ...g.map, mode: 'static' };
    const [x, t] = g.ships;
    x!.pos = fromOffset(10, 25);
    x!.facing = 0;
    x!.speed = 4;
    t!.pos = fromOffset(20, 5);
    t!.facing = 3;
    g.phase = 'ships';
    g.turn = 1;
    g.placed = [true, true];
    g.chooser = 0;
    g.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'move', waived: [] };
    return g;
  }
  const FOUR: Extract<Command, { type: 'move' }>['steps'] = [{ kind: 'forward' }, { kind: 'forward' }, { kind: 'forward' }, { kind: 'forward' }];

  it('makes a ship that flies into an asteroid roll against 3 a hex of its size (7 hexes: 21)', () => {
    let hurt = false;
    for (let seed = 1; seed <= 40; seed++) {
      const g = scene();
      g.rngState = seed;
      const r = applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: FOUR });
      expect(r.ok).toBe(true);
      const lines = g.log.filter((e) => e.kind === 'asteroid');
      // the ship enters (10,22) at its third step and (10,21) at its fourth: both are hexes of the asteroid
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines[0]!.text).toMatch(/difficulty 21,/);
      const ship = shipById(g, 'P0-1')!;
      if (ship.bodyDamage > 0 || ship.status === 'destroyed') hurt = true;
    }
    expect(hurt).toBe(true);
  });

  it('takes one body point off for every shield marker on the side that was hit', () => {
    const damage = (shield: number, seed: number): number => {
      const g = scene();
      g.rngState = seed;
      // one meeting only (the ship is gone after a bad one, and would not meet the second)
      g.asteroids!.rocks = [rock(1, [[10, 22], [9, 22], [11, 22], [8, 22], [12, 22], [9, 23], [11, 23]])];
      shipById(g, 'P0-1')!.shields.front = shield;
      applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: FOUR });
      return shipById(g, 'P0-1')!.bodyDamage;
    };
    let strictlyLess = false;
    for (let seed = 1; seed <= 40; seed++) {
      expect(damage(3, seed)).toBeLessThanOrEqual(damage(0, seed));
      if (damage(3, seed) < damage(0, seed)) strictlyLess = true;
    }
    expect(strictlyLess).toBe(true);
  });

  it('marks what happens in a move with the step it happens in, and stops a destroyed ship there', () => {
    let destroyedAt = -1;
    let woundAt = -1;
    for (let seed = 1; seed <= 80; seed++) {
      const g = scene();
      g.rngState = seed;
      // the second hex of the rock is entered at step 3: a ship that is hurt (not destroyed) at step 2 goes on to meet it
      shipById(g, 'P0-1')!.bodyDamage = 3;
      applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: FOUR });
      const ship = shipById(g, 'P0-1')!;
      const tagged = g.log.filter((e) => e.moveStep !== undefined);
      expect(tagged.every((e) => e.moveStep! >= 0 && e.moveStep! <= 3)).toBe(true);
      const wounds = ship.wounds.filter((w) => w.moveStep !== undefined);
      if (wounds.length > 0 && woundAt < 0) woundAt = wounds[0]!.moveStep!;
      if (ship.status === 'destroyed') {
        const dead = g.log.find((e) => e.kind === 'destroyed')!;
        destroyedAt = dead.moveStep!;
        // nothing is told of the ship after the step in which it was destroyed
        expect(g.log.filter((e) => e.kind === 'asteroid' && e.moveStep! > destroyedAt)).toHaveLength(0);
        expect(wounds.at(-1)!.moveStep).toBe(destroyedAt);
        break;
      }
    }
    expect(woundAt).toBe(2);
    expect(destroyedAt).toBeGreaterThanOrEqual(2);
  });

  it('needs no roll when no asteroid is in the way', () => {
    const g = scene();
    g.asteroids!.rocks = [];
    expect(applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: FOUR }).ok).toBe(true);
    expect(g.log.some((e) => e.kind === 'asteroid')).toBe(false);
    expect(rockAt(g.asteroids!, fromOffset(10, 22))).toBeUndefined();
  });
});

describe('shooting at asteroids', () => {
  function range(specialWeapons = false): GameState {
    const g = createGame({ seed: 3, specialWeapons, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    g.asteroids = field([rock(1, [[10, 22], [10, 21], [11, 21]]), rock(2, [[10, 8]]), rock(3, [[14, 22]])], 'drift');
    g.map = { ...g.map, mode: 'static' };
    const [x, t] = g.ships;
    x!.pos = fromOffset(10, 25);
    x!.facing = 0;
    x!.speed = 3;
    t!.pos = fromOffset(20, 5);
    t!.facing = 3;
    g.phase = 'ships';
    g.turn = 1;
    g.placed = [true, true];
    g.chooser = 0;
    g.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'fire', waived: [] };
    return g;
  }
  const fireAt = (g: GameState, target: string, gun = 0, tubes?: number) =>
    applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun, target, ...(tubes ? { tubes } : {}) }] });

  it('lists the asteroids in the forward centre arc within five hexes', () => {
    const g = range();
    expect(rocksForCrew(g, shipById(g, 'P0-1')!, 'pilot').map((r) => r.id)).toEqual([1]);
  });

  it('adds 10 and the ships own speed to the guns number, and ignores the asteroid', () => {
    const g = range();
    const x = shipById(g, 'P0-1')!;
    const p = previewRockShot(g, x, 0, g.asteroids!.rocks[0]!);
    // the nearest hex of the asteroid is at range 3; the same gun at the same range has the same base number
    expect(p.range).toBe(3);
    expect(p.parts.map((q) => q.value)).toContain(10);
    expect(p.parts.map((q) => q.value)).toContain(3);
    expect(p.difficulty).toBe(p.parts[0]!.value + 10 + 3);
  });

  it('cannot reach an asteroid outside the arc or range', () => {
    const g = range();
    expect(fireAt(g, rockTargetId(2)).ok).toBe(false);
    expect(fireAt(g, rockTargetId(3)).ok).toBe(false);
    expect(fireAt(g, rockTargetId(99)).ok).toBe(false);
  });

  it('reduces an asteroid by one size when a hit adds up to 14, and what is lost is owed', () => {
    let reduced = false;
    for (let seed = 1; seed <= 400 && !reduced; seed++) {
      const g = range();
      g.rngState = seed;
      g.ships[0]!.gunnerySkill = { dice: 12, pips: 0 };
      expect(fireAt(g, rockTargetId(1)).ok).toBe(true);
      const r = g.asteroids!.rocks.find((x) => x.id === 1)!;
      if (r.hexes.length === 2) {
        reduced = true;
        expect(g.asteroids!.lost).toBe(1);
        expect(g.log.some((e) => e.kind === 'asteroid' && /reduced to size 2/.test(e.text))).toBe(true);
        expect(g.log.find((e) => e.kind === 'asteroid' && /reduced/.test(e.text))?.rocks).toBeDefined();
      }
    }
    expect(reduced).toBe(true);
  });

  it('makes a special weapon 5 easier for every hex of size, and needs 8 body points in one shot', () => {
    const g = range(true);
    const x = shipById(g, 'P0-1')!;
    const p = previewRockShot(g, x, SPECIAL, g.asteroids!.rocks[0]!);
    expect(p.gun).toBe('PT');
    expect(p.parts.at(-1)!.value).toBe(-15);
    expect(p.power).toBe(2);
    expect(fireAt(g, rockTargetId(1), SPECIAL, 2).ok).toBe(true);
    expect(x.projectiles).toBe(4);
    // two dice never add to 8 often, but over many shots it happens
    let reduced = false;
    for (let seed = 1; seed <= 300 && !reduced; seed++) {
      const h = range(true);
      h.rngState = seed;
      h.ships[0]!.gunnerySkill = { dice: 12, pips: 0 };
      fireAt(h, rockTargetId(1), SPECIAL, 2);
      reduced = h.asteroids!.rocks.find((r) => r.id === 1)!.hexes.length < 3;
    }
    expect(reduced).toBe(true);
  });
});

describe('the asteroid phase and shooting rocks', () => {
  function duel(): GameState {
    const g = createGame({ seed: 3, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    g.map = { ...g.map, mode: 'static' };
    shipById(g, 'P0-1')!.pos = fromOffset(10, 25);
    shipById(g, 'P0-1')!.facing = 0;
    shipById(g, 'P0-1')!.speed = 2;
    shipById(g, 'P1-1')!.pos = fromOffset(30, 3);
    shipById(g, 'P1-1')!.facing = 3;
    g.phase = 'ships';
    g.turn = 2;
    g.placed = [true, true];
    g.chooser = 0;
    g.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'move', waived: [] };
    return g;
  }

  it('offers the Fire Segment when only an asteroid is in reach', () => {
    const g = duel();
    g.asteroids = field([rock(1, [[10, 22]])], 'drift');
    expect(applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [{ kind: 'forward' }, { kind: 'forward' }] }).ok).toBe(true);
    // the ship stands at (10,23) now and the rock is one hex ahead
    expect(g.active?.stage).toBe('fire');
    const h = duel();
    h.asteroids = field([rock(1, [[10, 10]])], 'drift');
    applyCommand(h, { type: 'move', player: 0, shipId: 'P0-1', steps: [{ kind: 'forward' }, { kind: 'forward' }] });
    // nothing in reach: no Fire Segment
    expect(h.active?.stage !== 'fire').toBe(true);
  });

  it('marks what a drifting asteroid does to a ship with the frame of its movement, and keeps only the latest frames', () => {
    // two ships planning; the asteroid drifts onto the X-wing
    let struck = -1;
    for (let seed = 1; seed <= 40 && struck < 0; seed++) {
      const g = createGame({ seed, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
      g.map = { ...g.map, mode: 'static' };
      g.asteroids = field([rock(1, [[10, 22], [10, 21], [11, 21], [9, 21], [11, 22], [9, 22], [10, 20]], { q: 0, r: 2 })], 'drift');
      g.log.push({ turn: 0, kind: 'asteroids', text: 'old', rocks: [{ gone: [99] }] });
      shipById(g, 'P0-1')!.pos = fromOffset(10, 24);
      shipById(g, 'P0-1')!.facing = 0;
      shipById(g, 'P1-1')!.pos = fromOffset(30, 3);
      shipById(g, 'P1-1')!.facing = 3;
      g.phase = 'planning';
      g.turn = 1;
      g.placed = [true, true];
      const plans = (p: 0 | 1): Command => ({ type: 'plan', player: p, plans: { [p === 0 ? 'P0-1' : 'P1-1']: emptyPlan() } });
      applyCommand(g, plans(0));
      applyCommand(g, plans(1));
      const frames = g.log.find((e) => e.kind === 'asteroids' && e.rocks && e.text === 'The asteroids move.')?.rocks;
      expect(frames).toBeDefined();
      // the old pictures are gone
      expect(g.log.find((e) => e.text === 'old')?.rocks).toBeUndefined();
      const hits = g.log.filter((e) => e.kind === 'asteroid' && e.frame !== undefined && /is struck/.test(e.text));
      if (hits.length > 0) {
        struck = hits[0]!.frame!;
        expect(struck).toBeGreaterThanOrEqual(0);
        expect(struck).toBeLessThan(frames!.length);
        // the frame it is told in is one where the asteroid has just moved
        expect(frames![struck]!.moves).toBeDefined();
        for (const w of shipById(g, 'P0-1')!.wounds) expect(w.frame).toBe(struck);
      }
    }
    expect(struck).toBeGreaterThanOrEqual(0);
  });
});

describe('whole games with an asteroid field', () => {
  for (const motion of ['drift', 'events'] as AsteroidMotion[]) {
    it(`random play never makes the engine reject a command (${motion} motion)`, () => {
      let contacts = 0;
      let moves = 0;
      for (const mix of ['one', 'three'] as const) {
        for (let seed = 1; seed <= 3; seed++) {
          const g = createGame({ ...dogfightOptions(mix, seed), asteroids: { density: 'dense', motion } });
          playRandomGame(g, createRng(seed * 13), { maxCommands: 2500 });
          contacts += g.log.filter((e) => e.kind === 'asteroid' && /flies into|is struck/.test(e.text)).length;
          moves += g.log.filter((e) => e.kind === 'asteroids').length;
          expect(g.map.mode).toBe('static');
        }
      }
      expect(moves).toBeGreaterThan(0);
      expect(contacts).toBeGreaterThan(0);
    }, 120000);
  }

  it('the tactical computer plays whole games in a field', () => {
    for (const motion of ['drift', 'events'] as AsteroidMotion[]) {
      const g = createGame({ ...dogfightOptions('one', 5), asteroids: { density: 'medium', motion } });
      playGame(g, [tacticalAi(createRng(5)), tacticalAi(createRng(55))], { maxCommands: 8000 });
      expect(g.phase).toBe('over');
    }
  }, 120000);

  it('has the tactical computer take fewer knocks from asteroids when it weighs them than when it does not', () => {
    const knocks = (weight: number): number => {
      const saved = TUNING.rockWeight;
      TUNING.rockWeight = weight;
      try {
        let hurt = 0;
        let moves = 0;
        for (const mix of ['one', 'three'] as const) {
          for (let seed = 1; seed <= 5; seed++) {
            const g = createGame({ ...dogfightOptions(mix, seed), asteroids: { density: 'dense', motion: 'drift' } });
            playGame(g, [tacticalAi(createRng(seed)), tacticalAi(createRng(seed * 7))], { maxCommands: 6000 });
            hurt += g.log.filter((e) => e.kind === 'asteroid' && /flies into/.test(e.text) && /body points/.test(e.text) && !/= 0\./.test(e.text)).length;
            moves += g.log.filter((e) => e.kind === 'move').length;
          }
        }
        return hurt / moves;
      } finally {
        TUNING.rockWeight = saved;
      }
    };
    expect(knocks(TUNING.rockWeight)).toBeLessThan(knocks(0) * 0.9);
  }, 180000);

  it('starts the dice-driven motion on the second game-turn and the drifting one on the first', () => {
    const turnOf = (motion: AsteroidMotion): number | undefined => {
      const g = createGame({ ...dogfightOptions('one', 2), asteroids: { density: 'sparse', motion } });
      playRandomGame(g, createRng(3), { maxCommands: 300 });
      return g.log.find((e) => e.kind === 'asteroids')?.turn;
    };
    expect(turnOf('drift')).toBe(1);
    expect(turnOf('events')).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { playRandomGame } from '../src/ai/random';
import { playGame } from '../src/ai/player';
import { tacticalAi } from '../src/ai/tactical';
import {
  applyCommand,
  createGame,
  createRng,
  dogfightOptions,
  emptyPlan,
  fireLine,
  fromOffset,
  getShip,
  hasSideQuarters,
  previewShot,
  quarterAgainst,
  quarterOf,
  resolveHit,
  shieldMove,
  shipById,
  type Facing,
  type GameState,
  type Plan,
} from '../src/engine';

const centre = { q: 0, r: 0 };

describe('the quarters of a ship', () => {
  it('knows only a front and a rear quarter in the Standard Game', () => {
    expect(quarterOf(centre, 0, { q: 0, r: -3 })).toBe('front');
    expect(quarterOf(centre, 0, { q: 1, r: -2 })).toBe('front'); // the forward right arc is the front half
    expect(quarterOf(centre, 0, { q: -1, r: 1 })).toBe('rear');
    expect(quarterOf(centre, 0, { q: 0, r: 3 })).toBe('rear');
  });

  it('gives a big ship port and starboard quarters: only the centre arcs are front and rear', () => {
    expect(quarterOf(centre, 0, { q: 0, r: -3 }, true)).toBe('front');
    expect(quarterOf(centre, 0, { q: 0, r: 3 }, true)).toBe('rear');
    expect(quarterOf(centre, 0, { q: 1, r: -2 }, true)).toBe('right'); // forward right arc
    expect(quarterOf(centre, 0, { q: 2, r: 0 }, true)).toBe('right'); // rear right arc
    expect(quarterOf(centre, 0, { q: -1, r: -1 }, true)).toBe('left'); // forward left arc
    expect(quarterOf(centre, 0, { q: -2, r: 2 }, true)).toBe('left'); // rear left arc
  });

  it('reads the Port/Starboard Quarter line of the Fire Table for the flanks', () => {
    expect(fireLine('front')).toBe('front');
    expect(fireLine('rear')).toBe('rear');
    expect(fireLine('left')).toBe('portStarboard');
    expect(fireLine('right')).toBe('portStarboard');
    // the three lines are not alike, and the two flanks share one
    const codes = (q: 'front' | 'rear' | 'left' | 'right', roll: number) => resolveHit({ power: 0, shields: 0, ion: false, quarter: q, roll }).codes.join(',');
    const lines = [5, 6, 7, 8, 9, 10, 11, 12].map((roll) => [codes('front', roll), codes('rear', roll), codes('left', roll)]);
    expect(lines.some(([f, r, p]) => new Set([f, r, p]).size > 1)).toBe(true);
    for (let roll = 3; roll <= 13; roll++) expect(codes('left', roll)).toBe(codes('right', roll));
  });
});

interface Spec {
  typeId: string;
  owner: 0 | 1;
  col: number;
  row: number;
  facing: Facing;
}

function scene(specs: Spec[], advancedArcs: boolean, seed = 1): GameState {
  const game = createGame({ seed, ...(advancedArcs ? { advancedArcs: true } : {}), ships: specs.map((s) => ({ owner: s.owner, typeId: s.typeId, quality: 'average' as const })) });
  specs.forEach((s, i) => {
    const ship = game.ships[i]!;
    ship.pos = fromOffset(s.col, s.row);
    ship.facing = s.facing;
    ship.speed = 0;
  });
  game.phase = 'planning';
  game.turn = 1;
  game.initiative = 0;
  game.placed = [true, true];
  return game;
}

const get = (g: GameState, id: string) => shipById(g, id)!;
const plan = (changes: Partial<Plan>): Plan => ({ ...emptyPlan(), ...changes });

const scenePair = (...types: string[]) => scene(types.map((typeId, i) => ({ typeId, owner: 0 as const, col: 10 + i, row: 20, facing: 0 as Facing })).concat([{ typeId: 'tie-fighter', owner: 1 as never, col: 10, row: 10, facing: 3 as Facing }]), true).ships.filter((s) => s.owner === 0);

describe('which ships the advanced arcs apply to', () => {
  const g = scene([
    { typeId: 'b-wing', owner: 0, col: 12, row: 14, facing: 0 },
    { typeId: 'millennium-falcon', owner: 0, col: 8, row: 14, facing: 0 },
    { typeId: 'imperial-shuttle', owner: 1, col: 10, row: 10, facing: 3 },
  ], true);

  it('is for ships with a body rating of 10 or more, and only when the option is on', () => {
    expect(hasSideQuarters(g, get(g, 'P1-1'))).toBe(true); // 12
    expect(hasSideQuarters(g, get(g, 'P0-2'))).toBe(true); // the Falcon
    expect(hasSideQuarters(g, get(g, 'P0-1'))).toBe(false); // the B-wing has 9
    const off = scene([{ typeId: 'imperial-shuttle', owner: 1, col: 10, row: 10, facing: 3 }, { typeId: 'x-wing', owner: 0, col: 10, row: 14, facing: 0 }], false);
    expect(hasSideQuarters(off, get(off, 'P1-1'))).toBe(false);
  });

  it('spreads the markers of the big ships over the four boxes at the start, the small ships keep front and rear', () => {
    expect(get(g, 'P1-1').shields).toEqual({ front: 2, rear: 2, left: 1, right: 1 }); // the shuttle
    expect(get(g, 'P0-2').shields).toEqual({ front: 3, rear: 3, left: 1, right: 1 }); // the Falcon
    expect(get(g, 'P0-1').shields).toEqual({ front: 2, rear: 2, left: 0, right: 0 }); // the B-wing
    const more = scenePair('slave-i', 'stock-freighter', 'pirate-pinnace');
    expect(more.map((s) => s.shields)).toEqual([{ front: 2, rear: 2, left: 1, right: 1 }, { front: 1, rear: 1, left: 1, right: 1 }, { front: 1, rear: 1, left: 1, right: 1 }]);
    // the same total as the chart gives, and the old front and rear split without the option
    for (const ship of more) expect(ship.shields.front + ship.shields.rear + ship.shields.left + ship.shields.right).toBe(getShip(ship.typeId).shields);
    const off = scene([{ typeId: 'imperial-shuttle', owner: 1, col: 10, row: 10, facing: 3 }, { typeId: 'x-wing', owner: 0, col: 10, row: 14, facing: 0 }], false);
    expect(get(off, 'P1-1').shields).toEqual({ front: 3, rear: 3, left: 0, right: 0 });
  });
});

describe('shots at a big ship from the side', () => {
  const lambda = (advanced: boolean): GameState => scene([
    { typeId: 'x-wing', owner: 0, col: 12, row: 10, facing: 3 },
    { typeId: 'imperial-shuttle', owner: 1, col: 10, row: 10, facing: 0 },
  ], advanced);

  it('strike the port or starboard quarter, and only the shields angled that way count', () => {
    const g = lambda(true);
    const x = get(g, 'P0-1');
    const target = get(g, 'P1-1');
    const side = quarterAgainst(g, target, x.pos!);
    expect(['left', 'right']).toContain(side);
    target.shields[side] = 0;
    const before = previewShot(g, x, 0, target);
    expect(before.quarter).toBe(side);
    target.shields[side] = 2;
    expect(previewShot(g, x, 0, target).power).toBe(before.power - 2);
    // front and rear markers no longer help against a flank shot
    target.shields.front = 9;
    target.shields.rear = 9;
    expect(previewShot(g, x, 0, target).power).toBe(before.power - 2);
  });

  it('are plain front or rear shots without the option', () => {
    const g = lambda(false);
    const quarter = previewShot(g, get(g, 'P0-1'), 0, get(g, 'P1-1')).quarter;
    expect(['front', 'rear']).toContain(quarter);
  });
});

describe('angling the shields to the sides', () => {
  const duel = (advanced: boolean, seed = 1): GameState => scene([
    { typeId: 'x-wing', owner: 0, col: 10, row: 20, facing: 0 },
    { typeId: 'imperial-shuttle', owner: 1, col: 10, row: 10, facing: 3 },
  ], advanced, seed);
  const submit = (g: GameState, owner: 0 | 1, id: string, p: Plan) => applyCommand(g, { type: 'plan', player: owner, plans: { [id]: p } });

  it('lets a big ship move a marker from any box to any other', () => {
    const g = duel(true);
    expect(submit(g, 1, 'P1-1', plan({ angleDeflectors: 1, deflectorFrom: 'front', deflectorDirection: 'left' })).ok).toBe(true);
  });

  it('refuses the sides to a small ship, and to every ship without the option', () => {
    const small = duel(true);
    expect(submit(small, 0, 'P0-1', plan({ angleDeflectors: 1, deflectorFrom: 'front', deflectorDirection: 'left' })).ok).toBe(false);
    const off = duel(false);
    expect(submit(off, 1, 'P1-1', plan({ angleDeflectors: 1, deflectorFrom: 'front', deflectorDirection: 'right' })).ok).toBe(false);
    expect(submit(off, 1, 'P1-1', plan({ angleDeflectors: 1, deflectorDirection: 'rear' })).ok).toBe(true); // the old way still works
  });

  it('refuses to move a marker into the box it comes from', () => {
    const g = duel(true);
    expect(submit(g, 1, 'P1-1', plan({ angleDeflectors: 1, deflectorFrom: 'front', deflectorDirection: 'front' })).ok).toBe(false);
  });

  it('moves the markers in the Markers Phase', () => {
    // the Hazard Phase may take the action away again: look at a few games for one where it was carried out
    let moved = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = duel(true, seed);
      expect(submit(g, 0, 'P0-1', emptyPlan()).ok).toBe(true);
      expect(submit(g, 1, 'P1-1', plan({ angleDeflectors: 2, deflectorFrom: 'front', deflectorDirection: 'right' })).ok).toBe(true);
      const s = get(g, 'P1-1').shields;
      expect(s.front + s.rear + s.left + s.right).toBe(6);
      if (s.right > 1) {
        expect(s).toEqual({ front: 0, rear: 2, left: 1, right: 3 });
        moved += 1;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe('the computer players and the advanced arcs', () => {
  it('angles the shields toward the enemy that is on its flank', () => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, col: 12, row: 10, facing: 3 },
      { typeId: 'imperial-shuttle', owner: 1, col: 10, row: 10, facing: 0 },
    ], true);
    const lambda = get(g, 'P1-1');
    const move = shieldMove(g, lambda, [get(g, 'P0-1')]);
    expect(move).not.toBeNull();
    expect(move!.to).toBe(quarterAgainst(g, lambda, get(g, 'P0-1').pos!));
    expect(move!.from).not.toBe(move!.to);
    // not for a small ship, and not with nobody to fear
    expect(shieldMove(g, get(g, 'P0-1'), [lambda])).toBeNull();
    expect(shieldMove(g, lambda, [])).toBeNull();
  });

  it('plays whole games, random and tactical, with the option on, and the shields stay sensible', () => {
    let sides = 0;
    for (const mix of ['one', 'three', 'showcase'] as const) {
      for (let seed = 1; seed <= 3; seed++) {
        const random = createGame({ ...dogfightOptions(mix, seed), advancedArcs: true });
        playRandomGame(random, createRng(seed * 7), { maxCommands: 2500 });
        const g = createGame({ ...dogfightOptions(mix, seed), advancedArcs: true });
        playGame(g, [tacticalAi(createRng(seed)), tacticalAi(createRng(seed * 11))], { maxCommands: 8000 });
        sides += g.log.filter((e) => /angles \d shields? from the \w+ to the (left|right)/.test(e.text)).length;
        expect(g.phase).toBe('over');
        for (const ship of [...random.ships, ...g.ships]) for (const box of ['front', 'rear', 'left', 'right'] as const) expect(ship.shields[box]).toBeGreaterThanOrEqual(0);
      }
    }
    console.log('flank angling by the computer:', sides);
    expect(sides).toBeGreaterThan(0);
  });
});

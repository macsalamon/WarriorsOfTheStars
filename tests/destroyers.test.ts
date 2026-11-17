import { describe, expect, it } from 'vitest';
import {
  forceCost,
  STANDARD_MAP,
  applyCommand,
  attackBoxes,
  createGame,
  scenarioDef,
  scenarioOptions,
  validateScenario,
  destroyerById,
  destroyerHexes,
  canFire,
  capitalDistance,
  capitalTargetsOf,
  capitalNose,
  canMove,
  structureLeft,
  destroyerLegalSteps,
  destroyerMaxSpeed,
  destroyerName,
  destroyerShields,
  hexesOf,
  destroyerMoveContext,
  destroyerSpeedChoices,
  destroyerSpeedNow,
  emptyPlan,
  fromOffset,
  hexDistance,
  hexEquals,
  crashIntoDestroyer,
  destroyerHexInReach,
  loseStructure,
  previewDestroyerShot,
  SPECIAL,
  specialStructureChance,
  vitalResult,
  nearestHexOf,
  rangeIndex,
  verdictOf,
  waitingFor,
  type Command,
  type Facing,
  type GameOptions,
  type GameState,
  type Hex,
} from '../src/engine';

// one column more than the printed map, so that it is not made larger for the capital ships: these tests place the ships by hand
const map = { ...STANDARD_MAP, cols: STANDARD_MAP.cols + 1, mode: 'static' as const };

const options = (extra: Partial<GameOptions> = {}): GameOptions => ({
  seed: 7,
  map,
  ships: [
    { owner: 0, typeId: 'x-wing', quality: 'veteran' },
    { owner: 1, typeId: 'star-destroyer', quality: 'average' },
  ],
  rules: { end: [] },
  ...extra,
});

const ok = (g: GameState, cmd: Command): void => {
  const r = applyCommand(g, cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${r.error}`);
};

/** An X-wing at the given row heading south, the Star Destroyer with its pivot at row 34 pointing north: both placed, the game at planning. */
function started(fighterRow = 14, extra: Partial<GameOptions> = {}): GameState {
  const g = createGame(options(extra));
  ok(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: fromOffset(16, fighterRow), facing: 3 }] });
  ok(g, { type: 'place', player: 1, placements: [{ shipId: 'SD1-1', pos: fromOffset(16, 34), facing: 0 }] });
  // it enters play at 4: the tests that move it five hexes start it at its top speed
  destroyerById(g, 'SD1-1')!.speed = 5;
  return g;
}

const plansDone = (g: GameState): void => {
  ok(g, { type: 'plan', player: 0, plans: { 'P0-1': emptyPlan() } });
};

const FIVE = ['forward', 'forward', 'forward', 'forward', 'forward'] as ('forward' | 'turnLeft' | 'turnRight')[];
const SIX_AHEAD = Array.from({ length: 6 }, () => ({ kind: 'forward' as const }));

describe('the shape of a Star Destroyer', () => {
  it('is 17 hexes, seven long, turning on its fourth hex from the front, in all six facings', () => {
    const nose: Hex = { q: 10, r: 10 };
    const seen = new Set<string>();
    for (const f of [0, 1, 2, 3, 4, 5] as Facing[]) {
      const hexes = destroyerHexes(nose, f);
      expect(hexes).toHaveLength(17);
      expect(new Set(hexes.map((h) => `${h.q},${h.r}`)).size).toBe(17);
      // the front hex is ahead of the hex it turns on, which is the position of the ship
      expect(hexEquals(hexes[0]!, capitalNose(nose, f))).toBe(true);
      expect(hexes.some((h) => hexEquals(h, nose))).toBe(true);
      // every hex touches another one of the ship
      for (const h of hexes.slice(1)) expect(hexes.some((o) => o !== h && hexDistance(o, h) === 1)).toBe(true);
      // seven hexes long, the pivot the fourth from the front: nothing is further than 3 hexes from it
      expect(Math.max(...hexes.map((h) => hexDistance(nose, h)))).toBe(3);
      seen.add(hexes.map((h) => `${h.q},${h.r}`).sort().join('|'));
    }
    expect(seen.size).toBe(6);
  });

  it('points north from its nose at facing 0, with the body below', () => {
    const hexes = destroyerHexes(fromOffset(16, 20), 0);
    const rows = hexes.map((h) => h.r + h.q / 2);
    expect(Math.min(...rows)).toBe(rows[0]);
  });
});

describe('the Star Destroyer Attack Table', () => {
  it('names no guns for a 2, the ion cannons alone for a 3, and six guns for a 12', () => {
    expect(attackBoxes(2)).toEqual([]);
    expect(attackBoxes(1)).toEqual([]);
    expect(attackBoxes(3).map((b) => b.ion)).toEqual([true]);
    expect(attackBoxes(12).reduce((n, b) => n + b.count, 0)).toBe(6);
    expect(attackBoxes(5)[0]).toMatchObject({ count: 1, code: 'TH', hit: [15, 13, 13, 16, 19, 21], power: [7, 7, 6, 5, 5, 4] });
  });

  it('counts ranges 1 to 5 as they are, 6 to 10 together, and nothing beyond', () => {
    expect([1, 2, 5, 6, 10].map(rangeIndex)).toEqual([0, 1, 4, 5, 5]);
    expect(rangeIndex(11)).toBeNull();
  });
});

describe('a game with a Star Destroyer', () => {
  it('is placed with all 17 hexes in the set-up area, and moves after both sides have planned', () => {
    const g = createGame(options());
    expect(applyCommand(g, { type: 'place', player: 1, placements: [{ shipId: 'SD1-1', pos: fromOffset(16, 20), facing: 0 }] }).ok).toBe(false); // outside the area
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: fromOffset(16, 14), facing: 3 }] });
    ok(g, { type: 'place', player: 1, placements: [{ shipId: 'SD1-1', pos: fromOffset(16, 34), facing: 0 }] });
    expect(g.phase).toBe('planning');
    plansDone(g);
    expect(g.phase).toBe('destroyers');
    expect(waitingFor(g)).toEqual([1]);
    expect(destroyerLegalSteps(g, 'SD1-1')).toEqual(['forward']); // turn number 3: no turn at the start
  });

  it('moves 5 hexes with a turn number of 3, and refuses anything else', () => {
    const g = started();
    plansDone(g);
    expect(applyCommand(g, { type: 'moveDestroyer', player: 0, id: 'SD1-1', steps: FIVE }).ok).toBe(false); // not his
    expect(applyCommand(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: ['forward', 'forward'] }).ok).toBe(false); // too short
    expect(applyCommand(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: ['forward', 'turnLeft', 'forward', 'forward', 'forward'] }).ok).toBe(false); // too early to turn
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: ['forward', 'forward', 'forward', 'turnRight', 'forward', 'forward'] });
    expect(destroyerById(g, 'SD1-1')!.facing).toBe(1);
    expect(g.phase).toBe('ships');
  });

  it('fires once at a fighter that moves within ten hexes: one attack roll, then a shot for every gun it names', () => {
    const g = started(14);
    plansDone(g);
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: FIVE });
    const sd = destroyerById(g, 'SD1-1')!;
    expect(sd.pos).toEqual(fromOffset(16, 29));
    const before = g.log.length;
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: SIX_AHEAD });
    const fresh = g.log.slice(before);
    expect(fresh.filter((e) => /attack roll/.test(e.text))).toHaveLength(1);
    for (const e of fresh.filter((x) => x.shot?.shooter === 'SD1-1')) expect(e.shot!.range).toBeLessThanOrEqual(10);
  });

  it('puts a target marker on a fighter it fired at that stops within ten hexes', () => {
    const g = started(14);
    plansDone(g);
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: FIVE });
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: SIX_AHEAD });
    const x = g.ships[0]!;
    if (x.status === 'active') expect(x.sdMarkers).toEqual(['SD1-1']);
  });

  it('leaves a fighter alone that stays out of range, and gives it no marker', () => {
    const g = started(6);
    plansDone(g);
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: FIVE });
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    const before = g.log.length;
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: SIX_AHEAD });
    expect(g.log.slice(before).some((e) => e.shot?.shooter === 'SD1-1')).toBe(false);
    expect(g.ships[0]!.sdMarkers).toBeUndefined();
  });
});

describe('the structure of a Star Destroyer', () => {
  it('keeps a side in the game until its Star Destroyer has lost 8 structure points, and scores 50 at the eighth and 25 more at the ninth', () => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    g.rules = undefined;
    loseStructure(g, d, 7, 0, '');
    expect(g.phase).not.toBe('over');
    expect(g.vp[0]).toBe(0);
    loseStructure(g, d, 1, 0, '');
    expect(g.vp[0]).toBe(50);
    expect(g.phase).toBe('over');
    expect(g.winner).toBe(0);
    loseStructure(g, d, 1, 0, '');
    expect(d.lost).toBe(9);
    expect(g.vp[0]).toBe(75);
  });

  it('stays in the game as long as it is not out, for a verdict about the side too', () => {
    const g = started();
    g.rules = { verdicts: [{ when: { kind: 'sideGone', side: 1 }, winner: 0 }] };
    expect(verdictOf(g)).toBeNull();
    destroyerById(g, 'SD1-1')!.lost = 8;
    expect(verdictOf(g)).not.toBeNull();
  });

  it('is found by its nearest hex', () => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    expect(nearestHexOf(d, fromOffset(16, 20))!.distance).toBe(11);
  });
});

describe('the Vital Systems Hit Table', () => {
  it('reads the table as the rules print it', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(vitalResult)).toEqual(['chain', 'fireControl', 'explosion', 'steering', 'none', 'none', 'explosion', 'power', 'none', 'guns', 'bridge']);
  });
});

describe('a fighter that crashes into a Star Destroyer', () => {
  const crash = (hexesLeft: number, facing: Facing, gap = 5): string[] => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    const ship = g.ships[0]!;
    const from = { q: d.pos!.q, r: d.pos!.r - gap };
    const before = g.log.length;
    crashIntoDestroyer(g, ship, d, from, facing, hexesLeft);
    return g.log.slice(before).map((e) => e.text);
  };

  it('strikes where its line of flight first touches the ship: the difficulty is 20 and 5 for each hex to the point of impact', () => {
    expect(crash(3, 3).join(' ')).toMatch(/difficulty 30/);
    expect(crash(5, 3, 4).join(' ')).toMatch(/difficulty 25/);
    expect(crash(1, 3, 3).join(' ')).toMatch(/difficulty 20/);
  });

  it('flies past when its movement runs out before the ship, or when it flies away from it', () => {
    expect(crash(1, 3)).toEqual([]);
    expect(crash(6, 0)).toEqual([]);
  });

  it('does nothing for a fighter of the other side', () => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    const ship = g.ships[0]!;
    ship.owner = 1;
    const before = g.log.length;
    crashIntoDestroyer(g, ship, d, { q: d.pos!.q, r: d.pos!.r - 3 }, 3, 3);
    expect(g.log.length).toBe(before);
  });
});

describe('a fighter shooting at a Star Destroyer', () => {
  it('aims at the nearest of its hexes that the gun reaches, and meets the usual modifiers, with special weapons 40 worse', () => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    const ship = g.ships[0]!;
    ship.pos = { q: d.pos!.q, r: d.pos!.r - 5 };
    ship.facing = 3;
    const hex = destroyerHexInReach(g, ship, 0, 'pilot', d);
    expect(hex).toEqual(capitalNose(d.pos!, d.facing));
    const shot = previewDestroyerShot(g, ship, 0, d, hex!);
    expect(shot.range).toBe(2);
    expect(shot.difficulty).toBeGreaterThan(0);
  });

  it('finds nothing behind the fighter', () => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    const ship = g.ships[0]!;
    ship.pos = { q: d.pos!.q, r: d.pos!.r - 5 };
    ship.facing = 0;
    expect(destroyerHexInReach(g, ship, 0, 'pilot', d)).toBeNull();
  });

  it('fires through the fire command once the fighter has moved within reach, and the shot is logged', () => {
    const g = createGame(options());
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: fromOffset(16, 14), facing: 3 }] });
    ok(g, { type: 'place', player: 1, placements: [{ shipId: 'SD1-1', pos: fromOffset(16, 33), facing: 0 }] });
    destroyerById(g, 'SD1-1')!.speed = 5;
    plansDone(g);
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: FIVE });
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: SIX_AHEAD });
    expect(g.ships[0]!.status).toBe('active');
    expect(g.active?.stage).toBe('fire');
    const before = g.log.length;
    ok(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'SD1-1' }] });
    const shot = g.log.slice(before).find((e) => e.shot?.shooter === 'P0-1');
    expect(shot?.shot?.target).toBe('SD1-1');
    expect(shot?.text).toMatch(/Star Destroyer/);
  });
});

describe('Star Destroyers against each other', () => {
  it('fire at each other once a turn, a die for every structure point they have left', () => {
    const g = createGame(options({
      ships: [
        { owner: 0, typeId: 'star-destroyer', quality: 'average' },
        { owner: 1, typeId: 'star-destroyer', quality: 'average' },
      ],
    }));
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'SD0-1', pos: fromOffset(16, 10), facing: 3 }] });
    ok(g, { type: 'place', player: 1, placements: [{ shipId: 'SD1-1', pos: fromOffset(16, 33), facing: 0 }] });
    for (const d of g.destroyers!) d.speed = 5;
    expect(g.phase).toBe('destroyers');
    ok(g, { type: 'moveDestroyer', player: 0, id: 'SD0-1', steps: FIVE });
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: FIVE });
    expect(g.log.some((e) => /fires at Star Destroyer/.test(e.text))).toBe(true);
  });
});

describe('the Star Destroyer scenarios (31)', () => {
  const sizes = (id: string): { fighters: [number, number]; destroyers: [number, number]; skill: string } => {
    const g = createGame(scenarioOptions(id, 1));
    const count = (owner: number): number => g.ships.filter((s) => s.owner === owner).length;
    const sds = (owner: number): number => (g.destroyers ?? []).filter((d) => d.owner === owner).length;
    return { fighters: [count(0), count(1)], destroyers: [sds(0), sds(1)], skill: (g.destroyers ?? []).map((d) => `${d.skill.dice}D`).join(',') };
  };

  it('are valid scenarios', () => {
    for (let n = 1; n <= 8; n++) expect(validateScenario(scenarioDef(`destroyers${n}`))).toBeNull();
  });

  it('give a Star Destroyer to the Empire and a Nebulon-B frigate to the Rebels (they are Imperial and Rebel ships)', () => {
    const def = structuredClone(scenarioDef('destroyers1')!);
    def.sides[0].ships.push({ typeId: 'star-destroyer', quality: 'average' });
    expect(validateScenario(def)).toMatch(/Imperial/);
  });

  it('follow the mixes of the rules', () => {
    expect(sizes('destroyers1')).toEqual({ fighters: [6, 0], destroyers: [0, 1], skill: '5D' });
    expect(sizes('destroyers2')).toEqual({ fighters: [3, 4], destroyers: [1, 1], skill: '5D,5D' });
    expect(sizes('destroyers3')).toEqual({ fighters: [3, 3], destroyers: [1, 1], skill: '5D,5D' });
    expect(sizes('destroyers4')).toEqual({ fighters: [3, 6], destroyers: [1, 1], skill: '5D,5D' });
    expect(sizes('destroyers5')).toEqual({ fighters: [1, 3], destroyers: [1, 1], skill: '5D,5D' });
    expect(sizes('destroyers6')).toEqual({ fighters: [15, 3], destroyers: [0, 1], skill: '6D' });
  });

  it('have the two large battles of the menu, fair in points for both sides', () => {
    expect(sizes('destroyers7')).toEqual({ fighters: [9, 13], destroyers: [1, 1], skill: '5D,5D' });
    expect(sizes('destroyers8')).toEqual({ fighters: [4, 6], destroyers: [1, 1], skill: '5D,5D' });
    const cost = (id: string, side: number): number => forceCost(scenarioDef(id)!.sides[side]!.ships.map((s) => ({ typeId: s.typeId, quality: s.quality, gunners: [] })));
    expect([cost('destroyers7', 0), cost('destroyers7', 1)]).toEqual([241, 241]);
    expect([cost('destroyers8', 0), cost('destroyers8', 1)]).toEqual([88, 88]);
  });

  it('start with the bonus points of the mix', () => {
    expect(createGame(scenarioOptions('destroyers6', 1)).vp).toEqual([2, 0]);
    expect(createGame(scenarioOptions('destroyers3', 1)).vp).toEqual([0, 1]);
  });

  it('take the gunnery skill the player sets, whatever the scenario says', () => {
    const g = createGame({ ...scenarioOptions('destroyers6', 1), destroyerSkill: { dice: 4, pips: 2 } });
    expect(g.destroyers![0]!.skill).toEqual({ dice: 4, pips: 2 });
  });

  it('end when the side with only Star Destroyers has lost eight structure points', () => {
    const g = createGame(scenarioOptions('destroyers1', 1));
    expect(verdictOf(g)).toBeNull();
    g.destroyers![0]!.lost = 8;
    loseStructure(g, g.destroyers![0]!, 0, 0, '');
    g.destroyers![0]!.lost = 7;
    loseStructure(g, g.destroyers![0]!, 1, 0, '');
    expect(g.phase).toBe('over');
    expect(g.winner).toBe(0);
  });
});

describe('a Star Destroyer at the edge of a static map', () => {
  it('may fly off it and has escaped then, which counts as gone for its side', () => {
    const g = started();
    plansDone(g);
    const d = destroyerById(g, 'SD1-1')!;
    d.pos = fromOffset(16, 43);
    d.facing = 3;
    g.rules = undefined;
    g.ships[0]!.status = 'active';
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: FIVE });
    const after = destroyerById(g, 'SD1-1')!;
    expect(after.escaped).toBe(true);
    expect(after.pos).toBeNull();
    expect(g.log.some((e) => /escapes: it has flown off the edge/.test(e.text))).toBe(true);
    // its side has no fighter and no Star Destroyer in the game any more
    expect(g.phase).toBe('over');
    // no points were scored: a draw
    expect(g.winner).toBe('draw');
  });
});

describe('the speed of a Star Destroyer', () => {
  it('goes by half a hex a game-turn, from 5 down to 0, and moves the hexes of its speed rounded up', () => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    expect(destroyerSpeedNow(d)).toBe(5);
    expect(destroyerSpeedChoices(d)).toEqual([4.5, 5]);
    // the turn numbers go with the hexes: 5/3, 4/3, 3/2, 2/1, 1/1, 0/half
    expect([5, 4.5, 4, 3.5, 3, 2, 1, 0].map((speed) => destroyerMoveContext(d, speed).turnNumber)).toEqual([3, 3, 3, 3, 2, 1, 1, 0.5]);
    expect([4.5, 3.5, 0.5, 0].map((speed) => destroyerMoveContext(d, speed).speed)).toEqual([5, 4, 1, 0]);
    d.speed = 2;
    expect(destroyerSpeedChoices(d)).toEqual([1.5, 2, 2.5]);
    d.speed = 0;
    expect(destroyerSpeedChoices(d)).toEqual([0, 0.5]);
  });

  it('is changed with the move command by half a hex at most, and then stays', () => {
    const g = started();
    plansDone(g);
    expect(applyCommand(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: ['forward', 'forward', 'forward', 'forward'], speed: 4 }).ok).toBe(false);
    // 4 1/2 moves 5 hexes
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: FIVE, speed: 4.5 });
    expect(destroyerSpeedNow(destroyerById(g, 'SD1-1')!)).toBe(4.5);
    expect(g.log.some((e) => /slows down to 4½/.test(e.text))).toBe(true);
    expect(destroyerSpeedChoices(destroyerById(g, 'SD1-1')!)).toEqual([4, 4.5, 5]);
  });

  it('turns after 2 hexes at speed 3, after every hex at speed 1, and freely when it stands still', () => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    expect(destroyerLegalSteps(g, 'SD1-1', ['forward'], 3)).toEqual(['forward']);
    expect(destroyerLegalSteps(g, 'SD1-1', ['forward', 'forward'], 3)).toContain('turnLeft');
    expect(destroyerLegalSteps(g, 'SD1-1', [], 0)).toEqual(['turnLeft', 'turnRight']);
    d.speed = 1;
    expect(destroyerLegalSteps(g, 'SD1-1', ['forward'], 1)).toEqual(['turnLeft', 'turnRight']);
    expect(destroyerLegalSteps(g, 'SD1-1', [], 1)).toEqual(['forward']);
  });

  it('can stand still: no hexes, a few turns', () => {
    const g = started();
    plansDone(g);
    const d = destroyerById(g, 'SD1-1')!;
    d.speed = 0.5;
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: ['turnRight', 'turnRight'], speed: 0 });
    const after = destroyerById(g, 'SD1-1')!;
    expect(after.pos).toEqual(fromOffset(16, 34));
    expect(after.facing).toBe(2);
    expect(destroyerSpeedNow(after)).toBe(0);
  });

  it('turns on its pivot hex, the front hex swinging round it', () => {
    const g = started();
    plansDone(g);
    const d = destroyerById(g, 'SD1-1')!;
    d.speed = 0.5;
    const before = hexesOf(d);
    const pivot = { ...d.pos! };
    expect(before.some((h) => hexEquals(h, pivot))).toBe(true);
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: ['turnLeft'], speed: 0 });
    const after = destroyerById(g, 'SD1-1')!;
    expect(after.pos).toEqual(pivot);
    expect(hexesOf(after).some((h) => hexEquals(h, pivot))).toBe(true);
    expect(hexEquals(hexesOf(after)[0]!, before[0]!)).toBe(false);
  });

  it('is held down by a loss of power: the top speed is one less, and a faster ship slows down to it', () => {
    const g = started();
    const d = destroyerById(g, 'SD1-1')!;
    d.speedLost = 2;
    expect(destroyerMaxSpeed(d)).toBe(3);
    expect(destroyerSpeedNow(d)).toBe(3);
    expect(destroyerSpeedChoices(d)).toEqual([2.5, 3]);
  });
});

describe('the Nebulon-B frigate', () => {
  const frigate = (): GameState => {
    const g = createGame(options({ ships: [{ owner: 0, typeId: 'nebulon-b', quality: 'average' }, { owner: 1, typeId: 'star-destroyer', quality: 'average' }] }));
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'SD0-1', pos: fromOffset(16, 12), facing: 3 }] });
    ok(g, { type: 'place', player: 1, placements: [{ shipId: 'SD1-1', pos: fromOffset(16, 34), facing: 0 }] });
    return g;
  };

  it('fills four hexes, has 4 structure points, 3 shields and gunners of 4D', () => {
    const g = frigate();
    const f = destroyerById(g, 'SD0-1')!;
    expect(f.kind).toBe('nebulon-b');
    expect(destroyerHexes(f.pos!, f.facing, 'nebulon-b')).toHaveLength(4);
    expect(f.skill).toEqual({ dice: 4, pips: 0 });
    expect(destroyerShields(f)).toBe(3);
    expect(destroyerName(f)).toMatch(/^Nebulon-B frigate #1/);
    f.lost = 1;
    expect(destroyerShields(f)).toBe(2);
  });

  it('moves up to 6 hexes by one hex a game-turn, with the turn numbers 6/3, 5/3, 4/2, 3/2, 2/1, 1/1 and 0/half', () => {
    const g = frigate();
    const f = destroyerById(g, 'SD0-1')!;
    expect(destroyerSpeedNow(f)).toBe(5);
    expect(destroyerSpeedChoices(f)).toEqual([4, 5, 6]);
    expect([6, 5, 4, 3, 2, 1, 0].map((speed) => destroyerMoveContext(f, speed).turnNumber)).toEqual([3, 3, 2, 2, 1, 1, 0.5]);
  });

  it('is dead in space after 4 structure points, which scores 15 points for the other side', () => {
    const g = frigate();
    g.rules = undefined;
    const f = destroyerById(g, 'SD0-1')!;
    loseStructure(g, f, 3, 1, '');
    expect(f.lost).toBe(3);
    expect(g.vp[1]).toBe(0);
    loseStructure(g, f, 1, 1, '');
    expect(f.lost).toBe(4);
    expect(g.vp[1]).toBe(15);
    loseStructure(g, f, 1, 1, '');
    expect(f.lost).toBe(4);
    expect(g.vp[1]).toBe(15);
  });

  it('fires only the first column of the attack table: no ion guns, and nothing for a 3', () => {
    expect(attackBoxes(3, 'nebulon-b')).toEqual([]);
    const boxes = attackBoxes(12, 'nebulon-b');
    expect(boxes).toHaveLength(1);
    expect(boxes.some((b) => b.ion)).toBe(false);
    expect(attackBoxes(12, 'star-destroyer').length).toBeGreaterThan(1);
  });

  it('may serve either side, but a Star Destroyer is only Imperial', () => {
    const def = structuredClone(scenarioDef('destroyers1')!);
    def.sides[1].ships.push({ typeId: 'nebulon-b', quality: 'average' });
    def.sides[0].ships.push({ typeId: 'nebulon-b', quality: 'average' });
    expect(validateScenario(def)).toBeNull();
    def.sides[0].ships.push({ typeId: 'star-destroyer', quality: 'average' });
    expect(validateScenario(def)).toMatch(/Imperial/);
  });
});

describe('the Mon Calamari cruiser and the start speeds', () => {
  const fleet = (): GameState =>
    createGame(options({
      ships: [
        { owner: 0, typeId: 'mon-calamari', quality: 'average' },
        { owner: 0, typeId: 'nebulon-b', quality: 'average' },
        { owner: 1, typeId: 'star-destroyer', quality: 'average' },
        { owner: 1, typeId: 'nebulon-b', quality: 'average' },
      ],
    }));

  it('enter play a step under their top speed: 4 for the big ones, 5 for a frigate', () => {
    const g = fleet();
    expect(g.destroyers!.map((d) => [d.kind, destroyerSpeedNow(d)])).toEqual([['mon-calamari', 4], ['nebulon-b', 5], ['star-destroyer', 4], ['nebulon-b', 5]]);
  });

  it('handles better than a Star Destroyer: a whole hex of speed a game-turn, turn numbers 3, 2, 2, 1, 1/2, 1/2 at speeds 5 to 0', () => {
    const g = fleet();
    const mc = g.destroyers![0]!;
    expect(destroyerSpeedChoices(mc)).toEqual([3, 4, 5]);
    expect([5, 4, 3, 2, 1, 0].map((speed) => destroyerMoveContext(mc, speed).turnNumber)).toEqual([3, 2, 2, 1, 0.5, 0.5]);
    expect(destroyerMaxSpeed(mc)).toBe(5);
  });

  it('is a Star Destroyer with one structure point less and one shield more', () => {
    const g = fleet();
    const mc = g.destroyers![0]!;
    const sd = g.destroyers![2]!;
    expect(destroyerShields(mc)).toBe(destroyerShields(sd) + 1);
    expect(structureLeft(mc)).toBe(structureLeft(sd) - 1);
    expect(destroyerName(mc)).toMatch(/^Mon Calamari cruiser #1/);
    expect(destroyerHexes({ q: 0, r: 0 }, 0, 'mon-calamari')).toHaveLength(13);
    g.rules = undefined;
    mc.pos = { q: 5, r: 5 };
    loseStructure(g, mc, 6, 1, '');
    expect(g.vp[1]).toBe(0);
    loseStructure(g, mc, 1, 1, '');
    expect(g.vp[1]).toBe(50);
    expect(canFire(mc)).toBe(false);
    expect(canMove(mc)).toBe(true);
    loseStructure(g, mc, 1, 1, '');
    expect(g.vp[1]).toBe(75);
    expect(canMove(mc)).toBe(false);
  });

  it('are Rebel (the cruiser), Imperial (the Star Destroyer) or either side (the frigate)', () => {
    const def = structuredClone(scenarioDef('destroyers1')!);
    def.sides[1].ships.push({ typeId: 'mon-calamari', quality: 'average' });
    expect(validateScenario(def)).toMatch(/Rebel/);
    const ok2 = structuredClone(scenarioDef('destroyers1')!);
    ok2.sides[0].ships.push({ typeId: 'nebulon-b', quality: 'average' });
    ok2.sides[1].ships.push({ typeId: 'nebulon-b', quality: 'average' });
    ok2.sides[0].ships.push({ typeId: 'mon-calamari', quality: 'average' });
    expect(validateScenario(ok2)).toBeNull();
  });
});

describe('capital ships picking their targets', () => {
  const battle = (): GameState => {
    const g = createGame(options({
      ships: [
        { owner: 0, typeId: 'mon-calamari', quality: 'average' },
        { owner: 1, typeId: 'star-destroyer', quality: 'average' },
        { owner: 1, typeId: 'nebulon-b', quality: 'average' },
      ],
    }));
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'SD0-1', pos: fromOffset(16, 12), facing: 3 }] });
    ok(g, { type: 'place', player: 1, placements: [{ shipId: 'SD1-1', pos: fromOffset(12, 34), facing: 0 }, { shipId: 'SD1-2', pos: fromOffset(18, 31), facing: 0 }] });
    // they stand still: the test is about the targets
    for (const d of g.destroyers!) d.speed = 0;
    return g;
  };
  const moveAll = (g: GameState): void => {
    for (let i = 0; i < 3 && g.phase === 'destroyers' && !g.capitalTargets; i++) {
      const id = g.destroyerQueue!.ids[g.destroyerQueue!.index]!;
      const d = destroyerById(g, id)!;
      ok(g, { type: 'moveDestroyer', player: d.owner, id, steps: [] , speed: 0 });
    }
  };

  it('ask the owner of a ship that has more than one target, once all have moved, and then all fire together', () => {
    const g = battle();
    g.rules = { end: [] };
    moveAll(g);
    // the cruiser has two targets in reach: its owner picks; the Star Destroyer has one; the frigate has none (the cruiser is 18 hexes away, its range is 15)
    expect(capitalTargetsOf(g, destroyerById(g, 'SD1-2')!)).toEqual([]);
    expect(g.phase).toBe('destroyers');
    expect(g.capitalTargets!.asking).toEqual(['SD0-1']);
    expect(waitingFor(g)).toEqual([0]);
    expect(applyCommand(g, { type: 'targetCapital', player: 1, id: 'SD0-1', target: 'SD1-1' }).ok).toBe(false);
    expect(applyCommand(g, { type: 'targetCapital', player: 0, id: 'SD0-1', target: 'SD0-1' }).ok).toBe(false);
    const before = g.log.length;
    ok(g, { type: 'targetCapital', player: 0, id: 'SD0-1', target: 'SD1-2' });
    const lines = g.log.slice(before).map((e) => e.text);
    expect(lines.filter((t) => /fires at/.test(t))).toHaveLength(2);
    expect(lines.some((t) => /Mon Calamari cruiser #1 \(player 1\) fires at Nebulon-B frigate #2/.test(t))).toBe(true);
  });

  it('fire no further than their range: 20 hexes for a Star Destroyer or a cruiser, 15 for a frigate', () => {
    const g = battle();
    g.rules = { end: [] };
    const mc = destroyerById(g, 'SD0-1')!;
    const sd = destroyerById(g, 'SD1-1')!;
    const nb = destroyerById(g, 'SD1-2')!;
    expect(capitalDistance(mc, sd)).toBeLessThanOrEqual(20);
    expect(capitalTargetsOf(g, mc).map((t) => t.id)).toEqual(['SD1-1', 'SD1-2']);
    // the Star Destroyer moves away: out of reach of the cruiser
    sd.pos = fromOffset(12, 44);
    expect(capitalDistance(mc, sd)).toBeGreaterThan(20);
    expect(capitalTargetsOf(g, mc).map((t) => t.id)).toEqual(['SD1-2']);
    expect(capitalTargetsOf(g, sd)).toEqual([]);
    // a frigate 16 hexes away is out of its own range of 15, and in the cruiser's
    nb.pos = fromOffset(16, 30);
    expect(capitalDistance(mc, nb)).toBeGreaterThan(15);
    expect(capitalDistance(mc, nb)).toBeLessThanOrEqual(20);
    expect(capitalTargetsOf(g, nb)).toEqual([]);
    expect(capitalTargetsOf(g, mc).map((t) => t.id)).toEqual(['SD1-2']);
    nb.pos = fromOffset(16, 25);
    expect(capitalTargetsOf(g, nb).map((t) => t.id)).toEqual(['SD0-1']);
  });

  it('do not ask when every ship has a single target', () => {
    const g = battle();
    g.rules = { end: [] };
    g.destroyers!.find((d) => d.id === 'SD1-2')!.lost = 4;
    moveAll(g);
    // nobody had to pick: the game has gone on to the next game-turn (there are no fighters)
    expect(g.capitalTargets).toBeUndefined();
    expect(g.turn).toBe(2);
  });
});

describe('special weapons against capital ships', () => {
  it('take the body rating of the ship off the difficulty: 40 for a Star Destroyer, 25 for a Mon Calamari cruiser, 8 for a frigate', () => {
    const g = createGame(options({ specialWeapons: true, ships: [{ owner: 0, typeId: 'y-wing-1seat', quality: 'veteran' }, { owner: 1, typeId: 'star-destroyer', quality: 'average' }, { owner: 1, typeId: 'nebulon-b', quality: 'average' }] }));
    const ship = g.ships[0]!;
    ship.pos = fromOffset(16, 14);
    ship.facing = 3;
    const sd = g.destroyers![0]!;
    sd.pos = fromOffset(16, 17);
    const penalty = (d: typeof sd): number => previewDestroyerShot(g, ship, SPECIAL, d, d.pos!).parts.find((p) => /body rating/.test(p.label))!.value;
    expect(penalty(sd)).toBe(-40);
    sd.kind = 'mon-calamari';
    expect(penalty(sd)).toBe(-25);
    sd.kind = 'nebulon-b';
    expect(penalty(sd)).toBe(-8);
  });
});

describe('special weapons and the shields of a capital ship (Rules 22.35, 23.42, 23.48)', () => {
  /** A fighter fires both tubes of its torpedoes at the Star Destroyer from point-blank range; returns the structure points the Star Destroyer has lost. */
  const volley = (seed: number, lost: number): number => {
    const g = createGame(options({ seed, specialWeapons: true }));
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: fromOffset(16, 14), facing: 3 }] });
    ok(g, { type: 'place', player: 1, placements: [{ shipId: 'SD1-1', pos: fromOffset(16, 33), facing: 0 }] });
    const d = destroyerById(g, 'SD1-1')!;
    d.speed = 5;
    d.lost = lost;
    plansDone(g);
    ok(g, { type: 'moveDestroyer', player: 1, id: 'SD1-1', steps: FIVE });
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: SIX_AHEAD });
    if (g.ships[0]!.status !== 'active' || g.active?.stage !== 'fire') return -1;
    const before = d.lost;
    ok(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: SPECIAL, target: 'SD1-1', tubes: 2 }] });
    return d.lost - before;
  };

  it('can do nothing to an undamaged Star Destroyer: two torpedo dice less 6 shields are never 8 body points', () => {
    let fired = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const gained = volley(seed, 0);
      if (gained < 0) continue;
      fired++;
      expect(gained).toBe(0);
    }
    expect(fired).toBeGreaterThan(10);
  });

  it('can hurt one that has lost 6 structure points (no shields left)', () => {
    let hurt = 0;
    for (let seed = 1; seed <= 40; seed++) if (volley(seed, 6) > 0) hurt++;
    expect(hurt).toBeGreaterThan(0);
  });

  it('has the chance of a structure point by the dice less the shields', () => {
    expect(specialStructureChance(2, 6, 8)).toBe(0);
    expect(specialStructureChance(2, 0, 8)).toBeCloseTo(15 / 36);
    expect(specialStructureChance(2, 4, 8)).toBeCloseTo(1 / 36);
    expect(specialStructureChance(3, 6, 8)).toBeCloseTo(35 / 216);
  });
});

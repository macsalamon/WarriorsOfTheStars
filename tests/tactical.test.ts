import { describe, expect, it } from 'vitest';
import { playGame } from '../src/ai/player';
import { randomAi } from '../src/ai/random';
import { simpleAi } from '../src/ai/simple';
import { planFor, shipToMove, tacticalAi } from '../src/ai/tactical';
import {
  createGame,
  createRng,
  dogfightOptions,
  fromOffset,
  planShapeError,
  typeOf,
  type Command,
  type DogfightMix,
  type Facing,
  type GameState,
  type Hex,
  type PilotQuality,
} from '../src/engine';

interface Spec {
  typeId: string;
  owner: 0 | 1;
  at: Hex;
  facing: Facing;
  speed?: number;
  quality?: PilotQuality;
}

/** Ships dropped straight into the ship phase, with player 0 about to choose. */
function scene(specs: Spec[], seed = 1): GameState {
  const game = createGame({
    seed,
    ships: specs.map((s) => ({ owner: s.owner, typeId: s.typeId, quality: s.quality ?? 'average' })),
  });
  specs.forEach((s, i) => {
    const ship = game.ships[i]!;
    ship.pos = s.at;
    ship.facing = s.facing;
    if (s.speed !== undefined) ship.speed = s.speed;
  });
  game.phase = 'ships';
  game.turn = 2;
  game.initiative = 0;
  game.chooser = 0;
  return game;
}

const at = (col: number, row: number): Hex => fromOffset(col, row);
const mixes: DogfightMix[] = ['one', 'two', 'three', 'four'];

describe('choosing which ship moves (9)', () => {
  it('moves its own ship when that ship has a realistic attack', () => {
    // the X-wing is three hexes behind a TIE fighter that flies the same way, and one step takes it into range: an easy tail shot
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 23), facing: 0, speed: 1 },
      { typeId: 'tie-fighter', owner: 1, at: at(10, 20), facing: 0, speed: 1 },
    ]);
    g.ships[0]!.gunnerySkill = { dice: 6, pips: 0 };
    expect(shipToMove(g, 0).owner).toBe(0);
  });

  it('makes the opponent move first when it cannot attack and is in no danger', () => {
    // far apart and unarmed threats on both sides: nothing happens by moving first
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 40), facing: 0, speed: 3 },
      { typeId: 'x-wing', owner: 0, at: at(14, 40), facing: 0, speed: 3 },
      { typeId: 'tie-fighter', owner: 1, at: at(10, 5), facing: 3, speed: 3 },
      { typeId: 'tie-fighter', owner: 1, at: at(14, 5), facing: 3, speed: 3 },
    ]);
    expect(shipToMove(g, 0).owner).toBe(1);
  });

  it('does not hand the first move to an enemy ship that has a real shot if a safer one exists', () => {
    // TIE #1 sits right behind the X-wing's tail and can shoot it; TIE #2 is far away and harmless
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 30), facing: 3, speed: 1 },
      { typeId: 'tie-fighter', owner: 1, at: at(10, 28), facing: 3, speed: 1 },
      { typeId: 'tie-fighter', owner: 1, at: at(30, 2), facing: 0, speed: 1 },
    ]);
    g.ships[0]!.guns = [null]; // cannot attack, so the choice is only about whom to force
    g.ships[1]!.gunnerySkill = { dice: 8, pips: 0 };
    const picked = shipToMove(g, 0);
    expect(picked.id).not.toBe('P1-1');
  });
});

describe('planning', () => {
  it('always produces a plan the rules accept, for every ship in every mix', () => {
    for (const mix of mixes) {
      const g = createGame(dogfightOptions(mix, 3));
      // put the fleets in their set-up areas facing each other
      g.ships.forEach((s, i) => {
        s.pos = g.zones[s.owner][10 + i * 7]!;
        s.facing = s.owner === 0 ? 3 : 0;
      });
      g.phase = 'planning';
      for (const ship of g.ships) {
        const plan = planFor(g, ship);
        expect(planShapeError(plan, typeOf(ship).shields !== null)).toBeNull();
      }
    }
  });

  it('plans a half loop when it is the way to get back at a ship that has gone past', () => {
    // a fast interceptor with the enemy behind it and slipping away: turning round quickly is the whole game
    let loops = 0;
    let plans = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = scene([
        { typeId: 'tie-interceptor', owner: 0, at: at(15, 15), facing: 0, speed: 7, quality: 'veteran' },
        { typeId: 'x-wing', owner: 1, at: at(15, 19), facing: 3, speed: 5 },
      ], seed);
      g.phase = 'planning';
      const plan = planFor(g, g.ships[0]!, createRng(seed));
      plans += 1;
      if (plan.halfLoop > 0 || plan.overturn > 0) loops += 1;
    }
    expect(loops).toBe(plans); // it turns round one way or the other
  });
});

describe('tactical AI in whole games', () => {
  const run = (mix: DogfightMix, seed: number, rebels: 'tactical' | 'basic' | 'random', empire: 'tactical' | 'basic' | 'random', onCommand?: (c: Command) => void): GameState => {
    const game = createGame(dogfightOptions(mix, seed));
    const make = (kind: string, s: number) => (kind === 'tactical' ? tacticalAi(createRng(s)) : kind === 'basic' ? simpleAi(createRng(s)) : randomAi(createRng(s)));
    playGame(game, [make(rebels, seed * 31), make(empire, seed * 57)], { maxCommands: 8000, onCommand });
    return game;
  };

  it('plays complete games against itself without the engine rejecting anything', () => {
    for (const mix of mixes) {
      for (let seed = 1; seed <= 3; seed++) {
        const game = run(mix, seed, 'tactical', 'tactical');
        expect(game.phase).toBe('over');
      }
    }
  });

  it('beats the basic AI almost every time, from either side', () => {
    let wins = 0;
    let games = 0;
    for (const mix of mixes) {
      for (let seed = 1; seed <= 3; seed++) {
        games += 2;
        if (run(mix, seed, 'tactical', 'basic').winner === 0) wins += 1;
        if (run(mix, seed, 'basic', 'tactical').winner === 1) wins += 1;
      }
    }
    expect(wins / games).toBeGreaterThan(0.85);
  });

  it('takes shots, flies half loops and uses snap fire', () => {
    let shots = 0;
    let loops = 0;
    let snaps = 0;
    for (const mix of mixes) {
      for (let seed = 1; seed <= 3; seed++) {
        const game = run(mix, seed, 'tactical', 'tactical', (c) => {
          if (c.type === 'move' && c.steps.some((s) => s.kind === 'halfLoop')) loops += 1;
          if (c.type === 'move') snaps += c.steps.filter((s) => s.kind === 'snapFire').length;
        });
        shots += game.log.filter((e) => e.kind === 'fire').length;
      }
    }
    expect(shots).toBeGreaterThan(60);
    expect(loops).toBeGreaterThan(0);
    expect(snaps).toBeGreaterThan(5);
  });

  it('chooses an enemy ship to move a fair share of the time', () => {
    let enemy = 0;
    let own = 0;
    for (const mix of mixes) {
      run(mix, 2, 'tactical', 'tactical', (c) => {
        if (c.type !== 'chooseShip') return;
        // ship ids read "P<owner>-<number>"
        if (Number(c.shipId.charAt(1)) === c.player) own += 1;
        else enemy += 1;
      });
    }
    expect(enemy).toBeGreaterThan(0);
    expect(own).toBeGreaterThan(0);
  });

  it('records every wound, so the damage shown on a ship matches what it has suffered', () => {
    let hurt = 0;
    for (const mix of mixes) {
      const game = run(mix, 4, 'tactical', 'tactical');
      for (const ship of game.ships) {
        const bodyPoints = ship.wounds.filter((w) => w.kind === 'body').reduce((sum, w) => sum + Number.parseInt(w.text, 10), 0);
        expect(bodyPoints).toBe(ship.bodyDamage);
        const gunHits = ship.wounds.filter((w) => w.kind === 'gun').length;
        expect(gunHits).toBeGreaterThanOrEqual(typeOf(ship).pilotGuns.filter((code, i) => ship.guns[i] !== code).length);
        hurt += ship.wounds.length;
        // every wound is also tagged in the log, which is what lets the short log join them into one sentence
        expect(game.log.filter((e) => e.hurt?.shipId === ship.id).length).toBe(ship.wounds.length);
      }
    }
    expect(hurt).toBeGreaterThan(0);
  });

  it('keeps a structured record of every shot for the animations', () => {
    let shots = 0;
    for (const mix of mixes) {
      const game = run(mix, 6, 'tactical', 'tactical');
      for (const event of game.log.filter((e) => e.kind === 'fire')) {
        expect(event.shot).toBeDefined();
        expect(event.shot!.hit).toBe(event.text.endsWith('hit.'));
        expect(event.shot!.range).toBeGreaterThan(0);
        expect(event.shot!.range).toBeLessThanOrEqual(5);
        shots += 1;
      }
    }
    expect(shots).toBeGreaterThan(0);
  });

  it('is reproducible from a seed', () => {
    const a = run('two', 5, 'tactical', 'tactical');
    const b = run('two', 5, 'tactical', 'tactical');
    expect(a.log.map((e) => e.text)).toEqual(b.log.map((e) => e.text));
  });
});

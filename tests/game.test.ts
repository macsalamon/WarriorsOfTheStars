import { describe, expect, it } from 'vitest';
import { playRandomGame } from '../src/ai/random';
import {
  activeShips,
  applyCommand,
  createGame,
  createRng,
  dogfightOptions,
  getShip,
  type DogfightMix,
  type GameState,
} from '../src/engine';

function checkInvariants(game: GameState): void {
  for (const ship of game.ships) {
    const type = getShip(ship.typeId);
    if (game.phase === 'setup') continue;
    if (ship.status === 'active') {
      expect(ship.pos).not.toBeNull();
      expect(ship.speed).toBeGreaterThanOrEqual(0);
      expect(ship.speed).toBeLessThanOrEqual(type.speedMax + 2);
      expect(ship.bodyDamage).toBeLessThan(type.body[0]);
      expect(ship.shields.front).toBeGreaterThanOrEqual(0);
      expect(ship.shields.rear).toBeGreaterThanOrEqual(0);
    } else {
      expect(ship.pos).toBeNull();
    }
  }
}

describe('game setup', () => {
  it('builds the dogfight mixes with rolled pilot skills', () => {
    const game = createGame(dogfightOptions('one', 1));
    expect(game.ships.filter((s) => s.owner === 0)).toHaveLength(3);
    expect(game.ships.filter((s) => s.owner === 1)).toHaveLength(4);
    expect(game.vp).toEqual([1, 0]);
    for (const ship of game.ships) {
      expect(ship.pilotSkill.dice).toBeGreaterThanOrEqual(2);
      expect(ship.speed).toBe(Math.min(6, getShip(ship.typeId).speedMax));
    }
    expect(game.phase).toBe('setup');
  });

  it('splits shield markers between the front and rear boxes', () => {
    const game = createGame({ seed: 5, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    const x = game.ships[0]!;
    expect(x.shields).toEqual({ front: 1, rear: 1, left: 0, right: 0 });
  });

  it('rejects placement outside the set-up area', () => {
    const game = createGame(dogfightOptions('four', 3));
    const ship = game.ships.find((s) => s.owner === 0)!;
    const result = applyCommand(game, { type: 'place', player: 0, placements: [{ shipId: ship.id, pos: { q: 0, r: 0 }, facing: 0 }] });
    expect(result.ok).toBe(false);
  });

  it('is reproducible from a seed', () => {
    const a = createGame(dogfightOptions('two', 99));
    const b = createGame(dogfightOptions('two', 99));
    expect(a.ships.map((s) => s.pilotSkill)).toEqual(b.ships.map((s) => s.pilotSkill));
  });
});

describe('random games play to the end', () => {
  const mixes: DogfightMix[] = ['one', 'two', 'three', 'four'];
  for (const mix of mixes) {
    it(`mix ${mix}: 12 seeds finish without the engine rejecting a legal command`, () => {
      let finished = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const game = createGame(dogfightOptions(mix, seed));
        const rng = createRng(seed * 7919);
        playRandomGame(game, rng, {
          maxCommands: 4000,
          onCommand: () => checkInvariants(game),
        });
        if (game.phase === 'over') {
          finished += 1;
          expect(game.winner).not.toBeNull();
          expect(activeShips(game, 0).length === 0 || activeShips(game, 1).length === 0).toBe(true);
        }
      }
      expect(finished).toBeGreaterThan(2);
    });
  }
});

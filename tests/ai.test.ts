import { describe, expect, it } from 'vitest';
import { playGame, type Ai } from '../src/ai/player';
import { randomAi } from '../src/ai/random';
import { simpleAi } from '../src/ai/simple';
import {
  chanceAtLeast,
  createGame,
  createRng,
  dogfightOptions,
  type DogfightMix,
  type GameState,
} from '../src/engine';

const mixes: DogfightMix[] = ['one', 'two', 'three', 'four'];

function duel(mix: DogfightMix, seed: number, rebels: 'simple' | 'random', empire: 'simple' | 'random'): GameState {
  const game = createGame(dogfightOptions(mix, seed));
  const make = (kind: string, s: number): Ai => (kind === 'simple' ? simpleAi(createRng(s)) : randomAi(createRng(s)));
  playGame(game, [make(rebels, seed * 31), make(empire, seed * 57)], { maxCommands: 8000 });
  return game;
}

describe('chanceAtLeast', () => {
  it('is exact for small cases', () => {
    expect(chanceAtLeast({ dice: 1, pips: 0 }, 0, 4)).toBeCloseTo(3 / 6);
    expect(chanceAtLeast({ dice: 2, pips: 0 }, 0, 7)).toBeCloseTo(21 / 36);
    expect(chanceAtLeast({ dice: 2, pips: 1 }, 0, 13)).toBeCloseTo(1 / 36);
  });
  it('is certain at or below the minimum and impossible above the maximum', () => {
    expect(chanceAtLeast({ dice: 3, pips: 2 }, 0, 5)).toBeCloseTo(1);
    expect(chanceAtLeast({ dice: 3, pips: 2 }, 0, 21)).toBe(0);
  });
  it('removes dice for the multiple-gun penalty', () => {
    expect(chanceAtLeast({ dice: 3, pips: 0 }, 1, 12)).toBeCloseTo(1 / 36);
  });
});

describe('simple AI', () => {
  it('plays complete games against itself without the engine rejecting anything', () => {
    for (const mix of mixes) {
      for (let seed = 1; seed <= 4; seed++) {
        const game = duel(mix, seed, 'simple', 'simple');
        expect(game.phase).toBe('over');
        expect(game.winner).not.toBeNull();
      }
    }
  });

  it('keeps its ships on the map instead of flying away', () => {
    let escapes = 0;
    for (const mix of mixes) {
      for (let seed = 1; seed <= 4; seed++) {
        const game = duel(mix, seed, 'simple', 'simple');
        escapes += game.log.filter((e) => e.kind === 'escaped').length;
      }
    }
    expect(escapes).toBeLessThanOrEqual(2);
  });

  it('beats a random player nearly every time, from either side', () => {
    let wins = 0;
    let games = 0;
    for (const mix of mixes) {
      for (let seed = 1; seed <= 6; seed++) {
        const asRebels = duel(mix, seed, 'simple', 'random');
        const asEmpire = duel(mix, seed, 'random', 'simple');
        games += 2;
        if (asRebels.winner === 0) wins += 1;
        if (asEmpire.winner === 1) wins += 1;
      }
    }
    expect(wins / games).toBeGreaterThan(0.9);
  });

  it('is reproducible from a seed', () => {
    const a = duel('two', 7, 'simple', 'simple');
    const b = duel('two', 7, 'simple', 'simple');
    expect(a.log.map((e) => e.text)).toEqual(b.log.map((e) => e.text));
  });

  it('makes shots and scores kills in a normal game', () => {
    let fires = 0;
    let kills = 0;
    for (const mix of mixes) {
      const game = duel(mix, 3, 'simple', 'simple');
      fires += game.log.filter((e) => e.kind === 'fire').length;
      kills += game.log.filter((e) => e.kind === 'destroyed').length;
    }
    expect(fires).toBeGreaterThan(20);
    expect(kills).toBeGreaterThan(2);
  });
});

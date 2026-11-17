import { describe, expect, it } from 'vitest';
import { createGame, dogfightOptions } from '../src/engine';
import ships from '../data/ships.json';

describe('ship showcase', () => {
  it('puts every kind of ship on the Rebel side against one TIE fighter', () => {
    const game = createGame(dogfightOptions('showcase', 1));
    const kinds = Object.keys((ships as { ships: Record<string, unknown> }).ships);
    expect(game.ships.filter((s) => s.owner === 0).map((s) => s.typeId).sort()).toEqual([...kinds].sort());
    expect(game.ships.filter((s) => s.owner === 1).map((s) => s.typeId)).toEqual(['tie-fighter']);
  });
});

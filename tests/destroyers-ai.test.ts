import { describe, expect, it } from 'vitest';
import { STANDARD_MAP, createGame, createRng, scenarioOptions } from '../src/engine';
import { playGame } from '../src/ai/player';
import { tacticalAi } from '../src/ai/tactical';
import { simpleAi } from '../src/ai/simple';
import { randomAi } from '../src/ai/random';

describe('the computer players in the Star Destroyer scenarios', () => {
  for (const id of ['destroyers1', 'destroyers3', 'destroyers5', 'destroyers7', 'destroyers8']) {
    it(`finish ${id} with the tactical player`, () => {
      // on the static map a fighter that runs from the Star Destroyer for good leaves it: on the open map such a chase can go on for ever
      const g = createGame({ ...scenarioOptions(id, 5), map: { ...STANDARD_MAP, mode: 'static' } });
      playGame(g, [tacticalAi(createRng(5)), tacticalAi(createRng(6))], { maxCommands: 6000 });
      expect(g.phase).toBe('over');
    });
  }

  it('place the Star Destroyers inside the set-up area and move them every game-turn', () => {
    const g = createGame(scenarioOptions('destroyers2', 3));
    playGame(g, [simpleAi(createRng(1)), simpleAi(createRng(2))], { maxCommands: 40 });
    expect(g.destroyers!.every((d) => d.pos !== null)).toBe(true);
    expect(g.log.some((e) => /Star Destroyer.* moves to/.test(e.text))).toBe(true);
  });

  it('never give the engine an illegal command, even the random player', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const g = createGame(scenarioOptions('destroyers4', seed));
      expect(() => playGame(g, [randomAi(createRng(seed)), randomAi(createRng(seed + 10))], { maxCommands: 600 })).not.toThrow();
    }
  });
});

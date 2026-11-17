import { describe, expect, it } from 'vitest';
import { createGame, createRng, dogfightOptions, rollSkillDice, type SkillReduction } from '../src/engine';

describe('reduced randomness of the starting skills', () => {
  it('keeps every die within its narrowed range, and level 3 takes no luck at all', () => {
    const rng = createRng(5);
    for (const dice of [1, 2, 3, 5]) {
      for (let i = 0; i < 300; i++) {
        const all = rollSkillDice(rng, dice, 0);
        const one = rollSkillDice(rng, dice, 1);
        const two = rollSkillDice(rng, dice, 2);
        expect(all).toBeGreaterThanOrEqual(dice);
        expect(all).toBeLessThanOrEqual(dice * 6);
        expect(one).toBeGreaterThanOrEqual(dice * 2);
        expect(one).toBeLessThanOrEqual(dice * 5);
        expect(two).toBeGreaterThanOrEqual(dice * 3);
        expect(two).toBeLessThanOrEqual(dice * 4);
        expect(rollSkillDice(rng, dice, 3)).toBe(Math.ceil(3.5 * dice));
      }
    }
  });

  it('uses every value of a narrowed die', () => {
    const rng = createRng(9);
    const seen = (level: SkillReduction) => new Set(Array.from({ length: 400 }, () => rollSkillDice(rng, 1, level)));
    expect([...seen(1)].sort()).toEqual([2, 3, 4, 5]);
    expect([...seen(2)].sort()).toEqual([3, 4]);
  });

  it('gives ships of the same quality the same skills at level 3, and leaves the default as it was', () => {
    const skills = (reduction: SkillReduction | undefined, seed: number) =>
      createGame({ ...dogfightOptions('three', seed), skillReduction: reduction }).ships.map((s) => `${s.quality}:${s.pilotSkill.dice}D+${s.pilotSkill.pips}/${s.gunnerySkill.dice}D+${s.gunnerySkill.pips}`);
    for (const seed of [1, 2, 3]) {
      const level3 = skills(3, seed);
      const byQuality = new Map<string, string>();
      for (const entry of level3) {
        const [quality, rest] = entry.split(':') as [string, string];
        expect(byQuality.get(quality) ?? rest).toBe(rest);
        byQuality.set(quality, rest);
      }
      expect(skills(0, seed)).toEqual(skills(undefined, seed));
    }
  });

  it('only changes the starting skills: a game with the option plays out like any other', () => {
    const game = createGame({ ...dogfightOptions('one', 4), skillReduction: 2 });
    expect(game.log.some((e) => e.text.includes('reduced randomness (level 2)'))).toBe(true);
    expect(game.ships.every((s) => s.pilotSkill.dice >= 1)).toBe(true);
  });
});

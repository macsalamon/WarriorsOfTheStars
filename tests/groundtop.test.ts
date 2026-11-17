import { describe, expect, it } from 'vitest';
import { topRollBodyDamage } from '../src/engine';

describe('a roll of 14 or more against the ground target', () => {
  it('is the top column\'s body damage plus one for every point above 13, not a kill', () => {
    // the front line's top column gives 4 body damage (A+6, 2P, 4Bdy): only the body damage counts against the ground target
    expect(topRollBodyDamage(14)).toBe(5);
    expect(topRollBodyDamage(15)).toBe(6);
    expect(topRollBodyDamage(17)).toBe(8);
  });

  it('never brings the ground target down in one gun shot: a gun cannot reach a modified roll of 19', () => {
    // 2d6 is at most 12; the strongest gun power in the game is far below 7
    expect(topRollBodyDamage(12 + 6)).toBeLessThan(10);
  });
});

import { describe, expect, it } from 'vitest';
import {
  STANDARD_MAP,
  applyStepToPosition,
  canComplete,
  fromOffset,
  hexId,
  exceedsOpenLimits,
  isOnMap,
  isTrackerComplete,
  legalSteps,
  openMapSlack,
  startTracker,
  stepTracker,
  toOffset,
  withFeasibleObligations,
  type MoveContext,
  type MoveStep,
} from '../src/engine';

const ctx = (over: Partial<MoveContext>): MoveContext => ({
  speed: 6,
  turnNumber: 4,
  slipLevel: 0,
  loopLevel: 0,
  snapLevel: 0,
  slipRequired: false,
  loopsRequired: 0,
  ...over,
});

/** Run steps through the tracker; returns the final tracker or the index of the first illegal step. */
function run(c: MoveContext, steps: MoveStep[]) {
  let tr = startTracker(c);
  for (const [i, step] of steps.entries()) {
    const next = stepTracker(c, tr, step);
    if (!next) return { failedAt: i, tr };
    tr = next;
  }
  return { failedAt: -1, tr };
}

const legal = (c: MoveContext, steps: MoveStep[]) => {
  const r = run(c, steps);
  return r.failedAt === -1 && canComplete(c, r.tr) && isTrackerComplete(c, r.tr);
};

describe('forward movement and turning', () => {
  it('requires a ship to move its full speed', () => {
    const c = ctx({ speed: 3, turnNumber: 2 });
    expect(legal(c, ['forward', 'forward', 'forward'])).toBe(true);
    expect(legal(c, ['forward', 'forward'])).toBe(false);
  });

  it('only allows a turn after turn-number hexes', () => {
    const c = ctx({ speed: 6, turnNumber: 3 });
    expect(run(c, ['turnLeft']).failedAt).toBe(0);
    expect(run(c, ['forward', 'forward', 'turnLeft']).failedAt).toBe(2);
    expect(run(c, ['forward', 'forward', 'forward', 'turnLeft']).failedAt).toBe(-1);
  });

  it('needs another full turn number before the next turn', () => {
    const c = ctx({ speed: 8, turnNumber: 2 });
    expect(run(c, ['forward', 'forward', 'turnLeft', 'forward', 'turnRight']).failedAt).toBe(4);
    expect(legal(c, ['forward', 'forward', 'turnLeft', 'forward', 'forward', 'turnRight', 'forward', 'forward', 'forward', 'forward'])).toBe(true);
  });

  it('forbids turning when the turn number exceeds the speed', () => {
    const c = ctx({ speed: 3, turnNumber: 5 });
    expect(run(c, ['forward', 'forward', 'forward', 'turnLeft']).failedAt).toBe(3);
  });

  it('lets a turn number of 1/2 turn two hex sides per hex', () => {
    const c = ctx({ speed: 4, turnNumber: 0.5 });
    expect(run(c, ['forward', 'turnLeft', 'turnLeft']).failedAt).toBe(-1);
    expect(run(c, ['forward', 'turnLeft', 'turnLeft', 'turnLeft']).failedAt).toBe(3);
  });

  it('lets a ship at speed 0 turn freely', () => {
    const c = ctx({ speed: 0, turnNumber: 0 });
    expect(legalSteps(c, startTracker(c)).sort()).toEqual(['turnLeft', 'turnRight']);
    expect(run(c, ['turnLeft', 'turnLeft', 'turnRight', 'turnLeft']).failedAt).toBe(-1);
    expect(isTrackerComplete(c, startTracker(c))).toBe(true);
  });
});

describe('slips', () => {
  it('alternates a diagonal and a straight hex for a single slip', () => {
    const c = ctx({ speed: 4, turnNumber: 3, slipLevel: 1, slipRequired: true });
    expect(legal(c, ['slipRight', 'forward', 'slipRight', 'forward'])).toBe(true);
    expect(run(c, ['slipRight', 'slipRight']).failedAt).toBe(1); // two diagonals in a row is a double slip
  });

  it('moves diagonally every hex for a double slip', () => {
    const c = ctx({ speed: 4, turnNumber: 3, slipLevel: 2, slipRequired: true });
    expect(legal(c, ['slipLeft', 'slipLeft', 'slipLeft', 'slipLeft'])).toBe(true);
  });

  it('must continue a slip for at least the turn number', () => {
    const c = ctx({ speed: 6, turnNumber: 3, slipLevel: 2, slipRequired: true });
    // 2 slip hexes then straight forward: the slip stopped too soon
    expect(run(c, ['slipRight', 'slipRight', 'forward']).failedAt).toBe(2);
    expect(legal(c, ['slipRight', 'slipRight', 'slipRight', 'forward', 'forward', 'forward'])).toBe(true);
  });

  it('may mix forward hexes before and after the slip', () => {
    const c = ctx({ speed: 7, turnNumber: 3, slipLevel: 2, slipRequired: true });
    expect(legal(c, ['forward', 'forward', 'forward', 'forward', 'slipRight', 'slipRight', 'slipRight'])).toBe(true);
    expect(legal(c, ['slipRight', 'slipRight', 'slipRight', 'slipLeft', 'slipLeft', 'slipLeft', 'forward'])).toBe(true);
    // forward 5, slip 2 is not allowed
    expect(legal(c, ['forward', 'forward', 'forward', 'forward', 'forward', 'slipRight', 'slipRight'])).toBe(false);
  });

  it('forces a slip when the turn number is at least the speed', () => {
    const c = ctx({ speed: 3, turnNumber: 3, slipLevel: 2, slipRequired: true });
    expect(legal(c, ['slipRight', 'slipRight', 'slipRight'])).toBe(true);
    expect(legal(c, ['forward', 'forward', 'forward'])).toBe(false);
  });

  it('counts slipping as forward movement for turning', () => {
    const c = ctx({ speed: 7, turnNumber: 3, slipLevel: 2, slipRequired: true });
    expect(run(c, ['slipRight', 'slipRight', 'slipRight', 'turnLeft']).failedAt).toBe(-1);
  });

  it('requires a planned slip to happen at least once', () => {
    const c = ctx({ speed: 4, turnNumber: 2, slipLevel: 1, slipRequired: true });
    expect(legal(c, ['forward', 'forward', 'forward', 'forward'])).toBe(false);
  });
});

describe('half loops', () => {
  it('needs turn-number hexes of run-up and uses one hex of movement', () => {
    const c = ctx({ speed: 6, turnNumber: 4, loopLevel: 1, loopsRequired: 1 });
    expect(run(c, ['forward', 'forward', 'forward', 'halfLoop']).failedAt).toBe(3);
    // 4 forward + loop + 1 forward = speed 6
    expect(legal(c, ['forward', 'forward', 'forward', 'forward', 'halfLoop', 'forward'])).toBe(true);
    expect(legal(c, ['forward', 'forward', 'forward', 'forward', 'forward', 'forward'])).toBe(false);
  });

  it('is not possible when the turn number exceeds the speed', () => {
    const c = ctx({ speed: 3, turnNumber: 5, loopLevel: 1, loopsRequired: 1 });
    const { ctx: waived, waived: dropped } = withFeasibleObligations(c);
    expect(dropped).toEqual(['halfLoop']);
    expect(waived.loopsRequired).toBe(0);
  });

  it('requires two loops for a double half loop', () => {
    const c = ctx({ speed: 8, turnNumber: 2, loopLevel: 2, loopsRequired: 2 });
    // 2 + 2 + 2 forward hexes plus two loops uses all 8 hexes of movement
    expect(legal(c, ['forward', 'forward', 'halfLoop', 'forward', 'forward', 'halfLoop', 'forward', 'forward'])).toBe(true);
    // a single loop is not enough
    expect(legal(c, ['forward', 'forward', 'halfLoop', 'forward', 'forward', 'forward', 'forward', 'forward'])).toBe(false);
  });

  it('counts every forward hex toward the run-up, even with a turn in between', () => {
    const c = ctx({ speed: 7, turnNumber: 2, loopLevel: 1, loopsRequired: 1 });
    // 2 forward, turn, 1 forward = 3 hexes of run-up (at least 2), loop, then 3 more = 7
    expect(legal(c, ['forward', 'forward', 'turnLeft', 'forward', 'halfLoop', 'forward', 'forward', 'forward'])).toBe(true);
    // loop too early (only 1 hex of run-up)
    expect(run(c, ['forward', 'halfLoop']).failedAt).toBe(1);
  });

  it('gets waived rather than trapping a ship that must also slip', () => {
    const c = ctx({ speed: 2, turnNumber: 2, slipLevel: 2, slipRequired: true, loopLevel: 1, loopsRequired: 1 });
    const { waived } = withFeasibleObligations(c);
    expect(waived).toContain('halfLoop');
  });
});

describe('snap fire', () => {
  const c = ctx({ speed: 4, turnNumber: 2, snapLevel: 1 });
  it('cannot be taken from the first hex or the last hex of the move', () => {
    expect(run(c, ['snapFire']).failedAt).toBe(0);
    expect(legalSteps(c, run(c, ['forward', 'forward', 'forward', 'forward']).tr)).not.toContain('snapFire');
  });
  it('can be taken in the middle of the move', () => {
    expect(legal(c, ['forward', 'snapFire', 'forward', 'forward', 'forward'])).toBe(true);
  });
  it('cannot be planned and then taken when the move would end in the same hex', () => {
    expect(legal(c, ['forward', 'forward', 'forward', 'snapFire', 'forward'])).toBe(true);
  });
});

describe('position steps', () => {
  it('moves forward along the facing', () => {
    expect(applyStepToPosition({ q: 0, r: 0 }, 0, 'forward')).toEqual({ pos: { q: 0, r: -1 }, facing: 0 });
    expect(applyStepToPosition({ q: 0, r: 0 }, 2, 'forward').pos).toEqual({ q: 1, r: 0 });
  });
  it('slips diagonally without changing facing', () => {
    expect(applyStepToPosition({ q: 0, r: 0 }, 0, 'slipRight')).toEqual({ pos: { q: 1, r: -1 }, facing: 0 });
    expect(applyStepToPosition({ q: 0, r: 0 }, 0, 'slipLeft')).toEqual({ pos: { q: -1, r: 0 }, facing: 0 });
  });
  it('turns one hex side and half loops three', () => {
    expect(applyStepToPosition({ q: 0, r: 0 }, 5, 'turnRight').facing).toBe(0);
    expect(applyStepToPosition({ q: 0, r: 0 }, 0, 'turnLeft').facing).toBe(5);
    expect(applyStepToPosition({ q: 0, r: 0 }, 1, 'halfLoop').facing).toBe(4);
  });
});

describe('game-map geometry', () => {
  it('prints hex ids like the map (1000 to 4244)', () => {
    expect(hexId(fromOffset(0, 0))).toBe('1000');
    expect(hexId(fromOffset(1, 1))).toBe('1101');
    expect(hexId(fromOffset(32, 44))).toBe('4244');
  });
  it('round-trips offset coordinates', () => {
    for (const [col, row] of [[0, 0], [1, 5], [7, 12], [32, 44]] as const) {
      expect(toOffset(fromOffset(col, row))).toEqual({ col, row });
    }
  });
  it('knows which hexes are on the printed map (a static map has real edges)', () => {
    expect(isOnMap(STANDARD_MAP, fromOffset(0, 0))).toBe(true);
    expect(isOnMap(STANDARD_MAP, fromOffset(32, 44))).toBe(true);
    expect(isOnMap(STANDARD_MAP, fromOffset(33, 0))).toBe(false);
    expect(isOnMap(STANDARD_MAP, fromOffset(-1, 3))).toBe(false);
    expect(isOnMap(STANDARD_MAP, fromOffset(5, 45))).toBe(false);
    expect(isOnMap(STANDARD_MAP, fromOffset(5, -1))).toBe(false);
  });
  it('continues the hex numbering beyond the printed map', () => {
    expect(hexId(fromOffset(-1, 3))).toBe('0903');
    expect(hexId(fromOffset(40, 50))).toBe('5050');
    expect(hexId(fromOffset(-12, -2))).toBe('-02-02');
  });
});

describe('open map', () => {
  // The printed map is 33 x 45. A ship leaving it makes every counter shift back five hexes, which
  // is only possible while the fleet is at most 29 columns wide and 41 rows tall.
  it('allows any positions while the fleet fits', () => {
    expect(exceedsOpenLimits(STANDARD_MAP, [fromOffset(0, 0), fromOffset(28, 40)])).toBe(false);
    expect(exceedsOpenLimits(STANDARD_MAP, [fromOffset(-40, -40), fromOffset(-15, 0)])).toBe(false);
  });
  it('counts the extent, not the position', () => {
    expect(exceedsOpenLimits(STANDARD_MAP, [fromOffset(0, 0), fromOffset(29, 5)])).toBe(true); // 30 columns
    expect(exceedsOpenLimits(STANDARD_MAP, [fromOffset(5, 0), fromOffset(5, 41)])).toBe(true); // 42 rows
  });
  it('reports how much room is left', () => {
    expect(openMapSlack(STANDARD_MAP, [fromOffset(0, 0), fromOffset(20, 30)])).toBe(29 - 21);
    expect(openMapSlack(STANDARD_MAP, [])).toBe(Infinity);
  });
});

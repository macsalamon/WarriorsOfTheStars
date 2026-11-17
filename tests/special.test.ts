import { describe, expect, it } from 'vitest';
import { playRandomGame } from '../src/ai/random';
import { playGame } from '../src/ai/player';
import { tacticalAi } from '../src/ai/tactical';
import {
  SPECIAL,
  applyCommand,
  createGame,
  createRng,
  dogfightOptions,
  emptyPlan,
  endFireCrew,
  fromOffset,
  getShip,
  parseSpecial,
  previewSpecial,
  shipById,
  specialOf,
  specialReaches,
  specialToHit,
  targetsForSpecial,
  volleyOdds,
  type Command,
  type Facing,
  type GameState,
  type Ship,
} from '../src/engine';

interface Spec {
  typeId: string;
  owner: 0 | 1;
  col: number;
  row: number;
  facing: Facing;
  speed?: number;
}

/** A game with the special weapon rules on, in the Fire Segment of the first ship. */
function scene(specs: Spec[], seed = 1, specialWeapons = true): GameState {
  const game = createGame({ seed, specialWeapons, ships: specs.map((s) => ({ owner: s.owner, typeId: s.typeId, quality: 'average' as const })) });
  specs.forEach((s, i) => {
    const ship = game.ships[i]!;
    ship.pos = fromOffset(s.col, s.row);
    ship.facing = s.facing;
    ship.speed = s.speed ?? 3;
  });
  game.phase = 'ships';
  game.turn = 1;
  game.placed = [true, true];
  game.chooser = 0;
  game.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'fire', waived: [] };
  return game;
}

const get = (game: GameState, id: string): Ship => shipById(game, id)!;
const xwing = (extra: Partial<Spec> = {}): Spec => ({ typeId: 'x-wing', owner: 0, col: 10, row: 24, facing: 0, ...extra });
const tie = (row: number, extra: Partial<Spec> = {}): Spec => ({ typeId: 'tie-fighter', owner: 1, col: 10, row, facing: 3, ...extra });
const fire = (game: GameState, shots: Extract<Command, { type: 'fire' }>['shots']) => applyCommand(game, { type: 'fire', player: 0, shipId: 'P0-1', shots });

describe('what the ships carry', () => {
  it('reads the "Other Weapons" line of the chart', () => {
    expect(parseSpecial('2x 6PT')).toEqual({ kind: 'PT', tubes: 2, load: 6 });
    expect(specialOf(getShip('x-wing'))).toEqual({ kind: 'PT', tubes: 2, load: 6 });
    expect(specialOf(getShip('y-wing-1seat'))).toEqual({ kind: 'PT', tubes: 2, load: 8 });
    expect(specialOf(getShip('millennium-falcon'))).toEqual({ kind: 'CM', tubes: 2, load: 4 });
    expect(specialOf(getShip('tie-bomber'))).toEqual({ kind: 'CB', tubes: 1, load: 60 });
    expect(specialOf(getShip('tie-fighter'))).toBeNull();
  });

  it('gives ships their projectiles only when the rules are in effect', () => {
    const on = scene([xwing(), tie(12)]);
    const off = scene([xwing(), tie(12)], 1, false);
    expect(get(on, 'P0-1').projectiles).toBe(6);
    expect(get(on, 'P1-1').projectiles).toBeUndefined();
    expect(get(off, 'P0-1').projectiles).toBeUndefined();
    expect(fire(off, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]).ok).toBe(false);
  });

  it('has to-hit numbers from the chart, and bombs only at range 1', () => {
    expect(specialToHit('PT', 1)).toBe(21);
    expect(specialToHit('PT', 8)).toBe(38);
    expect(specialToHit('CM', 3)).toBe(26);
    expect(specialToHit('CB', 1)).toBe(30);
    expect(specialToHit('CB', 2)).toBeNull();
  });
});

describe('reaching a target', () => {
  it('reaches ten hexes ahead in the forward centre arc, not behind or beyond', () => {
    const from = fromOffset(10, 24);
    expect(specialReaches('PT', from, 0, fromOffset(10, 14))).toBe(true);
    expect(specialReaches('PT', from, 0, fromOffset(10, 13))).toBe(false);
    expect(specialReaches('PT', from, 0, fromOffset(10, 30))).toBe(false);
    expect(specialReaches('PT', from, 0, fromOffset(16, 24))).toBe(false);
    expect(specialReaches('PT', from, 0, from)).toBe(false);
    expect(specialReaches('CB', from, 0, from)).toBe(true);
    expect(specialReaches('CB', from, 0, fromOffset(10, 23))).toBe(false);
  });

  it('lists the enemy ships in reach', () => {
    const g = scene([xwing(), tie(16), tie(8), { ...tie(18), owner: 0, typeId: 'a-wing' }]);
    expect(targetsForSpecial(g, get(g, 'P0-1')).map((s) => s.id)).toEqual(['P1-1']);
  });
});

describe('the difficulty of a shot', () => {
  it('is the weapon\'s number and the usual modifiers, less the target\'s body rating, and pinpoint fire does nothing', () => {
    const g = scene([xwing(), tie(18)]);
    get(g, 'P0-1').plan = { ...emptyPlan(), pinpointFire: 1 };
    const p = previewSpecial(g, get(g, 'P0-1'), get(g, 'P1-1'));
    expect(p.range).toBe(6);
    expect(p.gun).toBe('PT');
    // PT at range 6-10 is 38; head-on speeds 3 + 3; the TIE fighter's body rating is 3 (standard game)
    expect(p.difficulty).toBe(38 + 6 - 3);
    expect(p.parts.some((x) => /pinpoint/i.test(x.label))).toBe(false);
    expect(p.parts.at(-1)).toEqual({ label: "Target's body rating (3)", value: -3 });
    expect(p.power).toBe(2);
  });

  it('uses the second body rating when the damage rules are on', () => {
    const g = createGame({ seed: 1, specialWeapons: true, damageRules: true, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    g.ships[0]!.pos = fromOffset(10, 24);
    g.ships[1]!.pos = fromOffset(10, 18);
    g.ships[1]!.facing = 3;
    expect(previewSpecial(g, g.ships[0]!, g.ships[1]!).parts.at(-1)!.value).toBe(-2);
  });
});

describe('firing tubes', () => {
  it('fires one or two tubes at one target, each using up a projectile', () => {
    const g = scene([xwing(), tie(18)]);
    expect(fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 2 }]).ok).toBe(true);
    expect(get(g, 'P0-1').projectiles).toBe(4);
    expect(g.log.filter((e) => e.kind === 'fire' && /PT/.test(e.text))).toHaveLength(2);
  });

  it('refuses more tubes than the ship has, or than it has projectiles for', () => {
    const g = scene([xwing(), tie(18)]);
    expect(fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 3 }]).ok).toBe(false);
    get(g, 'P0-1').projectiles = 1;
    expect(fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 2 }]).ok).toBe(false);
    expect(fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]).ok).toBe(true);
    expect(get(g, 'P0-1').projectiles).toBe(0);
  });

  it('cannot fire when no projectile is left', () => {
    const g = scene([xwing(), tie(18)]);
    get(g, 'P0-1').projectiles = 0;
    expect(fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]).ok).toBe(false);
    expect(targetsForSpecial(g, get(g, 'P0-1'))).toEqual([]);
  });

  it('refuses a target out of the arc or out of range, and a ship that turned in its last hex', () => {
    const far = scene([xwing(), tie(8)]);
    expect(fire(far, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]).ok).toBe(false);
    const g = scene([xwing(), tie(18)]);
    get(g, 'P0-1').turnedInLastHex = true;
    const r = fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]);
    expect(r.ok).toBe(false);
    expect(targetsForSpecial(g, get(g, 'P0-1'))).toEqual([]);
  });

  it('can be fired when every gun is gone, and the Fire Segment still comes', () => {
    const g = scene([xwing(), tie(18)]);
    get(g, 'P0-1').guns = get(g, 'P0-1').guns.map(() => null);
    expect(endFireCrew(get(g, 'P0-1'))).toEqual(['pilot']);
    expect(fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]).ok).toBe(true);
  });

  it('can be fired together with the guns', () => {
    const g = scene([xwing(), tie(21)]);
    const r = fire(g, [{ gun: 0, target: 'P1-1' }, { gun: SPECIAL, target: 'P1-1', tubes: 1 }]);
    expect(r.ok).toBe(true);
    expect(g.log.filter((e) => e.kind === 'fire')).toHaveLength(2);
  });

  it('is the pilot\'s: a gunner may not fire it', () => {
    const g = createGame({ seed: 1, specialWeapons: true, ships: [{ owner: 0, typeId: 'y-wing-2seat', quality: 'average', gunners: ['average'] }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    g.ships[0]!.pos = fromOffset(10, 24);
    g.ships[1]!.pos = fromOffset(10, 18);
    g.ships[1]!.facing = 3;
    g.phase = 'ships';
    g.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'fire', waived: [] };
    expect(fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 1, crew: 'gunner1' }]).ok).toBe(false);
  });

  it('counts all the tubes as one weapon for the skill dice', () => {
    const g = scene([xwing(), tie(21)]);
    const ship = get(g, 'P0-1');
    const alone = volleyOdds(g, ship, [{ gun: SPECIAL, target: 'P1-1', tubes: 2 }])[0]!.chance;
    const withGun = volleyOdds(g, ship, [{ gun: 0, target: 'P1-1' }, { gun: SPECIAL, target: 'P1-1', tubes: 2 }])[1]!.chance;
    expect(withGun).toBeLessThan(alone);
  });
});

describe('hits', () => {
  it('do their dice of damage less the shields, as body points, over many rolls', () => {
    let hits = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = scene([xwing(), { ...tie(22), typeId: 'x-wing' }], seed);
      // a shielded target close by: PT at range 2 needs 23
      const target = get(g, 'P1-1');
      const before = target.bodyDamage;
      const shields = target.shields.front;
      const r = fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 2 }]);
      expect(r.ok).toBe(true);
      const damaged = g.log.filter((e) => e.kind === 'damageRoll').map((e) => /: (\d+) body point/.exec(e.text)![1]).map(Number);
      const rolls = g.log.filter((e) => e.kind === 'damageRoll').map((e) => /= (\d+)/.exec(e.text)![1]).map(Number);
      hits += damaged.length;
      rolls.forEach((sum, i) => {
        expect(sum).toBeGreaterThanOrEqual(2);
        expect(sum).toBeLessThanOrEqual(12);
        expect(damaged[i]).toBe(Math.max(0, sum - shields));
      });
      if (target.status === 'active') expect(target.bodyDamage - before).toBe(damaged.reduce((a, b) => a + b, 0));
    }
    expect(hits).toBeGreaterThan(5);
  });

  it('give a victory point for each hit that hurts a ship that survives', () => {
    let seen = false;
    for (let seed = 1; seed <= 200 && !seen; seed++) {
      // both ships slow and flying the same way, so that the shot is not hopeless
      const g = scene([xwing({ speed: 0 }), { ...tie(22), typeId: 'a-wing', facing: 0, speed: 0 }], seed);
      const target = get(g, 'P1-1');
      target.shields.front = 0;
      target.shields.rear = 0;
      fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 2 }]);
      if (target.status === 'active' && target.bodyDamage > 0) {
        expect(g.vp[0]).toBeGreaterThanOrEqual(1);
        seen = true;
      }
    }
    expect(seen).toBe(true);
  });
});

describe('bombs', () => {
  it('only hit a target that is not moving, in the same hex', () => {
    const base: Spec[] = [{ typeId: 'tie-bomber', owner: 0, col: 10, row: 20, facing: 0 }, { typeId: 'x-wing', owner: 1, col: 10, row: 20, facing: 3, speed: 0 }];
    const g = scene(base);
    expect(get(g, 'P0-1').projectiles).toBe(60);
    expect(fire(g, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]).ok).toBe(true);
    expect(get(g, 'P0-1').projectiles).toBe(59);
    const moving = scene([base[0]!, { ...base[1]!, speed: 2 }]);
    expect(fire(moving, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]).ok).toBe(false);
    const apart = scene([base[0]!, { ...base[1]!, row: 19, speed: 0 }]);
    expect(fire(apart, [{ gun: SPECIAL, target: 'P1-1', tubes: 1 }]).ok).toBe(false);
  });
});

describe('whole games with the rules in effect', () => {
  const MIXES = ['one', 'two', 'three', 'four', 'showcase'] as const;

  it('random play never makes the engine reject a command, and fires missiles and torpedoes', () => {
    let fired = 0;
    for (const mix of MIXES) {
      for (let seed = 1; seed <= 3; seed++) {
        const g = createGame({ ...dogfightOptions(mix, seed), specialWeapons: true });
        playRandomGame(g, createRng(seed * 31), {
          maxCommands: 2500,
          onCommand: (cmd: Command) => {
            if (cmd.type === 'fire') fired += cmd.shots.filter((s) => s.gun === SPECIAL).length;
          },
        });
        for (const ship of g.ships) if (ship.projectiles !== undefined) expect(ship.projectiles).toBeGreaterThanOrEqual(0);
      }
    }
    expect(fired).toBeGreaterThan(0);
  }, 180000);

  it('the tactical computer plays whole games and fires its torpedoes with care', () => {
    let fired = 0;
    let carried = 0;
    let left = 0;
    for (const mix of ['one', 'three', 'showcase'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const g = createGame({ ...dogfightOptions(mix, seed), specialWeapons: true });
        playGame(g, [tacticalAi(createRng(seed)), tacticalAi(createRng(seed * 11))], { maxCommands: 8000 });
        expect(g.phase).toBe('over');
        fired += g.log.filter((e) => e.kind === 'fire' && /fires a (PT|CM|CB)|snap-fires a (PT|CM|CB)/.test(e.text)).length;
        for (const ship of g.ships) {
          const weapon = specialOf(getShip(ship.typeId));
          if (weapon) {
            carried += weapon.load;
            left += ship.projectiles ?? 0;
          }
        }
      }
    }
    expect(fired).toBeGreaterThan(0);
    // it does not waste them all: some are left at the end of a game
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(carried);
  }, 180000);
});

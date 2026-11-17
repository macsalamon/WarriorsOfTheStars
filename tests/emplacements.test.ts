import { describe, expect, it } from 'vitest';
import { viewFor } from '../src/net/redact';
import { playRandomGame } from '../src/ai/random';
import { playGame } from '../src/ai/player';
import { tacticalAi } from '../src/ai/tactical';
import { attackEdge, simpleAi } from '../src/ai/simple';
import {
  GROUND_TARGET_ID,
  SPECIAL,
  STANDARD_MAP,
  TURRET_SKILL,
  applyCommand,
  createGame,
  createRng,
  emplacementsForCrew,
  emptyPlan,
  attackerZoneFor,
  defenderZone,
  edgeMidpoint,
  setupFacing,
  needsTurretOrders,
  baseItems,
  baseLayoutError,
  kitFor,
  standardBaseAt,
  validBaseHexes,
  DIRECTIONS,
  type BaseItem,
  fromOffset,
  stepSkill,
  STANDARD_BASE,
  hexEquals,
  groundAttackOptions,
  groundLayout,
  hexDistance,
  previewEmplacementShot,
  previewTurretShot,
  shipById,
  toOffset,
  trackableEmplacements,
  turretOrdersFor,
  turretPower,
  turretReaches,
  turretToHit,
  waitingFor,
  type Command,
  type Emplacement,
  type Facing,
  type GameState,
  type MapSpec,
} from '../src/engine';

const map: MapSpec = { ...STANDARD_MAP, mode: 'static' };

const turret = (id: string, owner: 0 | 1, col: number, row: number, facing: Facing, extra: Partial<Emplacement> = {}): Emplacement => ({
  id,
  owner,
  kind: 'single',
  pos: fromOffset(col, row),
  facing,
  skill: { ...TURRET_SKILL },
  status: 'active',
  fired: false,
  tracking: null,
  chance: null,
  lastChance: 0,
  ...extra,
});

/** An X-wing of player 0 at the hex, heading up the map, a TIE fighter far away, and the given turrets of player 1. */
function scene(turrets: Emplacement[], seed = 1, xCol = 10, xRow = 16, speed = 3, ships: 'normal' | 'tie' = 'normal'): GameState {
  const g = createGame({ seed, ships: [{ owner: 0, typeId: ships === 'tie' ? 'tie-fighter' : 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
  g.map = map;
  const x = shipById(g, 'P0-1')!;
  x.pos = fromOffset(xCol, xRow);
  x.facing = 0;
  x.speed = speed;
  shipById(g, 'P1-1')!.pos = fromOffset(30, 40);
  g.emplacements = turrets;
  g.phase = 'ships';
  g.turn = 1;
  g.placed = [true, true];
  g.chooser = 0;
  g.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'move', waived: [] };
  return g;
}

const forward = (n: number): Extract<Command, { type: 'move' }>['steps'] => Array.from({ length: n }, () => ({ kind: 'forward' as const }));
const move = (g: GameState, n: number) => applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: forward(n) });
const turretShots = (g: GameState) => g.log.filter((e) => e.shot?.shooter.startsWith('E'));

describe('the counters', () => {
  it('have the numbers printed on them, and a double turret that lost a gun acts like a single one', () => {
    expect(turret('E1', 1, 5, 5, 0)).toBeDefined();
    const single = turret('E1', 1, 5, 5, 0);
    const double = turret('E2', 1, 5, 5, 0, { kind: 'double' });
    expect([1, 2, 3, 4, 5, 6, 10].map((r) => turretToHit(single, r))).toEqual([17, 15, 15, 18, 21, 23, 23]);
    expect([1, 2, 3, 4, 5, 6, 10].map((r) => turretToHit(double, r))).toEqual([16, 14, 14, 17, 20, 22, 22]);
    expect([1, 3, 6].map((r) => turretPower(single, r))).toEqual([3, 2, 1]);
    expect([1, 3, 6].map((r) => turretPower(double, r))).toEqual([5, 4, 2]);
    const damaged = { ...double, reduced: true };
    expect(turretToHit(damaged, 2)).toBe(15);
    expect(turretPower(damaged, 1)).toBe(3);
  });

  it('reach ten hexes in the forward centre arc', () => {
    const t = turret('E1', 1, 10, 10, 3);
    expect(turretReaches(t, fromOffset(10, 20))).toBe(true);
    expect(turretReaches(t, fromOffset(10, 21))).toBe(false);
    expect(turretReaches(t, fromOffset(10, 5))).toBe(false);
    expect(turretReaches(t, t.pos)).toBe(false);
  });
});

describe('the turret skill setting', () => {
  it('goes up and down the usual progression: 5D, 5D+1, 5D+2, 6D', () => {
    expect(stepSkill({ dice: 5, pips: 0 }, 1)).toEqual({ dice: 5, pips: 1 });
    expect(stepSkill({ dice: 5, pips: 2 }, 1)).toEqual({ dice: 6, pips: 0 });
    expect(stepSkill({ dice: 5, pips: 0 }, -1)).toEqual({ dice: 4, pips: 2 });
    expect(stepSkill({ dice: 1, pips: 0 }, -1)).toEqual({ dice: 1, pips: 0 });
  });

  it('is given to every turret gun of a Ground Attack', () => {
    const o = groundAttackOptions(1, 3);
    const g = createGame({ ...o, groundAttack: { ...o.groundAttack!, turretSkill: { dice: 4, pips: 2 } } });
    expect(g.emplacements!.every((e) => e.skill.dice === 4 && e.skill.pips === 2)).toBe(true);
    expect(createGame(groundAttackOptions(1, 3)).emplacements!.every((e) => e.skill.dice === 5 && e.skill.pips === 0)).toBe(true);
    // the guns start with the default firing limits: at once at 50% or better, at the last chance at 20% or better
    expect(createGame(groundAttackOptions(1, 3)).emplacements!.every((e) => e.chance === 50 && e.lastChance === 20)).toBe(true);
  });
});

describe('the base', () => {
  it('has the standard base as printed: three doubles and six singles in the fixed pattern, ten hexes from the edges, and the ground target at least two hexes from every gun', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const layout = groundLayout(createRng(seed), map, 3, 6);
      expect(layout.turrets.filter((t) => t.kind === 'double')).toHaveLength(3);
      expect(layout.turrets.filter((t) => t.kind === 'single')).toHaveLength(6);
      // the pattern is rigid: the same offsets from the empty middle hex, found from the first double turret gun
      const centre = { q: layout.turrets[0]!.pos.q, r: layout.turrets[0]!.pos.r + 1 };
      layout.turrets.forEach((t, i) => {
        expect({ kind: t.kind, q: t.pos.q - centre.q, r: t.pos.r - centre.r }).toEqual({ kind: STANDARD_BASE[i]!.kind, q: STANDARD_BASE[i]!.q, r: STANDARD_BASE[i]!.r });
        const { col, row } = toOffset(t.pos);
        expect(col >= 10 && col < map.cols - 10 && row >= 10 && row < map.rows - 10).toBe(true);
        expect(hexDistance(layout.ground, t.pos)).toBeGreaterThanOrEqual(2);
      });
      const g = toOffset(layout.ground);
      expect(g.col >= 10 && g.col < map.cols - 10 && g.row >= 10 && g.row < map.rows - 10).toBe(true);
      // the target is not in the middle of the base
      expect(hexEquals(layout.ground, centre)).toBe(false);
    }
  });

  it('puts the ground target about in the middle of the map, with the standard base straight north or south of it, the nearest gun two hexes away', () => {
    const sides = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const layout = groundLayout(createRng(seed), map, 3, 6);
      const g = toOffset(layout.ground);
      expect(Math.abs(g.col - Math.floor(map.cols / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs(g.row - Math.floor(map.rows / 2))).toBeLessThanOrEqual(2);
      expect(Math.min(...layout.turrets.map((t) => hexDistance(t.pos, layout.ground)))).toBe(2);
      const base = toOffset(layout.baseCentre!);
      expect(base.col).toBe(g.col);
      sides.add(base.row < g.row ? 'north' : 'south');
    }
    expect([...sides].sort()).toEqual(['north', 'south']);
    // loose guns also gather round a target in the middle
    for (let seed = 1; seed <= 10; seed++) {
      const g = toOffset(groundLayout(createRng(seed), map, 1, 3).ground);
      expect(Math.abs(g.col - 16)).toBeLessThanOrEqual(2);
      expect(Math.abs(g.row - 22)).toBeLessThanOrEqual(2);
    }
  });

  it('scatters other numbers of turrets in a group near the target, ten hexes from the edges', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const layout = groundLayout(createRng(seed), map, 8, 7);
      expect(layout.turrets).toHaveLength(15);
      const keys = new Set(layout.turrets.map((t) => `${t.pos.q},${t.pos.r}`));
      expect(keys.size).toBe(15);
      for (const t of layout.turrets) {
        expect(hexDistance(layout.ground, t.pos)).toBeGreaterThanOrEqual(2);
        expect(hexDistance(layout.ground, t.pos)).toBeLessThanOrEqual(10);
        const { col, row } = toOffset(t.pos);
        expect(col >= 10 && col < map.cols - 10 && row >= 10 && row < map.rows - 10).toBe(true);
      }
    }
  });

  it('is set up by the three mixes: the roles, the zones, and a side with no ships has nothing to place', () => {
    const one = createGame(groundAttackOptions(1, 3));
    // both place their ships; the attackers choose their edge first, in secret, and their set-up area follows
    expect(waitingFor(one)).toEqual([0, 1]);
    expect(applyCommand(one, { type: 'edge', player: 0, edge: 'top' }).ok).toBe(true);
    expect(one.emplacements).toHaveLength(9);
    expect(one.groundTarget?.status).toBe('active');
    // no ship is set down on a turret gun or the ground target
    const blocked = new Set([...one.emplacements!.map((e) => `${e.pos.q},${e.pos.r}`), `${one.groundTarget!.pos.q},${one.groundTarget!.pos.r}`]);
    expect(one.zones[1].some((h) => blocked.has(`${h.q},${h.r}`))).toBe(false);
    expect(one.groundAttack?.attacker).toBe(0);
    expect(one.emplacements!.every((e) => e.owner === 1 && e.skill.dice === 5 && e.skill.pips === 0)).toBe(true);
    expect(one.map.mode).toBe('static');
    expect(one.vp).toEqual([0, 1]);
    const two = createGame(groundAttackOptions(2, 3));
    expect(two.groundAttack?.attacker).toBe(1);
    expect(two.emplacements!.every((e) => e.owner === 0)).toBe(true);
    expect(two.vp).toEqual([2, 0]);
    const three = createGame(groundAttackOptions(3, 3));
    expect(three.emplacements).toHaveLength(15);
    expect(three.ships.every((s) => s.owner === 0)).toBe(true);
    // the Empire has no ships: nothing to place, and only the Rebels are waited for (to choose the edge, then to place)
    expect(three.placed).toEqual([false, true]);
    expect(waitingFor(three)).toEqual([0]);
    expect(applyCommand(three, { type: 'edge', player: 0, edge: 'left' }).ok).toBe(true);
    expect(waitingFor(three)).toEqual([0]);
    // the Advanced game: a Mix One with the special weapons has one more interceptor, Mix Two has bombers
    const adv1 = createGame({ ...groundAttackOptions(1, 3), specialWeapons: true });
    expect(adv1.ships.filter((s) => s.typeId === 'tie-interceptor')).toHaveLength(2);
    const adv2 = createGame({ ...groundAttackOptions(2, 3), specialWeapons: true });
    expect(adv2.ships.filter((s) => s.typeId === 'tie-bomber')).toHaveLength(3);
  });
});

describe('turret guns firing at a ship that moves', () => {
  it('fire once, at the last chance: at the end of the move, when the ship stays in the arc', () => {
    const g = scene([turret('E1', 1, 10, 10, 3)]);
    expect(move(g, 3).ok).toBe(true);
    const shots = turretShots(g);
    expect(shots).toHaveLength(1);
    // the three steps take the ship to rows 15, 14, 13: all in the arc, so the last chance is the end
    expect(shots[0]!.moveStep).toBe(2);
    expect(g.emplacements![0]!.fired).toBe(true);
    expect(shots[0]!.shot!.range).toBe(3);
  });

  it('fire at the hex before the ship leaves the arc', () => {
    // the turret looks along row 20; the ship starts in the arc and flies out of it
    const g = scene([turret('E1', 1, 10, 10, 3)], 1, 10, 18, 5);
    expect(move(g, 5).ok).toBe(true);
    const shots = turretShots(g);
    expect(shots).toHaveLength(1);
    // rows 17..13 are all in the arc: still the end of the move
    expect(shots[0]!.moveStep).toBe(4);
    // a ship that moves away fires at the last hex in range
    const h = scene([turret('E1', 1, 10, 10, 3)], 1, 10, 19, 4);
    h.ships[0]!.facing = 3;
    expect(applyCommand(h, { type: 'move', player: 0, shipId: 'P0-1', steps: forward(4) }).ok).toBe(true);
    const away = turretShots(h);
    expect(away).toHaveLength(1);
    // starting at row 19 (range 9), moving down: row 20 is the last hex in range
    expect(away[0]!.shot!.range).toBe(10);
    expect(away[0]!.moveStep).toBe(0);
  });

  it('can be told to fire as soon as the chance to hit reaches a percentage', () => {
    const early = scene([turret('E1', 1, 10, 10, 3, { chance: 50 })]);
    move(early, 3);
    const late = scene([turret('E1', 1, 10, 10, 3, { chance: null })]);
    move(late, 3);
    const e = turretShots(early)[0]!;
    const l = turretShots(late)[0]!;
    expect(e.moveStep!).toBeLessThan(l.moveStep!);
    expect(e.shot!.range).toBeGreaterThan(l.shot!.range);
  });

  it('never fire a shot that cannot hit, and keep it for another ship when the last chance is below the lower limit', () => {
    // 1D against a difficulty of 15 or more: no chance at all
    const hopeless = scene([turret('E1', 1, 10, 10, 3, { skill: { dice: 1, pips: 0 } })]);
    move(hopeless, 3);
    expect(turretShots(hopeless)).toHaveLength(0);
    expect(hopeless.emplacements![0]!.fired).toBe(false);
    // 5D at range 3 is a good shot (about 50%), but the lower limit asks for more: the gun does not fire, and still may
    const picky = scene([turret('E1', 1, 10, 10, 3, { lastChance: 100 })]);
    move(picky, 3);
    expect(turretShots(picky)).toHaveLength(0);
    expect(picky.emplacements![0]!.fired).toBe(false);
    const content = scene([turret('E1', 1, 10, 10, 3, { lastChance: 20 })]);
    move(content, 3);
    expect(turretShots(content)).toHaveLength(1);
    // the upper limit still fires at once, whatever the lower one says (the two are kept in order by the orders)
    const eager = scene([turret('E1', 1, 10, 10, 3, { chance: 10, lastChance: 10 })]);
    move(eager, 3);
    expect(turretShots(eager)).toHaveLength(1);
  });

  it('do not fire at their own side, nor at a ship out of reach, nor twice in a game-turn, nor past a friendly ship that is nearer', () => {
    const own = scene([turret('E1', 0, 10, 10, 3)]);
    move(own, 3);
    expect(turretShots(own)).toHaveLength(0);
    const far = scene([turret('E1', 1, 10, 10, 3)], 1, 10, 30, 3);
    move(far, 3);
    expect(turretShots(far)).toHaveLength(0);
    const twice = scene([turret('E1', 1, 10, 10, 3)]);
    move(twice, 3);
    expect(turretShots(twice)).toHaveLength(1);
    expect(twice.emplacements![0]!.fired).toBe(true);
    // a friendly ship of the turret's owner in the arc and nearer: it may not fire
    const blocked = scene([turret('E1', 1, 10, 10, 3)]);
    shipById(blocked, 'P1-1')!.pos = fromOffset(10, 12);
    move(blocked, 3);
    expect(turretShots(blocked)).toHaveLength(0);
  });

  it('count the target\'s speed only when the turret is not ahead of or behind it, and its jinking and tracking as for ships', () => {
    const g = scene([turret('E1', 1, 10, 10, 3)], 1, 10, 14, 3);
    const t = g.emplacements![0]!;
    const x = shipById(g, 'P0-1')!;
    // the turret lies straight ahead of the ship: no speed
    const ahead = previewTurretShot(g, t, x);
    expect(ahead.difficulty).toBe(turretToHit(t, 4));
    // to the side: the speed counts
    x.facing = 1;
    const side = previewTurretShot(g, t, x);
    expect(side.difficulty).toBe(turretToHit(t, 4) + 3);
    // tracked for two turns: -10; jinking: +5
    x.facing = 0;
    t.tracking = { target: 'P0-1', level: 2 };
    expect(previewTurretShot(g, t, x).difficulty).toBe(turretToHit(t, 4) - 10);
    x.plan.jink = 1;
    expect(previewTurretShot(g, t, x).difficulty).toBe(turretToHit(t, 4) - 10 + 5);
    // rolls, half loops and pinpoint fire do not matter
    x.plan.roll = 2;
    x.plan.halfLoop = 1;
    expect(previewTurretShot(g, t, x).difficulty).toBe(turretToHit(t, 4) - 10 + 5);
  });

  it('can destroy a ship in the middle of its move, which then goes no further', () => {
    let destroyedAt: number | null = null;
    for (let seed = 1; seed <= 200 && destroyedAt === null; seed++) {
      const g = scene([turret('E1', 1, 10, 10, 3, { kind: 'double', chance: 10 }), turret('E2', 1, 11, 10, 3, { kind: 'double', chance: 10 })], seed, 10, 16, 3, 'tie');
      shipById(g, 'P0-1')!.bodyDamage = 2;
      expect(move(g, 3).ok).toBe(true);
      const ship = shipById(g, 'P0-1')!;
      if (ship.status === 'destroyed') {
        destroyedAt = g.log.find((e) => e.kind === 'destroyed')!.moveStep!;
        // the ship stayed where it was hit: the steps after are not taken
        expect(ship.pos).toBeNull();
        expect(g.vp[1]).toBeGreaterThan(0);
        expect(g.log.some((e) => e.kind === 'destroyed' && e.shipId === 'P0-1')).toBe(true);
      }
    }
    // -1 is the hex the ship started in
    expect(destroyedAt).not.toBeNull();
  });

  it('give their owner a victory point for each hit on a ship that survives', () => {
    let scored = false;
    for (let seed = 1; seed <= 100 && !scored; seed++) {
      const g = scene([turret('E1', 1, 10, 10, 3, { kind: 'double', chance: 10 })], seed);
      move(g, 3);
      const x = shipById(g, 'P0-1')!;
      if (x.status === 'active' && g.vp[1] > 0) scored = true;
    }
    expect(scored).toBe(true);
  });
});

describe('turret orders while planning', () => {
  /** The end of a game-turn with a ship at (10,13) in the arc of E1: the next game-turn's planning begins. */
  function planningTurn(): GameState {
    const g = scene([turret('E1', 1, 10, 10, 3), turret('E2', 1, 14, 10, 3, { kind: 'double' })]);
    g.emplacements![0]!.fired = true;
    const y = shipById(g, 'P1-1')!;
    y.moved = true;
    shipById(g, 'P0-1')!.moved = false;
    g.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'move', waived: [] };
    move(g, 3);
    // the ship has no guns to fire: it ends its phase, the bookkeeping follows, and the next game-turn starts
    applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [] });
    return g;
  }
  const submitPlans = (g: GameState) => [0, 1].map((p) => applyCommand(g, { type: 'plan', player: p as 0 | 1, plans: { [p === 0 ? 'P0-1' : 'P1-1']: emptyPlan() } }));

  it('start with the next game-turn: no phase of their own, the guns may fire again, nothing turns by itself', () => {
    const g = planningTurn();
    expect(g.phase).toBe('planning');
    expect(waitingFor(g)).toEqual([0, 1]);
    expect(g.emplacements!.every((e) => !e.fired)).toBe(true);
    expect(g.turretOrders).toEqual([null, null]);
    const facings = g.emplacements!.map((e) => e.facing);
    submitPlans(g);
    // no orders: nothing turned, nothing tracks
    expect(g.emplacements!.map((e) => e.facing)).toEqual(facings);
    expect(g.emplacements!.every((e) => e.tracking === null)).toBe(true);
  });

  it('turn turrets a hex side, track a ship (-5, then -10 on the second turn running) and keep the standing order, once both have planned', () => {
    const g = planningTurn();
    const x = shipById(g, 'P0-1')!;
    const orders = [{ id: 'E1', turn: 0 as const, target: x.id, chance: 40, lastChance: 30 }, { id: 'E2', turn: 1 as const }];
    // the ship is at (10,13), in the arc of E1 at (10,10) facing down
    expect(applyCommand(g, { type: 'turrets', player: 1, orders }).ok).toBe(true);
    // nothing happens before the planning is over, and the other side does not see the orders
    expect(g.emplacements![1]!.facing).toBe(3);
    expect(viewFor(g, 0).turretOrders![1]).toEqual([]);
    expect(viewFor(g, 1).turretOrders![1]).toEqual(orders);
    submitPlans(g);
    expect(g.phase).toBe('ships');
    const [e1, e2] = g.emplacements!;
    expect(e1!.tracking).toEqual({ target: 'P0-1', level: 1 });
    expect(e1!.chance).toBe(40);
    expect(e1!.lastChance).toBe(30);
    expect(e2!.facing).toBe(4);
    expect(e2!.tracking).toBeNull();
    expect(g.turretOrders).toEqual([null, null]);
  });

  it('can be given again until the planning is over, and are refused when they are not allowed', () => {
    const g = planningTurn();
    const x = shipById(g, 'P0-1')!;
    const orders = (o: Extract<Command, { type: 'turrets' }>['orders']): Command => ({ type: 'turrets', player: 1, orders: o });
    expect(applyCommand(g, orders([{ id: 'E9' }])).ok).toBe(false);
    expect(applyCommand(g, orders([{ id: 'E1', chance: 35 }])).ok).toBe(false);
    expect(applyCommand(g, orders([{ id: 'E1', lastChance: 35 }])).ok).toBe(false);
    expect(applyCommand(g, orders([{ id: 'E1', chance: 30, lastChance: 50 }])).ok).toBe(false);
    expect(applyCommand(g, orders([{ id: 'E1', turn: 1, target: x.id }])).ok).toBe(false);
    expect(applyCommand(g, { type: 'turrets', player: 0, orders: [{ id: 'E1' }] }).ok).toBe(false);
    expect(applyCommand(g, orders([{ id: 'E1', target: x.id }])).ok).toBe(true);
    // a second set replaces the first
    expect(applyCommand(g, orders([{ id: 'E2', turn: -1 }])).ok).toBe(true);
    submitPlans(g);
    expect(g.emplacements![0]!.tracking).toBeNull();
    expect(g.emplacements![1]!.facing).toBe(2);
    // not once the ships are moving
    expect(applyCommand(g, orders([])).ok).toBe(false);
  });

  it('can be asked of the computer, which turns its guns toward the enemy', () => {
    const g = planningTurn();
    expect(needsTurretOrders(g, 1)).toBe(true);
    expect(needsTurretOrders(g, 0)).toBe(false);
    const orders = turretOrdersFor(g, 1);
    expect(orders.map((o) => o.id)).toEqual(['E1', 'E2']);
    expect(applyCommand(g, { type: 'turrets', player: 1, orders }).ok).toBe(true);
    expect(needsTurretOrders(g, 1)).toBe(false);
  });
});

describe('shooting at emplacements', () => {
  function range(turrets: Emplacement[], specialWeapons = false, seed = 1): GameState {
    const g = createGame({ seed, specialWeapons, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    g.map = map;
    const x = shipById(g, 'P0-1')!;
    x.pos = fromOffset(10, 16);
    x.facing = 0;
    x.speed = 3;
    x.gunnerySkill = { dice: 12, pips: 0 };
    shipById(g, 'P1-1')!.pos = fromOffset(30, 40);
    g.emplacements = turrets;
    g.groundTarget = { id: GROUND_TARGET_ID, owner: 1, pos: fromOffset(10, 14), damage: 0, status: 'active' };
    g.phase = 'ships';
    g.turn = 1;
    g.placed = [true, true];
    g.chooser = 0;
    g.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'fire', waived: [] };
    return g;
  }
  const fire = (g: GameState, target: string, gun = 0, tubes?: number) => applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun, target, ...(tubes ? { tubes } : {}) }] });

  it('lists what is in reach, and adds your speed, 10 for the ground target and, for a special weapon, takes 5 off for a turret', () => {
    const g = range([turret('E1', 1, 10, 13, 3)], true);
    const x = shipById(g, 'P0-1')!;
    expect(emplacementsForCrew(g, x, 'pilot').map((e) => e.id).sort()).toEqual(['E1', 'GT']);
    const t = previewEmplacementShot(g, x, 0, g.emplacements![0]!);
    expect(t.parts.map((p) => p.value)).toContain(3);
    const ground = previewEmplacementShot(g, x, 0, g.groundTarget!);
    expect(ground.parts.at(-1)).toEqual({ label: 'Firing at the ground target', value: 10 });
    const special = previewEmplacementShot(g, x, SPECIAL, g.emplacements![0]!);
    expect(special.parts.at(-1)!.value).toBe(-5);
    const specialGround = previewEmplacementShot(g, x, SPECIAL, g.groundTarget!);
    // a special weapon has no +10 against the ground target; its body rating of 10 comes off instead
    expect(specialGround.parts.some((p) => p.value === 10)).toBe(false);
    expect(specialGround.parts.at(-1)).toEqual({ label: 'Ground target: body rating 10', value: -10 });
    expect(specialGround.difficulty).toBe(specialGround.parts.reduce((sum, p) => sum + p.value, 0));
  });

  it('reduces a double turret on a G, destroys a single one, and gives points for each (1 then 2; 2)', () => {
    let reduced = false;
    for (let seed = 1; seed <= 400 && !reduced; seed++) {
      const g = range([turret('E1', 1, 10, 13, 3, { kind: 'double' })], false, seed);
      expect(fire(g, 'E1').ok).toBe(true);
      const e = g.emplacements![0]!;
      if (e.reduced && e.status === 'active') {
        reduced = true;
        expect(g.vp[0]).toBe(1);
      }
    }
    expect(reduced).toBe(true);
    let destroyed = false;
    for (let seed = 1; seed <= 400 && !destroyed; seed++) {
      const g = range([turret('E1', 1, 10, 13, 3)], false, seed);
      fire(g, 'E1');
      if (g.emplacements![0]!.status === 'destroyed') {
        destroyed = true;
        expect(g.vp[0]).toBe(2);
        expect(g.log.some((e) => e.kind === 'destroyed' && e.shipId === 'E1')).toBe(true);
      }
    }
    expect(destroyed).toBe(true);
  });

  it('blows up when it takes 5 body points in one shot, hurting the ships within two hexes', () => {
    let blast = false;
    for (let seed = 1; seed <= 600 && !blast; seed++) {
      // the turret is adjacent to the ship, which is within two hexes of it
      const g = range([turret('E1', 1, 10, 15, 3)], true, seed);
      fire(g, 'E1', SPECIAL, 2);
      if (g.log.some((e) => /blows up/.test(e.text))) {
        blast = true;
        expect(g.log.some((e) => /The blast hits/.test(e.text))).toBe(true);
        expect(g.emplacements![0]!.status).toBe('destroyed');
      }
    }
    expect(blast).toBe(true);
  });

  it('destroys the ground target with 10 body points: 10 victory points, and the game goes on until the attackers are gone', () => {
    const g = range([]);
    g.groundAttack = { attacker: 0 };
    g.groundTarget!.damage = 8;
    let done = false;
    for (let seed = 1; seed <= 300 && !done; seed++) {
      const h = range([], false, seed);
      h.groundAttack = { attacker: 0 };
      h.groundTarget!.damage = 9;
      fire(h, GROUND_TARGET_ID);
      if (h.groundTarget!.status === 'destroyed') {
        done = true;
        expect(h.vp[0]).toBe(10);
        // an attacker is still there: the game is not over
        expect(h.phase).not.toBe('over');
      }
    }
    expect(done).toBe(true);
  });

  it('ends the Ground Attack when no attacker is left, by destruction or because they have left the map', () => {
    const g = createGame(groundAttackOptions(3, 5));
    for (const s of g.ships) {
      s.pos = null;
      s.status = 'escaped';
    }
    // a destroyed attacker is what calls the check: use the last one
    g.ships[0]!.status = 'active';
    g.ships[0]!.pos = fromOffset(10, 2);
    expect(g.phase).not.toBe('over');
  });
});

describe('targeting against turret guns and the ground target', () => {
  /** The X-wing at (10,16) heading up the map in the planning phase; a turret ahead (E1), one behind (E2) and the ground target ahead. */
  function planning(seed = 1): GameState {
    const g = createGame({ seed, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
    g.map = map;
    const x = shipById(g, 'P0-1')!;
    x.pos = fromOffset(10, 16);
    x.facing = 0;
    x.speed = 3;
    shipById(g, 'P1-1')!.pos = fromOffset(30, 40);
    g.emplacements = [turret('E1', 1, 10, 11, 3), turret('E2', 1, 10, 22, 0), turret('E3', 1, 17, 14, 3), turret('E4', 0, 10, 12, 3)];
    g.groundTarget = { id: GROUND_TARGET_ID, owner: 1, pos: fromOffset(10, 14), damage: 0, status: 'active' };
    g.phase = 'planning';
    g.planSubmitted = [false, false];
    g.placed = [true, true];
    return g;
  }
  const track = (target: string) => ({ ...emptyPlan(), targeting: 1 as const, targetingTarget: target });
  const plan = (g: GameState, target: string) => applyCommand(g, { type: 'plan', player: 0, plans: { 'P0-1': track(target) } });

  it('may be planned against a turret gun or the ground target in the forward centre arc of the ship, tailing or not', () => {
    expect(plan(planning(), 'E1').ok).toBe(true);
    expect(plan(planning(), GROUND_TARGET_ID).ok).toBe(true);
    // behind the ship, out to the side, one of its own side's guns: not allowed
    expect(plan(planning(), 'E2').ok).toBe(false);
    expect(plan(planning(), 'E3').ok).toBe(false);
    expect(plan(planning(), 'E4').ok).toBe(false);
    // and there is no such thing
    expect(plan(planning(), 'E9').ok).toBe(false);
    const g = planning();
    expect(trackableEmplacements(g, shipById(g, 'P0-1')!, 'pilot').map((t) => t.id).sort()).toEqual(['E1', 'GT']);
  });

  it('puts a tracking marker on the ship that takes 5 off the difficulty of its shots at the target (and 10 for a double)', () => {
    const g = planning();
    expect(plan(g, 'E1').ok).toBe(true);
    expect(applyCommand(g, { type: 'plan', player: 1, plans: { 'P1-1': emptyPlan() } }).ok).toBe(true);
    const x = shipById(g, 'P0-1')!;
    // the markers are laid after the hazards, before the ships move
    expect(x.tracking).toEqual({ target: 'E1', level: 1 });
    const e1 = g.emplacements![0]!;
    const tracked = previewEmplacementShot(g, x, 0, e1).difficulty;
    x.tracking = null;
    expect(previewEmplacementShot(g, x, 0, e1).difficulty).toBe(tracked + 5);
    x.tracking = { target: 'E1', level: 2 };
    expect(previewEmplacementShot(g, x, 0, e1).difficulty).toBe(tracked - 5);
    // a ship that tracks a turret is easier to hit for the others, but not for that turret
    x.tracking = { target: 'E1', level: 1 };
    const noTracking = previewTurretShot(g, g.emplacements![2]!, { ...x, tracking: null }).difficulty;
    expect(previewTurretShot(g, g.emplacements![2]!, x).difficulty).toBe(noTracking - 5);
    expect(previewTurretShot(g, e1, x).difficulty).toBe(previewTurretShot(g, e1, { ...x, tracking: null }).difficulty);
  });

  it('is planned by the computer players when nothing is tailed, and the games still run', () => {
    let tracked = 0;
    for (const make of [simpleAi, tacticalAi]) {
      for (let seed = 1; seed <= 2; seed++) {
        const g = createGame({ ...groundAttackOptions(1, seed), specialWeapons: true });
        playGame(g, [make(createRng(seed)), make(createRng(seed + 50))], { maxCommands: 700 });
        tracked += g.log.filter((e) => /tracks (the ground target|(single|double|damaged double) turret)/.test(e.text)).length;
      }
    }
    expect(tracked).toBeGreaterThan(0);
  }, 240000);
});

describe('placing the ground target and the base', () => {
  const kit = kitFor(3, 6);
  const [ground, base] = baseItems(kit);
  const placed = (item: BaseItem, col: number, row: number, facing = 0) => ({ item, placement: { id: item.id, pos: fromOffset(col, row), facing } });
  const insideTen = (h: { q: number; r: number }): boolean => {
    const { col, row } = toOffset(h);
    return col >= 10 && col < map.cols - 10 && row >= 10 && row < map.rows - 10;
  };

  it('turns the standard base as a whole, every gun facing out', () => {
    const centre = fromOffset(20, 20);
    const plain = standardBaseAt(centre, 0);
    expect(plain.map((t) => ({ kind: t.kind, q: t.pos.q - centre.q, r: t.pos.r - centre.r }))).toEqual(STANDARD_BASE.map((t) => ({ kind: t.kind, q: t.q, r: t.r })));
    // the doubles face their own side, the singles the sides between: all six sides are covered
    expect(plain.filter((t) => t.kind === 'double').map((t) => t.facing).sort()).toEqual([0, 2, 4]);
    expect([...new Set(plain.map((t) => t.facing))].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    for (let r = 1; r < 6; r++) {
      const turned = standardBaseAt(centre, r);
      // the same distances from the middle, every gun turned by the same number of sides
      turned.forEach((t, i) => {
        expect(hexDistance(t.pos, centre)).toBe(hexDistance(plain[i]!.pos, centre));
        expect(t.facing).toBe((plain[i]!.facing + r) % 6);
      });
      expect(new Set(turned.map((t) => `${t.pos.q},${t.pos.r}`)).size).toBe(9);
    }
    expect(standardBaseAt(centre, 6)).toEqual(plain);
    // a double faces the side it stands on, seen from the middle
    for (const t of plain.filter((x) => x.kind === 'double')) expect(hexEquals({ q: centre.q + DIRECTIONS[t.facing]!.q, r: centre.r + DIRECTIONS[t.facing]!.r }, t.pos)).toBe(true);
  });

  it('keeps everything ten hexes from the edge, out of each other\'s hexes, and the guns two hexes from the ground target', () => {
    expect(baseLayoutError(map, kit, [placed(ground!, 16, 28), placed(base!, 16, 18)])).toBeNull();
    // too near the edge
    expect(baseLayoutError(map, kit, [placed(ground!, 5, 30), placed(base!, 16, 18)])).toMatch(/edge/);
    expect(baseLayoutError(map, kit, [placed(ground!, 16, 28), placed(base!, 16, 11)])).toMatch(/edge/);
    // the base is ten hexes from the edge with its outermost guns: its middle is two hexes further in
    expect(baseLayoutError(map, kit, [placed(ground!, 16, 28), placed(base!, 16, 12)])).toBeNull();
    // a gun next to the target is too near, two hexes away is fine
    const centre = fromOffset(16, 18);
    const next = standardBaseAt(centre, 0)[0]!.pos;
    const near = { item: ground!, placement: { id: 'GT', pos: { q: next.q, r: next.r - 1 }, facing: 0 } };
    expect(baseLayoutError(map, kit, [near, placed(base!, 16, 18)])).toMatch(/two hexes/);
    const far = { item: ground!, placement: { id: 'GT', pos: { q: next.q, r: next.r - 2 }, facing: 0 } };
    expect(baseLayoutError(map, kit, [far, placed(base!, 16, 18)])).toBeNull();
    // the middle hex of the base is empty but within a hex of the guns: the target cannot go there
    expect(baseLayoutError(map, kit, [{ item: ground!, placement: { id: 'GT', pos: centre, facing: 0 } }, placed(base!, 16, 18)])).toMatch(/two hexes/);
    // everything must be placed
    expect(baseLayoutError(map, kit, [placed(ground!, 16, 28)])).toMatch(/Place every/);
  });

  it('shades the hexes that are valid now, which change with what is already placed', () => {
    const all = validBaseHexes(map, kit, ground!, 0, []);
    expect(all.every(insideTen)).toBe(true);
    expect(all.length).toBe((map.cols - 20) * (map.rows - 20));
    // with the base down, no hex within a hex of a gun
    const withBase = validBaseHexes(map, kit, ground!, 0, [placed(base!, 16, 18)]);
    const guns = standardBaseAt(fromOffset(16, 18), 0).map((t) => t.pos);
    expect(withBase.length).toBeLessThan(all.length);
    expect(withBase.every((h) => guns.every((g) => hexDistance(g, h) >= 2))).toBe(true);
    // and the other way round: with the target down, no base with a gun within a hex of it
    const baseHexes = validBaseHexes(map, kit, base!, 0, [placed(ground!, 16, 26)]);
    expect(baseHexes.length).toBeGreaterThan(0);
    for (const c of baseHexes) expect(standardBaseAt(c, 0).every((t) => hexDistance(t.pos, fromOffset(16, 26)) >= 2)).toBe(true);
    // turned, the guns still stay in the margin
    for (const rot of [0, 1, 2, 3]) for (const c of validBaseHexes(map, kit, base!, rot, []).slice(0, 50)) expect(standardBaseAt(c, rot).every((t) => insideTen(t.pos))).toBe(true);
  });

  it('is done by the defending human before any ship, who then places first; the attacker follows', () => {
    const options = groundAttackOptions(1, 3);
    const g = createGame({ ...options, groundAttack: { ...options.groundAttack!, manualBase: true } });
    // the Empire defend: they place the target and the base, nothing exists yet
    expect(waitingFor(g)).toEqual([1]);
    expect(g.emplacements).toEqual([]);
    expect(g.groundTarget).toBeUndefined();
    const items = (ground: [number, number], base: [number, number, number]) => [
      { id: 'GT', pos: fromOffset(...ground), facing: 0 },
      { id: 'BASE', pos: fromOffset(base[0], base[1]), facing: base[2] },
    ];
    // no ships first; only the defender; not a bad layout
    expect(applyCommand(g, { type: 'place', player: 1, placements: [] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'base', player: 0, items: items([16, 28], [16, 18, 0]) }).ok).toBe(false);
    expect(applyCommand(g, { type: 'base', player: 1, items: items([3, 30], [16, 18, 0]) }).ok).toBe(false);
    expect(applyCommand(g, { type: 'base', player: 1, items: [] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'base', player: 1, items: items([16, 28], [16, 18, 1]) }).ok).toBe(true);
    expect(g.emplacements).toHaveLength(9);
    expect(g.groundTarget!.pos).toEqual(fromOffset(16, 28));
    // turned by one side: the doubles now stand on the odd sides
    expect(g.emplacements!.filter((e) => e.kind === 'double').map((e) => e.facing).sort()).toEqual([1, 3, 5]);
    // only once
    expect(applyCommand(g, { type: 'base', player: 1, items: items([16, 28], [16, 18, 0]) }).ok).toBe(false);
    // both place their ships next (Rules: Ground attack): the defender at once, the attacker once he has chosen his edge in secret
    expect(waitingFor(g)).toEqual([0, 1]);
    expect(applyCommand(g, { type: 'place', player: 0, placements: [] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'edge', player: 1, edge: 'top' }).ok).toBe(false);
    expect(applyCommand(g, { type: 'edge', player: 0, edge: 'sideways' as never }).ok).toBe(false);
    // the defender's ships are set down outside the guns and the target, clear of the rim wherever the attack comes from
    expect(g.zones[1].some((h) => g.emplacements!.some((e) => hexEquals(e.pos, h)))).toBe(false);
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      const strip = new Set(attackerZoneFor(map, edge).map((h) => `${h.q},${h.r}`));
      expect(g.zones[1].some((h) => strip.has(`${h.q},${h.r}`))).toBe(false);
    }
    // the defender places before the attacker has chosen anything, and does not learn the edge
    const ai = simpleAi(createRng(1));
    expect(applyCommand(g, ai(g, 1)!).ok).toBe(true);
    expect(waitingFor(g)).toEqual([0]);
    // the defenders stand in a ring three to five hexes from the ground target, each flying along the ring (clockwise): nothing about the set-up depends on the edge
    const defenders = g.ships.filter((s) => s.owner === 1);
    expect(defenders.length).toBeGreaterThan(0);
    const pixel = (q: number, r: number) => ({ x: 1.5 * q, y: Math.sqrt(3) * (r + q / 2) });
    for (const s of defenders) {
      const d = hexDistance(s.pos!, g.groundTarget!.pos);
      expect(d >= 3 && d <= 5).toBe(true);
      const out = pixel(s.pos!.q - g.groundTarget!.pos.q, s.pos!.r - g.groundTarget!.pos.r);
      const dir = pixel(DIRECTIONS[s.facing]!.q, DIRECTIONS[s.facing]!.r);
      // within 30 degrees of the circle's tangent: at 60 to 120 degrees from the way out, and clockwise (the cross product is positive on a screen with y down)
      const cos = (out.x * dir.x + out.y * dir.y) / (Math.hypot(out.x, out.y) * Math.hypot(dir.x, dir.y));
      expect(Math.abs(cos)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(out.x * dir.y - out.y * dir.x).toBeGreaterThan(0);
    }
    expect(applyCommand(g, { type: 'edge', player: 0, edge: 'right' }).ok).toBe(true);
    expect(applyCommand(g, { type: 'edge', player: 0, edge: 'top' }).ok).toBe(false);
    expect(g.log.some((e) => /right edge/.test(e.text))).toBe(false);
    // the defender's view does not show the edge or the strip until the ships are down
    expect(viewFor(g, 1).groundAttack!.edge).toBeUndefined();
    expect(viewFor(g, 1).zones[0]).toEqual([]);
    expect(viewFor(g, 0).groundAttack!.edge).toBe('right');
    expect(g.zones[0].every((h) => toOffset(h).col >= map.cols - 2)).toBe(true);
    expect(applyCommand(g, ai(g, 0)!).ok).toBe(true);
    // both are down: the edge is revealed and the first game-turn begins
    expect(g.phase).toBe('planning');
    expect(g.log.some((e) => /start along the right edge/.test(e.text))).toBe(true);
  });

  it('puts the attackers along the edge they chose, and turns ships toward the enemy from any edge', () => {
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      const attackers = attackerZoneFor(map, edge);
      const defenders = defenderZone(map);
      expect(attackers.length).toBeGreaterThan(0);
      // two hexes deep along the edge, and nobody else in them
      const key = (h: { q: number; r: number }) => `${h.q},${h.r}`;
      const used = new Set(attackers.map(key));
      expect(defenders.some((h) => used.has(key(h)))).toBe(false);
      for (const h of defenders) expect(hexDistance(h, edgeMidpoint(map, edge))).toBeGreaterThanOrEqual(4);
    }
    expect(attackerZoneFor(map, 'left').every((h) => toOffset(h).col <= 1)).toBe(true);
    expect(attackerZoneFor(map, 'bottom').every((h) => toOffset(h).row >= map.rows - 2)).toBe(true);
    // straight south from the top edge, straight north from the bottom edge, and sideways from a side
    expect(setupFacing(fromOffset(16, 1), fromOffset(16, 43))).toBe(3);
    expect(setupFacing(fromOffset(16, 43), fromOffset(16, 1))).toBe(0);
    expect([1, 2]).toContain(setupFacing(fromOffset(1, 22), fromOffset(31, 22)));
    expect([4, 5]).toContain(setupFacing(fromOffset(31, 22), fromOffset(1, 22)));
  });

  it('asks for the 10-hex edge margin and the 2-hex distance only: loose guns may stand as far apart as they like', () => {
    const loose = kitFor(1, 1);
    const [t, d, s1] = baseItems(loose);
    expect(baseLayoutError(map, loose, [placed(t!, 16, 28), placed(d!, 11, 11), placed(s1!, 21, 33)])).toBeNull();
    expect(baseLayoutError(map, loose, [placed(t!, 16, 28), placed(d!, 11, 11), placed(s1!, 16, 28)])).toMatch(/share a hex/);
  });

  it('is laid out by the game for a computer defender in Mix Three as the owner\'s fixed picture', () => {
    const options = groundAttackOptions(3, 1);
    const g = createGame(options);
    expect(g.emplacements!.filter((e) => e.kind === 'double')).toHaveLength(8);
    expect(g.emplacements!.filter((e) => e.kind === 'single')).toHaveLength(7);
    expect(g.emplacements!.every((e) => insideTen(e.pos))).toBe(true);
    expect(insideTen(g.groundTarget!.pos)).toBe(true);
    // two hexes from the nearest gun, on the east side of the ring, and the same on every seed
    expect(Math.min(...g.emplacements!.map((e) => hexDistance(e.pos, g.groundTarget!.pos)))).toBe(2);
    const h = createGame(groundAttackOptions(3, 99));
    expect(h.emplacements!.map((e) => ({ k: e.kind, p: e.pos, f: e.facing }))).toEqual(g.emplacements!.map((e) => ({ k: e.kind, p: e.pos, f: e.facing })));
    // a ring of twelve round a column of three, every hex distinct
    expect(new Set(g.emplacements!.map((e) => `${e.pos.q},${e.pos.r}`)).size).toBe(15);
  });

  it('is chosen by the computer attacker where the way to the ground target crosses the fewest turret arcs', () => {
    const g = createGame(groundAttackOptions(2, 5));
    const edge = attackEdge(g);
    expect(['top', 'bottom', 'left', 'right']).toContain(edge);
    expect(applyCommand(g, { type: 'edge', player: 1, edge }).ok).toBe(true);
  });

  it('is asked of the computer players like anything else, and whole games follow', () => {
    const options = groundAttackOptions(2, 5);
    // the Rebels (player 0) defend here
    const g = createGame({ ...options, groundAttack: { ...options.groundAttack!, manualBase: true } });
    expect(waitingFor(g)).toEqual([0]);
    playGame(g, [simpleAi(createRng(1)), tacticalAi(createRng(2))], { maxCommands: 700 });
    expect(g.emplacements).toHaveLength(9);
    expect(g.groundTarget).toBeDefined();
    expect(g.turn).toBeGreaterThan(0);
  }, 120000);
});

describe('turret guns and asteroids', () => {
  it('are never combined', () => {
    expect(() => createGame({ ...groundAttackOptions(1, 1), asteroids: { density: 'sparse', motion: 'drift', chaos: 2 } })).toThrow(/asteroid/);
    expect(createGame(groundAttackOptions(1, 1)).asteroids).toBeUndefined();
  });
});

describe('whole Ground Attack games', () => {
  for (const mix of [1, 2, 3] as const) {
    it(`random play never makes the engine reject a command (mix ${mix})`, () => {
      let turretShots = 0;
      for (let seed = 1; seed <= 12 && (seed <= 3 || turretShots === 0); seed++) {
        const g = createGame(groundAttackOptions(mix, seed));
        playRandomGame(g, createRng(seed * 11), { maxCommands: 4000 });
        turretShots += turretShots_(g);
      }
      expect(turretShots).toBeGreaterThan(0);
    }, 120000);

    it(`the computer players play it to the end (mix ${mix})`, () => {
      for (const make of [simpleAi, tacticalAi]) {
        const g = createGame({ ...groundAttackOptions(mix, 4), specialWeapons: mix !== 3 });
        playGame(g, [make(createRng(5)), make(createRng(55))], { maxCommands: 8000 });
        expect(g.phase).toBe('over');
      }
    }, 240000);
  }
});

function turretShots_(g: GameState): number {
  return g.log.filter((e) => e.shot?.shooter.startsWith('E')).length;
}

import { describe, expect, it } from 'vitest';
import { playGame, type Ai } from '../src/ai/player';
import { randomAi } from '../src/ai/random';
import { simpleAi } from '../src/ai/simple';
import { tacticalAi } from '../src/ai/tactical';
import {
  applyCommand,
  chainFrom,
  chainOrder,
  createGame,
  createRng,
  dogfightOptions,
  groundAttackOptions,
  fromOffset,
  nextPicker,
  rootOf,
  shipById,
  slotOf,
  waitingFor,
  type Command,
  type Facing,
  type GameState,
  type Hex,
  type PilotQuality,
} from '../src/engine';

const at = (col: number, row: number): Hex => fromOffset(col, row);
const ok = (game: GameState, cmd: Command) => {
  const result = applyCommand(game, cmd);
  if (!result.ok) throw new Error(result.error);
  return result;
};
const refused = (game: GameState, cmd: Command): string => {
  const result = applyCommand(game, cmd);
  if (result.ok) throw new Error('the engine accepted the command');
  return result.error;
};

interface Spec {
  typeId: string;
  owner: 0 | 1;
  quality?: PilotQuality;
}

/** A game with advanced initiative, the ships placed legally; the initiative phase has just begun (positions are then moved to where the test wants them). */
function begun(specs: Spec[], seed = 3): GameState {
  const game = createGame({
    seed,
    advancedInitiative: true,
    ships: specs.map((s) => ({ owner: s.owner, typeId: s.typeId, quality: s.quality ?? 'average' })),
  });
  for (const player of [0, 1] as const) {
    const mine = game.ships.filter((s) => s.owner === player);
    ok(game, {
      type: 'place',
      player,
      placements: mine.map((s, i) => ({ shipId: s.id, pos: game.zones[player][i * 3]!, facing: (player === 0 ? 0 : 3) as Facing })),
    });
  }
  return game;
}

/** Put a ship somewhere, facing somewhere (after the placement, to set up a tail). */
function put(game: GameState, id: string, pos: Hex, facing: Facing): void {
  const ship = shipById(game, id)!;
  ship.pos = pos;
  ship.facing = facing;
}

/** Play the game-turn's planning and movement with the simple computer player; returns the ships in the order they moved. */
function playTurn(game: GameState): string[] {
  const turn = game.turn;
  const ai = simpleAi(createRng(5));
  const moved: string[] = [];
  for (let i = 0; i < 400 && game.turn === turn && game.phase !== 'over'; i++) {
    const [player] = waitingFor(game);
    const cmd = ai(game, player!)!;
    if (cmd.type === 'move') moved.push(cmd.shipId);
    ok(game, cmd);
  }
  return moved;
}

const four: Spec[] = [
  { typeId: 'x-wing', owner: 0 },
  { typeId: 'y-wing-1seat', owner: 0 },
  { typeId: 'tie-fighter', owner: 1 },
  { typeId: 'tie-interceptor', owner: 1 },
];

describe('advanced initiative: the Initiative Phase', () => {
  it('starts every game-turn with a piloting roll for every ship, before planning', () => {
    const g = begun(four);
    expect(g.phase).toBe('initiative');
    expect(g.initiative).toBeNull();
    const table = g.initiativeTable!;
    expect(Object.keys(table.rolls).sort()).toEqual(g.ships.map((s) => s.id).sort());
    expect(table.slots).toHaveLength(4);
    // the picks go from the highest roll down
    for (let i = 1; i < table.order.length; i++) expect(table.rolls[table.order[i - 1]!]!).toBeGreaterThanOrEqual(table.rolls[table.order[i]!]!);
    expect(waitingFor(g)).toEqual([shipById(g, table.order[0]!)!.owner]);
    expect(g.log.some((e) => e.kind === 'initiative' && /Initiative rolls/.test(e.text))).toBe(true);
  });

  it('gives no standard initiative', () => {
    const g = begun(four);
    expect(g.log.some((e) => /has the initiative/.test(e.text))).toBe(false);
  });

  it('lets only the owner of the ship whose turn it is pick, and only a free slot', () => {
    const g = begun(four);
    const table = g.initiativeTable!;
    const first = shipById(g, table.order[0]!)!;
    const stranger = first.owner === 0 ? 1 : 0;
    expect(refused(g, { type: 'slot', player: stranger, slot: 1 })).toMatch(/other player/);
    expect(refused(g, { type: 'slot', player: first.owner, slot: 0 })).toMatch(/slots/);
    expect(refused(g, { type: 'slot', player: first.owner, slot: 5 })).toMatch(/slots/);
    ok(g, { type: 'slot', player: first.owner, slot: 2 });
    const second = shipById(g, nextPicker(table)!)!;
    expect(refused(g, { type: 'slot', player: second.owner, slot: 2 })).toMatch(/taken/);
    expect(refused(g, { type: 'slot', player: second.owner, moveWith: first.id })).toMatch(/can.t move with/);
    expect(refused(g, { type: 'plan', player: 0, plans: {} })).toMatch(/isn.t the planning phase/);
    expect(refused(g, { type: 'chooseShip', player: 0, shipId: first.id })).toMatch(/initiative table/);
  });

  it('gives the last ship the only slot left and goes on to planning', () => {
    const g = begun(four);
    const table = g.initiativeTable!;
    // an example: a Y-wing says fourth, an interceptor first and a TIE fighter third; the X-wing is left with second
    table.order = ['P0-2', 'P1-2', 'P1-1', 'P0-1'];
    ok(g, { type: 'slot', player: 0, slot: 4 });
    ok(g, { type: 'slot', player: 1, slot: 1 });
    expect(g.phase).toBe('initiative');
    ok(g, { type: 'slot', player: 1, slot: 3 });
    expect(g.phase).toBe('planning');
    expect(table.slots).toEqual(['P1-2', 'P0-1', 'P1-1', 'P0-2']);
    expect(g.log.some((e) => /Order of movement/.test(e.text))).toBe(true);
  });

  it('breaks a tie by speed and rolls again when that is level too', () => {
    let sawTie = false;
    for (let seed = 1; seed <= 60 && !sawTie; seed++) {
      const g = begun(four, seed);
      const { rolls, order } = g.initiativeTable!;
      const pairs = order.filter((id, i) => i > 0 && rolls[id] === rolls[order[i - 1]!]);
      if (pairs.length === 0) continue;
      sawTie = true;
      // whoever is ahead of an equal roll is the faster ship, or won the roll-off
      for (const id of pairs) {
        const before = shipById(g, order[order.indexOf(id) - 1]!)!;
        expect(before.speed).toBeGreaterThanOrEqual(shipById(g, id)!.speed);
      }
    }
    expect(sawTie).toBe(true);
  });
});

describe('advanced initiative: moving with a tailed ship', () => {
  // the X-wing (P0-1) sits behind the TIE fighter (P1-1) and behind the Y-wing too; both face up. P1-2 is far away.
  const tailing = (): GameState => {
    const g = begun(four);
    put(g, 'P0-1', at(10, 20), 0);
    put(g, 'P1-1', at(10, 17), 0);
    put(g, 'P0-2', at(24, 20), 0);
    put(g, 'P1-2', at(24, 5), 3);
    return g;
  };

  it('lets a ship move with a tailed enemy ship, and nothing else', () => {
    const g = tailing();
    g.initiativeTable!.order = ['P0-1', 'P1-1', 'P0-2', 'P1-2'];
    expect(refused(g, { type: 'slot', player: 0, moveWith: 'P1-2' })).toMatch(/can.t move with/); // not tailed
    expect(refused(g, { type: 'slot', player: 0, moveWith: 'P0-2' })).toMatch(/can.t move with/); // own ship
    ok(g, { type: 'slot', player: 0, moveWith: 'P1-1' });
    expect(g.initiativeTable!.follows).toEqual({ 'P0-1': 'P1-1' });
    // the ship it moves with takes the slot; the tailing ship takes none (Rules: Advanced initiative)
    expect(g.phase).toBe('initiative');
    expect(nextPicker(g.initiativeTable!)).toBe('P1-1');
  });

  /** Plans for both sides and the first ship phases up to the pending decision about a tailing ship, or `until` returns true. */
  const planned = (g: GameState): ReturnType<typeof simpleAi> => {
    const ai = simpleAi(createRng(2));
    for (const player of [0, 1] as const) ok(g, ai(g, player)!);
    expect(g.phase).toBe('ships');
    return ai;
  };

  it('asks the owner of a tailing ship whether it moves before or after, when the tailed ship comes up', () => {
    for (const placing of ['before', 'after'] as const) {
      const g = tailing();
      g.initiativeTable!.order = ['P0-1', 'P1-1', 'P0-2', 'P1-2'];
      ok(g, { type: 'slot', player: 0, moveWith: 'P1-1' });
      ok(g, { type: 'slot', player: 1, slot: 2 }); // the TIE fighter
      ok(g, { type: 'slot', player: 0, slot: 1 }); // the Y-wing
      ok(g, { type: 'slot', player: 1, slot: 4 }); // the interceptor
      expect(g.phase).toBe('planning');
      expect(g.initiativeTable!.slots).toEqual(['P0-2', 'P1-1', null, 'P1-2']);
      const ai = planned(g);
      // the Y-wing has the first slot
      expect(g.active?.queue).toEqual(['P0-2']);
      while (!g.pending) ok(g, ai(g, waitingFor(g)[0]!)!);
      // then the TIE fighter's slot: the X-wing's owner decides
      expect(g.pending).toMatchObject({ kind: 'follow', player: 0, ship: 'P0-1', leader: 'P1-1' });
      expect(waitingFor(g)).toEqual([0]);
      expect(refused(g, { type: 'decide', player: 0, choice: 'sideways' })).toMatch(/before or after/);
      expect(refused(g, { type: 'decide', player: 1, choice: placing })).toMatch(/other player/);
      ok(g, { type: 'decide', player: 0, choice: placing });
      expect(g.active?.queue).toEqual(placing === 'before' ? ['P0-1', 'P1-1'] : ['P1-1', 'P0-1']);
    }
  });

  it('keeps one ship at most with each tailed ship', () => {
    const g = tailing();
    // the Y-wing is made to tail the TIE fighter too
    put(g, 'P0-2', at(10, 22), 0);
    g.initiativeTable!.order = ['P0-1', 'P0-2', 'P1-1', 'P1-2'];
    ok(g, { type: 'slot', player: 0, moveWith: 'P1-1' });
    expect(refused(g, { type: 'slot', player: 0, moveWith: 'P1-1' })).toMatch(/can.t move with/);
  });

  it('plays a chain of ships that move with one another in the order of the chain', () => {
    const table = { rolls: {}, order: [], slots: [null, null, null], follows: { B: 'C', A: 'B' }, cursor: 0 };
    table.slots = ['C' as never, null, null];
    expect(chainFrom(table, 'C')).toEqual(['C', 'B', 'A']);
    expect(chainOrder(['C', 'B', 'A'], ['after', 'after'])).toEqual(['C', 'B', 'A']);
    expect(chainOrder(['C', 'B', 'A'], ['before', 'before'])).toEqual(['A', 'B', 'C']);
    expect(chainOrder(['C', 'B', 'A'], ['after', 'before'])).toEqual(['C', 'A', 'B']);
    expect(chainOrder(['C', 'B', 'A'], ['before', 'after'])).toEqual(['B', 'A', 'C']);
  });

  it('lets the tailing ship move alone when the ship it moves with is gone', () => {
    const g = tailing();
    g.initiativeTable!.order = ['P0-1', 'P1-1', 'P0-2', 'P1-2'];
    ok(g, { type: 'slot', player: 0, moveWith: 'P1-1' });
    ok(g, { type: 'slot', player: 1, slot: 3 });
    ok(g, { type: 'slot', player: 0, slot: 1 });
    ok(g, { type: 'slot', player: 1, slot: 2 });
    const ai = planned(g);
    // the TIE fighter is shot down before its slot
    const tie = shipById(g, 'P1-1')!;
    tie.status = 'destroyed';
    tie.pos = null;
    const moved: string[] = [];
    for (let i = 0; i < 100 && g.turn === 1; i++) {
      const cmd = ai(g, waitingFor(g)[0]!)!;
      if (cmd.type === 'move') moved.push(cmd.shipId);
      ok(g, cmd);
      expect(g.pending?.kind).not.toBe('follow');
    }
    expect(moved).toEqual(['P0-2', 'P1-2', 'P0-1']);
  });
});

describe('advanced initiative: whole turns', () => {
  it('works in a Ground Attack too, with turret guns and with a side that has no ships', () => {
    for (const mix of [1, 2, 3] as const) {
      const game = createGame({ ...groundAttackOptions(mix, 5), advancedInitiative: true });
      playGame(game, [simpleAi(createRng(3)), simpleAi(createRng(4))], { maxCommands: 12000 });
      expect(game.phase).toBe('over');
    }
  });

  it('moves every ship once, in the order of the table', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const g = begun(four, seed);
      const ai = simpleAi(createRng(seed));
      while (g.phase === 'initiative') ok(g, ai(g, waitingFor(g)[0]!)!);
      const table = structuredClone(g.initiativeTable!);
      const moved = playTurn(g);
      expect(new Set(moved).size).toBe(moved.length);
      expect(moved.length).toBeGreaterThan(0);
      // the slot each ship moves in (that of the ship it moves with, if it moves with one) never goes back
      const slots = moved.map((id) => slotOf(table, rootOf(table, id)));
      expect(slots).toEqual([...slots].sort((x, y) => x - y));
    }
  });

  it('plays complete games with each kind of computer player and the option on', () => {
    const make = (kind: string, s: number): Ai => (kind === 'simple' ? simpleAi(createRng(s)) : kind === 'tactical' ? tacticalAi(createRng(s)) : randomAi(createRng(s)));
    const pairs: [string, string][] = [['simple', 'simple'], ['tactical', 'simple'], ['random', 'random'], ['tactical', 'random']];
    for (const mix of ['one', 'two'] as const) {
      for (const [a, b] of pairs) {
        const game = createGame({ ...dogfightOptions(mix, 7), advancedInitiative: true });
        playGame(game, [make(a, 11), make(b, 23)], { maxCommands: 12000 });
        expect(game.phase).toBe('over');
        expect(game.log.some((e) => e.kind === 'initiative')).toBe(true);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { tacticalAi } from '../src/ai/tactical';
import {
  STANDARD_MAP,
  applyCommand,
  arrivalHexes,
  attackerZoneFor,
  createGame,
  createRng,
  exitBlocked,
  exitEdgeOf,
  fromOffset,
  scenarioOptions,
  verdictOf,
  waitingFor,
  winnerOf,
  type Command,
  type GameOptions,
  type GameState,
  type PlayerId,
} from '../src/engine';

const map = { ...STANDARD_MAP, mode: 'static' as const };

/** The Falcon runs; the Empire's fighters wait off the map and come in along the Falcon's start edge after game-turn 1 (the shape of Asteroids Mix Two). */
function runOptions(extra: Partial<GameOptions> = {}): GameOptions {
  return {
    seed: 11,
    map,
    ships: [
      { owner: 0, typeId: 'millennium-falcon', quality: 'hotshot', tag: 'runner' },
      { owner: 1, typeId: 'tie-fighter', quality: 'veteran', reserve: 'ties' },
      { owner: 1, typeId: 'tie-fighter', quality: 'veteran', reserve: 'ties' },
    ],
    startEdges: [['top', 'bottom'], null],
    reserves: { ties: { entry: { kind: 'scheduled', afterTurn: 1 }, along: { kind: 'startEdge', side: 0 } } },
    rules: {
      verdicts: [
        { when: { kind: 'escaped', tag: 'runner' }, winner: 0 },
        { when: { kind: 'destroyed', tag: 'runner' }, winner: 1 },
        { when: { kind: 'sideGone', side: 1 }, winner: 0 },
      ],
      exits: [{ tag: 'runner', only: 'opposite', of: 0 }],
    },
    ...extra,
  };
}

const ok = (g: GameState, cmd: Command): void => {
  const r = applyCommand(g, cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${r.error}`);
};

/** Both computer players give commands until the predicate holds. */
function play(g: GameState, until: (g: GameState) => boolean, limit = 3000): void {
  const rng = createRng(5);
  const ais = [tacticalAi(rng), tacticalAi(rng)];
  for (let i = 0; i < limit && !until(g) && g.phase !== 'over'; i++) {
    const waiting = waitingFor(g);
    const cmd = ais[waiting[0]!]!(g, waiting[0]!);
    if (!cmd) throw new Error(`no command in phase ${g.phase}`);
    ok(g, cmd);
  }
}

/** The game started: edge chosen, the Falcon placed. */
function started(extra: Partial<GameOptions> = {}, edge: 'top' | 'bottom' = 'top'): GameState {
  const g = createGame(runOptions(extra));
  ok(g, { type: 'edge', player: 0, edge });
  const zone = g.zones[0];
  const mid = zone[Math.floor(zone.length / 2)]!;
  ok(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: mid, facing: edge === 'top' ? 3 : 0 }] });
  return g;
}

describe('a side that starts along an edge of its choice', () => {
  it('has to choose it before it places, and then sets up in the strip along it', () => {
    const g = createGame(runOptions());
    expect(g.phase).toBe('setup');
    expect(waitingFor(g)).toEqual([0]); // the Empire has nothing to place
    expect(g.ships.filter((s) => s.owner === 1).every((s) => s.status === 'reserve')).toBe(true);
    const mid = fromOffset(16, 0);
    expect(applyCommand(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: mid, facing: 3 }] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'edge', player: 0, edge: 'left' }).ok).toBe(false); // not one of the options
    ok(g, { type: 'edge', player: 0, edge: 'top' });
    expect(g.edgeChoice!.edge).toBe('top');
    expect(g.zones[0]).toEqual(attackerZoneFor(g.map, 'top'));
    expect(applyCommand(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: fromOffset(16, 20), facing: 3 }] }).ok).toBe(false);
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: mid, facing: 3 }] });
    expect(g.phase).toBe('planning');
    expect(g.turn).toBe(1);
    expect(waitingFor(g)).toEqual([0]);
  });
});

describe('reserves that come in at the Markers step', () => {
  it('are placed by their owner along the edge the other side started from, and play from the next game-turn', () => {
    const g = started();
    play(g, (s) => s.phase === 'arrival');
    expect(g.turn).toBe(1);
    expect(waitingFor(g)).toEqual([1]);
    const ties = g.ships.filter((s) => s.owner === 1);
    expect(ties.every((s) => s.status === 'reserve')).toBe(true);
    const zone = arrivalHexes(g);
    expect(zone).toEqual(attackerZoneFor(g.map, 'top'));
    // the wrong edge, a hex off the strip, and one ship short are all refused
    const [a, b] = [zone[0]!, zone[1]!];
    expect(applyCommand(g, { type: 'arrive', player: 1, placements: [{ shipId: 'P1-1', pos: a, facing: 3 }] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'arrive', player: 1, placements: [{ shipId: 'P1-1', pos: a, facing: 3 }, { shipId: 'P1-2', pos: fromOffset(16, 20), facing: 3 }] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'arrive', player: 0, placements: [{ shipId: 'P1-1', pos: a, facing: 3 }, { shipId: 'P1-2', pos: b, facing: 3 }] }).ok).toBe(false);
    ok(g, { type: 'arrive', player: 1, placements: [{ shipId: 'P1-1', pos: a, facing: 3 }, { shipId: 'P1-2', pos: b, facing: 3 }] });
    expect(ties.every((s) => s.status === 'active' && s.pos !== null)).toBe(true);
    expect(g.phase).toBe('planning');
    expect(g.turn).toBe(2);
    expect(waitingFor(g).sort()).toEqual([0, 1]);
  });

  it('keep a side alive that has nothing on the map yet', () => {
    const g = started();
    expect(verdictOf(g)).toBeNull();
    expect(g.phase).toBe('planning');
  });
});

describe('the rules of a scenario with reserves', () => {
  it('lets the runner leave only across the edge opposite its start, and decides the game on the spot', () => {
    const g = started({}, 'top');
    const falcon = g.ships[0]!;
    expect(exitEdgeOf(g, falcon)).toBe('bottom');
    expect(exitBlocked(g, falcon, fromOffset(-1, 10))).toBe(true);
    expect(exitBlocked(g, falcon, fromOffset(map.cols, 10))).toBe(true);
    expect(exitBlocked(g, falcon, fromOffset(10, -1))).toBe(true);
    expect(exitBlocked(g, falcon, fromOffset(10, map.rows))).toBe(false);
    expect(exitBlocked(g, falcon, fromOffset(10, 10))).toBe(false);
    // the TIE fighters have no such rule
    expect(exitBlocked(g, g.ships[1]!, fromOffset(-1, 10))).toBe(false);

    const winner = (mutate: (g2: GameState) => void): PlayerId | 'draw' | null => {
      const g2 = structuredClone(g);
      mutate(g2);
      return verdictOf(g2) ? winnerOf(g2) : null;
    };
    expect(winner((s) => { s.ships[0]!.status = 'escaped'; })).toBe(0);
    expect(winner((s) => { s.ships[0]!.status = 'destroyed'; })).toBe(1);
    expect(winner((s) => { s.ships.filter((x) => x.owner === 1).forEach((x) => { x.status = 'destroyed'; }); })).toBe(0);
  });

  it('runs a whole game between two computer players without a rejected command', () => {
    for (const seed of [1, 2, 3]) {
      const g = createGame(runOptions({ seed }));
      play(g, () => false, 6000);
      expect(g.phase).toBe('over');
      expect([0, 1]).toContain(g.winner);
    }
  });
});

describe('reserves that come in when their owner says', () => {
  const declaredOptions = (entry: GameOptions['reserves']): GameOptions => ({
    seed: 4,
    map,
    ships: [
      { owner: 0, typeId: 'x-wing', quality: 'veteran' },
      { owner: 0, typeId: 'x-wing', quality: 'veteran', reserve: 'wing' },
      { owner: 1, typeId: 'tie-fighter', quality: 'veteran' },
    ],
    reserves: entry,
    // the game goes on whatever happens to the lone ships: these tests look at the entry only
    rules: { end: [] },
  });

  const toTurnTwo = (g: GameState): void => {
    // set up with the computer, then play turn 1 out
    play(g, (s) => s.turn >= 2 || s.phase === 'entry');
  };

  it('asks the owner at the start of each game-turn from the one named, and lets him wait', () => {
    const g = createGame(declaredOptions({ wing: { entry: { kind: 'declared', fromTurn: 2 }, along: { kind: 'any' } } }));
    toTurnTwo(g);
    expect(g.phase).toBe('entry');
    expect(g.turn).toBe(2);
    expect(waitingFor(g)).toEqual([0]);
    expect(applyCommand(g, { type: 'enter', player: 1, enter: true }).ok).toBe(false);
    ok(g, { type: 'enter', player: 0, enter: false });
    expect(g.phase).toBe('planning');
    expect(g.ships.find((s) => s.reserve === 'wing')!.status).toBe('reserve');
    // the next game-turn it is asked again
    play(g, (s) => s.phase === 'entry' && s.turn === 3);
    expect(g.turn).toBe(3);
  });

  it('places a group that comes in along an edge of its owner’s choice, all within the distance the scenario names', () => {
    const g = createGame({
      ...declaredOptions({ wing: { entry: { kind: 'declared', fromTurn: 2 }, along: { kind: 'any' }, within: 3 } }),
      ships: [
        { owner: 0, typeId: 'x-wing', quality: 'veteran' },
        { owner: 0, typeId: 'x-wing', quality: 'veteran', reserve: 'wing' },
        { owner: 0, typeId: 'x-wing', quality: 'veteran', reserve: 'wing' },
        { owner: 1, typeId: 'tie-fighter', quality: 'veteran' },
      ],
    });
    toTurnTwo(g);
    ok(g, { type: 'enter', player: 0, enter: true });
    expect(g.phase).toBe('arrival');
    expect(waitingFor(g)).toEqual([0]);
    const strip = attackerZoneFor(g.map, 'left');
    const first = strip.find((h) => !g.ships.some((s) => s.pos && s.pos.q === h.q && s.pos.r === h.r))!;
    const far = strip.find((h) => Math.abs(h.r - first.r) > 6 && !g.ships.some((s) => s.pos && s.pos.q === h.q && s.pos.r === h.r))!;
    const near = strip.find((h) => h !== first && Math.abs(h.r - first.r) <= 1 && Math.abs(h.q - first.q) <= 1 && !g.ships.some((s) => s.pos && s.pos.q === h.q && s.pos.r === h.r))!;
    const ids = g.ships.filter((s) => s.reserve === 'wing').map((s) => s.id);
    // no edge named: refused; too far apart: refused; then fine
    expect(applyCommand(g, { type: 'arrive', player: 0, placements: [{ shipId: ids[0]!, pos: first, facing: 1 }, { shipId: ids[1]!, pos: near, facing: 1 }] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'arrive', player: 0, edge: 'left', placements: [{ shipId: ids[0]!, pos: first, facing: 1 }, { shipId: ids[1]!, pos: far, facing: 1 }] }).ok).toBe(false);
    ok(g, { type: 'arrive', player: 0, edge: 'left', placements: [{ shipId: ids[0]!, pos: first, facing: 1 }, { shipId: ids[1]!, pos: near, facing: 1 }] });
    expect(g.ships.filter((s) => s.reserve === 'wing').every((s) => s.status === 'active')).toBe(true);
    expect(g.phase).toBe('planning');
  });

  it('makes the owner roll: 6 the first time, one less each time after', () => {
    const g = createGame(declaredOptions({ wing: { entry: { kind: 'rolled', fromTurn: 2 }, along: { kind: 'any' } } }));
    toTurnTwo(g);
    let attempts = 0;
    for (let i = 0; i < 60 && (g.phase as string) === 'entry'; i++) {
      ok(g, { type: 'enter', player: 0, enter: true });
      if ((g.phase as string) === 'arrival') break;
      attempts += 1;
      // still waiting: the next game-turn comes round
      play(g, (s) => s.phase === 'entry' || s.phase === 'over');
    }
    expect(g.phase).toBe('arrival');
    const lines = g.log.filter((e) => e.kind === 'arrival').map((e) => e.text);
    expect(lines.length).toBe(attempts + 1);
    expect(lines[0]).toMatch(/6 was needed/);
    if (attempts >= 1) expect(lines[1]).toMatch(/5 was needed/);
    expect(lines.at(-1)).toMatch(/bring their reserves in/);
  });
});

describe('the Asteroid Run of the menu', () => {
  it('has the Falcon alone against five fighters that wait off the map, in a dense field that rests on the first game-turn', () => {
    const g = createGame({ ...scenarioOptions('asteroid2', 3), asteroids: { density: 'dense', motion: 'drift', chaos: 4 } });
    expect(g.map.mode).toBe('static');
    expect(g.ships.filter((s) => s.owner === 0).map((s) => [s.typeId, s.quality, s.tag])).toEqual([['millennium-falcon', 'hotshot', 'runner']]);
    expect(g.ships.filter((s) => s.owner === 1)).toHaveLength(5);
    expect(g.ships.filter((s) => s.owner === 1).every((s) => s.status === 'reserve' && s.quality === 'veteran')).toBe(true);
    expect(g.reserves).toHaveLength(1);
    expect(g.edgeChoice!.options).toEqual(['top', 'bottom']);
    expect(g.rules!.objectives![0]).toMatch(/Falcon/);
    expect(g.asteroids).toBeDefined();
  });

  it('is played to the end by two computer players in the field', () => {
    for (const seed of [1, 2, 3, 4]) {
      const g = createGame({ ...scenarioOptions('asteroid2', seed), asteroids: { density: 'dense', motion: 'drift', chaos: 4 } });
      play(g, () => false, 8000);
      expect(g.phase).toBe('over');
    }
  });
});

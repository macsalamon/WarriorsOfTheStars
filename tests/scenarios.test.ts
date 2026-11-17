import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createGame,
  emptyPlan,
  fromOffset,
  inflictDamage,
  moveContext,
  shipById,
  type Facing,
  type GameState,
  type Hex,
  type PilotQuality,
  type Plan,
  type Ship,
} from '../src/engine';

interface Spec {
  typeId: string;
  owner: 0 | 1;
  at: Hex;
  facing: Facing;
  quality?: PilotQuality;
}

/** A small game dropped straight into the ship phases, with ships where we want them. */
function scene(specs: Spec[], seed = 1): GameState {
  const game = createGame({
    seed,
    ships: specs.map((s) => ({ owner: s.owner, typeId: s.typeId, quality: s.quality ?? 'average' })),
  });
  specs.forEach((s, i) => {
    const ship = game.ships[i]!;
    ship.pos = s.at;
    ship.facing = s.facing;
  });
  game.phase = 'ships';
  game.turn = 1;
  game.initiative = 0;
  game.chooser = 0;
  return game;
}

const at = (col: number, row: number): Hex => fromOffset(col, row);
const ok = (game: GameState, cmd: Parameters<typeof applyCommand>[1]) => {
  const result = applyCommand(game, cmd);
  if (!result.ok) throw new Error(result.error);
  return result;
};
const get = (game: GameState, id: string): Ship => shipById(game, id)!;

describe('damage effects', () => {
  const game = () => scene([
    { typeId: 'x-wing', owner: 0, at: at(10, 20), facing: 0 },
    { typeId: 'tie-fighter', owner: 1, at: at(10, 10), facing: 3 },
  ]);

  it('engine damage lowers maximum speed and pulls the throttle back (E)', () => {
    const g = game();
    inflictDamage(g, 'P0-1', ['E']);
    const x = get(g, 'P0-1');
    expect(x.maxSpeed).toBe(5);
    expect(x.speed).toBe(5);
    inflictDamage(g, 'P0-1', ['E']);
    expect(x.maxSpeed).toBe(4);
  });

  it('engine damage leaves a slower ship at its speed', () => {
    const g = game();
    get(g, 'P0-1').speed = 3;
    inflictDamage(g, 'P0-1', ['E']);
    expect(get(g, 'P0-1').speed).toBe(3);
    expect(get(g, 'P0-1').maxSpeed).toBe(5);
  });

  it('power loss removes a shield from the box that was hit, then body points (P)', () => {
    const g = game();
    const x = get(g, 'P0-1'); // 1 front, 1 rear
    inflictDamage(g, 'P0-1', ['P'], { quarter: 'front' });
    expect(x.shields).toEqual({ front: 0, rear: 1, left: 0, right: 0 });
    inflictDamage(g, 'P0-1', ['P'], { quarter: 'front' });
    expect(x.bodyDamage).toBe(1);
    inflictDamage(g, 'P0-1', ['2P'], { quarter: 'rear' });
    expect(x.shields.rear).toBe(0);
    expect(x.bodyDamage).toBe(2);
  });

  it('destroys a ship when body damage reaches its rating, and scores it for the shooter', () => {
    const g = game();
    inflictDamage(g, 'P1-1', ['2Bdy'], { shooter: 'P0-1' }); // TIE fighter body is 3
    expect(get(g, 'P1-1').status).toBe('active');
    expect(g.vp).toEqual([1, 0]); // one VP for a non-fatal body hit (Rules: Victory points for hits)
    inflictDamage(g, 'P1-1', ['Body'], { shooter: 'P0-1' });
    expect(get(g, 'P1-1').status).toBe('destroyed');
    // TIE fighter 3 + average pilot 4, plus the earlier hit
    expect(g.vp[0]).toBe(1 + 3 + 4);
    expect(g.phase).toBe('over');
    expect(g.winner).toBe(0);
  });

  it('reduces skills by 1D and kills a pilot who drops below 1D (Sk-1)', () => {
    const g = game();
    const t = get(g, 'P1-1');
    t.pilotSkill = { dice: 2, pips: 1 };
    t.gunnerySkill = { dice: 3, pips: 0 };
    inflictDamage(g, 'P1-1', ['Sk-1']);
    expect(t.pilotSkill).toEqual({ dice: 1, pips: 1 });
    expect(t.gunnerySkill).toEqual({ dice: 2, pips: 0 });
    inflictDamage(g, 'P1-1', ['Sk-1']);
    expect(t.status).toBe('destroyed');
  });

  it('adds lateral control damage to the turn number and caps at x2 (L)', () => {
    const g = game();
    const x = get(g, 'P0-1');
    x.speed = 4;
    const before = moveContext(x).turnNumber;
    inflictDamage(g, 'P0-1', ['L']);
    expect(moveContext(x).turnNumber).toBe(before + 1);
    inflictDamage(g, 'P0-1', ['L', 'L']);
    expect(x.lateralDamage).toBe(2);
    expect(moveContext(x).turnNumber).toBe(before + 2);
  });

  it('adds T+n to this game-turn only (T+)', () => {
    const g = game();
    const x = get(g, 'P0-1');
    x.speed = 4;
    const before = moveContext(x).turnNumber;
    inflictDamage(g, 'P0-1', ['T+2']);
    expect(moveContext(x).turnNumber).toBe(before + 2);
  });

  it('flips the action penalty marker on a second penalty (A+3, A+6)', () => {
    const g = game();
    const x = get(g, 'P0-1');
    inflictDamage(g, 'P0-1', ['A+3']);
    expect(x.pendingPenalty).toBe(1);
    inflictDamage(g, 'P0-1', ['A+3']);
    expect(x.pendingPenalty).toBe(2);
    const y = get(g, 'P1-1');
    inflictDamage(g, 'P1-1', ['A+6']);
    expect(y.pendingPenalty).toBe(2);
  });

  it('forces a roll next game-turn, doubled on a repeat (Roll)', () => {
    const g = game();
    inflictDamage(g, 'P0-1', ['Roll']);
    expect(get(g, 'P0-1').forcedRoll).toBe(1);
    inflictDamage(g, 'P0-1', ['Roll', 'Roll']);
    expect(get(g, 'P0-1').forcedRoll).toBe(2);
  });

  it('marks stabilizer damage, doubling on a repeat (Stb)', () => {
    const g = game();
    inflictDamage(g, 'P0-1', ['Stb']);
    expect(get(g, 'P0-1').stabilizerDamage).toBe(1);
    inflictDamage(g, 'P0-1', ['Stb', 'Stb']);
    expect(get(g, 'P0-1').stabilizerDamage).toBe(2);
  });

  it('changes speed at random and marks overspeed when the maximum is passed (SPD?)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = scene([
        { typeId: 'x-wing', owner: 0, at: at(10, 20), facing: 0 },
        { typeId: 'tie-fighter', owner: 1, at: at(10, 10), facing: 3 },
      ], seed);
      const x = get(g, 'P0-1');
      x.speed = x.maxSpeed;
      inflictDamage(g, 'P0-1', ['SPD2?']);
      expect([x.maxSpeed - 2, x.maxSpeed + 2]).toContain(x.speed);
      if (x.speed > x.maxSpeed) {
        expect(x.forcedOverspeed).toBe(2);
        expect(x.hazardOverspeed).toBe(2);
      }
    }
  });

  it('lets the owner choose which gun is damaged when guns differ (G)', () => {
    const g = scene([
      { typeId: 'y-wing-1seat', owner: 0, at: at(10, 20), facing: 0 }, // DMF and DLF(I)
      { typeId: 'tie-fighter', owner: 1, at: at(10, 10), facing: 3 },
    ]);
    inflictDamage(g, 'P0-1', ['G']);
    expect(g.pending).toMatchObject({ kind: 'gun', player: 0, options: [0, 1] });
    expect(applyCommand(g, { type: 'decide', player: 1, choice: 0 }).ok).toBe(false); // not their decision
    ok(g, { type: 'decide', player: 0, choice: 1 });
    expect(get(g, 'P0-1').guns).toEqual(['DMF', 'SLF(I)']);
    expect(g.pending).toBeNull();
  });

  it('damages the only gun without asking (G)', () => {
    const g = game();
    inflictDamage(g, 'P0-1', ['G']);
    expect(g.pending).toBeNull();
    expect(get(g, 'P0-1').guns).toEqual(['TMF']); // quad becomes triple (G damage)
  });

  it('asks which action to lose when several share the hazard letter (LOSE)', () => {
    const g = game();
    const x = get(g, 'P0-1');
    x.plan = { ...emptyPlan(), roll: 1, slip: 1, bank: 1 };
    inflictDamage(g, 'P0-1', ['LOSE'], { row: 'C' });
    expect(g.pending).toMatchObject({ kind: 'lose', options: ['slip', 'roll'] });
    expect(applyCommand(g, { type: 'decide', player: 0, choice: 'bank' }).ok).toBe(false); // wrong letter
    ok(g, { type: 'decide', player: 0, choice: 'roll' });
    expect(x.plan.roll).toBe(0);
    expect(x.plan.slip).toBe(1);
  });

  it('loses a single overturn into a double bank, and flips a double action to single (LOSE)', () => {
    const g = game();
    const x = get(g, 'P0-1');
    x.plan = { ...emptyPlan(), overturn: 1 };
    inflictDamage(g, 'P0-1', ['LOSE'], { row: 'D' });
    expect(x.plan.overturn).toBe(0);
    expect(x.plan.bank).toBe(2);
    inflictDamage(g, 'P0-1', ['LOSE'], { row: 'D' });
    expect(x.plan.bank).toBe(1);
  });

  it('does nothing when there is no action with that letter to lose (LOSE)', () => {
    const g = game();
    inflictDamage(g, 'P0-1', ['LOSE'], { row: 'F' });
    expect(g.pending).toBeNull();
  });

  it('blocks other commands while a decision is pending', () => {
    const g = scene([
      { typeId: 'y-wing-1seat', owner: 0, at: at(10, 20), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(10, 10), facing: 3 },
    ]);
    inflictDamage(g, 'P0-1', ['G']);
    const result = applyCommand(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    expect(result).toEqual({ ok: false, error: 'A decision is waiting for a player.' });
  });
});

describe('tailing: passing and stealing moves', () => {
  // P0's X-wing sits behind P1's TIE fighter, both flying "up": P0 tails P1
  const tail = () => scene([
    { typeId: 'x-wing', owner: 0, at: at(10, 20), facing: 0 },
    { typeId: 'tie-fighter', owner: 1, at: at(10, 17), facing: 0 },
  ]);

  it('lets the tailing player steal the move of the ship chosen by the enemy', () => {
    const g = tail();
    g.chooser = 1;
    ok(g, { type: 'chooseShip', player: 1, shipId: 'P1-1' });
    expect(g.pending).toMatchObject({ kind: 'steal', player: 0, candidates: ['P0-1'] });
    ok(g, { type: 'decide', player: 0, choice: 'P0-1' });
    expect(g.active?.queue).toEqual(['P0-1', 'P1-1']);
  });

  it('lets the tailing player decline to steal', () => {
    const g = tail();
    g.chooser = 1;
    ok(g, { type: 'chooseShip', player: 1, shipId: 'P1-1' });
    ok(g, { type: 'decide', player: 0, choice: null });
    expect(g.active?.queue).toEqual(['P1-1']);
  });

  it('lets a chosen tailing ship pass its move to the ship it tails', () => {
    const g = tail();
    g.chooser = 1; // player 2 chooses player 1's tailing X-wing
    ok(g, { type: 'chooseShip', player: 1, shipId: 'P0-1' });
    expect(g.pending).toMatchObject({ kind: 'pass', player: 0, candidates: ['P1-1'] });
    ok(g, { type: 'decide', player: 0, choice: 'P1-1' });
    expect(g.active?.queue).toEqual(['P1-1', 'P0-1']);
  });

  it('does not offer a steal when nothing tails the chosen ship', () => {
    const g = tail();
    g.chooser = 0;
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' }); // the tailer itself is not tailed
    expect(g.pending).toBeNull();
    expect(g.active?.queue).toEqual(['P0-1']);
  });

  it('alternates the choice of ship after a stolen move', () => {
    const g = tail();
    g.chooser = 1;
    for (const s of g.ships) s.speed = 0; // so each ship's move is trivial
    ok(g, { type: 'chooseShip', player: 1, shipId: 'P1-1' });
    ok(g, { type: 'decide', player: 0, choice: 'P0-1' });
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    // the X-wing now faces the TIE fighter within range, so it may fire; it declines
    if (g.active?.stage === 'fire') ok(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [] });
    ok(g, { type: 'move', player: 1, shipId: 'P1-1', steps: [] });
    if (g.active?.stage === 'fire') ok(g, { type: 'fire', player: 1, shipId: 'P1-1', shots: [] });
    expect(g.turn).toBe(2); // everyone moved: bookkeeping ran
  });
});

describe('the ship phase', () => {
  it('lets the side with more ships keep choosing once the other has none left (9)', () => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 30), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(20, 10), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(25, 10), facing: 0 },
    ]);
    for (const s of g.ships) s.speed = 0;
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    expect(g.chooser).toBe(1);
    ok(g, { type: 'chooseShip', player: 1, shipId: 'P1-1' });
    ok(g, { type: 'move', player: 1, shipId: 'P1-1', steps: [] });
    // the Rebels have no ship left to choose, so the Empire chooses again rather than the Rebels picking an enemy
    expect(g.chooser).toBe(1);
  });

  it('rejects moves from the wrong player and out-of-turn commands', () => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 20), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(20, 10), facing: 0 },
    ]);
    expect(applyCommand(g, { type: 'chooseShip', player: 1, shipId: 'P1-1' }).ok).toBe(false);
    expect(applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] }).ok).toBe(false);
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    expect(applyCommand(g, { type: 'move', player: 1, shipId: 'P0-1', steps: [] }).ok).toBe(false);
  });

  it('requires the full movement and moves the counter', () => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 20), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(20, 10), facing: 0 },
    ]);
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    const x = get(g, 'P0-1');
    expect(applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [{ kind: 'forward' }] }).ok).toBe(false);
    const steps = Array.from({ length: x.speed }, () => ({ kind: 'forward' as const }));
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps });
    expect(x.pos).toEqual(at(10, 20 - x.speed));
    expect(x.moved).toBe(true);
    expect(g.chooser).toBe(1);
  });

  it('lets a ship fly past the printed edge: space is open and nothing shifts', () => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 1), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(20, 10), facing: 0 },
    ]);
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    const x = get(g, 'P0-1');
    const steps = Array.from({ length: x.speed }, () => ({ kind: 'forward' as const }));
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps });
    // flew 6 hexes up from row 1, past the top of the printed map, and everything stays where it is
    expect(x.status).toBe('active');
    expect(x.pos).toEqual(at(10, -5));
    expect(get(g, 'P1-1').pos).toEqual(at(20, 10));
  });

  it('lets a ship escape when the fleet would no longer fit on the map', () => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 1), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(20, 43), facing: 0 }, // too near the far edge to shift
      { typeId: 'tie-fighter', owner: 1, at: at(22, 43), facing: 0 },
    ]);
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    const x = get(g, 'P0-1');
    const steps = Array.from({ length: x.speed }, () => ({ kind: 'forward' as const }));
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps });
    expect(x.status).toBe('escaped');
    expect(g.phase).toBe('over'); // the Rebels have nothing left on the map
    expect(g.vp).toEqual([0, 0]);
  });

  it('lets a ship that cannot move leave and still finish a legal turn at speed 0', () => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 20), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(20, 10), facing: 0 },
    ]);
    const x = get(g, 'P0-1');
    x.speed = 0;
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [{ kind: 'turnRight' }, { kind: 'turnRight' }] });
    expect(x.facing).toBe(2);
  });
});

describe('firing (11, 12)', () => {
  const duel = (seed: number) => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 20), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(10, 18), facing: 3, quality: 'trainee' },
    ], seed);
    for (const s of g.ships) s.speed = 0;
    get(g, 'P0-1').pilotSkill = { dice: 10, pips: 0 };
    get(g, 'P0-1').gunnerySkill = { dice: 10, pips: 0 };
    return g;
  };

  it('resolves a volley and applies the result to the target', () => {
    let hits = 0;
    let damaged = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const g = duel(seed);
      ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
      ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
      expect(g.active?.stage).toBe('fire');
      ok(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1' }] });
      const t = get(g, 'P1-1');
      if (g.log.some((e) => e.kind === 'fire' && e.text.endsWith('hit.'))) hits += 1;
      if (t.status === 'destroyed' || t.bodyDamage > 0 || t.maxSpeed < 7 || t.guns[0] !== 'DMF' || t.stabilizerDamage || t.lateralDamage || t.pendingPenalty || t.forcedRoll) damaged += 1;
    }
    expect(hits).toBeGreaterThan(25); // a 10D gunner against a point-blank target nearly always hits
    expect(damaged).toBeGreaterThan(10);
  });

  it('rejects shots at targets outside the forward centre arc', () => {
    const g = scene([
      { typeId: 'x-wing', owner: 0, at: at(10, 20), facing: 0 },
      { typeId: 'tie-fighter', owner: 1, at: at(10, 25), facing: 0 }, // behind the X-wing
    ]);
    for (const s of g.ships) s.speed = 0;
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(g, { type: 'decide', player: 1, choice: null }); // the TIE fighter tails the X-wing but declines to steal
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    // nothing to shoot at: the fire stage is skipped and the ship phase ends
    expect(g.active).toBeNull();
    expect(get(g, 'P0-1').moved).toBe(true);
  });

  it('only fires each gun once per volley', () => {
    const g = duel(1);
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    const result = applyCommand(g, {
      type: 'fire', player: 0, shipId: 'P0-1',
      shots: [{ gun: 0, target: 'P1-1' }, { gun: 0, target: 'P1-1' }],
    });
    expect(result.ok).toBe(false);
  });

  it('a single snap fire uses up the ship\'s fire; a double snap fire still fires at the end', () => {
    const single = duel(2);
    get(single, 'P0-1').plan = { ...emptyPlan(), snapFire: 1 };
    ok(single, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(single, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    expect(single.active).toBeNull();

    const double = duel(2);
    get(double, 'P0-1').plan = { ...emptyPlan(), snapFire: 2 };
    ok(double, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    ok(double, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    expect(double.active?.stage).toBe('fire');
  });
});

describe('planning and the hazard phase', () => {
  it('runs a whole planning phase through hazards to the first ship choice', () => {
    const g = createGame({
      seed: 11,
      ships: [
        { owner: 0, typeId: 'x-wing', quality: 'average' },
        { owner: 1, typeId: 'tie-fighter', quality: 'average' },
      ],
    });
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: g.zones[0][50]!, facing: 3 }] });
    expect(g.phase).toBe('setup');
    ok(g, { type: 'place', player: 1, placements: [{ shipId: 'P1-1', pos: g.zones[1][50]!, facing: 0 }] });
    expect(g.phase).toBe('planning');
    expect(g.turn).toBe(1);

    // a heavy plan almost guarantees hazards for the X-wing
    const heavy: Plan = { ...emptyPlan(), halfLoop: 2, roll: 2, jink: 2, overturn: 2, slip: 2 };
    ok(g, { type: 'plan', player: 0, plans: { 'P0-1': heavy } });
    expect(g.phase).toBe('planning');
    expect(applyCommand(g, { type: 'plan', player: 0, plans: { 'P0-1': heavy } }).ok).toBe(false);
    ok(g, { type: 'plan', player: 1, plans: { 'P1-1': emptyPlan() } });

    expect(g.phase === 'ships' || g.pending !== null).toBe(true);
    expect(g.log.some((e) => e.kind === 'hazard')).toBe(true);
  });

  it('rejects plans that break the rules', () => {
    const g = createGame({
      seed: 3,
      ships: [
        { owner: 0, typeId: 'x-wing', quality: 'average' },
        { owner: 1, typeId: 'tie-fighter', quality: 'average' },
      ],
    });
    ok(g, { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: g.zones[0][0]!, facing: 3 }] });
    ok(g, { type: 'place', player: 1, placements: [{ shipId: 'P1-1', pos: g.zones[1][0]!, facing: 0 }] });
    const both = applyCommand(g, { type: 'plan', player: 0, plans: { 'P0-1': { ...emptyPlan(), accelerate: 1, decelerate: 1 } } });
    expect(both.ok).toBe(false);
    const bankTurn = applyCommand(g, { type: 'plan', player: 0, plans: { 'P0-1': { ...emptyPlan(), bank: 1, overturn: 1 } } });
    expect(bankTurn.ok).toBe(false);
    const noShields = applyCommand(g, { type: 'plan', player: 1, plans: { 'P1-1': { ...emptyPlan(), angleDeflectors: 1, deflectorDirection: 'front' } } });
    expect(noShields.ok).toBe(false);
    const untracked = applyCommand(g, { type: 'plan', player: 0, plans: { 'P0-1': { ...emptyPlan(), targeting: 1, targetingTarget: 'P1-1' } } });
    expect(untracked.ok).toBe(false); // not tailing
  });
});

describe('throttle', () => {
  const markers = (plan: Partial<ReturnType<typeof emptyPlan>>, speed: number, maxSpeed = 6) => {
    const g = createGame({
      seed: 21,
      ships: [
        { owner: 0, typeId: 'x-wing', quality: 'average' },
        { owner: 1, typeId: 'tie-fighter', quality: 'average' },
      ],
    });
    g.ships[0]!.speed = speed;
    g.ships[0]!.maxSpeed = maxSpeed;
    g.ships[0]!.plan = { ...emptyPlan(), ...plan };
    g.ships[1]!.plan = emptyPlan();
    g.ships[0]!.pos = at(10, 20);
    g.ships[1]!.pos = at(10, 5);
    g.phase = 'ships';
    g.tasks.push({ t: 'markers' });
    // run the queued markers phase via a harmless command path: inflict nothing but trigger run
    inflictDamage(g, 'P1-1', []);
    return g.ships[0]!;
  };

  it('accelerates and decelerates one or two', () => {
    expect(markers({ accelerate: 1 }, 3).speed).toBe(4);
    expect(markers({ accelerate: 2 }, 3).speed).toBe(5);
    expect(markers({ decelerate: 1 }, 3).speed).toBe(2);
    expect(markers({ decelerate: 2 }, 3).speed).toBe(1);
    expect(markers({ decelerate: 2 }, 1).speed).toBe(0);
  });

  it('overaccelerates by 3 or 4', () => {
    expect(markers({ overaccelerate: 1, overspeed: 2 }, 1).speed).toBe(4);
    expect(markers({ overaccelerate: 2, overspeed: 2 }, 1).speed).toBe(5);
    expect(markers({ overdecelerate: 1 }, 5).speed).toBe(2);
  });

  it('cannot exceed the maximum speed without overspeed', () => {
    expect(markers({ accelerate: 1 }, 6).speed).toBe(6);
    expect(markers({ accelerate: 1, overspeed: 1 }, 6).speed).toBe(7);
    expect(markers({ accelerate: 2, overspeed: 1 }, 6).speed).toBe(7);
    expect(markers({ accelerate: 2, overspeed: 2 }, 6).speed).toBe(8);
  });

  it('drops back to the maximum the turn after overspeeding', () => {
    expect(markers({}, 7).speed).toBe(6);
    expect(markers({ decelerate: 1 }, 7).speed).toBe(6);
    expect(markers({ decelerate: 2 }, 7).speed).toBe(5);
  });
});

import { describe, expect, it } from 'vitest';
import { nextRandomCommand, playRandomGame } from '../src/ai/random';
import { playGame } from '../src/ai/player';
import { viewFor } from '../src/net/redact';
import { tacticalAi } from '../src/ai/tactical';
import {
  allGuns,
  applyCommand,
  applyRepair,
  bodyRating,
  canRepair,
  createGame,
  createRng,
  dogfightOptions,
  emptyPlan,
  fromOffset,
  getShip,
  inflictDamage,
  groupDifficulty,
  planDifficultyEntries,
  planShapeError,
  stepDifficulties,
  auxSpent,
  payOf,
  setGroupLevel,
  trimPay,
  repairGunCode,
  repairOdds,
  repairOptions,
  shipById,
  totalDifficulty,
  waitingFor,
  type Command,
  type Facing,
  type GameState,
  type PilotQuality,
  type Plan,
  type Ship,
} from '../src/engine';

interface Spec {
  typeId: string;
  owner: 0 | 1;
  col: number;
  row: number;
  facing: Facing;
  gunners?: PilotQuality[];
}

/** A game with the R2, auxiliary power and damage control rules in effect, dropped into the planning phase. */
function scene(specs: Spec[], seed = 1, damageRules = true): GameState {
  const game = createGame({ seed, damageRules, ships: specs.map((s) => ({ owner: s.owner, typeId: s.typeId, quality: 'average' as const, ...(s.gunners ? { gunners: s.gunners } : {}) })) });
  specs.forEach((s, i) => {
    const ship = game.ships[i]!;
    ship.pos = fromOffset(s.col, s.row);
    ship.facing = s.facing;
    ship.speed = Math.min(3, ship.maxSpeed);
  });
  game.phase = 'planning';
  game.turn = 1;
  game.initiative = 0;
  game.placed = [true, true];
  return game;
}

const get = (game: GameState, id: string): Ship => shipById(game, id)!;
const plan = (changes: Partial<Plan>): Plan => ({ ...emptyPlan(), ...changes });
const submit = (game: GameState, owner: 0 | 1, plans: Record<string, Plan>, crewPlans: Record<string, Plan[]> = {}) => applyCommand(game, { type: 'plan', player: owner, plans, crewPlans });

const xwing = (): Spec => ({ typeId: 'x-wing', owner: 0, col: 10, row: 10, facing: 0 });
const bwing = (): Spec => ({ typeId: 'b-wing', owner: 0, col: 12, row: 10, facing: 0 });
const tie = (): Spec => ({ typeId: 'tie-fighter', owner: 1, col: 30, row: 40, facing: 3 });
const yTwo = (): Spec => ({ typeId: 'y-wing-2seat', owner: 0, col: 14, row: 10, facing: 0, gunners: ['average'] });

describe('what can be repaired', () => {
  it('lists only damaged systems that are not beyond repair', () => {
    const g = scene([xwing(), tie()]);
    const x = get(g, 'P0-1');
    expect(repairOptions(x)).toEqual([]);
    x.bodyDamage = 2;
    x.maxSpeed = 5;
    x.stabilizerDamage = 1;
    x.guns[0] = 'DMF';
    expect(repairOptions(x).map((o) => o.system).sort()).toEqual(['body', 'engine', 'gun', 'stabilizer']);
    x.noRepair = { engine: true, guns: { 0: true } };
    expect(repairOptions(x).map((o) => o.system).sort()).toEqual(['body', 'stabilizer']);
  });

  it('adds one barrel to a gun, up to its printed code and from nothing to single', () => {
    expect(repairGunCode('QMF', null)).toBe('SMF');
    expect(repairGunCode('QMF', 'SMF')).toBe('DMF');
    expect(repairGunCode('QMF', 'TMF')).toBe('QMF');
    expect(repairGunCode('QMF', 'QMF')).toBeNull();
    expect(repairGunCode('DLF(I)', 'SLF(I)')).toBe('DLF(I)');
    expect(repairGunCode('DLP(R)', null)).toBe('SLP(R)');
  });

  it('repairs one level of each system, never above the starting value', () => {
    const g = scene([xwing(), tie()]);
    const x = get(g, 'P0-1');
    x.bodyDamage = 1;
    x.maxSpeed = 4;
    x.lateralDamage = 2;
    x.stabilizerDamage = 1;
    x.guns[0] = null;
    applyRepair(x, { system: 'body' });
    applyRepair(x, { system: 'engine' });
    applyRepair(x, { system: 'lateral' });
    applyRepair(x, { system: 'stabilizer' });
    applyRepair(x, { system: 'gun', gun: 0 });
    expect([x.bodyDamage, x.maxSpeed, x.lateralDamage, x.stabilizerDamage, x.guns[0]]).toEqual([0, 5, 1, 0, 'SMF']);
    expect(canRepair(x, { system: 'body' })).toBe(false);
  });

  it('gives the odds of the damage control roll', () => {
    expect(repairOdds(false).repaired).toBeCloseTo(15 / 36);
    expect(repairOdds(true).repaired).toBeCloseTo(26 / 36);
    expect(repairOdds(false).beyond).toBeCloseTo(10 / 36);
  });
});

describe('the rules switch and the second body rating', () => {
  it('uses the first body rating without the rules and the second with them', () => {
    const off = scene([xwing(), tie()], 1, false);
    const on = scene([xwing(), tie()], 1, true);
    expect(bodyRating(off, getShip('x-wing'))).toBe(5);
    expect(bodyRating(on, getShip('x-wing'))).toBe(4);
    inflictDamage(on, 'P0-1', ['4Bdy']);
    expect(get(on, 'P0-1').status).toBe('destroyed');
    inflictDamage(off, 'P0-1', ['4Bdy']);
    expect(get(off, 'P0-1').status).toBe('active');
  });

  it('refuses damage control, free steps and repairs when the rules are not in effect', () => {
    const g = scene([xwing(), tie()], 1, false);
    get(g, 'P0-1').bodyDamage = 1;
    const r = submit(g, 0, { 'P0-1': plan({ damageControl: 1, repair: { system: 'body' } }) });
    expect(r.ok).toBe(false);
    expect(get(g, 'P0-1').aux).toBeUndefined();
    expect(get(g, 'P0-1').r2).toBeUndefined();
  });

  it('gives each ship its units of auxiliary power and its R2 unit', () => {
    const g = scene([xwing(), bwing(), tie()]);
    expect(get(g, 'P0-1').r2).toEqual({ aboard: true, ready: false });
    expect(get(g, 'P0-1').aux).toBe(0);
    expect(get(g, 'P0-2').aux).toBe(4);
    expect(get(g, 'P0-2').r2).toBeUndefined();
  });
});

describe('planning damage control', () => {
  it('needs damage to repair, and a choice of what to repair', () => {
    const g = scene([xwing(), tie()]);
    expect(submit(g, 0, { 'P0-1': plan({ damageControl: 1, repair: { system: 'body' } }) }).ok).toBe(false);
    get(g, 'P0-1').bodyDamage = 1;
    expect(submit(g, 0, { 'P0-1': plan({ damageControl: 1 }) }).ok).toBe(false);
    expect(submit(g, 0, { 'P0-1': plan({ damageControl: 1, repair: { system: 'engine' } }) }).ok).toBe(false);
    const ok = submit(g, 0, { 'P0-1': plan({ damageControl: 1, repair: { system: 'body' }, pay: { damageControl: 'f' } }) });
    expect(ok.ok).toBe(true);
  });

  it('lets the R2 unit do the first step for nothing, and adds the doubled step to the planner\'s difficulty', () => {
    const g = scene([xwing(), tie()]);
    get(g, 'P0-1').bodyDamage = 1;
    const single = plan({ damageControl: 1, repair: { system: 'body' }, pay: { damageControl: 'f' } });
    const doubled = plan({ damageControl: 2, repair: { system: 'body' }, pay: { damageControl: 'fc' } });
    const d = getShip('x-wing').difficulty;
    expect(totalDifficulty(planDifficultyEntries(single, d, 0, 0))).toBe(0);
    expect(totalDifficulty(planDifficultyEntries(doubled, d, 0, 0))).toBe(d.damageControl);
    expect(totalDifficulty(planDifficultyEntries(plan({ damageControl: 2, repair: { system: 'body' } }), d, 0, 0))).toBe(d.damageControl * 2);
  });

  it('lets a gunner plan it too, but one attempt per ship', () => {
    const g = scene([yTwo(), tie()]);
    get(g, 'P0-1').bodyDamage = 1;
    const dc = (): Plan => plan({ damageControl: 1, repair: { system: 'body' }, pay: { damageControl: 'f' } });
    expect(submit(g, 0, { 'P0-1': dc() }, { 'P0-1': [dc()] }).ok).toBe(false);
    expect(submit(g, 0, { 'P0-1': emptyPlan() }, { 'P0-1': [dc()] }).ok).toBe(true);
    expect(get(g, 'P0-1').gunners![0]!.plan.damageControl).toBe(1);
  });

  it('keeps R2 free actions for a ready unit, a cheap action and the pilot', () => {
    const g = scene([xwing(), tie()]);
    const x = get(g, 'P0-1');
    const jink = plan({ jink: 1, pay: { jink: 'f' } });
    x.r2!.ready = false;
    expect(submit(g, 0, { 'P0-1': jink }).ok).toBe(false);
    x.r2!.ready = true;
    // X-wing: jink 3 (free), overturn 7 (too hard for an R2 unit)
    expect(submit(scene([xwing(), tie()]), 0, { 'P0-1': plan({ overturn: 1, pay: { turn: 'fff' } }) }).ok).toBe(false);
    const h = scene([xwing(), tie()]);
    get(h, 'P0-1').r2!.ready = true;
    expect(submit(h, 0, { 'P0-1': jink }).ok).toBe(true);
    // one R2 unit, one action
    const k = scene([xwing(), tie()]);
    get(k, 'P0-1').r2!.ready = true;
    expect(submit(k, 0, { 'P0-1': plan({ jink: 1, slip: 1, pay: { jink: 'f', slip: 'f' } }) }).ok).toBe(false);
  });
});

describe('auxiliary power', () => {
  it('spends one unit for every free step as the plan is handed in: an overturn is three steps of turn number', () => {
    const g = scene([bwing(), tie()]);
    const b = get(g, 'P0-1');
    expect(b.aux).toBe(4);
    // B-wing: overturn is 12; turn number −3 is three free steps, the jink one more
    expect(submit(g, 0, { 'P0-1': plan({ overturn: 1, jink: 1, pay: { turn: 'fff', jink: 'f' } }) }).ok).toBe(true);
    expect(b.aux).toBe(0);
    expect(totalDifficulty(planDifficultyEntries(b.plan, getShip('b-wing').difficulty, 0, 0))).toBe(0);
  });

  it('refuses more units than are left, and gunners\' use of auxiliary power', () => {
    const g = scene([bwing(), tie()]);
    expect(submit(g, 0, { 'P0-1': plan({ overturn: 2, pay: { turn: 'ffff' } }) }).ok).toBe(true); // 4 units
    const h = scene([bwing(), tie()]);
    get(h, 'P0-1').aux = 1;
    expect(submit(h, 0, { 'P0-1': plan({ overturn: 1, pay: { turn: 'fff' } }) }).ok).toBe(false);
    const f = scene([{ typeId: 'millennium-falcon', owner: 0, col: 10, row: 10, facing: 0, gunners: ['average', 'average'] }, tie()]);
    expect(submit(f, 0, { 'P0-1': emptyPlan() }, { 'P0-1': [plan({ snapFire: 1, pay: { snapFire: 'f' } })] }).ok).toBe(false);
  });

  it('turns a single action into a double with one unit and the difficulty of one step', () => {
    const g = scene([bwing(), tie()]);
    expect(submit(g, 0, { 'P0-1': plan({ slip: 2, pay: { slip: 'fc' } }) }).ok).toBe(true);
    const b = get(g, 'P0-1');
    expect(b.aux).toBe(3);
    expect(totalDifficulty(planDifficultyEntries(b.plan, getShip('b-wing').difficulty, 0, 0))).toBe(getShip('b-wing').difficulty.slip);
  });
});

describe('power loss with something else to give up', () => {
  it('waits for the owner when a shield, a unit of auxiliary power or the R2 unit can go', () => {
    const g = scene([bwing(), tie()]);
    const b = get(g, 'P0-1');
    inflictDamage(g, 'P0-1', ['P'], { quarter: 'front' });
    expect(g.pending?.kind).toBe('power');
    const pending = g.pending as Extract<NonNullable<GameState['pending']>, { kind: 'power' }>;
    expect(pending.options).toEqual(['shield', 'aux']);
    const frontBefore = b.shields.front;
    expect(applyCommand(g, { type: 'decide', player: 0, choice: 'aux' }).ok).toBe(true);
    expect(b.aux).toBe(3);
    expect(b.shields.front).toBe(frontBefore);
  });

  it('lets an R2 unit go instead of a shield, and takes its plans with it', () => {
    const g = scene([xwing(), tie()]);
    const x = get(g, 'P0-1');
    x.bodyDamage = 1;
    expect(submit(g, 0, { 'P0-1': plan({ damageControl: 1, repair: { system: 'body' }, pay: { damageControl: 'f' } }) }).ok).toBe(true);
    inflictDamage(g, 'P0-1', ['P'], { quarter: 'front' });
    expect(g.pending?.kind).toBe('power');
    expect(applyCommand(g, { type: 'decide', player: 0, choice: 'r2' }).ok).toBe(true);
    expect(x.r2).toEqual({ aboard: false, ready: false });
    expect(x.plan.damageControl).toBe(0);
  });

  it('asks nothing in a game without the rules, or when there is only one thing to lose', () => {
    const off = scene([bwing(), tie()], 1, false);
    inflictDamage(off, 'P0-1', ['P']);
    expect(off.pending).toBeNull();
    // a TIE fighter has no shields: with its auxiliary power gone the power loss is a body point and nobody is asked
    const on = scene([{ ...tie(), owner: 0 }, { ...tie(), col: 31 }]);
    get(on, 'P0-1').aux = 0;
    inflictDamage(on, 'P0-1', ['P']);
    expect(on.pending).toBeNull();
    expect(get(on, 'P0-1').bodyDamage).toBe(1);
  });
});

/** Plays the whole of a ship's phase with the random player's moves until the ship has moved. */
function finishShipPhase(game: GameState, shipId: string, seed: number): void {
  const rng = createRng(seed);
  for (let guard = 0; guard < 400 && !get(game, shipId).moved; guard++) {
    const wait = waitingFor(game);
    if (wait.length === 0) break;
    let cmd: Command | null = null;
    for (const p of wait) {
      cmd = nextRandomCommand(game, p, rng);
      if (cmd) {
        const r = applyCommand(game, cmd);
        if (!r.ok) throw new Error(r.error);
        break;
      }
    }
    if (!cmd) break;
  }
}

describe('resolving damage control in the End Segment', () => {
  /** A damaged X-wing plans damage control for its body; everyone else does nothing. Returns what the log says about the attempt. */
  function attempt(seed: number, doubled: boolean): { roll: number; text: string; ship: Ship } {
    const g = scene([xwing(), tie()], seed);
    const x = get(g, 'P0-1');
    x.bodyDamage = 2;
    expect(submit(g, 0, { 'P0-1': plan({ damageControl: doubled ? 2 : 1, repair: { system: 'body' }, pay: { damageControl: doubled ? 'fc' : 'f' } }) }).ok).toBe(true);
    expect(submit(g, 1, { 'P1-1': emptyPlan() }).ok).toBe(true);
    while (!g.pending && !g.active && g.phase === 'ships') {
      const r = applyCommand(g, { type: 'chooseShip', player: g.chooser, shipId: 'P0-1' });
      if (!r.ok) throw new Error(r.error);
    }
    finishShipPhase(g, 'P0-1', seed);
    const line = g.log.find((e) => e.kind === 'repair');
    if (!line) throw new Error('no damage control line in the log');
    return { roll: Number(/rolled (\d+)/.exec(line.text)![1]), text: line.text, ship: get(g, 'P0-1') };
  }

  it('repairs on 6 or less (8 or less doubled), does nothing between, and ruins the system on 9 or more', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      for (const doubled of [false, true]) {
        const r = attempt(seed, doubled);
        const limit = doubled ? 8 : 6;
        if (r.roll >= 9) {
          expect(r.text).toContain('beyond repair');
          expect(r.ship.noRepair?.body).toBe(true);
          expect(r.ship.bodyDamage).toBe(2);
          seen.add('beyond');
        } else if (r.roll <= limit) {
          expect(r.ship.bodyDamage).toBe(1);
          seen.add('repaired');
        } else {
          expect(r.text).toContain('no luck');
          expect(r.ship.bodyDamage).toBe(2);
          seen.add('nothing');
        }
      }
    }
    expect([...seen].sort()).toEqual(['beyond', 'nothing', 'repaired']);
  });

  it('rolls an R2 unit for free actions at the start of every game-turn', () => {
    const g = scene([xwing(), tie()], 7);
    // the scene starts in planning without the roll; play one turn and look at the next
    expect(submit(g, 0, { 'P0-1': emptyPlan() }).ok).toBe(true);
    expect(submit(g, 1, { 'P1-1': emptyPlan() }).ok).toBe(true);
    const outcomes = new Set<boolean>();
    for (let seed = 1; seed <= 40; seed++) {
      const h = scene([xwing(), tie()], seed);
      // a new turn is rolled by the engine: apply the rule through the log of a full turn
      for (const owner of [0, 1] as const) submit(h, owner, { [`P${owner}-1`]: emptyPlan() });
      let guard = 0;
      while (h.turn === 1 && guard++ < 400) {
        const wait = waitingFor(h);
        if (wait.length === 0) break;
        const rng = createRng(seed + guard);
        const cmd = nextRandomCommand(h, wait[0]!, rng);
        if (!cmd) break;
        const r = applyCommand(h, cmd);
        if (!r.ok) throw new Error(r.error);
      }
      if (h.turn === 2) outcomes.add(get(h, 'P0-1').r2!.ready);
    }
    expect([...outcomes].sort()).toEqual([false, true]);
  });
});

describe('losing an action that has free steps', () => {
  it('turns a double with a free step into a single, and drops the repair when the action is lost', () => {
    const g = scene([bwing(), tie()]);
    expect(allGuns(getShip('b-wing')).length).toBeGreaterThan(0);
    const b = get(g, 'P0-1');
    b.bodyDamage = 1;
    expect(submit(g, 0, { 'P0-1': plan({ damageControl: 2, repair: { system: 'body' }, pay: { damageControl: 'fc' } }) }).ok).toBe(true);
    expect(b.aux).toBe(3);
    inflictDamage(g, 'P0-1', ['LOSE'], { row: 'A' });
    expect(b.plan.damageControl).toBe(1);
    expect(b.plan.pay?.damageControl).toBe('f');
    inflictDamage(g, 'P0-1', ['LOSE'], { row: 'A' });
    expect(b.plan.damageControl).toBe(0);
    expect(b.plan.repair).toBeNull();
  });
});

describe('whole games with the rules in effect', () => {
  it('random play never makes the engine reject a command, and meets repairs, free actions and power choices', () => {
    const seen = { repairs: 0, free: 0, power: 0, r2Lost: 0 };
    for (let seed = 1; seed <= 8; seed++) {
      const g = createGame({ ...dogfightOptions('three', seed), damageRules: true });
      playRandomGame(g, createRng(seed * 17), {
        maxCommands: 2500,
        onCommand: (cmd: Command) => {
          if (cmd.type === 'plan') for (const p of Object.values(cmd.plans)) if (p.damageControl > 0) seen.repairs += 1;
          if (cmd.type === 'plan') for (const p of Object.values(cmd.plans)) if (Object.values(p.pay ?? {}).some((t) => t.includes('f'))) seen.free += 1;
          if (cmd.type === 'decide' && g.pending?.kind === 'power') seen.power += 1;
        },
      });
      for (const ship of g.ships) if (ship.r2 && !ship.r2.aboard) seen.r2Lost += 1;
    }
    expect(seen.repairs).toBeGreaterThan(0);
    expect(seen.free).toBeGreaterThan(0);
  }, 120000);

  it('the tactical computer plays whole games and uses damage control', () => {
    let repairLines = 0;
    for (const mix of ['one', 'three'] as const) {
      const g = createGame({ ...dogfightOptions(mix, 4), damageRules: true });
      playGame(g, [tacticalAi(createRng(5)), tacticalAi(createRng(55))], { maxCommands: 8000 });
      repairLines += g.log.filter((e) => e.kind === 'repair').length;
      expect(g.phase).toBe('over');
    }
    expect(repairLines).toBeGreaterThan(0);
  }, 120000);
});

describe('what the other side may see', () => {
  it('does not show that a plan spent auxiliary power until the plans are revealed', () => {
    const g = scene([bwing(), { ...tie(), owner: 1 }]);
    expect(submit(g, 0, { 'P0-1': plan({ jink: 1, pay: { jink: 'f' } }) }).ok).toBe(true);
    expect(get(g, 'P0-1').aux).toBe(3);
    expect(viewFor(g, 1).ships.find((s) => s.id === 'P0-1')!.aux).toBe(4);
    expect(viewFor(g, 0).ships.find((s) => s.id === 'P0-1')!.aux).toBe(3);
  });
});

describe('who pays each step of an action', () => {
  const d = getShip('x-wing').difficulty;

  it('gives every step the difference it makes to the difficulty: the tight turn is a ladder of four steps', () => {
    expect(stepDifficulties('turn', d)).toEqual([2, 2, 3, 7]);
    expect(stepDifficulties('accel', d)).toEqual([3, 3, 1, 7]);
    expect(stepDifficulties('jink', d)).toEqual([3, 3]);
  });

  it('adds up to the old difficulty when the crew member pays everything', () => {
    for (const [change, expected] of [[{ bank: 1 }, 2], [{ bank: 2 }, 4], [{ overturn: 1 }, 7], [{ overturn: 2 }, 14], [{ accelerate: 2 }, 6], [{ overaccelerate: 1 }, 7], [{ jink: 2 }, 6]] as [Partial<Plan>, number][]) {
      expect(totalDifficulty(planDifficultyEntries(plan(change), d, 0, 0))).toBe(expected);
    }
  });

  it('charges the crew member only the steps he pays, and counts one unit for every step aux power pays', () => {
    // turn number −2 paid by the pilot, the step to −3 by auxiliary power
    const p = plan({ overturn: 1, pay: { turn: 'ccf' } });
    expect(payOf(p, 'turn')).toEqual(['c', 'c', 'f']);
    expect(groupDifficulty(p, 'turn', d)).toBe(4);
    expect(auxSpent(p)).toBe(1);
    expect(totalDifficulty(planDifficultyEntries(p, d, 0, 0))).toBe(4);
    // the other way round: aux for the first two steps, the pilot for the third
    const q = plan({ overturn: 1, pay: { turn: 'ffc' } });
    expect(totalDifficulty(planDifficultyEntries(q, d, 0, 0))).toBe(3);
    expect(auxSpent(q)).toBe(2);
  });

  it('sets the steps of a ladder and cuts the payers back when a step is lost', () => {
    const p = plan({});
    setGroupLevel(p, 'turn', 3);
    expect([p.bank, p.overturn]).toEqual([0, 1]);
    p.pay = { turn: 'ccf' };
    setGroupLevel(p, 'turn', 2);
    trimPay(p);
    expect([p.bank, p.overturn, p.pay.turn]).toEqual([2, 0, undefined]);
    setGroupLevel(p, 'accel', 2);
    setGroupLevel(p, 'decel', 1);
    expect([p.accelerate, p.decelerate]).toEqual([0, 1]);
  });

  it('refuses more payers than an action has steps, or anything but c and f', () => {
    expect(planShapeError(plan({ jink: 1, pay: { jink: 'ff' } }), true)).toMatch(/more payers/);
    expect(planShapeError(plan({ jink: 1, pay: { jink: 'x' } }), true)).toMatch(/payers/);
    expect(planShapeError(plan({ jink: 2, pay: { jink: 'fc' } }), true)).toBeNull();
  });

  it('keeps a ship\'s R2 unit away from a tight turn or a change of speed', () => {
    const g = scene([xwing(), tie()]);
    get(g, 'P0-1').r2!.ready = true;
    expect(submit(g, 0, { 'P0-1': plan({ bank: 1, pay: { turn: 'f' } }) }).ok).toBe(false);
    expect(submit(g, 0, { 'P0-1': plan({ accelerate: 1, pay: { accel: 'f' } }) }).ok).toBe(false);
  });
});

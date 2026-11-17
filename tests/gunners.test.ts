import { describe, expect, it } from 'vitest';
import { playGame } from '../src/ai/player';
import { tacticalAi } from '../src/ai/tactical';
import {
  applyCommand,
  createGame,
  createRng,
  crewGuns,
  emptyPlan,
  fromOffset,
  inflictDamage,
  pilotGunOptions,
  scenarioOptions,
  shipById,
  waitingFor,
  type Command,
  type Facing,
  type ForceShip,
  type GameState,
  type PilotQuality,
  type Plan,
  type Ship,
} from '../src/engine';
import { viewFor } from '../src/net/redact';

interface Spec {
  typeId: string;
  owner: 0 | 1;
  col: number;
  row: number;
  facing: Facing;
  gunners?: PilotQuality[];
}

/** A game dropped into the planning phase, ships where we want them (ids P0-1, P0-2 ..., P1-1 ...). */
function scene(specs: Spec[], seed = 1): GameState {
  const game = createGame({ seed, ships: specs.map((s) => ({ owner: s.owner, typeId: s.typeId, quality: 'average' as const, ...(s.gunners ? { gunners: s.gunners } : {}) })) });
  specs.forEach((s, i) => {
    const ship = game.ships[i]!;
    ship.pos = fromOffset(s.col, s.row);
    ship.facing = s.facing;
    ship.speed = 0;
  });
  game.phase = 'planning';
  game.turn = 1;
  game.initiative = 0;
  game.placed = [true, true];
  return game;
}

const ok = (game: GameState, cmd: Command) => {
  const result = applyCommand(game, cmd);
  if (!result.ok) throw new Error(result.error);
  return result;
};
const get = (game: GameState, id: string): Ship => shipById(game, id)!;
const plan = (changes: Partial<Plan>): Plan => ({ ...emptyPlan(), ...changes });

/** Both players hand in plans: `mine` as given, everything else empty. */
function planAll(game: GameState, pilot: Record<string, Plan> = {}, crew: Record<string, Plan[]> = {}): void {
  for (const owner of [0, 1] as const) {
    const ships = game.ships.filter((s) => s.owner === owner && s.status === 'active');
    const plans = Object.fromEntries(ships.map((s) => [s.id, pilot[s.id] ?? emptyPlan()]));
    const crewPlans = Object.fromEntries(ships.filter((s) => crew[s.id]).map((s) => [s.id, crew[s.id]!]));
    ok(game, { type: 'plan', player: owner, plans, crewPlans });
  }
}

const falcon = (extra: Partial<Spec> = {}): Spec => ({ typeId: 'millennium-falcon', owner: 0, col: 10, row: 20, facing: 0, gunners: ['average', 'veteran'], ...extra });
const tie = (col: number, row: number, facing: Facing = 3): Spec => ({ typeId: 'tie-fighter', owner: 1, col, row, facing });

describe('whose gun is whose', () => {
  it('gives each gunner his turret, the pilot his own guns, and the Lambda\'s rear gun to its gunner alone', () => {
    const g = scene([falcon(), { typeId: 'imperial-shuttle', owner: 1, col: 10, row: 10, facing: 3, gunners: ['poor'] }, { typeId: 'y-wing-2seat', owner: 0, col: 14, row: 20, facing: 0, gunners: ['average'] }]);
    const f = get(g, 'P0-1');
    expect(f.guns).toEqual(['QMP', 'QMP']);
    expect(crewGuns(f, 'gunner1')).toEqual([0]);
    expect(crewGuns(f, 'gunner2')).toEqual([1]);
    expect(crewGuns(f, 'pilot')).toEqual([0, 1]);
    const lambda = get(g, 'P1-1');
    expect(lambda.guns).toEqual(['QLS', 'QMF', 'DLP(R)']);
    expect(crewGuns(lambda, 'pilot')).toEqual([0, 1]);
    expect(crewGuns(lambda, 'gunner1')).toEqual([2]);
    // a hazard hurts the pilot's own guns; with none of his own, the turrets
    expect(pilotGunOptions(f)).toEqual([0, 1]);
    expect(pilotGunOptions(get(g, 'P0-2'))).toEqual([0]);
  });

  it('starts every gunner with an empty plan', () => {
    const g = scene([falcon(), tie(10, 10)]);
    expect(get(g, 'P0-1').gunners!.map((x) => x.plan)).toEqual([emptyPlan(), emptyPlan()]);
  });
});

describe('planning with gunners', () => {
  const g0 = () => scene([falcon(), tie(10, 14)]);
  const submit = (g: GameState, crew: Plan[], pilot: Plan = emptyPlan()) =>
    applyCommand(g, { type: 'plan', player: 0, plans: { 'P0-1': pilot }, crewPlans: { 'P0-1': crew } });

  it('accepts pinpoint fire, snap fire, targeting and angling deflectors for a gunner, and stores them', () => {
    const g = g0();
    expect(submit(g, [plan({ pinpointFire: 1, snapFire: 2 }), plan({ angleDeflectors: 1, deflectorDirection: 'rear' })]).ok).toBe(true);
    expect(get(g, 'P0-1').gunners![0]!.plan.snapFire).toBe(2);
    expect(get(g, 'P0-1').gunners![1]!.plan.angleDeflectors).toBe(1);
    expect(get(g, 'P0-1').plan.pinpointFire).toBe(0);
  });

  it('refuses a gunner every other action', () => {
    for (const bad of [plan({ slip: 1 }), plan({ roll: 1 }), plan({ accelerate: 1 }), plan({ bank: 1 }), plan({ halfLoop: 1 })]) {
      const result = submit(g0(), [bad]);
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toMatch(/gunner may only plan/);
    }
  });

  it('refuses plans for gunners the ship does not have, for a dead gunner, and two crew moving the shields', () => {
    expect(submit(g0(), [emptyPlan(), emptyPlan(), emptyPlan()]).ok).toBe(false);
    const dead = g0();
    get(dead, 'P0-1').gunners![0]!.dead = true;
    expect(submit(dead, [plan({ pinpointFire: 1 })]).ok).toBe(false);
    const shields = plan({ angleDeflectors: 1, deflectorDirection: 'front' });
    expect(submit(g0(), [shields, shields]).ok).toBe(false);
    expect(submit(g0(), [shields], shields).ok).toBe(false);
  });

  it('lets a gunner track an enemy that faces the same way even when it is not tailed, and nobody else', () => {
    // the TIE ahead of the Falcon and facing the same way (north): not tailing (it is not in the Falcon's rear arc... the Falcon is in its rear arc, so it is tailed)
    const same = scene([falcon({ col: 10, row: 20 }), { typeId: 'tie-fighter', owner: 1, col: 13, row: 20, facing: 0 }]);
    const track = plan({ targeting: 1, targetingTarget: 'P1-1' });
    expect(applyCommand(same, { type: 'plan', player: 0, plans: { 'P0-1': emptyPlan() }, crewPlans: { 'P0-1': [track] } }).ok).toBe(true);
    const pilotTry = scene([falcon({ col: 10, row: 20 }), { typeId: 'tie-fighter', owner: 1, col: 13, row: 20, facing: 0 }]);
    const refused = applyCommand(pilotTry, { type: 'plan', player: 0, plans: { 'P0-1': track } });
    expect(refused.ok).toBe(false);
    // a gunner cannot track an enemy that faces another way
    const other = scene([falcon({ col: 10, row: 20 }), { typeId: 'tie-fighter', owner: 1, col: 13, row: 20, facing: 3 }]);
    expect(applyCommand(other, { type: 'plan', player: 0, plans: { 'P0-1': emptyPlan() }, crewPlans: { 'P0-1': [track] } }).ok).toBe(false);
  });

  it('puts one tracking marker on the ship, whoever planned it', () => {
    const g = scene([falcon({ col: 10, row: 20 }), { typeId: 'tie-fighter', owner: 1, col: 13, row: 20, facing: 0 }]);
    planAll(g, {}, { 'P0-1': [plan({ targeting: 1, targetingTarget: 'P1-1' })] });
    expect(get(g, 'P0-1').tracking).toEqual({ target: 'P1-1', level: 1 });
  });
});

describe('hazards for each crew member', () => {
  it('makes a gunner roll against his own actions with his own skill, and not at all when he planned nothing', () => {
    const g = scene([falcon(), tie(10, 14)], 4);
    get(g, 'P0-1').gunners![0]!.skill = { dice: 1, pips: 0 };
    planAll(g, {}, { 'P0-1': [plan({ pinpointFire: 2, snapFire: 2 })] });
    const lines = g.log.filter((e) => e.kind === 'hazard').map((e) => e.text);
    const gunnerLine = lines.find((l) => l.includes('(gunner 1)'));
    expect(gunnerLine).toMatch(/difficulty 16/); // pinpoint 4 x2 + snap 4 x2
    expect(gunnerLine).toMatch(/gunnery 1D/);
    expect(lines.some((l) => l.includes('(gunner 2)'))).toBe(false);
  });

  it('lets a gunner suffer only action penalties, LOSE, power loss and gun damage', () => {
    let hazards = 0;
    let effects = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const g = scene([falcon(), tie(10, 14)], seed);
      get(g, 'P0-1').gunners![0]!.skill = { dice: 1, pips: 0 };
      get(g, 'P0-1').gunners![1]!.skill = { dice: 1, pips: 0 };
      planAll(g, {}, { 'P0-1': [plan({ pinpointFire: 2, snapFire: 2, angleDeflectors: 1, deflectorDirection: 'rear' }), plan({ pinpointFire: 2 })] });
      // the game may stop at a decision (which action to lose, which gun): answer anything
      for (let n = 0; n < 12 && g.pending; n++) {
        const p = g.pending;
        ok(g, { type: 'decide', player: p.player, choice: p.kind === 'lose' || p.kind === 'skill' ? p.options[0]! : p.kind === 'gun' ? p.options[0]! : null });
      }
      const f = get(g, 'P0-1');
      hazards += g.log.filter((e) => e.kind === 'hazardRoll').length;
      // none of the effects a gunner is spared
      expect(f.stabilizerDamage).toBe(0);
      expect(f.lateralDamage).toBe(0);
      expect(f.forcedRoll).toBe(0);
      expect(f.turnPenalty).toBe(0);
      expect(f.maxSpeed).toBe(6);
      // but the ones it does suffer do happen: a penalty, a lost shield or a damaged gun
      if (f.pendingPenalty > 0 || f.shields.front + f.shields.rear < 8 || f.guns.some((c) => c !== 'QMP')) effects += 1;
    }
    expect(hazards).toBeGreaterThan(20);
    expect(effects).toBeGreaterThan(5);
  });

  it('takes the action lost from the gunner who caused the hazard, not from the pilot', () => {
    const g = scene([falcon(), tie(10, 14)]);
    const f = get(g, 'P0-1');
    f.plan = plan({ pinpointFire: 1, snapFire: 1 });
    f.gunners![0]!.plan = plan({ pinpointFire: 1, snapFire: 1 });
    inflictDamage(g, 'P0-1', ['LOSE'], { row: 'F', crew: 'gunner1' });
    expect(g.pending).toMatchObject({ kind: 'lose', crew: 'gunner1' });
    ok(g, { type: 'decide', player: 0, choice: 'snapFire' });
    expect(f.gunners![0]!.plan.snapFire).toBe(0);
    expect(f.gunners![0]!.plan.pinpointFire).toBe(1);
    expect(f.plan.snapFire).toBe(1);
  });

  it('takes a gun of the crew member who caused a gun hit: his turret, or a turret of the pilot when he has no gun of his own', () => {
    const g = scene([falcon(), { typeId: 'y-wing-2seat', owner: 0, col: 14, row: 20, facing: 0, gunners: ['average'] }, tie(10, 14)]);
    inflictDamage(g, 'P0-1', ['G'], { row: 'F', crew: 'gunner2' });
    expect(get(g, 'P0-1').guns).toEqual(['QMP', 'TMP']);
    // the Falcon's pilot has no gun of his own: a turret, his choice
    inflictDamage(g, 'P0-1', ['G'], { row: 'F' });
    expect(g.pending).toMatchObject({ kind: 'gun' });
    ok(g, { type: 'decide', player: 0, choice: 0 });
    expect(get(g, 'P0-1').guns).toEqual(['TMP', 'TMP']);
    // the Y-wing's pilot loses his own gun, not the turret
    inflictDamage(g, 'P0-2', ['G'], { row: 'F' });
    expect(get(g, 'P0-2').guns).toEqual(['SMF', 'DLP(I)']);
  });
});

describe('Sk-1 with a gunner aboard', () => {
  it('lets the owner choose who is hurt, and kills a gunner reduced below 1D without losing the ship', () => {
    const g = scene([{ typeId: 'y-wing-2seat', owner: 0, col: 10, row: 20, facing: 0, gunners: ['average'] }, tie(10, 14)]);
    const y = get(g, 'P0-1');
    y.gunners![0]!.skill = { dice: 2, pips: 1 };
    const pilot = { ...y.pilotSkill };
    inflictDamage(g, 'P0-1', ['Sk-1'], { shooter: 'P1-1' });
    expect(g.pending).toMatchObject({ kind: 'skill', options: ['pilot', 'gunner1'] });
    ok(g, { type: 'decide', player: 0, choice: 'gunner1' });
    expect(y.gunners![0]!.skill).toEqual({ dice: 1, pips: 1 });
    expect(y.pilotSkill).toEqual(pilot);
    expect(g.vp[1]).toBe(1); // Rules: Victory points for hits
    inflictDamage(g, 'P0-1', ['Sk-1'], { shooter: 'P1-1' });
    ok(g, { type: 'decide', player: 0, choice: 'gunner1' });
    expect(y.gunners![0]!.dead).toBe(true);
    expect(y.status).toBe('active');
    expect(g.vp[1]).toBe(2);
    // with the gunner dead the pilot takes it, straight away
    inflictDamage(g, 'P0-1', ['Sk-1'], { shooter: 'P1-1' });
    expect(g.pending).toBeNull();
    expect(y.pilotSkill.dice).toBe(pilot.dice - 1);
  });

  it('hurts the pilot when he is chosen, and works as before on a ship without gunners', () => {
    const g = scene([{ typeId: 'y-wing-2seat', owner: 0, col: 10, row: 20, facing: 0, gunners: ['average'] }, { typeId: 'x-wing', owner: 0, col: 12, row: 20, facing: 0 }, tie(10, 14)]);
    const before = get(g, 'P0-1').pilotSkill.dice;
    inflictDamage(g, 'P0-1', ['Sk-1']);
    ok(g, { type: 'decide', player: 0, choice: 'pilot' });
    expect(get(g, 'P0-1').pilotSkill.dice).toBe(before - 1);
    const x = get(g, 'P0-2').pilotSkill.dice;
    inflictDamage(g, 'P0-2', ['Sk-1']);
    expect(g.pending).toBeNull();
    expect(get(g, 'P0-2').pilotSkill.dice).toBe(x - 1);
    expect(applyCommand(g, { type: 'decide', player: 0, choice: 'pilot' }).ok).toBe(false);
  });
});

describe('victory points for gunners', () => {
  it('counts the gunners aboard a destroyed ship, but not a dead one', () => {
    const make = (dead: boolean) => {
      const g = scene([{ typeId: 'y-wing-2seat', owner: 0, col: 10, row: 20, facing: 0, gunners: ['veteran'] }, tie(10, 14)]);
      get(g, 'P0-1').gunners![0]!.dead = dead;
      inflictDamage(g, 'P0-1', ['KILL'], { shooter: 'P1-1' });
      return g.vp[1];
    };
    // Y-wing (2 seats) 5 + average pilot 4 + veteran gunner 4
    expect(make(false)).toBe(13);
    expect(make(true)).toBe(9);
  });
});

/** A game in the ship phase with the Falcon's gunners armed: the Falcon moves first. */
function shooting(extra: Spec[], crew: Plan[] = [], pilot: Plan = emptyPlan(), seed = 3): GameState {
  const g = scene([falcon(), ...extra], seed);
  planAll(g, { 'P0-1': pilot }, { 'P0-1': crew });
  expect(g.phase).toBe('ships');
  g.chooser = 0;
  ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
  return g;
}

describe('firing with gunners', () => {
  it('lets a gunner shoot in any direction, behind the ship too, where the pilot cannot', () => {
    const g = shooting([tie(10, 22, 3)]); // two hexes behind the Falcon (it faces north)
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    // the pilot has no target in his arc, so the Fire Segment was skipped?  A gunner has: it must be offered
    expect(g.active?.stage).toBe('fire');
    expect(applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1' }] }).ok).toBe(false);
    const result = applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }, { gun: 1, target: 'P1-1', crew: 'gunner2' }] });
    expect(result.ok).toBe(true);
    const fired = g.log.filter((e) => e.kind === 'fire');
    expect(fired).toHaveLength(2);
    expect(fired[0]!.text).toContain('(gunner 1)');
  });

  it('does not let a gunner fire a turret that is not his, or beyond five hexes', () => {
    const near = shooting([tie(10, 23, 3)]);
    ok(near, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    expect(applyCommand(near, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 1, target: 'P1-1', crew: 'gunner1' }] }).ok).toBe(false);
    const far = shooting([tie(10, 27, 3), tie(10, 19, 3)]);
    ok(far, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    expect(applyCommand(far, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] }).ok).toBe(false);
  });

  it('lets the pilot fire a turret ahead like a fixed gun when no gunner takes it, but not one a gunner fired', () => {
    const g = shooting([tie(10, 17, 3)]);
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    // a gun cannot be fired by two crew members in one volley
    expect(applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1' }, { gun: 0, target: 'P1-1', crew: 'gunner1' }] }).ok).toBe(false);
    expect(applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }, { gun: 1, target: 'P1-1' }] }).ok).toBe(true);
    expect(g.log.filter((e) => e.kind === 'fire')).toHaveLength(2);
    // the claims last the game-turn: the pilot cannot take the gunner's turret in a later volley of the same turn
    expect(get(g, 'P0-1').turretClaims).toEqual({ 0: 'gunner1', 1: 'pilot' });
  });

  it('keeps a ship that rolls from using its gunners, while the pilot still fires the turrets', () => {
    const g = shooting([tie(10, 17, 3)], [], plan({ roll: 1 }));
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    expect(g.active?.stage).toBe('fire');
    const refused = applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] });
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toMatch(/rolls/);
    expect(applyCommand(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1' }, { gun: 1, target: 'P1-1' }] }).ok).toBe(true);
  });

  it('uses the gunner\'s own skill and the pivot gun\'s numbers', () => {
    let a = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const g = shooting([tie(10, 21, 3)], [], emptyPlan(), seed);
      get(g, 'P0-1').gunners![0]!.skill = { dice: 12, pips: 0 };
      ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
      ok(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] });
      if (g.log.some((e) => e.kind === 'fire' && e.text.endsWith('hit.'))) a += 1;
    }
    expect(a).toBeGreaterThan(22); // 12 dice against a point-blank pivot shot
  });

  it('lets a gunner snap fire during the move once he planned it, and then keeps him out of the Fire Segment', () => {
    const m = scene([falcon(), tie(10, 15, 3)], 5);
    m.ships[0]!.speed = 2;
    planAll(m, {}, { 'P0-1': [plan({ snapFire: 1 })] });
    m.chooser = 0;
    ok(m, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    // a snap by somebody who did not plan one is refused
    expect(applyCommand(m, { type: 'move', player: 0, shipId: 'P0-1', steps: [{ kind: 'forward' }, { kind: 'snapFire', shots: [{ gun: 1, target: 'P1-1', crew: 'gunner2' }] }, { kind: 'forward' }] }).ok).toBe(false);
    expect(applyCommand(m, { type: 'move', player: 0, shipId: 'P0-1', steps: [{ kind: 'forward' }, { kind: 'snapFire', shots: [{ gun: 0, target: 'P1-1' }] }, { kind: 'forward' }] }).ok).toBe(false);
    const done = applyCommand(m, { type: 'move', player: 0, shipId: 'P0-1', steps: [{ kind: 'forward' }, { kind: 'snapFire', shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] }, { kind: 'forward' }] });
    expect(done.ok).toBe(true);
    expect(m.log.some((e) => e.kind === 'fire' && e.text.includes('snap fire'))).toBe(true);
    // the Fire Segment: the pilot may still fire, the gunner may not, and the turret the gunner used is his for the turn
    if (m.active?.stage === 'fire') {
      expect(applyCommand(m, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 1, target: 'P1-1', crew: 'gunner2' }] }).ok).toBe(true);
    }
  });
});

describe('seeing and saving', () => {
  it('hides the other side\'s gunners\' plans until both have planned', () => {
    const g = scene([falcon(), tie(10, 14)]);
    get(g, 'P0-1').gunners![0]!.plan = plan({ pinpointFire: 1 });
    expect(viewFor(g, 1).ships[0]!.gunners![0]!.plan).toEqual(emptyPlan());
    expect(viewFor(g, 0).ships[0]!.gunners![0]!.plan.pinpointFire).toBe(1);
    g.phase = 'ships';
    expect(viewFor(g, 1).ships[0]!.gunners![0]!.plan.pinpointFire).toBe(1);
  });

  it('clears the plans and the claims when the game-turn is over', () => {
    const g = shooting([tie(10, 17, 3), tie(24, 4, 3)], [plan({ pinpointFire: 1 })]);
    ok(g, { type: 'move', player: 0, shipId: 'P0-1', steps: [] });
    ok(g, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] });
    expect(get(g, 'P0-1').turretClaims).toBeDefined();
    // let the computer finish the turn
    const ai = tacticalAi(createRng(9));
    for (let n = 0; n < 200 && g.turn === 1 && g.phase !== 'over'; n++) {
      const who = waitingFor(g)[0]!;
      const cmd = ai(g, who);
      if (!cmd) break;
      ok(g, cmd);
    }
    expect(g.turn).toBe(2);
    expect(get(g, 'P0-1').turretClaims).toBeUndefined();
    expect(get(g, 'P0-1').gunners!.every((x) => x.plan.pinpointFire === 0)).toBe(true);
  });
});

describe('the computer with gunners', () => {
  const force = (typeId: string, gunners: PilotQuality[]): ForceShip => ({ typeId, quality: 'average', gunners });

  it('plays whole games with gunners aboard, and its gunners shoot', () => {
    let gunnerShots = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = createGame(scenarioOptions('points', seed, [60, 60], 0));
      ok(g, {
        type: 'buyBoth', player: 0,
        ships: [
          [force('millennium-falcon', ['average', 'average']), force('y-wing-2seat', ['veteran']), force('x-wing', [])],
          [force('imperial-shuttle', ['average']), force('tie-fighter', []), force('tie-interceptor', []), force('slave-i', [])],
        ],
      });
      playGame(g, [tacticalAi(createRng(seed)), tacticalAi(createRng(seed + 50))], { maxCommands: 8000 });
      expect(['over', 'planning', 'ships']).toContain(g.phase);
      gunnerShots += g.log.filter((e) => e.kind === 'fire' && /\(gunner/.test(e.text)).length;
    }
    expect(gunnerShots).toBeGreaterThan(5);
  }, 120000);
});

import { crewGunStatus, hazardOdds, plannableActions, trackableTargets, volleyOdds } from '../src/engine';

describe('what the screens ask the engine', () => {
  it('knows what each crew member may plan, and what the plan risks', () => {
    const g = scene([falcon(), tie(10, 14)]);
    const f = get(g, 'P0-1');
    expect(plannableActions(f, 'pilot')).toContain('slip');
    expect([...plannableActions(f, 'gunner1')].sort()).toEqual(['angleDeflectors', 'damageControl', 'pinpointFire', 'snapFire', 'targeting']);
    f.gunners![1]!.dead = true;
    expect(plannableActions(f, 'gunner2')).toEqual([]);
    // a gunner's difficulty is his own actions plus the ship's damage markers, and his own skill rolls it
    f.stabilizerDamage = 1;
    f.gunners![0]!.skill = { dice: 3, pips: 0 };
    const odds = hazardOdds(f, 'gunner1', plan({ pinpointFire: 1 }));
    expect(odds.total).toBe(4 + 3); // pinpoint 4 + stabilizer 3 (the Falcon's numbers)
    expect(odds.parts.map((p) => p.value)).toEqual([4, 3]);
    expect(odds.none).toBeGreaterThan(0.4);
    expect(odds.none).toBeLessThan(odds.noFull + 1e-9);
    expect(hazardOdds(f, 'gunner1', emptyPlan()).none).toBeGreaterThan(0.999);
  });

  it('lists who may be tracked', () => {
    const g = scene([falcon({ col: 10, row: 20 }), { typeId: 'tie-fighter', owner: 1, col: 13, row: 20, facing: 0 }, { typeId: 'tie-fighter', owner: 1, col: 16, row: 20, facing: 3 }]);
    const f = get(g, 'P0-1');
    expect(trackableTargets(g, f, 'gunner1').map((s) => s.id)).toEqual(['P1-1']);
    expect(trackableTargets(g, f, 'pilot').map((s) => s.id)).toEqual([]);
  });

  it('tells each crew member which guns are ready, reserved, claimed or blocked', () => {
    const g = scene([falcon(), tie(10, 14)]);
    const f = get(g, 'P0-1');
    expect(crewGunStatus(f, 'pilot').map((x) => x.state)).toEqual(['reserved', 'reserved']);
    expect(crewGunStatus(f, 'gunner1').map((x) => [x.gun, x.state])).toEqual([[0, 'ready']]);
    f.turretClaims = { 0: 'gunner1' };
    expect(crewGunStatus(f, 'pilot')[0]!.state).toBe('claimed');
    f.plan.roll = 1;
    expect(crewGunStatus(f, 'gunner2')[0]!.state).toBe('blocked');
    // with no gunner to claim it a turret is the pilot's
    f.gunners![1]!.dead = true;
    f.turretClaims = {};
    f.plan.roll = 0;
    expect(crewGunStatus(f, 'pilot').map((x) => x.state)).toEqual(['reserved', 'ready']);
  });

  it('works out the chance of a volley, with each crew member\'s own dice', () => {
    const g = scene([falcon(), tie(10, 18)]);
    const f = get(g, 'P0-1');
    f.gunnerySkill = { dice: 5, pips: 0 };
    f.gunners![0]!.skill = { dice: 5, pips: 0 };
    const one = volleyOdds(g, f, [{ gun: 0, target: 'P1-1' }]);
    const two = volleyOdds(g, f, [{ gun: 0, target: 'P1-1' }, { gun: 1, target: 'P1-1' }]);
    // the pilot firing two guns loses a die for each, so the same shot is less likely
    expect(two[0]!.chance).toBeLessThan(one[0]!.chance);
    expect(two[0]!.difficulty).toBe(one[0]!.difficulty);
    // a gunner and the pilot do not reduce each other
    const split = volleyOdds(g, f, [{ gun: 0, target: 'P1-1', crew: 'gunner1' }, { gun: 1, target: 'P1-1' }]);
    const gunnerAlone = volleyOdds(g, f, [{ gun: 0, target: 'P1-1', crew: 'gunner1' }]);
    expect(split[0]!.chance).toBeCloseTo(gunnerAlone[0]!.chance, 10);
    expect(split[0]!.range).toBe(2);
  });
});

describe('the computer\'s gunners plan', () => {
  it('plan pinpoint fire when it is safe enough, and not on a ship that rolls', () => {
    const make = (skill: { dice: number; pips: number }, pilot: Plan = emptyPlan()) => {
      const g = scene([falcon({ gunners: ['veteran', 'veteran'] }), tie(10, 14)]);
      for (const x of get(g, 'P0-1').gunners!) x.skill = skill;
      const cmd = tacticalAi(createRng(2))(g, 0) as Extract<Command, { type: 'plan' }>;
      void pilot;
      return { cmd, g };
    };
    const strong = make({ dice: 7, pips: 0 });
    expect(strong.cmd.crewPlans!['P0-1']!.map((p) => p.pinpointFire)).toEqual([1, 1]);
    const weak = make({ dice: 1, pips: 0 });
    expect(weak.cmd.crewPlans!['P0-1']!.map((p) => p.pinpointFire)).toEqual([0, 0]);
    // and the whole plan is one the engine accepts
    expect(applyCommand(strong.g, strong.cmd).ok).toBe(true);
  });
});

describe('two gunners snap fire at different steps of one move', () => {
  const setup = () => {
    const g = scene([falcon({ gunners: ['average', 'average'] }), tie(10, 16), tie(12, 18)], 1);
    get(g, 'P0-1').speed = 5;
    planAll(g, {}, { 'P0-1': [plan({ snapFire: 2 }), plan({ snapFire: 2 })] });
    g.chooser = 0;
    ok(g, { type: 'chooseShip', player: 0, shipId: 'P0-1' });
    return g;
  };
  const fwd = { kind: 'forward' as const };

  it('lets the second gunner shoot at a later step after the first, and either order', () => {
    const one = setup();
    const steps1 = [fwd, { kind: 'snapFire' as const, shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] }, fwd, { kind: 'snapFire' as const, shots: [{ gun: 1, target: 'P1-2', crew: 'gunner2' }] }, fwd, fwd, fwd];
    expect(applyCommand(one, { type: 'move', player: 0, shipId: 'P0-1', steps: steps1 }).ok).toBe(true);
    expect(one.log.filter((e) => e.kind === 'fire' && e.text.includes('snap fire')).map((e) => (e.text.includes('gunner 1') ? 1 : 2))).toEqual([1, 2]);
    const two = setup();
    const steps2 = [fwd, { kind: 'snapFire' as const, shots: [{ gun: 1, target: 'P1-2', crew: 'gunner2' }] }, fwd, { kind: 'snapFire' as const, shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] }, fwd, fwd, fwd];
    expect(applyCommand(two, { type: 'move', player: 0, shipId: 'P0-1', steps: steps2 }).ok).toBe(true);
  });

  it('lets one gunner skip his snap in the first pause and use it in a later one', () => {
    const g = setup();
    // the first pause holds only gunner 1's shot; gunner 2 snaps later
    const steps = [fwd, { kind: 'snapFire' as const, shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] }, fwd, fwd, { kind: 'snapFire' as const, shots: [{ gun: 1, target: 'P1-2', crew: 'gunner2' }] }, fwd, fwd];
    expect(applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps }).ok).toBe(true);
  });

  it('refuses a second snap in the same pause by someone who has already snapped, and one with no hex of movement between', () => {
    const g = setup();
    const twice = [fwd, { kind: 'snapFire' as const, shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] }, fwd, { kind: 'snapFire' as const, shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] }, fwd, fwd, fwd];
    expect(applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: twice }).ok).toBe(false);
    const sameHex = [fwd, { kind: 'snapFire' as const, shots: [{ gun: 0, target: 'P1-1', crew: 'gunner1' }] }, { kind: 'snapFire' as const, shots: [{ gun: 1, target: 'P1-2', crew: 'gunner2' }] }, fwd, fwd, fwd, fwd];
    expect(applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: sameHex }).ok).toBe(false);
  });
});

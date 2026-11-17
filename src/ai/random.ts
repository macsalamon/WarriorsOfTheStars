import { capitalTargetCommand, destroyerPlacements, randomDestroyerSteps } from './destroyers';
import {
  PLAN_ACTIONS,
  currentDestroyer,
  activeShips,
  applyCommand,
  applyStepToPosition,
  canFireAt,
  emptyPlan,
  freeSlots,
  moveWithOptions,
  nextPicker,
  hexDistance,
  isMoveComplete,
  legalMoveSteps,
  moveContext,
  relativeBearing,
  shipById,
  tails,
  typeOf,
  waitingFor,
  type Command,
  type CommandResult,
  type Facing,
  type GameState,
  type Hex,
  type MoveStep,
  type MoveStepCommand,
  type Plan,
  type PlayerId,
  type Rng,
  type Ship,
  type ShotOrder,
  PILOT,
  canCrewFire,
  crewGuns,
  crewOrPilot,
  endFireCrew,
  gunReaches,
  gunnerCrewId,
  livingGunners,
  mayTrack,
  MAP_EDGES,
  needsTurretOrders,
  trackableEmplacements,
  pilotAvailableGuns,
  planOf,
  repairOptions,
  SPECIAL,
  specialFor,
  targetsForSpecial,
  coveredHexes,
  keyOf,
  autoBase,
  createRng,
  rockHexInReach,
  rockTargetId,
  emplacementsForCrew,
  turretReaches,
  type TurretOrder,
} from '../engine';
import { chooseForce } from './force';
import type { Ai } from './player';
import { reserveCommand, startEdgeCommand } from './simple';

/**
 * A player that makes random but always legal choices. It exists to exercise the rules engine
 * (fuzz tests, rules smoke tests); it is deliberately not smart.
 */

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng.next() * items.length)]!;
const chance = (rng: Rng, p: number): boolean => rng.next() < p;

function facingToward(from: Hex, to: Hex): Facing {
  // choose the hex-side direction that gets closest to the target
  let best: Facing = 0;
  let bestDistance = Infinity;
  for (let f = 0; f < 6; f++) {
    const probe = applyStepToPosition(from, f as Facing, 'forward').pos;
    const d = hexDistance(probe, to);
    if (d < bestDistance) {
      bestDistance = d;
      best = f as Facing;
    }
  }
  return best;
}

export function randomPlacement(game: GameState, player: PlayerId, rng: Rng): Command {
  if (game.groundAttack && !game.groundAttack.edge && game.groundAttack.attacker === player) return { type: 'edge', player, edge: pick(rng, MAP_EDGES) };
  // a defender who has to place the ground target and the base lets the game lay them out
  if (game.baseSetup && !game.baseSetup.done && game.baseSetup.defender === player) return { type: 'base', player, items: autoBase(createRng(game.rngState ^ 0x51ed), game.map, game.baseSetup.kit) };
  const blocked = game.asteroids ? coveredHexes(game.asteroids) : new Set<string>();
  const zone = game.zones[player].filter((h) => !blocked.has(keyOf(h)));
  const enemyZone = game.zones[player === 0 ? 1 : 0];
  const target = enemyZone[Math.floor(enemyZone.length / 2)]!;
  const sds = destroyerPlacements(game, player, zone);
  for (let i = zone.length - 1; i >= 0; i--) if (sds.used.has(keyOf(zone[i]!))) zone.splice(i, 1);
  const placements = activeShips(game, player).map((ship) => {
    const index = Math.floor(rng.next() * zone.length);
    const [pos] = zone.splice(index, 1);
    return { shipId: ship.id, pos: pos!, facing: facingToward(pos!, target) };
  });
  return { type: 'place', player, placements: [...placements, ...sds.placements] };
}

export function randomPlan(game: GameState, ship: Ship, rng: Rng): Plan {
  const plan = emptyPlan();
  const level = () => (chance(rng, 0.2) ? 2 : 1) as 1 | 2;
  if (chance(rng, 0.15)) plan.halfLoop = level();
  if (chance(rng, 0.2)) plan.slip = level();
  if (chance(rng, 0.15)) plan.roll = level();
  if (chance(rng, 0.15)) plan.jink = level();
  if (chance(rng, 0.2)) plan.bank = level();
  else if (chance(rng, 0.1)) plan.overturn = level();
  if (chance(rng, 0.1)) plan.overspeed = level();
  const speedAction = pick(rng, [null, null, 'accelerate', 'accelerate', 'decelerate', 'overaccelerate', 'overdecelerate'] as const);
  if (speedAction) plan[speedAction] = level();
  if (chance(rng, 0.2)) plan.pinpointFire = level();
  if (chance(rng, 0.2)) plan.snapFire = level();
  if (typeOf(ship).shields !== null && chance(rng, 0.2)) {
    plan.angleDeflectors = level();
    plan.deflectorDirection = pick(rng, ['front', 'rear'] as const);
  }
  const tailed: { id: string }[] = [...activeShips(game).filter((t) => tails(ship, t)), ...trackableEmplacements(game, ship, PILOT)];
  if (tailed.length > 0 && chance(rng, 0.5)) {
    plan.targeting = level();
    plan.targetingTarget = pick(rng, tailed).id;
  }
  planRandomRepair(game, ship, plan, rng);
  return plan;
}

/** Damage control, now and then, when the rules are in effect and something can be repaired: free from the R2 unit or auxiliary power where there is one. */
function planRandomRepair(game: GameState, ship: Ship, plan: Plan, rng: Rng, crew = PILOT): void {
  if (!game.damageRules) return;
  const options = repairOptions(ship);
  if (options.length === 0 || !chance(rng, 0.5)) return;
  plan.damageControl = chance(rng, 0.3) ? 2 : 1;
  plan.repair = pick(rng, options);
  // the R2 unit does the first step; auxiliary power (the pilot's only) may pay one or both
  if (ship.r2?.aboard) plan.pay = { damageControl: plan.damageControl === 2 ? 'fc' : 'f' };
  else if (crew === PILOT && (ship.aux ?? 0) >= plan.damageControl && chance(rng, 0.7)) plan.pay = { damageControl: 'f'.repeat(plan.damageControl) };
}

/**
 * Shots from a position by the crew members named: each working gun they may fire shoots, most of the time, at one enemy it can reach.
 * The pilot fires forward only; a gunner fires his turret in any direction.
 */
function randomShots(game: GameState, ship: Ship, pos: Hex, facing: Facing, rng: Rng, crews: string[] = [PILOT], fireSegment = false): ShotOrder[] {
  const enemies = activeShips(game).filter((t) => t.owner !== ship.owner && t.pos);
  const shots: ShotOrder[] = [];
  for (const crew of crews) {
    if (!canCrewFire(ship, crew)) continue;
    const guns = crew === PILOT ? pilotAvailableGuns(ship) : crewGuns(ship, crew);
    for (const gun of guns) {
      const pool = enemies.filter((t) => gunReaches(ship, gun, crew, pos, facing, t.pos!));
      // now and then at an asteroid in reach instead (Rules: Asteroid fields)
      const rocks = game.asteroids?.rocks.filter((r) => rockHexInReach(game, ship, gun, crew, r, pos, facing) !== null) ?? [];
      if (rocks.length > 0 && chance(rng, 0.1)) {
        shots.push({ gun, target: rockTargetId(pick(rng, rocks).id), ...(crew === PILOT ? {} : { crew }) });
        continue;
      }
      // or at a turret gun or the ground target (Rules: Ground attack)
      const emplacements = emplacementsForCrew(game, ship, crew, pos, facing).filter((t) => crew === PILOT ? gunReaches(ship, gun, crew, pos, facing, t.pos) : true);
      if (emplacements.length > 0 && chance(rng, 0.3)) {
        const target = pick(rng, emplacements);
        if (gunReaches(ship, gun, crew, pos, facing, target.pos)) {
          shots.push({ gun, target: target.id, ...(crew === PILOT ? {} : { crew }) });
          continue;
        }
      }
      if (pool.length === 0 || !chance(rng, 0.85)) continue;
      shots.push({ gun, target: pick(rng, pool).id, ...(crew === PILOT ? {} : { crew }) });
    }
  }
  // now and then the pilot fires missiles or torpedoes as well, in the Fire Segment (22)
  const weapon = fireSegment && crews.includes(PILOT) ? specialFor(game, ship) : null;
  if (weapon && canCrewFire(ship, PILOT)) {
    const pool = targetsForSpecial(game, ship, pos, facing);
    if (pool.length > 0 && chance(rng, 0.4)) shots.push({ gun: SPECIAL, target: pick(rng, pool).id, tubes: 1 + Math.floor(rng.next() * weapon.tubes) });
  }
  return shots;
}

/** Plans for a ship's gunners: only what they may plan, and one tracked target and one shield mover for the whole ship (Rules: Gunners and turrets). */
export function randomCrewPlans(game: GameState, ship: Ship, pilotPlan: Plan, rng: Rng): Plan[] {
  let angling = pilotPlan.angleDeflectors > 0;
  let repairing = false;
  let tracked = pilotPlan.targeting > 0 ? pilotPlan.targetingTarget : null;
  return (ship.gunners ?? []).map((g, seat) => {
    const plan = emptyPlan();
    if (g.dead) return plan;
    const crew = gunnerCrewId(seat);
    const level = () => (chance(rng, 0.2) ? 2 : 1) as 1 | 2;
    if (chance(rng, 0.3)) plan.pinpointFire = level();
    if (chance(rng, 0.3)) plan.snapFire = level();
    if (!pilotPlan.damageControl && !repairing && chance(rng, 0.3)) {
      planRandomRepair(game, ship, plan, rng, crew);
      if (plan.damageControl > 0) repairing = true;
    }
    if (!angling && typeOf(ship).shields !== null && chance(rng, 0.2)) {
      plan.angleDeflectors = level();
      plan.deflectorDirection = pick(rng, ['front', 'rear'] as const);
      angling = true;
    }
    const options: { id: string }[] = [...activeShips(game).filter((t) => mayTrack(ship, t, crew)), ...trackableEmplacements(game, ship, crew)].filter((t) => tracked === null || t.id === tracked);
    if (options.length > 0 && chance(rng, 0.4)) {
      const target = pick(rng, options);
      plan.targeting = level();
      plan.targetingTarget = target.id;
      tracked = target.id;
    }
    return plan;
  });
}

function nearestEnemy(game: GameState, ship: Ship, from: Hex): Hex | null {
  let best: Hex | null = null;
  let bestDistance = Infinity;
  for (const t of activeShips(game)) {
    if (t.owner === ship.owner || !t.pos) continue;
    const d = hexDistance(from, t.pos);
    if (d > 0 && d < bestDistance) {
      bestDistance = d;
      best = t.pos;
    }
  }
  return best;
}

export function randomMove(game: GameState, ship: Ship, rng: Rng): MoveStepCommand[] {
  const steps: MoveStepCommand[] = [];
  // each crew member who planned snap fire may use it once in the move
  const snapped = new Set<string>();
  const snapCrew = (): string[] => [PILOT, ...livingGunners(ship).map(gunnerCrewId)].filter((c) => planOf(ship, c).snapFire > 0 && canCrewFire(ship, c) && !snapped.has(c));
  const taken: MoveStep[] = [];
  let pos = ship.pos!;
  let facing = ship.facing;
  for (let guard = 0; guard < 60; guard++) {
    const legal = legalMoveSteps(game, ship.id, taken).filter((s) => {
      if (s !== 'snapFire') return true;
      return randomShots(game, ship, pos, facing, { next: () => 0 }, snapCrew()).length > 0;
    });
    const complete = isMoveComplete(game, ship.id, taken);
    if (legal.length === 0 || (complete && chance(rng, 0.7))) break;
    // prefer moving over turning around in circles
    const weighted = legal.flatMap((s) => (s === 'forward' ? [s, s, s] : s === 'snapFire' ? [s] : [s, s]));
    let step = pick(rng, weighted);
    // turns lean toward the nearest enemy, so random games actually produce dogfights
    if ((step === 'turnLeft' || step === 'turnRight') && chance(rng, 0.8)) {
      const enemy = nearestEnemy(game, ship, pos);
      if (enemy) {
        const bearing = relativeBearing(pos, facing, enemy);
        const wanted: MoveStep = bearing > 0 && bearing < 180 ? 'turnRight' : 'turnLeft';
        if (legal.includes(wanted)) step = wanted;
      }
    }
    if (step === 'snapFire') {
      const shots = randomShots(game, ship, pos, facing, rng, snapCrew());
      if (shots.length === 0) continue;
      for (const shot of shots) snapped.add(crewOrPilot(shot.crew));
      steps.push({ kind: 'snapFire', shots });
    } else {
      steps.push({ kind: step });
      const next = applyStepToPosition(pos, facing, step);
      pos = next.pos;
      facing = next.facing;
    }
    taken.push(step);
  }
  return steps;
}

/** Random turret orders (Rules: Ground attack): each gun turned or not, tracking something in its arc now and then, with a random standing order. */
function randomTurretOrders(game: GameState, player: PlayerId, rng: Rng): TurretOrder[] {
  const enemies = activeShips(game).filter((s) => s.owner !== player && s.pos);
  return (game.emplacements ?? []).filter((e) => e.status === 'active' && e.owner === player).map((turret) => {
    const turn = pick(rng, [-1, 0, 0, 1] as const);
    const facing = ((turret.facing + turn + 6) % 6) as Facing;
    const reached = enemies.filter((e) => turretReaches({ pos: turret.pos, facing }, e.pos!));
    const order: TurretOrder = { id: turret.id, turn };
    if (reached.length > 0 && chance(rng, 0.6)) order.target = pick(rng, reached).id;
    // the lower limit never above the upper one
    const low = 10 * Math.floor(rng.next() * 6);
    order.lastChance = low;
    order.chance = chance(rng, 0.4) ? null : Math.max(low, 10 * (1 + Math.floor(rng.next() * 10)));
    return order;
  });
}

/** The next command this player must give, or null if nothing is waiting on them. */
export function nextRandomCommand(game: GameState, player: PlayerId, rng: Rng): Command | null {
  if (!waitingFor(game).includes(player)) return null;

  const pending = game.pending;
  if (pending) {
    switch (pending.kind) {
      case 'lose': return { type: 'decide', player, choice: pick(rng, pending.options) };
      case 'gun': return { type: 'decide', player, choice: pick(rng, pending.options) };
      case 'skill': return { type: 'decide', player, choice: pick(rng, pending.options) };
      case 'power': return { type: 'decide', player, choice: pick(rng, pending.options) };
      case 'steal':
      case 'pass':
        return { type: 'decide', player, choice: chance(rng, 0.5) ? null : pick(rng, pending.candidates) };
      case 'follow': return { type: 'decide', player, choice: chance(rng, 0.5) ? 'before' : 'after' };
    }
  }

  switch (game.phase) {
    case 'forces': return chooseForce(game, player, rng);
    case 'setup': return startEdgeCommand(game, player) ?? randomPlacement(game, player, rng);
    case 'entry':
    case 'arrival': return reserveCommand(game, player);
    case 'destroyers': {
      const pick = capitalTargetCommand(game, player, rng, true);
      if (pick) return pick;
      const d = currentDestroyer(game);
      if (!d || d.owner !== player) return null;
      const move = randomDestroyerSteps(game, d, rng);
      return { type: 'moveDestroyer', player, id: d.id, steps: move.steps, speed: move.speed };
    }
    case 'initiative': {
      const ship = shipById(game, nextPicker(game.initiativeTable!)!)!;
      const options = moveWithOptions(game, ship);
      if (options.length > 0 && chance(rng, 0.5)) return { type: 'slot', player, moveWith: pick(rng, options) };
      return { type: 'slot', player, slot: pick(rng, freeSlots(game.initiativeTable!)) + 1 };
    }
    case 'planning': {
      if (needsTurretOrders(game, player)) return { type: 'turrets', player, orders: randomTurretOrders(game, player, rng) };
      const plans: Record<string, Plan> = {};
      const crewPlans: Record<string, Plan[]> = {};
      for (const ship of activeShips(game, player)) {
        plans[ship.id] = randomPlan(game, ship, rng);
        if (ship.gunners?.length) crewPlans[ship.id] = randomCrewPlans(game, ship, plans[ship.id]!, rng);
      }
      return { type: 'plan', player, plans, crewPlans };
    }
    case 'ships': {
      if (!game.active) {
        const unmoved = activeShips(game).filter((s) => !s.moved);
        const mine = unmoved.filter((s) => s.owner === player);
        // sometimes pick an enemy ship, which is what lets tailing ships pass their move (Rules: Initiative)
        const pool = mine.length > 0 && !chance(rng, 0.3) ? mine : unmoved;
        return { type: 'chooseShip', player, shipId: pick(rng, pool).id };
      }
      const ship = shipById(game, game.active.queue[game.active.index]!)!;
      if (game.active.stage === 'move') {
        return { type: 'move', player, shipId: ship.id, steps: randomMove(game, ship, rng) };
      }
      return { type: 'fire', player, shipId: ship.id, shots: randomShots(game, ship, ship.pos!, ship.facing, rng, endFireCrew(ship), true) };
    }
    default: return null;
  }
}

export function randomAi(rng: Rng): Ai {
  return (game, player) => nextRandomCommand(game, player, rng);
}

/** Play a whole game with random players. Throws if the engine rejects a legal-looking command. */
export function playRandomGame(
  game: GameState,
  rng: Rng,
  options: { maxCommands?: number; onCommand?: (cmd: Command, result: CommandResult) => void } = {},
): void {
  const limit = options.maxCommands ?? 20000;
  for (let i = 0; i < limit && game.phase !== 'over'; i++) {
    const [player] = waitingFor(game);
    if (player === undefined) throw new Error(`Nobody is waiting in phase ${game.phase}`);
    const cmd = nextRandomCommand(game, player, rng);
    if (!cmd) throw new Error('No command available');
    const result = applyCommand(game, cmd);
    options.onCommand?.(cmd, result);
    if (!result.ok) throw new Error(`Engine rejected ${cmd.type}: ${result.error}`);
  }
}

export { PLAN_ACTIONS, moveContext };

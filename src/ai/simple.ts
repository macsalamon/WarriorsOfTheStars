import { bestDestroyerVolley, destroyerCommand, destroyerPlacements, destroyerTerms } from './destroyers';
import {
  activeShips,
  arrivalHexes,
  reserveGroup,
  hasSideQuarters,
  shieldMove,
  applyStepToPosition,
  baseTurnNumber,
  canComplete,
  canFireAt,
  chanceAtLeast,
  emptyPlan,
  freeSlots,
  hexDistance,
  isTrackerComplete,
  moveWithOptions,
  nextPicker,
  leavesMap,
  moveContext,
  openMapSlack,
  planDifficultyEntries,
  planShapeError,
  powerNumber,
  parseGun,
  previewShot,
  previewSpecial,
  specialFor,
  targetsForSpecial,
  SPECIAL,
  relativeBearing,
  shipById,
  startTracker,
  stepTracker,
  tails,
  toOffset,
  totalDifficulty,
  trackerKey,
  turnNumber,
  typeOf,
  waitingFor,
  withFeasibleObligations,
  type Command,
  type Facing,
  type GameState,
  type Hex,
  type Level,
  type MoveContext,
  type MoveStep,
  type MoveStepCommand,
  type Pending,
  type Plan,
  type PlanAction,
  type PlayerId,
  type Rng,
  type Ship,
  type ShotOrder,
  canCrewFire,
  crewGuns,
  hazardOdds,
  gunReaches,
  gunnerCrewId,
  livingGunners,
  pilotAvailableGuns,
  endFireCrew,
  PILOT,
  coveredHexes,
  keyOf,
  autoBase,
  createRng,
  GROUND_TARGET_ID,
  SPECIAL_DICE,
  emplacementInReach,
  emplacementsForCrew,
  previewEmplacementShot,
  previewTurretShot,
  turretOrdersFor,
  needsTurretOrders,
  trackableEmplacements,
  MAP_EDGES,
  edgeMidpoint,
  setupFacing,
  DIRECTIONS,
  type MapEdge,
  turretReaches,
  type Emplacement,
  type EmplacementTarget,
} from '../engine';
import { chooseForce } from './force';
import type { Ai } from './player';

/**
 * A simple heuristic computer player. It plans a modest number of maneuvers (staying inside
 * what its pilot can handle without hazards), searches every legal move for the end position it
 * likes best, and fires whenever it can. It is not clever: it does not predict enemy moves.
 */

const SEARCH_STEPS: MoveStep[] = ['forward', 'slipLeft', 'slipRight', 'turnLeft', 'turnRight', 'halfLoop'];

// ------------------------------------------------------------ geometry helpers

export function enemiesOf(game: GameState, ship: Ship): Ship[] {
  return activeShips(game).filter((s) => s.owner !== ship.owner && s.pos);
}

export function nearest(from: Hex, ships: Ship[]): Ship | null {
  let best: Ship | null = null;
  let bestDistance = Infinity;
  for (const s of ships) {
    const d = hexDistance(from, s.pos!);
    if (d < bestDistance) {
      bestDistance = d;
      best = s;
    }
  }
  return best;
}

/** Angle between the ship's nose and a hex, 0 to 180. */
export function offNose(pos: Hex, facing: Facing, to: Hex): number {
  if (pos.q === to.q && pos.r === to.r) return 90; // same hex: no direction
  const b = relativeBearing(pos, facing, to);
  return Math.min(b, 360 - b);
}

// ------------------------------------------------------------ position evaluation

/** How good is it to end a move at this hex and facing? Higher is better. */
function evaluateEnd(game: GameState, ship: Ship, pos: Hex, facing: Facing): number {
  const enemies = enemiesOf(game, ship);
  let score = 0;

  // Staying in the game: a ship that strays too far from the rest of the fleet escapes (Rules: The map)
  if (leavesMap(game, ship, pos)) score -= 400;
  else if (game.map.mode === 'open') {
    const others = activeShips(game).flatMap((s) => (s.id !== ship.id && s.pos ? [s.pos] : []));
    const slack = openMapSlack(game.map, [...others, pos]);
    if (slack < 5) score -= (5 - slack) * 3;
  }

  const near = nearest(pos, enemies);
  if (near) {
    const d = hexDistance(pos, near.pos!);
    score -= Math.abs(d - 3) * 1.2; // fight at about range 3
    if (d === 0) score -= 8; // ships in one hex cannot shoot each other
  }

  const probe: Ship = { ...ship, pos, facing };
  let bestShot = 0;
  for (const e of enemies) {
    const d = hexDistance(pos, e.pos!);
    if (d === 0 || d > 14) continue;
    const weight = d <= 6 ? 1 : 0.4;
    // the shot we could take from here, with its real difficulty (speeds and facings included)
    if (canFireAt(pos, facing, e.pos!)) bestShot = Math.max(bestShot, volleyAgainst(game, probe, e).value);
    // the enemy may well turn onto us, so a threat counts for part of its weight
    if (canFireAt(e.pos!, e.facing, pos)) score -= threatValue(game, e, probe) * 0.25;
    if (tails(probe, e)) score += 8;
    if (tails(e, probe)) score -= 8;
    // keep the nose pointed at nearby enemies
    score += ((180 - offNose(pos, facing, e.pos!)) / 180) * 3 * weight;
  }
  const ground = groundTerms(game, probe);
  return score + Math.max(bestShot, ground.offence) * 6 + ground.score;
}

/** How dangerous `enemy` is to `victim` if it fired at it from where it stands. */
function threatValue(game: GameState, enemy: Ship, victim: Ship): number {
  if (pilotAvailableGuns(enemy).length === 0) return 0;
  return volleyAgainst(game, enemy, victim).value;
}

// ------------------------------------------------------------ movement

interface Best {
  score: number;
  steps: MoveStep[];
}

/** Search every legal move for the best-scoring end position. */
function bestMove(game: GameState, ship: Ship, rng: Rng): MoveStepCommand[] {
  const { ctx } = withFeasibleObligations(moveContext(ship));
  const memo = new Map<string, Best>();
  const feasible = new Map<string, boolean>();
  const noise = new Map<string, number>();

  const go = (pos: Hex, facing: Facing, tr: ReturnType<typeof startTracker>): Best => {
    const key = `${pos.q},${pos.r},${facing}|${trackerKey(tr)}`;
    const cached = memo.get(key);
    if (cached) return cached;
    memo.set(key, { score: -Infinity, steps: [] }); // cycle guard
    let best: Best = { score: -Infinity, steps: [] };
    if (isTrackerComplete(ctx, tr)) {
      const spot = `${pos.q},${pos.r},${facing}`;
      if (!noise.has(spot)) noise.set(spot, rng.next() * 0.01);
      best = { score: evaluateEnd(game, ship, pos, facing) + noise.get(spot)!, steps: [] };
    }
    for (const step of SEARCH_STEPS) {
      const next = stepTracker(ctx, tr, step);
      if (!next || !canComplete(ctx, next, feasible)) continue;
      const moved = applyStepToPosition(pos, facing, step);
      const sub = go(moved.pos, moved.facing, next);
      if (sub.score > best.score) best = { score: sub.score, steps: [step, ...sub.steps] };
    }
    memo.set(key, best);
    return best;
  };

  const result = go(ship.pos!, ship.facing, startTracker(ctx));
  return result.steps.map((kind) => ({ kind }) as MoveStepCommand);
}

// ------------------------------------------------------------ planning

/** Average piloting roll for a skill code. */
const meanRoll = (s: { dice: number; pips: number }): number => 3.5 * s.dice + s.pips;

export function planFor(game: GameState, ship: Ship): Plan {
  const type = typeOf(ship);
  const diff = type.difficulty;
  const plan = emptyPlan();
  const enemies = enemiesOf(game, ship);
  const near = nearest(ship.pos!, enemies);

  // Difficulty already committed before we choose anything: damage markers and forced actions
  const forced = { ...emptyPlan(), roll: ship.forcedRoll, overspeed: ship.forcedOverspeed };
  const fixed = totalDifficulty(planDifficultyEntries(forced, diff, ship.stabilizerDamage, ship.actionPenalty));
  // Accept up to a minor hazard (shortfall of 4) on an average roll
  let budget = meanRoll(ship.pilotSkill) + 3 - fixed;

  const add = (action: PlanAction, level: Level = 1): boolean => {
    const cost = (diff[action] ?? Infinity) * level;
    if (plan[action] > 0 || cost > budget) return false;
    plan[action] = level;
    budget -= cost;
    return true;
  };

  const tailing = enemies.filter((e) => tails(ship, e));
  const tailedBy = enemies.filter((e) => tails(e, ship));
  // in a Ground Attack the attackers also close in on the ground target
  const base = game.groundAttack?.attacker === ship.owner && game.groundTarget?.status === 'active' ? hexDistance(ship.pos!, game.groundTarget.pos) : 99;
  const distance = Math.min(base, near ? hexDistance(ship.pos!, near.pos!) : 99);

  // 1. Speed: close in when far away, slow down for the fight, keep up with a ship we are tailing
  // Slow ships turn tighter and head-on passes at speed are nearly impossible shots, so fight slow
  let desired = distance > 12 ? ship.maxSpeed : distance > 7 ? Math.ceil(ship.maxSpeed * 0.6) : Math.ceil(ship.maxSpeed * 0.4);
  if (tailing.length > 0) desired = Math.max(desired, Math.min(ship.maxSpeed, tailing[0]!.speed));
  desired = Math.min(ship.maxSpeed, Math.max(1, desired));
  const delta = desired - ship.speed;
  let speed = ship.speed;
  if (delta >= 3 && add('overaccelerate')) speed += 3;
  else if (delta >= 1 && add('accelerate')) speed += 1;
  else if (delta <= -3 && add('overdecelerate')) speed -= 3;
  else if (delta <= -1 && add('decelerate')) speed -= 1;
  speed = Math.min(Math.max(speed, 0), ship.maxSpeed);

  // 2. Turning: bank or overturn when the nearest enemy is well off the nose and the turn number is large
  if (near && speed > 0) {
    const off = offNose(ship.pos!, ship.facing, near.pos!);
    const tn = turnNumber(baseTurnNumber(type, speed), speed, { lateralDamage: ship.lateralDamage });
    if (off >= 100 && tn >= 5 && add('overturn')) {
      // overturn replaces bank
    } else if (off >= 30 && tn >= 3) {
      add('bank');
    }
  }

  // 3. Offence: track a tailed ship, and aim carefully at close targets
  if (tailing.length > 0 && pilotAvailableGuns(ship).length > 0) {
    const prey = nearest(ship.pos!, tailing)!;
    if (add('targeting')) plan.targetingTarget = prey.id;
  } else if (pilotAvailableGuns(ship).length > 0) {
    // no ship to track: the ground target, or a turret gun, straight ahead (Rules: Ground attack)
    const ground = trackableEmplacements(game, ship, PILOT);
    const aim = ground.find((t) => t.id === GROUND_TARGET_ID) ?? ground.sort((a, b) => hexDistance(ship.pos!, a.pos) - hexDistance(ship.pos!, b.pos))[0];
    if (aim && add('targeting')) plan.targetingTarget = aim.id;
  }
  if (near && distance <= 4 && pilotAvailableGuns(ship).length > 0 && offNose(ship.pos!, ship.facing, near.pos!) < 70) {
    add('pinpointFire');
  }

  // 4. Defence: jink when an enemy is behind us or already has us in its sights
  const threatened = enemies.filter((e) => hexDistance(ship.pos!, e.pos!) <= 5 && canFireAt(e.pos!, e.facing, ship.pos!));
  if (tailedBy.length > 0 || threatened.length > 0) {
    add('jink');
  }

  // 5. Shields: face them toward where the danger is
  if (type.shields !== null && type.difficulty.angleDeflectors !== null) {
    const toRear = tailedBy.length > 0 && ship.shields.front > ship.shields.rear + 1;
    const toFront = tailedBy.length === 0 && ship.shields.rear > ship.shields.front + 1;
    const wide = hasSideQuarters(game, ship) ? shieldMove(game, ship, enemies) : null;
    if (wide) {
      // the advanced arcs: shields can go to any side of the ship (Rules: Advanced arcs)
      if (add('angleDeflectors')) {
        plan.deflectorFrom = wide.from;
        plan.deflectorDirection = wide.to;
      }
    } else if ((toRear || toFront) && add('angleDeflectors')) plan.deflectorDirection = toRear ? 'rear' : 'front';
  }

  const error = planShapeError(plan, type.shields !== null);
  if (error) return emptyPlan(); // never hand the engine something illegal
  return plan;
}

// ------------------------------------------------------------ firing

const damageValue = (power: number): number => Math.max(0.2, 0.8 * (power + 3));

/**
 * The best way to fire `shooter`'s guns at one target, and its expected damage (Rules: Fire — trades dice for guns). `extra` weapons are fired
 * besides (the missiles or torpedoes), each costing a die as well.
 */
export function volleyAgainst(game: GameState, shooter: Ship, target: Ship, extra = 0): { value: number; shots: ShotOrder[] } {
  const guns = pilotAvailableGuns(shooter);
  if (guns.length === 0 || !shooter.pos || !target.pos) return { value: 0, shots: [] };
  let best: { value: number; shots: ShotOrder[] } = { value: 0, shots: [] };
  for (let k = 1; k <= guns.length; k++) {
    const penalty = k - 1 + extra;
    const scored = guns
      .map((gun) => {
        const preview = previewShot(game, shooter, gun, target);
        return { gun, value: chanceAtLeast(shooter.gunnerySkill, penalty, preview.difficulty) * damageValue(preview.power) };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, k);
    const total = scored.reduce((sum, s) => sum + s.value, 0);
    if (total > best.value) best = { value: total, shots: scored.map((s) => ({ gun: s.gun, target: target.id })) };
  }
  return best;
}

/** What each gunner plans: pinpoint fire when he can afford the risk, as long as the ship is not rolling (a ship that rolls cannot use its gunners, see Rules: Gunners and turrets). */
export function crewPlansFor(ship: Ship, pilotPlan: Plan): Plan[] | undefined {
  if (!ship.gunners?.length) return undefined;
  const rolling = pilotPlan.roll > 0 || ship.forcedRoll > 0;
  return ship.gunners.map((g, seat) => {
    const plan = emptyPlan();
    if (g.dead || rolling || typeOf(ship).difficulty.pinpointFire === null) return plan;
    const pinpoint: Plan = { ...plan, pinpointFire: 1 };
    return hazardOdds(ship, gunnerCrewId(seat), pinpoint).none >= 0.75 ? pinpoint : plan;
  });
}

/** What each gunner who can fire does: his turret at the enemy he is likeliest to hurt, in any direction the gun reaches (Rules: Gunners and turrets). */
export function gunnerShots(game: GameState, ship: Ship): ShotOrder[] {
  if (!ship.pos) return [];
  const shots: ShotOrder[] = [];
  for (const seat of livingGunners(ship)) {
    const crew = gunnerCrewId(seat);
    if (!canCrewFire(ship, crew)) continue;
    let best: { value: number; shot: ShotOrder } | null = null;
    for (const gun of crewGuns(ship, crew)) {
      for (const target of enemiesOf(game, ship)) {
        if (!gunReaches(ship, gun, crew, ship.pos, ship.facing, target.pos!)) continue;
        const preview = previewShot(game, ship, gun, target, crew);
        const value = chanceAtLeast(ship.gunners![seat]!.skill, 0, preview.difficulty) * damageValue(preview.power);
        if (!best || value > best.value) best = { value, shot: { gun, target: target.id, crew } };
      }
    }
    if (best) shots.push(best.shot);
  }
  return shots;
}

/**
 * Missiles, torpedoes and bombs besides the guns (22): fired only when the shot is good enough for the projectiles it uses up, at the target
 * and with the tubes that add the most to the guns' volley. Every weapon after the first costs the pilot a die, so the guns are reckoned again.
 */
function withSpecial(game: GameState, ship: Ship, guns: { value: number; shots: ShotOrder[] }): ShotOrder[] {
  // a pilot who snap fired (Rules: A game-turn) does not fire again in the Fire Segment
  const weapon = endFireCrew(ship).includes(PILOT) ? specialFor(game, ship) : null;
  const targets = weapon ? targetsForSpecial(game, ship) : [];
  if (!weapon || targets.length === 0) return guns.shots;
  const left = ship.projectiles ?? 0;
  const bombs = weapon.kind === 'CB';
  // the fewer projectiles are left, the better the shot has to be; the 60 bombs are plentiful
  const minChance = bombs ? 0.15 : left <= 2 ? 0.55 : left <= 4 ? 0.45 : 0.35;
  const cost = bombs ? 0 : left <= 4 ? 3 : 1.5;
  // the guns alone, with a die less for the special weapon, or not fired at all
  const volleys: { value: number; shots: ShotOrder[] }[] = [{ value: 0, shots: [] }];
  for (const e of enemiesOf(game, ship)) if (canFireAt(ship.pos!, ship.facing, e.pos!)) volleys.push(volleyAgainst(game, ship, e, 1));
  let best = { total: Math.max(0, guns.value), shots: guns.shots };
  for (const target of targets) {
    const preview = previewSpecial(game, ship, target);
    const damage = Math.max(0.2, 3.5 * preview.power - target.shields[preview.quarter]);
    for (const volley of volleys) {
      const chance = chanceAtLeast(ship.gunnerySkill, volley.shots.length, preview.difficulty);
      if (chance < minChance) continue;
      for (let tubes = 1; tubes <= weapon.tubes; tubes++) {
        // the tubes are one weapon (Rules: Missiles, torpedoes and bombs): the dice are lost once, however many fire
        const total = volley.value + tubes * (chance * damage - cost);
        if (total > best.total) best = { total, shots: [...volley.shots, { gun: SPECIAL, target: target.id, tubes }] };
      }
    }
  }
  return best.shots;
}

/** Fire at the target we are most likely to damage: the pilot's guns at one target, and each gunner's turret at his own. */
export function bestVolley(game: GameState, ship: Ship): ShotOrder[] {
  if (!ship.pos) return [];
  let best: { value: number; shots: ShotOrder[] } = { value: -1, shots: [] };
  for (const target of enemiesOf(game, ship)) {
    if (!canFireAt(ship.pos, ship.facing, target.pos!)) continue;
    const volley = volleyAgainst(game, ship, target);
    if (volley.value > best.value) best = volley;
  }
  for (const target of emplacementsForCrew(game, ship, PILOT)) {
    const volley = volleyAtEmplacement(game, ship, target);
    if (volley.value > best.value) best = volley;
  }
  const sdVolley = bestDestroyerVolley(game, ship);
  if (sdVolley.value > best.value) best = sdVolley;
  const shots = withSpecial(game, ship, best);
  return [...gunnerShots(game, ship), ...(shots.some((s) => s.gun === SPECIAL) ? shots : withSpecialAtGround(game, ship, shots))];
}

/**
 * Missiles, torpedoes and bombs at the ground target or a turret gun (Rules: Missiles, torpedoes and bombs; Ground attack): the dice are body points, with no change for the ground target,
 * so they are what destroys it. Fired when the shot is likely enough for the projectiles it uses.
 */
function withSpecialAtGround(game: GameState, ship: Ship, shots: ShotOrder[]): ShotOrder[] {
  const weapon = endFireCrew(ship).includes(PILOT) ? specialFor(game, ship) : null;
  if (!weapon || !ship.pos || ship.turnedInLastHex) return shots;
  const left = ship.projectiles ?? 0;
  const minChance = weapon.kind === 'CB' ? 0.2 : left <= 2 ? 0.55 : 0.4;
  let best: { value: number; target: EmplacementTarget; chance: number } | null = null;
  // the ground target is what the raid is for, and torpedoes are the way to hurt it: even a long shot is worth a projectile
  const groundMin = Math.min(minChance, 0.1);
  const penalty = shots.length;
  for (const target of emplacementsForCrew(game, ship, PILOT)) {
    if (!emplacementInReach(game, ship, SPECIAL, PILOT, target)) continue;
    const preview = previewEmplacementShot(game, ship, SPECIAL, target);
    const chance = chanceAtLeast(ship.gunnerySkill, penalty, preview.difficulty);
    const value = chance * 3.5 * SPECIAL_DICE[weapon.kind] * (target.id === GROUND_TARGET_ID ? 1.6 : 0.6);
    if (chance >= (target.id === GROUND_TARGET_ID ? groundMin : minChance) && (!best || value > best.value)) best = { value, target, chance };
  }
  if (!best) return shots;
  return [...shots, { gun: SPECIAL, target: best.target.id, tubes: Math.max(1, Math.min(weapon.tubes, left)) }];
}

// ------------------------------------------------------------ turret guns and the ground target (20, 29)

/** How much a hit on this emplacement is worth to the attackers, next to a hit on a ship: the ground target is what the raid is for (it is 10 points). */
function emplacementWeight(target: EmplacementTarget): number {
  if (target.id === GROUND_TARGET_ID) return 1.6;
  return (target as Emplacement).kind === 'double' && !(target as Emplacement).reduced ? 1.1 : 0.9;
}

/** The best way to fire the pilot's guns at a turret gun or the ground target, and its worth (Rules: Ground attack). */
export function volleyAtEmplacement(game: GameState, shooter: Ship, target: EmplacementTarget): { value: number; shots: ShotOrder[] } {
  const guns = pilotAvailableGuns(shooter).filter((g) => gunReaches(shooter, g, PILOT, shooter.pos!, shooter.facing, target.pos));
  let best: { value: number; shots: ShotOrder[] } = { value: 0, shots: [] };
  for (let k = 1; k <= guns.length; k++) {
    const scored = guns
      .map((gun) => {
        const preview = previewEmplacementShot(game, shooter, gun, target);
        return { gun, value: chanceAtLeast(shooter.gunnerySkill, k - 1, preview.difficulty) * damageValue(preview.power) * emplacementWeight(target) };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, k);
    const total = scored.reduce((sum, s) => sum + s.value, 0);
    if (total > best.value) best = { value: total, shots: scored.map((s) => ({ gun: s.gun, target: target.id })) };
  }
  return best;
}

/** The expected damage the turret guns of the other side would do to a ship that ended its move here (Rules: Ground attack): each fires once, at the last chance, if the shot is good enough. */
export function turretThreat(game: GameState, probe: Ship): number {
  if (!probe.pos) return 0;
  let total = 0;
  for (const turret of game.emplacements ?? []) {
    if (turret.status !== 'active' || turret.owner === probe.owner || !turretReaches(turret, probe.pos)) continue;
    const preview = previewTurretShot(game, turret, probe);
    const chance = chanceAtLeast(turret.skill, 0, preview.difficulty);
    if (chance > 0 && chance >= (turret.lastChance ?? 0) / 100) total += chance * damageValue(preview.power);
  }
  return total;
}

/** What a place is worth in a Ground Attack besides the ships: the shot at turrets or the ground target from here, the fire of the turrets, and the pull of the target for the attackers. */
export function groundTerms(game: GameState, probe: Ship): { offence: number; score: number } {
  // enemy Star Destroyers: shots at them and their fire (Rules: Star Destroyers)
  const sd = destroyerTerms(game, probe);
  if (!game.emplacements?.length && !game.groundTarget) return sd;
  const ground = groundTermsOfBase(game, probe);
  return { offence: Math.max(ground.offence, sd.offence), score: ground.score + sd.score };
}

function groundTermsOfBase(game: GameState, probe: Ship): { offence: number; score: number } {
  let offence = 0;
  if (pilotAvailableGuns(probe).length > 0) {
    for (const target of emplacementsForCrew(game, probe, PILOT)) offence = Math.max(offence, volleyAtEmplacement(game, probe, target).value);
  }
  let score = -turretThreat(game, probe) * 1.2;
  const ground = game.groundTarget;
  if (game.groundAttack?.attacker === probe.owner && ground?.status === 'active' && probe.pos) {
    const d = hexDistance(probe.pos, ground.pos);
    // torpedoes and missiles are hard to hit with from afar, bombs have to be dropped on the target: the carriers come close
    const weapon = specialFor(game, probe);
    const want = weapon && (probe.projectiles ?? 0) > 0 ? (weapon.kind === 'CB' ? 0 : 2) : 4;
    score -= Math.abs(d - want) * (enemiesOf(game, probe).length > 0 ? 0.7 : 1.4);
    if (weapon && (probe.projectiles ?? 0) > 0 && !probe.turnedInLastHex && emplacementInReach(game, probe, SPECIAL, PILOT, ground, probe.pos, probe.facing)) {
      const preview = previewEmplacementShot(game, probe, SPECIAL, ground);
      offence = Math.max(offence, 0.5 * chanceAtLeast(probe.gunnerySkill, 0, preview.difficulty) * 3.5 * SPECIAL_DICE[weapon.kind] * 1.6);
    }
    // face it
    if (d > 0) score += ((180 - offNose(probe.pos, probe.facing, ground.pos)) / 180) * 2;
  }
  return { offence, score };
}

// ------------------------------------------------------------ choosing which ship moves

/** How much it matters that this ship moves early: it can shoot, it is about to be shot, it tails an enemy. */
export function urgencyOf(game: GameState, ship: Ship): number {
  let score = 0;
  for (const e of enemiesOf(game, ship)) {
    if (pilotAvailableGuns(ship).length > 0 && canFireAt(ship.pos!, ship.facing, e.pos!)) score += 10 - hexDistance(ship.pos!, e.pos!);
    if (!e.moved && canFireAt(e.pos!, e.facing, ship.pos!)) score += 6;
    if (tails(ship, e)) score += 3;
  }
  return score;
}

/** Which unmoved ship should this player move next? Ships that can shoot, or are about to be shot, go first. */
export function shipToMove(game: GameState, player: PlayerId): Ship {
  const unmoved = activeShips(game).filter((s) => !s.moved);
  const mine = unmoved.filter((s) => s.owner === player);
  const pool = mine.length > 0 ? mine : unmoved;
  let best = pool[0]!;
  let bestScore = -Infinity;
  for (const ship of pool) {
    const score = urgencyOf(game, ship);
    if (score > bestScore) {
      best = ship;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Advanced initiative (19): what the computer says about the ship whose turn it is. A ship that tails an enemy moves with it whenever it can (the target it
 * could shoot at, else the nearest); any other takes the free slot nearest to the place its urgency earns among all the ships: the ones with the most to
 * gain from moving early (as when choosing a ship, 9) first, the rest later.
 */
export function declareMove(game: GameState, urgency: (ship: Ship) => number): Command {
  const table = game.initiativeTable!;
  const ship = shipById(game, nextPicker(table)!)!;
  const options = moveWithOptions(game, ship).map((id) => shipById(game, id)!);
  if (options.length > 0) {
    const score = (e: Ship): number => (pilotAvailableGuns(ship).length > 0 && canFireAt(ship.pos!, ship.facing, e.pos!) ? 100 : 0) - hexDistance(ship.pos!, e.pos!);
    options.sort((a, b) => score(b) - score(a));
    return { type: 'slot', player: ship.owner, moveWith: options[0]!.id };
  }
  const values = new Map(activeShips(game).map((s) => [s.id, urgency(s)]));
  const ranked = activeShips(game).map((s) => s.id).sort((a, b) => values.get(b)! - values.get(a)!);
  const want = ranked.indexOf(ship.id);
  const free = freeSlots(table);
  let best = free[0]!;
  for (const slot of free) if (Math.abs(slot - want) < Math.abs(best - want)) best = slot;
  return { type: 'slot', player: ship.owner, slot: best + 1 };
}

// ------------------------------------------------------------ decisions

const LOSE_ORDER: PlanAction[] = [
  'overspeed', 'angleDeflectors', 'roll', 'jink', 'slip', 'pinpointFire', 'snapFire', 'targeting',
  'halfLoop', 'accelerate', 'overaccelerate', 'decelerate', 'overdecelerate', 'bank', 'overturn',
];

export function decide(game: GameState, pending: Pending): Command {
  const player = pending.player;
  switch (pending.kind) {
    case 'lose': {
      const choice = [...pending.options].sort((a, b) => LOSE_ORDER.indexOf(a) - LOSE_ORDER.indexOf(b))[0]!;
      return { type: 'decide', player, choice };
    }
    case 'skill': {
      // a gunner takes the blow when there is one: the pilot keeps the ship flying
      const choice = pending.options.find((o) => o !== 'pilot') ?? 'pilot';
      return { type: 'decide', player, choice };
    }
    case 'gun': {
      // give up the weakest gun
      const ship = shipById(game, pending.shipId)!;
      const strength = (i: number): number => {
        const gun = parseGun(ship.guns[i]!);
        return powerNumber(gun, 2) + (gun.ion ? -1 : 0);
      };
      const choice = [...pending.options].sort((a, b) => strength(a) - strength(b))[0]!;
      return { type: 'decide', player, choice };
    }
    case 'power': {
      // spare units of auxiliary power first (the computer hardly spends them), then a shield, the R2 unit last
      const choice = (['aux', 'shield', 'body', 'r2'] as const).find((o) => pending.options.includes(o)) ?? pending.options[0]!;
      return { type: 'decide', player, choice };
    }
    case 'steal': {
      // stealing means moving first and shooting before the target can turn away
      const target = shipById(game, pending.target)!;
      const shooter = pending.candidates
        .map((id) => shipById(game, id)!)
        .find((s) => pilotAvailableGuns(s).length > 0 && canFireAt(s.pos!, s.facing, target.pos!));
      return { type: 'decide', player, choice: shooter ? shooter.id : null };
    }
    case 'pass':
      // letting the enemy move first lets us follow it and keep the tail
      return { type: 'decide', player, choice: pending.candidates[0] ?? null };
    case 'follow': {
      // moving before the tailed ship means shooting it where it stands; after it, keeping the tail
      const mover = shipById(game, pending.ship)!;
      const leader = shipById(game, pending.leader)!;
      const shoots = pilotAvailableGuns(mover).length > 0 && canFireAt(mover.pos!, mover.facing, leader.pos!);
      return { type: 'decide', player, choice: shoots ? 'before' : 'after' };
    }
  }
}

// ------------------------------------------------------------ placement

/** The hexes on the straight line between two hexes. */
function lineHexes(a: Hex, b: Hex): Hex[] {
  const n = Math.max(1, hexDistance(a, b));
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const x = a.q + ((b.q - a.q) * i) / n;
    const z = a.r + ((b.r - a.r) * i) / n;
    const y = -x - z;
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    out.push({ q: rx, r: rz });
  }
  return out;
}

/** The edge the computer attacks from (Rules: Ground attack): the one whose straight way to the ground target crosses the fewest turret arcs. */
export function attackEdge(game: GameState): MapEdge {
  const ground = game.groundTarget;
  const guns = (game.emplacements ?? []).filter((e) => e.status === 'active');
  if (!ground) return 'top';
  let best: MapEdge = 'top';
  let bestThreat = Infinity;
  for (const edge of MAP_EDGES) {
    const threat = lineHexes(edgeMidpoint(game.map, edge), ground.pos).reduce((sum, h) => sum + guns.filter((g) => turretReaches(g, h)).length, 0);
    if (threat < bestThreat) {
      bestThreat = threat;
      best = edge;
    }
  }
  return best;
}

/** Where the defenders wait: round the ground target. They do not know which edge the attackers will choose (Rules: Ground attack). */
function guardHex(game: GameState): Hex | null {
  return game.groundTarget?.pos ?? null;
}

/**
 * The defenders of a base stand in a ring round the ground target, three to five hexes from it and evenly spread, each facing along the ring (all the same way
 * round, as if on patrol): wherever the attack comes from, some of them already face it. The defenders do not know the edge, so the ring does not depend on it (Rules: Ground attack).
 * Returns the hexes in the order of the ring, or fewer than `count` when the area has no room.
 */
function guardRing(game: GameState, zone: Hex[], guard: Hex, count: number): Hex[] {
  const pixel = (h: Hex): { x: number; y: number } => ({ x: 1.5 * h.q, y: Math.sqrt(3) * (h.r + h.q / 2) });
  const centre = pixel(guard);
  const start = createRng(game.rngState ^ 0x2a5).next() * Math.PI * 2;
  const ring: Hex[] = [];
  for (let k = 0; k < count; k++) {
    const angle = start + (2 * Math.PI * k) / count;
    const ideal = { x: centre.x + Math.cos(angle) * 4 * Math.sqrt(3), y: centre.y + Math.sin(angle) * 4 * Math.sqrt(3) };
    let best: Hex | null = null;
    let bestMiss = Infinity;
    for (const h of zone) {
      const d = hexDistance(guard, h);
      if (d < 3 || d > 5 || ring.some((r) => hexDistance(r, h) < 3)) continue;
      const p = pixel(h);
      const miss = Math.hypot(p.x - ideal.x, p.y - ideal.y);
      if (miss < bestMiss) {
        bestMiss = miss;
        best = h;
      }
    }
    if (best) ring.push(best);
  }
  return ring;
}

/** The hex side that points most nearly along the circle round `guard` through `pos`, clockwise on the screen: a ship that flies it patrols round the target. */
function patrolFacing(guard: Hex, pos: Hex): Facing {
  const pixel = (q: number, r: number): { x: number; y: number } => ({ x: 1.5 * q, y: Math.sqrt(3) * (r + q / 2) });
  const out = pixel(pos.q - guard.q, pos.r - guard.r);
  // the screen's y axis points down: turning (x, y) clockwise gives (-y, x)
  const along = { x: -out.y, y: out.x };
  let best: Facing = 0;
  let bestDot = -Infinity;
  for (let f = 0; f < 6; f++) {
    const d = pixel(DIRECTIONS[f]!.q, DIRECTIONS[f]!.r);
    const dot = d.x * along.x + d.y * along.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = f as Facing;
    }
  }
  return best;
}

/** The edge a side that picks its start edge starts along (Rules: Reserves): one of the options, by the dice. */
export function startEdgeCommand(game: GameState, player: PlayerId): Command | null {
  const c = game.edgeChoice;
  if (!c || c.side !== player || c.edge || game.phase !== 'setup') return null;
  return { type: 'edge', player, edge: c.options[game.rngState % c.options.length]! };
}

/**
 * What a computer player does with reserves (Rules: Reserves): it brings them in as soon as it may, along the edge nearest the enemy when it may choose,
 * in the hexes nearest the enemy, facing it.
 */
export function reserveCommand(game: GameState, player: PlayerId): Command | null {
  if (game.phase === 'entry') return { type: 'enter', player, enter: true };
  if (game.phase !== 'arrival' || !game.arrival) return null;
  const group = reserveGroup(game, game.arrival.group);
  if (!group) return null;
  const enemies = activeShips(game, player === 0 ? 1 : 0).filter((s) => s.pos);
  const target: Hex = enemies[0]?.pos ?? { q: 0, r: 0 };
  const edge = group.along.kind === 'any' ? [...MAP_EDGES].sort((a, b) => hexDistance(edgeMidpoint(game.map, a), target) - hexDistance(edgeMidpoint(game.map, b), target))[0] : undefined;
  const blocked = game.asteroids ? coveredHexes(game.asteroids) : new Set<string>();
  const taken = game.ships.filter((s) => s.status === 'active' && s.pos).map((s) => s.pos!);
  const free = arrivalHexes(game, edge).filter((h) => !blocked.has(keyOf(h)) && !taken.some((t) => hexDistance(t, h) === 0));
  const ranked = [...free].sort((a, b) => hexDistance(a, target) - hexDistance(b, target));
  const ships = group.shipIds.map((id) => shipById(game, id)!).filter((s) => s.status === 'reserve');
  const chosen: Hex[] = [];
  for (const h of ranked) {
    if (chosen.length === ships.length) break;
    if (group.within !== undefined && chosen.some((c) => hexDistance(c, h) > group.within!)) continue;
    chosen.push(h);
  }
  if (chosen.length < ships.length) return null;
  return { type: 'arrive', player, ...(edge ? { edge } : {}), placements: ships.map((s, i) => ({ shipId: s.id, pos: chosen[i]!, facing: setupFacing(chosen[i]!, target) })) };
}

export function place(game: GameState, player: PlayerId): Command {
  const edgeFirst = startEdgeCommand(game, player);
  if (edgeFirst) return edgeFirst;
  // the attackers of a Ground Attack choose the edge they come from, having seen the base (Rules: Ground attack)
  if (game.groundAttack && !game.groundAttack.edge && game.groundAttack.attacker === player) return { type: 'edge', player, edge: attackEdge(game) };
  // a defender who has to place the ground target and the base lets the game lay them out
  if (game.baseSetup && !game.baseSetup.done && game.baseSetup.defender === player) return { type: 'base', player, items: autoBase(createRng(game.rngState ^ 0x51ed), game.map, game.baseSetup.kit) };
  // ships may not start in a hex with an asteroid in it
  const blocked = game.asteroids ? coveredHexes(game.asteroids) : new Set<string>();
  const open = game.zones[player].filter((h) => !blocked.has(keyOf(h)));
  // the Star Destroyers take their place first, and the fighters keep out of their hexes
  const sds = destroyerPlacements(game, player, open);
  const zone = open.filter((h) => !sds.used.has(keyOf(h)));
  const enemyZone = game.zones[player === 0 ? 1 : 0];
  const target = enemyZone[Math.floor(enemyZone.length / 2)];
  // the defenders of a Ground Attack do not know the attackers' edge: they all start facing north (the other side may be hidden from this view)
  const edgeUnknown = !!game.groundAttack && game.groundAttack.attacker !== player;
  const centre = zone[Math.floor(zone.length / 2)]!;
  // the defenders of a base wait in front of it, under the cover of its guns, not out at the edge where the attackers come in
  const guard = game.groundAttack && game.groundAttack.attacker !== player ? guardHex(game) : null;
  // the hexes of our area nearest the enemy, as a loose line abreast
  const aim = guard ?? target ?? centre;
  const ranked = [...zone].sort((a, b) => hexDistance(a, aim) - hexDistance(b, aim) || hexDistance(a, centre) - hexDistance(b, centre));
  const wanted = activeShips(game, player).length;
  // the defenders of a base stand in a ring round the ground target; anything that does not fit is placed as a loose line
  const chosen: Hex[] = guard ? guardRing(game, zone, guard, wanted) : [];
  const ringed = chosen.length;
  for (const h of ranked) {
    if (chosen.length === wanted) break;
    if (chosen.every((c) => hexDistance(c, h) >= 3)) chosen.push(h);
  }
  const placements = activeShips(game, player).map((ship, i) => {
    const pos = chosen[i]!;
    // a ring defender flies along the ring, clockwise; otherwise straight north or south, whichever way the enemy lies (a defender of a base, who does not know the edge, faces north)
    const facing: Facing = guard && i < ringed ? patrolFacing(guard, pos) : edgeUnknown || !target ? 0 : setupFacing(pos, target);
    return { shipId: ship.id, pos, facing };
  });
  return { type: 'place', player, placements: [...placements, ...sds.placements] };
}

// ------------------------------------------------------------ entry point

export function simpleAi(rng: Rng): Ai {
  return (game, player) => {
    if (!waitingFor(game).includes(player)) return null;
    if (game.pending) return decide(game, game.pending);

    switch (game.phase) {
      case 'forces': return chooseForce(game, player, rng);
      case 'setup': return place(game, player);
      case 'entry':
      case 'arrival': return reserveCommand(game, player);
      case 'initiative': return declareMove(game, (s) => urgencyOf(game, s));
      case 'destroyers': return destroyerCommand(game, player, rng);
      case 'planning': {
        // the turret guns are turned and given their orders while planning (Rules: Ground attack)
        if (needsTurretOrders(game, player)) return { type: 'turrets', player, orders: turretOrdersFor(game, player) };
        const plans: Record<string, Plan> = {};
        const crewPlans: Record<string, Plan[]> = {};
        for (const ship of activeShips(game, player)) {
          plans[ship.id] = planFor(game, ship);
          const crew = crewPlansFor(ship, plans[ship.id]!);
          if (crew) crewPlans[ship.id] = crew;
        }
        return { type: 'plan', player, plans, crewPlans };
      }
      case 'ships': {
        if (!game.active) return { type: 'chooseShip', player, shipId: shipToMove(game, player).id };
        const ship = shipById(game, game.active.queue[game.active.index]!)!;
        if (game.active.stage === 'move') return { type: 'move', player, shipId: ship.id, steps: bestMove(game, ship, rng) };
        return { type: 'fire', player, shipId: ship.id, shots: bestVolley(game, ship) };
      }
      default: return null;
    }
  };
}

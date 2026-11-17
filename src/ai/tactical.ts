import {
  activeShips,
  hasSideQuarters,
  shieldMove,
  escapeVpOf,
  exitBlocked,
  exitEdgeOf,
  isObjectiveShip,
  toOffset,
  applyStepToPosition,
  canComplete,
  canFireAt,
  chanceAtLeast,
  emptyPlan,
  hexDistance,
  isTrackerComplete,
  leavesMap,
  moveContext,
  openMapSlack,
  asteroidDifficulty,
  rockAt,
  rockSize,
  planDifficultyEntries,
  planShapeError,
  previewShot,
  repairOptions,
  relativeBearing,
  shipById,
  speedAfterMarkers,
  startTracker,
  stepTracker,
  tails,
  totalDifficulty,
  trackerKey,
  typeOf,
  waitingFor,
  withFeasibleObligations,
  type Command,
  type Facing,
  type GameState,
  type Hex,
  type MoveContext,
  type MoveStep,
  type MoveStepCommand,
  type Pending,
  type Plan,
  type RepairChoice,
  type PlayerId,
  type Rng,
  type Ship,
  type ShotOrder,
  type SkillCode,
  pilotAvailableGuns,
  turretOrdersFor,
  needsTurretOrders,
  trackableEmplacements,
  GROUND_TARGET_ID,
  PILOT,
} from '../engine';
import { chooseForce } from './force';
import type { Ai } from './player';
import { destroyerCommand } from './destroyers';
import { bestVolley, crewPlansFor, declareMove, decide as basicDecide, enemiesOf, groundTerms, nearest, offNose, place, reserveCommand, volleyAgainst } from './simple';

/**
 * A tactical computer player. Where the basic AI follows fixed rules, this one looks at what is
 * actually possible:
 *
 *  - It enumerates every place a ship can legally end its move (every slip, turn and half loop),
 *    and scores each by the shot it would get, the shots it would give away, and its position.
 *  - It plans by trying many combinations of speed change, bank, overturn, half loop and jink, and
 *    keeping the one whose best reachable position is best after paying for the hazard risk.
 *  - It chooses which ship moves next by asking who can really attack now, who is in real danger
 *    and can escape by moving first, and otherwise makes the opponent move first.
 *
 * Its main blind spot is that it assumes ships it is not moving stay where they are.
 */

const SEARCH_STEPS: MoveStep[] = ['forward', 'slipLeft', 'slipRight', 'turnLeft', 'turnRight', 'halfLoop'];

/** Expected damage above which an attack, or a threat, counts as realistic. */
const REALISTIC = 0.5;
/** How many of the best-looking end positions get the expensive look at the enemy's replies. */
const TOP_ENDS = 14;
/** Score points per unit of expected damage given or taken. */
const OFFENCE_W = 6;
const EXPOSURE_W = 4.5;
/** Score points per victory point a ship earns by leaving the map: when the scenario pays for it (a convoy, see Rules: Convoy) nothing else counts for as much. */
const ESCAPE_W = 40;
/** Score points per hex a ship that is trying to get away still has to cover to the edge of the map. */
const FLEE_W = 2;

const defaultRng: Rng = { next: () => 0.5 };

/** Knobs for experiments (scripts/sim.ts can change them). */
export const TUNING = {
  speedBonus: 0.7,
  /** Score points per body point a ship can expect to lose to the asteroids on its way (Rules: Asteroid fields); 0 would ignore them. */
  rockWeight: 12,
};

// ------------------------------------------------------------------ every legal ending of a move

interface PathNode {
  step: MoveStep;
  prev: PathNode | null;
  /** Where a snap fire is taken from. */
  at?: { pos: Hex; facing: Facing };
}

interface End {
  pos: Hex;
  facing: Facing;
  path: PathNode | null;
  /** Expected damage of the snap fire taken on the way here (0 when there is none). */
  snap: number;
  /** Expected body points lost to the asteroids entered on the way here. */
  risk: number;
}

function stepsOf(end: End): PathNode[] {
  const nodes: PathNode[] = [];
  for (let n = end.path; n; n = n.prev) nodes.push(n);
  return nodes.reverse();
}

/** The place a ship's snap fire would be taken from on the way to this ending. */
function snapSpotOf(end: End): { pos: Hex; facing: Facing } | null {
  for (let n = end.path; n; n = n.prev) if (n.at) return n.at;
  return null;
}

/**
 * Every hex and facing a ship can finish its move in, with one way of getting there. When the
 * ship has planned snap fire, `snapValue` says what a volley from a given hex and facing is worth,
 * and the search also takes snap fire wherever it pays (Rules: Movement): the best route to each ending is
 * the one with the best snap shot on the way.
 */
function enumerateEnds(
  probe: Ship,
  snapValue?: (pos: Hex, facing: Facing) => number,
  /** The body points a ship can expect to lose by entering this hex (an asteroid in it). */
  hazard?: (pos: Hex) => number,
): { ctx: MoveContext; ends: End[] } {
  const { ctx } = withFeasibleObligations(moveContext(probe));
  const feasible = new Map<string, boolean>();
  const best = new Map<string, number>();
  const ends = new Map<string, End>();
  const snapMemo = new Map<string, number>();
  const snapAt = (pos: Hex, facing: Facing): number => {
    const k = `${pos.q},${pos.r},${facing}`;
    let v = snapMemo.get(k);
    if (v === undefined) {
      v = snapValue!(pos, facing);
      snapMemo.set(k, v);
    }
    return v;
  };
  type Node = { pos: Hex; facing: Facing; tr: ReturnType<typeof startTracker>; path: PathNode | null; snap: number; risk: number };
  const stack: Node[] = [{ pos: probe.pos!, facing: probe.facing, tr: startTracker(ctx), path: null, snap: 0, risk: 0 }];
  // what a route is worth: the snap shots it takes, less the asteroids it flies into
  const merit = (n: { snap: number; risk: number }): number => n.snap * OFFENCE_W - n.risk * TUNING.rockWeight;
  let visits = 0;
  while (stack.length > 0 && visits < 40000) {
    const cur = stack.pop()!;
    const key = `${cur.pos.q},${cur.pos.r},${cur.facing}|${trackerKey(cur.tr)}`;
    const seenValue = best.get(key);
    if (seenValue !== undefined && seenValue >= merit(cur)) continue;
    best.set(key, merit(cur));
    visits += 1;
    if (isTrackerComplete(ctx, cur.tr)) {
      const spot = `${cur.pos.q},${cur.pos.r},${cur.facing}`;
      const old = ends.get(spot);
      if (!old || merit(cur) > merit(old)) ends.set(spot, { pos: cur.pos, facing: cur.facing, path: cur.path, snap: cur.snap, risk: cur.risk });
    }
    for (const step of SEARCH_STEPS) {
      const next = stepTracker(ctx, cur.tr, step);
      if (!next || !canComplete(ctx, next, feasible)) continue;
      const moved = applyStepToPosition(cur.pos, cur.facing, step);
      const entered = hazard && (moved.pos.q !== cur.pos.q || moved.pos.r !== cur.pos.r) ? hazard(moved.pos) : 0;
      stack.push({ pos: moved.pos, facing: moved.facing, tr: next, path: { step, prev: cur.path }, snap: cur.snap, risk: cur.risk + entered });
    }
    if (snapValue && ctx.snapLevel > 0) {
      const next = stepTracker(ctx, cur.tr, 'snapFire');
      if (next && canComplete(ctx, next, feasible)) {
        const value = snapAt(cur.pos, cur.facing);
        if (value > 0) {
          stack.push({
            pos: cur.pos,
            facing: cur.facing,
            tr: next,
            path: { step: 'snapFire', prev: cur.path, at: { pos: cur.pos, facing: cur.facing } },
            snap: cur.snap + value,
            risk: cur.risk,
          });
        }
      }
    }
  }
  return { ctx, ends: [...ends.values()] };
}

/** The best volley a ship could fire from a hex and facing at the enemy where it stands. */
function bestShotsFrom(game: GameState, ship: Ship, pos: Hex, facing: Facing): { value: number; shots: ShotOrder[] } {
  const probe: Ship = { ...ship, pos, facing };
  let best: { value: number; shots: ShotOrder[] } = { value: 0, shots: [] };
  for (const e of enemiesOf(game, ship)) {
    if (!canFireAt(pos, facing, e.pos!)) continue;
    const v = volleyAgainst(game, probe, e);
    if (v.value > best.value) best = v;
  }
  return best;
}

// ------------------------------------------------------------------ judging a position

const meanOf = (s: SkillCode): number => 3.5 * s.dice + s.pips;
const hasGuns = (s: Ship): boolean => pilotAvailableGuns(s).length > 0;

/** How good is it to stand here, facing this way, with this ship's plan? */
function evaluate(game: GameState, probe: Ship, skipThreatFrom: Set<string>): { score: number; offence: number } {
  const pos = probe.pos!;
  const facing = probe.facing;
  // a ship the scenario pays for getting away runs for the edge; any other ship stays on the map
  const fleeing = isObjectiveShip(game, probe);
  if (leavesMap(game, probe, pos)) return fleeing && !exitBlocked(game, probe, pos) ? { score: Math.max(1, escapeVpOf(game, probe)) * ESCAPE_W, offence: 0 } : { score: -1000, offence: 0 };
  let score = 0;
  let offence = 0;

  if (game.map.mode === 'open') {
    const others = activeShips(game).flatMap((s) => (s.id !== probe.id && s.pos ? [s.pos] : []));
    const slack = openMapSlack(game.map, [...others, pos]);
    if (fleeing) score -= slack * FLEE_W;
    else if (slack < 5) score -= (5 - slack) * 3;
  } else if (fleeing) {
    const { col, row } = toOffset(pos);
    // a ship that may leave across one edge only heads for that one
    const only = exitEdgeOf(game, probe);
    const depth = { top: row, bottom: game.map.rows - 1 - row, left: col, right: game.map.cols - 1 - col };
    score -= (only ? depth[only] : Math.min(depth.top, depth.bottom, depth.left, depth.right)) * FLEE_W;
  }

  const enemies = enemiesOf(game, probe);
  // a fleeing ship does not look for a fight: it keeps clear of the guns and takes a shot only when one offers itself
  const near = fleeing ? undefined : nearest(pos, enemies);
  if (near) {
    const d = hexDistance(pos, near.pos!);
    score -= Math.abs(d - 3) * 0.9;
    if (d === 0) score -= 8;
  }

  // A single snap fire replaces the shot at the end of the move (Rules: A game-turn), so the end hex then earns no offence
  const armed = hasGuns(probe) && probe.plan.snapFire !== 1;
  const firstGun = pilotAvailableGuns(probe)[0] ?? -1;
  for (const e of enemies) {
    const d = hexDistance(pos, e.pos!);
    if (d === 0 || d > 16) continue;
    const weight = d <= 6 ? 1 : 0.4;
    if (armed && canFireAt(pos, facing, e.pos!)) {
      offence = Math.max(offence, volleyAgainst(game, probe, e).value);
      // even a hopeless shot is better when it is nearly possible: it shapes the search toward good aim
      const margin = meanOf(probe.gunnerySkill) - previewShot(game, probe, firstGun, e).difficulty;
      score += Math.max(-12, Math.min(8, margin)) * 0.3;
    }
    if (!skipThreatFrom.has(e.id) && hasGuns(e) && canFireAt(e.pos!, e.facing, pos)) {
      score -= volleyAgainst(game, e, probe).value * (e.moved ? 1.5 : 1.1);
    }
    if (!fleeing && tails(probe, e)) score += 8;
    if (tails(e, probe)) score -= 8;
    if (!fleeing) score += ((180 - (hexDistance(pos, e.pos!) === 0 ? 90 : offNose(pos, facing, e.pos!))) / 180) * 3 * weight;
  }
  // the turret guns and the ground target of a Ground Attack: shots at them, their fire, and the pull of the target
  const ground = groundTerms(game, probe);
  if (armed) offence = Math.max(offence, ground.offence);
  return { score: score + offence * OFFENCE_W + ground.score, offence };
}

interface Ranked {
  end: End;
  score: number;
  offence: number;
}

function rankEnds(game: GameState, probe: Ship, ends: End[], skip: Set<string>, keep: number, rng: Rng): Ranked[] {
  const ranked: Ranked[] = ends.map((end) => {
    const here = evaluate(game, { ...probe, pos: end.pos, facing: end.facing }, skip);
    // the snap fire on the way counts like any other shot
    return { end, score: here.score + end.snap * OFFENCE_W - end.risk * TUNING.rockWeight + rng.next() * 0.01, offence: here.offence + end.snap };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, keep);
}

// ------------------------------------------------------------------ hazards

/** Expected cost of the hazards a plan risks, in the same points as `evaluate`. */
function hazardCost(total: number, skill: SkillCode): number {
  if (total <= 0) return 0;
  const anyShort = 1 - chanceAtLeast(skill, 0, total);
  let fullHazards = 0;
  for (let k = 1; k <= 4; k++) fullHazards += 1 - chanceAtLeast(skill, 0, total - 5 * k + 1);
  return 3 * anyShort + 8 * fullHazards;
}

// ------------------------------------------------------------------ the thinking part

interface Analysis {
  best: { end: End; score: number; offence: number; exposure: number } | null;
  /** Expected damage the ship would take if it stood still and the enemy moved first. */
  exposureNow: number;
  /** What moving this ship first is worth: the shot it would get, plus the danger it would escape. */
  goFirst: number;
}

class Brain {
  private reach = new Map<string, { ctx: MoveContext; ends: End[] }>();

  constructor(
    readonly game: GameState,
    readonly rng: Rng,
  ) {}

  private rockCosts = new Map<string, number>();

  /** The body points a ship can expect to lose by flying into the asteroid in a hex (Rules: Asteroid fields): the shortfall of its piloting roll, less its shields. */
  rockRisk(ship: Ship, pos: Hex): number {
    const rock = this.game.asteroids ? rockAt(this.game.asteroids, pos) : undefined;
    if (!rock) return 0;
    const difficulty = asteroidDifficulty(ship, rockSize(rock));
    const key = `${ship.id}|${difficulty}`;
    let shortfall = this.rockCosts.get(key);
    if (shortfall === undefined) {
      // the mean of (difficulty - roll) where that is positive
      shortfall = 0;
      for (let k = 1; k <= difficulty; k++) shortfall += 1 - chanceAtLeast(ship.pilotSkill, 0, k);
      this.rockCosts.set(key, shortfall);
    }
    return Math.max(0, shortfall - ship.shields.front * 0.6);
  }

  /** Cached enumeration for a ship as it stands, with its real plan and speed. */
  endsOf(ship: Ship): End[] {
    let hit = this.reach.get(ship.id);
    if (!hit) {
      const snap = ship.plan.snapFire > 0 && hasGuns(ship) ? (pos: Hex, facing: Facing) => bestShotsFrom(this.game, ship, pos, facing).value : undefined;
      hit = enumerateEnds(ship, snap, this.game.asteroids ? (pos: Hex) => this.rockRisk(ship, pos) : undefined);
      this.reach.set(ship.id, hit);
    }
    return hit.ends;
  }

  private unmovedEnemies(of: Ship): Ship[] {
    return activeShips(this.game).filter((s) => s.owner !== of.owner && !s.moved && s.pos);
  }

  /** Expected damage the enemy's unmoved ships could do to `victim` if they moved now, each choosing its best ending. */
  exposureOn(victim: Ship): number {
    let total = 0;
    for (const e of this.unmovedEnemies(victim)) {
      if (!hasGuns(e)) continue;
      const endShoots = e.plan.snapFire !== 1;
      let best = 0;
      for (const end of this.endsOf(e)) {
        let v = 0;
        if (endShoots && canFireAt(end.pos, end.facing, victim.pos!)) {
          v += volleyAgainst(this.game, { ...e, pos: end.pos, facing: end.facing }, victim).value;
        }
        if (end.snap > 0) {
          const at = snapSpotOf(end);
          if (at && canFireAt(at.pos, at.facing, victim.pos!)) {
            v += volleyAgainst(this.game, { ...e, pos: at.pos, facing: at.facing }, victim).value;
          }
        }
        if (v > best) best = v;
      }
      total += best;
    }
    return total;
  }

  /** The best expected damage `ship` could do by moving now (ignoring what the reply would be). */
  offencePotential(ship: Ship): number {
    if (!hasGuns(ship)) return 0;
    const endShoots = ship.plan.snapFire !== 1;
    const targets = enemiesOf(this.game, ship);
    let best = 0;
    for (const end of this.endsOf(ship)) {
      let v = end.snap;
      if (endShoots) {
        const probe = { ...ship, pos: end.pos, facing: end.facing };
        let shot = 0;
        for (const t of targets) {
          if (!canFireAt(end.pos, end.facing, t.pos!)) continue;
          shot = Math.max(shot, volleyAgainst(this.game, probe, t).value);
        }
        v += shot;
      }
      if (v > best) best = v;
    }
    return best;
  }

  analyse(ship: Ship): Analysis {
    const enemyIds = new Set(this.unmovedEnemies(ship).map((s) => s.id));
    const ranked = rankEnds(this.game, ship, this.endsOf(ship), enemyIds, TOP_ENDS, this.rng);
    let best: Analysis['best'] = null;
    for (const r of ranked) {
      const exposure = this.exposureOn({ ...ship, pos: r.end.pos, facing: r.end.facing });
      const total = r.score - EXPOSURE_W * exposure;
      if (!best || total > best.score) best = { end: r.end, score: total, offence: r.offence, exposure };
    }
    const exposureNow = this.exposureOn(ship);
    const escaped = best ? Math.max(0, exposureNow - best.exposure) : 0;
    return { best, exposureNow, goFirst: (best?.offence ?? 0) + escaped };
  }

  // ---- which ship moves

  pickShip(player: PlayerId): Ship {
    const unmoved = activeShips(this.game).filter((s) => !s.moved);
    const mine = unmoved.filter((s) => s.owner === player);
    const theirs = unmoved.filter((s) => s.owner !== player);
    if (theirs.length === 0) return this.bestOf(mine);
    if (mine.length === 0) return theirs[0]!;

    const ownAnalysis = mine.map((s) => ({ ship: s, a: this.analyse(s) }));
    ownAnalysis.sort((x, y) => y.a.goFirst - x.a.goFirst);
    const top = ownAnalysis[0]!;
    // Attack that is really possible, or a real danger that moving first escapes: go now
    if (top.a.goFirst >= REALISTIC) return top.ship;

    // Otherwise make the enemy move first, choosing the one that can do us least harm
    const potentials = theirs.map((e) => ({ ship: e, off: this.offencePotential(e) }));
    const safe = potentials.filter((p) => p.off < REALISTIC);
    if (safe.length > 0) {
      safe.sort((x, y) => x.off - y.off || this.nearestDistance(x.ship) - this.nearestDistance(y.ship));
      return safe[0]!.ship;
    }
    // Every enemy ship has a real shot: better to act than to hand one over, if moving helps at all
    if (top.a.goFirst > 0.15) return top.ship;
    potentials.sort((x, y) => x.off - y.off);
    return potentials[0]!.ship;
  }

  private nearestDistance(ship: Ship): number {
    const mine = enemiesOf(this.game, ship);
    const n = nearest(ship.pos!, mine);
    return n ? hexDistance(ship.pos!, n.pos!) : 99;
  }

  private bestOf(ships: Ship[]): Ship {
    return ships.map((s) => ({ s, v: this.analyse(s).goFirst })).sort((a, b) => b.v - a.v)[0]!.s;
  }

  // ---- how a ship moves

  moveFor(ship: Ship): MoveStepCommand[] {
    const a = this.analyse(ship);
    if (!a.best) return [];
    const commands: MoveStepCommand[] = [];
    let pos = ship.pos!;
    let facing = ship.facing;
    for (const node of stepsOf(a.best.end)) {
      if (node.step === 'snapFire') {
        commands.push({ kind: 'snapFire', shots: bestShotsFrom(this.game, ship, pos, facing).shots });
        continue;
      }
      commands.push({ kind: node.step });
      const moved = applyStepToPosition(pos, facing, node.step);
      pos = moved.pos;
      facing = moved.facing;
    }
    return commands;
  }

  // ---- planning

  plan(ship: Ship): Plan {
    return this.withRepairs(ship, this.basePlan(ship));
  }

  /**
   * Damage control (17): when the ship is damaged and can have it done for free (by its R2 unit, or with a unit of auxiliary power), the
   * computer plans it. It does not pay difficulty for it.
   */
  private withRepairs(ship: Ship, plan: Plan): Plan {
    if (!this.game.damageRules) return plan;
    const options = repairOptions(ship);
    const free = ship.r2?.aboard || (ship.aux ?? 0) >= 1;
    if (options.length === 0 || !free || plan.damageControl > 0) return plan;
    const trial: Plan = { ...plan, damageControl: 1, repair: bestRepair(ship, options), pay: { ...plan.pay, damageControl: 'f' } };
    return planShapeError(trial, typeOf(ship).shields !== null) ? plan : trial;
  }

  private basePlan(ship: Ship): Plan {
    const type = typeOf(ship);
    const diff = type.difficulty;
    const enemies = enemiesOf(this.game, ship);
    const tailed = enemies.filter((e) => tails(ship, e));
    const armed = hasGuns(ship);

    const forced = (plan: Plan): Plan => ({
      ...plan,
      roll: Math.min(2, plan.roll + ship.forcedRoll) as Plan['roll'],
      overspeed: Math.max(plan.overspeed, ship.forcedOverspeed) as Plan['overspeed'],
    });
    const costOf = (eff: Plan): number =>
      hazardCost(totalDifficulty(planDifficultyEntries(eff, diff, ship.stabilizerDamage, ship.actionPenalty)), ship.pilotSkill);

    interface Candidate {
      plan: Plan;
      eff: Plan;
      probe: Ship;
      key: string;
      cost: number;
      score: number;
    }

    const candidates: Candidate[] = [];
    const s = ship.speed;
    const m = ship.maxSpeed;
    const speeds: Partial<Plan>[] = [{}];
    if (s < m) speeds.push({ accelerate: 1 });
    if (s <= m - 3) speeds.push({ overaccelerate: 1 });
    if (s >= 2) speeds.push({ decelerate: 1 });
    if (s >= 3) speeds.push({ decelerate: 2 });
    if (s >= 5) speeds.push({ overdecelerate: 1 });
    const turns: Partial<Plan>[] = [{}, { bank: 1 }, { bank: 2 }, { overturn: 1 }, { halfLoop: 1 }, { halfLoop: 1, bank: 1 }];
    const jinks: Partial<Plan>[] = [{}, { jink: 1 }];

    for (const sp of speeds) {
      for (const tu of turns) {
        for (const jk of jinks) {
          const plan: Plan = { ...emptyPlan(), ...sp, ...tu, ...jk } as Plan;
          if (planShapeError(plan, type.shields !== null)) continue;
          const eff = forced(plan);
          const cost = costOf(eff);
          if (cost > 16) continue;
          const speed = speedAfterMarkers(ship, eff);
          const probe: Ship = { ...ship, plan: eff, speed };
          const tn = moveContext(probe).turnNumber;
          candidates.push({ plan, eff, probe, key: `${speed}|${tn}|${eff.slip}|${eff.halfLoop}|${eff.snapFire}`, cost, score: -Infinity });
        }
      }
    }
    if (candidates.length === 0) return emptyPlan();

    // Search each distinct kind of movement once, then judge every plan that allows it
    const shared = new Map<string, End[]>();
    const skip = new Set<string>();
    for (const c of candidates) {
      let ends = shared.get(c.key);
      if (!ends) {
        const all = enumerateEnds(c.probe).ends;
        ends = rankEnds(this.game, c.probe, all, skip, 10, this.rng).map((r) => r.end);
        shared.set(c.key, ends);
      }
      const ranked = rankEnds(this.game, c.probe, ends, skip, 1, this.rng);
      c.score = (ranked[0]?.score ?? -1000) - c.cost + TUNING.speedBonus * c.probe.speed;
    }
    candidates.sort((a, b) => b.score - a.score);

    // Extras for the best few plans: pinpoint fire, tracking a tailed ship, and snap fire (single or
    // double). Snap fire changes how the move can be used, so each level gets its own search.
    let bestPlan = candidates[0]!.plan;
    let bestScore = -Infinity;
    const prey = tailed.length > 0 ? nearest(ship.pos!, tailed)! : null;
    // what could be tracked: the nearest tailed ship, and (Rules: Ground attack) the ground target and the nearest turret gun ahead
    const trackIds: string[] = prey ? [prey.id] : [];
    if (armed) {
      const ground = trackableEmplacements(this.game, ship, PILOT);
      if (ground.some((t) => t.id === GROUND_TARGET_ID)) trackIds.push(GROUND_TARGET_ID);
      const turret = ground.filter((t) => t.id !== GROUND_TARGET_ID).sort((a, b) => hexDistance(ship.pos!, a.pos) - hexDistance(ship.pos!, b.pos))[0];
      if (turret) trackIds.push(turret.id);
    }
    const snapAble = armed && diff.snapFire !== null;
    for (const c of candidates.slice(0, 3)) {
      for (const snap of snapAble ? ([0, 1, 2] as const) : ([0] as const)) {
        let ends: End[];
        if (snap === 0) {
          ends = shared.get(c.key) ?? [];
        } else {
          const key = `${c.key}|snap${snap}`;
          let cached = shared.get(key);
          if (!cached) {
            const withSnap: Ship = { ...c.probe, plan: forced({ ...c.plan, snapFire: snap }) };
            const all = enumerateEnds(withSnap, (pos, facing) => bestShotsFrom(this.game, withSnap, pos, facing).value).ends;
            cached = rankEnds(this.game, withSnap, all, skip, 25, this.rng).map((r) => r.end);
            shared.set(key, cached);
          }
          ends = cached;
        }
        for (const pinpoint of armed ? ([0, 1] as const) : ([0] as const)) {
          for (const trackId of [null, ...trackIds]) {
            const track = trackId ? 1 : 0;
            const vplan: Plan = {
              ...c.plan,
              snapFire: snap,
              pinpointFire: pinpoint,
              targeting: track,
              targetingTarget: trackId,
            };
            if (planShapeError(vplan, type.shields !== null)) continue;
            const eff = forced(vplan);
            const cost = costOf(eff);
            if (cost > 16) continue;
            const probe: Ship = { ...c.probe, plan: eff, ...(trackId ? { tracking: { target: trackId, level: 1 as const } } : {}) };
            const ranked = rankEnds(this.game, probe, ends, skip, 1, this.rng);
            const score = (ranked[0]?.score ?? -1000) - cost + TUNING.speedBonus * c.probe.speed;
            if (score > bestScore) {
              bestScore = score;
              bestPlan = vplan;
            }
          }
        }
      }
    }

    // Shields: face them where the danger is
    const result: Plan = { ...bestPlan };
    if (type.shields !== null && diff.angleDeflectors !== null && result.angleDeflectors === 0) {
      const tailedBy = enemies.filter((e) => tails(e, ship));
      const toRear = tailedBy.length > 0 && ship.shields.front > ship.shields.rear + 1;
      const toFront = tailedBy.length === 0 && ship.shields.rear > ship.shields.front + 1;
      const wide = hasSideQuarters(this.game, ship) ? shieldMove(this.game, ship, enemies) : null;
      if (wide || toRear || toFront) {
        const trial: Plan = wide
          ? { ...result, angleDeflectors: 1, deflectorFrom: wide.from, deflectorDirection: wide.to }
          : { ...result, angleDeflectors: 1, deflectorDirection: toRear ? 'rear' : 'front' };
        if (!planShapeError(trial, true) && costOf(forced(trial)) <= costOf(forced(result)) + 3) return trial;
      }
    }
    return planShapeError(result, type.shields !== null) ? emptyPlan() : result;
  }
}

/** What to repair first: what makes the ship fly worse every turn, then the guns (the strongest first), the engine, the body. */
function bestRepair(ship: Ship, options: RepairChoice[]): RepairChoice {
  const rank = (c: RepairChoice): number => {
    switch (c.system) {
      case 'stabilizer': return 0;
      case 'lateral': return 1;
      case 'gun': return 2 + (4 - 'SDTQ'.indexOf((ship.guns[c.gun!] ?? 'S')[0]!)) * 0.1;
      case 'engine': return 3;
      case 'body': return 4;
    }
  };
  return [...options].sort((a, b) => rank(a) - rank(b))[0]!;
}

// ------------------------------------------------------------------ public interface

/** The plan this computer player would make for a ship (also used for the "Suggest" button). */
export function planFor(game: GameState, ship: Ship, rng: Rng = defaultRng): Plan {
  return new Brain(game, rng).plan(ship);
}

/** Which of the player's ships the tactical AI would move next, and why it matters: see `Brain.pickShip`. */
export function shipToMove(game: GameState, player: PlayerId, rng: Rng = defaultRng): Ship {
  return new Brain(game, rng).pickShip(player);
}

export function tacticalAi(rng: Rng): Ai {
  return (game, player) => {
    if (!waitingFor(game).includes(player)) return null;

    if (game.pending) return decidePending(game, game.pending, rng);

    switch (game.phase) {
      case 'forces': return chooseForce(game, player, rng);
      case 'setup': return place(game, player);
      case 'entry':
      case 'arrival': return reserveCommand(game, player);
      case 'destroyers': return destroyerCommand(game, player, rng);
      case 'initiative': {
        // the same reasoning as when choosing a ship: moving early pays for the ships that get a real shot or escape one
        const brain = new Brain(game, rng);
        return declareMove(game, (s) => brain.analyse(s).goFirst);
      }
      case 'planning': {
        // the turret guns are turned and given their orders while planning (Rules: Ground attack)
        if (needsTurretOrders(game, player)) return { type: 'turrets', player, orders: turretOrdersFor(game, player) };
        const brain = new Brain(game, rng);
        const plans: Record<string, Plan> = {};
        const crewPlans: Record<string, Plan[]> = {};
        for (const ship of activeShips(game, player)) {
          plans[ship.id] = brain.plan(ship);
          const crew = crewPlansFor(ship, plans[ship.id]!);
          if (crew) crewPlans[ship.id] = crew;
        }
        return { type: 'plan', player, plans, crewPlans };
      }
      case 'ships': {
        const brain = new Brain(game, rng);
        if (!game.active) return { type: 'chooseShip', player, shipId: brain.pickShip(player).id };
        const ship = shipById(game, game.active.queue[game.active.index]!)!;
        if (game.active.stage === 'move') return { type: 'move', player, shipId: ship.id, steps: brain.moveFor(ship) };
        return { type: 'fire', player, shipId: ship.id, shots: bestVolley(game, ship) };
      }
      default: return null;
    }
  };
}

/** Passing and stealing moves follow the same reasoning as choosing: move first only to attack or to escape. */
function decidePending(game: GameState, pending: Pending, rng: Rng): Command {
  const brain = new Brain(game, rng);
  const player = pending.player;
  switch (pending.kind) {
    case 'steal': {
      // Moving first means committing before the enemy ship moves: only worth it for a real shot
      let bestId: string | null = null;
      let bestValue = REALISTIC;
      for (const id of pending.candidates) {
        const v = brain.analyse(shipById(game, id)!).goFirst;
        if (v >= bestValue) {
          bestValue = v;
          bestId = id;
        }
      }
      return { type: 'decide', player, choice: bestId };
    }
    case 'pass': {
      // Our ship was chosen but tails an enemy ship: let the enemy ship move first, unless
      // we have a real attack right now or the enemy ship would get one by moving first
      const chosen = shipById(game, pending.queue[0]!)!;
      if (brain.analyse(chosen).goFirst >= REALISTIC) return { type: 'decide', player, choice: null };
      const options = pending.candidates
        .map((id) => ({ id, off: brain.offencePotential(shipById(game, id)!) }))
        .filter((o) => o.off < REALISTIC)
        .sort((x, y) => x.off - y.off);
      return { type: 'decide', player, choice: options[0]?.id ?? null };
    }
    case 'follow': {
      // before the tailed ship only for a real shot, otherwise after it, keeping the tail
      const goFirst = brain.analyse(shipById(game, pending.ship)!).goFirst;
      return { type: 'decide', player, choice: goFirst >= REALISTIC ? 'before' : 'after' };
    }
    default:
      return basicDecide(game, pending);
  }
}

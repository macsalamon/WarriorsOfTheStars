import { clonePlan, groupLevel, payOf, setPay, stepDifficulties, typeOf, type PayGroup, type Payer, type Plan, type Ship } from '../engine';

/** The plan fields that decide the speed after the Markers Phase (Rules: Markers step). */
export type SpeedFields = Pick<Plan, 'accelerate' | 'overaccelerate' | 'decelerate' | 'overdecelerate' | 'overspeed'>;

export interface SpeedChoice {
  speed: number;
  /** The plan fields that give this speed; null when no combination of actions can reach it. */
  fields: SpeedFields | null;
  /** Difficulty this choice adds, against keeping the speed the ship has; null when it cannot be reached. */
  cost: number | null;
  /** Needs overspeed to stand above the ship's maximum. */
  overspeed: boolean;
}

const NO_SPEED_ACTIONS: SpeedFields = { accelerate: 0, overaccelerate: 0, decelerate: 0, overdecelerate: 0, overspeed: 0 };

/**
 * Every speed the speed bar offers, from stopped up to two above the maximum, with the actions that reach
 * it and the difficulty they cost: accelerate gives +1 (×2: +2), over-accelerate +3 (×2: +4), and the same
 * downwards (Rules: Markers step). Standing above the maximum, reached or kept, needs overspeed of as many steps as it is
 * above it (Rules: Markers step); forced overspeed from the last turn's hazards is already paid for. A ship above what it
 * may keep drops back to that speed with no action planned, so that speed costs nothing.
 */
export function speedChoices(ship: Ship): SpeedChoice[] {
  const d = typeOf(ship).difficulty;
  const top = Math.max(ship.maxSpeed + 2, ship.speed);
  const covered = Math.max(ship.forcedOverspeed, ship.hazardOverspeed);
  const keepable = ship.maxSpeed + covered;
  const choices: SpeedChoice[] = [];
  for (let speed = 0; speed <= top; speed++) {
    const delta = speed - ship.speed;
    const size = Math.abs(delta);
    const fields: SpeedFields = { ...NO_SPEED_ACTIONS };
    let cost: number | null = 0;
    if (ship.speed > keepable && speed === keepable) {
      // the speed it falls back to by itself: no action, no difficulty
    } else if (size > 4) cost = null;
    else if (size > 0) {
      const up = delta > 0;
      const over = size > 2;
      const key: Exclude<keyof SpeedFields, 'overspeed'> = up ? (over ? 'overaccelerate' : 'accelerate') : over ? 'overdecelerate' : 'decelerate';
      const level = (over ? size - 2 : size) as 1 | 2;
      const each = d[key];
      fields[key] = level;
      cost = each === null ? null : each * level;
    }
    const above = speed - ship.maxSpeed;
    if (above > covered) {
      const each = d.overspeed;
      if (above > 2 || each === null) cost = null;
      else {
        fields.overspeed = above as 1 | 2;
        if (cost !== null) cost += each * (above - ship.forcedOverspeed);
      }
    }
    choices.push({ speed, fields: cost === null ? null : fields, cost, overspeed: above > 0 });
  }
  return choices;
}

/** Puts the actions of a speed choice into the plan, replacing any speed actions it had. */
export function applySpeed(plan: Plan, choice: SpeedChoice): void {
  if (choice.fields) Object.assign(plan, NO_SPEED_ACTIONS, choice.fields);
}

/** The four tight turns: banking is −1 and −2 to the turn number, overturning −3 and −4 (Rules: Planning). */
export const TIGHT_TURNS: { reduction: 1 | 2 | 3 | 4; key: 'bank' | 'overturn'; level: 1 | 2 }[] = [
  { reduction: 1, key: 'bank', level: 1 },
  { reduction: 2, key: 'bank', level: 2 },
  { reduction: 3, key: 'overturn', level: 1 },
  { reduction: 4, key: 'overturn', level: 2 },
];

/** The tight turn a plan holds, as a reduction of 1 to 4, or 0 for none. */
export function tightTurnOf(plan: Plan): number {
  if (plan.bank > 0) return plan.bank;
  if (plan.overturn > 0) return plan.overturn + 2;
  return 0;
}

/** Plans a tight turn (0 for none); banking and overturning exclude each other. */
export function applyTightTurn(plan: Plan, reduction: number): void {
  plan.bank = 0;
  plan.overturn = 0;
  const turn = TIGHT_TURNS.find((t) => t.reduction === reduction);
  if (turn) plan[turn.key] = turn.level;
}

const SPEED_GROUPS: PayGroup[] = ['accel', 'decel', 'overspeed'];

/**
 * Puts a speed choice into the plan like `applySpeed`, and settles who pays for the steps it adds. Steps the plan already had keep their
 * payers; the new ones are paid by the crew member, or, when `payer` is 'f' (auxiliary power is on), by auxiliary power for the part that
 * costs more difficulty: a change of speed beyond the maximum is two strains on the ship (accelerating, and overspeed), and only one of
 * them is outsourced, the other stays with the pilot. `aux` is the number of units available for these steps.
 * Returns false, leaving the plan alone, when auxiliary power is asked for and the units do not reach.
 */
export function applySpeedPaid(ship: Ship, plan: Plan, choice: SpeedChoice, payer: Payer, aux: number): boolean {
  const difficulty = typeOf(ship).difficulty;
  const before = Object.fromEntries(SPEED_GROUPS.map((g) => [g, payOf(plan, g)])) as Record<PayGroup, Payer[]>;
  const trial = clonePlan(plan);
  applySpeed(trial, choice);
  const parts = SPEED_GROUPS.map((group) => {
    const level = groupLevel(trial, group);
    const kept = before[group]!.slice(0, level);
    // overspeed the last turn's hazards forced is the crew's to pay
    const first = Math.max(kept.length, group === 'overspeed' ? Math.min(ship.forcedOverspeed, level) : 0);
    const payers: Payer[] = Array.from({ length: level }, (_, i) => (i < kept.length ? kept[i]! : 'c'));
    const steps = stepDifficulties(group, difficulty);
    const added = Array.from({ length: Math.max(0, level - first) }, (_, i) => first + i);
    return { group, payers, added, worth: added.reduce((sum, i) => sum + (steps[i] ?? 0), 0) };
  });
  if (payer === 'f') {
    const candidates = parts.filter((x) => x.added.length > 0);
    if (candidates.length > 0) {
      // the dearer part goes to auxiliary power; a tie goes to the change of speed
      const best = candidates.reduce((a, b) => (b.worth > a.worth ? b : a));
      if (best.added.length > aux) return false;
      for (const i of best.added) best.payers[i] = 'f';
    }
  }
  applySpeed(plan, choice);
  for (const x of parts) setPay(plan, x.group, x.payers);
  return true;
}

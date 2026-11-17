import type { DifficultyNumbers, ShieldBox } from './data';
import type { Level } from './fire';
import { ACTION_HAZARD_CODE, type HazardCode } from './hazard';
import type { RepairChoice } from './repair';

/** The actions a ship can plan (Rules: Planning). Each is 0 (not planned), 1, or 2 (double). */
export const PLAN_ACTIONS = [
  'halfLoop',
  'slip',
  'roll',
  'jink',
  'bank',
  'overturn',
  'overspeed',
  'accelerate',
  'overaccelerate',
  'decelerate',
  'overdecelerate',
  'pinpointFire',
  'snapFire',
  'targeting',
  'angleDeflectors',
  'damageControl',
] as const satisfies readonly (keyof DifficultyNumbers)[];

export type PlanAction = (typeof PLAN_ACTIONS)[number];

/**
 * Who pays for one step of an action: 'c', the crew member's difficulty; or 'f', the ship's free source (auxiliary power or its R2
 * unit), which adds nothing to the difficulty (Rules: R2 units, auxiliary power and damage control).
 */
export type Payer = 'c' | 'f';

/**
 * Actions that are paid for together. Most are their own group with two steps (×1, ×2). Banking and overturning are the one ladder of the
 * tight turn, four steps (turn number −1 to −4); accelerating and over-accelerating are one ladder of up to four steps of speed, and the
 * same downwards (Rules: Markers step; Planning).
 */
export type PayGroup = 'turn' | 'accel' | 'decel' | 'overspeed' | 'halfLoop' | 'slip' | 'roll' | 'jink' | 'pinpointFire' | 'snapFire' | 'targeting' | 'angleDeflectors' | 'damageControl';

export const PAY_GROUPS: readonly PayGroup[] = ['turn', 'accel', 'decel', 'overspeed', 'halfLoop', 'slip', 'roll', 'jink', 'pinpointFire', 'snapFire', 'targeting', 'angleDeflectors', 'damageControl'];

export const GROUP_OF: Record<PlanAction, PayGroup> = {
  bank: 'turn', overturn: 'turn', accelerate: 'accel', overaccelerate: 'accel', decelerate: 'decel', overdecelerate: 'decel',
  overspeed: 'overspeed', halfLoop: 'halfLoop', slip: 'slip', roll: 'roll', jink: 'jink', pinpointFire: 'pinpointFire', snapFire: 'snapFire',
  targeting: 'targeting', angleDeflectors: 'angleDeflectors', damageControl: 'damageControl',
};

const LADDERS: Partial<Record<PayGroup, [PlanAction, PlanAction]>> = {
  turn: ['bank', 'overturn'],
  accel: ['accelerate', 'overaccelerate'],
  decel: ['decelerate', 'overdecelerate'],
};

/** Is this group a ladder of four steps (the tight turn, or a change of speed)? */
export const isLadder = (group: PayGroup): boolean => LADDERS[group] !== undefined;

export type Plan = Record<PlanAction, Level> & {
  /** Which tailed enemy to track, when targeting is planned. */
  targetingTarget: string | null;
  /** Which box the shield markers move to when angling deflectors. */
  deflectorDirection: ShieldBox | null;
  /** The box they are taken from; left out, it is the other one of front and rear (Rules: Markers step). Only the advanced arcs let a ship choose (Rules: Advanced arcs). */
  deflectorFrom?: ShieldBox | null;
  /**
   * Who pays for each step of a group of actions, as a string of 'c' and 'f' (see `Payer`), step by step from the first. Missing steps, and
   * groups that are not listed, are paid by the crew member.
   */
  pay?: Partial<Record<PayGroup, string>>;
  /** What damage control is to repair, when it is planned (Rules: R2 units, auxiliary power and damage control). */
  repair?: RepairChoice | null;
};

/** The steps a group has in a plan. */
export function groupLevel(plan: Plan, group: PayGroup): number {
  const ladder = LADDERS[group];
  if (ladder) return plan[ladder[0]] > 0 ? plan[ladder[0]] : plan[ladder[1]] > 0 ? plan[ladder[1]] + 2 : 0;
  return plan[group as PlanAction];
}

/** Puts a group at a number of steps (0 to 4 for a ladder, 0 to 2 otherwise). Changing speed up takes any change down out of the plan, and the other way round. */
export function setGroupLevel(plan: Plan, group: PayGroup, level: number): void {
  const ladder = LADDERS[group];
  if (!ladder) {
    plan[group as PlanAction] = level as Level;
    return;
  }
  plan[ladder[0]] = (level >= 1 && level <= 2 ? level : 0) as Level;
  plan[ladder[1]] = (level >= 3 ? level - 2 : 0) as Level;
  if (level > 0 && group === 'accel') clearGroup(plan, 'decel');
  if (level > 0 && group === 'decel') clearGroup(plan, 'accel');
}

function clearGroup(plan: Plan, group: PayGroup): void {
  const ladder = LADDERS[group];
  if (ladder) {
    plan[ladder[0]] = 0;
    plan[ladder[1]] = 0;
  } else plan[group as PlanAction] = 0;
  if (plan.pay) delete plan.pay[group];
}

/**
 * What each step of a group adds to the difficulty when the crew member pays it: the difference between the difficulty of the action with
 * that many steps and with one fewer (a doubled action costs twice, an overturn its own number, and so on).
 */
export function stepDifficulties(group: PayGroup, difficulty: DifficultyNumbers): number[] {
  const ladder = LADDERS[group];
  const of = (key: PlanAction): number => difficulty[key] ?? 0;
  const cumulative = ladder ? [0, of(ladder[0]), 2 * of(ladder[0]), of(ladder[1]), 2 * of(ladder[1])] : [0, of(group as PlanAction), 2 * of(group as PlanAction)];
  return cumulative.slice(1).map((c, i) => Math.max(0, c - cumulative[i]!));
}

/** Who pays each step of a group in a plan. */
export function payOf(plan: Plan, group: PayGroup): Payer[] {
  const level = groupLevel(plan, group);
  const text = plan.pay?.[group] ?? '';
  return Array.from({ length: level }, (_, i) => (text[i] === 'f' ? 'f' : 'c'));
}

/** Sets who pays each step of a group; a group paid by the crew member alone is not listed at all. */
export function setPay(plan: Plan, group: PayGroup, payers: Payer[]): void {
  if (payers.includes('f')) (plan.pay ??= {})[group] = payers.join('');
  else if (plan.pay) delete plan.pay[group];
}

/** The steps of a group paid by the free source (auxiliary power or the R2 unit). */
export const freeSteps = (plan: Plan, group: PayGroup): number => payOf(plan, group).filter((p) => p === 'f').length;

/** The auxiliary power a plan spends: one unit for every free step (Rules: R2 units, auxiliary power and damage control). */
export function auxSpent(plan: Plan): number {
  return PAY_GROUPS.reduce((sum, g) => sum + freeSteps(plan, g), 0);
}

/** The difficulty of a group that the crew member has to pay (Rules: R2 units, auxiliary power and damage control). */
export function groupDifficulty(plan: Plan, group: PayGroup, difficulty: DifficultyNumbers): number {
  const steps = stepDifficulties(group, difficulty);
  return payOf(plan, group).reduce((sum, p, i) => sum + (p === 'c' ? steps[i] ?? 0 : 0), 0);
}

/** Cuts the payers back to the steps a group has now (after an action was lost, say). */
export function trimPay(plan: Plan): void {
  if (!plan.pay) return;
  for (const group of PAY_GROUPS) if (plan.pay[group] !== undefined) setPay(plan, group, payOf(plan, group));
}

/** A plan as it should be handed in: payers within each group's steps, no repair choice without damage control. */
export function normalisePlan(plan: Plan): Plan {
  const copy = clonePlan(plan);
  trimPay(copy);
  if (copy.damageControl === 0) copy.repair = null;
  return copy;
}

/** A copy of a plan that shares nothing with the original. */
export function clonePlan(plan: Plan): Plan {
  const copy = { ...plan } as Plan;
  if (plan.pay) copy.pay = { ...plan.pay };
  if (plan.repair) copy.repair = { ...plan.repair };
  return copy;
}

export function emptyPlan(): Plan {
  const plan = { targetingTarget: null, deflectorDirection: null } as Plan;
  for (const action of PLAN_ACTIONS) plan[action] = 0;
  return plan;
}

const SPEED_ACTIONS: PlanAction[] = ['accelerate', 'overaccelerate', 'decelerate', 'overdecelerate'];

/** Structural problems with a plan, independent of the board (Rules: Planning; Markers step). */
export function planShapeError(plan: Plan, hasShields: boolean): string | null {
  for (const action of PLAN_ACTIONS) {
    const level = plan[action];
    if (level !== 0 && level !== 1 && level !== 2) return `${action}: level must be 0, 1 or 2`;
  }
  if (SPEED_ACTIONS.filter((a) => plan[a] > 0).length > 1) {
    return 'Only one of accelerate, overaccelerate, decelerate, overdecelerate may be planned';
  }
  if (plan.bank > 0 && plan.overturn > 0) return 'A ship may not bank and overturn in the same game-turn';
  if (plan.angleDeflectors > 0 && !hasShields) return 'This ship has no deflector shields to angle';
  if (plan.angleDeflectors > 0 && plan.deflectorDirection === null) return 'Choose which way to angle the deflectors';
  if (plan.targeting > 0 && plan.targetingTarget === null) return 'Choose a target for targeting';
  if (plan.damageControl > 0 && !plan.repair) return 'Choose what damage control is to repair';
  for (const group of PAY_GROUPS) {
    const text = plan.pay?.[group] ?? '';
    if (!/^[cf]*$/.test(text)) return `${group}: the payers must be c or f`;
    if (text.length > groupLevel(plan, group)) return `${group}: more payers than the action has steps`;
  }
  return null;
}

/** Hazard-code letters for every action circle that holds a marker (Rules: Hazards), plus stabilizer damage and action penalty. */
export function planHazardLetters(plan: Plan, stabilizerLevel: number, penaltyLevel: number): HazardCode[] {
  const letters: HazardCode[] = [];
  for (const action of PLAN_ACTIONS) if (plan[action] > 0) letters.push(ACTION_HAZARD_CODE[action]);
  if (stabilizerLevel > 0 || penaltyLevel > 0) letters.push('B');
  return letters;
}

export const PLAN_LABELS: Record<PlanAction, string> = {
  halfLoop: 'half loop', slip: 'slip', roll: 'roll', jink: 'jink', bank: 'bank', overturn: 'overturn',
  overspeed: 'overspeed', accelerate: 'accelerate', overaccelerate: 'over-accelerate',
  decelerate: 'decelerate', overdecelerate: 'over-decelerate', pinpointFire: 'pinpoint fire',
  snapFire: 'snap fire', targeting: 'targeting', angleDeflectors: 'angle deflectors', damageControl: 'damage control',
};

/** The action a group is currently planned as: a bank or an overturn, a plain or an over-acceleration, and so on. */
function activeAction(plan: Plan, group: PayGroup): PlanAction | null {
  const ladder = LADDERS[group];
  if (ladder) return plan[ladder[0]] > 0 ? ladder[0] : plan[ladder[1]] > 0 ? ladder[1] : null;
  return plan[group as PlanAction] > 0 ? (group as PlanAction) : null;
}

/** The same terms as `planDifficultyEntries`, with names, for explaining a hazard roll. */
export function planDifficultyParts(
  plan: Plan,
  difficulty: DifficultyNumbers,
  stabilizerLevel: number,
  penaltyLevel: number,
): { label: string; value: number }[] {
  const parts: { label: string; value: number }[] = [];
  for (const group of PAY_GROUPS) {
    const action = activeAction(plan, group);
    if (!action || (!isLadder(group) && difficulty[action] === null)) continue;
    const level = groupLevel(plan, group);
    const free = freeSteps(plan, group);
    const note = free === 0 ? '' : free === level ? ' (free)' : ` (${free} of ${level} steps free)`;
    parts.push({ label: `${PLAN_LABELS[action]}${plan[action] === 2 ? ' ×2' : ''}${note}`, value: groupDifficulty(plan, group, difficulty) });
  }
  if (stabilizerLevel > 0) parts.push({ label: `stabilizer damage${stabilizerLevel === 2 ? ' ×2' : ''}`, value: difficulty.stabilizer * stabilizerLevel });
  if (penaltyLevel > 0) parts.push({ label: 'action penalty', value: 3 * penaltyLevel });
  return parts;
}

/** Difficulty contribution of every marker on the sheet (Rules: Hazards). */
export function planDifficultyEntries(
  plan: Plan,
  difficulty: DifficultyNumbers,
  stabilizerLevel: number,
  penaltyLevel: number,
): { difficulty: number; doubled?: boolean }[] {
  const entries: { difficulty: number; doubled?: boolean }[] = [];
  for (const group of PAY_GROUPS) {
    const action = activeAction(plan, group);
    if (!action || (!isLadder(group) && difficulty[action] === null)) continue;
    const paid = groupDifficulty(plan, group, difficulty);
    if (paid > 0) entries.push({ difficulty: paid });
  }
  if (stabilizerLevel > 0) entries.push({ difficulty: difficulty.stabilizer, doubled: stabilizerLevel === 2 });
  // Action penalty box (Rules: Hazards): +3, or +6 on its x2 side
  if (penaltyLevel > 0) entries.push({ difficulty: 3, doubled: penaltyLevel === 2 });
  return entries;
}

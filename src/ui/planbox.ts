import { ACTION_HAZARD_CODE, GROUP_OF, clonePlan, freeSteps, groupLevel, isLadder, payOf, repairOdds, setGroupLevel, setPay, speedAfterMarkers, stepDifficulties, typeOf, type PayGroup, type ShieldBox, type Payer, type Plan, type PlanAction, type RepairChoice, type Ship } from '../engine';
import { type CrewMember } from './crew';
import { h, type Child } from './dom';
import { TIGHT_TURNS, applySpeedPaid, speedChoices } from './planmodel';

/** What the little letter beside an action says: the risk it carries when planned. */
export const HAZARD_LETTER_NOTE = 'The letter is the hazard row. Rows run from A (the worst results) to G (the mildest), so it shows how risky the action is.';

/** An action's name in the planning box, with its hazard letter in a small circle. */
/** The hazard letter alone, in its small circle: for the speed and tighten turn rows, whose labels are not actions of their own. */
const hazardDot = (code: string): HTMLElement => h('span', { class: `phaz hz${code}` }, code);

const actionName = (info: { label: string; hint: string }, code: string): HTMLElement =>
  h('span', { class: 'pname', title: `${info.hint}.\nHazard row ${code}. ${HAZARD_LETTER_NOTE}` }, info.label, h('span', { class: `phaz hz${code}` }, code));

export const ACTION_INFO: Record<PlanAction, { label: string; hint: string }> = {
  accelerate: { label: 'Accelerate', hint: '+1 / +2 speed' },
  overaccelerate: { label: 'Over-accelerate', hint: '+3 / +4 speed' },
  decelerate: { label: 'Decelerate', hint: '−1 / −2 speed' },
  overdecelerate: { label: 'Over-decelerate', hint: '−3 / −4 speed' },
  overspeed: { label: 'Overspeed', hint: 'Exceed the maximum speed by 1 / 2' },
  bank: { label: 'Bank', hint: 'Turn number −1 / −2' },
  overturn: { label: 'Overturn', hint: 'Turn number −3 / −4' },
  slip: { label: 'Slip', hint: 'Move sideways instead of forward. Turn number +1' },
  halfLoop: { label: '½ Loop', hint: 'Reverse direction. You can also turn one hex side in the same hex, before the loop.' },
  roll: { label: 'Roll', hint: 'Shots at you and by you are harder by 5 / 10. Enemy rolling cancels it out. Turn number +1' },
  jink: { label: 'Jink', hint: 'Shots at you are harder by 5 / 10. Turn number +1' },
  pinpointFire: { label: 'Pinpoint fire', hint: 'Your shots are easier by 5 / 10' },
  snapFire: { label: 'Snap fire', hint: 'Fire during your move instead of at the end' },
  targeting: { label: 'Targeting', hint: 'Your shots at the tracked target are easier by 5, and shots at you from others are easier by 5 too. The target is a ship you are tailing, or a turret gun or the ground target ahead of you.' },
  angleDeflectors: { label: 'Angle deflectors', hint: 'Move 1 / 2 shield markers between shield boxes' },
  damageControl: { label: 'Damage control', hint: 'Try to repair one level of one damaged system at the end of the ship\'s phase' },
};

/** The order the actions are listed in, for sentences about a whole plan. */
export const ACTION_ORDER: PlanAction[] = [
  'accelerate', 'overaccelerate', 'decelerate', 'overdecelerate', 'overspeed',
  'bank', 'overturn', 'slip', 'halfLoop', 'roll', 'jink',
  'pinpointFire', 'snapFire', 'targeting', 'angleDeflectors', 'damageControl',
];

/** Two actions to a line, each with a ×1 and a ×2 box. */
const LINES: [PlanAction, PlanAction | null][] = [
  ['halfLoop', 'slip'],
  ['roll', 'jink'],
  ['pinpointFire', 'snapFire'],
  ['targeting', 'angleDeflectors'],
  ['damageControl', null],
];

/** The R2, auxiliary power and damage control rules (16, 17), as far as the planning box needs to know them. Missing when they are not in effect. */
export interface PowerContext {
  /** What can be repaired right now (Rules: R2 units, auxiliary power and damage control): without damage there is no damage control to plan. */
  repairs: RepairChoice[];
  describe(choice: RepairChoice): string;
  /** Another crew member already plans damage control: a ship makes one attempt per game-turn (Rules: R2 units, auxiliary power and damage control). */
  repairTaken: boolean;
  /** The ship's R2 unit: not at all, still aboard and rolled ready for free actions, aboard but rolled busy, or lost. */
  r2: 'none' | 'ready' | 'busy' | 'lost';
  /** The R2 unit has no action yet, in any crew member's plan. */
  r2Free: boolean;
  /** Units of auxiliary power left after the plans of this ship (a ship without any: null). */
  aux: number | null;
  /** Free actions are the pilot's (Rules: Gunners and turrets). */
  pilot: boolean;
  /** The aux / R2 button is pressed: what is clicked now is paid for by auxiliary power (or the R2 unit) instead of difficulty. */
  armed: boolean;
  onArm(): void;
}

const SHIELD_BOXES: readonly ShieldBox[] = ['front', 'rear', 'left', 'right'];

export interface PlanBoxContext {
  ship: Ship;
  /** Everyone aboard, with whether they have planned something; the selected one is `crewId`. */
  crew: { member: CrewMember; planned: boolean }[];
  crewId: string;
  /** What the selected crew member may plan (Rules: Gunners and turrets): the pilot everything, a gunner only some actions. */
  allowed: readonly PlanAction[];
  /** Targeting is already planned against this ship by another crew member: a ship tracks only one target. */
  lockedTarget: string | null;
  /** Another crew member already moves the shields. */
  shieldsTaken: boolean;
  /** The ship angles its shields left and right as well as front and rear (advanced arcs, see Rules: Advanced arcs). */
  wideShields: boolean;
  onCrew(id: string): void;
  plan: Plan;
  /** The plan with forced markers from the last turn merged in. */
  effective: Plan;
  tailed: Ship[];
  /** The turret guns and the ground target that may be tracked (Rules: Ground attack), with the words for the list. */
  groundTargets?: { id: string; label: string }[];
  hasGuns: boolean;
  /** The totals, odds and explanations under the controls, built by the caller. */
  summary: Child[];
  /** The R2, auxiliary power and damage control rules, when they are in effect. */
  power?: PowerContext;
  /** The plan changed: draw everything again. */
  onChange(): void;
  onClear(): void;
  onSubmit(): void;
  onAutoPlace(): void;
  targetName(ship: Ship): string;
}

// ------------------------------------------------------------------ who pays (Rules: R2 units, auxiliary power and damage control)

/** Who pays for what is clicked now: the crew member (difficulty), or the free source when the aux / R2 button is pressed. */
const payerNow = (ctx: PlanBoxContext): Payer => (ctx.power?.armed ? 'f' : 'c');

/** The most steps of a group the free source may pay on this ship: an R2 unit one step of an action of difficulty 4 or less (two for 2 or less, see Rules: R2 units, auxiliary power and damage control), auxiliary power any. */
function freeLimit(ctx: PlanBoxContext, group: PayGroup): number {
  const p = ctx.power;
  if (!p || !p.pilot) return 0;
  const type = typeOf(ctx.ship);
  if (type.r2) {
    if (group === 'damageControl') return p.r2 === 'lost' ? 0 : 1;
    if (p.r2 !== 'ready' || isLadder(group)) return 0;
    const difficulty = type.difficulty[group as keyof typeof type.difficulty];
    return difficulty === null || difficulty === undefined ? 0 : difficulty <= 2 ? 2 : difficulty <= 4 ? 1 : 0;
  }
  return p.aux === null ? 0 : 4;
}

/** May `more` further steps of a group be paid by the free source? */
function canTakeFree(ctx: PlanBoxContext, group: PayGroup, more: number): boolean {
  const p = ctx.power;
  if (!p) return false;
  const have = freeSteps(ctx.plan, group);
  if (have + more > freeLimit(ctx, group)) return false;
  if (typeOf(ctx.ship).r2) return p.r2Free || have > 0;
  return more <= (p.aux ?? 0);
}

/** One step box of a group of actions. */
interface StepSpec {
  group: PayGroup;
  /** The action the step belongs to, for names. */
  key: PlanAction;
  step: number;
  text: string;
  /** The action cannot be planned at all right now. */
  off: boolean;
  why: string;
  /** Steps forced by last turn's hazards: they stay. */
  forced?: number;
  /** What else clicking does, besides changing the steps. */
  after?: () => void;
}

/** Takes a group up to a number of steps. The new steps are paid by whoever is paying now (the first step of damage control by the R2 unit, when `firstFree`). */
function raise(ctx: PlanBoxContext, group: PayGroup, to: number, firstFree: boolean): void {
  const { plan } = ctx;
  const have = groupLevel(plan, group);
  const payers = payOf(plan, group);
  while (payers.length < have) payers.push('c');
  const wantFree = payerNow(ctx) === 'f';
  let more = 0;
  for (let i = have; i < to; i++) {
    if (firstFree && i === 0) payers.push('f');
    else if (wantFree && canTakeFree(ctx, group, more + 1)) {
      payers.push('f');
      more += 1;
    } else payers.push('c');
  }
  setGroupLevel(plan, group, to);
  setPay(plan, group, payers);
}

/** Takes the top step of a group out of the plan. */
function lower(ctx: PlanBoxContext, group: PayGroup, to: number): void {
  setGroupLevel(ctx.plan, group, to);
  setPay(ctx.plan, group, payOf(ctx.plan, group));
  if (group === 'damageControl' && to === 0) ctx.plan.repair = null;
}

const cell = (label: string, selected: boolean, box: HTMLElement, cls = '', title = 'Difficulty number'): HTMLElement =>
  h('div', { class: 'pcell' + (selected ? ' sel' : '') + cls },
    h('span', { class: 'pn', title }, label),
    box,
  );

/**
 * A box for one step of an action. Yellow when the crew member pays it, cyan when auxiliary power (or the R2 unit) does. A click on a box
 * above the steps the plan has adds them, paid by whoever is paying now; a click on the top step takes it out; the steps below it stay
 * until the ones above are gone.
 */
function stepBox(ctx: PlanBoxContext, spec: StepSpec, change: (fn: () => void) => () => void): HTMLElement {
  const { plan, effective, power } = ctx;
  const type = typeOf(ctx.ship);
  const info = ACTION_INFO[spec.key];
  const forced = spec.forced ?? 0;
  const eff = Math.max(groupLevel(effective, spec.group), forced);
  const payers = payOf(plan, spec.group);
  const steps = stepDifficulties(spec.group, type.difficulty);
  const selected = spec.step <= eff;
  const mine: Payer = selected ? payers[spec.step - 1] ?? 'c' : payerNow(ctx);
  const more = spec.step - eff;
  // an R2 unit does the first step of damage control by itself, ready or busy
  const r2First = spec.group === 'damageControl' && !selected && eff === 0 && type.r2 && !!power && (power.r2 === 'ready' || power.r2 === 'busy') && (power.r2Free || freeSteps(plan, 'damageControl') > 0);
  const freeNow = !selected && payerNow(ctx) === 'f' && !r2First;
  const blocked = freeNow && !canTakeFree(ctx, spec.group, more);
  const top = spec.step === eff;
  const crewCost = steps.slice(Math.max(0, eff), spec.step).reduce((a, b) => a + b, 0) - (r2First ? steps[0] ?? 0 : 0);
  const label = selected ? (mine === 'f' ? (type.r2 ? 'R2' : '⚡1') : String(steps[spec.step - 1] ?? 0)) : freeNow ? (type.r2 ? 'R2' : `⚡${more}`) : String(crewCost);
  const title = spec.off ? spec.why
    : selected
      ? spec.step <= forced ? `${info.label} is forced by last turn's hazards`
        : top ? `Take this step of ${info.label} out of the plan (${mine === 'f' ? (type.r2 ? 'done by the R2 unit' : 'paid by auxiliary power') : 'paid by the crew'})`
          : `Take out the higher step of ${info.label} first`
      : blocked ? 'Can’t be done for free: no auxiliary power or R2 unit can pay for it'
        : freeNow ? `${info.label}${spec.step > 1 ? ` ×${spec.step}` : ''}: costs ${more === 1 ? 'one unit' : `${more} units`} of auxiliary power instead of difficulty`
          : `${info.label}${spec.step > 1 ? ` ×${spec.step}` : ''}: adds ${crewCost} to the difficulty${r2First ? ' (the R2 unit does the first step for free)' : ''}`;
  const box = h('button', {
    class: 'pbox' + (selected ? ' on' : '') + (selected && mine === 'f' ? ' free' : '') + (selected && spec.step < eff ? ' locked' : '') + (forced > 0 && spec.step <= forced ? ' forced' : ''),
    disabled: spec.off || blocked || (selected && spec.step <= forced),
    title,
    onclick: change(() => {
      if (spec.step > eff) {
        raise(ctx, spec.group, spec.step, r2First);
        spec.after?.();
      } else if (spec.step === eff && spec.step > forced) {
        // the roll the hazards forced is part of the plan whatever is clicked
        lower(ctx, spec.group, spec.step - 1 <= forced ? 0 : spec.step - 1);
      }
    }),
  }, spec.text);
  return cell(label, selected, box, selected && mine === 'f' ? ' freecell' : '', freeNow || (selected && mine === 'f') ? (type.r2 ? 'Done by the R2 unit' : 'Units of auxiliary power') : 'Difficulty number');
}

/** The crew as buttons in the free space beside "Damage control": pilot, gunners, the R2 unit; or a lightning bolt for a ship with auxiliary power. */
function crewButtons(ctx: PlanBoxContext): HTMLElement {
  const p = ctx.power;
  const hasAux = !!p && p.aux !== null;
  if (ctx.crew.length < 2 && !hasAux) return h('div');
  const buttons = ctx.crew.map(({ member, planned }) => {
    if (member.kind === 'r2') {
      const usable = !!p && p.r2 === 'ready' && p.pilot;
      const title = !p
        ? 'R2 astromech unit. It does nothing: the R2 and damage control option is off.'
        : p.r2 === 'lost' ? 'The R2 unit is gone'
          : p.r2 === 'busy' ? 'The R2 unit rolled too high this game-turn. It can only help with damage control, and does that for free.'
            : !p.pilot ? 'Gunners can’t use the R2 unit.'
              : p.armed ? 'R2 unit is on (cyan). Actions you click are free: difficulty 4 or less (a double: 2 or less). Press it again to switch it off.'
                : p.r2Free ? 'R2 unit is ready. Press it, then click an action to get it for free: difficulty 4 or less (a double: 2 or less).'
                  : 'The R2 unit has already done an action this game-turn.';
      return h('button', {
        class: `pcrewbtn r2${p?.armed ? ' armed' : ''}${usable || p?.armed ? '' : ' faded'}`,
        disabled: !usable && !p?.armed,
        title,
        onclick: () => p?.onArm(),
      }, h('img', { src: member.picture, alt: member.label }));
    }
    const usable = !member.dead;
    const title = member.dead ? `${member.label} is dead` : `${member.label}: plan this crew member's actions${planned ? ' (has actions planned)' : ''}`;
    return h('button', {
      class: `pcrewbtn ${member.kind}${member.id === ctx.crewId ? ' sel' : ''}${planned ? ' planned' : ''}${member.dead ? ' dead' : ''}`,
      disabled: !usable,
      title,
      onclick: () => ctx.onCrew(member.id),
    }, h('img', { src: member.picture, alt: member.label }), member.kind === 'gunner' && member.seat && ctx.crew.filter((c) => c.member.kind === 'gunner').length > 1 ? h('span', { class: 'seat' }, String(member.seat)) : null);
  });
  if (hasAux) {
    const left = p!.aux!;
    buttons.push(h('button', {
      class: `pcrewbtn aux${p!.armed ? ' armed' : ''}${left > 0 || p!.armed ? '' : ' faded'}`,
      disabled: (left <= 0 && !p!.armed) || !p!.pilot,
      title: !p!.pilot ? 'Gunners can’t use auxiliary power.'
        : p!.armed ? 'Auxiliary power is on (cyan). Every step you click is paid with one unit instead of difficulty. Press it again to switch it off.'
          : `Auxiliary power: ${left} unit${left === 1 ? '' : 's'} left. Press it, then click actions. Each step costs one unit instead of difficulty.`,
      onclick: () => p!.onArm(),
    }, h('span', { class: 'bolt' }, '⚡'), h('span', { class: 'auxn' }, String(left))));
  }
  return h('div', { class: 'pcrew' }, ...buttons);
}

/** The planning controls: a speed bar, a tight turn, and two step boxes for every other action. */
export function buildPlanBox(ctx: PlanBoxContext): HTMLElement {
  const { ship, plan, effective } = ctx;
  const type = typeOf(ship);
  const d = type.difficulty;
  const power = ctx.power;
  const change = (fn: () => void) => () => { fn(); ctx.onChange(); };
  /** Speed and maneuvers are the pilot's (Rules: Gunners and turrets). */
  const maneuvers = ctx.allowed.includes('slip');

  // ---- speed bar: a speed is reached by a change of speed and, above the maximum, overspeed (two groups of steps, paid one by one)
  const reached = speedAfterMarkers(ship, effective);
  const speedGroups: PayGroup[] = ['accel', 'decel', 'overspeed'];
  const speedFree = speedGroups.reduce((n, g) => n + freeSteps(plan, g), 0);
  const speedUnits = (power?.aux ?? 0) + speedFree;
  const freeSpeed = speedFree > 0;
  const crewSpeed = speedGroups.some((g) => payOf(plan, g).includes('c'));
  const speedCells = speedChoices(ship).map((choice) => {
    const here = choice.speed === ship.speed;
    let label = choice.cost === null ? '–' : String(choice.cost);
    let blocked = false;
    if (power?.armed) {
      const trial = clonePlan(plan);
      const ok = !type.r2 && power.pilot && choice.fields !== null && applySpeedPaid(ship, trial, choice, 'f', speedUnits);
      blocked = !ok;
      if (ok) label = `⚡${Math.max(0, speedGroups.reduce((n, g) => n + freeSteps(trial, g), 0) - speedFree)}`;
    }
    const title = choice.fields === null
      ? `Speed ${choice.speed} can’t be reached this turn`
      : blocked ? 'Auxiliary power can’t pay for this: it doesn’t cover the cost, and the R2 unit can’t pay for speed changes'
        : choice.speed === ship.speed
          ? `Keep speed ${choice.speed}`
          : `Speed ${choice.speed}${choice.overspeed ? ' (overspeed)' : ''}: ${power?.armed ? 'auxiliary power pays the higher of acceleration and overspeed, the pilot pays the rest' : `adds ${choice.cost} to the difficulty`}`;
    const selected = choice.speed === reached;
    return cell(label, selected,
      h('button', {
        class: 'pbox' + (selected ? ' on' : '') + (selected && freeSpeed ? ' free' : '') + (selected && freeSpeed && crewSpeed ? ' half' : '') + (choice.overspeed ? ' over' : '') + (here ? ' now' : ''),
        disabled: choice.fields === null || !maneuvers || blocked,
        title,
        onclick: change(() => { applySpeedPaid(ship, plan, choice, power?.armed ? 'f' : 'c', speedUnits); }),
      }, String(choice.speed)), selected && freeSpeed ? ' freecell' : '', power?.armed ? 'Units of auxiliary power' : 'Difficulty number');
  });

  // ---- tight turn: a ladder of four steps, turn number −1 to −4
  const turnCells = TIGHT_TURNS.map((t) => stepBox(ctx, { group: 'turn', key: t.key, step: t.reduction, text: `−${t.reduction}`, off: d[t.key] === null || !maneuvers, why: 'Speed and maneuvers are planned by the pilot' }, change));

  // ---- the other actions
  /** Boxes on the outside, label on the inside, so the two columns read away from the line between them. */
  const arrange = (side: 'left' | 'right', label: HTMLElement, cells: HTMLElement[], cls: string): HTMLElement =>
    h('div', { class: `pact ${side}${cls}` }, ...(side === 'left' ? [...cells, label] : [label, ...cells]));

  /** The damage control row: the R2 unit, where the ship has one, does the first step for nothing; the rest is paid for by the planner. */
  const fixDamage = (side: 'left' | 'right'): HTMLElement => {
    const info = ACTION_INFO.damageControl;
    const own = plan.damageControl > 0;
    const why = !power ? 'Damage control is an optional rule. Turn on "R2, auxiliary power and damage control" in the menu.'
      : !ctx.allowed.includes('damageControl') ? 'This crew member can’t plan damage control'
        : power.repairTaken && !own ? 'Another crew member already plans damage control: one attempt per game-turn'
          : power.repairs.length === 0 && !own ? 'Nothing to repair: nothing is damaged, or the damage is beyond repair'
            : '';
    const cells = [1, 2].map((step) => stepBox(ctx, {
      group: 'damageControl', key: 'damageControl', step, text: `×${step}`, off: why !== '', why,
      after: () => {
        const choice = plan.repair;
        const still = choice && power!.repairs.some((o) => o.system === choice.system && (o.gun ?? null) === (choice.gun ?? null));
        plan.repair = still ? choice : power!.repairs[0]!;
      },
    }, change));
    return arrange(side, actionName(info, ACTION_HAZARD_CODE.damageControl), cells,
      (why !== '' && !own ? ' off' : '') + (plan.damageControl > 0 ? ' chosen' : ''));
  };

  const action = (key: PlanAction, side: 'left' | 'right'): HTMLElement => {
    if (key === 'damageControl') return fixDamage(side);
    const each = d[key];
    const off = each === null
      || !ctx.allowed.includes(key)
      || ((key === 'pinpointFire' || key === 'snapFire' || key === 'targeting') && !ctx.hasGuns)
      || (key === 'targeting' && ctx.tailed.length === 0 && !ctx.groundTargets?.length)
      || (key === 'angleDeflectors' && ctx.shieldsTaken && plan.angleDeflectors === 0);
    const info = ACTION_INFO[key];
    const why = !ctx.allowed.includes(key) ? `Gunners can’t plan ${info.label}` : `${info.label} isn’t possible now`;
    const cells = [1, 2].map((step) => stepBox(ctx, {
      group: GROUP_OF[key], key, step, text: `×${step}`, off, why,
      forced: key === 'roll' ? ship.forcedRoll : 0,
      after: () => {
        if (key === 'targeting') plan.targetingTarget = plan.targeting > 0 ? plan.targetingTarget ?? ctx.lockedTarget ?? ctx.tailed[0]?.id ?? ctx.groundTargets?.[0]?.id ?? null : null;
        if (key === 'angleDeflectors' && plan.angleDeflectors > 0 && !plan.deflectorDirection) {
          if (ctx.wideShields) {
            // from the box with most markers to the one with fewest
            const boxes = [...SHIELD_BOXES].sort((a, b) => ship.shields[b] - ship.shields[a]);
            plan.deflectorFrom = boxes[0]!;
            plan.deflectorDirection = boxes[boxes.length - 1]!;
          } else {
            plan.deflectorDirection = ship.shields.front >= ship.shields.rear ? 'rear' : 'front';
          }
        }
      },
    }, change));
    return arrange(side, actionName(info, ACTION_HAZARD_CODE[key]), cells, (off ? ' off' : '') + (effective[key] > 0 ? ' chosen' : ''));
  };

  const extras: Child[] = [];
  if (plan.targeting > 0) {
    extras.push(h('div', { class: 'pextra' }, 'Target ',
      h('select', { onchange: (e: Event) => { plan.targetingTarget = (e.target as HTMLSelectElement).value; } },
        ...ctx.tailed.filter((t) => ctx.lockedTarget === null || t.id === ctx.lockedTarget).map((t) => h('option', { value: t.id, selected: plan.targetingTarget === t.id }, ctx.targetName(t))),
        ...(ctx.groundTargets ?? []).filter((t) => ctx.lockedTarget === null || t.id === ctx.lockedTarget).map((t) => h('option', { value: t.id, selected: plan.targetingTarget === t.id }, t.label)))));
  }
  if (plan.angleDeflectors > 0 && ctx.wideShields) {
    // the advanced arcs (Rules: Advanced arcs): the markers can be angled to any of the four sides
    const other = (not: ShieldBox): ShieldBox => SHIELD_BOXES.find((b) => b !== not && ship.shields[b] > 0) ?? SHIELD_BOXES.find((b) => b !== not)!;
    extras.push(
      h('div', { class: 'pextra' }, 'Angle deflectors from the ',
        ...SHIELD_BOXES.map((box) =>
          h('button', { class: 'pside' + (plan.deflectorFrom === box ? ' on' : ''), title: `${ship.shields[box]} marker${ship.shields[box] === 1 ? '' : 's'} there`, onclick: change(() => { plan.deflectorFrom = box; if (plan.deflectorDirection === box) plan.deflectorDirection = other(box); }) }, `${box} ${ship.shields[box]}`))),
      h('div', { class: 'pextra' }, '… to the ',
        ...SHIELD_BOXES.map((box) =>
          h('button', { class: 'pside' + (plan.deflectorDirection === box ? ' on' : ''), onclick: change(() => { plan.deflectorDirection = box; if (plan.deflectorFrom === box) plan.deflectorFrom = other(box); }) }, box))),
    );
  } else if (plan.angleDeflectors > 0) {
    extras.push(h('div', { class: 'pextra' }, 'Angle deflectors to the ',
      ...(['front', 'rear'] as const).map((side) =>
        h('button', { class: 'pside' + (plan.deflectorDirection === side ? ' on' : ''), onclick: change(() => { plan.deflectorDirection = side; plan.deflectorFrom = null; }) }, side))));
  }
  // damage control: what to repair is chosen as soon as the action is (Rules: R2 units, auxiliary power and damage control)
  const repairExtra: Child[] = [];
  if (plan.damageControl > 0 && power) {
    const odds = repairOdds(plan.damageControl === 2);
    repairExtra.push(h('div', { class: 'pextra prepair' }, h('span', { class: 'prlabel' }, 'Repair'),
      ...power.repairs.map((choice) => {
        const on = plan.repair?.system === choice.system && (plan.repair.gun ?? null) === (choice.gun ?? null);
        return h('button', { class: 'pside' + (on ? ' on' : ''), onclick: change(() => { plan.repair = choice; }) }, power.describe(choice));
      })));
    repairExtra.push(h('div', { class: 'pextra prodds', title: 'Two dice at the end of the ship\'s phase. 6 or less repairs one level (8 or less if doubled). 9 or more ruins the system for good.' },
      `Repaired ${Math.round(odds.repaired * 100)}% · beyond repair ${Math.round(odds.beyond * 100)}%`));
  }

  return h('div', { class: 'pbinner' + (power?.armed ? ' freemode' : '') },
    h('div', { class: 'pbhead', title: 'Drag to move the planning box' },
      h('span', { class: 'pbgrip' }, '⠿'),
      h('b', null, `Plan ${type.name} #${ship.idNumber}${ctx.crew.length > 1 ? ` – ${ctx.crew.find((c) => c.member.id === ctx.crewId)?.member.label ?? ''}` : ''}`),
      h('button', { class: 'pbtool', title: 'Put the box where it covers the fewest ships', onclick: () => ctx.onAutoPlace() }, '⌖'),
    ),
    h('div', { class: 'pstack' + (maneuvers ? '' : ' off'), title: maneuvers ? '' : 'Speed and maneuvers are planned by the pilot' }, h('span', { class: 'plabel', title: `Click the speed you want; the number is the difficulty it adds.\nHazard row ${ACTION_HAZARD_CODE.accelerate}. ${HAZARD_LETTER_NOTE}` }, 'Speed', hazardDot(ACTION_HAZARD_CODE.accelerate)), h('div', { class: 'pspeed' }, ...speedCells)),
    h('div', { class: 'prow' + (maneuvers ? '' : ' off') }, h('span', { class: 'plabel', title: `Lowers the turn number so the ship can turn sooner.\nHazard row ${ACTION_HAZARD_CODE.bank}. ${HAZARD_LETTER_NOTE}` }, 'Tighten turn', hazardDot(ACTION_HAZARD_CODE.bank)), h('div', { class: 'pturn' }, ...turnCells)),
    ...LINES.map(([a, b]) => h('div', { class: 'pline' },
      action(a, 'left'),
      h('span', { class: 'psep' }),
      b === null ? crewButtons(ctx) : action(b, 'right'),
    )),
    ...repairExtra,
    ...extras,
    h('div', { class: 'psummary' }, ...ctx.summary),
    h('div', { class: 'pbuttons' },
      h('button', { onclick: () => ctx.onClear(), title: ctx.crew.length > 1 ? 'Remove all actions from this crew member’s plan' : 'Remove all actions from this ship’s plan' }, 'Clear'),
      h('button', { class: 'primary pbsubmit', onclick: () => ctx.onSubmit(), title: 'Finish planning this ship. It stays greyed on the board until you commit all plans.' }, `Submit ${type.name} #${ship.idNumber}`),
    ),
  );
}

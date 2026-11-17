import { TABLES, type FireQuarter, type ShieldBox } from './data';
import { isBodyCode, parseDamageCode } from './damage';
import { arcOf, isForwardArc, type FacingRelation, type Facing, type Hex } from './hex';

/** How many times a maneuver was planned: 0 = not, 1 = single, 2 = double. */
export type Level = 0 | 1 | 2;

export interface Maneuvers {
  halfLoop: Level;
  roll: Level;
  jink: Level;
  /** Only meaningful for the firer. */
  pinpointFire: Level;
}

export interface ShotInput {
  /** Base difficulty from the firing gun's "to hit" box at this range. */
  base: number;
  firer: Maneuvers;
  target: Maneuvers;
  /** Firer holds a tracking marker on this target (Rules: Fire): -5, or -10 if doubled. */
  firerTracking: Level;
  /**
   * Target holds a tracking marker on some ship other than the firer (Rules: Fire):
   * -5, or -10 if doubled. Pass 0 when the firer is the ship it is tracking.
   */
  targetTracking: Level;
  firerSpeed: number;
  targetSpeed: number;
  facing: FacingRelation;
}

const byLevel = (level: Level, single: number, double: number): number =>
  level === 0 ? 0 : level === 1 ? single : double;

/** One line of a shot's difficulty: what it is, and how much it adds (negative = easier). */
export interface DifficultyPart {
  label: string;
  value: number;
}

const xTwo = (level: Level): string => (level === 2 ? ' (doubled)' : '');

/** Shot difficulty (Rules: Fire) with every modifier listed, in the order the card reads. Zero modifiers are left out. */
export function shotBreakdown(s: ShotInput): { total: number; parts: DifficultyPart[] } {
  const parts: DifficultyPart[] = [{ label: 'Gun at this range', value: s.base }];
  const add = (label: string, value: number): void => {
    if (value !== 0) parts.push({ label, value });
  };

  // Fire: speed
  if (s.facing === 'opposite') add(`Head-on: both speeds (${s.firerSpeed} + ${s.targetSpeed})`, s.firerSpeed + s.targetSpeed);
  else if (s.facing === 'same') add(`Same facing: speed difference (${s.firerSpeed} vs ${s.targetSpeed})`, Math.abs(s.firerSpeed - s.targetSpeed));
  else add(`Other facing: target's speed (${s.targetSpeed})`, s.targetSpeed);

  // Fire: half loops: firer +5, target -5, whether or not doubled
  if (s.firer.halfLoop > 0) add('You are half-looping', 5);
  if (s.target.halfLoop > 0) add('Target is half-looping', -5);

  // Fire: jinks add together
  add(`Your jink${xTwo(s.firer.jink)}`, byLevel(s.firer.jink, 5, 10));
  add(`Target's jink${xTwo(s.target.jink)}`, byLevel(s.target.jink, 5, 10));

  // Fire: rolls cancel: the difference in levels counts +5 each
  const rollDiff = Math.abs(s.firer.roll - s.target.roll);
  if (s.firer.roll > 0 && s.firer.roll === s.target.roll) parts.push({ label: 'Both rolling: the rolls cancel out', value: 0 });
  else if (rollDiff > 0) add(s.firer.roll > s.target.roll ? `Your roll${xTwo(s.firer.roll)}` : `Target's roll${xTwo(s.target.roll)}`, 5 * rollDiff);

  // Fire: pinpoint fire (firer only)
  add(`Your pinpoint fire${xTwo(s.firer.pinpointFire)}`, -byLevel(s.firer.pinpointFire, 5, 10));

  // Fire: targeting
  add(`You are tracking the target${xTwo(s.firerTracking)}`, -byLevel(s.firerTracking, 5, 10));
  add(`Target is tracking a ship (not you)${xTwo(s.targetTracking)}`, -byLevel(s.targetTracking, 5, 10));

  return { total: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

/** Shot difficulty (Rules: Fire): base number plus maneuver, tracking and speed modifiers. */
export function shotDifficulty(s: ShotInput): number {
  return shotBreakdown(s).total;
}

/**
 * The side of the target that the firer is shooting at: the front or rear quarter (Rules: Fire). With `wide` (the advanced arcs, see Rules: Advanced arcs, for a target
 * with a body rating of 10 or more) the front quarter is the forward centre arc only, the rear quarter the rear centre arc, and the two arcs
 * on the target's left and the two on its right are the port and starboard quarters, here called 'left' and 'right' like the shields that guard them.
 */
export function quarterOf(target: Hex, targetFacing: Facing, firer: Hex, wide = false): ShieldBox {
  const arc = arcOf(target, targetFacing, firer);
  if (wide) {
    if (arc === 'FC') return 'front';
    if (arc === 'RC') return 'rear';
    return arc === 'FL' || arc === 'RL' ? 'left' : 'right';
  }
  return isForwardArc(arc) ? 'front' : 'rear';
}

/** The line of the Fire Table a quarter is read on: the port and starboard quarters share one (Rules: Advanced arcs). */
export function fireLine(side: ShieldBox): FireQuarter {
  return side === 'left' || side === 'right' ? 'portStarboard' : side;
}

export interface FireResult {
  outcome: 'none' | 'destroyed' | 'damage';
  modifiedRoll: number;
  /** Power after shields. */
  power: number;
  codes: string[];
}

export interface FireInput {
  /** Power from the gun's box at this range (Rules: Fire). */
  power: number;
  /** Shield markers in the target's relevant box; each x2 marker counts as 2 (Rules: Fire). */
  shields: number;
  ion: boolean;
  quarter: ShieldBox;
  /** The 2d6 damage roll. */
  roll: number;
}

/** Resolve a hit: shields, Fire Table and ion cannon rules (Rules: Fire). */
/**
 * A modified roll of 14 or more against the ground target (Rules: Ground attack): only body damage counts there, so instead of a kill it does the
 * body damage of the top column of the front line, plus one for every point above 13. No single gun shot can bring it down that way.
 */
export function topRollBodyDamage(modifiedRoll: number): number {
  const top = TABLES.fire.front[TABLES.fire.columns.indexOf(13)]!;
  const base = top.reduce((sum, code) => {
    const effect = parseDamageCode(code);
    return sum + (effect?.kind === 'body' ? effect.points : 0);
  }, 0);
  return base + (modifiedRoll - 13);
}

export function resolveHit(input: FireInput): FireResult {
  // Fire: ion cannons ignore shields
  const power = input.ion ? input.power : input.power - input.shields;
  let modified = input.roll + power;

  if (modified >= 14) return { outcome: 'destroyed', modifiedRoll: modified, power, codes: [] };
  // Fire: ion cannons: rolls below -1 count as -1, and 2 or less is still looked up
  if (input.ion && modified < -1) modified = -1;
  if (!input.ion && modified <= 2) return { outcome: 'none', modifiedRoll: modified, power, codes: [] };

  const column = TABLES.fire.columns.indexOf(modified);
  if (column < 0) throw new Error(`Modified roll off the Fire Table: ${modified}`);
  let codes = TABLES.fire[fireLine(input.quarter)][column]!;
  // Fire: ion cannons cannot inflict body damage
  if (input.ion) codes = codes.filter((c) => !isBodyCode(c));
  return { outcome: 'damage', modifiedRoll: modified, power, codes: [...codes] };
}

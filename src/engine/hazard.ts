import { TABLES } from './data';

/** The hazard letter of each action (Rules: Hazards). */
export type HazardCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export const ACTION_HAZARD_CODE = {
  damageControl: 'A',
  stabilizerDamage: 'B',
  actionPenalty: 'B',
  halfLoop: 'C',
  slip: 'C',
  roll: 'C',
  jink: 'C',
  bank: 'D',
  overturn: 'D',
  overspeed: 'E',
  accelerate: 'E',
  overaccelerate: 'E',
  decelerate: 'E',
  overdecelerate: 'E',
  pinpointFire: 'F',
  snapFire: 'F',
  targeting: 'G',
  angleDeflectors: 'G',
} as const satisfies Record<string, HazardCode>;

/**
 * Total difficulty (Rules: Hazards): the sum of the difficulty numbers of every planned action,
 * with doubled actions counted twice, plus stabilizer damage and action penalty (Rules: Hazards).
 */
export function totalDifficulty(entries: { difficulty: number; doubled?: boolean }[]): number {
  return entries.reduce((sum, e) => sum + (e.doubled ? e.difficulty * 2 : e.difficulty), 0);
}

export interface HazardCount {
  /** Full hazards: both damage codes apply. */
  hazards: number;
  /** Minor hazards: only the top damage code applies (0 or 1). */
  minor: number;
}

/** Piloting skill roll against total difficulty (Rules: Hazards). */
export function hazardsFromRoll(totalDifficultyValue: number, skillRoll: number): HazardCount {
  const shortfall = totalDifficultyValue - skillRoll;
  if (shortfall <= 0) return { hazards: 0, minor: 0 };
  return { hazards: Math.floor(shortfall / 5), minor: shortfall % 5 === 0 ? 0 : 1 };
}

/**
 * The Hazard Table rows a ship uses, in order (Rules: Hazards): its distinct hazard codes
 * alphabetically, recycling from the start when there are more hazards than codes.
 */
export function hazardRowSequence(codesWithMarkers: HazardCode[], count: number): HazardCode[] {
  const distinct = [...new Set(codesWithMarkers)].sort();
  if (distinct.length === 0) return [];
  return Array.from({ length: count }, (_, i) => distinct[i % distinct.length]!);
}

/** Look up one row of the Hazard Table for a 2d6 roll. A roll of 7 has no effect (Rules: Hazards). */
export function hazardDamageCodes(row: HazardCode, roll: number, minor: boolean): string[] {
  if (roll === 7) return [];
  const column = TABLES.hazard.columns.indexOf(roll);
  if (column < 0) throw new Error(`Bad hazard roll: ${roll}`);
  const entry = TABLES.hazard.rows[row];
  if (!entry) throw new Error(`Bad hazard row: ${row}`);
  const codes = minor ? [entry.top[column]!] : [entry.top[column]!, entry.bottom[column]!];
  return codes.filter((c) => c !== '-');
}

import type { ShipType } from './data';
import type { DifficultyPart } from './fire';

export interface TurnEntry {
  std: number;
  adv: number;
  /** Printed in parentheses: only reachable by overspeeding. */
  overspeedOnly: boolean;
}

export function parseTurnEntry(text: string): TurnEntry {
  const m = /^(\()?(\d+)\)?\/\(?(\d+)\)?$/.exec(text);
  if (!m) throw new Error(`Bad turn entry: ${text}`);
  return { std: Number(m[2]), adv: Number(m[3]), overspeedOnly: m[1] !== undefined };
}

/** Base turn number for a speed, from the ship's data (Rules: Planning). Speed 0 means "turn freely". */
export function baseTurnNumber(ship: ShipType, speed: number, advanced = false): number {
  if (speed === 0) return 0;
  const text = ship.turn[speed - 1];
  if (!text) throw new Error(`${ship.name} cannot travel at speed ${speed}`);
  const entry = parseTurnEntry(text);
  return advanced ? entry.adv : entry.std;
}

export interface TurnModifiers {
  slip?: boolean;
  roll?: boolean;
  jink?: boolean;
  bank?: 0 | 1 | 2;
  overturn?: 0 | 1 | 2;
  /** Lateral control damage markers: 0, 1, or 2 (x2 side). */
  lateralDamage?: 0 | 1 | 2;
  /** Extra from damage codes T+1/T+2/T+3 that were not absorbed by bank/overturn (Rules: Planning). */
  extra?: number;
}

/**
 * Actual turn number this game-turn (Rules: Planning). Modifiers are cumulative and the result
 * is never below 1/2, except that a ship at speed 0 has turn number 0 (Rules: Planning).
 */
export function turnNumber(baseTurn: number, speed: number, m: TurnModifiers = {}): number {
  return turnBreakdown(baseTurn, speed, m).total;
}

/** The turn number with every term listed, in the order of the rules (Rules: Planning). Zero modifiers are left out. */
export function turnBreakdown(baseTurn: number, speed: number, m: TurnModifiers = {}): { total: number; parts: DifficultyPart[] } {
  if (speed === 0) return { total: 0, parts: [{ label: 'Speed 0: the ship may turn freely', value: 0 }] };
  const parts: DifficultyPart[] = [{ label: `Base turn number at speed ${speed}`, value: baseTurn }];
  const add = (label: string, value: number): void => {
    if (value !== 0) parts.push({ label, value });
  };
  add('Slip (even when doubled)', m.slip ? 1 : 0);
  add('Roll', m.roll ? 1 : 0);
  add('Jink', m.jink ? 1 : 0);
  add(m.bank === 2 ? 'Double bank' : 'Bank', -(m.bank ?? 0));
  add(m.overturn === 2 ? 'Double overturn' : 'Overturn', m.overturn ? (m.overturn === 2 ? -4 : -3) : 0);
  add('Lateral control damage', m.lateralDamage ?? 0);
  add('Damage this game-turn (T+)', m.extra ?? 0);
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const total = Math.max(0.5, sum);
  if (total !== sum) parts.push({ label: 'Never lower than ½', value: total - sum });
  return { total, parts };
}

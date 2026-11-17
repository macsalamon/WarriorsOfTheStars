import { TABLES } from './data';
import { rollDice, type Rng } from './rng';

/** A skill code such as "5D+2": roll `dice` dice and add `pips`. */
export interface SkillCode {
  dice: number;
  pips: number;
}

export type PilotQuality = keyof typeof TABLES.pilotSkill.quality;

export function parseSkill(text: string): SkillCode {
  const m = /^(\d+)D(?:\+(\d+))?$/.exec(text.trim());
  if (!m) throw new Error(`Bad skill code: ${text}`);
  return { dice: Number(m[1]), pips: Number(m[2] ?? 0) };
}

export function formatSkill(code: SkillCode): string {
  return code.pips > 0 ? `${code.dice}D+${code.pips}` : `${code.dice}D`;
}

/** Skill roll (Rules: Skill). `dicePenalty` removes dice for the roll only (Rules: Fire). */
export function rollSkill(rng: Rng, code: SkillCode, dicePenalty = 0): number {
  return rollDice(rng, Math.max(0, code.dice - dicePenalty)) + code.pips;
}

/** Pilot Skill Table (Rules: Ships and crews): turn a total die-roll into a skill code. */
export function skillFromRoll(roll: number): SkillCode {
  const table = TABLES.pilotSkill.table;
  const entry = table[Math.min(Math.max(roll, 1), table.length) - 1];
  if (!entry) throw new Error(`No skill entry for roll ${roll}`);
  return parseSkill(entry);
}

/**
 * How much the dice that set the skills at the start of a scenario are tamed (an option of this edition, not of the rules):
 * 0 rolls them as printed, 1 limits each die to 2–5, 2 to 3–4, and 3 counts every die as 3.5 with the sum rounded up.
 */
export type SkillReduction = 0 | 1 | 2 | 3;

/** The total of `count` dice rolled with the given reduction. */
export function rollSkillDice(rng: Rng, count: number, reduction: SkillReduction = 0): number {
  switch (reduction) {
    case 0:
      return rollDice(rng, count);
    case 1: {
      let total = 0;
      for (let i = 0; i < count; i++) total += 2 + Math.floor(rng.next() * 4);
      return total;
    }
    case 2: {
      let total = 0;
      for (let i = 0; i < count; i++) total += 3 + Math.floor(rng.next() * 2);
      return total;
    }
    case 3:
      return Math.ceil(3.5 * count);
  }
}

/** Roll a pilot's or gunner's skill code from their quality (Rules: Ships and crews). */
export function rollSkillCode(rng: Rng, quality: PilotQuality, reduction: SkillReduction = 0): SkillCode {
  return skillFromRoll(rollSkillDice(rng, TABLES.pilotSkill.quality[quality], reduction));
}

/**
 * Probability that a skill roll (with `dicePenalty` dice removed) reaches `target` or more.
 * Exact: it convolves the dice distribution.
 */
export function chanceAtLeast(code: SkillCode, dicePenalty: number, target: number): number {
  const dice = Math.max(0, code.dice - dicePenalty);
  let dist = new Map<number, number>([[code.pips, 1]]);
  for (let i = 0; i < dice; i++) {
    const next = new Map<number, number>();
    for (const [total, p] of dist) {
      for (let face = 1; face <= 6; face++) next.set(total + face, (next.get(total + face) ?? 0) + p / 6);
    }
    dist = next;
  }
  let chance = 0;
  for (const [total, p] of dist) if (total >= target) chance += p;
  return chance;
}

/** Damage code "Sk-1": reduce by 1D. Returns null if reduced below 1D (pilot dead). */
export function reduceSkill(code: SkillCode): SkillCode | null {
  return code.dice - 1 < 1 ? null : { dice: code.dice - 1, pips: code.pips };
}

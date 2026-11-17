import { TABLES, type ShipType } from './data';
import { arcOf, hexDistance, hexEquals, type Facing, type Hex } from './hex';
import { rangeColumn } from './guns';

/*
 * Missiles, torpedoes and bombs (22): the "special weapons" in a ship's "otherWeapons" entry, written like "2x 6PT" (two tubes,
 * six projectiles). They have their own to-hit numbers and damage dice, and are fired by the pilot at one target, any number of tubes at once.
 */

export type SpecialKind = 'PT' | 'CM' | 'CB';

export interface SpecialWeapon {
  kind: SpecialKind;
  /** Projectiles that can be fired at once. */
  tubes: number;
  /** Projectiles carried at the start. */
  load: number;
}

/** What a ship's order for the special weapon names as its gun: not an index into `Ship.guns`. */
export const SPECIAL = -1;

/** Dice of damage of a hit (Rules: Missiles, torpedoes and bombs): proton torpedoes 2D, concussion missiles 3D, concussion bombs 4D. */
export const SPECIAL_DICE: Record<SpecialKind, number> = { PT: 2, CM: 3, CB: 4 };

export const SPECIAL_NAMES: Record<SpecialKind, string> = { PT: 'proton torpedoes', CM: 'concussion missiles', CB: 'concussion bombs' };

/** Reads "2x 6PT": two tubes, six projectiles, proton torpedoes (Rules: Missiles, torpedoes and bombs). */
export function parseSpecial(code: string): SpecialWeapon {
  const m = /^(\d+)x\s*(\d+)(PT|CM|CB)$/.exec(code.trim());
  if (!m) throw new Error(`Bad special weapon code: ${code}`);
  return { kind: m[3] as SpecialKind, tubes: Number(m[1]), load: Number(m[2]) };
}

/** The special weapon a ship type carries, if any. */
export function specialOf(type: Pick<ShipType, 'otherWeapons'>): SpecialWeapon | null {
  for (const code of type.otherWeapons) {
    if (/^\d+x\s*\d+(PT|CM|CB)$/.test(code.trim())) return parseSpecial(code);
  }
  return null;
}

/** The "to hit" number of a special weapon at a range (Rules: Missiles, torpedoes and bombs); null where the weapon does not reach (bombs only at range 1). */
export function specialToHit(kind: SpecialKind, range: number): number | null {
  const row = TABLES.gunneryValues.rows[kind];
  return row?.toHit[rangeColumn(Math.max(1, range))] ?? null;
}

/**
 * May a special weapon fired from `pos` facing `facing` reach `target` (Rules: Missiles, torpedoes and bombs)? Torpedoes and missiles: in the forward centre arc, up to ten
 * hexes. Bombs only at a target in the firer's own hex (Rules: Missiles, torpedoes and bombs).
 */
export function specialReaches(kind: SpecialKind, pos: Hex, facing: Facing, target: Hex): boolean {
  if (kind === 'CB') return hexEquals(pos, target);
  const range = hexDistance(pos, target);
  return range >= 1 && range <= 10 && arcOf(pos, facing, target) === 'FC';
}

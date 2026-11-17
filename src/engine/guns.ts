import { TABLES } from './data';

/** Gun code such as "QLF" or "DLF(I)" (Rules: Ships and crews). */
export interface Gun {
  code: string;
  /** First letter: S/D/T/Q */
  count: string;
  /** Second letter: L/M/H */
  weight: string;
  /** Third letter: F/S/P */
  mount: string;
  ion: boolean;
  rearMounted: boolean;
}

export function parseGun(code: string): Gun {
  const m = /^([SDTQ])([LMH])([FSP])(\(I\))?(\(R\))?$/.exec(code);
  if (!m) throw new Error(`Bad gun code: ${code}`);
  return {
    code,
    count: m[1]!,
    weight: m[2]!,
    mount: m[3]!,
    ion: m[4] !== undefined,
    rearMounted: m[5] !== undefined,
  };
}

/**
 * The guns a ship's pilot can fire: his own, and the weapons of the gunners too, which he controls from the cockpit (Rules: Gunners and turrets). Fired by
 * the pilot a pivot gun acts like a fixed gun (Rules: Gunners and turrets): it fires only into the forward arc, with the "to hit" of an F gun (see
 * `toHitNumber`). The gun keeps its own code (QMP): it is a turret. A rear-mounted gun (the Lambda's) cannot be fired that way (Rules: Gunners and turrets).
 * Gunners, when they come, fire the same turrets in all directions.
 */
export function pilotFiredGuns(type: { pilotGuns: string[]; gunnerWeapons: string[] }): string[] {
  const turrets = type.gunnerWeapons.filter((code) => !parseGun(code).rearMounted);
  return [...type.pilotGuns, ...turrets];
}

/** Range 1..5 map to columns 0..4; 6-10 is column 5. */
export function rangeColumn(range: number): number {
  if (range < 1 || range > 10) throw new Error(`Range out of table: ${range}`);
  return Math.min(range, 6) - 1;
}

/** "To hit" number (base difficulty) at a range (Rules: Ships and crews). Ion cannons subtract 3. */
export function toHitNumber(gun: Gun, range: number, firedBy: 'pilot' | 'gunner' = 'pilot'): number {
  // a pivot gun fired by a pilot acts like a fixed one (Rules: Gunners and turrets)
  const mount = gun.mount === 'P' && firedBy === 'pilot' ? 'F' : gun.mount;
  const row = TABLES.gunneryValues.rows[gun.count + mount];
  const value = row?.toHit[rangeColumn(range)];
  if (value === undefined || value === null) {
    throw new Error(`No gunnery value for ${gun.code} at range ${range}`);
  }
  return gun.ion ? value + TABLES.gunneryValues.ionModifier : value;
}

/** Power at a range (Rules: Ships and crews). Ion cannons use one flat number at every range (Rules: Ships and crews). */
export function powerNumber(gun: Gun, range: number): number {
  const row = TABLES.gunneryPower.rows[gun.count + gun.weight];
  if (!row) throw new Error(`No power row for ${gun.code}`);
  return gun.ion ? row.ion : row.power[rangeColumn(range)]!;
}

/**
 * Damage code "G": the gun loses a barrel (Q to T to D to S), and a single gun
 * stops working. Returns null when the gun is destroyed.
 */
export function degradeGun(code: string): string | null {
  const gun = parseGun(code);
  const next: Record<string, string | undefined> = { Q: 'T', T: 'D', D: 'S', S: undefined };
  const count = next[gun.count];
  if (!count) return null;
  return count + gun.weight + gun.mount + (gun.ion ? '(I)' : '') + (gun.rearMounted ? '(R)' : '');
}

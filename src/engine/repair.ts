import { getShip } from './data';
import { allGuns } from './crew';
import { parseGun } from './guns';
import type { Level } from './fire';
import type { Ship } from './state';

/*
 * Damage control (17): what can be repaired, what a repair does, and the systems that are beyond repair.
 */

export type RepairSystem = 'gun' | 'body' | 'engine' | 'lateral' | 'stabilizer';

/** What a damage control action is meant to repair: chosen when it is planned. A gun is named by its place in `Ship.guns`. */
export interface RepairChoice {
  system: RepairSystem;
  gun?: number;
}

/** Systems damaged beyond repair (Rules: R2 units, auxiliary power and damage control), by system; guns by their place in `Ship.guns`. */
export interface RepairNotes {
  body?: boolean;
  engine?: boolean;
  lateral?: boolean;
  stabilizer?: boolean;
  guns?: Record<number, boolean>;
}

/** The R2 unit of a ship (Rules: R2 units, auxiliary power and damage control): still aboard, and whether the die-roll at the start of the game-turn lets it plan free actions (Rules: R2 units, auxiliary power and damage control). */
export interface R2Unit {
  aboard: boolean;
  ready: boolean;
}

const COUNTS = ['S', 'D', 'T', 'Q'];

/** One barrel more (Rules: R2 units, auxiliary power and damage control): none to single, single to double, double to triple, triple to quad, never above the gun's printed code. */
export function repairGunCode(original: string, current: string | null): string | null {
  const full = parseGun(original);
  const have = current === null ? -1 : COUNTS.indexOf(parseGun(current).count);
  const top = COUNTS.indexOf(full.count);
  if (have >= top) return null;
  return COUNTS[have + 1] + full.weight + full.mount + (full.ion ? '(I)' : '') + (full.rearMounted ? '(R)' : '');
}

const isBeyondRepair = (ship: Ship, choice: RepairChoice): boolean => {
  const notes = ship.noRepair;
  if (!notes) return false;
  return choice.system === 'gun' ? !!notes.guns?.[choice.gun!] : !!notes[choice.system];
};

/** Everything on the ship that is damaged and may still be repaired (Rules: R2 units, auxiliary power and damage control). */
export function repairOptions(ship: Ship): RepairChoice[] {
  const type = getShip(ship.typeId);
  const options: RepairChoice[] = [];
  const originals = allGuns(type);
  originals.forEach((original, i) => {
    if (repairGunCode(original, ship.guns[i] ?? null) !== null) options.push({ system: 'gun', gun: i });
  });
  if (ship.bodyDamage > 0) options.push({ system: 'body' });
  if (ship.maxSpeed < type.speedMax) options.push({ system: 'engine' });
  if (ship.lateralDamage > 0) options.push({ system: 'lateral' });
  if (ship.stabilizerDamage > 0) options.push({ system: 'stabilizer' });
  return options.filter((c) => !isBeyondRepair(ship, c));
}

/** Is this choice one of the ship's repairable systems right now? */
export function canRepair(ship: Ship, choice: RepairChoice | null | undefined): choice is RepairChoice {
  return !!choice && repairOptions(ship).some((o) => o.system === choice.system && (o.gun ?? null) === (choice.gun ?? null));
}

/** The name of a repair for the screens and the log: "gun 2 (QMF)", "body", "engine". */
export function describeRepairChoice(ship: Ship, choice: RepairChoice): string {
  switch (choice.system) {
    case 'gun': return `gun ${choice.gun! + 1} (${ship.guns[choice.gun!] ?? 'destroyed'})`;
    case 'body': return 'body damage';
    case 'engine': return 'engine damage';
    case 'lateral': return 'lateral control damage';
    case 'stabilizer': return 'stabilizer damage';
  }
}

/** One level of repair (Rules: R2 units, auxiliary power and damage control). Returns what was done, for the log. */
export function applyRepair(ship: Ship, choice: RepairChoice): string {
  const type = getShip(ship.typeId);
  switch (choice.system) {
    case 'gun': {
      const i = choice.gun!;
      const before = ship.guns[i] ?? null;
      ship.guns[i] = repairGunCode(allGuns(type)[i]!, before);
      return `gun ${i + 1} is ${before === null ? 'working again' : 'repaired'}: ${ship.guns[i]}`;
    }
    case 'body':
      ship.bodyDamage = Math.max(0, ship.bodyDamage - 1);
      return 'one body point repaired';
    case 'engine':
      ship.maxSpeed = Math.min(type.speedMax, ship.maxSpeed + 1);
      return `maximum speed back to ${ship.maxSpeed}`;
    case 'lateral':
      ship.lateralDamage = Math.max(0, ship.lateralDamage - 1) as Level;
      return 'lateral control repaired';
    case 'stabilizer':
      ship.stabilizerDamage = Math.max(0, ship.stabilizerDamage - 1) as Level;
      return 'stabilizer repaired';
  }
}

/** Marks a system as beyond repair for good (Rules: R2 units, auxiliary power and damage control). */
export function markBeyondRepair(ship: Ship, choice: RepairChoice): void {
  const notes = (ship.noRepair ??= {});
  if (choice.system === 'gun') (notes.guns ??= {})[choice.gun!] = true;
  else notes[choice.system] = true;
}

/** Is a system beyond repair? (For the screens.) */
export const beyondRepair = isBeyondRepair;

/** The odds of damage control (Rules: R2 units, auxiliary power and damage control): a repair on 6 or less (8 or less if doubled), beyond repair on 9 or more. */
export function repairOdds(doubled: boolean): { repaired: number; beyond: number } {
  const ways = (p: (roll: number) => boolean): number => {
    let n = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (p(a + b)) n++;
    return n / 36;
  };
  return { repaired: ways((r) => r <= (doubled ? 8 : 6)), beyond: ways((r) => r >= 9) };
}

import { getShip, type ShipType } from './data';
import { arcOf, hexDistance, hexEquals, isForwardArc, type Facing, type Hex } from './hex';
import { parseGun } from './guns';
import { emptyPlan, type Plan, type PlanAction } from './plan';
import type { Ship } from './state';

/**
 * The people who fly a ship: the pilot and the gunners (14). Each has their own plan, their own hazard roll and their own guns.
 * A crew member is named by a short id: 'pilot', 'gunner1', 'gunner2'.
 */
export const PILOT = 'pilot';
export const gunnerCrewId = (seat: number): string => `gunner${seat + 1}`;

/** The gunner's seat (0 for the first gunner) of a crew id, or null for the pilot. */
export function seatOf(crew: string): number | null {
  const m = /^gunner(\d+)$/.exec(crew);
  return m ? Number(m[1]) - 1 : null;
}

/** What a gunner may plan: the actions with hazard letters A, F and G (Rules: Gunners and turrets), damage control (A) included. */
export const GUNNER_ACTIONS: readonly PlanAction[] = ['pinpointFire', 'snapFire', 'targeting', 'angleDeflectors', 'damageControl'];

/** Every gun of a ship, in the order of `Ship.guns`: its own, then the weapons of its gunners (Rules: Gunners and turrets). */
export const allGuns = (type: Pick<ShipType, 'pilotGuns' | 'gunnerWeapons'>): string[] => [...type.pilotGuns, ...type.gunnerWeapons];

export interface GunSlot {
  /** A gun of the pilot's own. */
  own: boolean;
  /** A turret: the seat of the gunner who controls it (0 for the first). */
  seat: number | null;
  /** Rear-mounted (Rules: Gunners and turrets): it fires only into the rear arcs, and only a gunner can fire it. */
  rear: boolean;
}

/** Whose gun is this, going by its place in `Ship.guns`? */
export function gunSlot(type: Pick<ShipType, 'pilotGuns' | 'gunnerWeapons'>, index: number): GunSlot {
  if (index < type.pilotGuns.length) return { own: true, seat: null, rear: false };
  const code = type.gunnerWeapons[index - type.pilotGuns.length];
  return { own: false, seat: index - type.pilotGuns.length, rear: code ? parseGun(code).rearMounted : false };
}

/** The crew member a plan or a shot is meant for: shots and plans without a name belong to the pilot. */
export const crewOrPilot = (crew: string | undefined): string => crew ?? PILOT;

/** The gunners that are still alive, by seat. */
export function livingGunners(ship: Ship): number[] {
  return (ship.gunners ?? []).flatMap((g, i) => (g.dead ? [] : [i]));
}

/** The plan of a crew member. */
export function planOf(ship: Ship, crew: string): Plan {
  const seat = seatOf(crew);
  if (seat === null) return ship.plan;
  return ship.gunners?.[seat]?.plan ?? emptyPlan();
}

/** Every crew member who has a plan, with it: the pilot, then each living gunner. */
export function crewPlans(ship: Ship): { crew: string; plan: Plan }[] {
  return [{ crew: PILOT, plan: ship.plan }, ...livingGunners(ship).map((seat) => ({ crew: gunnerCrewId(seat), plan: planOf(ship, gunnerCrewId(seat)) }))];
}

/** Can this crew member fire at all this game-turn? A ship that rolls cannot use its gunners' weapons (Rules: Gunners and turrets). */
export function canCrewFire(ship: Ship, crew: string): boolean {
  const seat = seatOf(crew);
  if (seat === null) return true;
  const gunner = ship.gunners?.[seat];
  return !!gunner && !gunner.dead && ship.plan.roll === 0;
}

/**
 * The working guns a crew member may fire. The pilot has his own and every turret that is not rear-mounted (Rules: Gunners and turrets); a gunner
 * has his own turret. Who has already fired a turret this game-turn is a separate matter (`Ship.turretClaims`).
 */
export function crewGuns(ship: Ship, crew: string): number[] {
  const type = getShip(ship.typeId);
  const seat = seatOf(crew);
  return ship.guns.flatMap((code, i) => {
    if (!code) return [];
    const slot = gunSlot(type, i);
    if (seat === null) return slot.own || !slot.rear ? [i] : [];
    return slot.seat === seat ? [i] : [];
  });
}

/** Guns that count as the pilot's when a hazard hurts a gun he is responsible for: his own, or the turrets when he has none of his own. */
export function pilotGunOptions(ship: Ship): number[] {
  const type = getShip(ship.typeId);
  const own = ship.guns.flatMap((code, i) => (code && gunSlot(type, i).own ? [i] : []));
  return own.length > 0 ? own : crewGuns(ship, PILOT);
}

/** May a gun of `crew` reach a target standing at `target`, from `pos` facing `facing`? Range up to five, never the same hex (Rules: Fire). */
export function gunReaches(ship: Ship, gunIndex: number, crew: string, pos: Hex, facing: Facing, target: Hex): boolean {
  if (hexEquals(pos, target) || hexDistance(pos, target) > 5) return false;
  const arc = arcOf(pos, facing, target);
  // the pilot fires turrets like fixed guns: forward centre arc only (Rules: Gunners and turrets); a gunner's pivot gun fires in any arc (Rules: Gunners and turrets), a rear-mounted one only behind (Rules: Gunners and turrets)
  if (seatOf(crew) === null) return arc === 'FC';
  return gunSlot(getShip(ship.typeId), gunIndex).rear ? !isForwardArc(arc) : true;
}

/** The label of a crew member for the log and the screens: "pilot", "gunner", "gunner 2". */
export function crewLabel(ship: Ship, crew: string): string {
  const seat = seatOf(crew);
  if (seat === null) return 'pilot';
  return (ship.gunners?.length ?? 0) > 1 ? `gunner ${seat + 1}` : 'gunner';
}


/**
 * The guns the pilot has to himself: his own and the turrets that have no gunner able to fire them (Rules: Gunners and turrets). The turrets of a gunner who
 * can fire are the gunner's to use; a computer pilot leaves them alone.
 */
export function pilotAvailableGuns(ship: Ship): number[] {
  const type = getShip(ship.typeId);
  return crewGuns(ship, PILOT).filter((i) => {
    const slot = gunSlot(type, i);
    return slot.own || slot.seat === null || !canCrewFire(ship, gunnerCrewId(slot.seat));
  });
}

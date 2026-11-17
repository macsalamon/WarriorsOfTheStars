import scenariosFile from '../../data/scenarios.json';
import { getShip } from './data';
import { CAPITAL, isCapitalType, speedText } from './destroyers';
import type { PilotQuality } from './skill';
import type { PlayerId } from './state';

/** Buying ships instead of using a printed ship mix (35): every ship, pilot and gunner costs its victory point value (27, see Rules: Scenarios). */

const FILE = scenariosFile as unknown as {
  shipValue: Record<string, number>;
  pilotValue: Record<PilotQuality, number>;
  gunnerValue: Record<PilotQuality, number>;
  purchase: { rebels: string[]; empire: string[] };
};

/** The fewest and the most ship points a side may be given in a points game. */
export const MIN_LIMIT = 5;
export const MAX_LIMIT = 500;

export const QUALITIES: PilotQuality[] = ['trainee', 'poor', 'average', 'veteran', 'hotshot'];

export const QUALITY_NAMES: Record<PilotQuality, string> = {
  trainee: 'Trainee',
  poor: 'Poor',
  average: 'Average',
  veteran: 'Veteran',
  hotshot: 'Hot-shot',
};

/** One ship bought for a force, with its pilot and the gunners that sit in its gun positions. */
export interface ForceShip {
  typeId: string;
  quality: PilotQuality;
  gunners: PilotQuality[];
}

/** What a player bought, and what it came to. */
export interface Force {
  ships: ForceShip[];
  cost: number;
}

/** The ships a side may buy: Rebels (player 0) and the Empire (player 1). */
export function purchasable(player: PlayerId): string[] {
  return [...(player === 0 ? FILE.purchase.rebels : FILE.purchase.empire)];
}

export const shipCost = (typeId: string): number => FILE.shipValue[typeId] ?? 0;
export const pilotCost = (quality: PilotQuality): number => FILE.pilotValue[quality];
export const gunnerCost = (quality: PilotQuality): number => FILE.gunnerValue[quality];

/** How many gunners a ship can carry: one for each gun position of its own (the weapons only gunners may fire). */
/** The name of a ship type for a message; a type that does not exist is shown as it was sent. */
const shipName = (typeId: string): string => {
  try {
    return isCapitalType(typeId) ? CAPITAL[typeId].name : getShip(typeId).name;
  } catch {
    return typeId;
  }
};
export const gunnerSlots = (typeId: string): number => (isCapitalType(typeId) ? 0 : getShip(typeId).gunnerWeapons.length);

/** The name of anything that can be bought: a ship or a capital ship. */
export const purchaseName = (typeId: string): string => (isCapitalType(typeId) ? CAPITAL[typeId].name : getShip(typeId).name);

/** What a capital ship is like, for the buying screen: its gunnery, structure and speed. */
export function capitalSummary(typeId: string): string | null {
  if (!isCapitalType(typeId)) return null;
  const c = CAPITAL[typeId];
  return `gunnery ${c.skill.dice}D, ${c.structure} structure points, speed up to ${speedText(c.maxSpeed)}`;
}

/** What one ship costs with its pilot and gunners. A capital ship has neither: it costs its value. */
export function forceShipCost(ship: ForceShip): number {
  if (isCapitalType(ship.typeId)) return shipCost(ship.typeId);
  return shipCost(ship.typeId) + pilotCost(ship.quality) + ship.gunners.reduce((sum, q) => sum + gunnerCost(q), 0);
}

export const forceCost = (ships: ForceShip[]): number => ships.reduce((sum, s) => sum + forceShipCost(s), 0);

/** Why a list of ships cannot be a force for this side with this many points; null when it can (35). */
export function forceError(player: PlayerId, limit: number, ships: ForceShip[], asteroids = false): string | null {
  if (ships.length === 0) return 'Buy at least one ship.';
  const allowed = purchasable(player);
  for (const s of ships) {
    if (!allowed.includes(s.typeId)) return `This side can’t buy the ${shipName(s.typeId)}.`;
    // capital ships are far bigger than the board game's, and do not fire at asteroids: they stay out of an asteroid field
    if (asteroids && isCapitalType(s.typeId)) return `A ${shipName(s.typeId)} can’t fight in an asteroid field.`;
    // a capital ship has no pilot or gunners to choose
    if (isCapitalType(s.typeId)) {
      if (!Array.isArray(s.gunners) || s.gunners.length > 0) return `A ${shipName(s.typeId)} has no gunners.`;
      continue;
    }
    if (!QUALITIES.includes(s.quality)) return 'Choose the skill of every pilot.';
    if (!Array.isArray(s.gunners) || s.gunners.length > gunnerSlots(s.typeId)) return `A ${getShip(s.typeId).name} has room for ${gunnerSlots(s.typeId)} gunner${gunnerSlots(s.typeId) === 1 ? '' : 's'}.`;
    if (s.gunners.some((q) => !QUALITIES.includes(q))) return 'Choose the skill of every gunner.';
  }
  const cost = forceCost(ships);
  if (cost > limit) return `The force costs ${cost} points: ${cost - limit} more than the limit of ${limit}.`;
  return null;
}

/**
 * The bonus victory points when the two sides have different numbers of ship points to spend (Rules: Scenarios): the side with fewer points
 * gets one for every two extra points the other side has.
 */
export function bonusPoints(limits: [number, number]): [number, number] {
  const extra = Math.floor(Math.abs(limits[0] - limits[1]) / 2);
  return limits[0] < limits[1] ? [extra, 0] : limits[1] < limits[0] ? [0, extra] : [0, 0];
}

/** A short description of a ship in a force: "X-wing, veteran pilot, average gunner". */
export function describeForceShip(ship: ForceShip): string {
  if (isCapitalType(ship.typeId)) return `${CAPITAL[ship.typeId].name}, gunnery ${CAPITAL[ship.typeId].skill.dice}D`;
  const name = getShip(ship.typeId).name;
  const pilot = `${QUALITY_NAMES[ship.quality].toLowerCase()} pilot`;
  const gunners = ship.gunners.map((q) => `${QUALITY_NAMES[q].toLowerCase()} gunner`);
  return [name, pilot, ...gunners].join(', ');
}

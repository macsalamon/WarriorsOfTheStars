import {
  QUALITIES,
  getShip,
  isCapitalType,
  pilotCost,
  pilotFiredGuns,
  purchasable,
  shipCost,
  type Command,
  type ForceShip,
  type GameState,
  type PilotQuality,
  type PlayerId,
  type Rng,
} from '../engine';

/** What the computer likes to buy: the ordinary fighters most, the odd big ship now and then. */
const LIKING: Record<string, number> = {
  'x-wing': 4,
  'a-wing': 3,
  'y-wing-1seat': 3,
  'y-wing-2seat': 2,
  'b-wing': 2,
  'tie-fighter': 5,
  'tie-interceptor': 3,
  'tie-interceptor-prototype': 1,
  'tie-bomber': 2,
  'imperial-shuttle': 1,
  'slave-i': 1,
  'pirate-pinnace': 1,
  'stock-freighter': 1,
  'millennium-falcon': 1,
};

/** The capital ships are the odd big purchase: how likely one is next to all the pilots of a fighter type together. */
const CAPITAL_LIKING: Record<string, number> = { 'star-destroyer': 2, 'mon-calamari': 2, 'nebulon-b': 3 };

/** Pilots: mostly average and veteran, a few poor and a rare hot-shot. */
const PILOTS: Record<PilotQuality, number> = { trainee: 0.4, poor: 1, average: 3, veteran: 2, hotshot: 0.7 };

/**
 * A force for the computer to fly, bought one ship after the other until the points run low. It buys no gunners, since gunners are not
 * part of the game yet (their turrets are fired by the pilots meanwhile, see Rules: Gunners and turrets).
 */
export function buildForce(player: PlayerId, limit: number, rng: Rng, noCapital = false): ForceShip[] {
  const types = purchasable(player).filter((id) => (isCapitalType(id) ? !noCapital : pilotFiredGuns(getShip(id)).length > 0));
  const ships: ForceShip[] = [];
  let left = limit;
  for (let guard = 0; guard < 200; guard++) {
    const choices = types.flatMap((typeId) =>
      isCapitalType(typeId)
        ? (shipCost(typeId) <= left ? [{ typeId, quality: 'average' as PilotQuality, weight: CAPITAL_LIKING[typeId] ?? 1 }] : [])
        : QUALITIES.filter((quality) => shipCost(typeId) + pilotCost(quality) <= left).map((quality) => ({ typeId, quality, weight: (LIKING[typeId] ?? 1) * PILOTS[quality] })),
    );
    if (choices.length === 0) break;
    let roll = rng.next() * choices.reduce((sum, c) => sum + c.weight, 0);
    const chosen = choices.find((c) => (roll -= c.weight) < 0) ?? choices[choices.length - 1]!;
    ships.push({ typeId: chosen.typeId, quality: chosen.quality, gunners: [] });
    left -= shipCost(chosen.typeId) + (isCapitalType(chosen.typeId) ? 0 : pilotCost(chosen.quality));
  }
  return ships;
}

/** The command that buys the computer's force. */
export function chooseForce(game: GameState, player: PlayerId, rng: Rng): Command {
  return { type: 'buy', player, ships: buildForce(player, game.purchase?.limits[player] ?? 0, rng, !!game.asteroids) };
}

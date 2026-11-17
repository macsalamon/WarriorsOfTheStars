import { attackerZoneFor, type MapEdge } from './emplacements';
import { hexDistance, hexEquals, type Hex } from './hex';
import type { GameState, PlayerId } from './state';

/**
 * Reserves (Rules: Reserves): ships that wait off the map and come in later. A scenario names the groups; each has a rule for when it comes in and one for
 * where it is placed. The parts are small and combine freely:
 *
 *   entry    scheduled  the group comes in at the Markers step of a game-turn, without any decision
 *            declared   from a game-turn on, the owner decides at the start of each game-turn whether it comes in
 *            rolled     the same, but the owner has to roll a die: 6 the first time, 5 or more the second time, 4 or more the third time and so on
 *   along    startEdge  along the edge a side started from (the side chose it at the start)
 *            any        along any edge, chosen by the owner when the group comes in
 *   depth    how many hexes deep along the edge the group may be placed (2 when missing)
 *   within   all the ships of the group must stand within this many hexes of each other
 */
export type ReserveEntry =
  | { kind: 'scheduled'; afterTurn: number }
  | { kind: 'declared'; fromTurn: number }
  | { kind: 'rolled'; fromTurn: number };

export type ReserveAlong = { kind: 'startEdge'; side: PlayerId } | { kind: 'any' };

export interface ReserveDef {
  entry: ReserveEntry;
  along: ReserveAlong;
  within?: number;
}

/** A group of reserve ships in a game: the definition, whose it is, which ships, and how far it has got. */
export interface ReserveGroup extends ReserveDef {
  id: string;
  owner: PlayerId;
  shipIds: string[];
  /** The times the owner tried to bring it in with a roll that failed. */
  attempts: number;
  entered: boolean;
  /** The game-turn in which the owner last decided about it (so that he is asked once per game-turn). */
  askedTurn?: number;
}

/** The number the die has to reach for a group that comes in with a roll: 6 on the first try, then one less each time that failed. */
export const rollNeeded = (failedAttempts: number): number => Math.max(2, 6 - failedAttempts);

/** The groups the owner may decide about at the start of this game-turn: not in yet, and old enough. */
export function entryGroups(game: GameState, turn: number): ReserveGroup[] {
  return (game.reserves ?? []).filter((g) => !g.entered && (g.entry.kind === 'declared' || g.entry.kind === 'rolled') && turn >= g.entry.fromTurn && g.shipIds.some((id) => game.ships.find((s) => s.id === id)?.status === 'reserve'));
}

/** The group that comes in on its own at the Markers step of this game-turn. */
export function scheduledGroups(game: GameState, turn: number): ReserveGroup[] {
  return (game.reserves ?? []).filter((g) => !g.entered && g.entry.kind === 'scheduled' && g.entry.afterTurn <= turn && g.shipIds.some((id) => game.ships.find((s) => s.id === id)?.status === 'reserve'));
}

/** The edge a group is placed along, when the scenario fixes it (the edge a side started from); null when its owner chooses. */
export function fixedEdge(game: GameState, group: ReserveGroup): MapEdge | null {
  return group.along.kind === 'startEdge' && game.edgeChoice && game.edgeChoice.side === group.along.side ? game.edgeChoice.edge : null;
}

/** The hexes a group may be placed in along an edge, or why it cannot (the edge is missing or not allowed). */
export function arrivalZone(game: GameState, group: ReserveGroup, edge: MapEdge | undefined): Hex[] {
  const fixed = fixedEdge(game, group);
  const use = fixed ?? (group.along.kind === 'any' ? edge : undefined);
  return use ? attackerZoneFor(game.map, use) : [];
}

/** What is wrong with a placement of a reserve group (the hexes it asks for, in order), or null. */
export function arrivalError(game: GameState, group: ReserveGroup, edge: MapEdge | undefined, hexes: Hex[], asteroidHexes: Set<string>, keyOf: (h: Hex) => string): string | null {
  if (group.along.kind === 'any' && !edge) return 'Choose the edge the ships come in along.';
  const zone = arrivalZone(game, group, edge);
  const taken = game.ships.filter((s) => s.status === 'active' && s.pos).map((s) => s.pos!);
  for (let i = 0; i < hexes.length; i++) {
    const h = hexes[i]!;
    if (!zone.some((z) => hexEquals(z, h))) return 'That hex isn’t along the edge the ships come in.';
    if (asteroidHexes.has(keyOf(h))) return 'That hex is taken by an asteroid.';
    if (taken.some((t) => hexEquals(t, h))) return 'A ship already stands in that hex.';
    if (hexes.some((o, j) => j !== i && hexEquals(o, h))) return 'Two ships can’t come in at the same hex.';
  }
  if (group.within !== undefined && hexes.some((a) => hexes.some((b) => hexDistance(a, b) > group.within!))) return `The ships have to come in within ${group.within} hexes of each other.`;
  return null;
}

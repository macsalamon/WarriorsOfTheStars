// Advanced initiative (19): every pilot rolls, the owners pick when each ship moves, ships "move with" the ship they tail.
// Pure helpers over the table kept in the game state; the rules that act on it live in game.ts.

/** The initiative table of a game-turn. */
export interface InitiativeTable {
  /** Each ship's piloting roll of the Initiative Phase (Rules: Advanced initiative): the first roll, as shown. Ships that had to re-roll a tie keep the number that was rolled first. */
  rolls: Record<string, number>;
  /** The ships in the order their owners pick, the highest roll first (Rules: Advanced initiative). */
  order: string[];
  /** Slot by slot (the first ship phase first), the ship that moves then; null while free or when nobody takes it (Rules: Advanced initiative). */
  slots: (string | null)[];
  /** A ship that has chosen to move with the enemy ship it tails (Rules: Advanced initiative): tailing ship -> tailed ship. */
  follows: Record<string, string>;
  /** The slot the movement has got to: the next one to be played. */
  cursor: number;
}

/** Before or after the tailed ship (Rules: Advanced initiative). */
export type Placing = 'before' | 'after';

/** The slot a ship has taken (0-based), or -1. */
export function slotOf(table: InitiativeTable, shipId: string): number {
  return table.slots.indexOf(shipId);
}

/** The ships that have not yet said when they move: neither a slot nor a ship to move with. */
export function undeclared(table: InitiativeTable): string[] {
  return table.order.filter((id) => slotOf(table, id) < 0 && !(id in table.follows));
}

/** The ship whose owner has to say when it moves next (Rules: Advanced initiative); null when every ship has. */
export function nextPicker(table: InitiativeTable): string | null {
  return undeclared(table)[0] ?? null;
}

/** The slots still free (0-based). */
export function freeSlots(table: InitiativeTable): number[] {
  const free: number[] = [];
  table.slots.forEach((s, i) => {
    if (s === null) free.push(i);
  });
  return free;
}

/** The ship that moves with `leaderId`, if there is one (a tailed ship has at most one, as with stealing a move, see Rules: Initiative). */
export function followerOf(table: InitiativeTable, leaderId: string): string | null {
  for (const [follower, leader] of Object.entries(table.follows)) if (leader === leaderId) return follower;
  return null;
}

/** The ship `shipId` has to wait for, down to the one that has a slot of its own. */
export function rootOf(table: InitiativeTable, shipId: string): string {
  let at = shipId;
  for (let guard = 0; table.follows[at] && guard < 64; guard++) at = table.follows[at]!;
  return at;
}

/** Does `ofId` move with `shipId`, directly or through other ships? (A ship cannot be made to wait for itself.) */
export function movesWithChain(table: InitiativeTable, shipId: string, ofId: string): boolean {
  let at: string | undefined = ofId;
  for (let guard = 0; at && guard < 64; guard++) {
    if (at === shipId) return true;
    at = table.follows[at];
  }
  return false;
}

/** The ship with a slot, followed by the ship that moves with it, the ship that moves with that one, and so on (Rules: Advanced initiative; Initiative). */
export function chainFrom(table: InitiativeTable, leaderId: string): string[] {
  const chain = [leaderId];
  for (let next = followerOf(table, leaderId); next && !chain.includes(next); next = followerOf(table, next)) chain.push(next);
  return chain;
}

/** The movement order of a chain once the "before" or "after" of each link is known (`placing[i]` is where `chain[i + 1]` goes relative to `chain[i]`). */
export function chainOrder(chain: string[], placing: Placing[]): string[] {
  let order = [chain[chain.length - 1]!];
  for (let i = chain.length - 2; i >= 0; i--) order = placing[i] === 'before' ? [...order, chain[i]!] : [chain[i]!, ...order];
  return order;
}

/** A slot's name for the log and the screen: "first", "second", ... */
export function slotName(index: number): string {
  const names = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
  return names[index] ?? `${index + 1}th`;
}

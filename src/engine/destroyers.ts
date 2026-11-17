import { TABLES } from './data';
import { DIRECTIONS, hexDistance, type Facing, type Hex } from './hex';
import type { MoveContext } from './movement';
import type { SkillCode } from './skill';
import type { PlayerId } from './state';

/**
 * The kinds of capital ship (Rules: Star Destroyers): the Imperial Star Destroyer, the Rebels' Mon Calamari cruiser (the owner's: the same tactical value with a slightly different
 * profile, one structure point less and one shield more), and the Nebulon-B frigate, which the rules treat as a smaller Star Destroyer and which either side may have.
 */
export type CapitalKind = 'star-destroyer' | 'mon-calamari' | 'nebulon-b';

/** Everything that makes one kind of capital ship different from another. */
export interface CapitalSpec {
  kind: CapitalKind;
  /** What the texts call it. */
  name: string;
  /** What the board writes on it. */
  tag: string;
  /** The sides that may have it: the Rebels (0), the Empire (1), or both. */
  sides: readonly PlayerId[];
  /** Its speed when it enters play: a step under the top speed, so that its owner may speed it up at once. */
  startSpeed: number;
  /**
   * Its hexes facing north, as offsets from the hex it turns on (axial coordinates), which is the ship's `pos`: the second hex from the front for the frigate and the cruiser, the
   * fourth for the Star Destroyer (the owner: the board game turns them on the nose, here they turn on a hex behind it).
   */
  pattern: readonly Hex[];
  /** The frontmost hex, as an offset from `pos`: where the front arc starts. */
  nose: Hex;
  /** Structure points. */
  structure: number;
  /** With this many lost it can't fire any more. */
  silentAt: number;
  /** With this many lost it is dead in space and can't move either (it can't lose more). */
  deadAt: number;
  /** Its shields, less the structure points lost, against guns (Rules: Star Destroyers). */
  shields: number;
  /** The most it can move, in hexes, and how much its speed changes in a game-turn. The speed is kept with the fraction and the hexes it moves are rounded up. */
  maxSpeed: number;
  speedStep: number;
  /** The turn number at each whole speed, 0 up to the top speed. Speed 0 has a turn number of one half: it turns freely. */
  turns: readonly number[];
  /** How far it fires at enemy capital ships, in hexes (the owner: the rules have no limit, which is far too much on this map): from any hex of the firing ship to the nearest hex of the target. */
  range: number;
  /** Its gunnery skill when the scenario says nothing. */
  skill: SkillCode;
  /** Body points a missile, torpedo or bomb has to do in one shot to cost it a structure point. */
  special: number;
  /**
   * Its body rating for missiles, torpedoes and bombs (Rules: Missiles, torpedoes and bombs): the bigger the number the easier it is to hit, the shot's difficulty is that much
   * lower. A Star Destroyer is 40 (very big), a Mon Calamari cruiser 25 (still large), a frigate 8 (smaller; its close-quarters defences make it harder to hit than its size says).
   */
  bodyRating: number;
  /** Which boxes of the Star Destroyer Attack Table it fires: both (blasters and ion cannons), or only the first column. */
  boxes: 'both' | 'first';
  /** The victory points for the other side: when it can't fire any more, when it is dead in space, when it blows up (not added up). */
  vp: readonly [number, number, number];
}

export const CAPITAL: Record<CapitalKind, CapitalSpec> = {
  'star-destroyer': {
    kind: 'star-destroyer',
    name: 'Star Destroyer',
    tag: 'SD',
    sides: [1],
    startSpeed: 4,
    // the outline of the model, drawn half as large again as the board game's eight hexes (the owner): every hex that the ship covers at least half of, 17 in all, seven long. It
    // turns on its fourth hex from the front, `pos`
    pattern: [
      { q: 0, r: -3 }, { q: 0, r: -2 }, { q: 0, r: -1 },
      { q: 1, r: -1 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 },
      { q: 0, r: 1 }, { q: 1, r: 1 }, { q: -1, r: 1 },
      { q: 0, r: 2 }, { q: 1, r: 2 }, { q: -1, r: 2 },
      { q: 0, r: 3 }, { q: -1, r: 3 }, { q: -2, r: 3 }, { q: 2, r: 1 },
    ],
    nose: { q: 0, r: -3 },
    structure: 8,
    silentAt: 8,
    deadAt: 9,
    shields: 6,
    maxSpeed: 5,
    speedStep: 0.5,
    turns: [0.5, 1, 1, 2, 3, 3],
    range: 20,
    skill: { dice: 5, pips: 0 },
    special: 8,
    bodyRating: 40,
    boxes: 'both',
    vp: [50, 75, 100],
  },
  // the Rebels' flagship: one structure point less and one shield more than a Star Destroyer, everything else the same. Its hexes were found by laying the model of the Liberty
  // over the grid (the owner: a bit smaller than a Star Destroyer, 70% larger than the board game's). It handles
  // better than a Star Destroyer: it changes its speed by a whole hex a game-turn, and turns more easily
  'mon-calamari': {
    kind: 'mon-calamari',
    name: 'Mon Calamari cruiser',
    tag: 'MC',
    sides: [0],
    startSpeed: 4,
    // 70% larger than the six hexes it had: the 13 hexes its outline covers (the hexes under the very tips of its wings left out), seven long, a column of seven with three hexes on each
    // side of its rear half. It turns on its second hex from the front
    pattern: [
      { q: 0, r: -1 }, { q: 0, r: 0 }, { q: 0, r: 1 }, { q: 0, r: 2 }, { q: 0, r: 3 }, { q: 0, r: 4 }, { q: 0, r: 5 },
      { q: 1, r: 1 }, { q: 1, r: 2 }, { q: 1, r: 3 },
      { q: -1, r: 2 }, { q: -1, r: 3 }, { q: -1, r: 4 },
    ],
    nose: { q: 0, r: -1 },
    structure: 7,
    silentAt: 7,
    deadAt: 8,
    shields: 7,
    maxSpeed: 5,
    speedStep: 1,
    // hexes / turn number: 5/3, 4/2, 3/2, 2/1, 1/½, 0/½
    turns: [0.5, 0.5, 1, 2, 2, 3],
    range: 20,
    skill: { dice: 5, pips: 0 },
    special: 8,
    bodyRating: 25,
    boxes: 'both',
    vp: [50, 75, 100],
  },
  // the frigate of the roleplaying scenario: 3 shields, 4 structure points, gunners of 4D, top speed 6 with a turn number of 3, dead in space after 4 structure points,
  // a special weapon needs 6 body points in one shot and sees a body rating of 8, only the first column of the attack table and no ion guns. Four hexes in a line (60% larger than the
  // board game's two, as long as the model is), much smaller than a Star Destroyer; it turns on its second hex from the front
  'nebulon-b': {
    kind: 'nebulon-b',
    name: 'Nebulon-B frigate',
    tag: 'NB',
    sides: [0, 1],
    startSpeed: 5,
    pattern: [{ q: 0, r: -1 }, { q: 0, r: 0 }, { q: 0, r: 1 }, { q: 0, r: 2 }],
    nose: { q: 0, r: -1 },
    structure: 4,
    silentAt: 4,
    deadAt: 4,
    shields: 3,
    maxSpeed: 6,
    speedStep: 1,
    turns: [0.5, 1, 1, 2, 2, 3, 3],
    range: 15,
    skill: { dice: 4, pips: 0 },
    special: 6,
    bodyRating: 8,
    boxes: 'first',
    // three frigates are worth about one Star Destroyer
    vp: [15, 15, 30],
  },
};

export const isCapitalType = (typeId: string): typeId is CapitalKind => typeId in CAPITAL;

/**
 * A capital ship (Rules: Star Destroyers). A big ship that moves by itself every game-turn, fires at every fighter that moves within ten hexes of it, and is
 * brought down by hits, crashes and lucky shots on its vital systems. It is not a `Ship`: it has no plan, no crew and no body rating, so every loop over the
 * ships leaves it alone. (`Destroyer` is the name of the type for both kinds, as the first was the Star Destroyer.)
 */
export interface Destroyer {
  id: string;
  owner: PlayerId;
  idNumber: number;
  /** Which kind it is (a Star Destroyer when missing, in older saves). */
  kind?: CapitalKind;
  /** The nose hex; null until it is placed. The rest of the ship stands behind it (see `destroyerHexes`). */
  pos: Hex | null;
  facing: Facing;
  /** Gunnery skill, used for all its attacks. */
  skill: SkillCode;
  /** Structure points lost (Rules: Star Destroyers): see `CapitalSpec`. */
  lost: number;
  /** Blown up by a chain reaction on the Vital Systems Hit Table. */
  exploded: boolean;
  /** The victory points its damage has earned the other side so far (they are not added up). */
  awarded: number;
  moved: boolean;
  /** It has fired at one or more fighters this game-turn: its next attack roll is 1 worse. */
  firedThisTurn: boolean;
  /** Vital systems hit (Rules: Star Destroyers). */
  fireControl: boolean;
  noTurns: boolean;
  speedLost: number;
  /** Its speed, with the fraction: it changes by a step a game-turn, between 0 and the most its power allows (the top speed at the start; missing in older saves: the most). */
  speed?: number;
  gunsDamaged: number;
  /** Game-turns it still moves out of control (the bridge was destroyed). */
  outOfControl: number;
  /** It flew off the edge of a static map: it is out of the game like a ship that escapes (31.5: "one force has escaped"). */
  escaped?: boolean;
}

/** The kind's description. */
export const specOf = (d: Pick<Destroyer, 'kind'>): CapitalSpec => CAPITAL[d.kind ?? 'star-destroyer'];

/** A turn of 60 degrees clockwise, in axial coordinates: it takes every direction to the next one. */
const rotate = (h: Hex): Hex => ({ q: -h.r, r: h.q + h.r });

/** The hexes a capital ship fills with its nose at `pos`, facing `facing`. */
export function destroyerHexes(pos: Hex, facing: Facing, kind: CapitalKind = 'star-destroyer'): Hex[] {
  return CAPITAL[kind].pattern.map((offset) => {
    let h = offset;
    for (let i = 0; i < facing; i++) h = rotate(h);
    return { q: pos.q + h.q, r: pos.r + h.r };
  });
}

/** The frontmost hex of a ship standing at `pos`, facing `facing`: where its front arc starts. */
export function capitalNose(pos: Hex, facing: Facing, kind: CapitalKind = 'star-destroyer'): Hex {
  let h = CAPITAL[kind].nose;
  for (let i = 0; i < facing; i++) h = rotate(h);
  return { q: pos.q + h.q, r: pos.r + h.r };
}

/** The distance between two capital ships: from the hex of one that is nearest to the other. */
export function capitalDistance(a: Destroyer, b: Destroyer): number {
  let best = Infinity;
  for (const h of hexesOf(a)) best = Math.min(best, nearestHexOf(b, h)?.distance ?? Infinity);
  return best;
}

/** Its hexes now (none while it is not on the map). */
export const hexesOf = (d: Destroyer): Hex[] => (d.pos ? destroyerHexes(d.pos, d.facing, specOf(d).kind) : []);

/** The hex of the ship nearest to `from`, with the distance to it. */
export function nearestHexOf(d: Destroyer, from: Hex): { hex: Hex; distance: number } | null {
  let best: { hex: Hex; distance: number } | null = null;
  for (const hex of hexesOf(d)) {
    const distance = hexDistance(from, hex);
    if (!best || distance < best.distance) best = { hex, distance };
  }
  return best;
}

/** Can the ship still fire (Rules: Star Destroyers)? Not once it has lost as many structure points as its kind may, or if it blew up. */
export const canFire = (d: Destroyer): boolean => d.pos !== null && !d.exploded && d.lost < specOf(d).silentAt;

/** Does it still move? Not once it is dead in space. */
export const canMove = (d: Destroyer): boolean => d.pos !== null && !d.exploded && d.lost < specOf(d).deadAt;

/** Is it out of the game for the scenario's end rules: it can't fire any more, or it blew up, or it has flown off the map? */
export const isOut = (d: Destroyer): boolean => d.exploded || d.lost >= specOf(d).silentAt || !!d.escaped;

/** The structure points it has left. */
export const structureLeft = (d: Destroyer): number => Math.max(0, specOf(d).structure - d.lost);

/** Its shields against guns: those of its kind, less the structure points it has lost. */
export const destroyerShields = (d: Destroyer): number => Math.max(0, specOf(d).shields - d.lost);

/**
 * The chance that the damage dice of a special weapon cost a capital ship a structure point (Rules 22.35, 23.42, 23.48): the dice are added up, the ship's shields
 * (6 for a Star Destroyer, less the structure points it has lost) are taken off, and what is left has to be `need` body points or more.
 */
export function specialStructureChance(dice: number, shields: number, need: number): number {
  let ways: number[] = [1];
  for (let n = 0; n < dice; n++) {
    const next = new Array<number>(ways.length + 6).fill(0);
    ways.forEach((w, sum) => { for (let face = 1; face <= 6; face++) next[sum + face]! += w; });
    ways = next;
  }
  const total = 6 ** dice;
  return ways.reduce((acc, w, sum) => (sum - shields >= need ? acc + w : acc), 0) / total;
}

export const DESTROYER_SPEED = 5;
export const DESTROYER_TURN = 3;
export const DESTROYER_STRUCTURE = 8;
export const DEFAULT_DESTROYER_SKILL: SkillCode = { dice: 5, pips: 0 };

/** The most the ship can move: the top speed of its kind, less one for every hit on its power (but not under 1). */
export const destroyerMaxSpeed = (d: Destroyer): number => Math.max(1, specOf(d).maxSpeed - d.speedLost);

/** Its speed now, with the fraction. */
export const destroyerSpeedNow = (d: Destroyer): number => Math.min(d.speed ?? specOf(d).maxSpeed, destroyerMaxSpeed(d));

/** A speed as it is written: a half is written ½. */
export const speedText = (speed: number): string => (Number.isInteger(speed) ? String(speed) : `${Math.floor(speed) || ''}½`);

/** The hexes a speed moves: rounded up. */
export const hexesAtSpeed = (speed: number): number => Math.ceil(speed);

/** The speeds it may move at this game-turn: a step less, the same, or a step more, between 0 and the most it can do. */
export const destroyerSpeedChoices = (d: Destroyer): number[] => {
  const now = destroyerSpeedNow(d);
  const step = specOf(d).speedStep;
  return [now - step, now, now + step].filter((s) => s >= 0 && s <= destroyerMaxSpeed(d));
};

/** The movement of a capital ship at a speed (its speed now unless one is given): the hexes of the speed, rounded up, a turn number that goes with them, nothing else (Rules: Star Destroyers). */
export function destroyerMoveContext(d: Destroyer, speed: number = destroyerSpeedNow(d)): MoveContext {
  const spec = specOf(d);
  const hexes = hexesAtSpeed(speed);
  return {
    speed: hexes,
    // no turns allowed: a turn number nobody can reach
    turnNumber: d.noTurns ? 99 : spec.turns[Math.min(spec.turns.length - 1, Math.max(0, hexes))]!,
    slipLevel: 0,
    loopLevel: 0,
    snapLevel: 0,
    slipRequired: false,
    loopsRequired: 0,
  };
}

// ---------------------------------------------------------------- the attack table (23.2)

/** One box of the Star Destroyer Attack Table: guns of one type, with the numbers for the ranges 1, 2, 3, 4, 5 and 6 to 10. */
export interface AttackBox {
  count: number;
  code: string;
  ion?: boolean;
  hit: number[];
  power: number[];
}

/** The guns that fire for a modified die-roll (2 or less: none; the table runs from 3 to 12). A frigate uses only the first column. */
export function attackBoxes(modifiedRoll: number, kind: CapitalKind = 'star-destroyer'): AttackBox[] {
  if (modifiedRoll <= 2) return [];
  const row = TABLES.destroyerAttack.rows[String(Math.min(12, modifiedRoll))];
  if (!row) return [];
  const boxes = CAPITAL[kind].boxes === 'first' ? [row.left] : [row.left, row.right];
  return boxes.filter((b): b is AttackBox => !!b);
}

/** The column of the table for a range: 1 to 5 as they are, 6 to 10 together; nothing beyond ten hexes. */
export function rangeIndex(range: number): number | null {
  if (range > 10) return null;
  return Math.max(0, Math.min(5, range - 1));
}

/** The direction vector of a facing, for the straight line of a crash (Rules: Star Destroyers). */
export const facingStep = (facing: Facing): Hex => DIRECTIONS[facing]!;

/** The difficulty of a crash into the Star Destroyer: 20, and 5 for every hex between the ship and the point where it would strike (Rules: Star Destroyers). */
export const crashDifficulty = (hexesToImpact: number): number => 20 + 5 * hexesToImpact;

// ---------------------------------------------------------------- the Vital Systems Hit Table (23.4)

export type VitalResult =
  | 'chain'
  | 'fireControl'
  | 'explosion'
  | 'steering'
  | 'none'
  | 'power'
  | 'guns'
  | 'bridge';

/** The result for a roll of two dice. */
export function vitalResult(roll: number): VitalResult {
  switch (roll) {
    case 2: return 'chain';
    case 3: return 'fireControl';
    case 4:
    case 8: return 'explosion';
    case 5: return 'steering';
    case 9: return 'power';
    case 11: return 'guns';
    case 12: return 'bridge';
    default: return 'none';
  }
}

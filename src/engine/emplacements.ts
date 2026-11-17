import { TABLES } from './data';
import { rangeColumn } from './guns';
import { DIRECTIONS, arcOf, hexDistance, hexEquals, isForwardArc, type Facing, type Hex } from './hex';
import { fromOffset, toOffset, type MapSpec } from './movement';
import type { Rng } from './rng';
import type { PlayerId } from './state';
import type { SkillCode } from './skill';

/*
 * Emplacements (Rules: Ground attack): gun emplacements on the ground (single and double turret guns) and the ground target of the Ground Attack (29).
 * They are not ships: they take no ship phases, never move, and shoot at enemy ships that fly through their forward centre arc, once each
 * game-turn. The owner can rotate them and have them track one ship each game-turn (Bookkeeping Phase); when they fire is a standing order.
 */

export type TurretKind = 'single' | 'double';

export interface Emplacement {
  /** "E1", "E2" ...: also the target id in a shot. */
  id: string;
  owner: PlayerId;
  kind: TurretKind;
  /** A double turret that has lost a gun (a G result, see Rules: Ground attack): it fires like a single one. */
  reduced?: boolean;
  pos: Hex;
  /** The hex side its forward centre arc is centred on. */
  facing: Facing;
  skill: SkillCode;
  status: 'active' | 'destroyed';
  /** It has fired this game-turn (Rules: Ground attack). */
  fired: boolean;
  /** The ship it targeted at the last Bookkeeping Phase, and for how many turns in a row (Rules: Ground attack): 1 is a -5 marker, 2 a -10 one. */
  tracking: { target: string; level: 1 | 2 } | null;
  /**
   * The upper limit of its standing order: it fires at a ship moving through its arc as soon as the chance to hit is at least this percentage
   * (a multiple of 10); null waits for the last chance (the ship is about to leave the arc or its range, or its move ends).
   */
  chance: number | null;
  /**
   * The lower limit: at the last chance it fires only when the chance to hit is at least this percentage (a multiple of 10; 0 for any shot
   * that can hit at all). Below it the gun keeps its shot for another ship later in the game-turn. A shot that cannot hit is never fired.
   * Missing in old saved games: any shot.
   */
  lastChance?: number;
}

/** What a player does with one of their turret guns while planning a game-turn (Rules: Ground attack): turn it a hex side, have it track a ship, and say when it fires. */
export interface TurretOrder {
  id: string;
  /** -1 or 1: one hex side to the left or to the right (Rules: Ground attack). */
  turn?: -1 | 0 | 1;
  /** The ship it tracks during the next game-turn (Rules: Ground attack); null for none. */
  target?: string | null;
  /** The upper limit: null fires at the last chance only; a multiple of 10 fires as soon as the chance to hit is that percentage or more. */
  chance?: number | null;
  /** The lower limit: a multiple of 10 from 0 to 100; at the last chance the gun fires only when the chance to hit is that percentage or more (0: any shot that can hit). */
  lastChance?: number;
}

/** What a turret gun is told to do unless its owner says otherwise (and what the computer's guns do): fire at once at 50% or better, at the last chance at 20% or better. */
export const TURRET_FIRE_AT = 50;
export const TURRET_LAST_CHANCE = 20;

/** The ground target of the Ground Attack (Rules: Ground attack): it is destroyed by 10 body points. */
export interface GroundTarget {
  id: 'GT';
  owner: PlayerId;
  pos: Hex;
  damage: number;
  status: 'active' | 'destroyed';
}

export const GROUND_TARGET_ID = 'GT';
export const GROUND_TARGET_BODY = 10;
/** Turret guns have no gunner's skill of their own: 5D for all (the owner's decision, see Rules: Ground attack). */
export const TURRET_SKILL: SkillCode = { dice: 5, pips: 0 };

/** The skill one step up (+1) or down (-1) the usual progression: 5D, 5D+1, 5D+2, 6D... (never below 1D, never above 12D+2). */
export function stepSkill(skill: SkillCode, direction: 1 | -1): SkillCode {
  const n = Math.min(12 * 3 + 2, Math.max(3, skill.dice * 3 + skill.pips + direction));
  return { dice: Math.floor(n / 3), pips: n % 3 };
}
/** A turret gun's body rating, for the difficulty of special weapons fired at it (Rules: Missiles, torpedoes and bombs), and the body points that destroy it (Rules: Ground attack). */
export const TURRET_BODY = 5;
export const TURRET_RANGE = 10;
/** The victory points for destroying a turret (Rules: Victory points for hits): a reduced double turret has already given the difference. */
export const TURRET_POINTS: Record<TurretKind, number> = { single: 2, double: 3 };
export const GROUND_TARGET_POINTS = 10;

/** The numbers printed on the counters, for ranges 1, 2, 3, 4, 5 and 6 to 10 (Rules: Ships and crews; Ground attack). */
export const TURRET_TO_HIT: Record<TurretKind, readonly number[]> = {
  single: [17, 15, 15, 18, 21, 23],
  double: [16, 14, 14, 17, 20, 22],
};

export const TURRET_NAMES: Record<TurretKind, string> = { single: 'single turret gun', double: 'double turret gun' };

export const isEmplacementTarget = (target: string): boolean => /^E\d+$/.test(target) || target === GROUND_TARGET_ID;

/** A double turret that has lost a gun is a single one in every way that counts (Rules: Ground attack). */
export const actsAsSingle = (e: Pick<Emplacement, 'kind' | 'reduced'>): boolean => e.kind === 'single' || !!e.reduced;

export function turretName(e: Emplacement): string {
  return `${e.reduced ? 'damaged double' : e.kind} turret ${e.id}`;
}

/** The "to hit" number of a turret at a range 1 to 10 (Rules: Ground attack). */
export function turretToHit(e: Pick<Emplacement, 'kind' | 'reduced'>, range: number): number {
  return TURRET_TO_HIT[actsAsSingle(e) ? 'single' : 'double'][rangeColumn(Math.max(1, range))]!;
}

/** The power of a turret's hit at a range: the SH line of the Gunnery Power Chart for a single turret, DH for a double (Rules: Ground attack). */
export function turretPower(e: Pick<Emplacement, 'kind' | 'reduced'>, range: number): number {
  return TABLES.gunneryPower.rows[actsAsSingle(e) ? 'SH' : 'DH']!.power[rangeColumn(Math.max(1, range))]!;
}

/** Is a hex in a turret's forward centre arc, within ten hexes (Rules: Ground attack)? */
export function turretReaches(e: Pick<Emplacement, 'pos' | 'facing'>, hex: Hex): boolean {
  const range = hexDistance(e.pos, hex);
  return range >= 1 && range <= TURRET_RANGE && arcOf(e.pos, e.facing, hex) === 'FC';
}

/** Which line of the Fire Table a hit on a turret uses: front when the firer is in any of the gun's three front arcs, else rear (Rules: Ground attack). */
export function turretQuarter(e: Pick<Emplacement, 'pos' | 'facing'>, from: Hex): 'front' | 'rear' {
  return hexEquals(e.pos, from) ? 'front' : isForwardArc(arcOf(e.pos, e.facing, from)) ? 'front' : 'rear';
}

// ---------------------------------------------------------------- setting up (Rules: Ground attack)

/** Hexes at least this far from every edge of the map (see Rules: Ground attack). */
const EDGE_MARGIN = 10;

const insideMargin = (map: MapSpec, h: Hex, margin = EDGE_MARGIN): boolean => {
  const { col, row } = toOffset(h);
  return col >= margin && col < map.cols - margin && row >= margin && row < map.rows - margin;
};

export interface Layout {
  ground: Hex;
  turrets: { kind: TurretKind; pos: Hex; /** Facing out, for the guns of the standard base. */ facing?: Facing }[];
  /** The middle hex of the standard base, when the layout has one. */
  baseCentre?: Hex;
}

/**
 * The standard base (see Rules: Ground attack), as offsets in axial coordinates from the empty hex in its middle: three double turret
 * guns in the hexes round the middle (every other one) and six single guns in the ring outside, in the hexes between the corners. The middle
 * hex is empty: the ground target is *not* part of the base, it is put somewhere else (see `groundLayout`).
 */
export const STANDARD_BASE: readonly { kind: TurretKind; q: number; r: number; facing: Facing }[] = [
  // the doubles face the three directions of their own, the singles the three between them: all six sides are covered ("guns facing out")
  { kind: 'double', q: 0, r: -1, facing: 0 },
  { kind: 'double', q: 1, r: 0, facing: 2 },
  { kind: 'double', q: -1, r: 1, facing: 4 },
  { kind: 'single', q: -1, r: -1, facing: 5 },
  { kind: 'single', q: 1, r: -2, facing: 1 },
  { kind: 'single', q: 2, r: -1, facing: 1 },
  { kind: 'single', q: 1, r: 1, facing: 3 },
  { kind: 'single', q: -1, r: 2, facing: 3 },
  { kind: 'single', q: -2, r: 1, facing: 5 },
];

/** A hex offset turned clockwise by `steps` hex sides (60 degrees each) about the origin. */
export function rotateOffset(q: number, r: number, steps: number): { q: number; r: number } {
  let out = { q, r };
  for (let i = 0; i < ((steps % 6) + 6) % 6; i++) out = { q: -out.r, r: out.q + out.r };
  return out;
}

/** The nine guns of the standard base with the empty hex in its middle at `centre`, the whole base turned clockwise by `rotation` hex sides, every gun facing out. */
export function standardBaseAt(centre: Hex, rotation = 0): { kind: TurretKind; pos: Hex; facing: Facing }[] {
  return STANDARD_BASE.map((t) => {
    const o = rotateOffset(t.q, t.r, rotation);
    return { kind: t.kind, pos: { q: centre.q + o.q, r: centre.r + o.r }, facing: ((t.facing + (((rotation % 6) + 6) % 6)) % 6) as Facing };
  });
}

// ---------------------------------------------------------------- the defender places the base (Rules: Ground attack)

/** What a defender has to place: the ground target, a standard base (Rules: Ground attack), and/or loose turret guns (Rules: Ground attack). */
export interface BaseKit {
  ground: boolean;
  base: boolean;
  doubles: number;
  singles: number;
}

export type BaseItemKind = 'ground' | 'base' | 'single' | 'double';

export interface BaseItem {
  id: string;
  kind: BaseItemKind;
}

/** A placed item: where (the middle hex for the standard base) and how it faces (for the base the number of hex sides it is turned, for a gun its facing; unused for the target). */
export interface BasePlacement {
  id: string;
  pos: Hex;
  facing: number;
}

/** The kit of a scenario: a standard base for three double and six single guns, loose guns for any other number (Rules: Ground attack). */
export function kitFor(doubles: number, singles: number): BaseKit {
  const standard = doubles === 3 && singles === 6;
  return { ground: true, base: standard, doubles: standard ? 0 : doubles, singles: standard ? 0 : singles };
}

export function baseItems(kit: BaseKit): BaseItem[] {
  const items: BaseItem[] = [];
  if (kit.ground) items.push({ id: GROUND_TARGET_ID, kind: 'ground' });
  if (kit.base) items.push({ id: 'BASE', kind: 'base' });
  for (let i = 1; i <= kit.doubles; i++) items.push({ id: `D${i}`, kind: 'double' });
  for (let i = 1; i <= kit.singles; i++) items.push({ id: `S${i}`, kind: 'single' });
  return items;
}

/** The guns an item puts on the map (none for the ground target). */
export function itemGuns(kind: BaseItemKind, p: Pick<BasePlacement, 'pos' | 'facing'>): { kind: TurretKind; pos: Hex; facing: Facing }[] {
  if (kind === 'ground') return [];
  if (kind === 'base') return standardBaseAt(p.pos, p.facing);
  return [{ kind, pos: p.pos, facing: (((p.facing % 6) + 6) % 6) as Facing }];
}

const sameHex = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

/** Every hex an item takes up: the ground target one, a gun one, the standard base its nine gun hexes (its empty middle stays free). */
function footprint(kind: BaseItemKind, p: BasePlacement): Hex[] {
  return kind === 'ground' ? [p.pos] : itemGuns(kind, p).map((g) => g.pos);
}

/** What is wrong with a (part of a) layout of the defender's items, or null (Rules: Ground attack): everything at least ten hexes from the map edge, no two in one hex, guns at least two hexes from the ground target. */
export function baseLayoutError(map: MapSpec, kit: BaseKit, placed: { item: BaseItem; placement: BasePlacement }[], complete = true): string | null {
  const guns: { pos: Hex; id: string }[] = [];
  const ground: Hex[] = [];
  const used: Hex[] = [];
  for (const { item, placement } of placed) {
    if (!Number.isInteger(placement.facing) || placement.facing < 0 || placement.facing > 5) return 'A facing is one of the six hex sides.';
    for (const h of footprint(item.kind, placement)) {
      if (!insideMargin(map, h)) return `${item.kind === 'ground' ? 'The ground target' : item.kind === 'base' ? 'The base' : 'A turret gun'} must be at least ${EDGE_MARGIN} hexes from the edge of the map.`;
      if (used.some((u) => sameHex(u, h))) return 'Two items can’t share a hex.';
      used.push(h);
    }
    if (item.kind === 'ground') ground.push(placement.pos);
    else for (const g of itemGuns(item.kind, placement)) guns.push({ pos: g.pos, id: item.id });
  }
  for (const target of ground) for (const g of guns) if (hexDistance(g.pos, target) < 2) return 'A turret gun must be at least two hexes from the ground target.';
  if (complete) {
    const wanted = baseItems(kit);
    if (placed.length !== wanted.length || wanted.some((w) => !placed.some((p) => p.item.id === w.id))) return 'Place every item.';
  }
  return null;
}

/** The hexes where an item may be put now (its middle hex for the base), given the others already placed: what the board shades while the defender places the base. */
export function validBaseHexes(map: MapSpec, kit: BaseKit, item: BaseItem, facing: number, others: { item: BaseItem; placement: BasePlacement }[]): Hex[] {
  const out: Hex[] = [];
  const rest = others.filter((o) => o.item.id !== item.id);
  for (let col = 0; col < map.cols; col++) {
    for (let row = 0; row < map.rows; row++) {
      const pos = fromOffset(col, row);
      if (baseLayoutError(map, kit, [...rest, { item, placement: { id: item.id, pos, facing } }], false) === null) out.push(pos);
    }
  }
  return out;
}

/**
 * The computer's set-up for Mix Three (the owner's picture): a ring of twelve guns (eight doubles and four singles) round a column of three singles,
 * every gun facing out, round an empty-looking middle; offsets from the middle gun. The ground target stands two hexes outside the ring on the east side.
 */
export const MIX_THREE_BASE: readonly { kind: TurretKind; q: number; r: number; facing: Facing }[] = [
  { kind: 'single', q: 0, r: -2, facing: 0 },
  { kind: 'single', q: 0, r: -1, facing: 0 },
  { kind: 'single', q: 0, r: 0, facing: 0 },
  { kind: 'single', q: 0, r: 1, facing: 3 },
  { kind: 'single', q: 0, r: 2, facing: 3 },
  { kind: 'single', q: -2, r: 1, facing: 5 },
  { kind: 'single', q: 2, r: -1, facing: 1 },
  { kind: 'double', q: -1, r: -1, facing: 0 },
  { kind: 'double', q: 1, r: -2, facing: 0 },
  { kind: 'double', q: -2, r: 0, facing: 5 },
  { kind: 'double', q: 2, r: -2, facing: 1 },
  { kind: 'double', q: -2, r: 2, facing: 4 },
  { kind: 'double', q: 2, r: 0, facing: 2 },
  { kind: 'double', q: -1, r: 2, facing: 3 },
  { kind: 'double', q: 1, r: 1, facing: 3 },
];
export const MIX_THREE_GROUND = { q: 4, r: -2 };

/**
 * A layout made by the game for a defender who does not place the base by hand (the computer): the ground target about in the middle of the map, and the
 * standard base (not turned) straight north or south of it with the nearest gun two hexes from the target, or loose guns scattered round the target.
 */
export function autoBase(rng: Rng, map: MapSpec, kit: BaseKit): BasePlacement[] {
  // Mix Three (8 double and 7 single guns): the owner's fixed set-up
  if (!kit.base && kit.doubles === MIX_THREE_BASE.filter((g) => g.kind === 'double').length && kit.singles === MIX_THREE_BASE.filter((g) => g.kind === 'single').length) {
    const centre = fromOffset(Math.floor(map.cols / 2), Math.floor(map.rows / 2) + 3);
    const at = (dq: number, dr: number): Hex => ({ q: centre.q + dq, r: centre.r + dr });
    const out: BasePlacement[] = [{ id: GROUND_TARGET_ID, pos: at(MIX_THREE_GROUND.q, MIX_THREE_GROUND.r), facing: 0 }];
    MIX_THREE_BASE.filter((g) => g.kind === 'double').forEach((g, i) => out.push({ id: `D${i + 1}`, pos: at(g.q, g.r), facing: g.facing }));
    MIX_THREE_BASE.filter((g) => g.kind === 'single').forEach((g, i) => out.push({ id: `S${i + 1}`, pos: at(g.q, g.r), facing: g.facing }));
    return out;
  }
  const layout = groundLayout(rng, map, kit.doubles, kit.singles, kit.base);
  const out: BasePlacement[] = [];
  if (kit.ground) out.push({ id: GROUND_TARGET_ID, pos: layout.ground, facing: 0 });
  if (kit.base) out.push({ id: 'BASE', pos: layout.baseCentre!, facing: 0 });
  else {
    layout.turrets.filter((t) => t.kind === 'double').forEach((t, i) => out.push({ id: `D${i + 1}`, pos: t.pos, facing: t.facing ?? 0 }));
    layout.turrets.filter((t) => t.kind === 'single').forEach((t, i) => out.push({ id: `S${i + 1}`, pos: t.pos, facing: t.facing ?? 0 }));
  }
  return out;
}

/**
 * The ground target and the turret guns of a defender (Rules: Ground attack). The "standard base" of three double and six single turret guns is the
 * fixed pattern, put anywhere at least ten hexes from every map edge; the ground target is then put at least two hexes from
 * every gun, and ten from the edges. The owner's reading of the rule: the base does not surround the target. We put the target at random in the
 * hexes exactly two hexes from the nearest gun, as a defender who wants it protected would. Other numbers of guns are scattered at random round
 * the target, none within two hexes of it, within ten of an edge, and each within three of another.
 */
export function groundLayout(rng: Rng, map: MapSpec, doubles: number, singles: number, standard = doubles === 3 && singles === 6): Layout {
  // the target stands about in the middle of the map, so that no edge is within shooting reach of it on the first game-turn; a little off the exact middle
  const jitter = (): number => Math.floor(rng.next() * 5) - 2;
  const middle = fromOffset(Math.floor(map.cols / 2) + jitter(), Math.floor(map.rows / 2) + jitter());
  if (standard) {
    // the standard base straight north or south of the target, close enough that its nearest gun is two hexes from it
    const northOf = rng.next() < 0.5;
    const { col, row } = toOffset(middle);
    for (let k = 2; k <= 10; k++) {
      const centre = fromOffset(col, row + (northOf ? -k : k));
      const turrets: Layout['turrets'] = standardBaseAt(centre, 0);
      if (Math.min(...turrets.map((t) => hexDistance(t.pos, middle))) === 2 && turrets.every((t) => insideMargin(map, t.pos))) return { ground: middle, turrets, baseCentre: centre };
    }
  }
  if (standard) {
    // the base needs two hexes round its middle; the target may be two hexes beyond that
    const lo = EDGE_MARGIN + 2;
    const col = lo + Math.floor(rng.next() * (map.cols - 2 * lo));
    const row = lo + Math.floor(rng.next() * (map.rows - 2 * lo));
    const centre = fromOffset(col, row);
    const turrets: Layout['turrets'] = standardBaseAt(centre, 0);
    const near = (h: Hex): number => Math.min(...turrets.map((t) => hexDistance(t.pos, h)));
    const candidates: Hex[] = [];
    for (let dq = -6; dq <= 6; dq++) {
      for (let dr = -6; dr <= 6; dr++) {
        const h = { q: centre.q + dq, r: centre.r + dr };
        if (insideMargin(map, h) && near(h) === 2) candidates.push(h);
      }
    }
    return { ground: candidates[Math.floor(rng.next() * candidates.length)]!, turrets, baseCentre: centre };
  }
  const spread = 10;
  const ground = middle;
  const turrets: Layout['turrets'] = [];
  const candidates: Hex[] = [];
  for (let dq = -spread; dq <= spread; dq++) {
    for (let dr = -spread; dr <= spread; dr++) {
      const h = { q: ground.q + dq, r: ground.r + dr };
      const d = hexDistance(ground, h);
      if (d >= 2 && d <= spread && insideMargin(map, h)) candidates.push(h);
    }
  }
  // the near hexes first, with some shuffling, so that the turrets lie in a group
  const ranked = candidates.map((h) => ({ h, key: hexDistance(ground, h) + rng.next() * 3 })).sort((a, b) => a.key - b.key).map((x) => x.h);
  const kinds: TurretKind[] = [...Array(doubles).fill('double'), ...Array(singles).fill('single')];
  const placed: Hex[] = [];
  for (const h of ranked) {
    if (placed.length === kinds.length) break;
    if (placed.length > 0 && !placed.some((p) => hexDistance(p, h) <= 3)) continue;
    if (placed.some((p) => hexEquals(p, h))) continue;
    placed.push(h);
  }
  // the kinds are dealt out at random
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  placed.forEach((pos, i) => turrets.push({ kind: kinds[i]!, pos }));
  return { ground, turrets };
}

/** The facing from a hex toward a point (the hex side that is nearest to the direction), for turning turrets to face the enemy. */
export function facingToward(from: Hex, to: Hex): Facing {
  let best: Facing = 0;
  let bestDistance = Infinity;
  for (let f = 0; f < 6; f++) {
    const probe = { q: from.q + DIRECTIONS[f]!.q * 10, r: from.r + DIRECTIONS[f]!.r * 10 };
    const d = hexDistance(probe, to);
    if (d < bestDistance) {
      bestDistance = d;
      best = f as Facing;
    }
  }
  return best;
}

// ---------------------------------------------------------------- the attacker's edge (Rules: Ground attack)

export type MapEdge = 'top' | 'bottom' | 'left' | 'right';
export const MAP_EDGES: readonly MapEdge[] = ['top', 'bottom', 'left', 'right'];

/** How deep along the edge the attackers may set up, in hexes (see Rules: Ground attack). */
const EDGE_DEPTH = 2;

/** The depth of a hex from an edge of the map: 0 on the edge. */
function depthFrom(map: MapSpec, edge: MapEdge, h: Hex): number {
  const { col, row } = toOffset(h);
  switch (edge) {
    case 'top': return row;
    case 'bottom': return map.rows - 1 - row;
    case 'left': return col;
    default: return map.cols - 1 - col;
  }
}

/** The hexes along one edge where the attackers set up. */
export function attackerZoneFor(map: MapSpec, edge: MapEdge): Hex[] {
  const out: Hex[] = [];
  for (let col = 0; col < map.cols; col++) for (let row = 0; row < map.rows; row++) if (depthFrom(map, edge, fromOffset(col, row)) < EDGE_DEPTH) out.push(fromOffset(col, row));
  return out;
}

/**
 * The hexes where the defender's ships may stand: anywhere but near the rim of the map (Rules: Ground attack). The defender does not know which edge the attackers will
 * choose (see Rules: Ground attack; fog of war), so the same area serves for every edge: two hexes clear of the attackers' strip, whichever edge it is.
 */
export function defenderZone(map: MapSpec): Hex[] {
  const out: Hex[] = [];
  for (let col = EDGE_DEPTH + 2; col < map.cols - EDGE_DEPTH - 2; col++) for (let row = EDGE_DEPTH + 2; row < map.rows - EDGE_DEPTH - 2; row++) out.push(fromOffset(col, row));
  return out;
}

/** The hex in the middle of an edge. */
export function edgeMidpoint(map: MapSpec, edge: MapEdge): Hex {
  const col = Math.floor(map.cols / 2);
  const row = Math.floor(map.rows / 2);
  switch (edge) {
    case 'top': return fromOffset(col, 0);
    case 'bottom': return fromOffset(col, map.rows - 1);
    case 'left': return fromOffset(0, row);
    default: return fromOffset(map.cols - 1, row);
  }
}

/** The facing for a ship set down at `from` with the enemy's set-up area at `to`: straight north or south when that is the way, else the hex side that comes nearest. */
export function setupFacing(from: Hex, to: Hex): Facing {
  const dx = 1.5 * (to.q - from.q);
  const dy = Math.sqrt(3) * (to.r - from.r + (to.q - from.q) / 2);
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 3 : 0;
  return facingToward(from, to);
}

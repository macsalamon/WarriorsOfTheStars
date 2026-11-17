/**
 * Hex geometry. Flat-top hexes in axial coordinates (q = column, r = row).
 * Facing is the index of a hex side, 0..5 clockwise starting at "up".
 * Display ids like "1001" (column/row printed on the map) are a rendering concern.
 */
export interface Hex {
  q: number;
  r: number;
}

export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

export const DIRECTIONS: readonly Hex[] = [
  { q: 0, r: -1 }, // 0 up
  { q: 1, r: -1 }, // 1 up-right
  { q: 1, r: 0 }, // 2 down-right
  { q: 0, r: 1 }, // 3 down
  { q: -1, r: 1 }, // 4 down-left
  { q: -1, r: 0 }, // 5 up-left
];

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function neighbor(hex: Hex, facing: number): Hex {
  const d = DIRECTIONS[((facing % 6) + 6) % 6]!;
  return { q: hex.q + d.q, r: hex.r + d.r };
}

/** Number of hexes between two hexes, counting the destination but not the origin. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function turnFacing(facing: Facing, sides: number): Facing {
  return ((((facing + sides) % 6) + 6) % 6) as Facing;
}

const EPS = 1e-6;

/** Angle in degrees, clockwise from "up", from one hex centre to another. */
function bearing(from: Hex, to: Hex): number {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const x = 1.5 * dq;
  const y = Math.sqrt(3) * (dr + dq / 2); // screen y grows downward
  const deg = (Math.atan2(x, -y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Bearing of `to` relative to a ship at `from` facing `facing`, 0..360 clockwise. */
export function relativeBearing(from: Hex, facing: Facing, to: Hex): number {
  if (hexEquals(from, to)) throw new Error('Same hex has no bearing');
  return (bearing(from, to) - facing * 60 + 720) % 360;
}

/** The six 60-degree ship arcs (Rules: The map). FC = forward centre, RL = rear left, and so on. */
export type Arc = 'FC' | 'FR' | 'RR' | 'RC' | 'RL' | 'FL';

/**
 * Which arc a hex lies in (Rules: The map). The printed diagram assigns every hex to one arc:
 * centre arcs are strictly inside 30 degrees of their axis, and hexes lying exactly
 * on a boundary go to the side arc, with the left/right boundaries going forward.
 */
export function arcOf(from: Hex, facing: Facing, to: Hex): Arc {
  const a = relativeBearing(from, facing, to);
  if (a < 30 - EPS || a > 330 + EPS) return 'FC';
  if (a <= 90 + EPS) return 'FR';
  if (a <= 150 + EPS) return 'RR';
  if (a < 210 - EPS) return 'RC';
  if (a < 270 - EPS) return 'RL';
  return 'FL';
}

export function isForwardArc(arc: Arc): boolean {
  return arc === 'FC' || arc === 'FL' || arc === 'FR';
}

/** A ship may fire only at targets in its forward centre arc within five hexes (Rules: Fire). */
export function canFireAt(firer: Hex, facing: Facing, target: Hex): boolean {
  if (hexEquals(firer, target)) return false;
  return hexDistance(firer, target) <= 5 && arcOf(firer, facing, target) === 'FC';
}

/** Tailing (Rules: The map): you are in its rear centre arc, it is in your forward centre arc, within ten hexes. */
export function isTailing(
  tailer: Hex,
  tailerFacing: Facing,
  enemy: Hex,
  enemyFacing: Facing,
): boolean {
  if (hexEquals(tailer, enemy) || hexDistance(tailer, enemy) > 10) return false;
  return (
    arcOf(tailer, tailerFacing, enemy) === 'FC' && arcOf(enemy, enemyFacing, tailer) === 'RC'
  );
}

export type FacingRelation = 'same' | 'opposite' | 'other';

/** Relative facing of two ships (Rules: Fire), Standard Game: hex-side facings only. */
export function facingRelation(a: Facing, b: Facing): FacingRelation {
  if (a === b) return 'same';
  if ((a + 3) % 6 === b) return 'opposite';
  return 'other';
}

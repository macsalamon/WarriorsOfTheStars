import type { Level } from './fire';
import { neighbor, turnFacing, type Facing, type Hex } from './hex';

/**
 * Movement rules (Rules: Movement) expressed as an abstract state machine that knows nothing about
 * the map. It answers "which next step is legal?" such that the ship can always still finish a
 * legal move, so players can never paint themselves into a corner.
 */
export type MoveStep = 'forward' | 'turnLeft' | 'turnRight' | 'slipLeft' | 'slipRight' | 'halfLoop' | 'snapFire';

export const MOVE_STEPS: readonly MoveStep[] = [
  'forward', 'turnLeft', 'turnRight', 'slipLeft', 'slipRight', 'halfLoop', 'snapFire',
];

export interface MoveContext {
  /** Hexes the ship must move (Rules: Movement). */
  speed: number;
  /** Actual turn number this game-turn (Rules: Planning). */
  turnNumber: number;
  slipLevel: Level;
  loopLevel: Level;
  /** How many snap fires the move may contain: one for each crew member who planned it (each fires at most once, see Rules: Movement; Gunners and turrets). */
  snapLevel: number;
  /** Must slip at least once, and must half-loop this many times (Rules: Movement). */
  slipRequired: boolean;
  loopsRequired: number;
}

interface SlipState {
  dir: 'L' | 'R';
  len: number;
  /** After a diagonal hex of a single slip the next hex is straight (Rules: Movement). */
  expect: 'diag' | 'straight';
}

export interface MoveTracker {
  budget: number;
  fwdSinceTurn: number;
  credits: number;
  fwdSinceLoop: number;
  loopsDone: number;
  hexesMoved: number;
  slip: SlipState | null;
  slipsDone: number;
  /** Snap fires taken so far. */
  snapsDone: number;
  movedSinceSnap: boolean;
}

export function startTracker(ctx: MoveContext): MoveTracker {
  return {
    budget: ctx.speed,
    fwdSinceTurn: 0,
    credits: 0,
    fwdSinceLoop: 0,
    loopsDone: 0,
    hexesMoved: 0,
    slip: null,
    slipsDone: 0,
    snapsDone: 0,
    movedSinceSnap: false,
  };
}

/** A slip must run for at least as many hexes as the turn number (Rules: Movement); it is the whole move if that exceeds speed. */
function minSlipLength(ctx: MoveContext): number {
  return Math.min(Math.max(1, Math.ceil(ctx.turnNumber)), ctx.speed);
}

/** Hexes of forward movement needed before a half loop (Rules: Movement). */
function loopRunUp(ctx: MoveContext): number {
  return Math.max(1, Math.ceil(ctx.turnNumber));
}

/** A slip has begun and has not yet run as many hexes as the rules demand: it must go on. */
export function slipIncomplete(ctx: MoveContext, tr: MoveTracker): boolean {
  return tr.slip !== null && tr.slip.len < minSlipLength(ctx);
}

function closeSlip(ctx: MoveContext, tr: MoveTracker): boolean {
  if (!tr.slip) return true;
  if (tr.slip.len < minSlipLength(ctx)) return false;
  tr.slipsDone += 1;
  tr.slip = null;
  return true;
}

/** Bookkeeping common to every hex entered: it counts as forward movement for turning (Rules: Movement). */
function enterHex(ctx: MoveContext, tr: MoveTracker): void {
  tr.budget -= 1;
  tr.hexesMoved += 1;
  tr.fwdSinceTurn += 1;
  tr.fwdSinceLoop += 1;
  if (tr.snapsDone > 0) tr.movedSinceSnap = true;
  if (ctx.turnNumber < 1) tr.credits = 2; // turn number 1/2: two hex sides per hex (Rules: Movement)
  else if (tr.fwdSinceTurn >= ctx.turnNumber) tr.credits = 1;
}

/** Apply one step to a copy of the tracker, or return null if the step is illegal by itself. */
export function stepTracker(ctx: MoveContext, before: MoveTracker, step: MoveStep): MoveTracker | null {
  const tr: MoveTracker = { ...before, slip: before.slip ? { ...before.slip } : null };

  switch (step) {
    case 'forward': {
      if (tr.budget < 1) return null;
      if (tr.slip && ctx.slipLevel === 1 && tr.slip.expect === 'straight') {
        tr.slip.len += 1; // the straight hex of a single slip belongs to the slip
        tr.slip.expect = 'diag';
      } else if (!closeSlip(ctx, tr)) {
        return null;
      }
      enterHex(ctx, tr);
      return tr;
    }
    case 'slipLeft':
    case 'slipRight': {
      if (ctx.slipLevel === 0 || tr.budget < 1) return null;
      const dir = step === 'slipLeft' ? 'L' : 'R';
      if (tr.slip && tr.slip.expect === 'straight') return null;
      if (tr.slip && tr.slip.dir === dir) {
        tr.slip.len += 1;
        tr.slip.expect = ctx.slipLevel === 1 ? 'straight' : 'diag';
      } else {
        if (!closeSlip(ctx, tr)) return null;
        tr.slip = { dir, len: 1, expect: ctx.slipLevel === 1 ? 'straight' : 'diag' };
      }
      enterHex(ctx, tr);
      return tr;
    }
    case 'turnLeft':
    case 'turnRight': {
      if (ctx.speed === 0) return tr; // speed 0 turns freely (Rules: Planning)
      if (ctx.turnNumber > ctx.speed || tr.credits < 1) return null; // the ship has to fly its turn number before it may turn
      if (!closeSlip(ctx, tr)) return null;
      tr.credits -= 1;
      tr.fwdSinceTurn = 0;
      return tr;
    }
    case 'halfLoop': {
      if (ctx.speed < 1 || tr.loopsDone >= ctx.loopLevel) return null;
      if (ctx.turnNumber > ctx.speed || tr.budget < 1) return null; // a half loop needs a run-up
      if (tr.fwdSinceLoop < loopRunUp(ctx)) return null;
      if (!closeSlip(ctx, tr)) return null;
      tr.budget -= 1; // expends one hex of movement without moving
      tr.loopsDone += 1;
      tr.fwdSinceLoop = 0;
      tr.fwdSinceTurn = 0;
      tr.credits = 0;
      return tr;
    }
    case 'snapFire': {
      // Not from the hex where movement begins or ends (Rules: Movement)
      if (ctx.snapLevel === 0 || tr.snapsDone >= ctx.snapLevel || (tr.snapsDone > 0 && !tr.movedSinceSnap) || tr.hexesMoved < 1 || tr.budget < 1) return null;
      tr.snapsDone += 1;
      tr.movedSinceSnap = false;
      return tr;
    }
  }
}

/** Is the move complete and legal as it stands? */
export function isTrackerComplete(ctx: MoveContext, tr: MoveTracker): boolean {
  if (tr.budget !== 0) return false;
  if (tr.snapsDone > 0 && !tr.movedSinceSnap) return false;
  const slips = tr.slipsDone + (tr.slip && tr.slip.len >= minSlipLength(ctx) ? 1 : 0);
  if (tr.slip && tr.slip.len < minSlipLength(ctx)) return false;
  if (ctx.slipRequired && slips < 1) return false;
  if (tr.loopsDone < ctx.loopsRequired) return false;
  return true;
}

const SEARCH_STEPS: MoveStep[] = ['forward', 'turnLeft', 'turnRight', 'slipLeft', 'slipRight', 'halfLoop'];

/** A string identifying everything about a tracker that affects what it may do next. */
export function trackerKey(tr: MoveTracker): string {
  const s = tr.slip ? `${tr.slip.dir}${Math.min(tr.slip.len, 99)}${tr.slip.expect[0]}` : '-';
  return [tr.budget, tr.fwdSinceTurn, tr.credits, tr.fwdSinceLoop, tr.loopsDone, Math.min(tr.slipsDone, 1), s, Math.min(tr.snapsDone, 3), tr.movedSinceSnap ? 1 : 0].join('|');
}

/** Can the ship still finish a legal move from here? Memoised depth-first search. */
export function canComplete(ctx: MoveContext, tr: MoveTracker, memo = new Map<string, boolean>()): boolean {
  if (ctx.speed === 0) return true;
  const k = trackerKey(tr);
  const cached = memo.get(k);
  if (cached !== undefined) return cached;
  memo.set(k, false); // guards against cycles
  let ok = isTrackerComplete(ctx, tr);
  if (!ok) {
    for (const step of SEARCH_STEPS) {
      const next = stepTracker(ctx, tr, step);
      if (next && canComplete(ctx, next, memo)) {
        ok = true;
        break;
      }
    }
  }
  memo.set(k, ok);
  return ok;
}

/** Steps that are legal now and still leave a way to finish (includes snap fire, which needs the caller to supply shots). */
export function legalSteps(ctx: MoveContext, tr: MoveTracker): MoveStep[] {
  if (ctx.speed === 0) return ['turnLeft', 'turnRight'];
  const memo = new Map<string, boolean>();
  return MOVE_STEPS.filter((step) => {
    const next = stepTracker(ctx, tr, step);
    return next !== null && canComplete(ctx, next, memo);
  });
}

/**
 * Drop the slip and half-loop obligations when no legal move can satisfy them together
 * (for example, a slow ship that is both slipping and looping).
 */
export function withFeasibleObligations(ctx: MoveContext): { ctx: MoveContext; waived: string[] } {
  const attempts: [boolean, number][] = [
    [ctx.slipRequired, ctx.loopsRequired],
    [ctx.slipRequired, 0],
    [false, ctx.loopsRequired],
    [false, 0],
  ];
  for (const [slipRequired, loopsRequired] of attempts) {
    const candidate = { ...ctx, slipRequired, loopsRequired };
    if (canComplete(candidate, startTracker(candidate))) {
      const waived: string[] = [];
      if (ctx.slipRequired && !slipRequired) waived.push('slip');
      if (ctx.loopsRequired > loopsRequired) waived.push('halfLoop');
      return { ctx: candidate, waived };
    }
  }
  return { ctx: { ...ctx, slipRequired: false, loopsRequired: 0 }, waived: ['slip', 'halfLoop'] };
}

/** Hex and facing after a step (Rules: Movement). Snap fire does not move the ship. */
export function applyStepToPosition(
  pos: Hex,
  facing: Facing,
  step: MoveStep,
): { pos: Hex; facing: Facing } {
  switch (step) {
    case 'forward': return { pos: neighbor(pos, facing), facing };
    case 'slipLeft': return { pos: neighbor(pos, facing - 1), facing };
    case 'slipRight': return { pos: neighbor(pos, facing + 1), facing };
    case 'turnLeft': return { pos, facing: turnFacing(facing, -1) };
    case 'turnRight': return { pos, facing: turnFacing(facing, 1) };
    case 'halfLoop': return { pos, facing: turnFacing(facing, 3) };
    case 'snapFire': return { pos, facing };
  }
}

// ---- Game-map geometry (Rules: The map) ----

/**
 * The printed map is only a window onto open space: when a ship leaves it, the rules shift every
 * counter back so play can go on (Rules: The map). An `open` map does the same without moving anything:
 * space has no edges, and a ship escapes only when the fleet would no longer fit on the printed
 * board (see `exceedsOpenLimits`). A `static` map has real edges (Rules: The map).
 */
export interface MapSpec {
  /** Columns of the printed board (ids 10..42 across the width). */
  cols: number;
  /** Rows per column (ids 00..44). */
  rows: number;
  mode: 'open' | 'static';
}

/** The printed game-map: ids run 1000 to 4244 (column 10-42, row 00-44). */
export const STANDARD_MAP: MapSpec = { cols: 33, rows: 45, mode: 'open' };

/** The map of a game with capital ships: half as big again in each direction, because they take so much room (the ones here are far bigger than the board game's). */
export const LARGE_MAP: MapSpec = { cols: 50, rows: 68, mode: 'open' };

/** Is this the printed map's size (and so one that a capital ship makes larger)? */
export const isStandardSize = (map: MapSpec): boolean => map.cols === STANDARD_MAP.cols && map.rows === STANDARD_MAP.rows;

/**
 * A ship leaves the printed map at an edge and the counters shift back five hexes. That is only
 * possible if every other counter then still fits, so the fleet may be at most this much narrower
 * than the board.
 */
const SHIFT_ALLOWANCE = 4;

export function toOffset(h: Hex): { col: number; row: number } {
  return { col: h.q, row: h.r + (h.q - (h.q & 1)) / 2 };
}

export function fromOffset(col: number, row: number): Hex {
  return { q: col, r: row - (col - (col & 1)) / 2 };
}

export function isOnMap(map: MapSpec, h: Hex): boolean {
  const { col, row } = toOffset(h);
  return col >= 0 && col < map.cols && row >= 0 && row < map.rows;
}

/** Hex id in the printed style, such as "1001" (column 10, row 01). Open space continues the numbering. */
export function hexId(h: Hex): string {
  const { col, row } = toOffset(h);
  const part = (n: number): string => (n < 0 ? `-${String(-n).padStart(2, '0')}` : String(n).padStart(2, '0'));
  return `${part(10 + col)}${part(row)}`;
}

/** Offset-coordinate extent of a set of hexes. */
export function extentOf(hexes: Hex[]): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const h of hexes) {
    const { col, row } = toOffset(h);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }
  return { minCol, maxCol, minRow, maxRow };
}

/** How many hexes of room the fleet still has before the open-map escape rule applies; negative once it is exceeded. */
export function openMapSlack(map: MapSpec, hexes: Hex[]): number {
  if (hexes.length === 0) return Infinity;
  const e = extentOf(hexes);
  const width = e.maxCol - e.minCol + 1;
  const height = e.maxRow - e.minRow + 1;
  return Math.min(map.cols - SHIFT_ALLOWANCE - width, map.rows - SHIFT_ALLOWANCE - height);
}

/** Would a fleet occupying these hexes be too spread out for the map (Rules: The map)? */
export function exceedsOpenLimits(map: MapSpec, hexes: Hex[]): boolean {
  return openMapSlack(map, hexes) < 0;
}

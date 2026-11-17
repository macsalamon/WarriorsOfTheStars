import type { FlightPose } from '../ui/playback';

/*
 * A move flown as one curve (the 3D board). The playback asks a board to glide a ship step by step: a hex forward, a turn of 60 degrees in
 * the hex, and so on. Here the whole move is laid out first as a smooth path: straight from the middle of a hex to the middle of the next
 * where the ship flies straight on, and round the corner where it turns in a hex. The corner is cut a little, on the inside, as a
 * pilot would fly it: the path runs from half way into the hex to half way out of it in one bend, and passes close by the middle of the
 * hex instead of through it. No drawing here, only where the ship is and how it points: this part can be tested.
 */

interface Point {
  x: number;
  y: number;
}

/**
 * The path from one hex (`from`) to the next (`to`), flown in two halves. The first leaves `from`: round its corner when the ship came
 * there from `before`, otherwise straight, the nose coming round from `startAngle` (the way the ship faced when it set off). The second
 * arrives: round the corner of the hex when the ship flies on to `after`, otherwise straight, the nose coming round to `endAngle` (the way
 * the ship faces at the end).
 */
interface Curve {
  from: Point;
  to: FlightPose;
  before: Point | null;
  after: Point | null;
  startAngle: number | null;
  endAngle: number | null;
  /**
   * How far off its nose the ship flies on this curve, in degrees: 0 flying forward, 60 to one side in a slide (to the right is
   * positive); and the same for the curves before and after it, which the bends lead over from and to.
   */
  slide: number;
  slideBefore: number;
  slideAfter: number;
}

/** How much of a slide the nose gives way to: the ship keeps pointing nearly the way it faces and drifts sideways. */
const SLIDE_YAW = 0.15;

/** How far off its nose the ship is flying at a moment of a curve, in degrees. */
function sliding(c: Curve, t: number): number {
  if (t < 0.5 && c.before) return c.slideBefore + (c.slide - c.slideBefore) * (0.5 + t);
  if (t >= 0.5 && c.after) return c.slide + (c.slideAfter - c.slide) * (t - 0.5);
  return c.slide;
}

/** A part of a curve, from one moment of it to a later one (0 to 1). */
interface Piece {
  curve: Curve;
  t0: number;
  t1: number;
}

/**
 * One step of a move that has been laid out: a leg of the path from one hex to the next, a turn the path has already made on the way, or
 * a turn made on the spot (around a half loop).
 *
 * A leg ends where the ship stops for what happens in its hex. That is the middle of the hex, except in a hex where the ship turns and
 * fires a snap shot: there it stops at the point of the bend where its nose points best at the target, which may be a little before the
 * middle or after it. So a leg can be made of parts of up to three curves. `dip` marks the leg into a half loop (the ship sinks a little
 * for it), `spin` the part of a barrel roll flown on this leg (from and to, in whole turns).
 */
export type FlightStep =
  | { kind: 'leg'; pose: FlightPose; pieces: Piece[]; dip: boolean; spin: [number, number] | null }
  | { kind: 'absorbed' | 'spot'; pose: FlightPose };

export type FlightLeg = Extract<FlightStep, { kind: 'leg' }>;

const half = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** The angle of the board (degrees, clockwise from up the map, where y grows down the map) of a direction, the one nearest to `like`. */
const angleOf = (dx: number, dy: number, like: number): number => {
  const raw = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return raw + Math.round((like - raw) / 360) * 360;
};

/** The bend through the hex `corner` (from half way from `a` to half way to `b`), at u from 0 to 1: the point, and the way the path runs there. */
function bend(a: Point, corner: Point, b: Point, u: number): { at: Point; dx: number; dy: number } {
  const p0 = half(a, corner);
  const p2 = half(corner, b);
  const v = 1 - u;
  return {
    at: { x: v * v * p0.x + 2 * v * u * corner.x + u * u * p2.x, y: v * v * p0.y + 2 * v * u * corner.y + u * u * p2.y },
    dx: v * (corner.x - p0.x) + u * (p2.x - corner.x),
    dy: v * (corner.y - p0.y) + u * (p2.y - corner.y),
  };
}

/** Where the ship is at a moment of a curve (t from 0 to 1), and the way its path runs there. */
function along(c: Curve, t: number): { at: Point; dx: number; dy: number } {
  const dx = c.to.x - c.from.x;
  const dy = c.to.y - c.from.y;
  if (t < 0.5 && c.before) return bend(c.before, c.from, c.to, 0.5 + t);
  if (t >= 0.5 && c.after) return bend(c.from, c.to, c.after, t - 0.5);
  return { at: { x: c.from.x + dx * t, y: c.from.y + dy * t }, dx, dy };
}

/**
 * The way the ship points at a moment of a curve, as an angle of the board near the angle of its pose (angles run past 360): along its
 * path (in a slide: nearly the way it faces, the path running off to the side), except that it sets off the way it faced and ends the way
 * it is to face, coming round in the half leg after or before.
 */
function pointing(c: Curve, t: number): number {
  const path = along(c, t);
  let angle = angleOf(path.dx, path.dy, c.to.angle + c.slide) - sliding(c, t) * (1 - SLIDE_YAW);
  if (t < 0.5 && c.startAngle !== null) angle += (c.startAngle - angle) * (1 - smooth(t / 0.5));
  if (t >= 0.5 && c.endAngle !== null) angle += (c.endAngle - angle) * smooth((t - 0.5) / 0.5);
  return angle;
}

/**
 * Lays a move out: `start` is where the ship is and how it is turned, `poses` where it is and how it is turned after each step (with what
 * it fires at there, if it does). `rolls` is how many barrel rolls the ship flies on the way. Returns one flight step for each pose, or
 * null for a ship that does not leave its hex (it turns on the spot, as it always did).
 */
export function planFlight(start: FlightPose, poses: FlightPose[], rolls = 0): FlightStep[] | null {
  // the hexes the move passes through, each with the way the ship faces coming in and going out
  const stops: { x: number; y: number; angleIn: number; angleOut: number; loop: boolean; aim: Point | null }[] = [{ x: start.x, y: start.y, angleIn: start.angle, angleOut: start.angle, loop: false, aim: null }];
  const turnsOnly: boolean[] = [];
  const stopOf: number[] = [];
  let angle = start.angle;
  for (const pose of poses) {
    const here = stops[stops.length - 1]!;
    const still = Math.hypot(pose.x - here.x, pose.y - here.y) < 0.01;
    if (still) {
      if (Math.abs(pose.angle - angle) >= 179) here.loop = true;
      here.angleOut = pose.angle;
      here.aim ??= pose.aim ?? null;
    } else stops.push({ x: pose.x, y: pose.y, angleIn: pose.angle, angleOut: pose.angle, loop: false, aim: pose.aim ?? null });
    turnsOnly.push(still);
    stopOf.push(stops.length - 1);
    angle = pose.angle;
  }
  if (stops.length < 2) return null;
  // the path bends through a hex the ship flies on from; it runs straight to and from the two ends of the move and a half loop
  const bends = (i: number): boolean => i > 0 && i < stops.length - 1 && !stops[i]!.loop;
  // how far off the nose the leg to each stop is flown: a slide runs 60 degrees to one side of the way the ship faces
  const slides = stops.map((to, i) => (i === 0 ? 0 : angleOf(to.x - stops[i - 1]!.x, to.y - stops[i - 1]!.y, to.angleIn) - to.angleIn));
  // curves[i] leads to stop i
  const curves: (Curve | null)[] = stops.map((to, i) => {
    if (i === 0) return null;
    const from = stops[i - 1]!;
    return {
      slide: slides[i]!,
      slideBefore: slides[i - 1] ?? 0,
      slideAfter: slides[i + 1] ?? 0,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y, angle: to.angleIn },
      before: bends(i - 1) ? { x: stops[i - 2]!.x, y: stops[i - 2]!.y } : null,
      after: bends(i) ? { x: stops[i + 1]!.x, y: stops[i + 1]!.y } : null,
      // around a half loop the turns are made on the spot: the ship leaves it, and comes to it, facing along the leg
      startAngle: bends(i - 1) ? null : from.loop ? from.angleOut : from.angleIn,
      endAngle: bends(i) ? null : to.loop ? to.angleIn : to.angleOut,
    };
  });
  // where the ship stops in each hex, measured in legs from the middle of the hex: before it (negative) or after it
  const shift = stops.map((stop, i) => {
    if (!stop.aim || !bends(i)) return 0;
    let best = 0;
    let bestOff = Infinity;
    for (let d = -0.4; d <= 0.4001; d += 0.05) {
      const c = d < 0 ? curves[i]! : curves[i + 1]!;
      const t = d < 0 ? 1 + d : d;
      const at = along(c, t).at;
      const nose = pointing(c, t);
      const off = Math.abs(angleOf(stop.aim.x - at.x, stop.aim.y - at.y, nose) - nose) + Math.abs(d) * 2;
      if (off < bestOff - 1e-9) {
        bestOff = off;
        best = d;
      }
    }
    return Math.abs(best) < 0.03 ? 0 : best;
  });
  const steps = poses.map((pose, i): FlightStep => {
    const at = stopOf[i]!;
    if (turnsOnly[i]) return { kind: stops[at]!.loop ? 'spot' : 'absorbed', pose };
    const before = shift[at - 1]!;
    const here = shift[at]!;
    const pieces: Piece[] = [];
    if (before < 0) pieces.push({ curve: curves[at - 1]!, t0: 1 + before, t1: 1 });
    pieces.push({ curve: curves[at]!, t0: Math.max(0, before), t1: 1 + Math.min(0, here) });
    if (here > 0) pieces.push({ curve: curves[at + 1]!, t0: 0, t1: here });
    return { kind: 'leg', pose, pieces, dip: stops[at]!.loop, spin: null };
  });
    // a roll is flown in one go, on a stretch of legs that no half loop breaks, and it needs a hex of its own: a ship that planned more rolls than
  // it has free hexes to fly them in shows only as many as fit (none, when its only hex is the one it loops in). The longest stretch is
  // filled first; there a roll is spread over two legs when there is room
  const stretches: FlightLeg[][] = [[]];
  for (const step of steps) {
    if (step.kind === 'leg' && !step.dip) stretches[stretches.length - 1]!.push(step);
    else if (step.kind !== 'absorbed') stretches.push([]);
  }
  let left = rolls;
  for (const stage of [...stretches].sort((p, q) => q.length - p.length)) {
    const here = Math.min(left, stage.length);
    if (here <= 0) break;
    left -= here;
    const count = Math.min(stage.length, here * 2);
    const first = Math.floor((stage.length - count) / 2);
    for (let k = 0; k < count; k++) stage[first + k]!.spin = [(k * here) / count, ((k + 1) * here) / count];
  }
  return steps;
}

/** Which piece of a leg a moment of it (t from 0 to 1) is in, and the moment of that piece's curve. */
function locate(leg: FlightLeg, t: number): { curve: Curve; t: number } {
  const total = legLength(leg);
  let left = Math.min(1, Math.max(0, t)) * total;
  for (const piece of leg.pieces) {
    const span = piece.t1 - piece.t0;
    if (left <= span + 1e-9) return { curve: piece.curve, t: piece.t0 + left };
    left -= span;
  }
  const last = leg.pieces[leg.pieces.length - 1]!;
  return { curve: last.curve, t: last.t1 };
}

/** How long a leg is, in legs from the middle of a hex to the middle of the next: 1, or a little less or more where the ship stops off the middle. */
export function legLength(leg: FlightLeg): number {
  return leg.pieces.reduce((sum, p) => sum + (p.t1 - p.t0), 0);
}

/** Where the ship is at a moment of a leg (t from 0 to 1). */
export function legPoint(leg: FlightLeg, t: number): Point {
  const at = locate(leg, t);
  return along(at.curve, at.t).at;
}

/** How far off its nose the ship is flying at a moment of a leg, in degrees (to the right is positive): it leans that way. */
export function legSlide(leg: FlightLeg, t: number): number {
  const at = locate(leg, t);
  return sliding(at.curve, at.t);
}

/** The way the ship points at a moment of a leg, as an angle of the board, the one nearest to `like` (angles run past 360). */
export function legAngle(leg: FlightLeg, t: number, like: number): number {
  const at = locate(leg, t);
  const angle = pointing(at.curve, at.t);
  return angle + Math.round((like - angle) / 360) * 360;
}

/*
 * Squadron markings for the ship pictures. The models are grey; these rules colour parts of them as the canon squadrons did.
 * A rule looks at every triangle of the model (which part it belongs to and where its centre is, in the ship's own coordinates:
 * nose along +Z, top along +Y, +X the ship's left) and returns the colour it is to be painted, or nothing to leave it as it is.
 * The colour multiplies the texture, so the wear and the panel lines of the original show through. `texture` can also change the texture
 * itself, for markings that are part of the picture.
 */

export const RED = [0.9, 0.1, 0.08];
export const GOLD = [1.0, 0.76, 0.12];
export const GREEN = [0.16, 0.72, 0.24];
export const BLUE = [0.16, 0.36, 0.95];

/**
 * Triangle rules by the ship of the game. A rule gets, for one triangle: `part` (the model's sub-object), `c` (its centre), `n` (the way it
 * faces) and `rel` (how far from the middle it lies across its part, 0 on the centre line, 1 at the widest point of the part at that
 * length). The colour it returns multiplies the texture.
 */
const up = (t) => t.n[1] > 0.45;
const YELLOW = [0.95, 0.72, 0.18];
const BLACKISH = [0.2, 0.2, 0.23];

/** Where Gold Squadron's Y-wing is gold: the top of the nose section, and a thin ring on the front of each engine. */
const goldMarks = (t) => (t.part === 'detail0' && t.c[2] > 3.0 && up(t) && t.rel < 0.72 && t.c[1] < 0.7) || (/^Engine/.test(t.part) && t.c[2] > 0.85 && t.c[2] < 1.2);

export const PAINT = {
  // Red Squadron: red blocks on the wings, a thin red ring on each engine, and red strips along both edges of the nose
  'x-wing': {
    triangle: (t) => {
      if (/^Wing/.test(t.part) && Math.abs(t.c[0]) > 3.1 && Math.abs(t.c[0]) < 4.5 && t.c[2] > -1.8 && t.c[2] < 0.7 && Math.abs(t.n[1]) > 0.4) return RED;
      if (/^Engine/.test(t.part) && t.c[2] > -0.1 && t.c[2] < 0.5) return RED;
      if (t.part === 'detail0' && t.c[2] > 1.5 && up(t) && t.rel > 0.62) return RED;
      return null;
    },
  },
  // Gold Squadron: gold on the nose and a thin gold ring on the engines; the two-seater has near-black in the same places
  'y-wing': { triangle: (t) => (goldMarks(t) ? GOLD : null) },
  'y-wing-2seat': { triangle: (t) => (goldMarks(t) ? BLACKISH : null) },
  // Green Squadron: green on the top of the hull round the cockpit, a yellow patch on each wing near the back
  'a-wing': {
    triangle: (t) => {
      if (t.part === 'detail0' && ((t.c[1] > 0.3 && t.rel < 0.6) || (t.c[2] > 2.0 && t.n[1] > 0.2 && t.rel < 0.85))) return GREEN;
      if (t.part === 'detail0' && up(t) && t.rel > 0.6 && t.c[2] > -0.4 && t.c[2] < 0.9) return YELLOW;
      return null;
    },
  },
  // Blue Squadron: blue wing tips and a blue band on the cockpit; the red roundels of the texture stay red
  'b-wing': {
    triangle: (t) => {
      if (/^Wing/.test(t.part) && Math.abs(t.c[0]) > 3.9) return BLUE;
      if (t.part === 'CockpitA' && t.c[1] > 3.3 && t.c[1] < 3.8) return BLUE;
      return null;
    },
  },
};

/**
 * The B-wing as it flies on the board: the whole cross of the ship lies on its side while the cockpit pod stays upright, the cross turning
 * round the pod (in the films the ship rolls about the pod). The pod is turned back about the line of flight, through its own middle, by
 * as much as the picture turns the whole ship (see `orient` in ships.js). Parts to turn: sub-object, a point on the axis, the axis and the angle.
 */
export const POSE = {
  'b-wing-side': { part: 'CockpitA', pivot: [0, 3.9, 0], axis: 'z', degrees: -90 },
};
PAINT['b-wing-side'] = PAINT['b-wing'];

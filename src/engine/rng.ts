/** Seeded random source so games and tests are reproducible. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

/** mulberry32: small, fast, good enough for dice. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** An Rng whose state lives in a plain object, so a game can be cloned and serialised. */
export function stateRng(holder: { rngState: number }): Rng {
  return {
    next() {
      holder.rngState = (holder.rngState + 0x6d2b79f5) >>> 0;
      let t = holder.rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function rollDie(rng: Rng): number {
  return 1 + Math.floor(rng.next() * 6);
}

export function rollDice(rng: Rng, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += rollDie(rng);
  return total;
}

export function roll2d6(rng: Rng): number {
  return rollDice(rng, 2);
}

/** A scripted RNG for tests: yields the given die faces in order. */
export function scriptedRng(faces: number[]): Rng {
  let i = 0;
  return {
    next() {
      const face = faces[i++];
      if (face === undefined) throw new Error('scriptedRng exhausted');
      return (face - 1) / 6 + 1e-9;
    },
  };
}

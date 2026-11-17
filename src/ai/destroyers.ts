import {
  PILOT,
  activeShips,
  applyStepToPosition,
  arcOf,
  chanceAtLeast,
  capitalTargetsOf,
  currentDestroyer,
  destroyerById,
  hexesOf,
  structureLeft,
  destroyerHexInReach,
  capitalNose,
  destroyerHexes,
  destroyerShields,
  specOf,
  destroyerLegalSteps,
  destroyerMoveComplete,
  destroyerSpeedChoices,
  destroyerSpeedNow,
  destroyerThreat,
  destroyersOf,
  hexDistance,
  hexEquals,
  isOnMap,
  nearestHexOf,
  pilotAvailableGuns,
  previewDestroyerShot,
  toOffset,
  type Command,
  type Destroyer,
  type Facing,
  type GameState,
  type Hex,
  type MoveStep,
  type PlayerId,
  type Rng,
  type Ship,
  type ShotOrder,
} from '../engine';

/** The Star Destroyer's side of the computer players: where it is placed, where it moves, how fighters shoot at it and keep out of its way. */

/** How the computer fighters weigh a Star Destroyer: its fire against the pull to fly in at range 3 and shoot at it. */
export const SD_TUNING = { threat: 0.2, pull: 2, offence: 3 };

const hexKey = (h: Hex): string => `${h.q},${h.r}`;

/** The chance that 2d6 comes to at least `target`. */
function atLeast(target: number): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= target) n += 1;
  return n / 36;
}

/** The direction (a facing) that points from `from` toward `to`. */
export function facingToward(from: Hex, to: Hex): Facing {
  let best: Facing = 0;
  let bestDistance = Infinity;
  for (let f = 0; f < 6; f++) {
    const probe = applyStepToPosition(from, f as Facing, 'forward').pos;
    const d = hexDistance(probe, to);
    if (d < bestDistance) {
      bestDistance = d;
      best = f as Facing;
    }
  }
  return best;
}

/**
 * Where the Star Destroyers of a side that are not on the map yet are put: all eight hexes in the set-up area, near the middle of it, nose toward the enemy.
 * `free` are the hexes of the area still open; the result also says which hexes the Star Destroyers fill, so the fighters keep out of them.
 */
export function destroyerPlacements(game: GameState, player: PlayerId, free: Hex[]): { placements: { shipId: string; pos: Hex; facing: Facing }[]; used: Set<string> } {
  const used = new Set<string>();
  const placements: { shipId: string; pos: Hex; facing: Facing }[] = [];
  const open = new Set(free.map(hexKey));
  const enemyZone = game.zones[player === 0 ? 1 : 0];
  const target = enemyZone[Math.floor(enemyZone.length / 2)] ?? { q: 0, r: 0 };
  const centre = free[Math.floor(free.length / 2)] ?? { q: 0, r: 0 };
  for (const d of destroyersOf(game, player).filter((x) => x.pos === null)) {
    const facings: Facing[] = [facingToward(centre, target), 0, 3, 1, 2, 4, 5];
    let best: { pos: Hex; facing: Facing; score: number } | null = null;
    for (const facing of facings) {
      for (const h of free) {
        if (used.has(hexKey(h))) continue;
        const hexes = destroyerHexes(h, facing, specOf(d).kind);
        if (!hexes.every((x) => open.has(hexKey(x)) && !used.has(hexKey(x)))) continue;
        // near the middle of the area, as far toward the enemy as the shape allows, and away from the Star Destroyers already placed
        const score = -hexDistance(h, centre) + (facing === facings[0] ? 4 : 0) + placements.reduce((sum, p) => sum + Math.min(6, hexDistance(p.pos, h)) * 0.5, 0);
        if (!best || score > best.score) best = { pos: h, facing, score };
      }
    }
    if (!best) continue;
    placements.push({ shipId: d.id, pos: best.pos, facing: best.facing });
    for (const x of destroyerHexes(best.pos, best.facing, specOf(d).kind)) used.add(hexKey(x));
  }
  return { placements, used };
}

// ------------------------------------------------------------ the Star Destroyer's own move

/** How good it is for the Star Destroyer to end its move here: the fighters in reach of its guns, not too near the edge, and not pointing at the wall. */
function evaluateDestroyerEnd(game: GameState, d: Destroyer, pos: Hex, facing: Facing): number {
  const hexes = destroyerHexes(pos, facing, specOf(d).kind);
  let score = 0;
  const enemies = activeShips(game, d.owner === 0 ? 1 : 0).filter((s) => s.pos);
  for (const e of enemies) {
    const dist = Math.min(...hexes.map((h) => hexDistance(h, e.pos!)));
    if (dist <= 10) score += (11 - dist) * 0.5;
    // a target straight ahead is shot at with a worse roll
    const nose = capitalNose(pos, facing, specOf(d).kind);
    if (!hexEquals(nose, e.pos!) && arcOf(nose, facing, e.pos!) === 'FC') score -= 0.3;
  }
  const nearest = enemies.length > 0 ? Math.min(...enemies.map((e) => Math.min(...hexes.map((h) => hexDistance(h, e.pos!))))) : null;
  if (nearest !== null) score -= nearest * 0.15;
  for (const other of destroyersOf(game, d.owner === 0 ? 1 : 0)) {
    if (!other.pos || other.exploded) continue;
    score -= Math.min(...hexes.map((h) => nearestHexOf(other, h)!.distance)) * 0.12;
  }
  if (game.map.mode === 'static') {
    // it cannot turn quickly: do not drive it into the wall
    const ahead = pos;
    let p = ahead;
    for (let i = 0; i < 5; i++) p = applyStepToPosition(p, facing, 'forward').pos;
    if (!isOnMap(game.map, p)) score -= 3;
    for (const h of hexes) {
      const { col, row } = toOffset(h);
      const edge = Math.min(col, row, game.map.cols - 1 - col, game.map.rows - 1 - row);
      if (edge < 3) score -= (3 - edge) * 0.4;
    }
  }
  return score;
}

/** The Star Destroyer's move: at each speed it may take, every legal way to spend the hexes, the end with the best score. */
export function destroyerMove(game: GameState, d: Destroyer, rng: Rng): { steps: MoveStep[]; speed: number } {
  let best: { steps: MoveStep[]; speed: number; score: number } | null = null;
  const now = destroyerSpeedNow(d);
  const consider = (steps: MoveStep[], speed: number, pos: Hex, facing: Facing): void => {
    const score = evaluateDestroyerEnd(game, d, pos, facing) - Math.abs(speed - now) * 0.05 + rng.next() * 0.01;
    if (!best || score > best.score) best = { steps, speed, score };
  };
  for (const speed of destroyerSpeedChoices(d)) {
    if (speed === 0) {
      // standing still it turns freely: a few turns are enough to choose from
      for (const turns of [[], ['turnLeft'], ['turnRight'], ['turnLeft', 'turnLeft'], ['turnRight', 'turnRight'], ['turnLeft', 'turnLeft', 'turnLeft']] as MoveStep[][]) {
        let facing = d.facing;
        for (const t of turns) facing = applyStepToPosition(d.pos!, facing, t).facing;
        consider(turns, 0, d.pos!, facing);
      }
      continue;
    }
    const go = (taken: MoveStep[], pos: Hex, facing: Facing): void => {
      if (destroyerMoveComplete(game, d.id, taken, speed)) {
        consider(taken, speed, pos, facing);
        return;
      }
      for (const step of destroyerLegalSteps(game, d.id, taken, speed)) {
        const moved = applyStepToPosition(pos, facing, step);
        go([...taken, step], moved.pos, moved.facing);
      }
    };
    go([], d.pos!, d.facing);
  }
  const chosen = best as { steps: MoveStep[]; speed: number } | null;
  return chosen ? { steps: chosen.steps, speed: chosen.speed } : { steps: [], speed: now };
}

/**
 * The target a capital ship of this side picks when there is a choice: the enemy capital ship that is nearest to being finished (the fewest structure points left),
 * and of those the nearest. The random player (for the tests) picks any.
 */
export function capitalTargetCommand(game: GameState, player: PlayerId, rng: Rng, random = false): Command | null {
  const id = game.capitalTargets?.asking[0];
  const d = id ? destroyerById(game, id) : undefined;
  if (!d || d.owner !== player) return null;
  const choices = capitalTargetsOf(game, d);
  if (choices.length === 0) return null;
  const score = (t: Destroyer): number => -structureLeft(t) - 0.05 * Math.min(...hexesOf(d).map((h) => nearestHexOf(t, h)!.distance));
  const target = random ? choices[Math.floor(rng.next() * choices.length)]! : [...choices].sort((a, b) => score(b) - score(a))[0]!;
  return { type: 'targetCapital', player, id: d.id, target: target.id };
}

/** The command a computer player gives when it is the turn of one of its Star Destroyers. */
export function destroyerCommand(game: GameState, player: PlayerId, rng: Rng): Command | null {
  const pick = capitalTargetCommand(game, player, rng);
  if (pick) return pick;
  const d = currentDestroyer(game);
  if (!d || d.owner !== player) return null;
  const move = destroyerMove(game, d, rng);
  return { type: 'moveDestroyer', player, id: d.id, steps: move.steps, speed: move.speed };
}

// ------------------------------------------------------------ fighters against Star Destroyers

/** How much one hit on the Star Destroyer is worth: the chance that it does the two body points that cost a structure point. */
function structureChance(power: number, d: Destroyer): number {
  const shields = destroyerShields(d);
  return atLeast(10 - (power - shields));
}

/** The best way to fire a fighter's guns at a Star Destroyer from where it stands (or at `pos`), and its worth. */
export function volleyAtDestroyer(game: GameState, shooter: Ship, d: Destroyer): { value: number; shots: ShotOrder[] } {
  const none = { value: 0, shots: [] as ShotOrder[] };
  if (!shooter.pos || d.pos === null || d.exploded) return none;
  const guns = pilotAvailableGuns(shooter)
    .map((gun) => ({ gun, hex: destroyerHexInReach(game, shooter, gun, PILOT, d) }))
    .filter((g): g is { gun: number; hex: Hex } => g.hex !== null);
  if (guns.length === 0) return none;
  let best = none;
  for (let k = 1; k <= guns.length; k++) {
    const scored = guns
      .map(({ gun, hex }) => {
        const preview = previewDestroyerShot(game, shooter, gun, d, hex);
        const value = preview.ion ? 0 : chanceAtLeast(shooter.gunnerySkill, k - 1, preview.difficulty) * (0.2 + 4 * structureChance(preview.power, d));
        return { gun, value };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, k);
    const total = scored.reduce((sum, s) => sum + s.value, 0);
    if (total > best.value) best = { value: total, shots: scored.map((s) => ({ gun: s.gun, target: d.id })) };
  }
  return best;
}

/** The best shots at any Star Destroyer in reach, for the choice of the target in the Fire Segment. */
export function bestDestroyerVolley(game: GameState, shooter: Ship): { value: number; shots: ShotOrder[] } {
  let best = { value: 0, shots: [] as ShotOrder[] };
  for (const d of destroyersOf(game, shooter.owner === 0 ? 1 : 0)) {
    const volley = volleyAtDestroyer(game, shooter, d);
    if (volley.value > best.value) best = volley;
  }
  return best;
}

/** What a place is worth next to enemy Star Destroyers: the shot at one from here, its fire at us, and the wish to fly at about range 3 from it. */
export function destroyerTerms(game: GameState, probe: Ship): { offence: number; score: number } {
  if (!probe.pos) return { offence: 0, score: 0 };
  const enemies = destroyersOf(game, probe.owner === 0 ? 1 : 0).filter((d) => d.pos !== null && !d.exploded);
  if (enemies.length === 0) return { offence: 0, score: 0 };
  let offence = 0;
  let score = -destroyerThreat(game, probe) * SD_TUNING.threat;
  for (const d of enemies) {
    offence = Math.max(offence, volleyAtDestroyer(game, probe, d).value * SD_TUNING.offence);
    const near = nearestHexOf(d, probe.pos);
    // a fighter that is not in reach of its guns closes in on a Star Destroyer that can still be hurt; one that is dead in space is only worth a visit
    if (near && d.lost < specOf(d).deadAt) score -= Math.abs(near.distance - 3) * SD_TUNING.pull;
  }
  return { offence, score };
}

/** A legal, random move for a Star Destroyer, at a random speed it may take: for the random player of the tests. */
export function randomDestroyerSteps(game: GameState, d: Destroyer, rng: Rng): { steps: MoveStep[]; speed: number } {
  const choices = destroyerSpeedChoices(d);
  const speed = choices[Math.floor(rng.next() * choices.length)]!;
  const taken: MoveStep[] = [];
  while (!destroyerMoveComplete(game, d.id, taken, speed)) {
    const legal = destroyerLegalSteps(game, d.id, taken, speed);
    if (legal.length === 0) break;
    taken.push(legal[Math.floor(rng.next() * legal.length)]!);
  }
  return { steps: taken, speed };
}

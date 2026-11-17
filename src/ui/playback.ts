import { applyStepToPosition, isDestroyerTarget, isEmplacementTarget, shipById, typeOf, type Command, type GameEvent, type GameState, type Hex, type ShotRecord } from '../engine';
import { easeInOut, tween } from './anim';
import { hexToPixel, type Board, type BoltKind } from './board';
import { sound } from './sound';
import { fireSound, type Shooter } from './soundmap';

/** Bolt colours: the films' red for the Rebels, green for the Empire, blue for ion cannons. */
const BOLT = ['#ff5252', '#5dff8a'] as const;
const ION = '#7cc4ff';

/** Milliseconds, before the playback speed is applied. */
const SLIDE = 230;
const TURN = 200;
const LOOP = 520;
const CAPITAL_SLIDE = 520;
const CAPITAL_TURN = 900;

/** The kind of streak a shot is: ion cannons, torpedoes (and bombs) and missiles have their own, everything else is a laser. */
const boltKind = (shot: ShotRecord): BoltKind => (shot.ion ? 'ion' : shot.gun === 'PT' || shot.gun === 'CB' ? 'torpedo' : shot.gun === 'CM' ? 'missile' : 'laser');

/** What the playback needs of a board: the flat board and the 3D board (src/ui3d) both have it. */
export type PlaybackBoard = Pick<Board, 'render' | 'lift' | 'glide' | 'bolt' | 'impact' | 'popup' | 'explode' | 'removeCounter' | 'playRocks'> & {
  /** A board that shows the capital ships flying (the 3D view): the ship goes to a hex and turns to an angle. */
  glideCapital?(id: string, to: Hex, angle: number, ms: number, ease?: (t: number) => number): Promise<void>;
  /** Told before a move is played: where the ship is and how it is turned after each of the steps `glide` will be asked for, in order, and how many rolls it flies on the way. */
  flight?(id: string, poses: FlightPose[], rolls: number): void;
};

/** A point of the board and an angle (degrees, clockwise from up the map; it may run past 360). */
export interface FlightPose {
  x: number;
  y: number;
  angle: number;
  /** The point the ship fires a snap shot at when it has come to this pose. */
  aim?: { x: number; y: number };
}

/** All guns of one volley fire together; each hit lands when its bolt arrives. */
async function volley(board: PlaybackBoard, game: GameState, shots: ShotRecord[]): Promise<void> {
  // one sound for each kind of weapon in the volley, a little louder the more guns fire
  const fired = new Map<string, number>();
  for (const shot of shots) {
    const shooter: Shooter = isEmplacementTarget(shot.shooter) ? { kind: 'turret' } : isDestroyerTarget(shot.shooter) ? { kind: 'capital' } : { kind: 'ship', typeId: shipById(game, shot.shooter)?.typeId ?? '' };
    const id = fireSound(shooter, shot.gun, shot.ion);
    if (id) fired.set(id, (fired.get(id) ?? 0) + 1);
  }
  for (const [id, guns] of fired) sound.play(id, { volume: Math.min(1.3, 1 + 0.1 * (guns - 1)) });
  await Promise.all(
    shots.map(async (shot, i) => {
      const owner = shipById(game, shot.shooter)?.owner ?? game.emplacements?.find((e) => e.id === shot.shooter)?.owner ?? game.destroyers?.find((d) => d.id === shot.shooter)?.owner ?? 0;
      // several guns side by side, so their bolts do not lie on top of each other
      const kind = boltKind(shot);
      await board.bolt(shot.from, shot.to, shot.ion ? ION : BOLT[owner], shot.hit, i - (shots.length - 1) / 2, kind, { shooter: shot.shooter, target: shot.target });
      if (shot.hit) await board.impact(shot.to, shot.target, { effect: shot.effect, weapon: kind });
      else sound.play('miss');
    }),
  );
}

/** What the playback has already shown of the damage, so that the board does not show it again afterwards. */
export interface Shown {
  /** For each ship, which of its wounds (by position in its list of wounds) have been shown. */
  wounds: Map<string, number[]>;
  /** Ships whose destruction has been shown, with its explosion. */
  destroyed: Set<string>;
}

/**
 * Play what a command did, on the board as it stood *before* the command: ships slide and turn along
 * their path, guns fire, hits flash and misses fly past. What happened in a step of a move (damage from an asteroid, the damage and
 * destruction caused by a snap shot) is shown at that step, from `after`, the game as it stands now. The caller draws the real, final
 * state afterwards, which is also when the log and the rest of the damage text appear.
 */
export async function playCommand(board: PlaybackBoard, before: GameState, cmd: Command, events: GameEvent[], after: GameState): Promise<Shown> {
  const shown: Shown = { wounds: new Map(), destroyed: new Set() };
  await play(board, before, after, cmd, events, shown);
  return shown;
}

/**
 * What the ships suffered at one moment of a command (step `index` of a move, or frame `index` of the asteroid movement, as `key` says),
 * shown where they stand: their damage as text, and the flash of a hit from an asteroid; a ship that is destroyed explodes. `mover` is the
 * ship that is moving, if one is. Returns whether the moving ship is gone (destroyed, or off the map).
 */
async function showStep(board: PlaybackBoard, before: GameState, after: GameState, events: GameEvent[], shown: Shown, key: 'moveStep' | 'frame', index: number, mover: { id: string; pos: Hex } | null): Promise<boolean> {
  const here = events.filter((e) => e[key] === index);
  const destroyedIds = new Set(here.filter((e) => e.kind === 'destroyed' && e.shipId).map((e) => e.shipId!));
  let waited = false;
  for (const ship of after.ships) {
    const old = shipById(before, ship.id);
    const where = ship.id === mover?.id ? mover.pos : old?.pos;
    if (!old || !where) continue;
    // only the wounds this command gave it, and of this moment
    const indices: number[] = [];
    ship.wounds.forEach((w, i) => {
      if (i >= old.wounds.length && w[key] === index) indices.push(i);
    });
    let slot = 0;
    for (const i of indices) {
      const w = ship.wounds[i]!;
      shown.wounds.set(ship.id, [...(shown.wounds.get(ship.id) ?? []), i]);
      board.popup(where, w.text, `k-${w.kind}`, slot++);
    }
    // an asteroid hits the moving ship as it goes, or a ship it moves onto; the targets of a snap shot were flashed by the shot
    const byAsteroid = key === 'frame' || ship.id === mover?.id;
    if (indices.length > 0 && byAsteroid && !destroyedIds.has(ship.id)) void board.impact(where, ship.id, { effect: 'hull' });
    if (destroyedIds.has(ship.id)) {
      shown.destroyed.add(ship.id);
      board.popup(where, 'DESTROYED', 'kill', slot);
      board.explode(where, typeOf(old).body[0] >= 12);
      board.removeCounter(ship.id);
    }
    if (indices.length > 0 || destroyedIds.has(ship.id)) waited = true;
  }
  // a turret gun or the ground target that is destroyed at this moment
  for (const id of destroyedIds) {
    if (!isEmplacementTarget(id)) continue;
    const e = after.emplacements?.find((t) => t.id === id) ?? (after.groundTarget?.id === id ? after.groundTarget : undefined);
    if (!e) continue;
    shown.destroyed.add(id);
    board.popup(e.pos, 'DESTROYED', 'kill');
    board.explode(e.pos, id === after.groundTarget?.id, id === after.groundTarget?.id ? undefined : 'explode.turret');
    board.removeCounter(id);
    waited = true;
  }
  const gone = (mover !== null && destroyedIds.has(mover.id)) || (mover !== null && here.some((e) => e.kind === 'escaped'));
  if (mover !== null && here.some((e) => e.kind === 'escaped')) board.removeCounter(mover.id);
  if (waited) await tween(gone && mover !== null && destroyedIds.has(mover.id) ? 800 : 420, () => undefined);
  return gone;
}

async function play(board: PlaybackBoard, before: GameState, after: GameState, cmd: Command, events: GameEvent[], shown: Shown): Promise<void> {
  // the shots of the ships, in the order of the command; the turret guns fire at the moments of the move (Rules: Ground attack), told by the step they belong to
  const shots = events.flatMap((e) => (e.shot && !isEmplacementTarget(e.shot.shooter) && !isDestroyerTarget(e.shot.shooter) ? [e.shot] : []));
  const turretShots = (step: number): ShotRecord[] => events.flatMap((e) => (e.shot && (isEmplacementTarget(e.shot.shooter) || isDestroyerTarget(e.shot.shooter)) && e.moveStep === step ? [e.shot] : []));
  const rocks = events.flatMap((e) => (e.rocks ? [e.rocks] : []));
  const playRocks = async (): Promise<void> => {
    for (const frames of rocks) await board.playRocks(frames);
  };
  if (cmd.type === 'plan') {
    // the asteroids move once both sides have planned
    if (rocks.length === 0) return;
    board.render({ game: before, selected: null, animating: true });
    // each ship an asteroid moves onto is hurt (or destroyed) as the asteroid arrives
    for (const frames of rocks) await board.playRocks(frames, (i) => showStep(board, before, after, events, shown, 'frame', i, null).then(() => undefined));
    return;
  }
  if (cmd.type === 'fire') {
    if (shots.length === 0) return;
    board.render({ game: before, selected: null, animating: true });
    await volley(board, before, shots);
    await playRocks();
    return;
  }
  if (cmd.type === 'moveDestroyer') {
    // a capital ship flies its move hex by hex, slowly, and turns as slowly
    const d = before.destroyers?.find((x) => x.id === cmd.id);
    if (!d?.pos || !board.glideCapital) return;
    board.render({ game: before, selected: null, animating: true });
    let at = d.pos;
    let heading: number = d.facing;
    let angle = heading * 60;
    for (const step of cmd.steps) {
      const moved = applyStepToPosition(at, heading as typeof d.facing, step);
      if (step === 'turnLeft') angle -= 60;
      else if (step === 'turnRight') angle += 60;
      at = moved.pos;
      heading = moved.facing;
      await board.glideCapital(d.id, at, angle, step === 'forward' ? CAPITAL_SLIDE : CAPITAL_TURN, step === 'forward' ? undefined : easeInOut);
    }
    return;
  }
  if (cmd.type !== 'move') return;
  const ship = shipById(before, cmd.shipId);
  if (!ship?.pos) return;

  board.render({ game: before, selected: null, animating: true, activeShipId: ship.id });
  board.lift(ship.id);
  let pos = ship.pos;
  let facing = ship.facing;
  let angle = facing * 60;
  let next = 0;
  // a board that flies a move as one curve (the 3D board) is told where the whole move goes: one pose for each step that `glide` will be asked for
  if (board.flight) {
    let p = ship.pos;
    let f = ship.facing;
    let a = f * 60;
    const poses: FlightPose[] = [];
    let fired = 0;
    for (const step of cmd.steps) {
      if (step.kind === 'snapFire') {
        // what the ship fires at from the hex it has come to
        const shot = shots[fired];
        fired += step.shots.length;
        const here = poses[poses.length - 1];
        if (shot && here && !here.aim) here.aim = hexToPixel(shot.to);
        continue;
      }
      const moved = applyStepToPosition(p, f, step.kind);
      if (step.kind === 'turnLeft') a -= 60;
      else if (step.kind === 'turnRight') a += 60;
      else if (step.kind === 'halfLoop') a += 180;
      p = moved.pos;
      f = moved.facing;
      poses.push({ ...hexToPixel(p), angle: a });
    }
    board.flight(ship.id, poses, ship.plan?.roll ?? 0);
  }
  // the ship's engines are heard for as long as it flies
  sound.external(ship.typeId);
  try {
  // a turret gun may fire at the ship in the hex it starts in
  if (turretShots(-1).length > 0) {
    await volley(board, before, turretShots(-1));
    if (await showStep(board, before, after, events, shown, 'moveStep', -1, { id: ship.id, pos })) return;
  }
  for (let index = 0; index < cmd.steps.length; index++) {
    const step = cmd.steps[index]!;
    if (step.kind === 'snapFire') {
      const count = step.shots.length;
      await volley(board, before, shots.slice(next, next + count));
      next += count;
      // the damage of the shot, and what it destroys, is shown now, not at the end of the move
      if (await showStep(board, before, after, events, shown, 'moveStep', index, { id: ship.id, pos })) break;
      continue;
    }
    const moved = applyStepToPosition(pos, facing, step.kind);
    if (step.kind === 'turnLeft') angle -= 60;
    else if (step.kind === 'turnRight') angle += 60;
    else if (step.kind === 'halfLoop') angle += 180;
    const ms = step.kind === 'halfLoop' ? LOOP : step.kind === 'turnLeft' || step.kind === 'turnRight' ? TURN : SLIDE;
    const turning = moved.pos.q === pos.q && moved.pos.r === pos.r;
    await board.glide(ship.id, hexToPixel(moved.pos), angle, ms, turning ? easeInOut : undefined);
    pos = moved.pos;
    facing = moved.facing;
    // the turret guns that fire at the ship as it comes to this hex
    if (turretShots(index).length > 0) await volley(board, before, turretShots(index));
    // what the ship suffered in this step is shown here, where it happened; a ship that is destroyed or leaves the map goes no further
    if (await showStep(board, before, after, events, shown, 'moveStep', index, { id: ship.id, pos })) break;
  }
  } finally {
    sound.external(null);
  }
  await playRocks();
}

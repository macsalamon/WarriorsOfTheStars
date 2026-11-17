import type { RingAction } from './movering';

/*
 * The keys that do what the buttons around a ship do, while it is moved, placed or turned. A key only works while its button is there to
 * be pressed (see `Board.offers`).
 */
export const KEY_ACTIONS: Record<string, RingAction> = {
  w: 'forward',
  ArrowUp: 'forward',
  a: 'turnLeft',
  ArrowLeft: 'turnLeft',
  d: 'turnRight',
  ArrowRight: 'turnRight',
  q: 'slipLeft',
  e: 'slipRight',
  s: 'halfLoop',
  ArrowDown: 'halfLoop',
  f: 'snapFire',
  Backspace: 'undo',
  Delete: 'restart',
};

/** The keys, told to the player. */
export const KEYS_HELP = [
  'Keys for the ship you are moving or placing:',
  'W or ↑  one hex forward',
  'A or ←  turn left',
  'D or →  turn right',
  'Q  slide left',
  'E  slide right',
  'S or ↓  half loop',
  'F  snap fire',
  'Backspace  take back the last step',
  'Delete  start the move again',
].join('\n');

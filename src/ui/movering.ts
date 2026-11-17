import type { MoveStep } from '../engine';
import { s } from './dom';

/** Everything the ring around a moving ship can do. */
export type RingAction = MoveStep | 'undo' | 'restart';

export interface RingButton {
  enabled: boolean;
  title: string;
}

export type RingButtons = Record<RingAction, RingButton>;

/** The curved arrow of a turn: left, or (mirrored) right. */
function hook(mirror: boolean): SVGGElement {
  const g = s('g', { transform: mirror ? 'scale(-1 1)' : '' });
  g.append(s('path', { class: 'stroke', d: 'M8 14 V3 Q8 -7 -3 -7' }), s('polygon', { class: 'glyph', points: '-1,-18 -18,-7 -1,4' }));
  return g;
}

/**
 * The movement controls drawn around the ship, as sketched in Ideas/: a fat arrow ahead, a slip arrow on
 * each forward diagonal, a turn hook beside the nose, a crosshair for snap fire, a U-turn behind (half
 * loop), and undo / restart. Everything is laid out for a ship facing north and the whole ring is then
 * turned to the ship's facing; the icons that mean no direction are turned back to stay upright.
 * Sizes are in pixels for a hex of radius 26.
 */
export function drawMoveRing(
  facing: number,
  buttons: RingButtons,
  onClick: (action: RingAction) => void,
): SVGGElement {
  const ring = s('g', { class: 'ring', transform: `rotate(${facing * 60})` });

  const arrow = (scale: number) => s('polygon', { class: 'glyph', points: '-7,15 -7,0 -14,0 0,-15 14,0 7,0 7,15', transform: `scale(${scale})` });
  const crosshair = () => {
    const g = s('g', { transform: 'scale(0.85)' });
    g.append(
      s('circle', { class: 'stroke', r: 6 }),
      s('path', { class: 'stroke', d: 'M0 -11 V-3 M0 3 V11 M-11 0 H-3 M3 0 H11' }),
    );
    return g;
  };
  const uturn = () => {
    const g = s('g');
    g.append(s('path', { class: 'stroke', d: 'M-9 11 V-1 A9 9 0 0 1 9 -1 V3' }), s('polygon', { class: 'glyph', points: '2,2 16,2 9,13' }));
    return g;
  };

  const place = (
    action: RingAction,
    x: number,
    y: number,
    kind: string,
    glyph: SVGElement,
    o: { turn?: number; upright?: boolean; backdrop?: boolean; hit?: boolean } = {},
  ): void => {
    const b = buttons[action];
    const g = s('g', { class: `ringbtn rb-${kind}${b.enabled ? '' : ' off'}`, transform: `translate(${x} ${y}) rotate(${o.turn ?? 0})` });
    g.append(s('title', null, b.title));
    // a round, almost invisible pad makes every control easy to hit
    if (o.backdrop) g.append(s('circle', { class: 'pad', r: 14 }));
    // an invisible round pad under a thin icon, so it is easy to hit
    if (o.hit) g.append(s('circle', { class: 'hit', r: 16 }));
    const inner = s('g', { transform: o.upright ? `rotate(${-facing * 60})` : '' });
    inner.append(glyph);
    g.append(inner);
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.enabled) onClick(action);
    });
    ring.append(g);
  };

  place('forward', 0, -78, 'move', arrow(1));
  place('slipLeft', -51, -30, 'move', arrow(0.85), { turn: -60 });
  place('slipRight', 51, -30, 'move', arrow(0.85), { turn: 60 });
  place('turnLeft', -31, -58, 'turn', hook(false), { hit: true });
  place('turnRight', 31, -58, 'turn', hook(true), { hit: true });
  place('snapFire', 0, -39, 'fire', crosshair(), { backdrop: true });
  place('halfLoop', 0, 47, 'loop', uturn(), { backdrop: true });
  place('undo', -42, 26, 'tool', s('text', { class: 'toolglyph', y: 8 }, '↶'), { upright: true, backdrop: true });
  place('restart', 42, 26, 'tool', s('text', { class: 'toolglyph', y: 8 }, '✕'), { upright: true, backdrop: true });
  return ring;
}

/**
 * The two turn arrows beside a ship that has been put on the map, to set its facing: the same curved arrows as the
 * movement ring, in the same places, turned with the ship.
 */
export function drawTurnArrows(facing: number, onClick: (action: 'turnLeft' | 'turnRight') => void): SVGGElement {
  const ring = s('g', { class: 'ring', transform: `rotate(${facing * 60})` });
  const arrow = (action: 'turnLeft' | 'turnRight', x: number, title: string): void => {
    const g = s('g', { class: 'ringbtn rb-turn', transform: `translate(${x} -58)` });
    g.append(s('title', null, title), s('circle', { class: 'hit', r: 16 }), hook(action === 'turnRight'));
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(action);
    });
    ring.append(g);
  };
  arrow('turnLeft', -31, 'Turn the ship one hex side to the left');
  arrow('turnRight', 31, 'Turn the ship one hex side to the right');
  return ring;
}

export type SubmitAction = 'confirm' | 'reopen';

/**
 * The two buttons beside a ship whose plan has been submitted: a green check that keeps it, and a red
 * cross that opens the plan again. They are drawn upright, one on each side of the ship.
 */
/** A "Move" button beside the ship that has been picked to move, when the player chooses which ship moves next. */
export function drawChooseButton(onClick: () => void): SVGGElement {
  const g = s('g', { class: 'ring' });
  const b = s('g', { class: 'ringbtn rb-yes', transform: 'translate(62 0)' });
  b.append(s('title', null, 'Move this ship now'), s('rect', { class: 'pad', x: -32, y: -15, width: 64, height: 30, rx: 15 }), s('text', { class: 'toolglyph', y: 6, style: 'font-size:15px' }, 'Move'));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  g.append(b);
  return g;
}

export function drawSubmitButtons(onClick: (action: SubmitAction) => void): SVGGElement {
  const g = s('g', { class: 'ring' });
  const button = (action: SubmitAction, x: number, kind: string, glyph: string, title: string): void => {
    const b = s('g', { class: `ringbtn rb-${kind}`, transform: `translate(${x} 0)` });
    b.append(s('title', null, title), s('circle', { class: 'pad', r: 16 }), s('text', { class: 'toolglyph', y: 7 }, glyph));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(action);
    });
    g.append(b);
  };
  button('reopen', -48, 'no', '✕', 'Open the plan of this ship again');
  button('confirm', 48, 'yes', '✓', 'Keep this plan');
  return g;
}

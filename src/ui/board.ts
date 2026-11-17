import {
  activeShips,
  bodyRating,
  destroyerHexes,
  hexesOf,
  specOf,
  speedText,
  structureLeft,
  type CapitalKind,
  type Destroyer,
  canFireAt,
  extentOf,
  fromOffset,
  hexDistance,
  hexEquals,
  hexId,
  neighbor,
  hasSideQuarters,
  rockAt,
  specialReaches,
  turretReaches,
  speedOf,
  tails,
  typeOf,
  type Facing,
  type GameState,
  type Hex,
  type Ship,
  type Rock,
  type Emplacement,
  type RockFrame,
  itemGuns,
  type BaseItemKind,
  type PlayerId,
} from '../engine';
import { clock, easeInOut, easeOut, tween } from './anim';
import { SIDE_COLORS } from './colours';
import { stackSlots, type Slot } from './stacks';
import { drawChooseButton, drawMoveRing, drawSubmitButtons, drawTurnArrows, type RingAction, type RingButtons, type SubmitAction } from './movering';
import { clear, s } from './dom';
import { composeRock, rockUrl } from './rocks';
import { Fx } from './fx';
import { sound } from './sound';
import { hitSound } from './soundmap';
import { groundCounter, turretCounter } from './turrets';
import type { FlightPose } from './playback';

/** Hex radius in world units (centre to corner). Flat-top hexes. */
const R = 26;
/** The same, for the 3D board, which lays its hexes out in the same units. */
export const HEX_R = R;
/** Hexes of empty grid drawn beyond the outermost ship; the fastest ship moves 11 hexes a turn. */
const MARGIN = 15;
const SQRT3 = Math.sqrt(3);
/**
 * The pictures of the capital ships (tools/assemble-destroyer.cjs), taken from 50 degrees above the board, so that the ship is seen shortened along the way it points. For each:
 * the picture file; how wide the square picture is in hex radii; how many radii behind the hex it turns on (`pos`) the middle of the ship is (negative: ahead of it); the factor
 * the picture is stretched by up the screen, so that the outline lies on the hexes as the ship does seen from straight above (the 3D view; for the first two it is what the model's
 * length to width asks for, the frigate has the sine of the angle); and, for each of the six facings, where the middle of the ship's outline is in the square picture (as a part of its
 * size, from the middle of the picture), so that the picture is put with the middle of the outline on the middle of the ship.
 * The Star Destroyer is 6.8 radii wide, the cruiser 5.4 (70% larger than before in length, and 3D fitted to the hexes), the frigate is as long as its four hexes (60% larger than two).
 */
const CAPITAL_PICTURE: Record<CapitalKind, { file: string; span: number; centre: number; stretch: number; offsets: readonly (readonly [number, number])[] }> = {
  'star-destroyer': { file: 'star-destroyer', span: 6.8 * 1.951, centre: -0.55, stretch: 1.336, offsets: [[-0.0006, 0.0837], [-0.0513, 0.1094], [-0.0262, 0.0012], [-0.0006, 0.0444], [0.025, 0.0012], [0.05, 0.11]] },
  'mon-calamari': { file: 'mon-calamari', span: 5.43 * 2.454, centre: 3.63, stretch: 1.382, offsets: [[-0.0006, 0.0419], [-0.0294, 0.0231], [0.025, 0.0119], [-0.0006, 0.0413], [-0.0262, 0.0119], [0.0281, 0.0238]] },
  'nebulon-b': { file: 'nebulon-b', span: 4.502 * 1.6, centre: SQRT3 / 2, stretch: 1 / Math.sin((50 * Math.PI) / 180), offsets: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] },
};
// (the 3D view needs the middle of the ship too)
export const capitalCentre = (kind: CapitalKind): number => CAPITAL_PICTURE[kind].centre;

export const hexToPixel = (h: Hex): { x: number; y: number } => ({
  x: R * 1.5 * h.q,
  y: R * SQRT3 * (h.r + h.q / 2),
});

/** Round a world point to the nearest hex (cube rounding). */
function pixelToHex(x: number, y: number): Hex {
  const q = ((2 / 3) * x) / R;
  const r = ((-1 / 3) * x + (SQRT3 / 3) * y) / R;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - (-q - r));
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

const corner = (i: number): [number, number] => {
  const a = (Math.PI / 180) * 60 * i;
  return [R * Math.cos(a), R * Math.sin(a)];
};
const HEX_POINTS = [0, 1, 2, 3, 4, 5].map((i) => corner(i).join(',')).join(' ');

export const SHORT_NAMES: Record<string, string> = {
  'x-wing': 'X',
  'y-wing-1seat': 'Y',
  'y-wing-2seat': 'Y2',
  'a-wing': 'A',
  'b-wing': 'B',
  'tie-fighter': 'TF',
  'tie-interceptor': 'TI',
  'tie-interceptor-prototype': 'TP',
  'tie-bomber': 'TB',
  'imperial-shuttle': 'LS',
  'stock-freighter': 'FR',
  'millennium-falcon': 'MF',
  'slave-i': 'S1',
  'pirate-pinnace': 'PP',
};

/**
 * Ship pictures in public/assets/ships, made from 3D models by tools/render3d.html and tools/assemble-sprites.cjs (see CREDITS.md).
 * When a picture is missing the ship is drawn as a plain arrowhead.
 */
export const SPRITE_OF: Record<string, string> = {
  'x-wing': 'x-wing',
  'a-wing': 'a-wing',
  'b-wing': 'b-wing',
  'y-wing-1seat': 'y-wing',
  'y-wing-2seat': 'y-wing-2seat',
  'tie-fighter': 'tie-fighter',
  'tie-interceptor': 'tie-interceptor',
  'tie-interceptor-prototype': 'tie-interceptor-prototype',
  'tie-bomber': 'tie-bomber',
  'imperial-shuttle': 'imperial-shuttle',
  'stock-freighter': 'stock-freighter',
  'millennium-falcon': 'millennium-falcon',
  'slave-i': 'slave-i',
  'pirate-pinnace': 'pirate-pinnace',
};

/** Rough relative sizes, so a TIE does not look as big as a Y-wing or a freighter. */
export const SPRITE_SCALE: Record<string, number> = {
  'x-wing': 1,
  'a-wing': 0.63,
  'b-wing': 1.1,
  'y-wing': 1.05,
  'y-wing-2seat': 1.05,
  'tie-fighter': 0.85,
  'tie-interceptor': 0.85,
  'tie-interceptor-prototype': 0.9,
  'tie-bomber': 0.95,
  // the Lambda is far larger than the fighters: twice the size of the other pictures, spilling over its hex
  'imperial-shuttle': 2.1,
  // the freighter and the Falcon are bigger than the fighters: 30% more than the other pictures
  'stock-freighter': 1.43,
  'millennium-falcon': 1.43,
  'slave-i': 1.05,
  'pirate-pinnace': 1.05,
};

/**
 * Ships with a picture for each of the six facings (seen from above at an angle, lit the same way), plus one from the front for the
 * ship card. (A ship without such pictures would use one top view that is turned.)
 */
const FACING_SPRITES = new Set(Object.values(SPRITE_OF));

function spriteFile(spriteId: string, facing = 0): string {
  return FACING_SPRITES.has(spriteId) ? `${spriteId}-f${facing}.png` : `${spriteId}.png`;
}

/** The picture of a ship (for a facing, when it has one for each). */
export function spriteUrl(typeId: string, facing = 0): string | null {
  const id = SPRITE_OF[typeId];
  return id ? `${import.meta.env.BASE_URL}assets/ships/${spriteFile(id, facing)}` : null;
}

/** The picture for the ship card: from the front where there is one, otherwise the same as on the board. */
export function portraitUrl(typeId: string): string | null {
  const id = SPRITE_OF[typeId];
  if (!id) return null;
  return `${import.meta.env.BASE_URL}assets/ships/${id}${FACING_SPRITES.has(id) ? '-front' : ''}.png`;
}

/** The facing (0..5) nearest to an angle in degrees, and how far the angle is from it. */
function nearestFacing(angle: number): { facing: number; turn: number } {
  const steps = Math.round(angle / 60);
  return { facing: ((steps % 6) + 6) % 6, turn: angle - steps * 60 };
}

export interface Overlay {
  game: GameState;
  selected: string | null;
  /** Hexes the player may place ships in. */
  zone?: Hex[];
  /** Ships being placed this turn that are not yet in the game (setup). */
  placements?: { ship: Ship; pos: Hex; facing: number }[];
  /** The Star Destroyers being placed this turn that are not yet in the game (setup), by id. */
  destroyerPlacements?: { id: string; pos: Hex; facing: number }[];
  /** A Star Destroyer as it would stand after the steps planned so far, with the path of its nose. */
  destroyerGhost?: { id: string; pos: Hex; facing: number; path: Hex[] };
  /** Star Destroyers that can be shot at (by id), with the chance to hit written on them, and those a gun is already aimed at. */
  destroyerTargets?: string[];
  destroyerLabels?: Record<string, string>;
  destroyerAimed?: string[];
  /** The capital ships a click picks while the ships are being placed (the ones already put down), and the one that is being placed. */
  destroyerPickable?: string[];
  destroyerSelected?: string | null;
  /** The speed arrows in the body of the Star Destroyer that is being moved: its speed now, the speed chosen, and whether the speed may go up or down. */
  destroyerSpeed?: { id: string; now: number; chosen: number; up: boolean; down: boolean; locked?: boolean };
  /** The ground target and the guns the defender is placing (Rules: Ground attack): not yet in the game. For the standard base `pos` is its middle hex and `facing` how many hex sides it is turned. */
  baseItems?: { id: string; kind: BaseItemKind; pos: Hex; facing: number; owner: PlayerId }[];
  /** Hexes that can be clicked to take a movement step. */
  stepHexes?: { hex: Hex; label: string; rotation?: number }[];
  /** The ship as it would stand after the planned steps. */
  ghost?: { ship: Ship; pos: Hex; facing: number; path: Hex[] };
  /** Show the forward fire arc of this ship (position and facing may be a ghost's). */
  /** The forward centre arc of the ship that is shot with; `far` adds the hexes six to ten away that its missiles or torpedoes reach, drawn softer. */
  arc?: { pos: Hex; facing: number; far?: boolean } | null;
  /** Ships the player may shoot at, highlighted. */
  targets?: string[];
  /** Asteroids that can be shot at, with the chance to hit written on them, and those a gun is already aimed at. */
  rockTargets?: number[];
  rockLabels?: Record<number, string>;
  rockAimed?: number[];
  /** Turret guns and the ground target that can be shot at (by id), with the chance to hit written on them, and those a gun is already aimed at. */
  turretTargets?: string[];
  turretLabels?: Record<string, string>;
  turretAimed?: string[];
  /** Turret guns whose forward arc is drawn (by id), the danger zone they make. */
  turretArcs?: string[];
  /** Capital ships whose range of fire is shaded (by id): every hex within ten hexes of any hex of the ship, the danger zone for a fighter. */
  capitalRanges?: string[];
  /** While the turret guns are given their orders: the orders so far (the way it will face, what it will track), the turret being set, and those that can be clicked. */
  turretDraft?: Record<string, { facing: number; target: string | null }>;
  turretSelected?: string | null;
  turretClickable?: string[];
  /**
   * Warning signs on the asteroid hexes a moving ship will cross (Rules: Asteroid fields), with its chance of getting through unharmed; `ahead` marks a hex the
   * ship could step into next, not yet part of its path.
   */
  rockWarnings?: { hex: Hex; chance: number; label: string; ahead: boolean }[];
  /** What to write on a target (the chance to hit it), by ship. */
  targetLabels?: Record<string, string>;
  /** Targets a gun is already aimed at. */
  aimed?: string[];
  /** The ship whose phase it is. */
  activeShipId?: string | null;
  /** Ships not to draw (hidden set-up). */
  hidden?: string[];
  /** A large arrow inside the set-up area pointing at the enemy. */
  zoneArrow?: { from: Hex; to: Hex };
  /** The board is being used to play back a command: no helper lines. */
  animating?: boolean;
  /** The speed ray of the selected ship: straight ahead for `speed` hexes, with the first hex where it may turn. */
  ray?: {
    pos: Hex;
    facing: number;
    speed: number;
    turn: number;
    /** The hex along the ray where a turn first becomes possible, null when none is within reach (default: from the turn number). */
    gate?: number | null;
    label?: string;
  };
  /** The movement controls around the ship at this position and facing. */
  ring?: { pos: Hex; facing: number; buttons: RingButtons };
  /** Turn arrows beside a ship that has just been placed (set-up). */
  turn?: { pos: Hex; facing: number };
  /** Ships whose plan is submitted, drawn darker. */
  dimmed?: string[];
  /** Show the keep / reopen buttons beside the ship standing here. */
  confirm?: { pos: Hex };
  /** Show a "Move" button beside the ship standing here (choosing the ship to move). */
  choose?: { pos: Hex };
}

/** The kind of shot a bolt is: lasers, ion cannons, torpedoes (and bombs) and missiles each have their own streak. */
export type BoltKind = 'laser' | 'ion' | 'torpedo' | 'missile';

/** What a hit looks like: how much it did (shields only, the hull, a lot, a rock) and with which kind of weapon. */
export interface HitLook {
  effect?: 'shield' | 'hull' | 'heavy' | 'rock';
  weapon?: BoltKind;
}

/** The part of the board a drawing covers, in board units. */
export interface TableArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The 3D view of the board (src/ui3d/board3d.ts), as the flat board uses it. In 3D the flat board is still what draws the hexes, the
 * planning aids and every button: its drawing is laid down as the table, in perspective, and the ships fly over it as models. The flat
 * board keeps taking the pointer, and asks the 3D view what is under it and passes it the camera moves; the ships, the shots and the
 * explosions of a playback go to the 3D view too. Points are board units (see `hexToPixel`), places on the screen are page coordinates.
 */
/** Who fires a shot and who is fired at, when the board can make something of it (the 3D view: the shot flies from ship to ship). */
export interface ShotEnds {
  shooter?: string | undefined;
  target?: string | undefined;
}

export interface Table {
  /** The drawing to lay down, the part of the board it covers, and how many pixels of it a board unit is. */
  layout(element: Element, area: TableArea, k: number): void;
  /** The point of the board under a place on the screen; null past the horizon. */
  ground(clientX: number, clientY: number): { x: number; y: number } | null;
  /** What is under a place on the screen: a point of the board, or the hex centre of the ship whose model is there (with its id). */
  locate(clientX: number, clientY: number): { x: number; y: number; shipId?: string } | null;
  grab(from: { x: number; y: number }, to: { x: number; y: number }): void;
  turn(dx: number, dy: number): void;
  zoom(factor: number, clientX: number, clientY: number): void;
  fit(points: { x: number; y: number }[]): void;
  panTo(point: { x: number; y: number }): void;
  reveal(point: { x: number; y: number }, room: number): void;
  screenOf(point: { x: number; y: number }): { x: number; y: number; r: number };
  size(): { w: number; h: number };
  render(overlay: Overlay): void;
  flight(id: string, poses: FlightPose[], rolls: number): void;
  glide(id: string, to: { x: number; y: number }, angle: number, ms: number, ease?: (t: number) => number): Promise<void>;
  bolt(from: Hex, to: Hex, color: string, hit: boolean, lane: number, kind?: BoltKind, ids?: ShotEnds): Promise<void>;
  /** A capital ship flying to the hex point it turns on next, turning to an angle (degrees). */
  glideCapital(id: string, to: { x: number; y: number }, angle: number, ms: number, ease?: (t: number) => number): Promise<void>;
  /** How large the fighters are shown (1 is their real size). */
  shipScale(k: number): void;
  /** The asteroids while they move: one built (anew), one shifted from where it was built, one gone. */
  rockSet(rock: Rock): void;
  rockOffset(id: number, dx: number, dy: number): void;
  rockGone(id: number): void;
  impact(hex: Hex, targetId?: string, look?: HitLook): Promise<void>;
  explode(hex: Hex, large?: boolean, soundId?: string): void;
  popup(hex: Hex, text: string, kind: string, slot?: number): void;
  removeCounter(id: string): void;
  dispose(): void;
}

/** How many pixels of the drawing a board unit is when the board lies as the table: the browser draws it in perspective from this. */
const TABLE_SCALE = 2;

export interface BoardHandlers {
  onRingClick(action: RingAction): void;
  onSubmitClick(action: SubmitAction): void;
  onChooseClick(): void;
  onHexClick(hex: Hex): void;
  onRockClick(rockId: number): void;
  onTurretClick(id: string): void;
  /** A Star Destroyer that can be shot at was clicked. */
  onDestroyerClick?(id: string): void;
  /** One of the speed arrows in the body of a Star Destroyer was clicked. */
  onSpeedClick?(direction: 'up' | 'down'): void;
  onShipClick(shipId: string): void;
  /** The hex under the pointer, and the ship under it when several share the hex and the stacks are shown apart. */
  onHover(hex: Hex | null, shipId?: string | null): void;
}

/** SVG hex board with pan (drag) and zoom (wheel). */
export class Board {
  private svg: SVGSVGElement;
  private world: SVGGElement;
  private dynamic: SVGGElement;
  /** The asteroids, under the ships; a layer of its own so that they can drift while the rest stands still. */
  private rockLayer: SVGGElement;
  private rockNodes = new Map<number, { g: SVGGElement; rock: Rock; offset: { x: number; y: number } }>();
  private showRockPaths = true;
  /** The map has edges (a static map): they are drawn. */
  private edges: { cols: number; rows: number } | null = null;
  /** Floating damage text; kept across redraws so the animations are not cut short. */
  private fx: SVGGElement;
  /** The animated effects (explosions, hit flashes, bolts), on a canvas over the board. */
  private effects: Fx;
  private tx = 0;
  private ty = 0;
  private scale = 1;
  private showLabels = false;
  private overlay: Overlay | null = null;
  private built = false;
  private bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number } | null = null;
  private drag: { x: number; y: number; tx: number; ty: number; moved: boolean; turn: boolean; lastX: number; lastY: number } | null = null;

  constructor(
    private host: HTMLElement,
    private handlers: BoardHandlers,
  ) {
    this.svg = s('svg', { class: 'board', tabindex: 0 });
    this.world = s('g');
    this.dynamic = s('g');
    this.rockLayer = s('g', { class: 'rocks' });
    this.fx = s('g', { class: 'fx' });
    this.svg.append(this.world);
    host.append(this.svg);
    this.effects = new Fx(
      host,
      () => ({ tx: this.tx, ty: this.ty, scale: this.scale }),
      () => {
        const r = this.svg.getBoundingClientRect();
        return { w: r.width, h: r.height };
      },
    );
    this.attach();
    this.keepStill();
    this.loadSprites();
  }

  private origin: { x: number; y: number } | null = null;

  /** The 3D view the board lies in as the table, when it does (see `Table`), and the part of the board the drawing covers. */
  private table: Table | null = null;
  private area: TableArea | null = null;

  /** Lays the board down as the table of a 3D view, or (null) stands it up again as the flat board. */
  setTable(table: Table | null): void {
    if (this.table === table) return;
    const old = this.table;
    this.table = table;
    table?.shipScale(this.shipScale);
    this.svg.classList.toggle('table', table !== null);
    this.host.classList.toggle('is3d', table !== null);
    if (old) {
      // the 3D view had the drawing: it comes back to its place, as it was
      old.dispose();
      this.svg.removeAttribute('style');
      this.host.prepend(this.svg);
      this.origin = null;
    }
    this.built = false;
    if (!table) this.apply();
    if (this.overlay) this.render(this.overlay);
  }

  /** Whether one of the buttons around a ship is there to be pressed just now (for the keys that do the same). */
  offers(action: RingAction): boolean {
    const o = this.overlay;
    if (!o || o.animating) return false;
    if (o.ring) return o.ring.buttons[action].enabled;
    return o.turn !== undefined && (action === 'turnLeft' || action === 'turnRight');
  }

  get inTable(): boolean {
    return this.table !== null;
  }

  /** Told before a move is played: the 3D view flies the whole move as one curve (see the playback). */
  flight(id: string, poses: FlightPose[], rolls: number): void {
    this.table?.flight(id, poses, rolls);
  }

  /** The point of the board under a place on the screen, and in the 3D view the ship whose model is there. */
  private worldAt(clientX: number, clientY: number): { x: number; y: number; shipId?: string } | null {
    if (this.table) return this.table.locate(clientX, clientY);
    const rect = this.svg.getBoundingClientRect();
    return { x: (clientX - rect.left - this.tx) / this.scale, y: (clientY - rect.top - this.ty) / this.scale };
  }

  /**
   * The board only moves when the player pans it or the game asks it to follow something. When the strip above it grows or shrinks, the
   * board's top edge moves on the page; the drawing is shifted back by the same amount so that it stays where it was.
   */
  private keepStill(): void {
    if (typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(() => {
      if (this.table) return;
      const r = this.svg.getBoundingClientRect();
      if (this.origin) {
        this.tx -= r.left - this.origin.x;
        this.ty -= r.top - this.origin.y;
        this.apply();
      }
      this.origin = { x: r.left, y: r.top };
    }).observe(this.svg);
  }

  private sprites = new Map<string, { w: number; h: number }>();

  /** Find out which ship pictures exist, and redraw when they arrive. */
  private loadSprites(): void {
    for (const id of new Set(Object.values(SPRITE_OF))) {
      const img = new Image();
      img.onload = () => {
        this.sprites.set(id, { w: img.naturalWidth, h: img.naturalHeight });
        if (this.overlay) this.render(this.overlay);
      };
      img.src = `${import.meta.env.BASE_URL}assets/ships/${spriteFile(id)}`;
    }
  }

  /** Show the size of every asteroid at its centre of mass, and the lines that tell where the drifting ones will be next turn. */
  setRockPaths(on: boolean): void {
    this.showRockPaths = on;
    if (this.overlay) this.render(this.overlay);
  }

  setLabels(on: boolean): void {
    this.showLabels = on;
    this.built = false;
    if (this.overlay) this.render(this.overlay);
  }

  private apply(): void {
    if (this.table) {
      // as the table the drawing is not moved or zoomed: the camera of the 3D view is
      const a = this.area;
      if (a) this.world.setAttribute('transform', `translate(${-a.x0 * TABLE_SCALE} ${-a.y0 * TABLE_SCALE}) scale(${TABLE_SCALE})`);
      return;
    }
    this.world.setAttribute('transform', `translate(${this.tx} ${this.ty}) scale(${this.scale})`);
  }

  /** The button under the pointer when it was pressed, and the one it is over (the board as the table: see `buttonAt`). */
  private pressed: Element | null = null;
  private hot: Element | null = null;

  /**
   * The board as the table: the button drawn on the board (around a ship) at a place on the screen. A browser does not tell which part
   * of a drawing in perspective is under the pointer, so it is worked out from where the pointer is on the board.
   */
  private buttonAt(clientX: number, clientY: number): Element | null {
    const at = this.table?.ground(clientX, clientY);
    const a = this.area;
    if (!at || !a) return null;
    const p = new DOMPoint((at.x - a.x0) * TABLE_SCALE, (at.y - a.y0) * TABLE_SCALE);
    let found: Element | null = null;
    for (const el of Array.from(this.svg.querySelectorAll<SVGGraphicsElement>('.ringbtn'))) {
      const m = el.getCTM();
      if (!m) continue;
      const q = p.matrixTransform(m.inverse());
      const b = el.getBBox();
      // the last one drawn is on top
      if (q.x >= b.x - 2 && q.x <= b.x + b.width + 2 && q.y >= b.y - 2 && q.y <= b.y + b.height + 2) found = el;
    }
    return found;
  }

  private attach(): void {
    // The flat board takes the pointer on its drawing. As the table it takes it on the whole place of the board on the page (but not on the
    // planning box that floats there), and finds out itself what is under the pointer.
    const mine = (e: Event): boolean => {
      if ((e.currentTarget === this.host) !== (this.table !== null)) return false;
      return !this.table || !(e.target instanceof Element && e.target.closest('.planbox') !== null);
    };
    const onRing = (e: PointerEvent): boolean => (this.table ? this.buttonAt(e.clientX, e.clientY) !== null : e.target instanceof Element && e.target.closest('.ring') !== null);
    const down = (e: PointerEvent): void => {
      if (!mine(e)) return;
      if (onRing(e)) {
        this.pressed = this.table ? this.buttonAt(e.clientX, e.clientY) : null;
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false, turn: e.button !== 0, lastX: e.clientX, lastY: e.clientY };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (!mine(e)) return;
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        if (this.drag.moved && this.table) {
          // in the 3D view the left button moves the map and the right one turns the view
          if (this.drag.turn) this.table.turn(e.clientX - this.drag.lastX, e.clientY - this.drag.lastY);
          else this.table.grab({ x: this.drag.lastX, y: this.drag.lastY }, { x: e.clientX, y: e.clientY });
          this.drag.lastX = e.clientX;
          this.drag.lastY = e.clientY;
        } else if (this.drag.moved) {
          this.tx = this.drag.tx + dx;
          this.ty = this.drag.ty + dy;
          this.apply();
        }
      }
      if (this.table) {
        // the button under the pointer lights up, as it does by itself on the flat board
        const button = this.drag ? null : this.buttonAt(e.clientX, e.clientY);
        if (button !== this.hot) {
          this.hot?.classList.remove('hot');
          button?.classList.add('hot');
          this.hot = button;
          this.host.style.cursor = button ? 'pointer' : '';
        }
      }
      const hex = this.hexAt(e.clientX, e.clientY);
      this.handlers.onHover(hex, this.shipAt(e.clientX, e.clientY, hex));
    };
    const up = (e: PointerEvent): void => {
      if (!mine(e)) return;
      if (this.table && this.pressed) {
        const pressed = this.pressed;
        this.pressed = null;
        // a click on a button of the board: told to the button, as the browser would
        if (this.buttonAt(e.clientX, e.clientY) === pressed) pressed.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return;
      }
      if (onRing(e)) return;
      const moved = this.drag?.moved ?? false;
      const turning = this.drag?.turn ?? false;
      this.drag = null;
      if (moved || (this.table && turning)) return;
      const hex = this.hexAt(e.clientX, e.clientY);
      const shipId = this.shipAt(e.clientX, e.clientY, hex);
      const rock = this.overlay?.game.asteroids ? rockAt(this.overlay.game.asteroids, hex) : undefined;
      const turret = this.emplacementAt(hex);
      const destroyer = this.destroyerAt(hex);
      if (shipId) this.handlers.onShipClick(shipId);
      // a capital ship is picked by a click on any of its hexes, unless the hex is a step of the move of the ship that is moving
      else if (destroyer && !this.overlay?.stepHexes?.some((st) => hexEquals(st.hex, hex))) this.handlers.onDestroyerClick?.(destroyer);
      else if (rock && this.overlay?.rockTargets?.includes(rock.id)) this.handlers.onRockClick(rock.id);
      else if (turret && (this.overlay?.turretTargets?.includes(turret) || this.overlay?.turretClickable?.includes(turret))) this.handlers.onTurretClick(turret);
      else this.handlers.onHexClick(hex);
    };
    const wheel = (e: WheelEvent): void => {
      if (!mine(e)) return;
      e.preventDefault();
      if (this.table) {
        this.table.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
        return;
      }
      const rect = this.svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next = Math.min(6, Math.max(0.25, this.scale * factor));
      const k = next / this.scale;
      this.tx = px - (px - this.tx) * k;
      this.ty = py - (py - this.ty) * k;
      this.scale = next;
      this.apply();
    };
    for (const el of [this.svg, this.host] as (HTMLElement | SVGSVGElement)[]) {
      el.addEventListener('pointerdown', down as EventListener);
      el.addEventListener('pointermove', move as EventListener);
      el.addEventListener('pointerup', up as EventListener);
      el.addEventListener('pointerleave', (e) => {
        if (mine(e)) this.handlers.onHover(null);
      });
      el.addEventListener('contextmenu', (e) => {
        if (this.table && mine(e)) e.preventDefault();
      });
      el.addEventListener('wheel', wheel as EventListener, { passive: false });
    }
  }

  /** The turret gun, or the ground target, standing in this hex (by id). */
  emplacementAt(hex: Hex): string | null {
    const game = this.overlay?.game;
    if (!game) return null;
    const turret = game.emplacements?.find((e) => e.status === 'active' && hexEquals(e.pos, hex));
    if (turret) return turret.id;
    return game.groundTarget?.status === 'active' && hexEquals(game.groundTarget.pos, hex) ? game.groundTarget.id : null;
  }

  /** The Star Destroyer that fills this hex (by id). */
  destroyerAt(hex: Hex): string | null {
    const game = this.overlay?.game;
    if (!game) return null;
    // a capital ship that is being placed is not in the game yet
    for (const p of this.overlay?.destroyerPlacements ?? []) {
      const d = game.destroyers?.find((x) => x.id === p.id);
      if (d && destroyerHexes(p.pos, p.facing as Facing, specOf(d).kind).some((x) => hexEquals(x, hex))) return p.id;
    }
    return game.destroyers?.find((d) => !d.exploded && !this.overlay?.hidden?.includes(d.id) && hexesOf(d).some((x) => hexEquals(x, hex)))?.id ?? null;
  }

  /** The ship drawn under the pointer in this hex: with the stacks apart, the one whose counter is nearest. */
  private shipAt(clientX: number, clientY: number, hex: Hex): string | null {
    if (!this.overlay) return null;
    // during set-up the ships being placed are not in the game yet
    const placed = this.overlay.placements?.find((p) => hexEquals(p.pos, hex));
    if (placed) return placed.ship.id;
    const here = activeShips(this.overlay.game).filter((sh) => sh.pos && hexEquals(sh.pos, hex) && !this.overlay!.hidden?.includes(sh.id));
    const at = this.worldAt(clientX, clientY);
    // in the 3D view the ships of a hex fly one above the other: the one whose model is under the pointer
    if (at?.shipId && here.some((sh) => sh.id === at.shipId)) return at.shipId;
    if (here.length < 2 || this.slots.size === 0 || !at) return here[0]?.id ?? null;
    const { x, y } = at;
    const c = hexToPixel(hex);
    let best = here[0]!;
    let bestDistance = Infinity;
    for (const sh of here) {
      const slot = this.slots.get(sh.id);
      const d = Math.hypot(x - (c.x + (slot?.dx ?? 0) * R), y - (c.y + (slot?.dy ?? 0) * R));
      if (d < bestDistance) {
        bestDistance = d;
        best = sh;
      }
    }
    return best.id;
  }

  private hexAt(clientX: number, clientY: number): Hex {
    const at = this.worldAt(clientX, clientY);
    // past the horizon of the 3D view there is no hex: one far off any map
    return at ? pixelToHex(at.x, at.y) : { q: -9999, r: -9999 };
  }

  /** Centre the view on a set of hexes, zooming to fit them with a margin. */
  fit(hexes: Hex[], maxScale = 1.4): void {
    if (hexes.length === 0) return;
    if (this.table) return this.table.fit(hexes.map(hexToPixel));
    const rect = this.svg.getBoundingClientRect();
    const pts = hexes.map(hexToPixel);
    const minX = Math.min(...pts.map((p) => p.x)) - 120;
    const maxX = Math.max(...pts.map((p) => p.x)) + 120;
    const minY = Math.min(...pts.map((p) => p.y)) - 120;
    const maxY = Math.max(...pts.map((p) => p.y)) + 120;
    this.scale = Math.min(maxScale, Math.max(0.25, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))));
    this.tx = rect.width / 2 - ((minX + maxX) / 2) * this.scale;
    this.ty = rect.height / 2 - ((minY + maxY) / 2) * this.scale;
    this.apply();
  }

  /** Pan (without zooming) so that a hex is in the middle of the view. */
  panTo(hex: Hex): void {
    if (this.table) return this.table.panTo(hexToPixel(hex));
    const rect = this.svg.getBoundingClientRect();
    const p = hexToPixel(hex);
    this.tx = rect.width / 2 - p.x * this.scale;
    this.ty = rect.height / 2 - p.y * this.scale;
    this.apply();
  }

  /** Where a hex centre is on screen, in pixels from the top left of the board, and how large a hex radius is there. */
  screenOf(hex: Hex): { x: number; y: number; r: number } {
    const p = hexToPixel(hex);
    if (this.table) return this.table.screenOf(p);
    return { x: p.x * this.scale + this.tx, y: p.y * this.scale + this.ty, r: R * this.scale };
  }

  /** The size of the board on screen. */
  size(): { w: number; h: number } {
    if (this.table) return this.table.size();
    const rect = this.svg.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  reveal(hex: Hex, room = 0): void {
    const p = hexToPixel(hex);
    this.follow(p.x, p.y, room);
  }

  /** Pan (without zooming) so that a point of the board is inside the view, with `room` board pixels to spare. */
  private follow(x: number, y: number, room = 0): void {
    if (this.table) return this.table.reveal({ x, y }, room);
    const rect = this.svg.getBoundingClientRect();
    const sx = x * this.scale + this.tx;
    const sy = y * this.scale + this.ty;
    const margin = 90 + room * this.scale;
    if (sx < margin) this.tx += margin - sx;
    if (sx > rect.width - margin) this.tx -= sx - (rect.width - margin);
    if (sy < margin) this.ty += margin - sy;
    if (sy > rect.height - margin) this.ty -= sy - (rect.height - margin);
    this.apply();
  }

  /**
   * Space has no edges, so the drawn grid grows to cover wherever the ships are, with a margin
   * of hexes all round (the fastest ship moves 11 hexes). It never shrinks, so the stars and
   * hexes do not jump around.
   */
  private ensureBounds(o: Overlay): void {
    const map = o.game.map;
    if (map.mode === 'static') {
      // a map with edges is drawn whole, with a margin of empty space beyond them
      const margin = 4;
      const target = { minCol: -margin, maxCol: map.cols - 1 + margin, minRow: -margin, maxRow: map.rows - 1 + margin };
      const b = this.bounds;
      if (b && b.minCol === target.minCol && b.maxCol === target.maxCol && b.minRow === target.minRow && b.maxRow === target.maxRow && this.edges?.cols === map.cols && this.edges.rows === map.rows) return;
      this.bounds = target;
      this.edges = { cols: map.cols, rows: map.rows };
      this.built = false;
      return;
    }
    this.edges = null;
    const hexes: Hex[] = [...o.game.zones[0], ...o.game.zones[1]];
    for (const ship of o.game.ships) if (ship.status === 'active' && ship.pos) hexes.push(ship.pos);
    for (const p of o.placements ?? []) hexes.push(p.pos);
    for (const d of o.game.destroyers ?? []) hexes.push(...hexesOf(d));
    const kindOf = (id: string): CapitalKind => specOf(o.game.destroyers?.find((x) => x.id === id) ?? {}).kind;
    for (const p of o.destroyerPlacements ?? []) hexes.push(...destroyerHexes(p.pos, p.facing as Facing, kindOf(p.id)));
    if (o.destroyerGhost) hexes.push(...o.destroyerGhost.path, ...destroyerHexes(o.destroyerGhost.pos, o.destroyerGhost.facing as Facing, kindOf(o.destroyerGhost.id)));
    if (o.ghost) hexes.push(...o.ghost.path, o.ghost.pos);
    for (const step of o.stepHexes ?? []) hexes.push(step.hex);
    const e = extentOf(hexes);
    const target = { minCol: e.minCol - MARGIN, maxCol: e.maxCol + MARGIN, minRow: e.minRow - MARGIN, maxRow: e.maxRow + MARGIN };
    const b = this.bounds;
    if (b && target.minCol >= b.minCol && target.maxCol <= b.maxCol && target.minRow >= b.minRow && target.maxRow <= b.maxRow) return;
    this.bounds = b
      ? { minCol: Math.min(b.minCol, target.minCol), maxCol: Math.max(b.maxCol, target.maxCol), minRow: Math.min(b.minRow, target.minRow), maxRow: Math.max(b.maxRow, target.maxRow) }
      : target;
    this.built = false;
  }

  private buildStatic(): void {
    const b = this.bounds!;
    clear(this.world);
    const minX = b.minCol * R * 1.5 - R * 2;
    const maxX = b.maxCol * R * 1.5 + R * 2;
    const minY = b.minRow * R * SQRT3 - R * 2;
    const maxY = (b.maxRow + 1) * R * SQRT3 + R * 2;

    const space = s('g', { class: 'stars' });
    space.append(s('rect', { x: minX, y: minY, width: maxX - minX, height: maxY - minY, class: 'space' }));
    // a star field made of fixed tiles, so growing the board never moves an existing star
    const TILE = 520;
    for (let ti = Math.floor(minX / TILE); ti <= Math.floor(maxX / TILE); ti++) {
      for (let tj = Math.floor(minY / TILE); tj <= Math.floor(maxY / TILE); tj++) {
        let seed = (Math.imul(ti, 73856093) ^ Math.imul(tj, 19349663)) >>> 0;
        const rand = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
        for (let i = 0; i < 7; i++) {
          space.append(s('circle', { cx: ti * TILE + rand() * TILE, cy: tj * TILE + rand() * TILE, r: 0.4 + rand() * 1.1, class: 'star', opacity: 0.25 + rand() * 0.6 }));
        }
      }
    }
    this.world.append(space);

    // every hex outline in one path: thousands of separate polygons would be slow
    const corners = [0, 1, 2, 3, 4, 5].map(corner);
    let d = '';
    const labels = s('g', { class: 'labels' });
    for (let col = b.minCol; col <= b.maxCol; col++) {
      for (let row = b.minRow; row <= b.maxRow; row++) {
        const hex = fromOffset(col, row);
        const { x, y } = hexToPixel(hex);
        d += `M${(x + corners[0]![0]).toFixed(1)} ${(y + corners[0]![1]).toFixed(1)}`;
        for (let i = 1; i < 6; i++) d += `L${(x + corners[i]![0]).toFixed(1)} ${(y + corners[i]![1]).toFixed(1)}`;
        d += 'Z';
        if (this.showLabels) labels.append(s('text', { class: 'hexlabel', x, y: y + 4 }, hexId(hex)));
      }
    }
    this.world.append(s('path', { d, class: 'hex' }));
    if (this.edges) this.drawEdges(this.edges.cols, this.edges.rows);
    this.world.append(labels, this.rockLayer, this.dynamic, this.fx);
    this.built = true;
    if (this.table) {
      this.area = { x0: minX, y0: minY, x1: maxX, y1: maxY };
      this.svg.style.width = `${(maxX - minX) * TABLE_SCALE}px`;
      this.svg.style.height = `${(maxY - minY) * TABLE_SCALE}px`;
      this.apply();
      this.table.layout(this.svg, this.area, TABLE_SCALE);
    }
  }

  /** The edge of a map that has edges: what lies beyond is dimmed, and a ship that flies out of the map has escaped. */
  private drawEdges(cols: number, rows: number): void {
    const x0 = -R;
    const x1 = (cols - 1) * R * 1.5 + R;
    const y0 = -R * SQRT3 / 2;
    const y1 = (rows - 1) * R * SQRT3 + R * SQRT3 * (cols > 1 ? 1 : 0.5);
    const b = this.bounds!;
    const bx0 = b.minCol * R * 1.5 - R * 2;
    const bx1 = b.maxCol * R * 1.5 + R * 2;
    const by0 = b.minRow * R * SQRT3 - R * 2;
    const by1 = (b.maxRow + 1) * R * SQRT3 + R * 2;
    const dim = s('path', { d: `M${bx0} ${by0}H${bx1}V${by1}H${bx0}Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`, 'fill-rule': 'evenodd', class: 'mapdim' });
    const frame = s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: 'mapedge' });
    this.world.append(dim, frame);
  }

  /** Text that rises from a hex and fades: damage, destruction. `slot` staggers several at the same ship. */
  popup(hex: Hex, text: string, kind: string, slot = 0): void {
    if (this.table) return this.table.popup(hex, text, kind, slot);
    const { x, y } = hexToPixel(hex);
    // the text keeps about the same size on screen however far the board is zoomed out
    const size = Math.max(15, 17 / this.scale) * (kind === 'kill' ? 1.3 : 1);
    const node = s('text', { class: `fxpop ${kind}`, x, y: y - R * 0.6 - slot * size * 1.1 }, text);
    node.style.fontSize = `${size}px`;
    node.style.strokeWidth = `${size / 4}px`;
    node.style.animationDelay = `${slot * 0.35}s`;
    this.fx.append(node);
    setTimeout(() => node.remove(), 3600 + slot * 350);
  }

  // ------------------------------------------------------------------ animation

  /** The drawn counters, by ship, so they can be moved without redrawing the board. */
  private nodes = new Map<string, { g: SVGGElement; body: SVGGElement; art?: { image: SVGImageElement; typeId: string; facing: number } }>();
  private poses = new Map<string, { x: number; y: number; angle: number; k: number }>();
  /** Ships that share a hex, shown side by side when `split` is on. */
  private slots = new Map<string, Slot>();
  private split = false;

  setSplit(on: boolean): void {
    this.split = on;
    if (this.overlay) this.render(this.overlay);
  }

  private put(id: string, x: number, y: number, angle: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const k = this.poses.get(id)?.k ?? 1;
    node.g.setAttribute('transform', `translate(${x} ${y})${k === 1 ? '' : ` scale(${k})`}`);
    if (node.art) {
      // one picture per facing: show the nearest, turned by what is left over (only while a ship is turning)
      const { facing, turn } = nearestFacing(angle);
      if (facing !== node.art.facing) {
        node.art.facing = facing;
        node.art.image.setAttribute('href', spriteUrl(node.art.typeId, facing)!);
      }
      node.art.image.setAttribute('transform', turn === 0 ? '' : `rotate(${turn})`);
    }
    node.body.setAttribute('transform', `rotate(${angle})`);
    this.poses.set(id, { x, y, angle, k });
  }

  /** Take a counter off the board (a ship that has been destroyed, or has left the map, in the middle of a move being played back). */
  removeCounter(id: string): void {
    this.table?.removeCounter(id);
    this.nodes.get(id)?.g.remove();
    this.nodes.delete(id);
    this.poses.delete(id);
    this.turretNodes.get(id)?.remove();
    this.turretNodes.delete(id);
  }

  /** The turret guns and the ground target as drawn, by id, so that one can be changed or taken off in the middle of a playback. */
  private turretNodes = new Map<string, SVGGElement>();

  /** A turret gun that has lost a gun is drawn again as it now is. */
  redrawTurret(game: GameState, id: string): void {
    const turret = game.emplacements?.find((e) => e.id === id);
    const old = this.turretNodes.get(id);
    if (!turret || !old) return;
    const g = this.emplacementNode(turret, turret.facing);
    if (this.table) g.querySelectorAll('image').forEach((image) => image.setAttribute('display', 'none'));
    old.replaceWith(g);
    this.turretNodes.set(id, g);
  }

  /** The centre of a hex in board units, for effects. */
  centre(hex: Hex): { x: number; y: number } {
    return hexToPixel(hex);
  }

  /** The glint of a turret gun firing: a flash at its muzzle. */
  private emplacementNode(turret: Emplacement, facing: number): SVGGElement {
    const { x, y } = hexToPixel(turret.pos);
    const g = turretCounter(turret, facing, R);
    g.setAttribute('transform', `translate(${x} ${y})`);
    return g;
  }

  /** Bring a counter in front of the others. */
  lift(id: string): void {
    const node = this.nodes.get(id);
    if (node) this.dynamic.append(node.g);
  }

  /** Slide a counter to a point and turn it to an angle (degrees; may run past 360 so it turns the short way). */
  async glide(id: string, to: { x: number; y: number }, angle: number, ms: number, ease?: (t: number) => number): Promise<void> {
    const from = this.poses.get(id);
    if (!from) return;
    if (this.table) {
      // the model flies (the view follows it); the counter, its foot on the table, goes along underneath
      const flown = this.table.glide(id, to, angle, ms, ease);
      void flown.then(() => this.put(id, to.x, to.y, angle));
      const start = performance.now();
      let done = false;
      void flown.then(() => (done = true));
      const under = (): void => {
        if (done) return;
        const t = Math.min(1, (performance.now() - start) / Math.max(1, ms * 1.25 * clock.factor));
        this.put(id, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.angle + (angle - from.angle) * t);
        requestAnimationFrame(under);
      };
      under();
      return flown;
    }
    await tween(ms, (t) => {
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      this.put(id, x, y, from.angle + (angle - from.angle) * t);
      this.follow(x, y);
    }, ease);
  }

  /** Effects keep about the same size on screen however far the board is zoomed out. */
  private get zoomBoost(): number {
    return Math.max(1, 0.8 / this.scale);
  }

  /** A shot flying from one hex to another, as the streak of its kind. A miss flies on past the target and fades. */
  /** The 3D view: a capital ship flies its move (on the flat board it is simply drawn where it has got to). */
  async glideCapital(id: string, to: Hex, angle: number, ms: number, ease?: (t: number) => number): Promise<void> {
    await this.table?.glideCapital(id, hexToPixel(to), angle, ms, ease);
  }

  /** How large the 3D view shows the fighters. */
  private shipScale = 1;
  setShipScale(k: number): void {
    if (k === this.shipScale) return;
    this.shipScale = k;
    this.table?.shipScale(k);
  }

  async bolt(from: Hex, to: Hex, color: string, hit: boolean, lane: number, kind: BoltKind = 'laser', ids?: ShotEnds): Promise<void> {
    if (this.table) return this.table.bolt(from, to, color, hit, lane, kind, ids);
    const name = `streak-${kind}`;
    if (!this.effects.has(name)) return this.boltPlain(from, to, color, hit, lane);
    const a = hexToPixel(from);
    const b = hexToPixel(to);
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / dist;
    const uy = (b.y - a.y) / dist;
    const k = this.zoomBoost;
    const ox = -uy * lane * 7 * k;
    const oy = ux * lane * 7 * k;
    const startAt = R * 0.55;
    const endAt = hit ? dist - R * 0.5 : dist + R * 2.4;
    const heavy = kind === 'torpedo' || kind === 'missile';
    const length = R * (heavy ? 2.8 : 2.3) * k;
    const thickness = length * (heavy ? 1.5 : 1.1);
    const angle = Math.atan2(uy, ux);
    const seconds = (130 + hexDistance(from, to) * 60) / 1000;
    await this.effects.play(
      name,
      (t) => {
        const head = startAt + (endAt - startAt) * t;
        const middle = head - length / 2;
        return { x: a.x + ux * middle + ox, y: a.y + uy * middle + oy, w: length, h: thickness, angle, alpha: hit || t < 0.7 ? 1 : (1 - t) / 0.3, frame: (t * 12) % 2 };
      },
      seconds,
    );
  }

  /** The plain line of a bolt, for when the pictures of the effects are not there. */
  private async boltPlain(from: Hex, to: Hex, color: string, hit: boolean, lane: number): Promise<void> {
    const a = hexToPixel(from);
    const b = hexToPixel(to);
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / dist;
    const uy = (b.y - a.y) / dist;
    const k = this.zoomBoost;
    const ox = -uy * lane * 7 * k;
    const oy = ux * lane * 7 * k;
    const startAt = R * 0.55;
    const endAt = hit ? dist - R * 0.5 : dist + R * 2.4;
    const length = R * 1.0 * k;
    const line = (width: number, stroke: string, opacity: number): SVGLineElement =>
      s('line', { 'stroke-width': width * k, stroke, 'stroke-linecap': 'round', opacity, 'pointer-events': 'none' });
    const glow = line(7, color, 0.45);
    const core = line(2.4, '#ffffff', 1);
    this.fx.append(glow, core);
    const place = (head: number, fade: number): void => {
      const tail = Math.max(startAt, head - length);
      for (const l of [glow, core]) {
        l.setAttribute('x1', String(a.x + ux * tail + ox));
        l.setAttribute('y1', String(a.y + uy * tail + oy));
        l.setAttribute('x2', String(a.x + ux * head + ox));
        l.setAttribute('y2', String(a.y + uy * head + oy));
      }
      glow.setAttribute('opacity', String(0.45 * fade));
      core.setAttribute('opacity', String(fade));
    };
    place(startAt, 1);
    await tween(130 + hexDistance(from, to) * 60, (t) => place(startAt + (endAt - startAt) * t, hit || t < 0.7 ? 1 : (1 - t) / 0.3));
    glow.remove();
    core.remove();
  }

  /**
   * The flash of a hit, and a puff by how much it did: blue for shields, orange for a hurt hull, white and big for a heavy blow; a torpedo or a
   * missile landing is an explosion, a broken asteroid a burst of dust. The target shudders.
   */
  async impact(hex: Hex, targetId?: string, look: HitLook = {}): Promise<void> {
    if (this.table) return this.table.impact(hex, targetId, look);
    sound.play(hitSound(look));
    if (!this.effects.has('puff-hull')) return this.impactPlain(hex, targetId);
    const { x, y } = hexToPixel(hex);
    const k = this.zoomBoost;
    if (targetId) void this.shake(targetId);
    if (look.weapon === 'torpedo') void this.effects.at('boom-ptn', x, y, R * 4.4 * k);
    else if (look.weapon === 'missile') void this.effects.at('boom-rkt', x, y, R * 3.8 * k);
    else {
      void this.effects.at(look.weapon === 'ion' ? 'flash-ion' : `flash-lsr-${1 + Math.floor(Math.random() * 6)}`, x, y, R * 2.6 * k);
      const puff = look.effect === 'rock' ? 'boom-trb' : look.effect === 'heavy' ? 'puff-heavy' : look.effect === 'shield' ? 'puff-shield' : 'puff-hull';
      void this.effects.at(puff, x, y, R * (look.effect === 'heavy' || look.effect === 'rock' ? 3.8 : 2.8) * k);
    }
    // the playback goes on while the puff burns out
    await tween(450, () => undefined);
  }

  /** The plain flash of a hit: a ring, a bright core and sparks. */
  private async impactPlain(hex: Hex, targetId?: string): Promise<void> {
    const { x, y } = hexToPixel(hex);
    const k = this.zoomBoost;
    const group = s('g', { transform: `translate(${x} ${y})`, 'pointer-events': 'none' });
    const ring = s('circle', { fill: 'none', stroke: '#ffb347', 'stroke-width': 3 * k });
    const core = s('circle', { fill: '#fff1b8' });
    const sparks = Array.from({ length: 8 }, (_, i) => {
      const angle = (Math.PI / 4) * i + 0.3;
      return { angle, line: s('line', { stroke: '#ffd27a', 'stroke-width': 2 * k, 'stroke-linecap': 'round' }) };
    });
    group.append(ring, core, ...sparks.map((p) => p.line));
    this.fx.append(group);
    if (targetId) void this.shake(targetId);
    await tween(460, (t) => {
      ring.setAttribute('r', String(R * k * (0.2 + 0.85 * t)));
      ring.setAttribute('opacity', String(1 - t));
      core.setAttribute('r', String(R * k * 0.5 * (1 - t)));
      for (const { angle, line } of sparks) {
        const r1 = R * k * (0.25 + 0.7 * t);
        const r2 = R * k * (0.45 + 1.0 * t);
        line.setAttribute('x1', String(Math.cos(angle) * r1));
        line.setAttribute('y1', String(Math.sin(angle) * r1));
        line.setAttribute('x2', String(Math.cos(angle) * r2));
        line.setAttribute('y2', String(Math.sin(angle) * r2));
        line.setAttribute('opacity', String(1 - t));
      }
    }, easeOut);
    group.remove();
  }

  /** A short shudder of a counter that has been hit. */
  private async shake(id: string): Promise<void> {
    const base = this.poses.get(id);
    if (!base) return;
    await tween(320, (t) => {
      const wobble = t >= 1 ? 0 : Math.sin(t * 28) * 3.5 * (1 - t);
      const node = this.nodes.get(id);
      node?.g.setAttribute('transform', `translate(${base.x + wobble} ${base.y - wobble * 0.5})${base.k === 1 ? '' : ` scale(${base.k})`}`);
    });
  }

  /** A burst of dust where an asteroid breaks or is destroyed. */
  rockBurst(x: number, y: number): void {
    if (this.table) return;
    void this.effects.at('boom-trb', x, y, R * 3.6 * this.zoomBoost);
  }

  /** The end of a ship: a fireball (gold, white or yellow, as it comes), and for a large ship the flash and smoke that go on after it. */
  explode(hex: Hex, large = false, soundId: string = large ? 'explode.large' : 'explode.fighter'): void {
    if (this.table) return this.table.explode(hex, large, soundId);
    sound.play(soundId);
    if (this.effects.has('shipfire-gld')) {
      const { x, y } = hexToPixel(hex);
      const colour = ['gld', 'wht', 'yel'][Math.floor(Math.random() * 3)]!;
      const k = this.zoomBoost;
      void this.effects.at(`shipfire-${colour}`, x, y, R * (large ? 8 : 5.6) * k);
      if (large) void this.effects.at(`shipsmoke-${colour}`, x, y, R * 9 * k);
      return;
    }
    const { x, y } = hexToPixel(hex);
    const k = this.zoomBoost;
    const group = s('g', { transform: `translate(${x} ${y})`, 'pointer-events': 'none' });
    const balls = [
      { c: s('circle', { fill: '#ff6a2b' }), size: 1.5, from: 0 },
      { c: s('circle', { fill: '#ffb347' }), size: 1.1, from: 0.08 },
      { c: s('circle', { fill: '#fff6d0' }), size: 0.7, from: 0.16 },
    ];
    const debris = Array.from({ length: 12 }, (_, i) => ({ angle: (Math.PI / 6) * i + (i % 2) * 0.2, line: s('line', { stroke: '#ffcf8a', 'stroke-width': 2.2 * k, 'stroke-linecap': 'round' }) }));
    group.append(...balls.map((b) => b.c), ...debris.map((d) => d.line));
    this.fx.append(group);
    void tween(950, (t) => {
      for (const b of balls) {
        const u = Math.max(0, (t - b.from) / (1 - b.from));
        b.c.setAttribute('r', String(R * k * b.size * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5)));
        b.c.setAttribute('opacity', String(u < 0.3 ? 1 : 1 - (u - 0.3) / 0.7));
      }
      for (const { angle, line } of debris) {
        const r1 = R * k * (0.3 + 1.6 * t);
        const r2 = R * k * (0.55 + 2.1 * t);
        line.setAttribute('x1', String(Math.cos(angle) * r1));
        line.setAttribute('y1', String(Math.sin(angle) * r1));
        line.setAttribute('x2', String(Math.cos(angle) * r2));
        line.setAttribute('y2', String(Math.sin(angle) * r2));
        line.setAttribute('opacity', String(1 - t));
      }
    }, easeOut).then(() => group.remove());
  }

  // ------------------------------------------------------------------ asteroids

  private rockSerial = 0;

  /**
   * An asteroid: the picture of a rock cut out by the outline of the hexes it covers (so every hex is filled and the shape reads at a glance),
   * a dark edge, and, with `info`, a marker at its centre of mass with its size, and a line to where it will be next turn if it drifts.
   */
  private buildRock(rock: Rock, info: boolean): SVGGElement {
    const g = s('g', { class: this.table ? 'rock flat' : 'rock' });
    const look = composeRock(rock, hexToPixel, R);
    const id = `rockclip-${this.rockSerial++}`;
    g.append(s('clipPath', { id }, s('path', { d: look.outline })));
    const inner = s('g', { 'clip-path': `url(#${id})` });
    inner.append(s('path', { d: look.outline, fill: look.base }));
    for (const part of look.parts) {
      inner.append(
        s('image', {
          href: rockUrl(part.model, part.view),
          x: -part.size / 2,
          y: -part.size / 2,
          width: part.size,
          height: part.size,
          transform: `translate(${part.x} ${part.y}) rotate(${part.angle})${part.flip ? ' scale(-1 1)' : ''}`,
          'pointer-events': 'none',
        }),
      );
    }
    // a dark rim just inside the edge gives the rock some body
    inner.append(s('path', { d: look.outline, class: 'rockshade' }));
    g.append(inner, s('path', { d: look.outline, class: 'rockedge' }));
    if (info) {
      const mark = s('g', { class: 'rockmark' });
      if (speedOf(rock.vel) > 0) {
        const d = hexToPixel(rock.vel);
        mark.append(s('line', { x1: look.centre.x, y1: look.centre.y, x2: look.centre.x + d.x, y2: look.centre.y + d.y }), s('circle', { class: 'rockend', cx: look.centre.x + d.x, cy: look.centre.y + d.y, r: 3 }));
      }
      mark.append(s('circle', { class: 'rockdot', cx: look.centre.x, cy: look.centre.y, r: 7.5 }), s('text', { x: look.centre.x, y: look.centre.y + 3.4 }, String(rock.hexes.length)));
      g.append(mark);
    }
    return g;
  }

  private drawRocks(o: Overlay): void {
    clear(this.rockLayer);
    this.rockNodes.clear();
    const field = o.game.asteroids;
    if (!field) return;
    const info = this.showRockPaths && !o.animating;
    // bigger ones first, so that the small ones lie on top
    for (const rock of [...field.rocks].sort((a, b) => b.hexes.length - a.hexes.length)) {
      const g = this.buildRock(rock, info);
      this.rockLayer.append(g);
      this.rockNodes.set(rock.id, { g, rock: structuredClone(rock), offset: { x: 0, y: 0 } });
    }
  }

  /** Play the asteroid movement of a command on the board as it stood before it: the asteroids drift, break, leave and come in. */
  async playRocks(frames: RockFrame[], afterFrame?: (index: number) => Promise<void>): Promise<void> {
    for (const node of this.rockNodes.values()) node.g.querySelector('.rockmark')?.remove();
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index]!;
      for (const rock of frame.born ?? []) {
        const g = this.buildRock(rock, false);
        g.setAttribute('opacity', '0');
        this.rockLayer.append(g);
        this.rockNodes.set(rock.id, { g, rock: structuredClone(rock), offset: { x: 0, y: 0 } });
        this.table?.rockSet(rock);
        void tween(300, (t) => g.setAttribute('opacity', String(t)));
      }
      const jobs: { node: { g: SVGGElement; rock: Rock; offset: { x: number; y: number } }; dx: number; dy: number; from: { x: number; y: number }; hexes: Hex[] }[] = [];
      for (const move of frame.moves ?? []) {
        const node = this.rockNodes.get(move.id);
        if (!node) continue;
        if (move.hexes.length !== node.rock.hexes.length) {
          // a piece broke off: the asteroid is drawn again in its new shape
          const rock = { ...node.rock, hexes: move.hexes.map((h) => ({ ...h })) };
          const centre = node.rock.hexes.map(hexToPixel);
          this.rockBurst(centre.reduce((sum, p) => sum + p.x, 0) / centre.length, centre.reduce((sum, p) => sum + p.y, 0) / centre.length);
          const g = this.buildRock(rock, false);
          node.g.replaceWith(g);
          this.rockNodes.set(move.id, { g, rock, offset: { x: 0, y: 0 } });
          this.table?.rockSet(rock);
          continue;
        }
        const a = hexToPixel(node.rock.hexes[0]!);
        const b = hexToPixel(move.hexes[0]!);
        jobs.push({ node, dx: b.x - a.x, dy: b.y - a.y, from: { ...node.offset }, hexes: move.hexes });
      }
      if (jobs.length > 0) {
        await tween(150, (t) => {
          for (const j of jobs) {
            j.node.g.setAttribute('transform', `translate(${j.from.x + j.dx * t} ${j.from.y + j.dy * t})`);
            this.table?.rockOffset(j.node.rock.id, j.from.x + j.dx * t, j.from.y + j.dy * t);
          }
        }, easeInOut);
        for (const j of jobs) {
          j.node.offset = { x: j.from.x + j.dx, y: j.from.y + j.dy };
          j.node.rock = { ...j.node.rock, hexes: j.hexes.map((h) => ({ ...h })) };
          // the next move is measured from here: the group already carries the shift
        }
      }
      for (const id of frame.gone ?? []) {
        const node = this.rockNodes.get(id);
        if (!node) continue;
        this.rockNodes.delete(id);
        this.table?.rockGone(id);
        const centre = node.rock.hexes.map(hexToPixel);
        this.rockBurst(centre.reduce((sum, p) => sum + p.x, 0) / centre.length + node.offset.x, centre.reduce((sum, p) => sum + p.y, 0) / centre.length + node.offset.y);
        void tween(250, (t) => node.g.setAttribute('opacity', String(1 - t))).then(() => node.g.remove());
      }
      // what this movement did to the ships is shown now
      await afterFrame?.(index);
    }
  }

  render(overlay: Overlay): void {
    this.overlay = overlay;
    this.ensureBounds(overlay);
    if (!this.built) this.buildStatic();
    clear(this.dynamic);
    this.drawRocks(overlay);
    this.nodes.clear();
    this.poses.clear();
    this.slots = this.split
      ? stackSlots(activeShips(overlay.game).filter((sh) => sh.pos && !overlay.hidden?.includes(sh.id)))
      : new Map();
    const layer = this.dynamic;
    const at = (hex: Hex): string => {
      const { x, y } = hexToPixel(hex);
      return `translate(${x} ${y})`;
    };
    const hexShape = (hex: Hex, cls: string) => s('polygon', { points: HEX_POINTS, class: cls, transform: at(hex) });

    for (const hex of overlay.zone ?? []) layer.append(hexShape(hex, 'zone'));

    if (overlay.zoneArrow) {
      const a = hexToPixel(overlay.zoneArrow.from);
      const b = hexToPixel(overlay.zoneArrow.to);
      const angle = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
      const arrow = s('g', { class: 'zonearrow', transform: `translate(${a.x} ${a.y}) rotate(${angle})` });
      arrow.append(s('polygon', { points: `0,${-R * 4} ${R * 3},${R * 2.2} ${-R * 3},${R * 2.2}` }));
      layer.append(arrow);
    }

    if (overlay.arc) {
      const sel = overlay.arc;
      const reach = sel.far ? 10 : 5;
      for (let dq = -reach; dq <= reach; dq++) {
        for (let dr = -reach; dr <= reach; dr++) {
          const hex = { q: sel.pos.q + dq, r: sel.pos.r + dr };
          if (canFireAt(sel.pos, sel.facing as 0, hex)) layer.append(hexShape(hex, 'arc'));
          else if (sel.far && specialReaches('PT', sel.pos, sel.facing as 0, hex)) layer.append(hexShape(hex, 'arcfar'));
        }
      }
    }

    // the forward arcs of turret guns: the danger zones
    for (const id of overlay.turretArcs ?? []) {
      const turret = overlay.game.emplacements?.find((e) => e.id === id && e.status === 'active');
      if (!turret) continue;
      const facing = overlay.turretDraft?.[id]?.facing ?? turret.facing;
      for (let dq = -10; dq <= 10; dq++) {
        for (let dr = -10; dr <= 10; dr++) {
          const hex = { q: turret.pos.q + dq, r: turret.pos.r + dr };
          if (!turretReaches({ pos: turret.pos, facing: facing as Facing }, hex)) continue;
          const cell = hexShape(hex, 'turretarc');
          cell.setAttribute('fill', SIDE_COLORS[turret.owner]);
          layer.append(cell);
        }
      }
    }

    // the range of fire of capital ships: they fire in every direction at a fighter within 10 hexes of any of their hexes; two ships in reach shade a hex twice
    for (const id of overlay.capitalRanges ?? []) {
      const d = overlay.game.destroyers?.find((x) => x.id === id && !x.exploded && !x.escaped);
      if (!d?.pos) continue;
      const own = hexesOf(d);
      // fighters within 10 hexes are shot at, capital ships within the range of its kind (20, or 15 for a frigate): the second zone is shaded more faintly
      const far = specOf(d).range;
      for (let dq = -(far + 4); dq <= far + 4; dq++) {
        for (let dr = -(far + 4); dr <= far + 4; dr++) {
          const hex = { q: d.pos.q + dq, r: d.pos.r + dr };
          const dist = Math.min(...own.map((h) => hexDistance(h, hex)));
          if (dist > far) continue;
          const cell = hexShape(hex, dist <= 10 ? 'turretarc' : 'turretarc far');
          cell.setAttribute('fill', SIDE_COLORS[d.owner]);
          layer.append(cell);
        }
      }
    }

    // asteroids that can be shot at: their hexes outlined, with the chance to hit
    for (const id of overlay.rockTargets ?? []) {
      const rock = overlay.game.asteroids?.rocks.find((r) => r.id === id);
      if (!rock) continue;
      const aimed = overlay.rockAimed?.includes(id);
      for (const hex of rock.hexes) layer.append(hexShape(hex, `rocktarget${aimed ? ' aimed' : ''}`));
      const label = overlay.rockLabels?.[id];
      if (label) {
        const p = hexToPixel(rock.hexes[Math.floor(rock.hexes.length / 2)]!);
        const tag = this.chanceTag(label);
        tag.setAttribute('transform', `translate(${p.x} ${p.y})`);
        layer.append(tag);
      }
    }

    // tailing lines
    for (const a of activeShips(overlay.game)) {
      for (const b of activeShips(overlay.game)) {
        if (!overlay.hidden?.length && !overlay.animating && tails(a, b)) {
          const pa = hexToPixel(a.pos!);
          const pb = hexToPixel(b.pos!);
          layer.append(s('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: 'tail' }));
        }
      }
    }

    if (overlay.ray) this.drawRay(layer, overlay.ray);

    if (overlay.ghost) {
      const pts = [overlay.ghost.path[0] ?? overlay.ghost.pos, ...overlay.ghost.path.slice(1), overlay.ghost.pos].map(hexToPixel);
      layer.append(s('polyline', { class: 'path', points: pts.map((p) => `${p.x},${p.y}`).join(' ') }));
    }


    for (const { hex } of overlay.stepHexes ?? []) layer.append(hexShape(hex, 'step'));

    this.drawEmplacements(layer, overlay);
    this.drawDestroyers(layer, overlay);

    for (const ship of activeShips(overlay.game)) {
      if (!ship.pos || overlay.hidden?.includes(ship.id)) continue;
      layer.append(this.counter(ship, ship.pos, ship.facing, {
        selected: overlay.selected === ship.id,
        active: overlay.activeShipId === ship.id,
        target: overlay.targets?.includes(ship.id) ?? false,
        aimed: overlay.aimed?.includes(ship.id) ?? false,
        targetLabel: overlay.targetLabels?.[ship.id],
        ghosted: overlay.ghost?.ship.id === ship.id,
        dimmed: overlay.dimmed?.includes(ship.id) ?? false,
        slot: this.slots.get(ship.id),
      }));
    }
    for (const p of overlay.placements ?? []) {
      layer.append(this.counter(p.ship, p.pos, p.facing, { selected: overlay.selected === p.ship.id, active: false, target: false, ghosted: false }));
    }
    if (overlay.ghost) {
      layer.append(this.counter(overlay.ghost.ship, overlay.ghost.pos, overlay.ghost.facing, { selected: false, active: false, target: false, ghosted: false, ghost: true }));
    }

    // road signs on the asteroid hexes the moving ship crosses
    for (const w of overlay.rockWarnings ?? []) layer.append(this.warningSign(w));

    if (overlay.confirm) {
      const { x, y } = hexToPixel(overlay.confirm.pos);
      const buttons = drawSubmitButtons((action) => this.handlers.onSubmitClick(action));
      buttons.setAttribute('transform', `translate(${x} ${y})`);
      layer.append(buttons);
    }

    if (overlay.choose) {
      const { x, y } = hexToPixel(overlay.choose.pos);
      const button = drawChooseButton(() => this.handlers.onChooseClick());
      button.setAttribute('transform', `translate(${x} ${y})`);
      layer.append(button);
    }

    if (overlay.turn) {
      const { x, y } = hexToPixel(overlay.turn.pos);
      const arrows = drawTurnArrows(overlay.turn.facing, (action) => this.handlers.onRingClick(action));
      arrows.setAttribute('transform', `translate(${x} ${y}) ${arrows.getAttribute('transform')}`);
      layer.append(arrows);
    }

    if (overlay.ring) {
      const { x, y } = hexToPixel(overlay.ring.pos);
      const ring = drawMoveRing(overlay.ring.facing, overlay.ring.buttons, (action) => this.handlers.onRingClick(action));
      ring.setAttribute('transform', `translate(${x} ${y}) ${ring.getAttribute('transform')}`);
      layer.append(ring);
    }

    // the speed arrows of the capital ship that is being moved, above the ring: its pads would catch the clicks on the arrow astern of a small ship
    if (overlay.destroyerSpeed && !overlay.animating) {
      const d = overlay.game.destroyers?.find((x) => x.id === overlay.destroyerSpeed!.id);
      if (d?.pos) layer.append(this.speedArrows(destroyerHexes(d.pos, d.facing, specOf(d).kind), d.facing, overlay.destroyerSpeed));
    }

    if (this.table) {
      // in the 3D view the ships are models over the table: of their counters only the foot stays (the disc in the side's colour, the marks, the name)
      // (also of the counter that shows where a planned move ends: the model is there)
      // and of the turret guns, the ground target and the capital ships: they stand on the table as models
      this.svg.querySelectorAll('.ship image, .turret image, .groundtarget image, .sd image').forEach((image) => image.setAttribute('display', 'none'));
      this.table.render(overlay);
    }
  }

  /**
   * The speed ray: a line straight ahead as long as the speed, a dot in every hex, and a ring on the
   * first hex where the ship may turn (after as many hexes as its turn number). From there on it may
   * turn after each hex it has moved, so those dots are green. A turn number above the speed means no turn this move.
   */
  private drawRay(layer: SVGGElement, ray: NonNullable<Overlay['ray']>): void {
    if (ray.speed < 1) return;
    const hexes: Hex[] = [];
    let p = ray.pos;
    for (let i = 0; i < ray.speed; i++) {
      p = neighbor(p, ray.facing as Facing);
      hexes.push(p);
    }
    const a = hexToPixel(ray.pos);
    const end = hexToPixel(hexes[hexes.length - 1]!);
    layer.append(s('line', { x1: a.x, y1: a.y, x2: end.x, y2: end.y, class: 'rayline' }));
    // `gate` is given when the caller knows better than the turn number, as for a ship part-way through its move
    const gate = ray.gate !== undefined ? ray.gate : Math.max(1, Math.ceil(ray.turn));
    const gateHex = gate !== null && gate >= 1 && gate <= ray.speed ? hexes[gate - 1] : undefined;
    if (gateHex) {
      const { x, y } = hexToPixel(gateHex);
      layer.append(s('circle', { cx: x, cy: y, r: R * 0.5, class: 'raygate' }), s('text', { class: 'raytext', x: x + R * 1.3, y: y + 4 }, 'may turn'));
    }
    layer.append(s('polygon', { points: '0,-10 7,6 -7,6', class: 'rayhead', transform: `translate(${end.x} ${end.y}) rotate(${ray.facing * 60})` }));
    layer.append(s('text', { class: 'raytext', x: end.x + R * 1.3, y: end.y + (gate === ray.speed ? 20 : 4) }, ray.label ?? `speed ${ray.speed}`));
    if (!gateHex && gate !== 0) layer.append(s('text', { class: 'raytext warn', x: end.x + R * 1.3, y: end.y + 20 }, ray.gate === undefined ? `can’t turn (turn number ${ray.turn === 0.5 ? '½' : ray.turn})` : 'can’t turn this move'));
  }

  private counter(
    ship: Ship,
    pos: Hex,
    facing: number,
    o: { selected: boolean; active: boolean; target: boolean; aimed?: boolean; targetLabel?: string; ghosted: boolean; ghost?: boolean; dimmed?: boolean; slot?: Slot },
  ): SVGGElement {
    const base = hexToPixel(pos);
    const k = o.slot?.k ?? 1;
    const x = base.x + (o.slot?.dx ?? 0) * R;
    const y = base.y + (o.slot?.dy ?? 0) * R;
    const color = SIDE_COLORS[ship.owner];
    const classes = ['ship'];
    if (ship.moved) classes.push('moved');
    if (o.ghosted) classes.push('faded');
    if (o.ghost) classes.push('ghost');
    if (o.dimmed) classes.push('submitted');
    const g = s('g', { class: classes.join(' '), transform: `translate(${x} ${y})${k === 1 ? '' : ` scale(${k})`}` });
    if (o.target) g.append(s('circle', { r: R * 0.95, class: `targetring${o.aimed ? ' aimed' : ''}` }));
    if (o.active) g.append(s('circle', { r: R * 0.95, class: 'activering' }));
    if (o.selected) g.append(s('circle', { r: R * 0.88, class: 'selring' }));
    const spriteId = SPRITE_OF[ship.typeId];
    const sprite = spriteId ? this.sprites.get(spriteId) : undefined;
    const label = `${SHORT_NAMES[ship.typeId] ?? '?'}${ship.idNumber}`;
    const body = s('g', { transform: `rotate(${facing * 60})` });
    let art: { image: SVGImageElement; typeId: string; facing: number } | undefined;
    if (sprite && spriteId && FACING_SPRITES.has(spriteId)) art = { image: s('image', {}) as SVGImageElement, typeId: ship.typeId, facing: ((facing % 6) + 6) % 6 };
    if (!o.ghost) {
      this.nodes.set(ship.id, { g, body, art });
      this.poses.set(ship.id, { x, y, angle: facing * 60, k });
    }
    if (sprite && spriteId) {
      // the picture sits on a disc in the side's colour, which also keeps dark ships visible against space
      g.append(s('circle', { r: R * 0.93, class: 'disc', fill: color, stroke: color }));
      const k = (R * 1.75 * (SPRITE_SCALE[spriteId] ?? 1)) / Math.max(sprite.w, sprite.h);
      const w = sprite.w * k;
      const h = sprite.h * k;
      if (art) {
        // drawn upright beside the turning body, so the lighting stays put when the ship turns
        for (const [name, value] of Object.entries({ href: spriteUrl(ship.typeId, art.facing)!, x: -w / 2, y: -h / 2, width: w, height: h })) art.image.setAttribute(name, String(value));
        g.append(art.image);
      } else {
        body.append(s('image', { href: spriteUrl(ship.typeId)!, x: -w / 2, y: -h / 2, width: w, height: h }));
      }
      body.append(s('circle', { cx: 0, cy: -R * 0.93, r: 3.2, class: 'nose' }));
      if (!o.ghost) body.append(this.statusMarks(ship));
      g.append(body);
      g.append(s('text', { class: 'counterlabel small', y: R * 1.82 }, label));
      if (o.targetLabel) g.append(this.chanceTag(o.targetLabel));
      return g;
    }
    body.append(
      s('polygon', {
        points: `0,${-R * 0.82} ${R * 0.55},${R * 0.55} 0,${R * 0.22} ${-R * 0.55},${R * 0.55}`,
        fill: color,
        class: 'hull',
      }),
    );
    // a bright dot on the nose, so the direction of travel is clear at any zoom
    body.append(s('circle', { cx: 0, cy: -R * 0.7, r: 3.6, class: 'nose' }));
    if (!o.ghost) body.append(this.statusMarks(ship));
    g.append(body);
    g.append(s('text', { class: 'counterlabel', y: R * 0.08 }, label));
    if (o.targetLabel) g.append(this.chanceTag(o.targetLabel));
    return g;
  }

  /** The turret guns and the ground target: counters in the hexes, rings round those that can be shot at or given orders, and the tracking lines. */
  /** The ground target and the guns still being placed by the defender, with the selected item marked. */
  private drawBaseItems(layer: SVGGElement, o: Overlay): void {
    for (const item of o.baseItems ?? []) {
      const { x, y } = hexToPixel(item.pos);
      if (item.kind === 'ground') {
        const g = groundCounter({ id: 'GT', owner: item.owner, pos: item.pos, damage: 0, status: 'active' }, R);
        g.setAttribute('transform', `translate(${x} ${y})`);
        layer.append(g);
      } else {
        for (const gun of itemGuns(item.kind, item)) {
          const t = hexToPixel(gun.pos);
          const g = turretCounter({ id: '', owner: item.owner, kind: gun.kind, pos: gun.pos, facing: gun.facing, skill: { dice: 5, pips: 0 }, status: 'active', fired: false, tracking: null, chance: null }, gun.facing, R);
          g.setAttribute('transform', `translate(${t.x} ${t.y})`);
          layer.append(g);
        }
        if (item.kind === 'base') layer.append(s('circle', { cx: x, cy: y, r: R * 0.5, class: 'basecentre' }));
      }
      if (o.selected === item.id) layer.append(s('circle', { cx: x, cy: y, r: R * (item.kind === 'base' ? 0.5 : 1.05), class: 'baseselected' }));
    }
  }

  private drawEmplacements(layer: SVGGElement, o: Overlay): void {
    this.turretNodes.clear();
    this.drawBaseItems(layer, o);
    const game = o.game;
    for (const turret of game.emplacements ?? []) {
      if (turret.status !== 'active') continue;
      const draft = o.turretDraft?.[turret.id];
      const { x, y } = hexToPixel(turret.pos);
      if (turret.tracking && !o.animating) {
        const ship = game.ships.find((sh) => sh.id === turret.tracking!.target && sh.status === 'active' && sh.pos);
        if (ship?.pos) {
          const b = hexToPixel(ship.pos);
          layer.append(s('line', { x1: x, y1: y, x2: b.x, y2: b.y, class: 'turrettrack', stroke: SIDE_COLORS[turret.owner] }));
        }
      }
      if (draft?.target) {
        const ship = game.ships.find((sh) => sh.id === draft.target && sh.pos);
        if (ship?.pos) {
          const b = hexToPixel(ship.pos);
          layer.append(s('line', { x1: x, y1: y, x2: b.x, y2: b.y, class: 'turrettrack draft', stroke: SIDE_COLORS[turret.owner] }));
        }
      }
      const g = this.emplacementNode(turret, draft?.facing ?? turret.facing);
      const aimed = o.turretAimed?.includes(turret.id) ?? false;
      if (o.turretTargets?.includes(turret.id)) g.prepend(s('circle', { r: R * 0.95, class: `targetring${aimed ? ' aimed' : ''}` }));
      if (o.turretClickable?.includes(turret.id)) g.prepend(s('circle', { r: R * 0.9, class: `turretpick${o.turretSelected === turret.id ? ' sel' : ''}` }));
      if (turret.tracking && !o.animating) {
        const badge = s('g', { class: 'turretbadge', transform: `translate(${R * 0.62} ${-R * 0.62})` });
        badge.append(s('circle', { r: 8.5 }), s('text', { y: 3.5 }, turret.tracking.level === 2 ? '−10' : '−5'));
        g.append(badge);
      }
      const label = o.turretLabels?.[turret.id];
      if (label) g.append(this.chanceTag(label));
      this.turretNodes.set(turret.id, g);
      layer.append(g);
    }
    const ground = game.groundTarget;
    if (ground?.status === 'active') {
      const { x, y } = hexToPixel(ground.pos);
      const g = groundCounter(ground, R);
      g.setAttribute('transform', `translate(${x} ${y})`);
      if (o.turretTargets?.includes(ground.id)) g.prepend(s('circle', { r: R * 0.95, class: `targetring${o.turretAimed?.includes(ground.id) ? ' aimed' : ''}` }));
      const label = o.turretLabels?.[ground.id];
      if (label) g.append(this.chanceTag(label));
      this.turretNodes.set(ground.id, g);
      layer.append(g);
    }
  }

  // ---- Star Destroyers (Rules: Star Destroyers)

  private drawDestroyers(layer: SVGGElement, o: Overlay): void {
    for (const d of o.game.destroyers ?? []) {
      if (d.exploded) continue;
      const placed = o.destroyerPlacements?.find((p) => p.id === d.id);
      const pos = placed?.pos ?? d.pos;
      const facing = (placed?.facing ?? d.facing) as Facing;
      if (!pos) continue;
      // while it is being moved it stays where it is, and a ghost shows where it would end
      layer.append(this.destroyerNode(d, pos, facing, { target: o.destroyerTargets?.includes(d.id) ?? false, aimed: o.destroyerAimed?.includes(d.id) ?? false, label: o.destroyerLabels?.[d.id], ghost: false, moving: o.destroyerGhost?.id === d.id, selected: o.destroyerSelected === d.id }));
    }
    const ghost = o.destroyerGhost;
    if (ghost) {
      const d = o.game.destroyers?.find((x) => x.id === ghost.id);
      if (d) {
        const pts = [...ghost.path, ghost.pos].map(hexToPixel);
        layer.append(s('polyline', { class: 'path', points: pts.map((p) => `${p.x},${p.y}`).join(' ') }));
        layer.append(this.destroyerNode(d, ghost.pos, ghost.facing as Facing, { target: false, aimed: false, ghost: true, moving: false }));
      }
    }
  }

  /** The two arrows in the body of a Star Destroyer that is being moved, one pointing ahead (faster) and one astern (slower), with the speed between them. */
  private speedArrows(hexes: Hex[], facing: Facing, speed: NonNullable<Overlay['destroyerSpeed']>): SVGGElement {
    const centre = hexes.reduce((a, h) => ({ x: a.x + hexToPixel(h).x / hexes.length, y: a.y + hexToPixel(h).y / hexes.length }), { x: 0, y: 0 });
    const g = s('g', { class: 'ring sdspeed', transform: `translate(${centre.x} ${centre.y})`, 'pointer-events': 'all' });
    const arrow = (direction: 'up' | 'down', enabled: boolean, title: string): void => {
      const b = s('g', { class: `ringbtn rb-move${enabled ? '' : ' off'}`, transform: `translate(0 ${direction === 'up' ? -R * 0.95 : R * 0.95})` });
      b.append(
        s('title', null, title),
        s('circle', { class: 'pad', r: 13 }),
        s('polygon', { class: 'glyph', points: direction === 'up' ? '0,-9 8,6 -8,6' : '0,9 8,-6 -8,-6' }),
      );
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (enabled) this.handlers.onSpeedClick?.(direction);
      });
      g.append(b);
    };
    const frozen = 'The speed is frozen once the move has begun: undo the move to change it';
    arrow('up', speed.up, speed.up ? 'Speed up' : speed.locked ? frozen : 'It can’t go any faster (this game-turn)');
    arrow('down', speed.down, speed.down ? 'Slow down' : speed.locked ? frozen : 'It can’t slow down any more (this game-turn)');
    g.append(s('text', { class: 'sdspeedtext', y: 5, 'text-anchor': 'middle' }, speed.chosen === speed.now ? speedText(speed.chosen) : `${speedText(speed.now)}→${speedText(speed.chosen)}`));
    // the arrows turn with the ship, the figure stays upright
    const turned = s('g', { transform: `rotate(${facing * 60})` });
    for (const child of Array.from(g.querySelectorAll('.ringbtn'))) turned.append(child);
    g.prepend(turned);
    return g;
  }

  /** One Star Destroyer: its eight hexes, an outline round the whole, the nose, and its name with the structure points it has left. */
  private destroyerNode(d: Destroyer, pos: Hex, facing: Facing, look: { target: boolean; aimed: boolean; label?: string | undefined; ghost: boolean; moving: boolean; selected?: boolean }): SVGGElement {
    const color = SIDE_COLORS[d.owner];
    const spec = specOf(d);
    const hexes = destroyerHexes(pos, facing, spec.kind);
    const inside = new Set(hexes.map((h) => `${h.q},${h.r}`));
    const dead = d.lost >= spec.deadAt;
    const silent = d.lost >= spec.silentAt;
    const g = s('g', { class: `sd${look.ghost ? ' ghost' : ''}${look.moving ? ' moving' : ''}${silent ? ' silent' : ''}${dead ? ' dead' : ''}${look.selected ? ' selected' : ''}`, 'data-sd': d.id });
    for (const h of hexes) {
      const { x, y } = hexToPixel(h);
      g.append(s('polygon', { points: HEX_POINTS, class: 'sdhex', fill: color, transform: `translate(${x} ${y})` }));
    }
    // the picture of the model for this facing (tools/assemble-destroyer.cjs): a square with the ship's centre in the middle, put on the middle of the eight hexes
    const picture = CAPITAL_PICTURE[spec.kind];
    const span = picture.span * R;
    const height = span * picture.stretch;
    const nosePx = hexToPixel(pos);
    const angle = (facing * Math.PI) / 3;
    const back = picture.centre * R;
    const offset = picture.offsets[facing]!;
    const middle = { x: nosePx.x - back * Math.sin(angle) - offset[0] * span, y: nosePx.y + back * Math.cos(angle) - offset[1] * height };
    g.append(s('image', { href: `${import.meta.env.BASE_URL}assets/ships/${picture.file}-f${facing}.png`, x: middle.x - span / 2, y: middle.y - height / 2, width: span, height, preserveAspectRatio: 'none', 'pointer-events': 'none' }));
    // the outline: every side of a hex whose neighbour is not part of the ship
    const edge: string[] = [];
    for (const h of hexes) {
      const { x, y } = hexToPixel(h);
      for (let k = 0; k < 6; k++) {
        const n = neighbor(h, ((k + 2) % 6) as Facing);
        if (inside.has(`${n.q},${n.r}`)) continue;
        const [x1, y1] = corner(k);
        const [x2, y2] = corner(k + 1);
        edge.push(`M${x + x1} ${y + y1}L${x + x2} ${y + y2}`);
      }
    }
    g.append(s('path', { d: edge.join(''), class: 'sdoutline', stroke: color }));
    if (look.target) {
      for (const h of hexes) {
        const { x, y } = hexToPixel(h);
        g.append(s('polygon', { points: HEX_POINTS, class: `sdtarget${look.aimed ? ' aimed' : ''}`, transform: `translate(${x} ${y})` }));
      }
    }
    // the name and the structure points left, in the middle of the ship
    const centre = hexes.reduce((a, h) => ({ x: a.x + hexToPixel(h).x / hexes.length, y: a.y + hexToPixel(h).y / hexes.length }), { x: 0, y: 0 });
    const left = structureLeft(d);
    // while it is being moved the speed arrows are where the name would be
    if (!look.moving) {
      g.append(
        s('text', { class: 'sdlabel', x: centre.x, y: centre.y - 4, 'text-anchor': 'middle' }, `${spec.tag}${d.idNumber}`),
        s('text', { class: 'sdstate', x: centre.x, y: centre.y + 14, 'text-anchor': 'middle' }, dead ? 'dead in space' : silent ? 'guns out' : `${left}/${spec.structure}`),
      );
    }
    if (look.label) {
      const tag = this.chanceTag(look.label);
      tag.setAttribute('transform', `translate(${centre.x} ${centre.y - R * 1.1})`);
      g.append(tag);
    }
    return g;
  }

  /** A warning triangle with an exclamation mark, and under it the chance of the piloting roll succeeding. */
  private warningSign(w: { hex: Hex; chance: number; label: string; ahead: boolean }): SVGGElement {
    const { x, y } = hexToPixel(w.hex);
    const k = (w.ahead ? 0.8 : 1) * this.zoomBoost;
    const g = s('g', { class: `rocksign${w.ahead ? ' ahead' : ''}`, transform: `translate(${x - R * 0.3 * k} ${y - R * 0.3 * k}) scale(${k})`, 'pointer-events': 'none' });
    g.append(s('polygon', { points: '0,-14 14,10 -14,10', class: 'signtri' }), s('text', { class: 'signmark', x: 0, y: 7 }, '!'));
    const tone = w.chance >= 0.8 ? 'good' : w.chance >= 0.5 ? 'fair' : 'poor';
    const width = 10 + w.label.length * 7.2;
    g.append(s('rect', { x: -width / 2, y: 14, width, height: 16, rx: 8, class: `signtag ${tone}` }), s('text', { class: 'signpct', x: 0, y: 26 }, w.label));
    return g;
  }

  /** The chance to hit a target, as a small tag above its counter. */
  private chanceTag(text: string): SVGGElement {
    const tag = s('g', { class: 'chancetag', 'pointer-events': 'none' });
    const w = 9 + text.length * 7.2;
    tag.append(s('rect', { x: -w / 2, y: -R * 1.62, width: w, height: 17, rx: 8.5 }), s('text', { y: -R * 1.62 + 12.5 }, text));
    return tag;
  }

  /**
   * Shields and hull, drawn in the ship's own frame so they turn with it: shield cells as arcs on the
   * rim of the disc, front markers at the nose and rear markers at the tail, and the hull as a row of
   * cells docked behind the ship.
   */
  private statusMarks(ship: Ship): SVGGElement {
    const type = typeOf(ship);
    const g = s('g', { class: 'statusmarks' });
    const point = (r: number, deg: number): string => {
      const a = (deg * Math.PI) / 180;
      return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
    };
    // only the markers a ship still has are drawn, each box shared out over its whole arc (a lost shield cannot be repaired, so no empty cells)
    const arc = (centre: number, cells: number, span = 124): void => {
      if (cells <= 0) return;
      const gap = cells > 1 ? Math.min(15, span / (cells * 1.5)) : 0;
      const size = (span - gap * (cells - 1)) / cells;
      const r = R * 1.04;
      for (let i = 0; i < cells; i++) {
        const from = centre - span / 2 + i * (size + gap);
        g.append(s('path', { d: `M${point(r, from)} A${r} ${r} 0 0 1 ${point(r, from + size)}`, class: 'sharc on' }));
      }
    };
    if (type.shields !== null) {
      // with the advanced arcs a big ship has shields on its flanks too, so the four arcs are shorter (Rules: Advanced arcs)
      const wide = !!this.overlay && hasSideQuarters(this.overlay.game, ship);
      const span = wide ? 76 : 124;
      arc(0, ship.shields.front, span);
      arc(180, ship.shields.rear, span);
      if (wide) {
        arc(90, ship.shields.right, span);
        arc(270, ship.shields.left, span);
      }
    }
    const hull = bodyRating(this.overlay?.game ?? {}, type);
    const left = Math.max(0, hull - ship.bodyDamage);
    const tone = left / hull > 0.5 ? 'good' : left / hull > 0.25 ? 'warn' : 'bad';
    const width = Math.min(R * 1.5, hull * 7);
    const cell = width / hull;
    for (let i = 0; i < hull; i++) {
      g.append(s('rect', { x: -width / 2 + i * cell, y: R * 1.28, width: Math.max(1.5, cell - 1.4), height: 4, rx: 1, class: `mb ${i < left ? tone : 'gone'}` }));
    }
    return g;
  }
}


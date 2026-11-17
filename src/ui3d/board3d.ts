import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { activeShips, fromOffset, hexDistance, hexEquals, hexesOf, itemGuns, rockAt, specOf, type CapitalKind, type GameState, type Hex, type Rock, type RockFrame } from '../engine';
import { composeRock } from '../ui/rocks';
import type { Table, TableArea } from '../ui/board';
import { clock, tween } from '../ui/anim';
import { capitalCentre, HEX_R as R, SPRITE_OF, hexToPixel, type BoltKind, type HitLook, type Overlay } from '../ui/board';
import { SIDE_COLORS } from '../ui/colours';
import type { FlightPose, PlaybackBoard } from '../ui/playback';
import { legAngle, legLength, legPoint, legSlide, planFlight, type FlightStep } from './flight';
import { sound } from '../ui/sound';
import { hitSound } from '../ui/soundmap';

/*
 * The board in three dimensions. The hexes lie on the ground plane, a board unit being the same as on the flat board (x across, z down
 * the map); the ships are the models the flat board's pictures were taken of (public/assets/models, made by tools/model-pack.mjs), flying
 * a little above their hex on a thin stand, the way miniatures do. It has the same handles as the flat board for playing a command back
 * (see `PlaybackBoard`), so the playback and its sounds are the very same code.
 *
 * It is used in two ways. On its own (the test page, 3d.html) it draws a plain grid and only shows a game. In the game it is the 3D view
 * of the flat board (`table` mode): the flat board itself, with everything it draws and every button on it, is laid down as the table
 * (the browser draws it in perspective, under the picture of the ships), so planning, aiming and moving work as they do on the flat board,
 * and the flat board asks this one where the pointer is and passes it the camera moves (see `Table` in ui/board.ts).
 */

/**
 * How high the ships fly over the board, and how much higher each further ship in the same hex. The height is the lowest at which the
 * largest of them, the Lambda shuttle with its wings down, is clear of the board.
 */
const HEIGHT = R * 2.4;
const STACK = R * 0.75;
const SQRT3 = Math.sqrt(3);
/** How far a ship sinks coming into a half loop, and the radius of the half circle it then flies. */
const DIP = R * 0.35;
const LOOP_RADIUS = R * 0.8;
/** How steeply the camera looks down at the board when it is not straight above it, in degrees; and how low and how high it can go. */
const TILT = 40;
const LOWEST = 14;
const HIGHEST = 89.5;
/** How near and how far the camera can be from the point it looks at. */
const NEAREST = R * 3;
const FARTHEST = R * 90;
/**
 * The models are made in metres, all to the same scale (an X-wing is 12.5 long, the Falcon 35), and are shown that way, so that the ships
 * are in scale with each other. (The pictures of the flat board have sizes of their own, see `SPRITE_SCALE` in ui/board.ts: there every
 * ship has to fit its counter.) This is a metre in board units: an X-wing is a little longer than a hex is wide.
 */
const METRE = (R * 2.1) / 12.5;
/**
 * Ships longer or wider than this many metres are drawn smaller than they are, by this much of what they are over it: at its true size a
 * freighter would lie over three hexes.
 */
const FULL_SCALE_TO = 17;
const BEYOND = 0.5;
/** How wide a turret gun's base and the ground target stand on the board, and how high over it the shots at them and from them fly. */
const TURRET_WIDTH = R * 1.25;
const GROUND_WIDTH = R * 1.7;
const BASE_HEIGHT = R * 0.7;
/** How high over the board the middle of an asteroid is: under the ships, which fly through the field over the rocks. */
const ROCK_HEIGHT = R * 0.95;
/** How see-through a capital ship is while something is behind it, or while it is aimed at or being moved. */
const SEE_THROUGH = 0.38;

/** How large the capital ships are, in hex radii across (the Star Destroyer) or in hex heights long (the others). */
const CAPITAL_SIZE: Record<CapitalKind, { width?: number; length?: number }> = {
  'star-destroyer': { width: 6.8 },
  'mon-calamari': { length: 7.2 },
  'nebulon-b': { length: 3.2 },
};

/** What stands on the board: the turret guns (the double one also with a gun shot away), the ground target, the capital ships. */
type FixtureKind = 'turret-single' | 'turret-double' | 'turret-reduced' | 'ground' | CapitalKind;
/** The model file of each, the piece of it that is shown (the file of the base holds two), and the part that stands still while the rest turns. */
const FIXTURES: Record<FixtureKind, { file: string; piece?: string; fixed?: string; turn?: number }> = {
  'turret-single': { file: 'turret-single', fixed: 'Base' },
  // the twin cannon points along +X in the model
  'turret-double': { file: 'base-parts', piece: 'CannonTower', fixed: 'CannonTowerBase_0', turn: -Math.PI / 2 },
  'turret-reduced': { file: 'base-parts', piece: 'CannonTower', fixed: 'CannonTowerBase_0', turn: -Math.PI / 2 },
  ground: { file: 'base-parts', piece: 'Cube000' },
  'star-destroyer': { file: 'star-destroyer' },
  'mon-calamari': { file: 'mon-calamari' },
  'nebulon-b': { file: 'nebulon-b' },
};

interface Fixture {
  kind: FixtureKind;
  group: THREE.Group;
  /** A gun or the ground target: how high over the board its turning part is (shots leave from there and arrive there). */
  muzzle?: number;
  /** A capital ship: the hex point it turns on and its angle (degrees), its own materials (it can be seen through), and how far across it is. */
  capital?: { x: number; y: number; angle: number; materials: THREE.Material[]; opacity: number; marked: boolean; reach: number };
}

/** An asteroid: a lump of rock over each of its hexes. `key` is the hexes it was built for. */
interface RockNode {
  group: THREE.Group;
  key: string;
}

/** How long a planned step takes the model, in milliseconds. */
const PLAN_STEP = 260;

interface ShipNode {
  holder: THREE.Group;
  /** Turns to the ship's facing. */
  yaw: THREE.Group;
  /** Rolls and pitches: the bank of a turn, the half loop. */
  bank: THREE.Group;
  ring: THREE.Mesh;
  x: number;
  y: number;
  angle: number;
  level: number;
  /** Where in its slow bobbing the ship is. */
  phase: number;
  shake: number;
  /** How much higher (or lower) than usual the ship flies, and what that is coming to: it sinks into a half loop, comes out of it high and settles again. */
  lift: number;
  liftTarget: number;
  /** How far the ship should be leaning into a turn (radians; to the right is positive), and how far it is: it leans over and comes back softly. */
  roll: number;
  lean: number;
  /** A barrel roll being flown: how far round the ship is (radians). */
  spin: number;
  /** In a half loop the ship is turned over and lifted by hand. */
  looping: boolean;
  /** The move being flown as one curve, and how far it has got (see `flight`). */
  flight: { steps: FlightStep[]; next: number } | null;
  /** While its move is planned the ship flies to where the plan now ends: from where, how far it turns on the way, and since when. */
  drift: { x: number; y: number; angle: number; toX: number; toY: number; turn: number; start: number } | null;
}

interface Sheet {
  texture: THREE.Texture;
  frames: number;
  cols: number;
  rows: number;
  seconds: number;
}

interface LiveEffect {
  sprite: THREE.Sprite;
  sheet: Sheet;
  start: number;
  duration: number;
}

interface Popup {
  node: HTMLElement;
  at: THREE.Vector3;
  until: number;
}

export class Board3D implements PlaybackBoard {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 4, 60000);
  /** The camera: the point of the board it looks at, from how far, from which side (radians; 0 is from the south, north up the screen) and how steeply (degrees). */
  private target = new THREE.Vector3();
  private distance = R * 40;
  private azimuth = 0;
  private elevation = TILT;
  /** The flat board laid down as the table (table mode), the browser's renderer for it, and a sheet that hides the stars behind it. */
  private css: CSS3DRenderer | null = null;
  private tableObject: CSS3DObject | null = null;
  private tableCover: THREE.Mesh | null = null;
  private watcher: ResizeObserver | null = null;
  private ships = new Map<string, ShipNode>();
  private models = new Map<string, Promise<THREE.Object3D | null>>();
  /** The turret guns, the ground target and the capital ships on the board, and the models they are made of. */
  private fixtures = new Map<string, Fixture>();
  private files = new Map<string, Promise<THREE.Object3D | null>>();
  private fixtureModels = new Map<FixtureKind, Promise<THREE.Object3D | null>>();
  private engines: Promise<Record<string, number[][]>> | null = null;
  private rocks = new Map<number, RockNode>();
  private rockModels = new Map<number, Promise<THREE.Object3D | null>>();
  /** How large the fighters are shown: smaller in a game with capital ships, when the player wants it (see `setShipScale`). */
  private shipScale = 1;
  /** The game as last drawn: what stands in a hex says how high a shot flies there. */
  private game: GameState | null = null;
  private sheets = new Map<string, Sheet>();
  private effects: LiveEffect[] = [];
  private popups: Popup[] = [];
  private labels: HTMLElement;
  private grid: THREE.Object3D | null = null;
  private fitted = false;
  /** The point the camera drifts to while something is played back, when `follow` is on. */
  private focus: THREE.Vector3 | null = null;
  follow = true;
  private last = performance.now();
  private glowTexture: THREE.Texture;

  constructor(private host: HTMLElement, private tableMode = false) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: tableMode });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = tableMode ? 'board3d over' : 'board3d';
    this.labels = document.createElement('div');
    this.labels.className = 'labels3d';
    if (tableMode) {
      // the picture of the ships lies over the table and lets it show through (and lets the clicks through to it)
      this.renderer.setClearColor(0x000000, 0);
      this.css = new CSS3DRenderer();
      this.css.domElement.className = 'table3d';
      host.prepend(this.css.domElement, this.renderer.domElement, this.labels);
    } else {
      this.scene.background = new THREE.Color(0x04060c);
      host.append(this.renderer.domElement, this.labels);
      this.attachPointer();
    }

    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;
    this.scene.add(new THREE.AmbientLight(0xdfe6ff, 0.75));
    // one hard light, as in space, and a faint cool one from the other side so that the dark sides keep their shape
    const key = new THREE.DirectionalLight(0xfff1de, 2.8);
    key.position.set(-0.7, 1.25, 0.55);
    const fill = new THREE.DirectionalLight(0x8fb0ff, 0.55);
    fill.position.set(0.9, 0.4, -0.7);
    this.scene.add(key, fill, this.stars());

    this.glowTexture = this.makeGlow();
    void this.loadEffects();
    if (typeof ResizeObserver !== 'undefined') {
      this.watcher = new ResizeObserver(() => this.resize());
      this.watcher.observe(host);
    }
    this.resize();
    this.aim();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Takes the 3D view away again: the flat board gets its drawing back (see `Board.setTable`). */
  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.watcher?.disconnect();
    this.css?.domElement.remove();
    this.renderer.domElement.remove();
    this.labels.remove();
    this.renderer.dispose();
  }

  /** On its own the board takes the pointer itself, as the flat board does: the left button moves the map, the right one turns the view, the wheel zooms. */
  private attachPointer(): void {
    const canvas = this.renderer.domElement;
    let drag: { x: number; y: number; turn: boolean } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, turn: e.button !== 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.turn) this.turnBy(e.clientX - drag.x, e.clientY - drag.y);
      else this.grab({ x: drag.x, y: drag.y }, { x: e.clientX, y: e.clientY });
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    canvas.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('pointercancel', () => (drag = null));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }, { passive: false });
  }

  // ------------------------------------------------------------------ the scene

  private stars(): THREE.Points {
    const count = 5000;
    const position = new Float32Array(count * 3);
    const colour = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // evenly over the sphere
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      position.set([r * Math.cos(a) * 30000, u * 30000, r * Math.sin(a) * 30000], i * 3);
      // most stars are faint; a few are bright, some a little blue or warm
      const bright = 0.25 + 0.75 * Math.random() ** 3;
      const tint = Math.random();
      colour.set([bright * (tint < 0.2 ? 0.8 : 1), bright * 0.95, bright * (tint > 0.8 ? 0.8 : 1)], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  }

  /** A soft round glow, for torpedoes and the light under a bolt. */
  private makeGlow(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /** The hexes of the map as thin lines on the ground, with the edge of the map a little brighter. */
  private buildGrid(game: GameState): void {
    const { cols, rows } = game.map;
    const points: number[] = [];
    const corner = (i: number): [number, number] => [R * Math.cos((Math.PI / 3) * i), R * Math.sin((Math.PI / 3) * i)];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const c = hexToPixel(fromOffset(col, row));
        for (let i = 0; i < 6; i++) {
          const [ax, ay] = corner(i);
          const [bx, by] = corner((i + 1) % 6);
          points.push(c.x + ax, 0, c.y + ay, c.x + bx, 0, c.y + by);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x3d5488, transparent: true, opacity: 0.5, depthWrite: false }));
    const group = new THREE.Group();
    group.add(lines);
    // a dark sheet under the lines: the grid reads as a board, and the stars under it are dimmed
    const x0 = -R * 1.5;
    const x1 = R * 1.5 * (cols - 1) + R * 1.5;
    const z0 = -R * SQRT3 * 0.75;
    const z1 = R * SQRT3 * rows;
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ color: 0x0b1326, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set((x0 + x1) / 2, -0.6, (z0 + z1) / 2);
    sheet.renderOrder = -1;
    const frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z0), new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x0, 0, z1)]),
      new THREE.LineBasicMaterial({ color: 0xffd54a, transparent: true, opacity: game.map.mode === 'static' ? 0.55 : 0.18 }),
    );
    group.add(sheet, frame);
    this.grid = group;
    this.scene.add(group);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.css?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ the camera

  /** Puts the camera where `target`, `distance`, `azimuth` and `elevation` say. */
  private aim(): void {
    this.elevation = Math.min(HIGHEST, Math.max(LOWEST, this.elevation));
    this.distance = Math.min(FARTHEST, Math.max(NEAREST, this.distance));
    const e = (this.elevation * Math.PI) / 180;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * Math.cos(e) * this.distance,
      Math.sin(e) * this.distance,
      this.target.z + Math.cos(this.azimuth) * Math.cos(e) * this.distance,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
  }

  /** The point of the board under a place on the screen (page coordinates), as a board point; null when it looks past the horizon. */
  ground(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.host.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2), this.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  /**
   * What a click at a place on the screen means on the board: the hex of the ship whose model is under the pointer (a ship flies above its
   * hex, so from the side it is seen over the hexes behind it), otherwise the point of the board there.
   */
  locate(clientX: number, clientY: number): { x: number; y: number; shipId?: string } | null {
    const rect = this.host.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2), this.camera);
    let best: { x: number; y: number; shipId: string } | null = null;
    let bestAlong = Infinity;
    const centre = new THREE.Vector3();
    for (const [shipId, node] of this.ships) {
      centre.set(node.x, node.yaw.position.y, node.y);
      const along = centre.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      if (along > 0 && along < bestAlong && ray.ray.distanceSqToPoint(centre) < (R * 0.62) ** 2) {
        bestAlong = along;
        best = { x: node.x, y: node.y, shipId };
      }
    }
    return best ?? this.ground(clientX, clientY);
  }

  /** Moves the map with the pointer: the point of the board that was under it stays under it. */
  grab(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const a = this.ground(from.x, from.y);
    const b = this.ground(to.x, to.y);
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > this.distance) return;
    this.focus = null;
    this.target.x += a.x - b.x;
    this.target.z += a.y - b.y;
    this.aim();
  }

  /** Turns the view round the point it looks at, and tilts it, by a movement of the pointer in pixels. */
  turnBy(dx: number, dy: number): void {
    this.focus = null;
    this.azimuth -= dx * 0.006;
    this.elevation += dy * 0.25;
    this.aim();
  }

  /** Zooms in (a factor above 1) or out, keeping the point of the board under the pointer where it is. */
  zoomBy(factor: number, clientX: number, clientY: number): void {
    const before = this.ground(clientX, clientY);
    this.distance /= factor;
    this.aim();
    const after = this.ground(clientX, clientY);
    if (before && after && Math.hypot(before.x - after.x, before.y - after.y) < this.distance) {
      this.target.x += before.x - after.x;
      this.target.z += before.y - after.y;
      this.aim();
    }
  }

  /** Looks at the given hexes, from far enough to see them all; the view keeps the side and the angle it has. */
  fit(hexes: Hex[]): void {
    this.fitPoints(hexes.map(hexToPixel));
  }

  fitPoints(pts: { x: number; y: number }[], nearest = R * 14): void {
    if (pts.length === 0) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    this.target.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...ys) + Math.max(...ys)) / 2);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 0.8, 1) + R * 6;
    this.distance = Math.max(nearest, span / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.min(1, this.camera.aspect));
    this.focus = null;
    this.aim();
  }

  /** Looks at a point of the board, from where the camera is. */
  panToPoint(x: number, y: number): void {
    this.target.set(x, 0, y);
    this.focus = null;
    this.aim();
  }

  /** Where a point of the board is on the screen, in pixels from the top left of the board's place on the page, and how large a hex radius is there. */
  screenOfPoint(x: number, y: number): { x: number; y: number; r: number } {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const p = new THREE.Vector3(x, 0, y).project(this.camera);
    // a hex radius across the view, so that it is not squashed by the tilt
    const side = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(R).add(new THREE.Vector3(x, 0, y)).project(this.camera);
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, r: (Math.abs(side.x - p.x) / 2) * w };
  }

  /** Moves the map (without zooming or turning) so that a point of the board is inside the view, with `room` board units to spare. */
  revealPoint(x: number, y: number, room = 0): void {
    const rect = this.host.getBoundingClientRect();
    const at = this.screenOfPoint(x, y);
    const margin = 90 + (room * at.r) / R;
    const sx = Math.min(Math.max(at.x, margin), rect.width - margin);
    const sy = Math.min(Math.max(at.y, margin + 40), rect.height - margin);
    if (sx === at.x && sy === at.y) return;
    const there = this.ground(rect.left + sx, rect.top + sy);
    if (!there) return;
    this.target.x += x - there.x;
    this.target.z += y - there.y;
    this.focus = null;
    this.aim();
  }

  /** The same place seen from straight above, or at an angle from the south. */
  view(kind: 'top' | 'tilted'): void {
    this.azimuth = 0;
    this.elevation = kind === 'top' ? HIGHEST : TILT;
    this.aim();
  }

  /**
   * Table mode: lays the flat board down as the table. `area` is the part of the board the drawing covers, in board units, and `k` how
   * many pixels of the drawing a board unit is.
   */
  layTable(element: Element, area: TableArea, k: number): void {
    if (!this.css) return;
    if (!this.tableObject) {
      this.tableObject = new CSS3DObject(element as HTMLElement);
      this.tableObject.rotation.x = -Math.PI / 2;
      this.scene.add(this.tableObject);
      // nothing of the picture is drawn where the table is, so that the stars do not shine through it; the ships are in front of it
      this.tableCover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ colorWrite: false }));
      this.tableCover.rotation.x = -Math.PI / 2;
      this.tableCover.renderOrder = -10;
      this.scene.add(this.tableCover);
    }
    const cx = (area.x0 + area.x1) / 2;
    const cz = (area.y0 + area.y1) / 2;
    this.tableObject.position.set(cx, 0, cz);
    this.tableObject.scale.setScalar(1 / k);
    this.tableCover!.position.set(cx, -0.5, cz);
    this.tableCover!.scale.set(area.x1 - area.x0, area.y1 - area.y0, 1);
  }

  /** What the flat board needs of this one to be its 3D view (see `Board.setTable`). */
  table(): Table {
    return {
      layout: (element, area, k) => this.layTable(element, area, k),
      ground: (x, y) => this.ground(x, y),
      locate: (x, y) => this.locate(x, y),
      grab: (from, to) => this.grab(from, to),
      turn: (dx, dy) => this.turnBy(dx, dy),
      zoom: (factor, x, y) => this.zoomBy(factor, x, y),
      fit: (points) => this.fitPoints(points),
      panTo: (p) => this.panToPoint(p.x, p.y),
      reveal: (p, room) => this.revealPoint(p.x, p.y, room),
      screenOf: (p) => this.screenOfPoint(p.x, p.y),
      size: () => ({ w: this.host.clientWidth, h: this.host.clientHeight }),
      render: (overlay) => this.render(overlay),
      flight: (id, poses, rolls) => this.flight(id, poses, rolls),
      glide: (id, to, angle, ms, ease) => this.glide(id, to, angle, ms, ease),
      bolt: (from, to, color, hit, lane, kind, ids) => this.bolt(from, to, color, hit, lane, kind, ids),
      glideCapital: (id, to, angle, ms, ease) => this.flyCapital(id, to, angle, ms, ease),
      shipScale: (k) => this.setShipScale(k),
      rockSet: (rock) => this.rockSet(rock),
      rockOffset: (id, dx, dy) => this.rockOffset(id, dx, dy),
      rockGone: (id) => this.rockGone(id),
      impact: (hex, targetId, look) => this.impact(hex, targetId, look),
      explode: (hex, large, soundId) => this.explode(hex, large, soundId),
      popup: (hex, text, kind, slot) => this.popup(hex, text, kind, slot),
      removeCounter: (id) => this.removeCounter(id),
      dispose: () => this.dispose(),
    };
  }

  /** Whether a capital ship, seen from the camera, is in front of a ship, a gun or another capital ship. */
  private covers(fixture: Fixture): boolean {
    const capital = fixture.capital!;
    const eye = this.camera.position;
    const centre = new THREE.Vector3(fixture.group.position.x, HEIGHT, fixture.group.position.z);
    const reach = capital.reach * 0.8;
    const line = new THREE.Line3();
    const nearest = new THREE.Vector3();
    const behind = (x: number, y: number, z: number): boolean => {
      line.set(eye, new THREE.Vector3(x, y, z));
      const t = line.closestPointToPointParameter(centre, true);
      // the line of sight passes through the ship before it comes to the thing
      return t < 0.97 && line.at(t, nearest).distanceTo(centre) < reach;
    };
    for (const node of this.ships.values()) if (behind(node.x, node.yaw.position.y, node.y)) return true;
    for (const other of this.fixtures.values()) {
      if (other !== fixture && behind(other.group.position.x, other.capital ? HEIGHT : BASE_HEIGHT, other.group.position.z)) return true;
    }
    return false;
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.follow && this.focus) {
      // the camera drifts after what is happening, keeping its angle and distance
      this.target.add(this.focus.clone().sub(this.target).multiplyScalar(Math.min(1, dt * 2.2)));
      this.aim();
    }
    // a gun whose model has come since it was put in its place is turned the way it faces
    for (const fixture of this.fixtures.values()) {
      const angle = fixture.group.userData.turnTo as number | undefined;
      if (angle !== undefined && fixture.group.userData.facing !== angle) {
        const head = fixture.group.getObjectByName('head');
        if (head) {
          head.rotation.y = Math.PI - (angle * Math.PI) / 180;
          fixture.group.userData.facing = angle;
        }
      }
      const capital = fixture.capital;
      if (!capital || capital.materials.length === 0) continue;
      const want = capital.marked || this.covers(fixture) ? SEE_THROUGH : 1;
      if (Math.abs(want - capital.opacity) < 0.005) continue;
      capital.opacity += (want - capital.opacity) * Math.min(1, dt * 6);
      if (Math.abs(want - capital.opacity) < 0.01) capital.opacity = want;
      for (const material of capital.materials) {
        material.transparent = capital.opacity < 1;
        material.opacity = capital.opacity;
        material.needsUpdate = true;
      }
    }
    for (const node of this.ships.values()) {
      const wobble = node.shake > 0 ? Math.sin(node.shake * 60) * 2.6 * node.shake : 0;
      node.shake = Math.max(0, node.shake - dt * 3);
      const d = node.drift;
      if (d) {
        const t = Math.min(1, (now - d.start) / PLAN_STEP);
        const e = t * t * (3 - 2 * t);
        this.put(node, d.x + (d.toX - d.x) * e, d.y + (d.toY - d.y) * e, d.angle + d.turn * e);
        node.roll = t < 1 ? Math.max(-1, Math.min(1, (d.turn / 60) * 0.7)) : 0;
        if (t >= 1) node.drift = null;
      }
      // the lean follows what is asked for with a little delay: into the turn, and out of it after the turn is over
      if (!node.looping) {
        node.lean += (node.roll - node.lean) * Math.min(1, dt * 4.5);
        node.lift += (node.liftTarget - node.lift) * Math.min(1, dt * 4);
        node.bank.rotation.z = node.lean + node.spin;
      }
      node.holder.position.set(node.x + wobble, 0, node.y - wobble * 0.5);
      // ships never hang quite still
      node.yaw.position.y = HEIGHT + node.level * STACK + Math.sin(now / 900 + node.phase) * 0.9 + node.lift;
    }
    this.stepEffects(now);
    this.renderer.render(this.scene, this.camera);
    this.css?.render(this.scene, this.camera);
    this.stepPopups(now);
  }

  // ------------------------------------------------------------------ the ships

  private model(typeId: string): Promise<THREE.Object3D | null> {
    const file = SPRITE_OF[typeId];
    if (!file) return Promise.resolve(null);
    let pending = this.models.get(file);
    if (!pending) {
      pending = Promise.all([new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/models/${file}.glb`), this.engineData()])
        .then(([gltf, engines]) => {
          // the models have their nose along +Z and their top along +Y; the B-wing flies on its side (see tools/ships.js)
          const turned = new THREE.Group();
          turned.add(gltf.scene);
          if (file === 'b-wing') turned.rotation.z = Math.PI / 2;
          turned.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(turned);
          const size = box.getSize(new THREE.Vector3());
          const centre = box.getCenter(new THREE.Vector3());
          const across = Math.max(size.x, size.z, 0.001);
          const k = METRE * (across <= FULL_SCALE_TO ? 1 : (FULL_SCALE_TO + (across - FULL_SCALE_TO) * BEYOND) / across);
          const sized = new THREE.Group();
          turned.position.copy(centre).multiplyScalar(-1);
          const glow = this.engineGlow(file, engines[file]);
          if (glow) turned.add(glow);
          sized.add(turned);
          sized.scale.setScalar(k);
          return sized as THREE.Object3D;
        })
        .catch(() => null);
      this.models.set(file, pending);
    }
    return pending;
  }

  /** Where the engines of each model are (public/assets/models/engines.json, made by tools/engines.mjs): [x, y, z, radius] in the model's own measure. */
  private engineData(): Promise<Record<string, number[][]>> {
    this.engines ??= fetch(`${import.meta.env.BASE_URL}assets/models/engines.json`).then((r) => r.json() as Promise<Record<string, number[][]>>).catch(() => ({}));
    return this.engines;
  }

  /** The glow of a model's engines: a soft light at each of them, to be put beside the model in its own measure. */
  private engineGlow(file: string, points: number[][] | undefined): THREE.Object3D | null {
    if (!points?.length) return null;
    const group = new THREE.Group();
    // where the points lie close together (the band of a freighter's engine) each is fainter, so that they add up to one light
    const material = new THREE.SpriteMaterial({ map: this.glowTexture, color: new THREE.Color(ENGINE_COLOUR[file] ?? '#9fceff'), transparent: true, opacity: Math.min(1, 0.3 + 5 / points.length), ...GLOW, depthWrite: false });
    for (const [x, y, z, r] of points as [number, number, number, number][]) {
      const glow = new THREE.Sprite(material);
      glow.position.set(x, y, z - r * 0.4);
      glow.scale.setScalar(r * 5.5);
      group.add(glow);
    }
    return group;
  }

  private file(name: string): Promise<THREE.Object3D | null> {
    let pending = this.files.get(name);
    if (!pending) {
      pending = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/models/${name}.glb`).then((gltf) => gltf.scene as THREE.Object3D).catch(() => null);
      this.files.set(name, pending);
    }
    return pending;
  }

  /**
   * The model of something that stands on the board, sized for it: its middle over the origin, its foot on the board, its front along +Z.
   * A gun is in two parts: what turns is under the node named `head`, the base stands still.
   */
  private fixtureModel(kind: FixtureKind): Promise<THREE.Object3D | null> {
    let pending = this.fixtureModels.get(kind);
    if (!pending) {
      const how = FIXTURES[kind];
      pending = Promise.all([this.file(how.file), this.engineData()]).then(([scene, engines]) => {
        if (!scene) return null;
        const model = scene.clone(true);
        if (how.piece) {
          const top = model.getObjectByName('Root') ?? model;
          for (const child of [...top.children]) if (child.name !== how.piece) top.remove(child);
        }
        const turned = new THREE.Group();
        turned.add(model);
        if (how.turn) turned.rotation.y = how.turn;
        const head = new THREE.Group();
        head.name = 'head';
        head.add(turned);
        const whole = new THREE.Group();
        whole.add(head);
        whole.updateMatrixWorld(true);
        if (kind === 'turret-reduced') dropCannon(whole);
        const fixed = how.fixed ? whole.getObjectByName(how.fixed) : undefined;
        const box = new THREE.Box3().setFromObject(whole);
        // a gun turns about the middle of its base
        const foot = fixed ? new THREE.Box3().setFromObject(fixed) : box;
        const centre = foot.getCenter(new THREE.Vector3());
        const size = foot.getSize(new THREE.Vector3());
        turned.position.set(-centre.x, -box.min.y, -centre.z);
        whole.updateMatrixWorld(true);
        if (fixed) {
          const still = new THREE.Group();
          whole.add(still);
          for (const part of (fixed as THREE.Mesh).isMesh ? [fixed] : fixed.children.filter((c) => (c as THREE.Mesh).isMesh)) still.attach(part);
        }
        if (kind === 'ground' || fixed) {
          const k = (kind === 'ground' ? GROUND_WIDTH : TURRET_WIDTH) / Math.max(size.x, size.z, 0.001);
          whole.scale.setScalar(k);
          // shots leave from and arrive at the part that turns (what is left under `head`), not the base
          whole.userData.muzzle = new THREE.Box3().setFromObject(head).getCenter(new THREE.Vector3()).y * k;
        } else {
          // a capital ship is as large as the flat board shows it: the Star Destroyer as wide as its picture, the others as long as their hexes
          const k = CAPITAL_SIZE[kind as CapitalKind].width ? (CAPITAL_SIZE[kind as CapitalKind].width! * R) / Math.max(size.x, 0.001) : (CAPITAL_SIZE[kind as CapitalKind].length! * SQRT3 * R) / Math.max(size.z, 0.001);
          whole.scale.setScalar(k);
          // it flies at the height of the other ships
          turned.position.y = -box.getCenter(new THREE.Vector3()).y + HEIGHT / k;
          whole.userData.reach = (Math.max(size.x, size.z) * k) / 2;
          const glow = this.engineGlow(how.file, engines[how.file]);
          if (glow) turned.add(glow);
        }
        return whole as THREE.Object3D;
      });
      this.fixtureModels.set(kind, pending);
    }
    return pending;
  }

  /** Puts something that stands on the board where it is, turned the way it faces (a gun turns its head only). */
  private stand(seen: Set<string>, id: string, kind: FixtureKind, at: { x: number; y: number }, facing: number): void {
    seen.add(id);
    let fixture = this.fixtures.get(id);
    if (fixture && fixture.kind !== kind) {
      this.scene.remove(fixture.group);
      fixture = undefined;
    }
    if (!fixture) {
      const made: Fixture = { kind, group: new THREE.Group() };
      fixture = made;
      this.fixtures.set(id, made);
      this.scene.add(made.group);
      void this.fixtureModel(kind).then((model) => {
        if (!model || this.fixtures.get(id) !== made) return;
        const copy = model.clone(true);
        made.muzzle = model.userData.muzzle as number | undefined;
        if (made.capital) {
          // each capital ship has materials of its own: it is made see-through by itself
          const capital = made.capital;
          capital.reach = (model.userData.reach as number | undefined) ?? R * 3;
          copy.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.clone());
            capital.materials.push(...own);
            mesh.material = Array.isArray(mesh.material) ? own : own[0]!;
          });
          capital.opacity = 1;
        }
        made.group.add(copy);
        made.group.userData.facing = undefined;
      });
    }
    fixture.group.position.set(at.x, 0, at.y);
    // the model comes later than the place it stands in: it is turned when it is there (see `frame`)
    fixture.group.userData.turnTo = facing * 60;
  }

  /** Puts a capital ship where the hex point it turns on and its angle say: its middle is behind that point, as on the flat board. */
  private poseCapital(fixture: Fixture, x: number, y: number, angle: number): void {
    const capital = fixture.capital;
    if (!capital) return;
    capital.x = x;
    capital.y = y;
    capital.angle = angle;
    const a = (angle * Math.PI) / 180;
    const back = capitalCentre(fixture.kind as CapitalKind) * R;
    fixture.group.position.set(x - back * Math.sin(a), 0, y + back * Math.cos(a));
    fixture.group.userData.turnTo = angle;
  }

  /**
   * Flies a capital ship to the hex point it turns on next and turns it to an angle, in its own slow way: no banking. (The playback asks
   * for it step by step, as it does for the fighters.)
   */
  glideCapital(id: string, to: Hex, angle: number, ms: number, ease?: (t: number) => number): Promise<void> {
    return this.flyCapital(id, hexToPixel(to), angle, ms, ease);
  }

  private async flyCapital(id: string, to: { x: number; y: number }, angle: number, ms: number, ease?: (t: number) => number): Promise<void> {
    const fixture = this.fixtures.get(id);
    const capital = fixture?.capital;
    if (!fixture || !capital) return;
    const from = { x: capital.x, y: capital.y, angle: capital.angle };
    await tween(ms, (t) => {
      this.poseCapital(fixture, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.angle + (angle - from.angle) * t);
      this.focus = new THREE.Vector3(fixture.group.position.x, 0, fixture.group.position.z);
    }, ease);
    this.poseCapital(fixture, to.x, to.y, angle);
  }

  /** Shows the fighters smaller or larger (1 is their real size beside the capital ships' hexes). */
  setShipScale(k: number): void {
    this.shipScale = k;
    for (const node of this.ships.values()) node.bank.scale.setScalar(k);
  }

  // ------------------------------------------------------------------ the asteroids

  /** One of the nine rock models, made one unit across with its middle at the origin. */
  private rockModel(model: number): Promise<THREE.Object3D | null> {
    let pending = this.rockModels.get(model);
    if (!pending) {
      pending = this.file(`ast-${model}`).then((scene) => {
        if (!scene) return null;
        const inner = scene.clone(true);
        const box = new THREE.Box3().setFromObject(inner);
        const size = box.getSize(new THREE.Vector3());
        inner.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-1);
        const sized = new THREE.Group();
        sized.add(inner);
        sized.scale.setScalar(1 / Math.max(size.x, size.y, size.z, 0.001));
        return sized as THREE.Object3D;
      });
      this.rockModels.set(model, pending);
    }
    return pending;
  }

  /**
   * Builds an asteroid: a lump of rock over each of its hexes, a little larger than the hex so that they grow into one, all of the colour
   * of its picture on the flat board. How each lump is turned depends only on the asteroid's own number, so it looks the same wherever it drifts.
   */
  rockSet(rock: Rock): void {
    this.rockGone(rock.id);
    const group = new THREE.Group();
    const node: RockNode = { group, key: rock.hexes.map((h) => `${h.q},${h.r}`).join(' ') };
    this.rocks.set(rock.id, node);
    this.scene.add(group);
    const family = (composeRock(rock, hexToPixel, R).parts[0]!.model - 1) % 3;
    let seed = (rock.look >>> 0) || 1;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const n = rock.hexes.length;
    rock.hexes.forEach((hex, i) => {
      // big rocks for big asteroids
      const size = n >= 5 ? (i % 2 === 0 ? 0 : 1) : n >= 3 ? 1 : 2;
      const turn = [rand() * 6.3, rand() * 6.3, rand() * 6.3] as const;
      const across = R * (1.85 + rand() * 0.45);
      const up = (rand() - 0.5) * R * 0.3;
      const p = hexToPixel(hex);
      void this.rockModel(size * 3 + family + 1).then((model) => {
        if (!model || this.rocks.get(rock.id) !== node) return;
        const lump = new THREE.Group();
        lump.add(model.clone(true));
        lump.position.set(p.x, ROCK_HEIGHT + up, p.y);
        lump.rotation.set(...turn);
        lump.scale.setScalar(across);
        group.add(lump);
      });
    });
  }

  /** An asteroid drifting: how far it is from where it was built. */
  rockOffset(id: number, dx: number, dy: number): void {
    this.rocks.get(id)?.group.position.set(dx, 0, dy);
  }

  rockGone(id: number): void {
    const node = this.rocks.get(id);
    if (!node) return;
    this.scene.remove(node.group);
    this.rocks.delete(id);
  }

  private renderRocks(game: GameState): void {
    const seen = new Set<number>();
    for (const rock of game.asteroids?.rocks ?? []) {
      seen.add(rock.id);
      const node = this.rocks.get(rock.id);
      const key = rock.hexes.map((h) => `${h.q},${h.r}`).join(' ');
      if (!node || node.key !== key || node.group.position.lengthSq() > 0) this.rockSet(rock);
    }
    for (const id of [...this.rocks.keys()]) if (!seen.has(id)) this.rockGone(id);
  }

  /** The turret guns, the ground target and the capital ships of the game as it stands, and those that are being placed. */
  private renderFixtures(overlay: Overlay): void {
    const game = overlay.game;
    const seen = new Set<string>();
    for (const turret of game.emplacements ?? []) {
      if (turret.status !== 'active') continue;
      const kind: FixtureKind = turret.kind === 'single' ? 'turret-single' : turret.reduced ? 'turret-reduced' : 'turret-double';
      this.stand(seen, turret.id, kind, hexToPixel(turret.pos), overlay.turretDraft?.[turret.id]?.facing ?? turret.facing);
    }
    const ground = game.groundTarget;
    if (ground?.status === 'active') this.stand(seen, ground.id, 'ground', hexToPixel(ground.pos), 0);
    for (const item of overlay.baseItems ?? []) {
      if (item.kind === 'ground') this.stand(seen, `item-${item.id}`, 'ground', hexToPixel(item.pos), 0);
      else itemGuns(item.kind, item).forEach((gun, i) => this.stand(seen, `item-${item.id}-${i}`, gun.kind === 'single' ? 'turret-single' : 'turret-double', hexToPixel(gun.pos), gun.facing));
    }
    for (const d of game.destroyers ?? []) {
      if (d.exploded) continue;
      const placed = overlay.destroyerPlacements?.find((p) => p.id === d.id);
      // while its move is planned it is shown where the plan ends
      const planned = !overlay.animating && overlay.destroyerGhost?.id === d.id ? overlay.destroyerGhost : undefined;
      // (a capital ship that is on the map is seen in the set-up, as on the flat board)
      const pos = planned?.pos ?? placed?.pos ?? d.pos;
      if (!pos) continue;
      const facing = planned?.facing ?? placed?.facing ?? d.facing;
      const kind = specOf(d).kind;
      const turnsOn = hexToPixel(pos);
      this.stand(seen, d.id, kind, turnsOn, facing);
      const fixture = this.fixtures.get(d.id)!;
      fixture.capital ??= { x: 0, y: 0, angle: 0, materials: [], opacity: 1, marked: false, reach: R * 3 };
      this.poseCapital(fixture, turnsOn.x, turnsOn.y, facing * 60);
      // it is seen through while it is aimed at, picked or moved: what the board draws on its hexes shows
      fixture.capital.marked = (overlay.destroyerTargets?.includes(d.id) ?? false) || overlay.destroyerSelected === d.id || planned !== undefined || overlay.destroyerSpeed?.id === d.id;
    }
    for (const [id, fixture] of this.fixtures) {
      if (seen.has(id)) continue;
      this.scene.remove(fixture.group);
      this.fixtures.delete(id);
    }
  }

  /** How high over the board a shot leaves or arrives in a hex: at the height the ships fly, or lower where a gun, the ground target or a capital ship is and no ship. */
  private heightAt(hex: Hex): number {
    const p = hexToPixel(hex);
    for (const node of this.ships.values()) if (Math.hypot(node.x - p.x, node.y - p.y) < R * 0.9) return HEIGHT;
    const game = this.game;
    if (!game) return HEIGHT;
    if (game.emplacements?.some((e) => e.status === 'active' && hexEquals(e.pos, hex)) || (game.groundTarget?.status === 'active' && hexEquals(game.groundTarget.pos, hex))) return BASE_HEIGHT;
    if (game.asteroids && rockAt(game.asteroids, hex)) return ROCK_HEIGHT;
    return HEIGHT;
  }

  private addShip(id: string, typeId: string, owner: number): ShipNode {
    const holder = new THREE.Group();
    const yaw = new THREE.Group();
    const bank = new THREE.Group();
    yaw.add(bank);
    const colour = new THREE.Color(SIDE_COLORS[owner] ?? '#ffffff');
    // the stand: a ring in the colour of the side on the ship's hex, and a thin stem up to the ship
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.5, R * 0.62, 40), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.45 }));
    ring.visible = !this.tableMode;
    holder.add(ring, stem, yaw);
    this.scene.add(holder);
    const node: ShipNode = { holder, yaw, bank, ring, x: 0, y: 0, angle: 0, level: 0, phase: Math.random() * 6.3, shake: 0, lift: 0, liftTarget: 0, roll: 0, lean: 0, spin: 0, looping: false, flight: null, drift: null };
    // the stem reaches the ship wherever it is flying
    stem.onBeforeRender = () => stem.scale.setY(Math.max(1, yaw.position.y));
    this.ships.set(id, node);
    void this.model(typeId).then((model) => {
      if (!this.ships.has(id) || this.ships.get(id) !== node) return;
      bank.scale.setScalar(this.shipScale);
      if (model) bank.add(model.clone());
      else {
        // no model: a plain dart, so that the ship is still there
        const dart = new THREE.Mesh(new THREE.ConeGeometry(R * 0.3, R * 0.9, 4), new THREE.MeshStandardMaterial({ color: colour }));
        dart.rotation.x = Math.PI / 2;
        bank.add(dart);
      }
    });
    return node;
  }

  private put(node: ShipNode, x: number, y: number, angle: number): void {
    node.x = x;
    node.y = y;
    node.angle = angle;
    // an angle of the board runs clockwise from "up the map" (-z); the model's nose is along +z
    node.yaw.rotation.y = Math.PI - (angle * Math.PI) / 180;
  }

  /** Sends a ship to where its planned move now ends: a short flight there, unless it is there or on its way already. */
  private driftTo(node: ShipNode, x: number, y: number, angle: number): void {
    const off = (a: number): number => ((((angle - a) % 360) + 540) % 360) - 180;
    const d = node.drift;
    if (d) {
      if (Math.hypot(d.toX - x, d.toY - y) < 0.01 && Math.abs(off(d.angle + d.turn)) < 0.01) return;
    } else if (Math.hypot(node.x - x, node.y - y) < 0.01 && Math.abs(off(node.angle)) < 0.01) return;
    node.drift = { x: node.x, y: node.y, angle: node.angle, toX: x, toY: y, turn: off(node.angle), start: performance.now() };
  }

  /**
   * Draws the game as it stands: every ship in its hex (ships that share one fly one above the other). The ship whose move is being
   * planned is shown where the plan ends so far, and flies there step by step as the plan grows.
   */
  render(overlay: Overlay): void {
    const game = overlay.game;
    this.game = game;
    if (!this.grid && !this.tableMode) this.buildGrid(game);
    const hidden = new Set(overlay.hidden ?? []);
    this.renderFixtures(overlay);
    this.renderRocks(game);
    const seen = new Set<string>();
    const stacked = new Map<string, number>();
    // the ships in the game, and those that are being placed and are not in it yet
    // (what is hidden are ships of the game: in the set-up all of them, and the ships being placed are the same ships)
    const ghost = overlay.animating ? undefined : overlay.ghost;
    const shown = [
      ...(overlay.placements ?? []).map((p) => ({ ...p.ship, pos: p.pos, facing: p.facing })),
      ...activeShips(game).filter((s) => !hidden.has(s.id)).map((s) => (ghost?.ship.id === s.id ? { ...s, pos: ghost.pos, facing: ghost.facing } : s)),
    ];
    for (const ship of shown) {
      if (!ship.pos || seen.has(ship.id)) continue;
      seen.add(ship.id);
      const known = this.ships.get(ship.id);
      const node = known ?? this.addShip(ship.id, ship.typeId, ship.owner);
      const key = `${ship.pos.q},${ship.pos.r}`;
      node.level = stacked.get(key) ?? 0;
      stacked.set(key, node.level + 1);
      const p = hexToPixel(ship.pos);
      if (known && ghost?.ship.id === ship.id) this.driftTo(node, p.x, p.y, ship.facing * 60);
      else {
        node.drift = null;
        this.put(node, p.x, p.y, ship.facing * 60);
      }
      // what is left of a lean, of the roll out of a half loop and of its height is flown out softly (see `frame`)
      node.bank.rotation.x = 0;
      node.looping = false;
      if (!node.drift) node.roll = 0;
      node.spin = 0;
      node.liftTarget = 0;
      node.flight = null;
      const active = overlay.activeShipId === ship.id;
      (node.ring.material as THREE.MeshBasicMaterial).opacity = active ? 1 : 0.55;
      node.ring.scale.setScalar(active ? 1.25 : 1);
    }
    for (const id of [...this.ships.keys()]) if (!seen.has(id)) this.removeCounter(id);
    // the first look at a game: once every ship is on the map
    if (!this.tableMode && !this.fitted && seen.size > 0 && activeShips(game).every((s) => s.pos)) {
      this.fitted = true;
      this.fit(activeShips(game).flatMap((s) => (s.pos ? [s.pos] : [])));
    }
  }

  /** Forgets the game that was shown: the next one is looked at afresh. */
  reset(): void {
    for (const id of [...this.ships.keys()]) this.removeCounter(id);
    for (const fixture of this.fixtures.values()) this.scene.remove(fixture.group);
    this.fixtures.clear();
    for (const id of [...this.rocks.keys()]) this.rockGone(id);
    if (this.grid) this.scene.remove(this.grid);
    this.grid = null;
    this.fitted = false;
    this.focus = null;
  }

  removeCounter(id: string): void {
    const fixture = this.fixtures.get(id);
    if (fixture) {
      this.scene.remove(fixture.group);
      this.fixtures.delete(id);
    }
    const node = this.ships.get(id);
    if (!node) return;
    this.scene.remove(node.holder);
    this.ships.delete(id);
  }

  /** Nothing lies on top of anything here. */
  lift(_id: string): void {}

  /**
   * Told before a move is played (see the playback): the poses the ship will be asked to glide to, one after the other. The move is then flown
   * as one curve through the middles of its hexes instead of straight lines with turns on the spot: the turns made in a hex are spread
   * over the way into it and out of it. A half loop stays a manoeuvre of its own, flown where it is made.
   */
  flight(id: string, poses: FlightPose[], rolls = 0): void {
    const node = this.ships.get(id);
    if (!node) return;
    const steps = planFlight({ x: node.x, y: node.y, angle: node.angle }, poses, rolls);
    node.flight = steps ? { steps, next: 0 } : null;
  }

  /**
   * Flies a ship to a point of the board and turns it to an angle. Within a move it has been told of (`flight`) the ship follows the curve of
   * the whole move, banking with it, and flies its barrel rolls on the way. A turn about is flown as a real half loop: the ship has sunk a
   * little coming into the hex, pulls up and over in a half circle that ends above the middle of the hex, upside down and facing back, and
   * rolls upright while it flies on (or where it is, when the move ends there). Any other turn in its hex is banked.
   */
  async glide(id: string, to: { x: number; y: number }, angle: number, ms: number, ease?: (t: number) => number): Promise<void> {
    const node = this.ships.get(id);
    if (!node) return;
    node.drift = null;
    // the next step of the move the board was told of, if this is it
    let step: FlightStep | undefined;
    if (node.flight) {
      step = node.flight.steps[node.flight.next++];
      if (!step || Math.hypot(step.pose.x - to.x, step.pose.y - to.y) > 0.5 || Math.abs(step.pose.angle - angle) > 0.5) {
        step = undefined;
        node.flight = null;
      }
    }
    if (step?.kind === 'absorbed') return; // the curve makes this turn
    if (step?.kind === 'leg') {
      const leg = step;
      let last = node.angle;
      let lastT = 0;
      // each ship rolls its own way
      const way = node.phase > Math.PI ? 1 : -1;
      // a little longer than a straight slide: the turns that would have taken their own time are flown on the way
      await tween(ms * 1.25 * legLength(leg), (t) => {
        const p = legPoint(leg, t);
        const now = legAngle(leg, t, last);
        if (t > lastT) {
          // how fast the ship is turning, in degrees for the whole leg: it leans into the turn by that much
          const rate = (now - last) / (t - lastT);
          // and into a slide, by where it is drifting to
          node.roll = Math.max(-1, Math.min(1, (rate / 60) * 1.2 + (legSlide(leg, t) / 60) * 0.6));
        }
        last = now;
        lastT = t;
        if (leg.spin) node.spin = way * Math.PI * 2 * (leg.spin[0] + (leg.spin[1] - leg.spin[0]) * t);
        if (leg.dip && t > 0.3) node.liftTarget = -DIP;
        this.put(node, p.x, p.y, now);
        this.focus = new THREE.Vector3(p.x, 0, p.y);
      }, ease);
      node.roll = 0;
      // a whole number of rolls is the ship upright again
      if (leg.spin && Number.isInteger(leg.spin[1])) node.spin = 0;
      return;
    }
    const from = { x: node.x, y: node.y, angle: node.angle };
    const turn = angle - from.angle;
    const still = Math.hypot(to.x - from.x, to.y - from.y) < 0.01;
    if (still && Math.abs(turn) >= 179) {
      const ahead = { x: Math.sin((from.angle * Math.PI) / 180), y: -Math.cos((from.angle * Math.PI) / 180) };
      const low = node.lift;
      node.looping = true;
      node.roll = 0;
      await tween(ms * 1.6, (t) => {
        const a = Math.PI * t;
        // a half circle standing on the line of flight: forward and up, then back over the middle of the hex
        const out = Math.sin(a) * LOOP_RADIUS;
        this.put(node, from.x + ahead.x * out, from.y + ahead.y * out, from.angle);
        node.bank.rotation.set(-a, 0, node.lean);
        node.lift = low + (1 - Math.cos(a)) * LOOP_RADIUS;
        this.focus = new THREE.Vector3(from.x, 0, from.y);
      });
      // upside down and facing back is the same as turned about and rolled half over: from there the ship rolls upright and comes down
      this.put(node, to.x, to.y, angle);
      node.bank.rotation.x = 0;
      node.lean += (node.phase > Math.PI ? 1 : -1) * Math.PI;
      node.bank.rotation.z = node.lean;
      node.looping = false;
      node.liftTarget = 0;
      return;
    }
    await tween(ms, (t) => {
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      this.put(node, x, y, from.angle + turn * t);
      node.roll = still && t < 1 ? Math.sign(turn) * 0.85 : 0;
      this.focus = new THREE.Vector3(x, 0, y);
    }, ease);
    this.put(node, to.x, to.y, angle);
    node.roll = 0;
  }

  // ------------------------------------------------------------------ shots and hits

  private at(hex: Hex, height = this.heightAt(hex)): THREE.Vector3 {
    const p = hexToPixel(hex);
    return new THREE.Vector3(p.x, height, p.y);
  }

  /** A shot flying from one hex to another: a bright bolt for lasers and ion cannons, a glowing ball with a tail for torpedoes and missiles. A miss flies on past the target and fades. */
  /**
   * Where a shot leaves or arrives: at the ship itself when it is known who fires or is fired at (a ship that fires on its way is not
   * quite in the middle of its hex, and ships that share a hex fly one above the other), otherwise at what is in the hex.
   */
  private spot(id: string | undefined, hex: Hex): THREE.Vector3 {
    const node = id ? this.ships.get(id) : undefined;
    if (node) return new THREE.Vector3(node.x, node.yaw.position.y, node.y);
    const fixture = id ? this.fixtures.get(id) : undefined;
    if (fixture) return this.at(hex, fixture.capital ? HEIGHT : fixture.muzzle ?? BASE_HEIGHT);
    return this.at(hex);
  }

  async bolt(from: Hex, to: Hex, color: string, hit: boolean, lane: number, kind: BoltKind = 'laser', ids: { shooter?: string | undefined; target?: string | undefined } = {}): Promise<void> {
    if (clock.skip || clock.factor === 0) return;
    const a = this.spot(ids.shooter, from);
    if (!ids.shooter) {
      for (const node of this.ships.values()) {
        if (node.flight && Math.hypot(node.x - a.x, node.y - a.z) < R * 1.2) a.set(node.x, node.yaw.position.y, node.y);
      }
    }
    const b = this.spot(ids.target, to);
    const dir = b.clone().sub(a);
    const dist = dir.length() || 1;
    dir.divideScalar(dist);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(lane * 6);
    const heavy = kind === 'torpedo' || kind === 'missile';
    const tint = new THREE.Color(kind === 'torpedo' ? '#ff5fa2' : kind === 'missile' ? '#ffb347' : color);
    const length = R * (heavy ? 1.1 : 1.7);
    const group = new THREE.Group();
    const additive = (c: THREE.Color, opacity: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, ...GLOW, depthWrite: false });
    const rod = (radius: number, material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(BOLT_SHAPE, material);
      mesh.scale.set(radius, radius, length);
      mesh.position.z = -length / 2;
      return mesh;
    };
    const materials: THREE.Material[] = [additive(tint, heavy ? 0.35 : 0.6), additive(new THREE.Color('#ffffff'), heavy ? 0.5 : 1)];
    group.add(rod(heavy ? 2.2 : 2.6, materials[0]!), rod(heavy ? 0.7 : 0.85, materials[1]!));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture, color: tint, transparent: true, ...GLOW, depthWrite: false }));
    glow.scale.setScalar(R * (heavy ? 1.5 : 0.9));
    materials.push(glow.material);
    group.add(glow);
    group.lookAt(dir);
    this.scene.add(group);
    this.focus = a.clone().add(b).multiplyScalar(0.5).setY(0);
    const startAt = R * 0.55;
    const endAt = hit ? dist - R * 0.4 : dist + R * 2.6;
    await tween(130 + hexDistance(from, to) * 60, (t) => {
      const head = startAt + (endAt - startAt) * t;
      group.position.copy(a).addScaledVector(dir, head).add(side);
      const fade = hit || t < 0.7 ? 1 : (1 - t) / 0.3;
      materials[0]!.opacity = (heavy ? 0.35 : 0.6) * fade;
      materials[1]!.opacity = (heavy ? 0.5 : 1) * fade;
      materials[2]!.opacity = fade;
    });
    this.scene.remove(group);
    for (const m of materials) m.dispose();
  }

  private async loadEffects(): Promise<void> {
    try {
      const base = `${import.meta.env.BASE_URL}assets/fx/`;
      const meta = (await (await fetch(`${base}fx.json`)).json()) as Record<string, { file: string; frames: number; cols: number; seconds: number }>;
      const loader = new THREE.TextureLoader();
      for (const [name, m] of Object.entries(meta)) {
        if (name.startsWith('streak-')) continue; // the bolts are drawn, not pictures, here
        void loader.loadAsync(`${base}${m.file}`).then((texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          this.sheets.set(name, { texture, frames: m.frames, cols: m.cols, rows: Math.ceil(m.frames / m.cols), seconds: m.seconds });
        }).catch(() => undefined);
      }
    } catch {
      /* no effects: shots and hits are heard, and the damage is written */
    }
  }

  /** Plays one of the effect animations of the flat board (frames on black, added to the picture) at a point, always turned to the camera. */
  private effect(name: string, at: THREE.Vector3, size: number): void {
    const sheet = this.sheets.get(name);
    const duration = (sheet?.seconds ?? 0) * 1000 * clock.factor;
    if (!sheet || duration <= 0 || clock.skip) return;
    const map = sheet.texture.clone();
    map.repeat.set(1 / sheet.cols, 1 / sheet.rows);
    map.needsUpdate = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, ...GLOW, depthWrite: false, depthTest: false }));
    sprite.scale.setScalar(size);
    sprite.position.copy(at);
    sprite.renderOrder = 5;
    this.scene.add(sprite);
    this.effects.push({ sprite, sheet, start: performance.now(), duration });
  }

  private stepEffects(now: number): void {
    this.effects = this.effects.filter((e) => {
      const t = (now - e.start) / e.duration;
      if (t >= 1 || clock.skip) {
        this.scene.remove(e.sprite);
        e.sprite.material.map?.dispose();
        e.sprite.material.dispose();
        return false;
      }
      const frame = Math.min(e.sheet.frames - 1, Math.floor(t * e.sheet.frames));
      e.sprite.material.map!.offset.set((frame % e.sheet.cols) / e.sheet.cols, 1 - (Math.floor(frame / e.sheet.cols) + 1) / e.sheet.rows);
      return true;
    });
  }

  /** The flash of a hit and a puff by how much it did; the target shudders. */
  async impact(hex: Hex, targetId?: string, look: HitLook = {}): Promise<void> {
    sound.play(hitSound(look));
    const at = this.at(hex);
    const target = targetId ? this.ships.get(targetId) : undefined;
    if (target) {
      target.shake = 1;
      at.y = target.yaw.position.y;
    }
    if (look.weapon === 'torpedo') this.effect('boom-ptn', at, R * 4.4);
    else if (look.weapon === 'missile') this.effect('boom-rkt', at, R * 3.8);
    else {
      this.effect(look.weapon === 'ion' ? 'flash-ion' : `flash-lsr-${1 + Math.floor(Math.random() * 6)}`, at, R * 2.6);
      const puff = look.effect === 'rock' ? 'boom-trb' : look.effect === 'heavy' ? 'puff-heavy' : look.effect === 'shield' ? 'puff-shield' : 'puff-hull';
      this.effect(puff, at, R * (look.effect === 'heavy' || look.effect === 'rock' ? 3.8 : 2.8));
    }
    await tween(450, () => undefined);
  }

  /** The end of a ship: a fireball, and for a large ship the smoke that goes on after it. */
  explode(hex: Hex, large = false, soundId: string = large ? 'explode.large' : 'explode.fighter'): void {
    sound.play(soundId);
    const at = this.at(hex);
    const colour = ['gld', 'wht', 'yel'][Math.floor(Math.random() * 3)]!;
    this.effect(`shipfire-${colour}`, at, R * (large ? 8 : 5.6));
    if (large) this.effect(`shipsmoke-${colour}`, at, R * 9);
  }

  /** Text that rises from a hex and fades: damage, destruction. */
  popup(hex: Hex, text: string, kind: string, slot = 0): void {
    const node = document.createElement('div');
    node.className = `pop3d ${kind}`;
    node.textContent = text;
    node.style.animationDelay = `${slot * 0.35}s`;
    node.style.marginTop = `${-slot * 20}px`;
    this.labels.append(node);
    this.popups.push({ node, at: this.at(hex, this.heightAt(hex) + R * 0.9), until: performance.now() + 3600 + slot * 350 });
  }

  private stepPopups(now: number): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.popups = this.popups.filter((p) => {
      if (now > p.until) {
        p.node.remove();
        return false;
      }
      const s = p.at.clone().project(this.camera);
      p.node.style.left = `${((s.x + 1) / 2) * w}px`;
      p.node.style.top = `${((1 - s.y) / 2) * h}px`;
      p.node.style.visibility = s.z < 1 ? 'visible' : 'hidden';
      return true;
    });
  }

  /** The asteroids are not on this board yet: what their movement does to the ships is still shown. */
  async playRocks(frames: RockFrame[], afterFrame?: (index: number) => Promise<void>): Promise<void> {
    for (let index = 0; index < frames.length; index++) await afterFrame?.(index);
  }
}

/** Takes away one of the two cannons of the cannon tower: the triangles of the cannon parts on one side of their middle (the twin cannon is one mesh; as tools/ships.js does for the pictures). */
function dropCannon(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !/^CannonTowerCannon(Base|End)_0$/.test(mesh.name) || !mesh.geometry.index) return;
    const position = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const mid = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).x;
    const v = new THREE.Vector3();
    const across = (i: number): number => v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).x;
    const index = mesh.geometry.index.array;
    const kept: number[] = [];
    for (let t = 0; t < index.length; t += 3) {
      const x = (across(index[t]!) + across(index[t + 1]!) + across(index[t + 2]!)) / 3;
      if (x >= mid) kept.push(index[t]!, index[t + 1]!, index[t + 2]!);
    }
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.setIndex(kept);
  });
}

/**
 * Light added to the picture (bolts, glows, the effect animations, which are frames on black). Only the colour is added: the picture is
 * not made any more solid by it, or the black round an explosion would hide the board that lies under the picture in the game.
 */
const GLOW = { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;

/** The colour of the engines' glow, by model file: red for the Rebel fighters and the TIEs, pale blue for the others. */
const ENGINE_COLOUR: Record<string, string> = {
  'x-wing': '#ff6f7d',
  'a-wing': '#ff7d5c',
  'b-wing': '#ff7d5c',
  'y-wing': '#ff8a5c',
  'y-wing-2seat': '#ff8a5c',
  'tie-fighter': '#ff4d3d',
  'tie-interceptor': '#ff4d3d',
  'tie-interceptor-prototype': '#ff4d3d',
  'tie-bomber': '#ff4d3d',
  'mon-calamari': '#ffb27a',
  'nebulon-b': '#ffb27a',
};

/** A rod one unit long along z, for the bolts. */
const BOLT_SHAPE = new THREE.CylinderGeometry(1, 1, 1, 8).rotateX(Math.PI / 2);

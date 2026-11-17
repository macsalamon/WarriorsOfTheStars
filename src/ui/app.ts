import { tacticalAi } from '../ai/tactical';
import type { Ai } from '../ai/player';
import {
  activeShips,
  chainFrom,
  moveWithOptions,
  nextPicker,
  rootOf,
  slotName,
  slotOf,
  MAX_LIMIT,
  MIN_LIMIT,
  applyCommand,
  applyStepToPosition,
  chanceAtLeast,
  PILOT,
  canCrewFire,
  crewGunStatus,
  crewGuns,
  endFireCrew,
  gunReaches,
  gunSlot,
  gunnerCrewId,
  livingGunners,
  planOf,
  seatOf,
  type ShotPreview,
  hazardOdds,
  hazardSkill,
  repairOptions,
  normalisePlan,
  other,
  rockAt,
  GROUP_OF,
  PAY_GROUPS,
  groupDifficulty,
  groupLevel,
  plannableActions,
  trackableEmplacements,
  trackableTargets,
  autoBase,
  baseItems,
  baseLayoutError,
  createRng,
  itemGuns,
  validBaseHexes,
  attackerZoneFor,
  MAP_EDGES,
  setupFacing,
  type MapEdge,
  type BaseItem,
  createGame,
  scenarioOptions,
  emptyPlan,
  arcOf,
  hasSideQuarters,
  roleOf,
  scenarioDef,
  STANDARD_MAP,
  type ShieldBox,
  asteroidDifficulty,
  auxSpent,
  bodyRating,
  describeRepairChoice,
  freeSteps,
  hexDistance,
  hexEquals,
  hexId,
  isTrackerComplete,
  leavesMap,
  legalSteps,
  moveContext,
  neighbor,
  PLAN_ACTIONS,
  planDifficultyEntries,
  previewShot,
  previewSpecial,
  previewRockShot,
  rockHexInReach,
  rockIdOf,
  rockTargetId,
  GROUND_TARGET_ID,
  emplacementInReach,
  isEmplacementTarget,
  previewEmplacementShot,
  turnFacing,
  turretName,
  turretOrdersFor,
  turretReaches,
  SPECIAL,
  SPECIAL_DICE,
  SPECIAL_NAMES,
  specialFor,
  specialMayHit,
  specialOf,
  shipById,
  slipIncomplete,
  speedAfterMarkers,
  startTracker,
  stateRng,
  stepTracker,
  tails,
  targetsInRange,
  toOffset,
  fromOffset,
  totalDifficulty,
  turnBreakdownAt,
  turnNumberAt,
  typeOf,
  waitingFor,
  withFeasibleObligations,
  DENSITY_NAMES,
  DENSITY_SHARE,
  type AsteroidDensity,
  type AsteroidMotion,
  type AsteroidOptions,
  type Chaos,
  type Command,
  type CommandResult,
  type DogfightMix,
  type Emplacement,
  type EmplacementTarget,
  type Facing,
  type ForceShip,
  type GameEvent,
  type GameState,
  type Hex,
  type MoveStep,
  type MoveStepCommand,
  type Pending,
  type PowerLoss,
  type Plan,
  type PlanAction,
  type PlayerId,
  type Rock,
  type Ship,
  type SkillReduction,
  type ShotOrder,
  type TurretOrder,
  TURRET_SKILL,
  stepSkill,
} from '../engine';
import {
  canFire,
  canMove as destroyerCanMove,
  currentDestroyer,
  capitalTargetsOf,
  destroyerById,
  destroyerHexes,
  nearestHexOf,
  specOf,
  specialStructureChance,
  destroyerShields,
  speedText,
  structureLeft,
  hexesAtSpeed,
  destroyerHexInReach,
  destroyerLegalSteps,
  destroyerMoveComplete,
  destroyerMaxSpeed,
  destroyerMoveContext,
  destroyerName,
  destroyerSpeedChoices,
  destroyerSpeedNow,
  destroyersOf,
  isCapitalType,
  isDestroyerTarget,
  isOnMap,
  previewDestroyerShot,
  type Destroyer,
} from '../engine';
import { ACTION_HAZARD_CODE, SHIPS, arrivalHexes, reserveGroup, rollNeeded, type DifficultyPart, type ScenarioDef } from '../engine';
import { Board, SHORT_NAMES, spriteUrl, type Overlay } from './board';
import type { RingAction, RingButton, RingButtons, SubmitAction } from './movering';
import { ACTION_INFO, ACTION_ORDER, buildPlanBox, type PowerContext } from './planbox';
import { choosePanelSpot } from './placement';
import { loadFlag, loadJson, loadNumber, saveFlag, saveJson, saveNumber } from './prefs';
import { crewOf, type CrewMember } from './crew';
import { forceBuilder, forceReveal, forceWaiting, bonusText } from './forces';
import { toggleButton } from './toggle';
import { NetClient, fetchHostLinks, guessHostAddress, type HostLinks, type LinkState } from '../net/client';
import type { SeatInfo, ServerMessage } from '../net/protocol';
import { listFiles, loadCustomScenarios, readFile, writeFile, type SaveListing } from './files';
import { SaveError, describeSave, makeSave, parseSave, readAutosave, saveFileName, serialise, writeAutosave, type SaveFile } from './savegame';
import { BLUE, RED, SCHEMES, SIDE_COLORS, applyColours, loadScheme, saveScheme, type Scheme } from './colours';
import { h, clear, append, type Child } from './dom';
import { aimPanel, emptySheet, shipSheet, type ActionPanel, type AimView, type CrewPick } from './sheet';
import { aimAt, allDone, allShots, armedLeft, canConfirm, heldBy, lockedBy, confirm as confirmCrew, gunAim, hold as holdCrew, newAim, reopen, selectCrew, selectedGuns, setTubes, switchOff, toggleGun, type AimKind, type AimSession } from './aim';
import { SPEEDS, clock, loadSpeed, saveSpeed, setSpeed, type Speed } from './anim';
import { playCommand } from './playback';
import { KEYS_HELP, KEY_ACTIONS } from './keys';
import { sound } from './sound';
import { soundPanel } from './soundpanel';
import { cockpitLevel, cockpitPitch } from './soundmap';
import { logLines } from './log';
import { chanceText, groundSheet, turretSheet } from './turrets';
import { gunTable, specialTable } from './guntable';
import type { AimLine } from './sheet';
import { capitalSheet } from './capital';
import { creditsPage } from './credits';

/** A ship that can be shot at from where the aiming crew member stands, with the numbers for its card. */
interface TargetEntry {
  t: Ship;
  gun: number;
  probe: Ship;
  range: number;
  o: { chance: number; preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number };
  /** The codes of the guns aimed at it. */
  aimedGuns: string[];
  done: boolean;
}

/** A turret gun or the ground target that can be shot at from where the aiming crew member stands, with the numbers for its card. */
interface EmplacementEntry {
  t: EmplacementTarget;
  gun: number;
  probe: Ship;
  range: number;
  o: { chance: number; preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number };
  aimedGuns: string[];
  done: boolean;
}

/** The orders being drawn up for one turret gun (Rules: Ground attack): turn a hex side, what to track, and when to fire. */
interface TurretDraft {
  turn: -1 | 0 | 1;
  target: string | null;
  /** The upper limit: fire at once at this chance to hit (null: only at the last chance). */
  chance: number | null;
  /** The lower limit: the least chance to hit for a last-chance shot. */
  lastChance: number;
}

interface CardOptions {
  /** Show the Move button (choosing the ship to move). */
  move?: boolean;
  /** The ship is a target for the aiming crew member. */
  target?: TargetEntry;
  /** Not a choice right now: shown dimmed. */
  dim?: boolean;
  /** Show the Move with button (advanced initiative, see Rules: Advanced initiative): the ship may be moved with by the ship whose turn it is to pick. */
  moveWith?: boolean;
}

const SIDE_NAMES = ['Rebels', 'Empire'] as const;
/** The full names: for the menu and the widest score board. Everywhere else the short ones fit better. */
const SIDE_LONG = ['Rebel Alliance', 'Galactic Empire'] as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The code of a ship on the compact cards and in short texts: B-1, MF-2, PP-1. */
const shortName = (s: Ship): string => `${SHORT_NAMES[s.typeId] ?? '?'}-${s.idNumber}`;
const fullName = (s: Ship): string => `${typeOf(s).name} #${s.idNumber}`;
const skillText = (c: { dice: number; pips: number }): string => (c.pips ? `${c.dice}D+${c.pips}` : `${c.dice}D`);
const percent = (p: number): string => `${Math.round(p * 100)}%`;
const fmtTurn = (n: number): string => (n === 0.5 ? '½' : String(n));

/** Effective plan for display: forced markers from last turn are merged in at submit (13). */
function effectivePlan(ship: Ship, plan: Plan): Plan {
  return {
    ...plan,
    roll: Math.min(2, plan.roll + ship.forcedRoll) as Plan['roll'],
    overspeed: Math.max(plan.overspeed, ship.forcedOverspeed) as Plan['overspeed'],
  };
}

interface Motion {
  speed: number;
  turn: number;
  planned: { speed: number; turn: number } | null;
}

/** Current speed and turn number, and, when a plan is being drawn up, what that plan would give. */
function motionOf(game: GameState, ship: Ship, draft?: Plan): Motion {
  // once the plans are revealed the ship's own plan decides this game-turn's turn number (Rules: Planning)
  const nowPlan = game.phase === 'ships' ? ship.plan : emptyPlan();
  const motion: Motion = { speed: ship.speed, turn: turnNumberAt(ship, nowPlan, ship.speed), planned: null };
  if (draft) {
    const eff = effectivePlan(ship, draft);
    const speed = speedAfterMarkers(ship, eff);
    motion.planned = { speed, turn: turnNumberAt(ship, eff, speed) };
  }
  return motion;
}

/** Deflector shield markers now, and after the planned angling (Rules: Markers step). */
function shieldText(ship: Ship, plan: Plan, wide: boolean): string {
  const list = (s: Record<ShieldBox, number>): string => (wide ? `front ${s.front} · rear ${s.rear} · left ${s.left} · right ${s.right}` : `front ${s.front} · rear ${s.rear}`);
  const now = `Shields: ${list(ship.shields)}`;
  if (plan.angleDeflectors === 0 || !plan.deflectorDirection) return now;
  const to = plan.deflectorDirection;
  const from = plan.deflectorFrom ?? (to === 'front' ? 'rear' : 'front');
  const moved = Math.min(plan.angleDeflectors, ship.shields[from]);
  if (moved === 0) return now;
  const after = { ...ship.shields };
  after[from] -= moved;
  after[to] += moved;
  return `${now}  →  planned: ${list(after)}`;
}

/** The shield markers of a ship in a few characters: F2 R1, and with the advanced arcs front 2 · rear 1 · left 0 · right 0 (Rules: Advanced arcs). */
function shieldBrief(game: GameState, ship: Ship): string {
  const s = ship.shields;
  return hasSideQuarters(game, ship) ? `front ${s.front} · rear ${s.rear} · left ${s.left} · right ${s.right}` : `F${s.front} R${s.rear}`;
}

function motionText(m: Motion): string {
  const now = `Speed ${m.speed} · Turn ${fmtTurn(m.turn)}`;
  return m.planned ? `${now}  →  planned: speed ${m.planned.speed} · turn ${fmtTurn(m.planned.turn)}` : now;
}

interface MoveSim {
  pos: Hex;
  facing: Facing;
  path: Hex[];
  legal: MoveStep[];
  complete: boolean;
  budget: number;
  turnNumber: number;
  speed: number;
  canTurn: boolean;
  waived: string[];
  slipRequired: boolean;
  /** A slip is under way and has not yet run its minimum length. */
  slipOpen: boolean;
  loopsLeft: number;
}

function simulate(game: GameState, ship: Ship, steps: MoveStepCommand[]): MoveSim {
  const { ctx, waived } = withFeasibleObligations(moveContext(ship));
  let tr = startTracker(ctx);
  let pos = ship.pos!;
  let facing = ship.facing;
  const path = [pos];
  for (const step of steps) {
    const next = stepTracker(ctx, tr, step.kind);
    if (!next) break;
    tr = next;
    if (step.kind !== 'snapFire') {
      const moved = applyStepToPosition(pos, facing, step.kind);
      pos = moved.pos;
      facing = moved.facing;
      if (tr.hexesMoved > path.length - 1) path.push(pos);
    }
  }
  void game;
  const slips = tr.slipsDone + (tr.slip ? 1 : 0);
  return {
    pos,
    facing,
    path,
    legal: legalSteps(ctx, tr),
    complete: isTrackerComplete(ctx, tr),
    budget: tr.budget,
    turnNumber: ctx.turnNumber,
    speed: ctx.speed,
    canTurn: ctx.speed === 0 || (tr.credits > 0 && ctx.turnNumber <= ctx.speed),
    waived,
    slipRequired: ctx.slipRequired && slips < 1,
    slipOpen: slipIncomplete(ctx, tr),
    loopsLeft: Math.max(0, ctx.loopsRequired - tr.loopsDone),
  };
}

export class App {
  private game!: GameState;
  private human: PlayerId = 0;
  private aiPlayer: PlayerId = 1;
  private ai!: Ai;
  /** The computer player's dice. They live in a plain object so that a save can keep them. */
  private aiRng = { rngState: 0 };
  /** Every command given in this game, by both sides. */
  private history: Command[] = [];
  /** The line to the host in a network game; null when playing the computer. */
  private net: NetClient | null = null;
  /** What this player asked for on the menu: host creates the game once connected, join waits for it. */
  private netIntent: { mode: 'host' | 'join'; /** A saved game (the text of its file) the host carries on with instead of a new one. */ loadText?: string; create: { mix: DogfightMix; points?: [number, number]; hostChooses?: boolean; seed: number; skillReduction: SkillReduction; hostSide: PlayerId; damageRules?: boolean; specialWeapons?: boolean; asteroids?: AsteroidOptions; advancedInitiative?: boolean; advancedArcs?: boolean; mapMode?: 'static' | 'open' } } | null = null;
  private inNetGame = false;
  private isHost = false;
  private seats: [SeatInfo, SeatInfo] = [{ taken: false, connected: false }, { taken: false, connected: false }];
  private link: LinkState = 'closed';
  /** A command went to the host and its answer has not come back yet. */
  private awaiting = false;
  private cmdId = 0;
  private updates: Extract<ServerMessage, { type: 'update' }>[] = [];
  private applying = false;
  private netStatus: HTMLElement | null = null;
  private meta: { mix: DogfightMix; points?: [number, number]; seed: number; skillReduction: SkillReduction } = { mix: 'four', seed: 1, skillReduction: 0 };
  private board!: Board;
  private boardHost!: HTMLElement;
  /** The switch for showing the fighters at half their size in the 3D view of a game with capital ships (see `render`). */
  private smallFighters!: HTMLButtonElement;
  /** The board is shown in 3D: the ships as models flying over the board, which lies as the table (see `Table` in board.ts). */
  private view3d = loadFlag('view3d');
  private sidebar!: HTMLElement;
  private logEl!: HTMLElement;
  private sheetEl!: HTMLElement;
  /** The strip under the menu: what the player has to do now (plan, move). */
  private cmdEl!: HTMLElement;
  private status!: HTMLElement;
  private skipButton!: HTMLButtonElement;
  /** Show the log's full sentences instead of the short coloured lines. */
  private logFull = false;
  private speed: Speed = loadSpeed();
  private scheme: Scheme = loadScheme();
  /** A move or volley is being played back: the game is already decided, the screen is catching up. */
  private animating = false;

  private selected: string | null = null;
  /** The ship under the mouse, on the board or in the list: its record sheet is shown. */
  private hovered: string | null = null;
  /** What damage the player has already been shown, so only new hits pop up on the board. */
  private seenWounds = new Map<string, number>();
  /** Wounds the playback has already shown, by position in the ship's list: they are not floated up again when the board is drawn. */
  private shownWounds = new Map<string, Set<number>>();
  /** Asteroids in reach of a gun are offered as targets (Rules: Asteroid fields); switched off, only ships are. */
  private shootRocks = !loadFlag('noshootrocks');
  private seenDestroyed = new Set<string>();
  /** Turret guns that have been shown losing a gun, and what the ground target has been shown suffering. */
  private seenReduced = new Set<string>();
  private seenGround = 0;
  /** The turret orders being drawn up (Rules: Ground attack), the turret being set, and the game-turn they were started for. */
  private turretDraft = new Map<string, TurretDraft>();
  private turretSel: string | null = null;
  /** The rules of engagement being chosen for the selected turret gun, not yet given to it or to all (Rules: Ground attack). */
  private roeStage: { id: string; chance: number | null; lastChance: number } | null = null;
  private turretDraftTurn = -1;
  /** Network game: the turret orders are on their way and the plans follow as soon as the host has them. */
  private commitAfterTurrets = false;
  /** The forward arcs of the enemy's turret guns are drawn (the danger zones). */
  private showTurretArcs = !loadFlag('noturretarcs');
  /** The range of fire of the enemy capital ships is shaded. */
  private showCapitalRange = !loadFlag('nocapitalrange');
  private lastPos = new Map<string, Hex>();
  /** The ships being bought in a points game, before the force is handed in (35). */
  private forceDrafts: [ForceShip[], ForceShip[]] = [[], []];
  /** Which side's tab is open when one player chooses both forces. */
  private forceSide: PlayerId = 0;
  /** Both forces have been shown to this player (the screen after both have bought). */
  private forcesSeen = true;
  private overlayEl: HTMLElement | null = null;
  private placingId: string | null = null;
  /** The move being drawn up for one of the human's Star Destroyers (Rules: Star Destroyers), and which steps came from which click. */
  private sdSteps: MoveStep[] = [];
  private sdGroups: number[] = [];
  private sdKey = '';
  /** The speed chosen for the Star Destroyer being moved (its speed now when null). */
  private sdSpeed: number | null = null;
  /** The ground target and base the defending player is placing, before confirming (Rules: Ground attack). */
  private baseDraft = new Map<string, { pos: Hex; facing: number }>();
  private baseFitted = false;
  /** The edge the attacker is thinking of coming from (Rules: Ground attack), shaded before it is confirmed. */
  private edgeDraft: MapEdge | null = null;
  /** The edge a reserve group is placed along, when its owner chooses it. */
  private arrivalEdge: MapEdge | null = null;
  /** The placed ship that shows its turn arrows: the one just put down, or the one clicked. */
  private turning: string | null = null;
  private draft = new Map<string, { pos: Hex; facing: Facing }>();
  private plans: Record<string, Plan> = {};
  /** The gunners' plans being drawn up, by ship, in seat order. */
  private crewPlans: Record<string, Plan[]> = {};
  /** Whose actions the planning box is showing: 'pilot', 'gunner1'... */
  private planCrew = 'pilot';
  /** The aux / R2 button of the planning box is on: the next action clicked is a free one (Rules: R2 units, auxiliary power and damage control). */
  private freeMode = false;
  private planShip: string | null = null;
  /** The floating planning box on the board, where the player dragged it to (null: the best free spot), and what the automatic spot was worked out for. */
  private planEl!: HTMLElement;
  private planManual: { x: number; y: number } | null = null;
  private planAuto = { x: 8, y: 8 };
  private planAutoKey = '';
  private planNonce = 0;
  /** Ships whose plan the player has finished; they are greyed on the board until all plans are committed. */
  private submitted = new Set<string>();
  /** The submitted ship that is offering to keep or reopen its plan. */
  private confirming: string | null = null;
  /** The "you haven't submitted all ships" question is showing. */
  private commitAsk = false;
  private moveSteps: MoveStepCommand[] = [];
  /** How many steps each click added, so that Undo takes back a whole click ("forward" may run several hexes). */
  private moveGroups: number[] = [];
  /** Aiming in progress: a snap shot during the move, or the Fire Segment (Rules: Gunners and turrets). */
  private aim: AimSession | null = null;
  private aimTurn = 0;
  /** The ship and turn whose Fire Segment was passed for lack of targets (so the pass is sent once). */
  private skippedFire = '';
  /** The target whose difficulty breakdown is open in the list. */
  private aimDetail: string | null = null;
  private get snapPicking(): boolean {
    return this.aim?.kind === 'snap';
  }
  private message = '';
  private pumping = false;
  /** The ship whose owner was last asked when it moves (advanced initiative): the board centres on it when it changes. */
  private lastPicker: string | null = null;
  private labels = false;
  /** How wide the right-hand column is: 0 the full ship cards, 1 narrow (codes and a line of numbers), 2 only the icons with their codes. */
  private sideMode: 0 | 1 | 2 = Math.min(2, Math.max(0, loadNumber('sidebarMode', 0) || (loadFlag('sidebarCompact') ? 1 : 0))) as 0 | 1 | 2;
  /** The left-hand column (ship window and log) is folded away. */
  private leftFolded = loadFlag('leftFolded');
  private layoutEl!: HTMLElement;
  private foldLeftBtn!: HTMLButtonElement;
  private widerBtn!: HTMLButtonElement;
  private narrowerBtn!: HTMLButtonElement;
  /** Ships sharing a hex are drawn side by side. */
  private splitStacks = loadFlag('split');
  private lastStage = '';
  private turnWhyOpen = false;

  constructor(private root: HTMLElement) {
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.showMenu();
  }

  // ------------------------------------------------------------------ menu

  private showMenu(): void {
    this.board?.setTable(null);
    this.leaveNetwork();
    sound.cockpit(null);
    clear(this.root);
    this.overlayEl = null;
    // each card lists the sides in the same order: who it is, the ships, and the quality of the pilots (and gunners)
    const mixes: { id: DogfightMix; title: string; lines: string[] }[] = [
      { id: 'one', title: 'Dogfight One', lines: [
        'Rebels (1 bonus point): 3 X-wings (1 veteran, 2 average pilots).',
        'Empire: 2 TIE interceptors (veteran pilots) and 2 TIE fighters (poor pilots).',
      ] },
      { id: 'two', title: 'Dogfight Two', lines: [
        'Rebels: 3 A-wings (1 veteran, 2 average pilots).',
        'Empire (1 bonus point): 3 TIE interceptors (1 veteran, 2 average pilots).',
      ] },
      { id: 'three', title: 'Dogfight Three', lines: [
        'Rebels (4 bonus points): 2 X-wings and a Y-wing (veteran pilots).',
        'Empire: 6 TIE fighters (1 veteran, 5 average pilots).',
      ] },
      { id: 'four', title: 'Dogfight Four', lines: [
        'Rebels (1 bonus point): 1 X-wing (hot-shot pilot).',
        'Empire: 3 TIE fighters (average pilots).',
        'Strongly favours the X-wing.',
      ] },
      { id: 'ground1', title: 'Ground Attack One', lines: [
        'Rebels (attack): 3 X-wings (1 veteran, 2 average pilots) and 2 Y-wings (1 veteran, 1 average pilot).',
        'Empire (defend, 1 bonus point): a TIE interceptor (veteran pilot) and 2 TIE fighters (1 veteran, 1 average pilot). The base has 3 double and 6 single turret guns.',
        'With missiles, torpedoes and bombs on (the default here) the Empire also has an average TIE interceptor.',
      ] },
      { id: 'ground2', title: 'Ground Attack Two', lines: [
        'Rebels (defend, 2 bonus points): 3 X-wings (1 veteran, 2 average pilots). The base has 3 double and 6 single turret guns.',
        'Empire (attack): 3 TIE interceptors (veteran pilots) and 3 TIE fighters (average pilots).',
        'With missiles, torpedoes and bombs on (the default here) the TIE fighters are TIE bombers.',
      ] },
      { id: 'ground3', title: 'Ground Attack Three', lines: [
        'Rebels (attack): an A-wing (hot-shot pilot) and 2 B-wings (veteran pilots).',
        'Empire: no ships, only 8 double and 7 single turret guns.',
        'Suggested as a solo scenario.',
      ] },
      { id: 'convoy1', title: 'Convoy One', lines: [
        'Rebels (attack): 3 A-wings (veteran pilots).',
        'Empire (convoy, 1 bonus point): a light freighter (poor pilot and gunner) and 3 TIE fighters (1 veteran, 2 average pilots).',
        'On the adjustable map all the TIE fighters have veteran pilots.',
      ] },
      { id: 'convoy2', title: 'Convoy Two', lines: [
        'Rebels (convoy): 2 light freighters (average pilots, poor gunners) and 2 X-wings (veteran pilots).',
        'Empire (attack): 3 TIE fighters (average pilots) and 3 TIE interceptors (1 veteran, 2 average pilots).',
        'A tie in points is a Rebel win. On the adjustable map the Rebels get one more X-wing (veteran pilot).',
      ] },
      { id: 'convoy3', title: 'Convoy Three', lines: [
        'Rebels (attack): 3 Y-wings (average pilots) and 3 B-wings (veteran pilots).',
        'Empire (convoy): a shuttle (average pilot and gunner) and 3 TIE interceptors (veteran pilots).',
        'A tie in points is a Rebel win. On the adjustable map the Empire gets one more TIE interceptor prototype (veteran pilot).',
      ] },
      { id: 'asteroid2', title: 'Asteroid Run', lines: [
        'Rebels (convoy): the Millennium Falcon (hot-shot pilot, no gunners). It starts along the top or the bottom edge, in a dense asteroid field.',
        'Empire (attack): 5 TIE fighters (veteran pilots). They wait off the map and are placed along the same edge after game-turn 1.',
        'The Rebels win if the Falcon leaves the map across the opposite edge, or if all the TIE fighters are destroyed. The Empire wins if the Falcon is destroyed. The asteroids rest during the first game-turn.',
      ] },
      { id: 'destroyers1', title: 'Capital Ship Battle One', lines: [
        'Rebels: 6 X-wings (1 hot-shot, 5 veteran pilots).',
        'Empire: a Star Destroyer (gunnery 5D).',
        'The Rebels have to bring the Star Destroyer down; it is a hard fight.',
      ] },
      { id: 'destroyers6', title: 'Capital Ship Battle Two', lines: [
        'Rebels (2 bonus points): 9 A-wings and 6 B-wings (veteran pilots).',
        'Empire: a Star Destroyer (gunnery 6D) and 3 TIE interceptors (veteran pilots).',
      ] },
      { id: 'destroyers8', title: 'Frigate Duel', lines: [
        'Rebels (88 points): a Nebulon-B frigate, 2 Y-wings (veteran pilots) and 2 X-wings (1 veteran, 1 hot-shot pilot).',
        'Empire (88 points): a Nebulon-B frigate, 2 TIE interceptors (1 hot-shot, 1 veteran pilot), 2 TIE fighters and 2 TIE bombers (average pilots).',
        'The lighter capital ship battle: small ships, little time.',
      ] },
      { id: 'destroyers7', title: 'Fleet Battle', lines: [
        'Rebels (241 points): a Mon Calamari cruiser, 3 X-wings, 3 A-wings and 3 B-wings (in each group 2 veteran pilots and 1 hot-shot).',
        'Empire (241 points): a Star Destroyer, a TIE interceptor prototype (hot-shot pilot), 4 TIE interceptors and 4 TIE bombers (veteran pilots), 4 TIE fighters (3 average pilots, 1 veteran).',
        'A large, lore-true battle for people with plenty of time.',
      ] },
      { id: 'showcase', title: 'Ship showcase', lines: [
        'Not a real scenario: all 14 kinds of ship on the Rebel side against one TIE fighter (all average pilots), so you can look at the pictures.',
      ] },
    ];
    // the premade scenarios are shown by kind, each kind with its own short rules
    const kinds: { title: string; rules: string; ids: DogfightMix[] }[] = [
      { title: 'Dogfight', rules: 'Just a furball: two forces clash in space. Some give one side bonus victory points at the start.', ids: ['one', 'two', 'three', 'four'] },
      { title: 'Ground Attack', rules: 'One side attacks a base: a ground target with turret guns round it. Destroying the ground target scores 10 victory points. The game ends when no attacker is left.', ids: ['ground1', 'ground2', 'ground3'] },
      { title: 'Convoy', rules: 'The convoy ships try to leave the map; the other side tries to stop them. Every designated convoy ship that escapes scores 10 victory points. The game ends when every convoy ship or every attacker is gone.', ids: ['convoy1', 'convoy2', 'convoy3'] },
      { title: 'Asteroids', rules: 'A run through a dense asteroid field. Some ships wait off the map and come in later. The game ends at once when the runner gets away or is destroyed.', ids: ['asteroid2'] },
      { title: 'Capital Ship Battles', rules: 'The Empire’s Star Destroyer is 17 hexes big, the Rebels’ Mon Calamari cruiser 13, a Nebulon-B frigate (either side) four. A capital ship moves by itself (you set its speed and turn it) and fires at every fighter that comes within ten hexes of it; the capital ships pick one enemy capital ship each as their target after they have moved. Hits take structure points off it: a Star Destroyer can’t fire any more at 8 lost and is dead in space at 9, a Mon Calamari cruiser at 7 and 8, a frigate is dead in space at 4. The map is half as big again in each direction. Damaging one scores victory points. The game ends when all the fighters of a side are gone and its capital ships can’t fire any more.', ids: ['destroyers1', 'destroyers6', 'destroyers8', 'destroyers7'] },
    ];
    // first start (nothing remembered yet): Dogfight One, against the computer, normal playback speed, both side columns fully open
    let mix: DogfightMix = 'one';
    // what the game is made of: one of the printed ship mixes, or forces bought with points (35)
    let kind: 'preset' | 'points' = 'preset';
    let page: 'main' | 'presets' | 'points' | 'credits' = 'main';
    const limits: [number, number] = [40, 40];
    // in a points game: each player buys their own force, or the host chooses both
    let hostPicks = false;
    let side: PlayerId = 0;
    // the R2, auxiliary power and damage control rules (16, 17): on for points games unless the player chose otherwise
    let damage: boolean | null = null;
    const damageOn = (): boolean => damage ?? kind === 'points';
    let special: boolean | null = null;
    // advanced initiative (19): off unless chosen; the computer players use it, but the standard way is the one to play against them
    let advanced = false;
    // advanced arcs (Rules: Advanced arcs): port and starboard quarters and angled shields for ships with a body rating of 10 or more; on unless switched off
    let arcs = true;
    // the map (Rules: The map): the scenario says which one it normally uses; asteroids and the Ground Attack always use the static one
    let mapChoice: 'static' | 'adjustable' | null = null;
    const mapForced = (): boolean => isGround() || field !== 'off';
    const mapNow = (): 'static' | 'adjustable' => (mapForced() ? 'static' : mapChoice ?? (kind === 'preset' ? scenarioDef(mix)?.map : undefined) ?? 'adjustable');
    // Ground Attack: without torpedoes and bombs the ground target is out of reach, so they are on unless the player chose otherwise
    const specialOn = (): boolean => special ?? (kind === 'points' || (kind === 'preset' && !!scenarioDef(mix)?.suggests?.includes('specialWeapons')));
    // the skill of the turret guns, to balance a Ground Attack
    let turretSkill: { dice: number; pips: number } = { ...TURRET_SKILL };
    // the gunnery skill of the Star Destroyers: what the scenario says unless the player changes it
    let destroyerSkill: { dice: number; pips: number } | null = null;
    const hasDestroyer = (): boolean => kind === 'preset' && !!scenarioDef(mix)?.sides.some((side) => side.ships.some((sh) => sh.typeId === 'star-destroyer' || sh.typeId === 'mon-calamari'));
    const scenarioSdSkill = (): { dice: number; pips: number } => scenarioDef(mix)?.sides.flatMap((side) => side.ships).find((sh) => sh.typeId === 'star-destroyer')?.skill ?? { dice: 5, pips: 0 };
    const isGround = (): boolean => kind === 'preset' && mix.startsWith('ground');
    // capital ships are far bigger than in the board game and do not fire at asteroids: a scenario with one has no asteroid field
    const hasCapital = (): boolean => kind === 'preset' && !!scenarioDef(mix)?.sides.some((side) => side.ships.some((sh) => isCapitalType(sh.typeId)));
    const noField = (): boolean => isGround() || hasCapital();
    // the asteroid field (Rules: Asteroid fields): how thick, and how it moves
    const FIELDS = ['off', 'sparse', 'medium', 'dense'] as const;
    let field: (typeof FIELDS)[number] = 'off';
    let motion: AsteroidMotion = 'drift';
    let chaos: Chaos = 4;
    // turret guns and asteroids are never combined: a Ground Attack has no asteroid field, whatever was chosen before
    // some scenarios need an asteroid field: the density they name is used when the player left it off
    const scenarioField = (): AsteroidDensity | null => (kind === 'preset' ? scenarioDef(mix)?.asteroids?.density ?? null : null);
    const asteroidOptions = (): AsteroidOptions | undefined => (noField() ? undefined : field !== 'off' ? { density: field as AsteroidDensity, motion, chaos } : scenarioField() ? { density: scenarioField()!, motion, chaos } : undefined);
    let labels = false;
    let mode: 'solo' | 'host' | 'join' = 'solo';
    // everything chosen on the menu is remembered, so that the next game starts from the same choices (the seed is new every time)
    const remembered = loadJson('menu');
    const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
    if (remembered) {
      mix = pick(remembered.mix, mixes.map((m) => m.id), mix);
      kind = pick(remembered.kind, ['preset', 'points'] as const, kind);
      hostPicks = remembered.hostPicks === true;
      side = pick(remembered.side, [0, 1] as const, side);
      damage = typeof remembered.damage === 'boolean' ? remembered.damage : null;
      special = typeof remembered.special === 'boolean' ? remembered.special : null;
      advanced = remembered.advanced === true;
      arcs = remembered.arcs !== false;
      const saved = remembered.turretSkill as { dice?: number; pips?: number } | undefined;
      if (saved && Number.isInteger(saved.dice) && [0, 1, 2].includes(saved.pips ?? -1)) turretSkill = { dice: Math.min(12, Math.max(1, saved.dice!)), pips: saved.pips! };
      field = pick(remembered.field, FIELDS, field);
      motion = pick(remembered.motion, ['drift', 'events'] as const, motion);
      chaos = pick(remembered.chaos, [2, 4, 6] as const, chaos);
      labels = remembered.labels === true;
      mode = pick(remembered.mode, ['solo', 'host', 'join'] as const, mode);
      if (Array.isArray(remembered.limits)) {
        for (const p of [0, 1] as const) {
          const n = Number(remembered.limits[p]);
          if (Number.isInteger(n)) limits[p] = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
        }
      }
    }
    // the link the host sends (the page's address with ?join): the menu opens on joining that host
    const invited = new URLSearchParams(location.search).has('join');
    if (invited) mode = 'join';
    const modes: { id: 'solo' | 'host' | 'join'; title: string; text: string }[] = [
      { id: 'solo', title: 'Against the computer', text: 'You play one side, the computer the other.' },
      { id: 'host', title: 'Host a network game', text: 'Another player joins from their own computer. You pick the scenario and your side. The host program has to be running on this computer (npm run host).' },
      { id: 'join', title: 'Join a network game', text: 'Join a game somebody else is hosting. Enter their address.' },
    ];
    const modeButtons = modes.map((m) =>
      h('button', { class: 'card', onclick: () => { mode = m.id; refresh(); } }, h('b', null, m.title), h('span', null, m.text)),
    );
    const address = h('input', { type: 'text', class: 'address', placeholder: 'e.g. 192.168.1.20:8787', spellcheck: false, value: typeof remembered?.address === 'string' ? remembered.address : '' });
    void guessHostAddress().then((guess) => { if (!address.value || invited) address.value = guess; });
    const remember = (): void => saveJson('menu', { mix, kind, limits, hostPicks, side, damage, special, advanced, arcs, turretSkill, field, motion, chaos, labels, mode, address: address.value });
    address.addEventListener('change', remember);
    const netError = h('p', { class: 'error', hidden: true });
    if (this.netNotice) {
      netError.hidden = false;
      netError.textContent = this.netNotice;
      this.netNotice = '';
    }
    const startButton = h('button', { class: 'primary' }, 'Start game');
    let reduction = Math.min(3, Math.max(0, loadNumber('skillReduction'))) as SkillReduction;
    const reductions: { level: SkillReduction; title: string; text: string }[] = [
      { level: 0, title: 'None', text: 'Skills are rolled as the rules say: every die 1–6.' },
      { level: 1, title: 'Level 1', text: 'Every die counts 2–5 (1D4+1).' },
      { level: 2, title: 'Level 2', text: 'Every die counts 3 or 4 (1D2+2).' },
      { level: 3, title: 'Level 3', text: 'Every die counts 3.5, the sum rounded up: no luck at all.' },
    ];
    const reductionButtons = reductions.map((r) =>
      h('button', { class: 'card small', onclick: () => { reduction = r.level; saveNumber('skillReduction', r.level); refresh(); } }, h('b', null, r.title), h('span', null, r.text)),
    );
    const speedButtons = SPEEDS.map((sp) =>
      h('button', { class: 'card small' + (sp.id === this.speed ? ' on' : ''), title: sp.hint, onclick: () => { this.speed = sp.id; saveSpeed(sp.id); setSpeed(sp.id); refresh(); } }, h('b', null, sp.label)),
    );
    const seed = h('input', { type: 'number', value: String(Math.floor(Math.random() * 100000)), class: 'seed' });
    const mixButtons = mixes.map((m) =>
      h('button', { class: 'card' + (m.id === mix ? ' on' : ''), onclick: () => { mix = m.id; kind = 'preset'; page = 'main'; refresh(); } }, h('b', null, m.title), ...m.lines.map((line) => h('span', null, line))),
    );
    const sideButtons = ([0, 1] as PlayerId[]).map((p) =>
      h('button', { class: 'card small' + (p === side ? ' on' : ''), onclick: () => { side = p; refresh(); } }, h('b', null, SIDE_LONG[p])),
    );
    const damageButtons = [
      h('button', { class: 'card small', onclick: () => { damage = false; refresh(); } }, h('b', null, 'Off'), h('span', null, 'Basic damage rules.')),
      h('button', { class: 'card small', onclick: () => { damage = true; refresh(); } }, h('b', null, 'On'), h('span', null, 'R2 units, auxiliary power and damage control. Ships use their lower body rating.')),
    ];
    const specialButtons = [
      h('button', { class: 'card small', onclick: () => { special = false; refresh(); } }, h('b', null, 'Off'), h('span', null, 'Guns only.')),
      h('button', { class: 'card small', onclick: () => { special = true; refresh(); } }, h('b', null, 'On'), h('span', null, 'Proton torpedoes, concussion missiles and bombs for the ships that carry them. The pilot fires them at targets up to ten hexes away.')),
    ];
    const initiativeButtons = [
      h('button', { class: 'card small', onclick: () => { advanced = false; refresh(); } }, h('b', null, 'Basic'), h('span', null, 'The player with the better roll chooses a ship first, then the other player. A ship that tails an enemy can pass or steal a move.')),
      h('button', { class: 'card small', onclick: () => { advanced = true; refresh(); } }, h('b', null, 'Advanced'), h('span', null, 'Every pilot rolls. Starting with the highest roll, the owners say when their ship moves. A ship can move together with the ship it tails.')),
    ];
    const arcButtons = [
      h('button', { class: 'card small', onclick: () => { arcs = false; refresh(); } }, h('b', null, 'Basic'), h('span', null, 'Every ship has a front and a rear quarter, and front and rear shields.')),
      h('button', { class: 'card small', onclick: () => { arcs = true; refresh(); } }, h('b', null, 'Advanced'), h('span', null, 'Ships with a body rating of 10 or more also have left and right quarters, and can angle deflectors to the left and right.')),
    ];
    const mapButtons = [
      h('button', { class: 'card small', onclick: () => { mapChoice = 'static'; refresh(); } }, h('b', null, 'Static'), h('span', null, 'The map has a static border. A ship that flies off it has escaped.')),
      h('button', { class: 'card small', onclick: () => { mapChoice = 'adjustable'; refresh(); } }, h('b', null, 'Adjustable'), h('span', null, 'The board follows the fleet. A ship that flies too far from the others has escaped. Games last longer; some convoy scenarios give the weaker side extra ships.')),
    ];
    const turretValue = h('b', { class: 'skillvalue' });
    const turretBox = h('div', { class: 'row turretskill', hidden: true },
      h('button', { class: 'card small', title: 'One step down: 5D+2, 5D+1, 5D, 4D+2...', onclick: () => { turretSkill = stepSkill(turretSkill, -1); refresh(); } }, h('b', null, '−')),
      turretValue,
      h('button', { class: 'card small', title: 'One step up: 5D, 5D+1, 5D+2, 6D...', onclick: () => { turretSkill = stepSkill(turretSkill, 1); refresh(); } }, h('b', null, '+')),
    );
    const sdValue = h('b', { class: 'skillvalue' });
    const sdBox = h('div', { class: 'row turretskill', hidden: true },
      h('button', { class: 'card small', title: 'One step down: 5D+2, 5D+1, 5D, 4D+2...', onclick: () => { destroyerSkill = stepSkill(destroyerSkill ?? scenarioSdSkill(), -1); refresh(); } }, h('b', null, '−')),
      sdValue,
      h('button', { class: 'card small', title: 'One step up: 5D, 5D+1, 5D+2, 6D...', onclick: () => { destroyerSkill = stepSkill(destroyerSkill ?? scenarioSdSkill(), 1); refresh(); } }, h('b', null, '+')),
      h('button', { class: 'card small', title: 'Back to what the scenario says', onclick: () => { destroyerSkill = null; refresh(); } }, h('b', null, 'Reset')),
    );
    const fieldButtons = FIELDS.map((d) =>
      h('button', { class: 'card small', onclick: () => { field = d; refresh(); } },
        h('b', null, d === 'off' ? 'None' : DENSITY_NAMES[d]),
        h('span', null, d === 'off' ? 'Open space.' : `${Math.round(DENSITY_SHARE[d] * 100)}% of the map is asteroid.`)),
    );
    const asteroidNote = h('p', { class: 'sub', hidden: true }, 'Not in a Ground Attack: turret guns and asteroids can\'t be combined.');
    const motionButtons = [
      h('button', { class: 'card small', onclick: () => { motion = 'drift'; refresh(); } }, h('b', null, 'Drifting'), h('span', null, 'Every asteroid has a direction and speed of its own, and bounces off the others. A faint line shows where it will be next turn.')),
      h('button', { class: 'card small', onclick: () => { motion = 'events'; refresh(); } }, h('b', null, 'Dice events'), h('span', null, 'Each turn a few random events move all asteroids of one size by a die roll. Movement starts on the second turn.')),
    ];
    const chaosButtons = ([2, 4, 6] as Chaos[]).map((n) =>
      h('button', { class: 'card small', onclick: () => { chaos = n; refresh(); } }, h('b', null, `${n} events`), h('span', null, n === 2 ? 'Calm.' : n === 4 ? 'Lively.' : 'Chaotic.')),
    );
    const fieldMore = h('div', { hidden: true },
      h('h2', null, 'How the asteroids move'),
      h('div', { class: 'cards' }, ...motionButtons),
      h('div', { class: 'cards', hidden: true }, ...chaosButtons),
    );
    const schemeButtons = SCHEMES.map((sc) =>
      h('button', { class: 'card small', title: sc.hint, onclick: () => { this.scheme = sc.id; saveScheme(sc.id); refresh(); } },
        h('b', null, h('span', { style: { color: BLUE.text } }, sc.blue), ' · ', h('span', { style: { color: RED.text } }, sc.red))),
    );

    // the two ways to choose what is fought with: each has its own page
    const scenarioLine = h('p', { class: 'chosen' });
    const presetsButton = h('button', { class: 'card', onclick: () => { page = 'presets'; refresh(); } },
      h('b', null, 'Premade scenarios'), h('span', null, 'Choose one of the ready-made scenarios.'));
    const pointsButton = h('button', { class: 'card', onclick: () => { page = 'points'; refresh(); } },
      h('b', null, 'Buy forces with points'), h('span', null, 'Both players buy ships, pilots and gunners with ship points.'));
    const limitInputs = ([0, 1] as PlayerId[]).map((p) => {
      const input = h('input', { type: 'number', class: 'seed', min: String(MIN_LIMIT), max: String(MAX_LIMIT), step: '1', value: String(limits[p]) });
      input.addEventListener('input', () => {
        limits[p] = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(Number(input.value) || MIN_LIMIT)));
        bonusLine.textContent = bonusText(limits);
        remember();
      });
      return input;
    });
    const bonusLine = h('p', { class: 'sub' });
    const whoButtons = [
      h('button', { class: 'card', onclick: () => { hostPicks = false; refresh(); } },
        h('b', null, 'Each player buys their own force'),
        h('span', null, 'Both players choose at the same time and see the forces when both are done. Use this for a points game against another person.')),
      h('button', { class: 'card', onclick: () => { hostPicks = true; refresh(); } },
        h('b', null, 'The host chooses both forces'),
        h('span', null, 'You build both forces yourself, for a scenario that makes sense in the Star Wars universe. The other player, or the computer, just deploys. The AI buys at random, so use this for a points game against it, since the AI doesn\'t make strategic or lore-abiding choices.')),
    ];
    const pointsPage = h('div', { class: 'subpage', hidden: true },
      h('h2', null, 'Buy forces with points'),
      h('p', { class: 'sub' }, 'Both players get ship points to spend. Every ship, pilot and gunner costs its victory point value. Both players buy their force at the same time. Then you see each other\'s forces and set up. The ready-made dogfights cost about 30 to 45 points per side.'),
      h('div', { class: 'row' },
        h('label', null, 'Rebel ship points ', limitInputs[0]),
        h('label', null, 'Empire ship points ', limitInputs[1]),
      ),
      h('p', { class: 'sub' }, 'The two sides don\'t need the same points. The side with fewer gets one bonus victory point for every two points the other side has more.'),
      bonusLine,
      h('h2', null, 'Who chooses the forces'),
      h('div', { class: 'cards' }, ...whoButtons),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => { kind = 'points'; page = 'main'; refresh(); } }, 'Use these points'),
        h('button', { onclick: () => { page = 'main'; refresh(); } }, 'Back'),
      ),
    );
    // scenarios of the player's own, from the scenarios folder: they join the page when the folder has been read
    const customColumn = h('div', { class: 'column' });
    const customKind = h('div', { class: 'kind', hidden: true }, h('h3', null, 'Your scenarios'), h('p', { class: 'sub' }, 'Scenario files in the scenarios folder.'), customColumn);
    const customButtons: { id: string; el: HTMLElement }[] = [];
    void loadCustomScenarios().then((found) => {
      for (const { id, def } of found) {
        const el = h('button', { class: 'card', onclick: () => { mix = id; kind = 'preset'; page = 'main'; refresh(); } }, h('b', null, def.name), ...scenarioLines(def).map((line) => h('span', null, line)));
        customButtons.push({ id, el });
        customColumn.append(el);
      }
      customKind.hidden = found.length === 0;
      refresh();
    });
    const presetsPage = h('div', { class: 'subpage', hidden: true },
      h('h2', null, 'Premade scenarios'),
      h('p', { class: 'sub' }, 'Click a scenario to use it.'),
      h('div', { class: 'kinds' },
        ...kinds.map((k) => h('div', { class: 'kind' },
          h('h3', null, k.title),
          h('p', { class: 'sub' }, k.rules),
          h('div', { class: 'column' }, ...k.ids.map((id) => mixButtons[mixes.findIndex((m) => m.id === id)]!)),
        )),
        customKind,
      ),
      h('h3', { class: 'other' }, 'Other'),
      h('div', { class: 'column other' }, mixButtons[mixes.findIndex((m) => m.id === 'showcase')]!),
      h('div', { class: 'row' }, h('button', { onclick: () => { page = 'main'; refresh(); } }, 'Back')),
    );

    const credits = creditsPage(() => { page = 'main'; refresh(); });
    // a bar that stays at the top of the window while the page is scrolled: starting the game, and on the other pages the way back
    const barTitle = h('b', { class: 'bartitle' });
    const startTop = h('button', { class: 'primary', onclick: () => startButton.click() }, 'Start game');
    const usePointsTop = h('button', { class: 'primary', onclick: () => { kind = 'points'; page = 'main'; refresh(); } }, 'Use these points');
    const backTop = h('button', { onclick: () => { page = 'main'; refresh(); } }, 'Back');
    const menuBar = h('div', { class: 'menubar' }, barTitle, h('span', { class: 'grow' }), usePointsTop, backTop, startTop);

    const refresh = (): void => {
      remember();
      applyColours(this.scheme, side);
      mixes.forEach((m, i) => mixButtons[i]!.classList.toggle('on', kind === 'preset' && m.id === mix));
      customButtons.forEach((b) => b.el.classList.toggle('on', kind === 'preset' && b.id === mix));
      sideButtons.forEach((b, i) => {
        b.classList.toggle('on', i === side);
        (b.firstElementChild as HTMLElement).style.color = SIDE_COLORS[i as PlayerId];
      });
      schemeButtons.forEach((b, i) => b.classList.toggle('on', SCHEMES[i]!.id === this.scheme));
      reductionButtons.forEach((b, i) => b.classList.toggle('on', reductions[i]!.level === reduction));
      damageButtons.forEach((b, i) => b.classList.toggle('on', (i === 1) === damageOn()));
      specialButtons.forEach((b, i) => b.classList.toggle('on', (i === 1) === specialOn()));
      initiativeButtons.forEach((b, i) => b.classList.toggle('on', (i === 1) === advanced));
      arcButtons.forEach((b, i) => b.classList.toggle('on', (i === 1) === arcs));
      mapButtons.forEach((b, i) => { b.classList.toggle('on', (i === 0) === (mapNow() === 'static')); (b as HTMLButtonElement).disabled = mapForced(); });
      fieldButtons.forEach((b, i) => b.classList.toggle('on', FIELDS[i] === field));
      motionButtons.forEach((b, i) => b.classList.toggle('on', (i === 0) === (motion === 'drift')));
      chaosButtons.forEach((b, i) => b.classList.toggle('on', [2, 4, 6][i] === chaos));
      if (noField()) field = 'off';
      else if (scenarioField() && field === 'off') field = scenarioField()!;
      fieldButtons.forEach((b, i) => { (b as HTMLButtonElement).disabled = noField() || (!!scenarioField() && FIELDS[i] === 'off'); });
      fieldButtons.forEach((b, i) => b.classList.toggle('on', FIELDS[i] === field));
      asteroidNote.hidden = !noField() && !scenarioField() && !(kind === 'points' && field !== 'off');
      asteroidNote.textContent = isGround()
        ? 'Not in a Ground Attack: turret guns and asteroids can\'t be combined.'
        : hasCapital()
          ? 'Not with capital ships: they are too big for an asteroid field and don\'t fire at asteroids.'
          : kind === 'points' ? 'With an asteroid field, capital ships can\'t be bought.' : 'This scenario needs an asteroid field.';
      fieldMore.hidden = field === 'off';
      turretBox.hidden = !isGround();
      turretHead.hidden = !isGround();
      turretNote.hidden = !isGround();
      turretValue.textContent = skillText(turretSkill);
      sdBox.hidden = !hasDestroyer();
      sdHead.hidden = !hasDestroyer();
      sdNote.hidden = !hasDestroyer();
      sdValue.textContent = destroyerSkill ? skillText(destroyerSkill) : `${skillText(scenarioSdSkill())} (as the scenario says)`;
      (chaosButtons[0]!.parentElement as HTMLElement).hidden = motion !== 'events';
      speedButtons.forEach((b, i) => b.classList.toggle('on', SPEEDS[i]!.id === this.speed));
      modeButtons.forEach((b, i) => b.classList.toggle('on', modes[i]!.id === mode));
      presetsButton.classList.toggle('on', kind === 'preset');
      pointsButton.classList.toggle('on', kind === 'points');
      whoButtons.forEach((b, i) => b.classList.toggle('on', (i === 1) === hostPicks));
      scenarioLine.textContent = kind === 'preset' ? `Chosen: ${mixes.find((m) => m.id === mix)?.title ?? scenarioDef(mix)?.name ?? mix}` : `Chosen: forces bought with points (Rebels ${limits[0]}, Empire ${limits[1]}). ${hostPicks ? 'The host chooses both forces.' : 'Each player buys their own force.'}`;
      bonusLine.textContent = bonusText(limits);
      saved.box.hidden = mode === 'join';
      saved.update();
      netRow.hidden = mode === 'solo';
      invite.hidden = mode !== 'host';
      setup.hidden = mode === 'join';
      mainPage.hidden = page !== 'main';
      presetsPage.hidden = page !== 'presets';
      pointsPage.hidden = page !== 'points';
      credits.hidden = page !== 'credits';
      startButton.textContent = mode === 'solo' ? 'Start game' : mode === 'host' ? 'Host game' : 'Join game';
      startTop.textContent = startButton.textContent;
      startTop.hidden = page !== 'main';
      usePointsTop.hidden = page !== 'points';
      backTop.hidden = page === 'main';
      barTitle.textContent = page === 'presets' ? 'Premade scenarios' : page === 'points' ? 'Buy forces with points' : page === 'credits' ? 'Credits' : 'Warriors of the Stars';
      // a new page starts at its top
      if (page !== shownPage) window.scrollTo(0, 0);
      shownPage = page;
    };
    let shownPage: 'main' | 'presets' | 'points' | 'credits' = page;
    // carrying on with a saved game: here, or as the host of a network game
    const openSave = (text: string): void => {
      const save = parseSave(text);
      if (mode === 'host') this.connectNetwork('host', address.value, { mix: save.meta.mix, seed: save.meta.seed, skillReduction: save.meta.skillReduction ?? 0, hostSide: side }, labels, text);
      else this.loadSave(save);
    };
    const saved = this.savedGames(() => mode, openSave);
    const netRow = h('div', { class: 'row netrow' }, h('label', null, 'Address of the host ', address));
    // the links to give to the other player (when this page is served by the host program)
    const invite = this.inviteBox();
    invite.hidden = true;
    const setup = h('div', { class: 'setup' });
    const sdHead = h('h2', { hidden: true }, 'Flagship gunnery');
    const sdNote = h('p', { class: 'sub', hidden: true }, 'How well the flagships (Star Destroyers and Mon Calamari cruisers) shoot. Change it one step at a time to balance the scenario.');
    const turretHead = h('h2', { hidden: true }, 'Turret gun skill');
    const turretNote = h('p', { class: 'sub', hidden: true }, 'How well the turret guns shoot (5D by default). Change it one step at a time (5D, 5D+1, 5D+2, 6D...) to balance the scenario. Missiles, torpedoes and bombs are on by default here.');
    const mainPage = h('div', { class: 'mainpage' },
      saved.box,
      h('h2', null, 'Opponent'),
      h('div', { class: 'cards' }, ...modeButtons),
      netRow,
      invite,
      setup,
      h('h2', null, 'Colours'),
      h('div', { class: 'cards' }, ...schemeButtons),
      h('p', { class: 'sub' }, '“You” is whoever plays at this computer, whichever side that is. The other two settings give the Rebels and the Empire fixed colours.'),
      h('h2', null, 'Playback speed'),
      h('div', { class: 'cards' }, ...speedButtons),
      h('p', { class: 'sub' }, 'How fast moves and shots are played back. Click the board to skip the rest of a move.'),
      h('h2', null, 'Sound'),
      soundPanel(),
      h('div', { class: 'row' },
        h('label', { class: 'seedlabel' }, 'Random seed ', seed),
        h('label', null, h('input', { type: 'checkbox', checked: labels, onchange: (e: Event) => { labels = (e.target as HTMLInputElement).checked; remember(); } }), ' Show hex numbers'),
      ),
      startButton,
      h('div', { class: 'row creditsrow' }, h('button', { class: 'linkbtn', onclick: () => { page = 'credits'; refresh(); } }, 'Credits')),
    );
    this.root.append(
      h('div', { class: 'menu' },
        menuBar,
        h('h1', null, 'WARRIORS OF THE STARS'),
        h('p', { class: 'sub' }, 'A starfighter combat game. Private digital edition.'),
        mainPage,
        presetsPage,
        pointsPage,
        credits,
      ),
    );
    // the scenario, side and skill choices belong to the one who sets the game up: they are hidden for a player who only joins
    setup.append(
      h('h2', null, 'Scenario'),
      h('div', { class: 'cards' }, presetsButton, pointsButton),
      scenarioLine,
      h('h2', null, 'Your side'),
      h('div', { class: 'cards' }, ...sideButtons),
      h('h2', null, 'R2, auxiliary power and damage control'),
      h('div', { class: 'cards' }, ...damageButtons),
      h('p', { class: 'sub' }, 'Repairs during the game, and free actions from an R2 unit or auxiliary power. On by default in points games.'),
      h('h2', null, 'Missiles, torpedoes and bombs'),
      h('div', { class: 'cards' }, ...specialButtons),
      h('p', { class: 'sub' }, 'X-wings, Y-wings, B-wings and the Falcon carry a limited number of torpedoes or missiles. The TIE bomber carries bombs for ground targets and stationary ships. On by default in points games and in the Ground Attack.'),
      h('h2', null, 'Initiative'),
      h('div', { class: 'cards' }, ...initiativeButtons),
      h('p', { class: 'sub' }, 'The order of movement is settled ship by ship before planning, instead of the players taking turns. It is harder to follow, so against the computer we recommend Basic. The computer can play either way.'),
      h('h2', null, 'Map'),
      h('div', { class: 'cards' }, ...mapButtons),
      h('p', { class: 'sub' }, 'Each scenario has a map it is normally played on. Asteroid fields and the Ground Attack always use the static map.'),
      h('h2', null, 'Arcs'),
      h('div', { class: 'cards' }, ...arcButtons),
      h('p', { class: 'sub' }, 'On by default. It affects the big ships (the shuttle, the freighter, the Falcon, Slave I, the pinnace): a shot from the side uses the Port/Starboard line of the Fire Table, and only shields angled that way count against it. Small ships aren’t affected.'),
      turretHead,
      turretBox,
      turretNote,
      sdHead,
      sdBox,
      sdNote,
      h('h2', null, 'Asteroid field'),
      h('div', { class: 'cards' }, ...fieldButtons),
      asteroidNote,
      h('p', { class: 'sub' }, 'The game makes and moves the field; nobody decides where the asteroids go. A ship that meets an asteroid makes a piloting roll against 3 for every hex of the asteroid\'s size, plus the actions it is flying. Ships can shoot asteroids. The map is static: a ship that leaves it has escaped. What is lost from the field comes back at the edge.'),
      fieldMore,
      h('h2', null, 'Randomness of the skills'),
      h('div', { class: 'cards' }, ...reductionButtons),
      h('p', { class: 'sub' }, 'Pilot and gunner skills are rolled once, before a scenario starts. A very good or bad roll then shapes the whole game. This setting narrows that roll and makes the game generally more fair and balanced. The dice during play stay as they are.'),
    );
    startButton.addEventListener('click', () => {
      const points: [number, number] | undefined = kind === 'points' ? [limits[0], limits[1]] : undefined;
      const chosen: DogfightMix = kind === 'points' ? 'points' : mix;
      const picks = kind === 'points' && hostPicks;
      if (mode === 'solo') this.start(chosen, side, Number(seed.value) || 1, labels, reduction, points, picks ? side : undefined, damageOn(), specialOn(), asteroidOptions(), isGround() ? turretSkill : undefined, advanced, arcs, mapChoice && !mapForced() ? mapChoice : undefined, hasDestroyer() && destroyerSkill ? destroyerSkill : undefined);
      else this.connectNetwork(mode, address.value, { mix: chosen, points, hostChooses: picks, seed: Number(seed.value) || 1, skillReduction: reduction, hostSide: side, damageRules: damageOn(), specialWeapons: specialOn(), ...(advanced ? { advancedInitiative: true } : {}), ...(arcs ? { advancedArcs: true } : {}), ...(mapChoice && !mapForced() ? { mapMode: mapChoice === 'static' ? 'static' : 'open' } : {}), ...(asteroidOptions() ? { asteroids: asteroidOptions() } : {}) }, labels);
    });
    refresh();
  }

  /**
   * The menu's way back into a game: the one the browser kept, the saved games in the saves folder (when the page can reach it), or a save file.
   * `open` carries on with a save, as the mode of the menu says: solo, or hosting it for another player.
   */
  private savedGames(mode: () => 'solo' | 'host' | 'join', open: (text: string) => void): { box: HTMLElement; update: () => void } {
    const box = h('div', { class: 'saved' });
    const error = h('p', { class: 'error', hidden: true });
    const fail = (e: unknown): void => {
      error.hidden = false;
      error.textContent = e instanceof SaveError ? e.message : 'The file couldn’t be read.';
    };
    const picker = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      if (!file) return;
      file.text().then((text) => open(text)).catch(fail);
      picker.value = '';
    });
    let listed: SaveListing[] = [];
    const render = (): void => {
      clear(box);
      const hosting = mode() === 'host';
      const auto = hosting ? null : readAutosave();
      if (auto) {
        box.append(h('div', { class: 'resume' },
          h('div', null, h('b', null, 'Resume your last game'), h('span', { class: 'sub' }, `${describeSave(auto)} · saved ${new Date(auto.savedAt).toLocaleString()}`)),
          h('button', { class: 'primary', onclick: () => this.loadSave(auto) }, 'Resume'),
        ));
      }
      if (listed.length > 0) {
        box.append(
          h('h3', { class: 'savedhead' }, hosting ? 'Host a saved game' : 'Saved games'),
          h('div', { class: 'savedlist' }, ...listed.map((f) => h('div', { class: 'savedrow' },
            h('div', null, h('b', null, f.description ?? f.name), h('span', { class: 'sub' }, `${f.name} · ${new Date(f.savedAt ?? f.modified).toLocaleString()}`)),
            h('button', { onclick: () => { error.hidden = true; readFile('saves', f.name).then((text) => open(text)).catch(fail); } }, hosting ? 'Host' : 'Load'),
          ))),
        );
      }
      box.append(
        h('div', { class: 'row' }, h('button', { onclick: () => picker.click() }, hosting ? 'Host a game from a file…' : 'Load a game from a file…'), picker),
        error,
      );
    };
    void listFiles().then((files) => {
      listed = (files?.saves ?? []).filter((f) => !f.error).sort((a, b) => b.modified - a.modified).slice(0, 30);
      render();
    });
    render();
    return { box, update: render };
  }

  private start(mix: DogfightMix, side: PlayerId, seed: number, labels: boolean, skillReduction: SkillReduction = 0, points?: [number, number], forceChooser?: PlayerId, damageRules = false, specialWeapons = false, asteroids?: AsteroidOptions, turretSkill?: { dice: number; pips: number }, advancedInitiative = false, advancedArcs = false, mapChoice?: 'static' | 'adjustable', destroyerSkill?: { dice: number; pips: number }): void {
    const scenario = scenarioOptions(mix, seed, points, forceChooser);
    if (destroyerSkill) scenario.destroyerSkill = { ...destroyerSkill };
    if (turretSkill && scenario.groundAttack) scenario.groundAttack = { ...scenario.groundAttack, turretSkill };
    // a human defender places the ground target and the base by hand (Rules: Ground attack); the computer's are laid out by the game
    if (scenario.groundAttack && scenario.groundAttack.attacker !== side) scenario.groundAttack = { ...scenario.groundAttack, manualBase: true };
    this.game = createGame({ ...scenario, skillReduction, ...(damageRules ? { damageRules: true } : {}), ...(specialWeapons ? { specialWeapons: true } : {}), ...(advancedInitiative ? { advancedInitiative: true } : {}), ...(advancedArcs ? { advancedArcs: true } : {}), ...(mapChoice ? { map: { ...STANDARD_MAP, mode: mapChoice === 'static' ? 'static' as const : 'open' as const } } : {}), ...(asteroids ? { asteroids } : {}) });
    this.meta = { mix, ...(points ? { points } : {}), seed, skillReduction };
    this.human = side;
    this.aiRng = { rngState: (seed * 7919 + 13) >>> 0 };
    this.history = [];
    this.resetUi();
    this.enterGame(labels);
  }

  /** Brings a saved game back to the table, with the plans and placements that were being drawn up. */
  private loadSave(save: SaveFile): void {
    this.game = save.game;
    this.meta = { mix: save.meta.mix, ...(save.meta.points ? { points: save.meta.points } : {}), seed: save.meta.seed, skillReduction: save.meta.skillReduction ?? 0 };
    this.human = save.meta.human;
    this.aiRng = { rngState: save.aiRngState };
    this.history = [...save.commands];
    this.resetUi();
    // what the game already holds must not pop up again as news
    for (const ship of this.game.ships) {
      this.seenWounds.set(ship.id, ship.wounds.length);
      if (ship.status === 'destroyed') this.seenDestroyed.add(ship.id);
      if (ship.pos) this.lastPos.set(ship.id, ship.pos);
    }
    for (const [id, placement] of save.draft.placements) this.draft.set(id, placement);
    const drafts = save.draft.forces;
    this.forceDrafts = Array.isArray(drafts) && drafts.length === 2 && Array.isArray(drafts[0]) && Array.isArray(drafts[1]) ? [drafts[0], drafts[1]] : [[], []];
    if (this.game.phase === 'planning' && !this.game.planSubmitted[this.human]) {
      this.plans = save.draft.plans;
      this.crewPlans = save.draft.crewPlans ?? {};
      this.submitted = new Set(save.draft.submitted);
      this.planShip = save.draft.planShip;
    }
    this.enterGame(this.labels);
  }

  /** The state of the screen that belongs to one game and must not leak into the next. */
  private resetUi(): void {
    this.aiPlayer = this.human === 0 ? 1 : 0;
    applyColours(this.scheme, this.human);
    this.ai = tacticalAi(stateRng(this.aiRng));
    this.planManual = null;
    this.arrivalEdge = null;
    this.submitted = new Set();
    this.confirming = null;
    this.commitAsk = false;
    this.selected = null;
    this.hovered = null;
    this.seenWounds.clear();
    this.seenDestroyed.clear();
    this.seenReduced.clear();
    this.turretDraft.clear();
    this.turretDraftTurn = -1;
    this.turretSel = null;
    for (const e of this.game.emplacements ?? []) {
      if (e.status === 'destroyed') this.seenDestroyed.add(e.id);
      if (e.reduced) this.seenReduced.add(e.id);
    }
    if (this.game.groundTarget?.status === 'destroyed') this.seenDestroyed.add(GROUND_TARGET_ID);
    this.seenGround = this.game.groundTarget?.damage ?? 0;
    this.lastPos.clear();
    this.placingId = null;
    this.turning = null;
    this.draft.clear();
    this.baseDraft.clear();
    this.baseFitted = false;
    this.edgeDraft = null;
    this.forceDrafts = [[], []];
    this.forceSide = 0;
    // a game that is still at the buying stage shows both forces once they are in; one that is further on does not
    this.forcesSeen = this.game.phase !== 'forces';
    this.plans = {};
    this.crewPlans = {};
    this.planCrew = 'pilot';
    this.planShip = null;
    this.moveSteps = [];
    this.moveGroups = [];
    this.aim = null;
    this.message = '';
  }

  /** Switches between the flat board and the 3D view of it. The 3D part of the program is only fetched when it is first wanted. */
  private setView3d(on: boolean): void {
    this.view3d = on;
    saveFlag('view3d', on);
    const board = this.board;
    if (!on) {
      if (board.inTable) {
        board.setTable(null);
        this.fitAll();
      }
      return;
    }
    void import('../ui3d/board3d')
      .then(({ Board3D }) => {
        // the game may have been left, or the switch flipped back, while the 3D view was on its way
        if (this.board !== board || !this.view3d || board.inTable) return;
        board.setTable(new Board3D(this.boardHost, true).table());
        this.fitAll();
      })
      .catch((error) => {
        console.error('3D view failed', error);
        this.view3d = false;
        this.status.textContent = 'The 3D view could not be started in this browser.';
      });
  }

  /** The keys that do what the buttons around a ship do: only what the board offers at the moment is taken. */
  private onKey(e: KeyboardEvent): void {
    if (!this.layoutEl?.isConnected || this.overlayEl || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    const action = KEY_ACTIONS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!action || this.animating || !this.board.offers(action)) return;
    e.preventDefault();
    this.onRingClick(action);
  }

  private enterGame(labels: boolean): void {
    this.labels = labels;
    // a game that is loaded or joined doesn't play the sounds of what happened before
    this.soundLog = this.game.log.length;
    this.waitingSince = null;
    this.overHeard = this.game.phase === 'over';
    this.board?.setTable(null);
    clear(this.root);
    this.overlayEl = null;
    this.boardHost = h('div', { class: 'boardhost' });
    this.status = h('div', { class: 'statusbar' });
    this.sidebar = h('aside', { class: 'sidebar' });
    setSpeed(this.speed);
    this.skipButton = h('button', { class: 'skip', hidden: true, onclick: () => { clock.skip = true; } }, 'Skip ⏭');
    this.foldLeftBtn = h('button', { class: 'foldbtn', onclick: () => this.setLeftFolded(!this.leftFolded) });
    this.widerBtn = h('button', { class: 'foldbtn', onclick: () => this.setSideMode(this.sideMode - 1) });
    this.narrowerBtn = h('button', { class: 'foldbtn', onclick: () => this.setSideMode(this.sideMode + 1) });
    this.smallFighters = toggleButton('Small fighters', !loadFlag('fullfighters'), (on) => { saveFlag('fullfighters', !on); this.board.setShipScale(on ? 0.5 : 1); }, 'In the 3D view of a game with capital ships: show the fighters at half their size, so that the capital ships look larger beside them');
    this.smallFighters.style.display = 'none';
    const tools = h('div', { class: 'tools' },
      this.foldLeftBtn,
      h('button', { onclick: () => this.fitAll() }, 'Fit all'),
      h('button', { onclick: () => this.fitMine() }, 'My ships'),
      toggleButton('3D', this.view3d, (on) => this.setView3d(on), 'Show the board in 3D: the ships fly over it as models. Drag to move the map, drag with the right mouse button to turn and tilt the view, and use the wheel to zoom. Everything else works as on the flat board.'),
      this.smallFighters,
      h('span', { class: 'keyshint', title: KEYS_HELP }, 'Keys'),
      toggleButton('Split stacks', this.splitStacks, (on) => { this.splitStacks = on; saveFlag('split', on); this.board.setSplit(on); },
        'Draw ships that share a hex separately as smaller icons, each with its own facing. Works best zoomed in.'),
      this.game.asteroids
        ? toggleButton('Shoot asteroids', this.shootRocks, (on) => { this.shootRocks = on; saveFlag('noshootrocks', !on); this.aim = null; this.skippedFire = ''; this.render(); }, 'Offer asteroids in reach as targets whenever a ship may fire (snap fire or at the end of its move). Switched off, your ships only consider enemy ships as possible targets.')
        : null,
      this.game.asteroids
        ? toggleButton('Asteroid info', !loadFlag('hidepaths'), (on) => { saveFlag('hidepaths', !on); this.board.setRockPaths(on); }, 'Mark the middle of every asteroid with its size, and draw a faint line from each drifting asteroid to where it will move to next turn')
        : null,
      this.game.emplacements?.length
        ? toggleButton('Turret arcs', this.showTurretArcs, (on) => { this.showTurretArcs = on; saveFlag('noturretarcs', !on); this.render(); }, 'Shade the forward arcs of the enemy turret guns: the darker the hex, the more guns can fire at a ship there')
        : null,
      this.game.destroyers?.length
        ? toggleButton('Capital ship range', this.showCapitalRange, (on) => { this.showCapitalRange = on; saveFlag('nocapitalrange', !on); this.render(); }, 'Shade the range of fire of the capital ships, yours and the enemy’s, each in its side’s colour: every hex within ten hexes of any of their hexes, where they fire at a fighter, and more faintly out to the range at which they fire at capital ships (20 hexes, 15 for a frigate)')
        : null,
      toggleButton('Hex numbers', labels, (on) => { this.labels = on; this.board.setLabels(on); this.renderLog(); this.renderSheet(); }, 'Show the number of every hex, and the hex each ship stands in, in the log and the ship window'),
      h('label', null, 'Playback ',
        h('select', { onchange: (e: Event) => { this.speed = (e.target as HTMLSelectElement).value as Speed; saveSpeed(this.speed); setSpeed(this.speed); } },
          ...SPEEDS.map((sp) => h('option', { value: sp.id, selected: sp.id === this.speed }, sp.label))),
      ),
      this.skipButton,
      toggleButton('Sound', !sound.settings.muted, (on) => sound.set({ muted: !on }), 'Switch all sound on or off'),
      h('input', { type: 'range', class: 'volume', min: '0', max: '100', value: String(Math.round(sound.settings.master * 100)), title: 'Volume', oninput: (e: Event) => sound.set({ master: Number((e.target as HTMLInputElement).value) / 100 }) }),
      !this.net || this.isHost ? h('button', { onclick: () => this.saveToFile(), title: 'Save this game to a file, to keep it or to open it on another computer' }, 'Save') : null,
      h('button', { onclick: () => { if (confirm(this.net ? 'Leave this network game? You can come back to your side by joining again.' : 'Leave this game? It is saved automatically. You can resume it from the menu.')) { this.autosave(); this.showMenu(); } } }, 'Menu'),
      h('span', { class: 'foldgroup' }, this.widerBtn, this.narrowerBtn),
    );
    this.logEl = h('div', { class: 'logpanel' });
    this.sheetEl = h('div', { class: 'sheetslot' });
    this.cmdEl = h('div', { class: 'cmdbar', hidden: true });
    this.layoutEl = h('div', { class: 'layout' }, h('aside', { class: 'leftcol' }, this.sheetEl, this.logEl), h('div', { class: 'boardwrap' }, tools, this.cmdEl, this.boardHost, this.status), this.sidebar);
    this.root.append(this.layoutEl);
    this.board = new Board(this.boardHost, {
      onRingClick: (action) => this.onRingClick(action),
      onSubmitClick: (action) => this.onSubmitClick(action),
      onChooseClick: () => this.onChooseClick(),
      onHexClick: (hex) => this.onHexClick(hex),
      onRockClick: (id) => this.aimRock(id),
      onTurretClick: (id) => this.onTurretClick(id),
      onDestroyerClick: (id) => this.onDestroyerClick(id),
      onSpeedClick: (direction) => this.sdChangeSpeed(direction === 'up' ? 1 : -1),
      onShipClick: (id) => this.onShipClick(id),
      onHover: (hex, shipId) => this.onHover(hex, shipId),
    });
    this.planEl = h('div', { class: 'planbox', hidden: true });
    this.boardHost.append(this.planEl);
    this.enablePlanDrag();
    this.board.setLabels(labels);
    this.board.setSplit(this.splitStacks);
    this.board.setRockPaths(!loadFlag('hidepaths'));
    if (this.view3d) this.setView3d(true);
    this.render();
    // fit around the human's setup area once the board has a size
    requestAnimationFrame(() => {
      if (this.game.phase === 'setup') this.board.fit(this.game.zones[this.human], 1);
      else this.fitAll();
      void this.pump();
    });
  }

  // ------------------------------------------------------------------ network

  private netNotice = '';
  /** The page can write the automatic save to the saves folder; false once that has failed (it isn't the host's own computer). */
  private folderAutosave = true;

  private connectNetwork(mode: 'host' | 'join', address: string, create: { mix: DogfightMix; points?: [number, number]; hostChooses?: boolean; seed: number; skillReduction: SkillReduction; hostSide: PlayerId; damageRules?: boolean; specialWeapons?: boolean; asteroids?: AsteroidOptions; advancedInitiative?: boolean; advancedArcs?: boolean; mapMode?: 'static' | 'open' }, labels: boolean, loadText?: string): void {
    if (!address.trim()) {
      this.netNotice = 'Enter the address of the host first.';
      this.showMenu();
      return;
    }
    this.leaveNetwork();
    this.labels = labels;
    this.netIntent = { mode, create, ...(loadText ? { loadText } : {}) };
    clear(this.root);
    this.netStatus = h('p', { class: 'sub' }, 'Connecting…');
    this.root.append(h('div', { class: 'menu' },
      h('h1', null, 'WARRIORS OF THE STARS'),
      this.netStatus,
      h('button', { onclick: () => this.showMenu() }, 'Cancel'),
    ));
    this.net = new NetClient(address, {
      onMessage: (msg) => this.onNetMessage(msg),
      onLink: (state, detail) => this.onLink(state, detail),
    });
    this.net.connect();
  }

  /** Lets go of the host: the next game starts clean. */
  private leaveNetwork(): void {
    this.net?.close();
    this.net = null;
    this.netIntent = null;
    this.inNetGame = false;
    this.updates = [];
    this.awaiting = false;
    this.link = 'closed';
  }

  private onLink(state: LinkState, detail?: string): void {
    this.link = state;
    if (this.inNetGame) {
      this.renderSidebar();
      return;
    }
    if (!this.netStatus) return;
    if (state === 'connecting') this.netStatus.textContent = 'Connecting…';
    else if (state === 'reconnecting') this.netStatus.textContent = 'Can’t reach the host yet. Is it running (npm run host), and is the address right? Trying again…';
    else if (detail) this.netStatus.textContent = detail;
  }

  private onNetMessage(msg: ServerMessage): void {
    const lobbyText = (text: string): void => {
      if (this.netStatus && !this.inNetGame) this.netStatus.textContent = text;
    };
    switch (msg.type) {
      case 'welcome':
        if (msg.seat !== null && msg.view) {
          this.enterRemote(msg.seat, msg.view, msg.seats, msg.host);
        } else if (this.inNetGame && !msg.game) {
          // the host came back with no game (it was restarted without a save): never start a new one behind the player's back
          this.netNotice = 'The host was restarted and this game is gone. Host or join a new game from here.';
          this.showMenu();
        } else if (this.netIntent?.mode === 'host') {
          if (this.netIntent.loadText) {
            // the saved game goes to the host first; its answer comes back here as another welcome, and then the side is claimed
            const text = this.netIntent.loadText;
            this.netIntent.loadText = undefined;
            lobbyText('Loading the saved game…');
            this.net?.send({ type: 'load', text });
          } else {
            lobbyText('Setting up the game…');
            this.net?.send({ type: 'create', ...this.netIntent.create });
          }
        } else {
          lobbyText(msg.game ? 'Connected. Waiting for the host to continue the saved game…' : 'Connected. Waiting for the host to set up the game…');
        }
        return;
      case 'started':
        this.enterRemote(msg.seat, msg.view, msg.seats, msg.host);
        return;
      case 'update':
        this.updates.push(msg);
        void this.processUpdates();
        return;
      case 'reject':
        this.awaiting = false;
        this.commitAfterTurrets = false;
        this.message = msg.error;
        if (this.inNetGame) this.render();
        return;
      case 'presence':
        this.seats = msg.seats;
        if (this.inNetGame) this.renderSidebar();
        return;
      case 'saveFile':
        this.storeSave(msg.name, msg.text);
        return;
      case 'error':
        if (msg.fatal) {
          this.netNotice = msg.message;
          this.showMenu();
        } else if (this.inNetGame) {
          this.message = msg.message;
          this.render();
        } else {
          lobbyText(msg.message);
        }
        return;
    }
  }

  /** Sits down at a game on the host: the board shows what this player may see of it. */
  private enterRemote(seat: PlayerId, view: GameState, seats: [SeatInfo, SeatInfo], host: boolean): void {
    this.seats = seats;
    if (this.inNetGame) {
      // back after a dropped connection: the host's picture replaces ours
      this.updates = [];
      this.game = view;
      this.awaiting = false;
      this.commitAfterTurrets = false;
      this.render();
      return;
    }
    this.inNetGame = true;
    this.isHost = host;
    this.game = view;
    this.human = seat;
    this.aiRng = { rngState: 1 };
    this.history = [];
    this.resetUi();
    for (const ship of this.game.ships) {
      this.seenWounds.set(ship.id, ship.wounds.length);
      if (ship.status === 'destroyed') this.seenDestroyed.add(ship.id);
      if (ship.pos) this.lastPos.set(ship.id, ship.pos);
    }
    this.enterGame(this.labels);
  }

  /** New pictures of the game from the host, one after the other, each played back before the next. */
  private async processUpdates(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      while (this.updates.length > 0 && this.inNetGame) {
        const update = this.updates.shift()!;
        const before = this.game;
        const cmd = update.cmd;
        this.game = update.view;
        this.seats = update.seats;
        this.awaiting = false;
        if (cmd.player === this.human) {
          this.message = '';
          this.moveSteps = [];
          this.moveGroups = [];
          this.aim = null;
        }
        // the asteroids move when the second side has planned: that command carries their movement, as it does in a game against the computer
        const rocksMove = cmd.type === 'plan' && !!before.asteroids && this.game.log.slice(before.log.length).some((e) => e.rocks);
        const moving = cmd.type === 'move' || (cmd.type === 'fire' && cmd.shots.length > 0) || rocksMove;
        if (moving && clock.factor !== 0) await this.play(before, cmd, this.game.log.slice(before.log.length));
        this.render();
        const ship = 'shipId' in cmd ? shipById(this.game, cmd.shipId) : undefined;
        if (ship?.pos) this.board.reveal(ship.pos, 90);
        // the turret orders were taken: now the plans that go with them
        if (cmd.type === 'turrets' && cmd.player === this.human && this.commitAfterTurrets) {
          this.commitAfterTurrets = false;
          this.commitPlans(true);
        }
      }
    } finally {
      this.applying = false;
    }
  }

  private sendRemote(cmd: Command): boolean {
    if (this.awaiting) return false;
    if (!this.net?.send({ type: 'command', id: ++this.cmdId, cmd })) {
      this.message = 'Not connected to the host. The page keeps trying to reconnect.';
      this.render();
      return false;
    }
    this.awaiting = true;
    this.message = '';
    return true;
  }

  private download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = h('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this.status.textContent = `Saved to your downloads as ${name}`;
  }

  /** What the other side is called in the messages: the computer, or the other player. */
  private opponent(): string {
    return this.net ? 'the other player' : 'the computer';
  }

  /** The links the host server gave last time (see `inviteBox`). */
  private hostLinks: HostLinks | null = null;

  /** For the host while nobody has joined yet: the link to send to the other player (over the internet when the host was started with a tunnel), with a button to copy it. */
  private inviteBox(): HTMLElement {
    const box = h('div', { class: 'invite' });
    const fill = (links: HostLinks | null): void => {
      clear(box);
      if (!links) return;
      const entries: { label: string; url: string }[] = [];
      if (links.internet) entries.push({ label: 'Over the internet', url: `${links.internet}/?join` });
      for (const lan of links.lan) entries.push({ label: 'Same network', url: `${lan}/?join` });
      for (const { label, url } of entries) {
        const field = h('input', { type: 'text', readonly: true, value: url, class: 'invitelink' }) as HTMLInputElement;
        field.addEventListener('focus', () => field.select());
        const copy = h('button', { onclick: () => { field.select(); void navigator.clipboard?.writeText(url).then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Press Ctrl+C'; }); } }, 'Copy');
        box.append(h('div', { class: 'inviterow' }, h('span', null, label), field, copy));
      }
      if (links.internetStarting) box.append(h('p', { class: 'sub' }, 'Opening the tunnel to the internet… the link appears here in a few seconds.'));
      else if (!links.internet) box.append(h('p', { class: 'sub' }, links.internetProblem ?? 'To invite a player anywhere: stop the host and start it with start-internet.bat (npm run host:internet).'));
      else box.append(h('p', { class: 'sub' }, 'Send the link by mail or chat. It works for as long as this host runs.'));
    };
    fill(this.hostLinks);
    // a tunnel takes a few seconds to come up: ask again until it has
    const ask = (): void => {
      void fetchHostLinks().then((links) => {
        this.hostLinks = links;
        fill(links);
        if (links?.internetStarting && box.isConnected) setTimeout(ask, 1500);
      });
    };
    ask();
    return box;
  }

  /** Who is connected, shown on top of the sidebar of a network game. */
  private netLine(): HTMLElement | null {
    if (!this.net) return null;
    if (this.link !== 'open') return h('div', { class: 'netstate bad' }, 'The connection to the host is lost. Trying to reconnect…');
    const other = this.seats[this.human === 0 ? 1 : 0];
    if (!other.taken) return h('div', { class: 'netstate warn' }, 'Waiting for the other player to join…', this.isHost ? this.inviteBox() : null);
    if (!other.connected) return h('div', { class: 'netstate warn' }, 'The other player has lost the connection. The game waits for them.');
    return h('div', { class: 'netstate ok' }, '● Both players are connected');
  }

  // ------------------------------------------------------------------ flow

  /** Gives a command to the game, and remembers it so the game can be saved and replayed. */
  private apply(cmd: Command): CommandResult {
    const result = applyCommand(this.game, cmd);
    if (result.ok) this.history.push(cmd);
    return result;
  }

  private saveFile(): SaveFile {
    return makeSave({
      meta: { ...this.meta, human: this.human },
      game: this.game,
      aiRngState: this.aiRng.rngState,
      commands: this.history,
      draft: { plans: this.plans, crewPlans: this.crewPlans, submitted: [...this.submitted], planShip: this.planShip, placements: [...this.draft], forces: this.forceDrafts },
    });
  }

  /** The browser keeps the game after every command; a finished game is not kept. */
  private autosave(): void {
    if (!this.game || this.net) return;
    const save = this.game.phase === 'over' ? null : this.saveFile();
    writeAutosave(save);
    // the same game goes to the saves folder too, when the page can reach it (the browser's own copy stays as a back-up)
    if (save && this.folderAutosave) void writeFile('saves', 'autosave-solo.json', serialise(save)).then((kept) => { if (!kept) this.folderAutosave = false; });
  }

  private saveToFile(): void {
    if (this.net) {
      // the host keeps the whole game, secrets included: only the player who created it may have it
      if (!this.net.send({ type: 'saveRequest' })) this.status.textContent = 'Not connected to the host.';
      return;
    }
    const save = this.saveFile();
    this.storeSave(saveFileName(save), serialise(save));
  }

  /** Keeps a save in the saves folder when the page can reach it (on the host's computer), otherwise it is downloaded. */
  private storeSave(name: string, text: string): void {
    void writeFile('saves', name, text).then((kept) => {
      if (kept) this.status.textContent = `Saved in the saves folder as ${name}`;
      else this.download(name, text);
    });
  }

  private async pump(): Promise<void> {
    if (this.net || this.pumping) return;
    this.pumping = true;
    try {
      for (let guard = 0; guard < 2000; guard++) {
        const g = this.game;
        if (g.phase === 'over') break;
        if (!waitingFor(g).includes(this.aiPlayer)) break;
        const cmd = this.ai(g, this.aiPlayer);
        if (!cmd) break;
        const before = this.snapshotFor(cmd);
        const logStart = g.log.length;
        const result = this.apply(cmd);
        if (!result.ok) {
          this.message = `Computer player error: ${result.error}`;
          break;
        }
        const visible = cmd.type === 'move' || cmd.type === 'fire' || cmd.type === 'chooseShip' || cmd.type === 'slot';
        if (before) await this.play(before, cmd, g.log.slice(logStart));
        else if (cmd.type === 'move' || cmd.type === 'fire') {
          const ship = shipById(g, cmd.shipId);
          if (ship?.pos) this.board.reveal(ship.pos);
        }
        this.render();
        if (visible) await sleep((cmd.type === 'chooseShip' || cmd.type === 'slot' ? 250 : 400) * clock.factor);
      }
    } finally {
      this.pumping = false;
      this.render();
      this.autosave();
    }
  }

  private send(cmd: Command): boolean {
    if (this.animating) return false;
    if (this.net) return this.sendRemote(cmd);
    const before = this.snapshotFor(cmd);
    const logStart = this.game.log.length;
    const result = this.apply(cmd);
    if (!result.ok) {
      this.message = result.error;
      sound.play('ui.illegal');
      this.render();
      return false;
    }
    this.message = '';
    this.moveSteps = [];
    this.moveGroups = [];
    this.aim = null;
    const finish = (): void => {
      this.autosave();
      this.render();
      const ship = 'shipId' in cmd ? shipById(this.game, cmd.shipId) : undefined;
      if (ship?.pos) this.board.reveal(ship.pos, 90);
      void this.pump();
    };
    if (before) void this.play(before, cmd, this.game.log.slice(logStart)).then(finish);
    else finish();
    return true;
  }

  /** The board as it stood before a move or a volley, for playing it back; null when there is nothing to show. */
  private snapshotFor(cmd: Command): GameState | null {
    if (clock.factor === 0) return null;
    if (cmd.type === 'move' || (cmd.type === 'fire' && cmd.shots.length > 0)) return structuredClone(this.game);
    // the 3D view shows a capital ship flying its move
    if (cmd.type === 'moveDestroyer' && this.board.inTable) return structuredClone(this.game);
    // the asteroids move once the second side has planned
    if (cmd.type === 'plan' && this.game.asteroids && this.game.planSubmitted[other(cmd.player)]) return structuredClone(this.game);
    return null;
  }

  /** Play a command back on the board. The game is already in its final state; only the board lags behind. */
  private async play(before: GameState, cmd: Command, events: GameEvent[]): Promise<void> {
    this.animating = true;
    clock.skip = false;
    sound.cockpit(null);
    this.sidebar.classList.add('busy');
    this.skipButton.hidden = false;
    try {
      const shown = await playCommand(this.board, before, cmd, events, this.game);
      // damage and explosions shown during the playback are not shown again when the real board is drawn
      for (const [id, indices] of shown.wounds) this.shownWounds.set(id, new Set(indices));
      for (const id of shown.destroyed) this.seenDestroyed.add(id);
    } catch (error) {
      console.error('Playback failed', error); // the game itself is unaffected: carry on with the real state
    } finally {
      this.animating = false;
      clock.skip = false;
      this.sidebar.classList.remove('busy');
      this.skipButton.hidden = true;
    }
  }

  // ------------------------------------------------------------------ board events

  private onHover(hex: Hex | null, shipId?: string | null): void {
    this.status.textContent = hex && this.labels ? `Hex ${hexId(hex)}` : '';
    const g = this.game;
    let id: string | null = null;
    if (hex) {
      if (this.placingNow()) {
        // only the player's own, not yet confirmed placements are visible
        for (const [shipId, d] of this.draft) if (hexEquals(d.pos, hex)) id = shipId;
      } else {
        id = shipId ?? activeShips(g).find((s) => s.pos && hexEquals(s.pos, hex))?.id ?? this.board.emplacementAt(hex) ?? this.board.destroyerAt(hex);
      }
    }
    this.setHovered(id);
  }

  private setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.renderSheet();
  }

  /** The record sheet of the ship under the mouse; without one, of the selected ship. */
  private renderSheet(): void {
    const g = this.game;
    // the ship that is moving or firing stays on the window; hovering another ship shows it until the mouse leaves
    const mover = this.currentHumanShip();
    const pinned = this.pinnedShip();
    const id = this.hovered && this.hovered !== pinned?.id ? this.hovered : pinned?.id ?? this.hovered ?? this.selected;
    const ship = id ? shipById(g, id) : undefined;
    clear(this.sheetEl);
    // a capital ship under the mouse has its window; while its owner moves it or picks its target it stays on the window
    const selectedCapital = this.selected && isDestroyerTarget(this.selected) ? this.selected : undefined;
    const capitalId = this.hovered && isDestroyerTarget(this.hovered) ? this.hovered : !this.hovered ? (this.humanDestroyer() ?? this.humanTargeting())?.id ?? selectedCapital : undefined;
    const capital = capitalId ? destroyerById(g, capitalId) : undefined;
    if (capital) {
      const moving = this.humanDestroyer();
      this.sheetEl.append(capitalSheet(g, capital, this.human, moving?.id === capital.id ? this.sdChosenSpeed(capital) : undefined));
      return;
    }
    // a turret gun or the ground target under the mouse has its own window
    if (this.hovered && isEmplacementTarget(this.hovered)) {
      const turret = g.emplacements?.find((e) => e.id === this.hovered && e.status === 'active');
      if (turret) { this.sheetEl.append(turretSheet(g, turret, this.human)); return; }
      if (g.groundTarget?.id === this.hovered && g.groundTarget.status === 'active') { this.sheetEl.append(groundSheet(g.groundTarget, this.human)); return; }
    }
    if (!ship || ship.status !== 'active') {
      this.sheetEl.append(emptySheet());
      return;
    }
    const drafting = g.phase === 'planning' && !g.planSubmitted[this.human] && ship.owner === this.human;
    const picking = drafting && ship.id === this.planShip && !this.submitted.has(ship.id) && crewOf(ship).length > 1;
    const live = mover?.id === ship.id;
    const snapIds = live && g.active?.stage === 'move' && !this.aim ? this.aimCrews('snap', ship).map((c) => c.id) : [];
    const aiming = live && this.aim ? this.aim : null;
    const pick: CrewPick | undefined = picking
      ? { selected: this.planCrew, onPick: (crew) => this.pickCrew(crew) }
      : aiming
        ? { selected: aiming.active, onPick: (crew) => this.aimPickCrew(crew), done: new Set(aiming.crews.filter((c) => aiming.per[c]!.done)), enabled: (crew) => aiming.crews.includes(crew) }
        : snapIds.length > 0
          ? { selected: '', onPick: (crew) => this.openSnap(crew), enabled: (crew) => snapIds.includes(crew) }
          : live && g.active?.stage === 'move' && !this.aim && [PILOT, ...livingGunners(ship).map(gunnerCrewId)].some((c) => planOf(ship, c).snapFire > 0)
            ? { selected: '', onPick: () => undefined, enabled: () => false, hint: (crew) => (planOf(ship, crew).snapFire > 0 ? this.snapBlock(ship) ?? undefined : undefined) }
            : undefined;
    this.sheetEl.append(shipSheet(g, ship, motionOf(g, ship, drafting ? this.plans[ship.id] ?? emptyPlan() : undefined), pick, this.labels));
  }

  /** What happened to the turret guns and the ground target since the last look: a gun lost, a turret blown up, the ground target hurt. */
  private showNewEmplacementDamage(): void {
    const g = this.game;
    for (const e of g.emplacements ?? []) {
      if (e.status === 'destroyed' && !this.seenDestroyed.has(e.id)) {
        this.seenDestroyed.add(e.id);
        this.board.popup(e.pos, 'DESTROYED', 'kill');
        if (clock.factor > 0) this.board.explode(e.pos, false, 'explode.turret');
      } else if (e.reduced && !this.seenReduced.has(e.id)) {
        this.seenReduced.add(e.id);
        this.board.popup(e.pos, 'GUN LOST', 'k-gun');
      }
    }
    const ground = g.groundTarget;
    if (!ground) return;
    if (ground.damage > this.seenGround && ground.status === 'active') this.board.popup(ground.pos, `${ground.damage - this.seenGround} body damage`, 'k-body');
    this.seenGround = ground.damage;
    if (ground.status === 'destroyed' && !this.seenDestroyed.has(GROUND_TARGET_ID)) {
      this.seenDestroyed.add(GROUND_TARGET_ID);
      this.board.popup(ground.pos, 'DESTROYED', 'kill');
      if (clock.factor > 0) this.board.explode(ground.pos, true);
    }
  }

  /** New hits and kills since the last look float up from their ship. */
  private showNewDamage(): void {
    this.showNewEmplacementDamage();
    for (const ship of this.game.ships) {
      if (ship.pos) this.lastPos.set(ship.id, ship.pos);
      const where = ship.pos ?? this.lastPos.get(ship.id);
      const seen = this.seenWounds.get(ship.id) ?? 0;
      const already = this.shownWounds.get(ship.id);
      if (where && ship.wounds.length > seen) {
        ship.wounds.slice(seen).forEach((w, i) => {
          if (!already?.has(seen + i)) this.board.popup(where, w.text, `k-${w.kind}`, i);
        });
      }
      this.shownWounds.delete(ship.id);
      this.seenWounds.set(ship.id, ship.wounds.length);
      if (ship.status === 'destroyed' && !this.seenDestroyed.has(ship.id)) {
        this.seenDestroyed.add(ship.id);
        if (where) {
          this.board.popup(where, 'DESTROYED', 'kill', ship.wounds.length - seen);
          if (clock.factor > 0) this.board.explode(where, typeOf(ship).body[0] >= 12);
        }
      }
    }
  }

  private onShipClick(id: string): void {
    if (this.animating) {
      clock.skip = true;
      return;
    }
    // giving the turret guns their orders: a click on a ship in the arc of the turret being set makes it track that ship (Rules: Ground attack)
    if (this.turretsPhase() && this.turretSel && this.turretArcShips(this.turretSel).some((sh) => sh.id === id)) {
      const draft = this.turretDraft.get(this.turretSel)!;
      draft.target = draft.target === id ? null : id;
      this.render();
      return;
    }
    // while aiming, a click on a ship that can be shot gives it to the armed guns
    if (this.aim && this.aimTargetIds().includes(id)) {
      this.aimTarget(id);
      return;
    }
    this.pickShip(id);
    this.render();
  }

  /** Selects a ship, from the board, the ship list or the previous / next buttons; while planning that also chooses the ship to plan. */
  private pickShip(id: string): void {
    if (id !== this.selected) sound.play('ui.select');
    this.selected = id;
    this.turretSel = null;
    const g = this.game;
    const ship = shipById(g, id);
    if (g.phase === 'setup' && ship?.owner === this.human) {
      if (this.draft.has(id)) {
        // a ship already on the map: show its turn arrows. Placing carries on with the next ship, unless all are down
        this.turning = id;
        if (activeShips(g, this.human).every((s) => this.draft.has(s.id))) this.placingId = id;
      } else this.placingId = id;
    }
    if (g.phase === 'planning' && !g.planSubmitted[this.human] && ship?.owner === this.human) {
      if (this.planShip !== id) {
        this.planNonce += 1;
        this.planManual = null;
        this.planCrew = 'pilot';
        this.freeMode = false;
      }
      this.planShip = id;
      // a ship that is already submitted offers to keep or reopen its plan
      this.confirming = this.submitted.has(id) ? id : null;
      this.commitAsk = false;
    }
  }

  /** Moves the selection to the next or previous ship of the player, wrapping round. */
  private stepShip(direction: 1 | -1): void {
    const mine = activeShips(this.game, this.human);
    if (mine.length === 0) return;
    const at = mine.findIndex((s) => s.id === this.planShip);
    const next = mine[(at + direction + mine.length) % mine.length]!;
    this.pickShip(next.id);
    if (next.pos) this.board.reveal(next.pos, 90);
    this.render();
  }

  /** Marks the ship's plan as done, and moves on to the next ship that still needs one. */
  private submitShip(id: string): void {
    this.submitted.add(id);
    this.confirming = null;
    this.commitAsk = false;
    this.nextOpenShip(id);
    this.render();
  }

  private nextOpenShip(after: string): void {
    const mine = activeShips(this.game, this.human);
    const at = mine.findIndex((s) => s.id === after);
    for (let i = 1; i < mine.length; i++) {
      const s = mine[(at + i) % mine.length]!;
      if (!this.submitted.has(s.id)) {
        this.pickShip(s.id);
        if (s.pos) this.board.reveal(s.pos, 90);
        return;
      }
    }
  }

  private onSubmitClick(action: SubmitAction): void {
    const id = this.confirming;
    if (!id) return;
    this.confirming = null;
    if (action === 'reopen') this.submitted.delete(id);
    else this.nextOpenShip(id);
    this.render();
  }

  private onHexClick(hex: Hex): void {
    if (this.animating) {
      clock.skip = true;
      return;
    }
    const g = this.game;
    if (this.baseStage()) {
      this.onBaseClick(hex);
      return;
    }
    if (this.edgeStage()) return;
    if (this.placingNow()) {
      if (!this.placingId) return;
      if (isDestroyerTarget(this.placingId)) {
        this.placeDestroyer(this.placingId, hex);
        return;
      }
      if (this.sdHexes().some((x) => hexEquals(x, hex))) {
        this.message = 'A capital ship is in that hex.';
        this.render();
        return;
      }
      if (!this.placeZone().some((z) => hexEquals(z, hex))) {
        this.message = 'Place ships inside the shaded area.';
        this.render();
        return;
      }
      if (g.asteroids && rockAt(g.asteroids, hex)) {
        this.message = 'That hex has an asteroid in it.';
        this.render();
        return;
      }
      if (g.phase === 'arrival' && activeShips(g).some((s) => s.pos && hexEquals(s.pos, hex))) {
        this.message = 'A ship already stands in that hex.';
        this.render();
        return;
      }
      for (const [other, d] of this.draft) if (other !== this.placingId && hexEquals(d.pos, hex)) {
        this.message = 'That hex is already taken.';
        this.render();
        return;
      }
      const previous = this.draft.get(this.placingId);
      // a defender in a Ground Attack does not know which edge the attackers will choose (Rules: Ground attack): his ships all start facing north, whatever the other side does
      const hidden = !!g.groundAttack && g.groundAttack.attacker !== this.human;
      const enemyAt = g.phase === 'arrival' ? activeShips(g, this.aiPlayer).find((s) => s.pos)?.pos : undefined;
      const facing: Facing = previous?.facing ?? (hidden ? 0 : this.facingToward(hex, enemyAt ?? g.zones[this.aiPlayer][Math.floor(g.zones[this.aiPlayer].length / 2)]!));
      this.draft.set(this.placingId, { pos: hex, facing });
      sound.play('ui.place');
      this.turning = this.placingId;
      this.message = '';
      const next = [...this.toPlace().map((s) => s.id), ...this.sdToPlace().map((d) => d.id)].find((id) => !this.draft.has(id));
      this.placingId = next ?? this.placingId;
      this.render();
      return;
    }
    const ship = this.currentHumanShip();
    if (ship && g.active?.stage === 'move' && !this.snapPicking) {
      const sim = simulate(g, ship, this.moveSteps);
      const step = this.stepHexes(sim).find((s) => hexEquals(s.hex, hex));
      if (step) this.takeStep(step.step);
    }
  }

  private zoneCentre(player: PlayerId): Hex {
    const zone = this.game.zones[player];
    return zone[Math.floor(zone.length / 2)]!;
  }

  /** Default set-up facing: straight north or south, whichever way the enemy lies. */
  private facingToward(from: Hex, to: Hex): Facing {
    return setupFacing(from, to);
  }

  private fitAll(): void {
    const hexes = activeShips(this.game).flatMap((s) => (s.pos ? [s.pos] : []));
    // the base of a Ground Attack is part of the picture
    for (const e of this.game.emplacements ?? []) if (e.status === 'active') hexes.push(e.pos);
    if (this.game.groundTarget?.status === 'active') hexes.push(this.game.groundTarget.pos);
    for (const d of this.game.destroyers ?? []) if (d.pos && !d.exploded) hexes.push(...destroyerHexes(d.pos, d.facing, specOf(d).kind));
    this.board.fit(hexes.length ? hexes : this.game.zones[this.human].slice(0, 40), 1.1);
  }

  private fitMine(): void {
    const hexes = activeShips(this.game, this.human).flatMap((s) => (s.pos ? [s.pos] : []));
    if (hexes.length) this.board.fit(hexes, 1.4);
  }

  // ------------------------------------------------------------------ who is up

  /** The ship the ship window stays on: the one moving or firing, or the one a decision is about. */
  private pinnedShip(): Ship | null {
    const g = this.game;
    const p = g.pending;
    if (p && p.player === this.human) {
      const id = p.kind === 'steal' ? p.target : p.kind === 'pass' ? p.queue[0]! : p.kind === 'follow' ? p.ship : p.shipId;
      return shipById(g, id) ?? null;
    }
    return this.currentHumanShip();
  }

  private currentHumanShip(): Ship | null {
    const g = this.game;
    if (g.phase !== 'ships' || !g.active || g.pending) return null;
    const ship = shipById(g, g.active.queue[g.active.index]!);
    return ship && ship.owner === this.human ? ship : null;
  }

  private onRingClick(action: RingAction): void {
    if (this.animating) {
      clock.skip = true;
      return;
    }
    const setup = this.placingNow();
    if (this.humanDestroyer() && action !== 'snapFire') {
      this.sdRingClick(action);
      return;
    }
    if (this.turretsPhase() && this.turretSel && (action === 'turnLeft' || action === 'turnRight')) this.turnTurret(this.turretSel, action === 'turnLeft' ? -1 : 1);
    else if (setup && (action === 'turnLeft' || action === 'turnRight')) this.turnPlaced(action === 'turnLeft' ? -1 : 1);
    else if (action === 'undo') this.undoMove();
    else if (action === 'restart') this.restartMove();
    else this.takeStep(action);
  }

  /** Turns the ship that was just placed (or clicked) by one hex side. */
  private turnPlaced(direction: -1 | 1): void {
    const d = this.turning ? (this.baseStage() ? this.baseDraft : this.draft).get(this.turning) : undefined;
    if (!d) return;
    const facing = ((((d.facing + direction) % 6) + 6) % 6) as Facing;
    if (this.turning && isDestroyerTarget(this.turning) && !this.sdFits(d.pos, facing, this.turning)) {
      this.message = 'The ship would stick out of the shaded area that way.';
      this.render();
      return;
    }
    d.facing = facing;
    this.render();
  }

  /** Takes back the last click: a slip or a run of forward steps goes as one. */
  private undoMove(): void {
    this.aim = null;
    this.moveSteps.length -= this.moveGroups.pop() ?? this.moveSteps.length;
    this.followGhost();
    this.render();
  }

  private restartMove(): void {
    this.aim = null;
    this.moveSteps = [];
    this.moveGroups = [];
    this.followGhost();
    this.render();
  }

  /**
   * The speed ray of the ship that is moving: straight ahead for the hexes it has left, with a ring where
   * it may turn next (none when it may turn already; none when it cannot within its movement).
   */
  private moveRay(ship: Ship, sim: MoveSim): Overlay['ray'] {
    if (sim.budget < 1) return undefined;
    let gate: number | null = sim.canTurn ? 0 : null;
    for (let k = 1; gate === null && k <= sim.budget; k++) {
      const probe = simulate(this.game, ship, [...this.moveSteps, ...Array.from({ length: k }, () => ({ kind: 'forward' as const }))]);
      if (probe.legal.includes('turnLeft') || probe.legal.includes('turnRight')) gate = k;
    }
    return { pos: sim.pos, facing: sim.facing, speed: sim.budget, turn: sim.turnNumber, gate, label: `${sim.budget} hex${sim.budget === 1 ? '' : 'es'} left` };
  }

  /** Keeps the ring around the ship in view as the move runs ahead. */
  private followGhost(): void {
    const ship = this.currentHumanShip();
    if (ship) this.board.reveal(simulate(this.game, ship, this.moveSteps).pos, 90);
  }

  /** What each control around the moving ship may do now, and what it would say if asked. */
  private ringButtons(ship: Ship, sim: MoveSim): RingButtons {
    const can = (step: MoveStep) => sim.legal.includes(step);
    const turnWhy = sim.canTurn ? 'isn’t possible here' : `can’t turn yet (turn number ${fmtTurn(sim.turnNumber)})`;
    const move = (step: MoveStep, yes: string, no: string): RingButton => ({ enabled: can(step), title: can(step) ? yes : no });
    const snapCrews = this.aimCrews('snap', ship);
    const hasTarget = snapCrews.length > 0;
    const started = this.moveSteps.length > 0;
    return {
      forward: move('forward', 'Forward: moves on until the first hex where another move is possible', 'Forward isn’t possible here'),
      slipLeft: move('slipLeft', 'Slip left: move one hex diagonally ahead to the left, keeping the facing', 'Slip left isn’t possible here'),
      slipRight: move('slipRight', 'Slip right: move one hex diagonally ahead to the right, keeping the facing', 'Slip right isn’t possible here'),
      turnLeft: move('turnLeft', 'Turn one hex side to the left', `Turn left: ${turnWhy}`),
      turnRight: move('turnRight', 'Turn one hex side to the right', `Turn right: ${turnWhy}`),
      halfLoop: move('halfLoop', 'Half loop: reverse the facing; uses one hex of movement. You can turn on that hex first.', 'Half loop isn’t possible here'),
      snapFire: can('snapFire') && hasTarget
        ? { enabled: true, title: `Snap fire from here (${snapCrews.map((c) => crewOf(ship).find((m) => m.id === c.id)?.label ?? c.id).join(', ')})` }
        : { enabled: false, title: this.snapBlock(ship) ?? 'Snap fire isn’t possible here.' },
      undo: { enabled: started, title: 'Undo the last step' },
      restart: { enabled: started, title: 'Start the move over' },
    };
  }

  private takeStep(step: MoveStep): void {
    const ship = this.currentHumanShip();
    if (!ship) return;
    if (step === 'snapFire') {
      this.openSnap();
      return;
    }
    const before = this.moveSteps.length;
    this.pushStep(ship, step);
    this.moveGroups.push(this.moveSteps.length - before);
    this.followGhost();
    this.render();
  }

  /**
   * One click can mean several steps. "Forward" runs on to the first hex where the ship could do
   * anything else; a slip runs for the shortest legal length (the turn number, see Rules: Movement).
   */
  private pushStep(ship: Ship, step: Exclude<MoveStep, 'snapFire'>): void {
    const g = this.game;
    this.moveSteps.push({ kind: step });
    let sim = simulate(g, ship, this.moveSteps);
    for (let guard = 0; guard < 40; guard++) {
      let next: Exclude<MoveStep, 'snapFire'> | null = null;
      if (step === 'forward') {
        const hasChoice = sim.legal.some((s) => s !== 'forward' && (s !== 'snapFire' || this.aimCrews('snap', ship).length > 0));
        if (!hasChoice && sim.legal.includes('forward')) next = 'forward';
      } else if (step === 'slipLeft' || step === 'slipRight') {
        // the slip runs on by itself, but stops where somebody could snap fire (Rules: Movement): the hexes of a slip are hexes of the move like any other
        if (sim.slipOpen && !(sim.legal.includes('snapFire') && this.aimCrews('snap', ship).length > 0)) next = sim.legal.includes(step) ? step : sim.legal.includes('forward') ? 'forward' : null;
      }
      if (next === null) break;
      this.moveSteps.push({ kind: next });
      sim = simulate(g, ship, this.moveSteps);
    }
  }

  private stepHexes(sim: MoveSim): { hex: Hex; step: MoveStep; label: string; rotation: number }[] {
    const out: { hex: Hex; step: MoveStep; label: string; rotation: number }[] = [];
    const add = (step: MoveStep, offset: number, label: string): void => {
      if (sim.legal.includes(step)) out.push({ hex: neighbor(sim.pos, sim.facing + offset), step, label, rotation: (sim.facing + offset) * 60 });
    };
    add('forward', 0, '▲');
    add('slipLeft', -1, '▲');
    add('slipRight', 1, '▲');
    return out;
  }

  // ------------------------------------------------------------------ rendering

  /** The log entries the sounds have been played for, when the wait for the player's own turn began, and whether the end of the game has been heard. */
  private soundLog = 0;
  private waitingSince: number | null = null;
  private overHeard = false;

  /** The sounds that follow the state of the game, not an animation: a new game-turn, the dice, the hum of the selected ship, "your turn", the end. */
  private gameSounds(): void {
    const g = this.game;
    if (this.soundLog > g.log.length) this.soundLog = g.log.length;
    for (const e of g.log.slice(this.soundLog)) {
      if (e.kind === 'turn') sound.play('turn.new');
      else if (e.kind === 'initiative') sound.play('dice.roll');
    }
    this.soundLog = g.log.length;
    const over = g.phase === 'over';
    // the cockpit hum belongs to planning only (the owner): it is that of the ship whose plan is being drawn up, whatever else is selected
    // meanwhile, and it follows the speed being planned. Once the plan is in, and all through the movement, there is none
    const drafting = g.phase === 'planning' && !g.planSubmitted[this.human] && !this.animating;
    const ship = drafting && this.planShip && !this.submitted.has(this.planShip) ? shipById(g, this.planShip) : undefined;
    if (ship?.status === 'active' && ship.owner === this.human) {
      const speed = motionOf(g, ship, this.plans[ship.id] ?? emptyPlan()).planned?.speed ?? ship.speed;
      const top = typeOf(ship).speedMax;
      sound.cockpit(ship.typeId, cockpitLevel(speed, top), cockpitPitch(speed, top));
    } else sound.cockpit(null);
    // after a wait of a few seconds (the computer's moves, the other player) a cue says it is the player's turn again
    const mine = !over && !this.animating && waitingFor(g).includes(this.human);
    const now = performance.now();
    if (!mine) this.waitingSince ??= now;
    else {
      if (this.waitingSince !== null && now - this.waitingSince > 3000) sound.play('turn.yours');
      this.waitingSince = null;
    }
    if (over && !this.overHeard) {
      this.overHeard = true;
      if (g.winner === this.human) sound.play('game.won');
      else if (g.winner !== null && g.winner !== 'draw') sound.play('game.lost');
    }
  }

  private render(): void {
    if (!this.game) return;
    const g = this.game;
    this.gameSounds();
    this.ensureAim();
    this.renderPlanBox();
    // advanced initiative: the ship whose owner is asked when it moves comes to the middle of the board
    const picker = g.phase === 'initiative' && g.initiativeTable ? nextPicker(g.initiativeTable) : null;
    if (picker !== this.lastPicker) {
      this.lastPicker = picker;
      const up = picker ? shipById(g, picker) : undefined;
      if (up?.pos) {
        this.selected = up.id;
        this.board.panTo(up.pos);
      }
    }
    const overlay: Overlay = { game: g, selected: this.selected };
    if (picker) overlay.activeShipId = picker;

    if (this.baseStage()) this.baseOverlay(overlay);
    else if (this.edgeStage()) {
      if (this.edgeDraft) overlay.zone = attackerZoneFor(g.map, this.edgeDraft);
      // the defender's ships are already down (against the computer) but nobody sees them until both have placed their ships
      overlay.hidden = [...g.ships.map((s) => s.id), ...(g.destroyers ?? []).map((d) => d.id)];
      if (!this.baseFitted) {
        this.baseFitted = true;
        const m = g.map;
        requestAnimationFrame(() => this.board.fit([fromOffset(0, 0), fromOffset(m.cols - 1, 0), fromOffset(0, m.rows - 1), fromOffset(m.cols - 1, m.rows - 1)], 1.05));
      }
    }
    else if (this.placingNow()) {
      overlay.zone = this.placeZone();
      // the arrow toward the enemy would give away the edge the attackers chose (Rules: Ground attack)
      if (g.phase === 'setup' && !(g.groundAttack && g.groundAttack.attacker !== this.human)) overlay.zoneArrow = { from: this.zoneCentre(this.human), to: this.zoneCentre(this.aiPlayer) };
      // in the set-up nobody sees the ships of the other side; ships that are already on the map stay in view when reserves come in
      if (g.phase === 'setup') overlay.hidden = [...g.ships.map((s) => s.id), ...(g.destroyers ?? []).map((d) => d.id)];
      overlay.destroyerPickable = this.sdToPlace().filter((d) => this.draft.has(d.id)).map((d) => d.id);
      overlay.destroyerSelected = this.placingId && isDestroyerTarget(this.placingId) ? this.placingId : null;
      overlay.destroyerPlacements = this.sdToPlace().flatMap((d) => {
        const placed = this.draft.get(d.id);
        return placed ? [{ id: d.id, pos: placed.pos, facing: placed.facing }] : [];
      });
      overlay.placements = this.toPlace().flatMap((ship) => {
        const d = this.draft.get(ship.id);
        return d ? [{ ship, pos: d.pos, facing: d.facing }] : [];
      });
      overlay.selected = this.placingId;
      const turning = this.turning ? this.draft.get(this.turning) : undefined;
      if (turning) overlay.turn = { pos: turning.pos, facing: turning.facing };
    }

    if (g.phase === 'planning' && !g.planSubmitted[this.human]) {
      overlay.dimmed = [...this.submitted];
      const asking = this.confirming ? shipById(g, this.confirming) : undefined;
      if (asking?.pos) overlay.confirm = { pos: asking.pos };
    }

    // choosing the ship to move: a Move button beside the ship that is selected, if it may move
    if (this.choosing() && this.selected) {
      const pick = shipById(g, this.selected);
      if (pick && pick.status === 'active' && !pick.moved && pick.pos) overlay.choose = { pos: pick.pos };
    }

    const mine = this.currentHumanShip();
    // the speed ray of the selected ship, as planned while planning
    const rayShip = this.selected ? shipById(g, this.selected) : undefined;
    if (rayShip && rayShip.status === 'active' && rayShip.pos && (g.phase === 'planning' || g.phase === 'ships') && !rayShip.moved && rayShip.id !== mine?.id) {
      const drafting = g.phase === 'planning' && !g.planSubmitted[this.human] && rayShip.owner === this.human;
      const m = motionOf(g, rayShip, drafting ? this.plans[rayShip.id] ?? emptyPlan() : undefined);
      const use = m.planned ?? { speed: m.speed, turn: m.turn };
      overlay.ray = { pos: rayShip.pos, facing: rayShip.facing, speed: use.speed, turn: use.turn };
    }
    if (mine) {
      overlay.activeShipId = mine.id;
      if (g.active?.stage === 'move') {
        const sim = simulate(g, mine, this.moveSteps);
        overlay.ghost = { ship: mine, pos: sim.pos, facing: sim.facing, path: sim.path };
        overlay.arc = { pos: sim.pos, facing: sim.facing, far: this.farArc(mine) };
        if (!this.snapPicking) overlay.ray = this.moveRay(mine, sim);
        if (!this.snapPicking) overlay.ring = { pos: sim.pos, facing: sim.facing, buttons: this.ringButtons(mine, sim) };
        if (!this.snapPicking) overlay.stepHexes =this.stepHexes(sim).map((s) => ({ hex: s.hex, label: s.label, rotation: s.rotation }));
        // the asteroids on the way: the roll for each is made when the move is carried out, and the plan is known now
        if (g.asteroids) overlay.rockWarnings = this.rockWarnings(mine, sim.path, overlay.stepHexes?.map((s) => s.hex) ?? []);
        if (this.snapPicking) Object.assign(overlay, this.aimOverlay(mine));
        // a gunner's turret is not limited to the forward arc: do not outline it
        if (this.aim && this.aim.active !== PILOT) overlay.arc = null;
      } else if (g.active?.stage === 'fire') {
        overlay.arc = { pos: mine.pos!, facing: mine.facing, far: this.farArc(mine) };
        Object.assign(overlay, this.aimOverlay(mine));
        if (this.aim && this.aim.active !== PILOT) overlay.arc = null;
      }
    } else if (g.active) {
      overlay.activeShipId = g.active.queue[g.active.index] ?? null;
    } else if (this.selected) {
      const sel = shipById(g, this.selected);
      if (sel?.pos && g.phase !== 'setup') overlay.arc = { pos: sel.pos, facing: sel.facing, far: this.farArc(sel) };
    }

    const shooter = this.humanTargeting();
    if (shooter) {
      const ids = capitalTargetsOf(g, shooter);
      overlay.destroyerTargets = ids.map((t) => t.id);
      overlay.destroyerLabels = Object.fromEntries(ids.map((t) => [t.id, `range ${this.capitalRange(shooter, t)}`]));
    }
    const sd = this.humanDestroyer();
    if (sd) {
      const sim = this.sdSim(sd);
      overlay.destroyerGhost = { id: sd.id, pos: sim.pos, facing: sim.facing, path: sim.path };
      overlay.ring = { pos: sim.pos, facing: sim.facing, buttons: this.sdRingButtons(sd, sim) };
      const choices = destroyerSpeedChoices(sd);
      overlay.destroyerSpeed = { id: sd.id, now: destroyerSpeedNow(sd), chosen: this.sdChosenSpeed(sd), up: !this.sdSpeedLocked() && choices.includes(this.sdChosenSpeed(sd) + specOf(sd).speedStep), down: !this.sdSpeedLocked() && choices.includes(this.sdChosenSpeed(sd) - specOf(sd).speedStep), locked: this.sdSpeedLocked() };
    }

    if (!overlay.destroyerSelected && this.selected && isDestroyerTarget(this.selected)) overlay.destroyerSelected = this.selected;
    this.addTurretOverlay(overlay);
    this.addCapitalRangeOverlay(overlay);
    // the switch for the size of the fighters is there as soon as there is a capital ship (in a points game they come with the forces that are bought)
    const capitals = (g.destroyers?.length ?? 0) > 0;
    this.smallFighters.style.display = capitals ? '' : 'none';
    this.board.setShipScale(capitals && !loadFlag('fullfighters') ? 0.5 : 1);
    this.board.render(overlay);
    this.showNewDamage();
    this.renderSidebar();
    this.renderSheet();
    this.renderCommandBar();
    this.renderLog();
    this.renderOverlay();
  }

  /** The full-screen pages of a points game: buying the force, and the two forces side by side once both are in (35). */
  private renderOverlay(): void {
    const g = this.game;
    const purchase = g.purchase;
    let node: HTMLElement | null = null;
    if (purchase && g.phase === 'forces') {
      const chooser = purchase.chooser;
      if (chooser !== undefined && chooser !== this.human) {
        node = forceWaiting({ host: 'The host' });
      } else {
        // one player chooses both forces (a scenario made to make sense), or each buys their own
        const both = chooser !== undefined;
        node = forceBuilder({
          side: both ? this.forceSide : this.human,
          both,
          limits: purchase.limits,
          asteroids: !!g.asteroids,
          forces: this.forceDrafts,
          confirmed: both ? false : purchase.chosen[this.human] !== null,
          error: this.message,
          opponent: this.opponent(),
          onSide: (side) => {
            this.forceSide = side;
            this.renderOverlay();
          },
          onChange: (side, ships) => {
            const next: [ForceShip[], ForceShip[]] = [this.forceDrafts[0], this.forceDrafts[1]];
            next[side] = ships;
            this.forceDrafts = next;
            this.message = '';
            this.renderOverlay();
          },
          onConfirm: () => {
            if (both) this.send({ type: 'buyBoth', player: this.human, ships: [this.forceDrafts[0], this.forceDrafts[1]] });
            else this.send({ type: 'buy', player: this.human, ships: this.forceDrafts[this.human] });
          },
        });
      }
    } else if (purchase && g.phase === 'setup' && !this.forcesSeen && purchase.chosen[0] && purchase.chosen[1]) {
      node = forceReveal({
        player: this.human,
        limits: purchase.limits,
        chosen: [purchase.chosen[0], purchase.chosen[1]],
        onStart: () => {
          this.forcesSeen = true;
          this.renderOverlay();
          this.board.fit(this.game.zones[this.human], 1);
        },
      });
    }
    // keep the lists where the player had scrolled them while the page is drawn again
    const scrolls = this.overlayEl ? Array.from(this.overlayEl.querySelectorAll('.fcatalog, .froster')).map((e) => e.scrollTop) : [];
    this.overlayEl?.remove();
    this.overlayEl = node;
    if (node) {
      this.root.append(node);
      Array.from(node.querySelectorAll('.fcatalog, .froster')).forEach((e, i) => { e.scrollTop = scrolls[i] ?? 0; });
    }
  }

  private targetsFrom(shooter: Ship): Ship[] {
    return targetsInRange(this.game, shooter).filter((t) => t.owner !== shooter.owner);
  }

  private renderSidebar(): void {
    const g = this.game;
    // keep the scroll position while the player works in one panel, but start at the top for a new one
    const stageKey = [g.phase, g.turn, g.active ? `${g.active.stage}${g.active.index}${g.active.queue.join()}` : '', g.pending?.kind ?? '', this.planShip ?? '', this.snapPicking, g.initiativeTable ? Object.keys(g.initiativeTable.follows).length + g.initiativeTable.slots.filter(Boolean).length : ''].join('|');
    const keepScroll = stageKey === this.lastStage ? this.sidebar.scrollTop : 0;
    this.lastStage = stageKey;
    clear(this.sidebar);
    this.applyLayout();
    this.sidebar.append(this.header());
    if (this.message) this.sidebar.append(h('div', { class: 'error' }, this.message));
    const prompt = this.prompt();
    prompt.hidden = prompt.childElementCount === 0;
    this.sidebar.append(prompt);
    const table = this.initiativePanel();
    if (table) this.sidebar.append(table);
    this.sidebar.append(h('h3', null, 'Ships'), ...this.shipList());
    this.sidebar.scrollTop = keepScroll;
  }

  /** The width step the right column is drawn in. Placing ships needs more room than icons give, so that step is used while placing. */
  private get sideLevel(): 0 | 1 | 2 {
    const g = this.game;
    return this.sideMode === 2 && g && this.placingNow() ? 1 : this.sideMode;
  }

  private setSideMode(mode: number): void {
    this.sideMode = Math.min(2, Math.max(0, mode)) as 0 | 1 | 2;
    saveNumber('sidebarMode', this.sideMode);
    saveFlag('sidebarCompact', false);
    this.render();
  }

  private setLeftFolded(on: boolean): void {
    this.leftFolded = on;
    saveFlag('leftFolded', on);
    this.applyLayout();
  }

  /** Sets the classes that give the columns their widths, and the labels of the fold buttons. */
  private applyLayout(): void {
    const level = this.sideLevel;
    this.layoutEl.classList.toggle('side1', level === 1);
    this.layoutEl.classList.toggle('side2', level === 2);
    this.layoutEl.classList.toggle('leftfolded', this.leftFolded);
    this.sidebar.classList.toggle('compact', level === 1);
    this.sidebar.classList.toggle('icons', level === 2);
    this.foldLeftBtn.textContent = this.leftFolded ? '»' : '«';
    this.foldLeftBtn.title = this.leftFolded ? 'Show the ship window and the log again' : 'Fold the left column away (ship window and log) to give the board more room';
    this.widerBtn.textContent = '«';
    this.widerBtn.title = 'Wider right column: one step towards the full ship cards';
    this.widerBtn.disabled = this.sideMode === 0;
    this.narrowerBtn.textContent = '»';
    this.narrowerBtn.title = this.sideMode === 0 ? 'Narrower right column: ship codes and one line of numbers' : 'Narrowest right column: only the icons with their codes';
    this.narrowerBtn.disabled = this.sideMode === 2;
  }

  private header(): HTMLElement {
    const g = this.game;
    const wide = this.sideLevel === 0;
    const turn = g.turn > 0 ? `Game-turn ${g.turn}` : g.phase === 'forces' ? 'Choosing forces' : 'Setup';
    const init = g.initiative !== null && g.phase !== 'setup' ? ` · initiative: ${SIDE_NAMES[g.initiative]}` : g.advancedInitiative && g.turn > 0 ? ' · advanced initiative' : '';
    return h('div', { class: 'header' },
      this.netLine(),
      h('div', { class: 'score' },
        h('span', { style: { color: SIDE_COLORS[0] } }, `${wide ? SIDE_LONG[0] : SIDE_NAMES[0]} ${g.vp[0]}`),
        h('span', { class: 'vs' }, 'VP'),
        h('span', { style: { color: SIDE_COLORS[1] } }, `${wide ? SIDE_LONG[1] : SIDE_NAMES[1]} ${g.vp[1]}`),
      ),
      h('div', { class: 'turn' }, turn + init),
      h('div', { class: 'you' }, `You play as the ${SIDE_NAMES[this.human]}`),
      this.objectiveLine(),
    );
  }

  /** What the scenario asks of the player, when it asks for more than the standard game does (30). */
  private objectiveLine(): HTMLElement | null {
    const g = this.game;
    const own = g.rules?.objectives?.[this.human];
    if (own) return h('div', { class: 'objective' }, own);
    const role = roleOf(g, this.human);
    const pay = g.rules?.escapeVp?.[0];
    if (!pay || !role) return null;
    const text = role === 'convoy'
      ? `Your convoy: bring the designated ${pay.tag} ships off the map. Each one that escapes scores ${pay.vp} victory points.`
      : role === 'attacker' ? `Stop the convoy. Every designated ${pay.tag} ship that escapes scores ${pay.vp} victory points for the enemy.` : null;
    return text ? h('div', { class: 'objective' }, text) : null;
  }

  // ------------------------------------------------------------------ prompts

  private prompt(): HTMLElement {
    const g = this.game;
    const wrap = h('section', { class: 'prompt' });
    const waitingText = (text: string) => wrap.append(h('p', { class: 'wait' }, this.pumping || this.net ? `${text}…` : text));
    const opp = this.opponent();

    if (g.phase === 'over') {
      const result = g.winner === 'draw' ? 'The game is a draw.' : `${SIDE_NAMES[g.winner as PlayerId]} win!`;
      wrap.append(h('h3', null, 'Game over'), h('p', null, result), h('p', null, `Victory points: Rebels ${g.vp[0]}, Empire ${g.vp[1]}.`), h('button', { class: 'primary', onclick: () => this.showMenu() }, 'Back to menu'));
      return wrap;
    }
    if (g.pending) {
      if (g.pending.player !== this.human) waitingText(`Waiting for ${opp} to decide`);
      return wrap;
    }
    switch (g.phase) {
      case 'forces':
        waitingText(g.purchase?.chooser !== undefined && g.purchase.chooser !== this.human ? 'Waiting for the host to choose the forces' : g.purchase?.chosen[this.human] ? `Waiting for ${opp} to choose a force` : 'Choose your force on the page over the board');
        break;
      case 'setup':
        if (this.baseStage()) append(wrap, this.basePanel());
        else if (this.edgeStage()) append(wrap, this.edgePanel());
        else if (this.placingNow()) append(wrap, this.setupPanel());
        else if (g.baseSetup && !g.baseSetup.done) waitingText(`Waiting for ${opp} to place the ground target and the base`);
        else waitingText(`Waiting for ${opp} to place ${this.net ? 'their' : 'its'} ships`);
        break;
      case 'entry':
        if (waitingFor(g).includes(this.human)) append(wrap, this.entryPanel());
        else waitingText(`Waiting for ${opp} to say whether their reserves come in`);
        break;
      case 'arrival':
        if (this.placingNow()) append(wrap, this.setupPanel());
        else waitingText(`Waiting for ${opp} to bring their ships in`);
        break;
      case 'initiative': {
        const picker = g.initiativeTable ? nextPicker(g.initiativeTable) : null;
        const ship = picker ? shipById(g, picker) : undefined;
        if (!ship) break;
        if (ship.owner !== this.human) {
          waitingText(`Waiting for ${opp} to say when ${fullName(ship)} moves`);
          break;
        }
        // the table and the list of ships carry the question themselves
        break;
      }
      case 'planning':
        if (g.planSubmitted[this.human]) waitingText(`Waiting for ${opp} to plan`);
        break;
      case 'ships': {
        if (!g.active) {
          // choosing the ship to move happens in the list of ships and on the board
          if (!g.advancedInitiative && g.chooser !== this.human) waitingText(`${opp[0]!.toUpperCase()}${opp.slice(1)} is choosing a ship to move`);
          break;
        }
        const ship = this.currentHumanShip();
        if (!ship) waitingText(`${fullName(shipById(g, g.active.queue[g.active.index]!)!)} is moving`);
        break;
      }
    }
    return wrap;
  }

  // ---- placing the ground target and the base (Rules: Ground attack)

  /** Is it this player's turn to place the ground target and the base? */
  private baseStage(): boolean {
    const b = this.game.baseSetup;
    return this.game.phase === 'setup' && !!b && !b.done && b.defender === this.human;
  }

  /** Is this player placing something now: ships, or the ground target and the base? */
  private placingNow(): boolean {
    return (this.game.phase === 'setup' || this.game.phase === 'arrival') && waitingFor(this.game).includes(this.human) && !this.edgeStage();
  }

  /** Is it this player's turn to choose an edge: the one the attackers come from (Rules: Ground attack), or the one a side starts along (Rules: Reserves)? */
  private edgeStage(): boolean {
    const g = this.game;
    if (g.phase === 'setup' && g.edgeChoice && !g.edgeChoice.edge && g.edgeChoice.side === this.human) return true;
    return g.phase === 'setup' && !!g.groundAttack && !g.groundAttack.edge && g.groundAttack.attacker === this.human && !(g.baseSetup && !g.baseSetup.done);
  }

  /** The ships to place now: the ones that start on the map, or a reserve group that comes in. */
  private toPlace(): Ship[] {
    const g = this.game;
    if (g.phase === 'arrival' && g.arrival) {
      const group = reserveGroup(g, g.arrival.group);
      return group ? group.shipIds.map((id) => shipById(g, id)!).filter((ship) => ship.status === 'reserve') : [];
    }
    return activeShips(g, this.human);
  }

  /** The hexes the ships being placed may go in. */
  private placeZone(): Hex[] {
    const g = this.game;
    return g.phase === 'arrival' ? arrivalHexes(g, this.arrivalEdge ?? undefined) : g.zones[this.human];
  }

  private baseItemName(item: BaseItem): string {
    switch (item.kind) {
      case 'ground': return 'Ground target';
      case 'base': return 'Standard base (3 double and 6 single turret guns)';
      case 'double': return `Double turret gun ${item.id}`;
      default: return `Single turret gun ${item.id}`;
    }
  }

  private baseOverlay(overlay: Overlay): void {
    const g = this.game;
    const setup = g.baseSetup!;
    const items = baseItems(setup.kit);
    const placed = items.flatMap((item) => {
      const d = this.baseDraft.get(item.id);
      return d ? [{ item, placement: { id: item.id, pos: d.pos, facing: d.facing } }] : [];
    });
    const selected = items.find((i) => i.id === this.placingId);
    if (selected) overlay.zone = validBaseHexes(g.map, setup.kit, selected, this.baseDraft.get(selected.id)?.facing ?? 0, placed);
    overlay.baseItems = placed.map((p) => ({ id: p.item.id, kind: p.item.kind, pos: p.placement.pos, facing: p.placement.facing, owner: this.human }));
    overlay.selected = this.placingId;
    const turning = this.turning ? this.baseDraft.get(this.turning) : undefined;
    const turningItem = items.find((i) => i.id === this.turning);
    if (turning && turningItem && turningItem.kind !== 'ground') overlay.turn = { pos: turning.pos, facing: turning.facing };
    if (!this.baseFitted) {
      this.baseFitted = true;
      const m = g.map;
      requestAnimationFrame(() => this.board.fit([fromOffset(10, 10), fromOffset(m.cols - 11, 10), fromOffset(10, m.rows - 11), fromOffset(m.cols - 11, m.rows - 11)], 1.1));
    }
  }

  /** A click on the map while placing: select a placed item, or put the selected one down in a hex the board has shaded. */
  private onBaseClick(hex: Hex): void {
    const g = this.game;
    const setup = g.baseSetup!;
    const items = baseItems(setup.kit);
    const hit = items.find((item) => {
      const d = this.baseDraft.get(item.id);
      return d && (hexEquals(d.pos, hex) || itemGuns(item.kind, d).some((gun) => hexEquals(gun.pos, hex)));
    });
    if (hit) {
      this.placingId = hit.id;
      this.turning = hit.kind === 'ground' ? null : hit.id;
      this.message = '';
      this.render();
      return;
    }
    const item = items.find((i) => i.id === this.placingId);
    if (!item) return;
    const rest = items.flatMap((i) => {
      const d = this.baseDraft.get(i.id);
      return i.id !== item.id && d ? [{ item: i, placement: { id: i.id, pos: d.pos, facing: d.facing } }] : [];
    });
    const facing = this.baseDraft.get(item.id)?.facing ?? 0;
    const error = baseLayoutError(g.map, setup.kit, [...rest, { item, placement: { id: item.id, pos: hex, facing } }], false);
    if (error) {
      this.message = error;
      this.render();
      return;
    }
    this.baseDraft.set(item.id, { pos: hex, facing });
    this.turning = item.kind === 'ground' ? null : item.id;
    this.message = '';
    const next = items.find((i) => !this.baseDraft.has(i.id));
    this.placingId = next ? next.id : this.placingId;
    this.render();
  }

  private basePanel(): Child[] {
    const g = this.game;
    const setup = g.baseSetup!;
    const items = baseItems(setup.kit);
    const done = items.every((i) => this.baseDraft.has(i.id));
    if (!this.placingId || !items.some((i) => i.id === this.placingId)) this.placingId = items.find((i) => !this.baseDraft.has(i.id))?.id ?? items[0]?.id ?? null;
    const rows = items.map((item) => {
      const d = this.baseDraft.get(item.id);
      return h('div', { class: 'row-item' + (this.placingId === item.id ? ' sel' : ''), onclick: () => { this.placingId = item.id; this.turning = d && item.kind !== 'ground' ? item.id : null; this.render(); } },
        h('b', null, this.baseItemName(item)),
        h('span', null, d ? 'placed' : 'not placed'),
      );
    });
    return [
      h('h3', null, 'Place the ground target and the base'),
      h('p', null, 'Pick an item, then click a hex in the shaded area. Everything has to be at least ten hexes from the map edge, and the guns at least two hexes from the ground target.'),
      h('p', null, 'For the base, click where its middle should be. Its guns face outward; turn the whole base with the arrows.'),
      h('p', null, 'Click a placed item to move it or to bring its arrows back.'),
      h('p', null, 'You turn the guns one by one during the game.'),
      h('p', null, `${this.net ? 'The other player places their ships' : 'The computer places its ships'} after you are done.`),
      ...rows,
      h('div', { class: 'buttons' },
        h('button', { onclick: () => this.autoBase() }, 'Auto-place'),
      ),
      h('button', { class: 'primary', disabled: !done, onclick: () => this.confirmBase() }, 'Confirm'),
    ];
  }

  private autoBase(): void {
    const setup = this.game.baseSetup!;
    for (const p of autoBase(createRng((Math.random() * 0x7fffffff) | 0), this.game.map, setup.kit)) this.baseDraft.set(p.id, { pos: p.pos, facing: p.facing });
    this.turning = null;
    this.message = '';
    this.render();
  }

  private confirmBase(): void {
    const items = [...this.baseDraft].map(([id, d]) => ({ id, pos: d.pos, facing: d.facing }));
    if (this.send({ type: 'base', player: this.human, items })) {
      this.baseDraft.clear();
      this.placingId = null;
      this.turning = null;
      // against the computer the game has already moved on and drawn itself with the old selection: draw again, or the first ship is never selected
      this.render();
      requestAnimationFrame(() => this.fitAll());
    }
  }

  // ---- the attackers choose their edge (Rules: Ground attack)

  private edgePanel(): Child[] {
    const names: Record<MapEdge, string> = { top: 'Top edge', bottom: 'Bottom edge', left: 'Left edge', right: 'Right edge' };
    const choice = this.game.edgeChoice;
    if (choice) {
      return [
        h('h3', null, 'Choose the edge you start along'),
        h('p', null, 'Pick the edge your ships start along; the board shades the area, two hexes deep. The other side knows which one you chose.'),
        ...choice.options.map((edge) => h('div', { class: 'row-item' + (this.edgeDraft === edge ? ' sel' : ''), onclick: () => { this.edgeDraft = edge; this.render(); } }, h('b', null, names[edge]), h('span', null, this.edgeDraft === edge ? 'chosen' : ''))),
        h('button', { class: 'primary', disabled: !this.edgeDraft, onclick: () => this.confirmEdge() }, 'Confirm'),
      ];
    }
    return [
      h('h3', null, 'Choose the edge you attack from'),
      h('p', null, 'The defender has placed the ground target and the base. You can see them. Pick the edge your ships start along; the board shades the area, two hexes deep. The defender isn’t told which edge you chose until all ships are placed. Both of you place your ships in secret.'),
      ...MAP_EDGES.map((edge) => h('div', { class: 'row-item' + (this.edgeDraft === edge ? ' sel' : ''), onclick: () => { this.edgeDraft = edge; this.render(); } }, h('b', null, names[edge]), h('span', null, this.edgeDraft === edge ? 'chosen' : ''))),
      h('button', { class: 'primary', disabled: !this.edgeDraft, onclick: () => this.confirmEdge() }, 'Confirm'),
    ];
  }

  private confirmEdge(): void {
    if (!this.edgeDraft) return;
    if (this.send({ type: 'edge', player: this.human, edge: this.edgeDraft })) {
      this.edgeDraft = null;
      requestAnimationFrame(() => this.fitAll());
    }
  }

  // ---- setup

  private setupPanel(): Child[] {
    const g = this.game;
    const arriving = g.phase === 'arrival' && !!g.arrival;
    const group = arriving ? reserveGroup(g, g.arrival!.group) : undefined;
    const mine = this.toPlace();
    const sds = this.sdToPlace();
    const done = mine.every((s) => this.draft.has(s.id)) && sds.every((d) => this.draft.has(d.id)) && (!group || group.along.kind !== 'any' || !!this.arrivalEdge);
    const ids = [...mine.map((s) => s.id), ...sds.map((d) => d.id)];
    if (!this.placingId || !ids.includes(this.placingId)) this.placingId = ids.find((id) => !this.draft.has(id)) ?? ids[0] ?? null;
    const rows = [
      ...mine.map((s) => {
        const d = this.draft.get(s.id);
        return h('div', { class: 'row-item' + (this.placingId === s.id ? ' sel' : ''), onclick: () => { this.placingId = s.id; this.selected = s.id; if (d) this.turning = s.id; this.render(); } },
          h('b', null, fullName(s)),
          h('span', null, d ? 'placed' : 'not placed'),
        );
      }),
      ...sds.map((sd) => {
        const d = this.draft.get(sd.id);
        return h('div', { class: 'row-item' + (this.placingId === sd.id ? ' sel' : ''), onclick: () => { this.placingId = sd.id; if (d) this.turning = sd.id; this.render(); } },
          h('b', null, destroyerName(sd)),
          h('span', null, d ? 'placed' : 'not placed'),
        );
      }),
    ];
    const names: Record<MapEdge, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' };
    const edges = group && group.along.kind === 'any'
      ? [h('div', { class: 'edgepick' }, h('span', null, 'Come in along the '), ...MAP_EDGES.map((edge) => h('button', { class: this.arrivalEdge === edge ? 'primary' : '', onclick: () => { this.arrivalEdge = edge; this.draft.clear(); this.placingId = null; this.render(); } }, names[edge])), h('span', null, ' edge'))]
      : [];
    const opponentPlacing = g.phase === 'setup' && !g.placed[this.aiPlayer];
    const text = arriving
      ? `Pick a ship, then click a hex in the shaded area.${group?.within !== undefined ? ` All the ships have to be within ${group.within} hexes of each other.` : ''} Turn a placed ship with the arrows beside it. Click a placed ship to bring its arrows back.`
      : `Pick a ship, then click a hex in the shaded area.${opponentPlacing ? ` ${this.net ? 'The other player places their ships' : 'The computer places its ships'} in secret.` : ''}${g.groundAttack && g.groundAttack.attacker !== this.human ? ' You don’t know yet which edge the attackers come from.' : ''} Turn a placed ship with the arrows beside it. Click a placed ship to bring its arrows back.`;
    return [
      h('h3', null, arriving ? 'Bring your ships in' : 'Place your ships'),
      h('p', null, text),
      ...edges,
      ...rows,
      h('div', { class: 'buttons' },
        h('button', { onclick: () => this.autoPlace() }, 'Auto-place'),
      ),
      h('button', { class: 'primary', disabled: !done, onclick: () => this.confirmPlacement() }, arriving ? 'Confirm' : 'Confirm placement'),
    ];
  }

  private autoPlace(): void {
    const cmd = this.ai(this.game, this.human);
    if (cmd?.type === 'place' || cmd?.type === 'arrive') {
      if (cmd.type === 'arrive') this.arrivalEdge = cmd.edge ?? this.arrivalEdge;
      for (const p of cmd.placements) this.draft.set(p.shipId, { pos: p.pos, facing: p.facing });
      sound.play('ui.place');
      this.render();
    }
  }

  private confirmPlacement(): void {
    const placements = [...this.toPlace().map((s) => s.id), ...this.sdToPlace().map((d) => d.id)].map((id) => ({ shipId: id, pos: this.draft.get(id)!.pos, facing: this.draft.get(id)!.facing }));
    const arriving = this.game.phase === 'arrival';
    const sent = arriving
      ? this.send({ type: 'arrive', player: this.human, ...(this.arrivalEdge ? { edge: this.arrivalEdge } : {}), placements })
      : this.send({ type: 'place', player: this.human, placements });
    if (sent) {
      this.draft.clear();
      this.placingId = null;
      this.turning = null;
      this.arrivalEdge = null;
      this.render();
      requestAnimationFrame(() => this.fitAll());
    }
  }

  // ---- reserves coming in (Rules: Reserves)

  /** What the owner of a reserve group decides at the start of a game-turn: bring it in now, or wait. */
  private entryPanel(): Child[] {
    const g = this.game;
    const group = g.entry ? reserveGroup(g, g.entry.group) : undefined;
    if (!group) return [];
    const ships = group.shipIds.map((id) => shipById(g, id)!).filter((s) => s.status === 'reserve');
    const rolled = group.entry.kind === 'rolled';
    const need = rollNeeded(group.attempts);
    return [
      h('h3', null, 'Bring in your reserves?'),
      h('p', null, `${ships.map(fullName).join(', ')} wait off the map.${rolled ? ` To bring them in, roll ${need} or more on one die.` : ' You may bring them in now.'} You don’t have to: you can try again at the start of any later game-turn.`),
      h('div', { class: 'buttons' },
        h('button', { class: 'primary', onclick: () => { this.send({ type: 'enter', player: this.human, enter: true }); } }, rolled ? `Roll for them (${need}+)` : 'Bring them in'),
        h('button', { onclick: () => { this.send({ type: 'enter', player: this.human, enter: false }); } }, 'Not yet'),
      ),
    ];
  }

  // ---- planning

  /** The strip under the menu: what the player has to do now. A decision the game asks for, aiming, planning (step through the ships, commit) or the move (what is left, Finish move). */
  private renderCommandBar(): void {
    const g = this.game;
    clear(this.cmdEl);
    let nodes: Child[] = [];
    const ship = this.currentHumanShip();
    if (g.pending) {
      if (g.pending.player === this.human) nodes = this.panelBar(this.decisionView(g.pending));
    }
    else if (g.phase === 'planning' && !g.planSubmitted[this.human]) nodes = [...this.planningBar(), ...(this.turretsPhase() ? this.turretRows() : [])];
    else if (ship && this.aim) {
      const view = this.aimView(ship);
      if (view) nodes = [aimPanel(view)];
    }
    else if (ship && g.active?.stage === 'move') nodes = this.panelBar(this.moveView(ship));
    else if (this.humanDestroyer()) nodes = this.panelBar(this.sdMoveView(this.humanDestroyer()!));
    else if (this.humanTargeting()) nodes = this.panelBar(this.targetingView(this.humanTargeting()!));
    this.cmdEl.hidden = nodes.length === 0;
    append(this.cmdEl, nodes);
  }

  private planningBar(): Child[] {
    const mine = activeShips(this.game, this.human);
    const done = mine.filter((s) => this.submitted.has(s.id)).length;
    const all = done === mine.length;
    const left = mine.length - done;
    return [
      h('div', { class: 'cmdrow' },
        h('b', null, 'Plan your actions'),
        h('span', { class: 'cmdlead' }, `${done} of ${mine.length} ship${mine.length === 1 ? '' : 's'} submitted`),
        h('div', { class: 'cmdbtns' },
          h('button', { onclick: () => this.stepShip(-1), title: 'Select the previous ship' }, '‹ Previous'),
          h('button', { onclick: () => this.stepShip(1), title: 'Select the next ship' }, 'Next ›'),
          h('button', { class: all ? 'primary' : '', onclick: () => this.commitClicked(), title: 'Commit the plans of all your ships' }, 'Commit'),
        ),
      ),
      this.commitAsk && !all
        ? h('div', { class: 'askcommit' },
          h('span', null, `${left === mine.length ? 'None of your ships is' : left === 1 ? '1 ship is' : `${left} ships are`} submitted yet. Commit anyway? `),
          h('button', { class: 'primary', onclick: () => this.commitPlans() }, 'Yes'),
          h('button', { onclick: () => { this.commitAsk = false; this.render(); } }, 'No'),
        )
        : null,
    ];
  }

  /** A title, the facts and the buttons in one row, with the notes (a move's turn number, for one) under them. */
  private panelBar(view: ActionPanel): Child[] {
    return [
      h('div', { class: 'cmdrow' },
        h('b', null, view.title),
        h('span', { class: 'cmdlead' }, view.lead ?? ''),
        h('div', { class: 'cmdbtns' }, ...view.buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', disabled: b.disabled, title: b.title, onclick: () => b.onClick() }, b.label))),
      ),
      ...(view.body ?? []),
    ];
  }

  private commitClicked(): void {
    const mine = activeShips(this.game, this.human);
    if (mine.every((s) => this.submitted.has(s.id))) this.commitPlans();
    else {
      this.commitAsk = true;
      this.render();
    }
  }

  /** The floating planning box: shown while the human is planning, beside the ship being planned. */
  private renderPlanBox(): void {
    const g = this.game;
    const planning = g.phase === 'planning' && !g.planSubmitted[this.human];
    const mine = planning ? activeShips(g, this.human) : [];
    if (planning && (!this.planShip || !mine.some((s) => s.id === this.planShip))) {
      this.planShip = mine[0]!.id;
      this.selected = this.planShip;
      this.planNonce += 1;
      this.planManual = null;
    }
    for (const s of mine) this.plans[s.id] ??= emptyPlan();
    // a ship that is submitted has no box: the board offers to keep or reopen its plan instead
    const show = planning && !this.submitted.has(this.planShip!) && !this.turretSel;
    this.planEl.hidden = !show;
    if (!show) {
      clear(this.planEl);
      return;
    }
    const ship = shipById(g, this.planShip!)!;
    const crew = crewOf(ship);
    if (!crew.some((c) => c.id === this.planCrew && c.kind !== 'r2' && !c.dead)) this.planCrew = 'pilot';
    const crewId = this.planCrew;
    const gunnerPlans = this.gunnerPlans(ship);
    const plan = this.planFor(ship, crewId);
    // a gunner's plan has no forced markers: those are the ship's own
    const eff = crewId === 'pilot' ? effectivePlan(ship, plan) : plan;
    // one tracked target and one shield mover for the whole ship (Rules: Gunners and turrets)
    const others = [this.plans[ship.id]!, ...gunnerPlans].filter((p) => p !== plan);
    clear(this.planEl);
    this.planEl.append(buildPlanBox({
      ship,
      crew: crew.map((member) => ({ member, planned: this.hasPlanned(ship, member) })),
      crewId,
      allowed: plannableActions(ship, crewId),
      lockedTarget: others.find((p) => p.targeting > 0 && p.targetingTarget)?.targetingTarget ?? null,
      shieldsTaken: others.some((p) => p.angleDeflectors > 0),
      wideShields: hasSideQuarters(g, ship),
      onCrew: (id) => this.pickCrew(id),
      plan,
      effective: eff,
      tailed: trackableTargets(g, ship, crewId),
      // only those the ship could shoot at this turn: ten hexes (a torpedo) beyond what it flies, nearest first
      groundTargets: trackableEmplacements(g, ship, crewId)
        .map((t) => ({ id: t.id, range: hexDistance(ship.pos!, t.pos), name: this.emplacementName(t) }))
        .filter((t) => t.range <= ship.speed + 10)
        .sort((a, b) => a.range - b.range)
        .map((t) => ({ id: t.id, label: `${t.name} (range ${t.range})` })),
      hasGuns: crewGuns(ship, crewId).length > 0,
      summary: this.planSummary(ship, crewId, plan, eff),
      ...(g.damageRules ? { power: this.powerContext(ship, crewId, plan) } : {}),
      onChange: () => this.render(),
      onClear: () => { this.freeMode = false; this.clearPlan(ship, crewId); this.render(); },
      onSubmit: () => this.submitShip(ship.id),
      onAutoPlace: () => { this.planManual = null; this.planNonce += 1; this.render(); },
      targetName: fullName,
    }));
    this.placePlanBox(ship);
  }

  /** Puts the planning box where the player left it, or where it hides the fewest ships. */
  private placePlanBox(ship: Ship): void {
    const el = this.planEl;
    const view = this.board.size();
    const box = { w: el.offsetWidth, h: el.offsetHeight };
    const fit = (p: { x: number; y: number }) => ({
      x: Math.max(4, Math.min(p.x, view.w - box.w - 4)),
      y: Math.max(4, Math.min(p.y, view.h - box.h - 4)),
    });
    let pos: { x: number; y: number };
    if (this.planManual) pos = fit(this.planManual);
    else {
      // chosen once, when a ship is selected: a changed plan (a taller box, another crew member) or a moved board leaves it where it is
      const key = `${ship.id}|${this.planNonce}`;
      if (key !== this.planAutoKey) {
        this.planAutoKey = key;
        const disc = (s: Ship) => { const p = this.board.screenOf(s.pos!); return { x: p.x, y: p.y, r: p.r * 1.4 }; };
        this.planAuto = choosePanelSpot(view, box, disc(ship), activeShips(this.game).filter((s) => s.pos).map(disc), 8, this.arcDiscs(ship));
      }
      pos = fit(this.planAuto);
    }
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  }

  /** The hexes of the ship's forward firing arc, as discs on the screen: the planning box keeps off them when it can. */
  private arcDiscs(ship: Ship): { x: number; y: number; r: number }[] {
    const seen = new Map<string, Hex>([[hexId(ship.pos!), ship.pos!]]);
    let ring: Hex[] = [ship.pos!];
    for (let range = 1; range <= 5; range++) {
      const next: Hex[] = [];
      for (const hex of ring) {
        for (let f = 0; f < 6; f++) {
          const n = neighbor(hex, f);
          if (!seen.has(hexId(n))) {
            seen.set(hexId(n), n);
            next.push(n);
          }
        }
      }
      ring = next;
    }
    return [...seen.values()]
      .filter((hex) => !hexEquals(hex, ship.pos!) && arcOf(ship.pos!, ship.facing, hex) === 'FC')
      .map((hex) => { const p = this.board.screenOf(hex); return { x: p.x, y: p.y, r: p.r * 0.9 }; });
  }

  /** Lets the player drag the planning box by its title. */
  private enablePlanDrag(): void {
    let drag: { x: number; y: number; left: number; top: number; id: number } | null = null;
    const el = this.planEl;
    el.addEventListener('pointerdown', (e) => {
      const target = e.target as Element;
      if (!target.closest('.pbhead') || target.closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const view = this.board.size();
      this.planManual = {
        x: Math.max(4, Math.min(drag.left + e.clientX - drag.x, view.w - el.offsetWidth - 4)),
        y: Math.max(4, Math.min(drag.top + e.clientY - drag.y, view.h - el.offsetHeight - 4)),
      };
      el.style.left = `${this.planManual.x}px`;
      el.style.top = `${this.planManual.y}px`;
    });
    const end = (): void => {
      drag = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** What the planning box needs to know about the R2, auxiliary power and damage control rules for the crew member being planned. */
  private powerContext(ship: Ship, crewId: string, plan: Plan): PowerContext {
    const type = typeOf(ship);
    const plans = [this.plans[ship.id] ?? emptyPlan(), ...this.gunnerPlans(ship)];
    const r2 = !type.r2 ? 'none' : !ship.r2?.aboard ? 'lost' : ship.r2.ready ? 'ready' : 'busy';
    const aux = type.r2 || !type.auxPower ? null : (ship.aux ?? 0) - auxSpent(plans[0]!);
    return {
      repairs: repairOptions(ship),
      describe: (choice) => describeRepairChoice(ship, choice),
      repairTaken: plans.some((p) => p !== plan && p.damageControl > 0),
      r2,
      r2Free: !plans.some((p) => PAY_GROUPS.some((g) => freeSteps(p, g) > 0)),
      aux,
      pilot: crewId === 'pilot',
      armed: this.freeMode,
      onArm: () => { this.freeMode = !this.freeMode; this.render(); },
    };
  }

  /** The gunners' plans of a ship being planned, one for each seat, made when first needed. */
  private gunnerPlans(ship: Ship): Plan[] {
    const list = (this.crewPlans[ship.id] ??= []);
    (ship.gunners ?? []).forEach((_, i) => { list[i] ??= emptyPlan(); });
    return list;
  }

  /** The plan being drawn up for one crew member. */
  private planFor(ship: Ship, crew: string): Plan {
    if (crew === 'pilot') return this.plans[ship.id] ??= emptyPlan();
    return this.gunnerPlans(ship)[Number(crew.slice('gunner'.length)) - 1]!;
  }

  private clearPlan(ship: Ship, crew: string): void {
    if (crew === 'pilot') this.plans[ship.id] = emptyPlan();
    else this.gunnerPlans(ship)[Number(crew.slice('gunner'.length)) - 1] = emptyPlan();
  }

  /** Has this crew member planned anything? */
  private hasPlanned(ship: Ship, member: CrewMember): boolean {
    if (member.kind === 'r2') return false;
    const plan = this.planFor(ship, member.id);
    return PLAN_ACTIONS.some((a) => plan[a] > 0) || (member.id === 'pilot' && (ship.forcedRoll > 0 || ship.forcedOverspeed > 0));
  }

  /** Switches the planning box to another crew member of the ship being planned. */
  private pickCrew(id: string): void {
    this.planCrew = id;
    this.freeMode = false;
    this.render();
  }

  /** What the plan adds up to: speed and turn number, the total difficulty, and the odds of a hazard. */
  private planSummary(ship: Ship, crewId: string, plan: Plan, eff: Plan): Child[] {
    const g = this.game;
    const type = typeOf(ship);
    const { total, none, noFull } = hazardOdds(ship, crewId, eff);
    const skill = hazardSkill(ship, crewId);
    const isPilot = crewId === 'pilot';
    // the turn number is the pilot's: always worked out from his plan
    const pilotEff = effectivePlan(ship, this.plans[ship.id] ?? emptyPlan());
    const plannedTurn = turnBreakdownAt(ship, pilotEff, speedAfterMarkers(ship, pilotEff));

    // where the total comes from: each planned action, plus damage markers and forced actions
    const term = (label: string, value: number, note = ''): Child[] => [`${label}${note} (`, h('span', { class: 'bdnum' }, String(value)), ')'];
    const breakdown: Child[][] = [];
    for (const key of ACTION_ORDER) {
      const level = eff[key];
      const d = type.difficulty[key];
      if (level > 0 && d !== null) {
        const forced = (key === 'roll' && ship.forcedRoll > 0) || (key === 'overspeed' && ship.forcedOverspeed > 0);
        const group = GROUP_OF[key];
        const free = freeSteps(eff, group);
        const steps = groupLevel(eff, group);
        breakdown.push(term(`${ACTION_INFO[key].label}${level === 2 ? ' ×2' : ''}`, groupDifficulty(eff, group, type.difficulty), forced ? ' forced' : free > 0 ? (free === steps ? ' free' : ` ${free} of ${steps} steps free`) : ''));
      }
    }
    if (ship.stabilizerDamage) breakdown.push(term('Stabilizer damage', type.difficulty.stabilizer * ship.stabilizerDamage));
    if (ship.actionPenalty) breakdown.push(term('Action penalty', ship.actionPenalty * 3));

    // the other crew members' risks, so that the whole ship can be judged without switching
    const crew = crewOf(ship);
    const rolls = pilotEff.roll > 0;
    const hasGunner = (ship.gunners ?? []).some((x) => !x.dead);
    const others = crew.filter((c) => c.id !== crewId && c.kind !== 'r2' && !c.dead && this.hasPlanned(ship, c)).map((c) => {
      const o = hazardOdds(ship, c.id, c.id === 'pilot' ? pilotEff : this.planFor(ship, c.id));
      return h('div', { class: 'crewodds' }, `${c.label}: difficulty ${o.total}, no hazard ${percent(o.none)}`);
    });
    return [
      isPilot ? h('div', { class: 'motion' }, motionText(motionOf(g, ship, plan))) : null,
      isPilot && g.damageRules && !type.r2 && type.auxPower ? h('div', { class: 'auxline' }, `Auxiliary power: ${(ship.aux ?? 0) - auxSpent(plan)} of ${ship.aux ?? 0} units left after this plan`) : null,
      rolls && hasGunner ? h('div', { class: 'warnline' }, 'This ship rolls, so its gunners can’t fire this game-turn. The pilot fires the turrets.') : null,
      isPilot ? h('details', { class: 'turnwhy', open: this.turnWhyOpen, ontoggle: (e: Event) => { this.turnWhyOpen = (e.target as HTMLDetailsElement).open; } },
        h('summary', null, 'How the planned turn number is made up'),
        h('div', { class: 'breakdown shot' }, ...plannedTurn.parts.map((p, n) => partRow(p, n === 0))),
      ) : null,
      type.shields !== null && eff.angleDeflectors > 0 ? h('div', { class: 'shieldline' }, shieldText(ship, eff, hasSideQuarters(g, ship))) : null,
      h('div', { class: 'totalline' }, 'Total difficulty ', h('b', null, String(total)), ` — ${isPilot ? 'pilot' : (crewOf(ship).find((c) => c.id === crewId)?.label ?? 'gunner').toLowerCase()} rolls ${skillText(skill)} (average ${Math.round(3.5 * skill.dice + skill.pips)})`),
      breakdown.length ? h('div', { class: 'breakdown' }, ...breakdown.flatMap((t, i) => (i === 0 ? t : [' + ', ...t]))) : null,
      h('div', { class: 'riskbar', title: 'Chance of no hazard, a minor hazard, or a full hazard. Every full 5 points you miss by is one hazard; a smaller miss is a minor hazard.' },
        h('span', { class: 'safe', style: { width: `${none * 100}%` } }),
        h('span', { class: 'minor', style: { width: `${(noFull - none) * 100}%` } }),
        h('span', { class: 'major', style: { width: `${(1 - noFull) * 100}%` } }),
      ),
      h('div', { class: 'odds' }, `No hazard ${percent(none)} · minor ${percent(noFull - none)} · full or worse ${percent(1 - noFull)}`),
      ...others,
    ];
  }

  /** Sends the plans of all ships to the game; ships that were not submitted go as they stand. */
  private commitPlans(turretsSent = false): void {
    // the orders to the turret guns go first (Rules: Ground attack): they take effect when both sides have planned
    if (!turretsSent && this.turretsPhase() && this.turretDraft.size > 0) {
      if (!this.send({ type: 'turrets', player: this.human, orders: this.turretOrdersToSend() })) return;
      // over the network one command goes at a time: the plans follow when the host has taken the orders (see processUpdates)
      if (this.net) {
        this.commitAfterTurrets = true;
        return;
      }
    }
    const mine = activeShips(this.game, this.human);
    const plans: Record<string, Plan> = {};
    for (const s of mine) {
      const p = normalisePlan(this.plans[s.id] ?? emptyPlan());
      if (p.targeting > 0 && !p.targetingTarget) p.targetingTarget = activeShips(this.game).find((e) => tails(s, e))?.id ?? trackableEmplacements(this.game, s, PILOT)[0]?.id ?? null;
      plans[s.id] = p;
    }
    const crewPlans: Record<string, Plan[]> = {};
    for (const s of mine) {
      if (!s.gunners?.length) continue;
      crewPlans[s.id] = this.gunnerPlans(s).map((p, i) => {
        const copy = normalisePlan(p);
        if (copy.targeting > 0 && !copy.targetingTarget) copy.targetingTarget = trackableTargets(this.game, s, gunnerCrewId(i))[0]?.id ?? trackableEmplacements(this.game, s, gunnerCrewId(i))[0]?.id ?? null;
        return s.gunners![i]!.dead ? emptyPlan() : copy;
      });
    }
    if (this.send({ type: 'plan', player: this.human, plans, crewPlans })) {
      this.plans = {};
      this.crewPlans = {};
      this.planCrew = 'pilot';
      this.planShip = null;
      this.submitted.clear();
      this.confirming = null;
      this.commitAsk = false;
    }
  }

  // ---- decisions

  /** What the game asks the human to decide, as a panel for the ship window (the decision is about that ship). */
  private decisionView(p: Pending): ActionPanel {
    const g = this.game;
    const decide = (choice: string | number | null) => this.send({ type: 'decide', player: this.human, choice });
    switch (p.kind) {
      case 'lose': {
        const ship = shipById(g, p.shipId)!;
        const who = p.crew ? `${fullName(ship)} ${crewOf(ship).find((c) => c.id === p.crew)?.label.toLowerCase() ?? ''}` : fullName(ship);
        return {
          title: 'Lose an action',
          lead: `${who} must lose one of its planned row ${p.letter} actions. Which one?`,
          buttons: p.options.map((o) => ({ label: ACTION_INFO[o as PlanAction]?.label ?? o, onClick: () => decide(o) })),
        };
      }
      case 'skill': {
        const ship = shipById(g, p.shipId)!;
        return {
          title: 'Crew injury',
          lead: `One crew member of ${fullName(ship)} is hurt and loses 1 from their skill. Who is it?`,
          buttons: p.options.map((o) => ({ label: crewOf(ship).find((c) => c.id === o)?.label ?? o, onClick: () => decide(o) })),
        };
      }
      case 'gun': {
        const ship = shipById(g, p.shipId)!;
        return {
          title: 'Gun damage',
          lead: `${fullName(ship)} suffers gun damage. Which gun is damaged?`,
          buttons: p.options.map((i) => ({ label: `Gun ${i + 1}: ${ship.guns[i]}`, onClick: () => decide(i) })),
        };
      }
      case 'power': {
        const ship = shipById(g, p.shipId)!;
        const names: Record<PowerLoss, string> = { shield: `A ${p.box} shield`, aux: `A unit of auxiliary power (${ship.aux ?? 0} left)`, r2: 'Its R2 unit', body: '1 body damage' };
        return {
          title: 'Power loss',
          lead: `${fullName(ship)} loses power${p.left > 1 ? ` (${p.left} times)` : ''}. What does it give up?`,
          buttons: p.options.map((o) => ({ label: names[o], onClick: () => decide(o) })),
        };
      }
      case 'steal': {
        const target = shipById(g, p.target)!;
        return {
          title: 'Steal the move?',
          lead: `${fullName(target)} is about to move. One of your ships is tailing it, so you can move first.`,
          buttons: [
            ...p.candidates.map((id) => ({ label: `Steal with ${fullName(shipById(g, id)!)}`, onClick: () => decide(id) })),
            { label: 'No, let it move', onClick: () => decide(null) },
          ],
        };
      }
      case 'follow': {
        const ship = shipById(g, p.ship)!;
        const leader = shipById(g, p.leader)!;
        return {
          title: 'Before or after?',
          lead: `${fullName(leader)} is about to move, and ${fullName(ship)} moves together with it. If ${shortName(ship)} moves first, it keeps its tailing position for a shot. If it moves after ${shortName(leader)}, it can follow it.`,
          buttons: [
            { label: `${shortName(ship)} moves before ${shortName(leader)}`, primary: true, onClick: () => decide('before') },
            { label: `${shortName(ship)} moves after ${shortName(leader)}`, onClick: () => decide('after') },
          ],
        };
      }
      case 'pass': {
        return {
          title: 'Pass the move?',
          lead: 'The enemy chose one of your ships, and it is tailing one of their ships. You can pass: their ship moves first, and yours follows right after.',
          buttons: [
            ...p.candidates.map((id) => ({ label: `Let ${fullName(shipById(g, id)!)} move first`, onClick: () => decide(id) })),
            { label: 'No, move my ship now', onClick: () => decide(null) },
          ],
        };
      }
    }
  }

  // ---- choosing a ship

  /** Is it the human's turn to choose which ship moves next? The choice is made in the list of ships or on the board. */
  private choosing(): boolean {
    const g = this.game;
    return g.phase === 'ships' && !g.advancedInitiative && !g.active && !g.pending && g.chooser === this.human;
  }

  private chooseShip(id: string): void {
    this.send({ type: 'chooseShip', player: this.human, shipId: id });
  }

  private onChooseClick(): void {
    if (this.animating) {
      clock.skip = true;
      return;
    }
    if (this.selected && this.choosing()) this.chooseShip(this.selected);
  }

  // ---- movement

  /** The ship window's panel for a move: what is left, what is required, and the Finish move button. */
  private moveView(ship: Ship): ActionPanel {
    const g = this.game;
    const sim = simulate(g, ship, this.moveSteps);
    const body: Child[] = [];
    const turn = turnBreakdownAt(ship, ship.plan, ship.speed);
    body.push(h('details', { class: 'turnwhy', open: this.turnWhyOpen, ontoggle: (e: Event) => { this.turnWhyOpen = (e.target as HTMLDetailsElement).open; } },
      h('summary', null, `Turn number ${fmtTurn(turn.total)}: how it is made up`),
      h('div', { class: 'breakdown shot' },
        ...turn.parts.map((p, n) => partRow(p, n === 0)),
        h('div', { class: 'bdnote' }, 'You can turn one hex side after moving this many hexes forward (slips count). With turn number ½ you can turn two hex sides after every hex.'),
      ),
    ));
    if (sim.slipRequired) body.push(h('p', { class: 'note' }, 'You planned a slip. It must last at least as many hexes as your turn number.'));
    if (sim.loopsLeft > 0) body.push(h('p', { class: 'note' }, `You planned a half loop. Move ${Math.max(1, Math.ceil(sim.turnNumber))} hexes forward first; the loop then uses one hex of movement (${sim.loopsLeft} to go).`));
    if (sim.path.some((p) => leavesMap(g, ship, p))) body.push(h('p', { class: 'error' }, 'This path takes the ship off the map or too far from the rest of the fleet. It would escape and leave the game.'));
    if (sim.waived.length) body.push(h('p', { class: 'note' }, `Not required this turn: ${sim.waived.map((w) => (w === 'halfLoop' ? 'half loop' : w)).join(', ')} (there’s no legal way to do it).`));
    if (this.moveSteps.length > 0) body.push(h('p', { class: 'path' }, `Path: ${this.moveSteps.map((s) => stepLabel(s.kind)).join(' ')}`));
    return {
      title: `Move · ${sim.budget} hex${sim.budget === 1 ? '' : 'es'} left`,
      lead: `Speed ${sim.speed} · turn number ${fmtTurn(sim.turnNumber)} · ${sim.speed === 0 ? 'may turn freely' : sim.canTurn ? 'may turn now' : 'can’t turn yet'}`,
      buttons: [{
        label: sim.complete ? 'Finish move' : `Finish move (${sim.budget} hex${sim.budget === 1 ? '' : 'es'} left)`,
        primary: true,
        disabled: !sim.complete,
        onClick: () => { this.send({ type: 'move', player: this.human, shipId: ship.id, steps: this.moveSteps }); },
      }],
      body,
    };
  }

  // ---- fire

  // ---- aiming (Rules: Gunners and turrets)

  /** The ship as it will shoot: where the ghost stands during a move (with the turrets already used by earlier snap shots), else where it stands. */
  private aimProbe(ship: Ship, kind: AimKind): Ship {
    if (kind === 'fire') return ship;
    const sim = simulate(this.game, ship, this.moveSteps);
    const claims: Record<number, string> = { ...(ship.turretClaims ?? {}) };
    const type = typeOf(ship);
    // a snap shot with missiles or torpedoes uses projectiles up, and none may be fired from a hex the ship has turned in (Rules: Missiles, torpedoes and bombs)
    let spent = 0;
    let turned = false;
    for (const step of this.moveSteps) {
      if (step.kind !== 'snapFire') {
        turned = step.kind === 'turnLeft' || step.kind === 'turnRight' ? true : step.kind === 'forward' || step.kind === 'slipLeft' || step.kind === 'slipRight' || step.kind === 'halfLoop' ? false : turned;
        continue;
      }
      for (const shot of step.shots) {
        if (shot.gun === SPECIAL) spent += shot.tubes ?? 1;
        else if (!gunSlot(type, shot.gun).own) claims[shot.gun] = shot.crew ?? PILOT;
      }
    }
    return { ...ship, pos: sim.pos, facing: sim.facing, turretClaims: claims, turnedInLastHex: turned, ...(ship.projectiles !== undefined ? { projectiles: ship.projectiles - spent } : {}) };
  }

  /** Does a ship reach beyond the five hexes of its guns with missiles or torpedoes (Rules: Missiles, torpedoes and bombs)? Then the board outlines the ten hexes. */
  private farArc(ship: Ship): boolean {
    const weapon = specialFor(this.game, ship);
    return !!weapon && weapon.kind !== 'CB';
  }

  /** Warning signs for the asteroid hexes a ship crosses on its planned path, and for those it could step into next, with the chance of the piloting roll (Rules: Asteroid fields). */
  private rockWarnings(ship: Ship, path: Hex[], next: Hex[]): NonNullable<Overlay['rockWarnings']> {
    const field = this.game.asteroids;
    const out: NonNullable<Overlay['rockWarnings']> = [];
    if (!field) return out;
    const seen = new Set<string>();
    const add = (hex: Hex, ahead: boolean): void => {
      const key = `${hex.q},${hex.r}`;
      const rock = rockAt(field, hex);
      if (!rock || seen.has(key)) return;
      seen.add(key);
      // the difficulty is 3 for every hex of the asteroid, with the actions the ship is flying
      const chance = chanceAtLeast(ship.pilotSkill, 0, asteroidDifficulty(ship, rock.hexes.length));
      out.push({ hex, chance, label: percent(chance), ahead });
    };
    for (const hex of path.slice(1)) add(hex, false);
    for (const hex of next) add(hex, true);
    return out;
  }

  /** Who has snap fired already in this move. */
  private snappedCrews(): Set<string> {
    const done = new Set<string>();
    for (const step of this.moveSteps) if (step.kind === 'snapFire') for (const shot of step.shots) done.add(shot.crew ?? PILOT);
    return done;
  }

  /** Why nobody can snap fire from here, for the tooltips: the rules for the pause (Rules: Movement) are easy to run into without noticing. */
  private snapBlock(ship: Ship): string | null {
    if (this.aimCrews('snap', ship).length > 0) return null;
    const planned = [PILOT, ...livingGunners(ship).map(gunnerCrewId)].filter((c) => planOf(ship, c).snapFire > 0 && canCrewFire(ship, c));
    if (planned.length === 0) return 'Nobody planned snap fire.';
    if (planned.every((c) => this.snappedCrews().has(c))) return 'Everyone who planned snap fire has used it.';
    const sim = simulate(this.game, ship, this.moveSteps);
    if (this.moveSteps.length === 0 || sim.path.length < 2) return 'Snap fire isn’t possible from the hex where the move starts.';
    if (this.moveSteps[this.moveSteps.length - 1]!.kind === 'snapFire') return 'Move at least one hex before the next snap fire.';
    if (sim.budget < 1) return 'Snap fire isn’t possible from the hex where the move ends.';
    if (!sim.legal.includes('snapFire')) return 'Snap fire isn’t possible here.';
    return 'No enemy ship is within reach of these guns from here.';
  }

  private enemiesOf(ship: Ship): Ship[] {
    return this.game.ships.filter((s) => s.status === 'active' && s.owner !== ship.owner && s.pos);
  }

  /** The crew members who may aim now (snap fire in the move, or the Fire Segment), with the guns that are theirs to use and can reach an enemy. */
  private aimCrews(kind: AimKind, ship: Ship): { id: string; ready: number[] }[] {
    // a snap shot is only possible where the move allows a pause (not in the hex it starts in, nor where it ends)
    if (kind === 'snap' && !simulate(this.game, ship, this.moveSteps).legal.includes('snapFire')) return [];
    const probe = this.aimProbe(ship, kind);
    const snapped = this.snappedCrews();
    const candidates = kind === 'fire'
      ? endFireCrew(ship)
      : [PILOT, ...livingGunners(ship).map(gunnerCrewId)].filter((c) => planOf(ship, c).snapFire > 0 && canCrewFire(ship, c) && !snapped.has(c));
    const enemies = this.enemiesOf(ship);
    const emplacements = this.enemyEmplacements(ship);
    const sdTargets = this.enemyDestroyers(ship);
    const out: { id: string; ready: number[] }[] = [];
    for (const id of candidates) {
      const usable = crewGunStatus(probe, id).filter((s) => s.state === 'ready' || s.state === 'reserved');
      // asteroids in reach count too (Rules: Asteroid fields), when the player wants them offered
      const rocks = this.shootRocks ? this.game.asteroids?.rocks ?? [] : [];
      const reaching = usable.filter((s) => enemies.some((t) => gunReaches(probe, s.gun, id, probe.pos!, probe.facing, t.pos!)) || rocks.some((r) => rockHexInReach(this.game, probe, s.gun, id, r, probe.pos, probe.facing) !== null) || emplacements.some((t) => emplacementInReach(this.game, probe, s.gun, id, t, probe.pos, probe.facing)) || sdTargets.some((t) => destroyerHexInReach(this.game, probe, s.gun, id, t, probe.pos, probe.facing) !== null));
      const special = enemies.some((t) => this.aimReaches(probe, id, SPECIAL, t)) || rocks.some((r) => rockHexInReach(this.game, probe, SPECIAL, id, r, probe.pos, probe.facing) !== null) || emplacements.some((t) => emplacementInReach(this.game, probe, SPECIAL, id, t, probe.pos, probe.facing)) || sdTargets.some((t) => destroyerHexInReach(this.game, probe, SPECIAL, id, t, probe.pos, probe.facing) !== null);
      // a crew member with one gun to choose from has it switched on; with several, they all start off and are armed one by one
      const ready = reaching.filter((s) => s.state === 'ready').map((s) => s.gun);
      if (reaching.length > 0 || special) out.push({ id, ready: ready.length === 1 ? ready : [] });
    }
    return out;
  }

  /** Starts a session for the Fire Segment when it is the human's turn to fire, and closes one that no longer fits. */
  private ensureAim(): void {
    const g = this.game;
    const ship = this.currentHumanShip();
    const stage = g.active?.stage;
    if (!ship || !stage) {
      this.aim = null;
      return;
    }
    if (stage === 'move') {
      if (this.aim && (this.aim.kind !== 'snap' || this.aim.shipId !== ship.id)) this.aim = null;
      return;
    }
    if (this.aim?.kind === 'fire' && this.aim.shipId === ship.id && this.aimTurn === g.turn) return;
    const crews = this.aimCrews('fire', ship);
    if (crews.length === 0) {
      // nobody has a gun that reaches an enemy (the engine also counts friendly ships in reach): there is nothing to choose, the Fire Segment passes
      this.aim = null;
      this.skipFire(ship);
      return;
    }
    this.aim = this.autoAim(newAim('fire', ship.id, crews, PILOT), ship);
    this.aimTurn = g.turn;
    this.aimDetail = null;
  }

  /** Ends the Fire Segment of a ship that has no enemy to shoot at, without asking the player. */
  private skipFire(ship: Ship): void {
    const key = `${ship.id}|${this.game.turn}`;
    // render() runs again whenever the screen changes: the command is sent once, after this drawing is finished
    if (this.skippedFire === key) return;
    this.skippedFire = key;
    setTimeout(() => {
      if (this.currentHumanShip()?.id !== ship.id || this.game.active?.stage !== 'fire') return;
      // a move or a playback still running: try again at the next drawing
      if (!this.send({ type: 'fire', player: this.human, shipId: ship.id, shots: [] }) && this.animating) this.skippedFire = '';
    }, 0);
  }

  /** With a single enemy in reach there is nothing to choose: the armed guns are aimed at it at once. */
  private autoAim(session: AimSession, ship: Ship): AimSession {
    const probe = this.aimProbe(ship, session.kind);
    const enemies = this.enemiesOf(ship);
    let a = session;
    for (const crew of a.crews) {
      const guns = selectedGuns(a, crew);
      const reachable = enemies.filter((t) => guns.some((g) => gunReaches(probe, g, crew, probe.pos!, probe.facing, t.pos!)));
      if (reachable.length === 1) a = aimAt(a, crew, reachable[0]!.id, (g) => gunReaches(probe, g, crew, probe.pos!, probe.facing, reachable[0]!.pos!));
    }
    return a;
  }

  private openSnap(crew?: string): void {
    const ship = this.currentHumanShip();
    if (!ship || this.game.active?.stage !== 'move') return;
    const crews = this.aimCrews('snap', ship);
    if (crews.length === 0) return;
    this.aim = this.autoAim(newAim('snap', ship.id, crews, crew ?? crews[0]!.id), ship);
    this.aimDetail = null;
    this.render();
  }

  private aimPickCrew(crew: string): void {
    const ship = this.currentHumanShip();
    if (!ship) return;
    if (!this.aim && this.game.active?.stage === 'move') {
      this.openSnap(crew);
      return;
    }
    if (this.aim) this.aim = selectCrew(this.aim, crew);
    this.render();
  }

  private aimToggle(gun: number): void {
    const ship = this.currentHumanShip();
    const a = this.aim;
    if (!ship || !a) return;
    const crew = a.active;
    let next = toggleGun(a, crew, gun);
    // the missiles and torpedoes start with every tube, and are not switched on until asked for
    if (gun === SPECIAL && gunAim(a, crew, gun) === 'off' && gunAim(next, crew, gun) === 'armed') {
      const weapon = specialFor(this.game, this.aimProbe(ship, a.kind));
      if (weapon) next = setTubes(next, crew, weapon.tubes);
    }
    // a gun that has just been switched on joins the others' target, or the only enemy in reach, so that it does not need its own click
    if (gunAim(a, crew, gun) === 'off' && gunAim(next, crew, gun) === 'armed') {
      const probe = this.aimProbe(ship, a.kind);
      const reach = (t: Ship): boolean => this.aimReaches(probe, crew, gun, t);
      const others = new Set(selectedGuns(next, crew).filter((g) => g !== gun).map((g) => next.per[crew]!.guns[g]));
      const shared = others.size === 1 ? [...others][0] : null;
      const sharedShip = shared ? shipById(this.game, shared) : undefined;
      const inReach = this.enemiesOf(ship).filter(reach);
      const pick = sharedShip && reach(sharedShip) ? sharedShip : inReach.length === 1 ? inReach[0] : undefined;
      if (pick) next = aimAt(next, crew, pick.id, (g) => g === gun);
    }
    this.aim = next;
    this.render();
  }

  private aimTubes(count: number): void {
    if (this.aim) this.aim = setTubes(this.aim, this.aim.active, count);
    this.render();
  }

  private aimSwitchOff(gun: number): void {
    if (this.aim) this.aim = switchOff(this.aim, this.aim.active, gun);
    this.render();
  }

  /** Does this gun of the crew member reach this ship from where the ship shoots? */
  private aimReaches(probe: Ship, crew: string, gun: number, target: Ship): boolean {
    if (gun === SPECIAL) {
      const weapon = crew === PILOT ? specialFor(this.game, probe) : null;
      return !!weapon && !probe.turnedInLastHex && !!probe.pos && specialMayHit(weapon.kind, probe.pos, probe.facing, target);
    }
    return gunReaches(probe, gun, crew, probe.pos!, probe.facing, target.pos!);
  }

  /** The ships the active crew member's switched-on guns can reach. */
  private aimTargetIds(): string[] {
    const ship = this.currentHumanShip();
    const a = this.aim;
    if (!ship || !a || a.per[a.active]!.done) return [];
    const probe = this.aimProbe(ship, a.kind);
    const guns = selectedGuns(a, a.active);
    return this.enemiesOf(ship).filter((t) => guns.some((g) => this.aimReaches(probe, a.active, g, t))).map((t) => t.id);
  }

  private aimTarget(id: string): void {
    const ship = this.currentHumanShip();
    const a = this.aim;
    if (!ship || !a) return;
    const probe = this.aimProbe(ship, a.kind);
    const target = shipById(this.game, id);
    if (!target) return;
    this.aim = aimAt(a, a.active, id, (g) => this.aimReaches(probe, a.active, g, target));
    this.render();
  }

  /** The asteroids the active crew member's switched-on guns can reach. */
  private aimRockIds(): number[] {
    const ship = this.currentHumanShip();
    const a = this.aim;
    const field = this.game.asteroids;
    if (!ship || !a || !field || !this.shootRocks || a.per[a.active]!.done) return [];
    const probe = this.aimProbe(ship, a.kind);
    const guns = selectedGuns(a, a.active);
    return field.rocks.filter((r) => guns.some((g) => rockHexInReach(this.game, probe, g, a.active, r, probe.pos, probe.facing) !== null)).map((r) => r.id);
  }

  private aimRock(id: number): void {
    const ship = this.currentHumanShip();
    const a = this.aim;
    const rock = this.game.asteroids?.rocks.find((r) => r.id === id);
    if (!ship || !a || !rock) return;
    const probe = this.aimProbe(ship, a.kind);
    this.aim = aimAt(a, a.active, rockTargetId(id), (g) => rockHexInReach(this.game, probe, g, a.active, rock, probe.pos, probe.facing) !== null);
    this.render();
  }

  /** The chance to hit an asteroid with a gun (Rules: Asteroid fields), with the dice the crew member's switched-on guns leave (Rules: Fire). */
  private rockOdds(probe: Ship, crew: string, gun: number, rock: Rock, switchedOn: number): { chance: number; preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number } {
    const preview = previewRockShot(this.game, probe, gun, rock, crew, probe.pos, probe.facing);
    const seat = seatOf(crew);
    const skill = seat === null ? probe.gunnerySkill : probe.gunners![seat]!.skill;
    const penalty = Math.max(0, switchedOn - 1);
    return { chance: chanceAtLeast(skill, penalty, preview.difficulty), preview, skill, penalty };
  }

  /** The chance to hit and the difficulty of one gun against one target, with the dice the crew member's switched-on guns leave (Rules: Fire). */
  private aimOdds(probe: Ship, crew: string, gun: number, target: Ship, switchedOn: number): { chance: number; preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number } {
    const preview = gun === SPECIAL ? previewSpecial(this.game, probe, target) : previewShot(this.game, probe, gun, target, crew);
    const seat = seatOf(crew);
    const skill = seat === null ? probe.gunnerySkill : probe.gunners![seat]!.skill;
    const penalty = Math.max(0, switchedOn - 1);
    return { chance: chanceAtLeast(skill, penalty, preview.difficulty), preview, skill, penalty };
  }

  /** The gun whose chance a target's card and label show: the one aimed at it, else a gun before the special weapon. */
  private oddsGun(probe: Ship, crew: string, selected: number[], t: Ship): number | undefined {
    const reach = (g: number): boolean => this.aimReaches(probe, crew, g, t);
    const aimed = selected.find((g) => this.aim?.per[crew]?.guns[g] === t.id && reach(g));
    return aimed ?? selected.filter((g) => g !== SPECIAL).find(reach) ?? selected.find(reach);
  }

  /** What a gun is called in the lists: its code, or the kind of the special weapon with the tubes that fire. */
  private gunLabel(probe: Ship, gun: number, crew: string): string {
    if (gun !== SPECIAL) return probe.guns[gun]!;
    const weapon = specialOf(typeOf(probe));
    const tubes = this.aim?.per[crew]?.tubes ?? 1;
    return `${weapon?.kind ?? 'PT'}${tubes > 1 ? ` ×${tubes}` : ''}`;
  }

  /** What the board shows while aiming: the targets in reach with their chances, and those a gun is aimed at. */
  private aimOverlay(ship: Ship): Pick<Overlay, 'targets' | 'targetLabels' | 'aimed' | 'rockTargets' | 'rockLabels' | 'rockAimed' | 'turretTargets' | 'turretLabels' | 'turretAimed' | 'destroyerTargets' | 'destroyerLabels' | 'destroyerAimed'> {
    const a = this.aim;
    if (!a) return {};
    const probe = this.aimProbe(ship, a.kind);
    const crew = a.active;
    const guns = selectedGuns(a, crew);
    const labels: Record<string, string> = {};
    const targets = this.aimTargetIds();
    for (const id of targets) {
      const t = shipById(this.game, id)!;
      const gun = this.oddsGun(probe, crew, guns, t)!;
      labels[id] = percent(this.aimOdds(probe, crew, gun, t, guns.length).chance);
    }
    const aimedAll = a.crews.flatMap((c) => Object.values(a.per[c]!.guns).filter((x): x is string => !!x));
    const aimed = aimedAll.filter((x) => rockIdOf(x) === null && !isEmplacementTarget(x) && !isDestroyerTarget(x));
    const destroyerAimed = aimedAll.filter((x) => isDestroyerTarget(x));
    const turretAimed = aimedAll.filter((x) => isEmplacementTarget(x));
    const rockAimed = aimedAll.flatMap((x) => rockIdOf(x) ?? []);
    const turretLabels: Record<string, string> = {};
    const turretIds = this.aimEmplacementIds();
    for (const id of turretIds) {
      const target = this.enemyEmplacements(ship).find((t) => t.id === id)!;
      const gun = [...guns.filter((g) => g !== SPECIAL), ...guns].find((g) => emplacementInReach(this.game, probe, g, crew, target, probe.pos, probe.facing));
      if (gun !== undefined) turretLabels[id] = percent(this.emplacementOdds(probe, crew, gun, target, guns.length).chance);
    }
    const destroyerLabels: Record<string, string> = {};
    const destroyerIds = this.aimDestroyerIds();
    for (const id of destroyerIds) {
      const d = destroyerById(this.game, id)!;
      const gun = [...guns.filter((g) => g !== SPECIAL), ...guns].find((g) => destroyerHexInReach(this.game, probe, g, crew, d, probe.pos, probe.facing) !== null);
      if (gun !== undefined) destroyerLabels[id] = percent(this.destroyerOdds(probe, crew, gun, d, guns.length).chance);
    }
    const rockLabels: Record<number, string> = {};
    const rockIds = this.aimRockIds();
    for (const id of rockIds) {
      const rock = this.game.asteroids!.rocks.find((r) => r.id === id)!;
      const gun = [...guns.filter((g) => g !== SPECIAL), ...guns].find((g) => rockHexInReach(this.game, probe, g, crew, rock, probe.pos, probe.facing) !== null);
      if (gun !== undefined) rockLabels[id] = percent(this.rockOdds(probe, crew, gun, rock, guns.length).chance);
    }
    return {
      targets: [...new Set([...targets, ...aimed])], targetLabels: labels, aimed: [...new Set(aimed)],
      rockTargets: [...new Set([...rockIds, ...rockAimed])], rockLabels, rockAimed: [...new Set(rockAimed)],
      turretTargets: [...new Set([...turretIds, ...turretAimed])], turretLabels, turretAimed: [...new Set(turretAimed)],
      destroyerTargets: [...new Set([...destroyerIds, ...destroyerAimed])], destroyerLabels, destroyerAimed: [...new Set(destroyerAimed)],
    };
  }

  /** What the ship window shows while aiming. */
  private aimView(ship: Ship): AimView | undefined {
    const a = this.aim;
    if (!a) return undefined;
    const probe = this.aimProbe(ship, a.kind);
    const crew = a.active;
    const member = crewOf(ship).find((c) => c.id === crew)!;
    const enemies = this.enemiesOf(ship);
    const selected = selectedGuns(a, crew);
    const lines: AimLine[] = [];
    // each line can be opened to see how the difficulty is made up
    const add = (text: string, o: { preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number }, special = false): void => {
      lines.push({ key: text.split(':')[0]!, text, why: this.whyBox(o, special) });
    };
    const labelOf = (id: string): string => crewOf(ship).find((c) => c.id === id)?.label.toLowerCase() ?? 'other crew member';
    // the dice follow the guns that are switched on, at once: each gun after the first costs a die (Rules: Fire)
    if (selected.length > 0) {
      const seat = seatOf(crew);
      const skill = seat === null ? probe.gunnerySkill : probe.gunners![seat]!.skill;
      const penalty = selected.length - 1;
      lines.push({ key: 'rolling', text: `Rolling ${skillText({ dice: Math.max(0, skill.dice - penalty), pips: skill.pips })}${penalty > 0 ? ` (${selected.length} guns switched on: ${penalty === 1 ? '1 die' : `${penalty} dice`} fewer than ${skillText(skill)})` : ''}` });
    }
    const guns = crewGunStatus(probe, crew).map((s) => {
      const state = gunAim(a, crew, s.gun);
      const reach = enemies.some((t) => this.aimReaches(probe, crew, s.gun, t)) || this.enemyEmplacements(ship).some((t) => emplacementInReach(this.game, probe, s.gun, crew, t, probe.pos, probe.facing)) || this.enemyDestroyers(ship).some((t) => destroyerHexInReach(this.game, probe, s.gun, crew, t, probe.pos, probe.facing) !== null);
      const holder = heldBy(a, s.gun, crew);
      const confirmedBy = lockedBy(a, s.gun, crew);
      const locked = s.state === 'claimed' || s.state === 'blocked' ? s.note : !reach ? 'No enemy ship is within reach of this gun from here' : confirmedBy ? `The ${labelOf(confirmedBy)} has already confirmed a shot with it. Press Change for the ${labelOf(confirmedBy)} first (a gun fires once per turn).` : undefined;
      const target = state === 'aimed' ? shipById(this.game, a.per[crew]!.guns[s.gun]!) : undefined;
      const aimedRockId = state === 'aimed' ? rockIdOf(a.per[crew]!.guns[s.gun]!) : null;
      const aimedRock = aimedRockId !== null ? this.game.asteroids?.rocks.find((r) => r.id === aimedRockId) : undefined;
      const aimedEmp = state === 'aimed' ? this.enemyEmplacements(ship).find((t) => t.id === a.per[crew]!.guns[s.gun]) : undefined;
      const aimedSd = state === 'aimed' ? this.enemyDestroyers(ship).find((t) => t.id === a.per[crew]!.guns[s.gun]) : undefined;
      if (aimedSd && destroyerHexInReach(this.game, probe, s.gun, crew, aimedSd, probe.pos, probe.facing) !== null) {
        const o = this.destroyerOdds(probe, crew, s.gun, aimedSd, selected.length);
        add(`${s.code} → ${destroyerName(aimedSd)}: ${percent(o.chance)} to hit (difficulty ${o.preview.difficulty}, rolling ${skillText({ dice: Math.max(0, o.skill.dice - o.penalty), pips: o.skill.pips })})`, o);
      } else if (aimedEmp && emplacementInReach(this.game, probe, s.gun, crew, aimedEmp, probe.pos, probe.facing)) {
        const o = this.emplacementOdds(probe, crew, s.gun, aimedEmp, selected.length);
        add(`${s.code} → ${this.emplacementName(aimedEmp)}: ${percent(o.chance)} to hit (difficulty ${o.preview.difficulty}, rolling ${skillText({ dice: Math.max(0, o.skill.dice - o.penalty), pips: o.skill.pips })})`, o);
      } else if (target) {
        const o = this.aimOdds(probe, crew, s.gun, target, selected.length);
        add(`${s.code} → ${shortName(target)}: ${percent(o.chance)} to hit (difficulty ${o.preview.difficulty}, rolling ${skillText({ dice: Math.max(0, o.skill.dice - o.penalty), pips: o.skill.pips })})`, o);
      } else if (aimedRock && rockHexInReach(this.game, probe, s.gun, crew, aimedRock, probe.pos, probe.facing) !== null) {
        const o = this.rockOdds(probe, crew, s.gun, aimedRock, selected.length);
        add(`${s.code} → asteroid ${aimedRock.id} (size ${aimedRock.hexes.length}): ${percent(o.chance)} to hit (difficulty ${o.preview.difficulty}), then 2d6 + power ${o.preview.power} has to reach 14`, o);
      }
      const gunTip = (): HTMLElement => gunTable(s.code, crew === PILOT ? 'pilot' : 'gunner', locked ?? (state !== 'off' ? 'Click to aim again. × switches it off.' : 'Click to switch it on. Each other weapon you fire makes you roll one die fewer.'));
      return { gun: s.gun, code: s.code, tip: gunTip, state, ...(target ? { target: shortName(target) } : aimedRock ? { target: `A${aimedRock.id}` } : aimedEmp ? { target: aimedEmp.id } : aimedSd ? { target: `${specOf(aimedSd).tag}${aimedSd.idNumber}` } : {}), ...(locked ? { locked } : {}), title: state !== 'off' ? state === 'armed' ? 'Armed: click a target. Click × to switch it off.' : 'Click to aim this gun again. × switches it off.' : holder ? `Switch it on: the ${labelOf(holder)} loses it (a gun fires once per turn)` : s.state === 'reserved' ? s.note : 'Click to switch this gun on' };
    });
    // the pilot's missiles, torpedoes or bombs (22): one more chip, with the tubes that fire together
    const weapon = crew === PILOT ? specialFor(this.game, probe) : null;
    if (weapon) {
      const state = gunAim(a, crew, SPECIAL);
      const name = SPECIAL_NAMES[weapon.kind];
      const reach = enemies.some((t) => this.aimReaches(probe, crew, SPECIAL, t)) || this.enemyEmplacements(ship).some((t) => emplacementInReach(this.game, probe, SPECIAL, crew, t, probe.pos, probe.facing)) || this.enemyDestroyers(ship).some((t) => destroyerHexInReach(this.game, probe, SPECIAL, crew, t, probe.pos, probe.facing) !== null);
      const tubes = Math.min(a.per[crew]!.tubes ?? weapon.tubes, weapon.tubes);
      const target = state === 'aimed' ? shipById(this.game, a.per[crew]!.guns[SPECIAL]!) : undefined;
      const specialRockId = state === 'aimed' ? rockIdOf(a.per[crew]!.guns[SPECIAL]!) : null;
      const specialRock = specialRockId !== null ? this.game.asteroids?.rocks.find((r) => r.id === specialRockId) : undefined;
      const specialEmp = state === 'aimed' ? this.enemyEmplacements(ship).find((t) => t.id === a.per[crew]!.guns[SPECIAL]) : undefined;
      const specialSd = state === 'aimed' ? this.enemyDestroyers(ship).find((t) => t.id === a.per[crew]!.guns[SPECIAL]) : undefined;
      const locked = probe.turnedInLastHex
        ? `The ship turned in this hex, so it can’t fire its ${name} from here`
        : !reach ? (weapon.kind === 'CB' ? 'Bombs only hit a ship in the same hex that isn’t moving' : `No enemy ship is in your forward centre arc within ten hexes`) : undefined;
      if (specialSd && destroyerHexInReach(this.game, probe, SPECIAL, crew, specialSd, probe.pos, probe.facing) !== null) {
        const o = this.destroyerOdds(probe, crew, SPECIAL, specialSd, selected.length);
        add(`${weapon.kind}${tubes > 1 ? ` ×${tubes}` : ''} → ${destroyerName(specialSd)}: ${percent(o.chance)} to hit${tubes > 1 ? ' with each' : ''} (difficulty ${o.preview.difficulty}); a hit costs it a structure point ${percent(specialStructureChance(SPECIAL_DICE[weapon.kind], destroyerShields(specialSd), specOf(specialSd).special))} of the time (${SPECIAL_DICE[weapon.kind]}D less its ${destroyerShields(specialSd)} shields has to reach ${specOf(specialSd).special})`, o, true);
      } else if (specialEmp && emplacementInReach(this.game, probe, SPECIAL, crew, specialEmp, probe.pos, probe.facing)) {
        const o = this.emplacementOdds(probe, crew, SPECIAL, specialEmp, selected.length);
        add(`${weapon.kind}${tubes > 1 ? ` ×${tubes}` : ''} → ${this.emplacementName(specialEmp)}: ${percent(o.chance)} to hit${tubes > 1 ? ' with each' : ''} (difficulty ${o.preview.difficulty}, ${SPECIAL_DICE[weapon.kind]}D body points of damage${specialEmp.id === GROUND_TARGET_ID ? '' : '; 5 are enough to destroy it'})`, o, true);
      } else if (target) {
        const o = this.aimOdds(probe, crew, SPECIAL, target, selected.length);
        add(`${weapon.kind}${tubes > 1 ? ` ×${tubes}` : ''} → ${shortName(target)}: ${percent(o.chance)} to hit${tubes > 1 ? ' with each' : ''} (difficulty ${o.preview.difficulty}, ${SPECIAL_DICE[weapon.kind]}D damage, rolling ${skillText({ dice: Math.max(0, o.skill.dice - o.penalty), pips: o.skill.pips })})`, o, true);
      } else if (specialRock && rockHexInReach(this.game, probe, SPECIAL, crew, specialRock, probe.pos, probe.facing) !== null) {
        const o = this.rockOdds(probe, crew, SPECIAL, specialRock, selected.length);
        add(`${weapon.kind}${tubes > 1 ? ` ×${tubes}` : ''} → asteroid ${specialRock.id} (size ${specialRock.hexes.length}): ${percent(o.chance)} to hit${tubes > 1 ? ' with each' : ''} (difficulty ${o.preview.difficulty}); 8 body points in one shot reduce it`, o, true);
      }
      guns.push({
        gun: SPECIAL,
        tip: () => specialTable(weapon.kind, locked ?? (state !== 'off' ? 'Click to aim again. × switches it off.' : `${name}: ${probe.projectiles} left. Click to switch them on. Each other weapon you fire makes you roll one die fewer.`)),
        code: `${weapon.kind} ${probe.projectiles ?? weapon.tubes}`,
        state,
        ...(target ? { target: shortName(target) } : specialRock ? { target: `A${specialRock.id}` } : specialEmp ? { target: specialEmp.id } : specialSd ? { target: `${specOf(specialSd).tag}${specialSd.idNumber}` } : {}),
        ...(locked ? { locked } : {}),
        ...(weapon.tubes > 1 ? { tubes: { count: tubes, max: weapon.tubes } } : {}),
        title: state !== 'off' ? 'Click to aim again. × switches it off.' : `${name}: ${probe.projectiles} left. Click to switch them on. Each other weapon you fire makes you roll one die fewer.`,
      });
    }
    // the last crew member to confirm (or hold fire) sends everything: until then every choice can still be changed
    const last = a.crews.every((c) => c === crew || a.per[c]!.done);
    const kindLabel = a.kind === 'snap' ? 'Snap fire' : 'Fire';
    const also = [this.game.asteroids && this.shootRocks ? 'asteroids' : null, this.game.emplacements?.length || this.game.groundTarget ? 'turret guns and the ground target' : null].filter(Boolean).join(', ');
    return {
      kind: a.kind,
      crewLabel: member.label,
      crews: a.crews.map((id) => {
        const m = crewOf(ship).find((c) => c.id === id)!;
        return { id, label: m.label, picture: m.picture, selected: id === crew, done: a.per[id]!.done };
      }),
      onCrew: (id) => this.aimPickCrew(id),
      guns,
      lines,
      note: armedLeft(a, crew) > 0
        ? `Click a target on the board or in the list for the armed guns${also ? ` (${also} too)` : ''}, or switch them off.`
        : selected.length === 0 && !a.per[crew]!.done ? (guns.length > 0 ? 'Click a gun to arm it, then a target. Or hold fire.' : 'No gun is switched on. Confirm to hold fire.') : '',
      confirmed: a.per[crew]!.done,
      canConfirm: canConfirm(a, crew),
      confirmLabel: last ? (selected.length === 0 ? 'Hold fire' : kindLabel) : 'Confirm',
      onToggle: (gun) => this.aimToggle(gun),
      onSwitchOff: (gun) => this.aimSwitchOff(gun),
      onTubes: (count) => this.aimTubes(count),
      onConfirm: () => this.aimConfirm(),
      onHold: () => this.aimHold(),
      onReopen: () => { this.aim = reopen(a, crew); this.render(); },
      fire: null,
      onCancel: a.kind === 'snap' ? () => { this.aim = null; this.render(); } : null,
    };
  }

  private aimConfirm(): void {
    if (!this.aim) return;
    this.aim = confirmCrew(this.aim, this.aim.active);
    if (allDone(this.aim)) this.aimFire();
    else this.render();
  }

  private aimHold(): void {
    if (!this.aim) return;
    this.aim = holdCrew(this.aim, this.aim.active);
    if (allDone(this.aim)) this.aimFire();
    else this.render();
  }

  /** Everybody has chosen: the shots go to the game (the Fire Segment), or into the move as a snap shot. */
  private aimFire(): void {
    const a = this.aim;
    const ship = this.currentHumanShip();
    if (!a || !ship || !allDone(a)) return;
    const shots = allShots(a);
    if (a.kind === 'fire') {
      this.send({ type: 'fire', player: this.human, shipId: ship.id, shots });
      return;
    }
    this.aim = null;
    if (shots.length > 0) {
      this.moveSteps.push({ kind: 'snapFire', shots });
      this.moveGroups.push(1);
    }
    this.followGhost();
    this.render();
  }

  /** The enemy ships the aiming crew member can shoot at, nearest first, with the chance and the numbers behind it. Null when nobody is aiming. */
  private targetEntries(): TargetEntry[] | null {
    const ship = this.currentHumanShip();
    const a = this.aim;
    if (!ship || !a || a.shipId !== ship.id) return null;
    const probe = this.aimProbe(ship, a.kind);
    const crew = a.active;
    const usable = crewGunStatus(probe, crew).filter((s) => s.state === 'ready' || s.state === 'reserved');
    const selected = selectedGuns(a, crew);
    const canSpecial = crew === PILOT && !!specialFor(this.game, probe);
    return this.enemiesOf(ship)
      .map((t) => ({
        t,
        gun: this.oddsGun(probe, crew, selected, t) ?? usable.find((s) => this.aimReaches(probe, crew, s.gun, t))?.gun ?? (canSpecial && this.aimReaches(probe, crew, SPECIAL, t) ? SPECIAL : undefined),
      }))
      .filter((x): x is { t: Ship; gun: number } => x.gun !== undefined)
      .sort((x, y) => hexDistance(probe.pos!, x.t.pos!) - hexDistance(probe.pos!, y.t.pos!))
      .map(({ t, gun }) => ({
        t,
        gun,
        probe,
        range: hexDistance(probe.pos!, t.pos!),
        o: this.aimOdds(probe, crew, gun, t, Math.max(1, selected.length)),
        aimedGuns: selected.filter((g) => a.per[crew]!.guns[g] === t.id).map((g) => this.gunLabel(probe, g, crew)),
        done: a.per[crew]!.done,
      }));
  }

  /** How a shot's difficulty is made up, line by line, with the total; and the power (or the damage dice) of a hit. */
  private whyBox(o: { preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number }, special: boolean): HTMLElement {
    return h('div', { class: 'breakdown shot' },
      ...o.preview.parts.map((p, n) => partRow(p, n === 0)),
      h('div', { class: 'bdrow total' }, h('span', { class: 'bdlabel' }, 'Difficulty'), h('span', { class: 'bdval' }, String(o.preview.difficulty))),
      o.penalty > 0 ? h('div', { class: 'bdnote' }, `Rolling ${skillText({ dice: Math.max(0, o.skill.dice - o.penalty), pips: o.skill.pips })} instead of ${skillText(o.skill)}: ${o.penalty === 1 ? '1 die' : `${o.penalty} dice`} fewer, because ${o.penalty + 1} guns fire.`) : null,
      h('div', { class: 'bdtitle' }, special ? `Damage: ${o.preview.power} dice` : `Power ${o.preview.power}`),
      ...o.preview.powerParts.map((p, n) => partRow(p, n === 0)),
    );
  }

  /** What a target's card adds: the chance to hit, the guns aimed at it, and the difficulty with how it is made up. */
  private targetBlock(e: Pick<TargetEntry, 'o' | 'probe' | 'gun' | 'range' | 'aimedGuns'> & { t: { id: string } }): Child[] {
    const { o, probe, gun } = e;
    const compact = this.sideLevel === 1;
    return [
      h('div', { class: 'tcrow' },
        compact ? `R${e.range} · ` : `range ${e.range} · `,
        h('span', { class: 'tcchance' }, percent(o.chance)),
        e.aimedGuns.length ? h('span', { class: 'tcaimed' }, ` · ${compact ? '' : 'aimed: '}${e.aimedGuns.join(', ')}`) : null,
      ),
      h('details', { open: this.aimDetail === e.t.id, onclick: (ev: Event) => ev.stopPropagation(), ontoggle: (ev: Event) => { this.aimDetail = (ev.target as HTMLDetailsElement).open ? e.t.id : this.aimDetail === e.t.id ? null : this.aimDetail; } },
        h('summary', null, `difficulty ${o.preview.difficulty} (${gun === SPECIAL ? o.preview.gun : probe.guns[gun]} at range ${o.preview.range}) · ${gun === SPECIAL ? `${o.preview.power}D damage` : `power ${o.preview.power}`}`),
        h('div', { class: 'breakdown shot' },
          ...o.preview.parts.map((p, n) => partRow(p, n === 0)),
          o.penalty > 0 ? h('div', { class: 'bdnote' }, `Rolling ${skillText({ dice: Math.max(0, o.skill.dice - o.penalty), pips: o.skill.pips })} instead of ${skillText(o.skill)}: ${o.penalty === 1 ? '1 die' : `${o.penalty} dice`} fewer, because ${o.penalty + 1} guns fire.`) : null,
          h('div', { class: 'bdtitle' }, gun === SPECIAL ? `Damage: ${o.preview.power} dice` : `Power ${o.preview.power}`),
          ...o.preview.powerParts.map((p, n) => partRow(p, n === 0)),
        ),
      ),
    ];
  }

  // ------------------------------------------------------------------ Star Destroyers (Rules: Star Destroyers)

  /** The enemy Star Destroyers that are on the map. */
  private enemyDestroyers(ship: Ship): Destroyer[] {
    return destroyersOf(this.game, ship.owner === 0 ? 1 : 0).filter((d) => d.pos !== null && !d.exploded);
  }

  /** The Star Destroyers the active crew member's switched-on guns can reach. */
  private aimDestroyerIds(): string[] {
    const ship = this.currentHumanShip();
    const a = this.aim;
    if (!ship || !a || a.per[a.active]!.done) return [];
    const probe = this.aimProbe(ship, a.kind);
    const guns = selectedGuns(a, a.active);
    return this.enemyDestroyers(ship).filter((d) => guns.some((g) => destroyerHexInReach(this.game, probe, g, a.active, d, probe.pos, probe.facing) !== null)).map((d) => d.id);
  }

  private aimDestroyer(id: string): void {
    const ship = this.currentHumanShip();
    const a = this.aim;
    const target = ship ? this.enemyDestroyers(ship).find((d) => d.id === id) : undefined;
    if (!ship || !a || !target) return;
    const probe = this.aimProbe(ship, a.kind);
    this.aim = aimAt(a, a.active, id, (g) => destroyerHexInReach(this.game, probe, g, a.active, target, probe.pos, probe.facing) !== null);
    this.render();
  }

  private onDestroyerClick(id: string): void {
    if (this.animating) {
      clock.skip = true;
      return;
    }
    if (this.placingNow() && this.sdToPlace().some((d) => d.id === id)) {
      // like a fighter that is already down: a click on it picks it again, and brings back its turn arrows
      this.placingId = id;
      this.selected = id;
      if (this.draft.has(id)) this.turning = id;
      this.render();
      return;
    }
    if (this.aim && this.aimDestroyerIds().includes(id)) this.aimDestroyer(id);
    else {
      const picker = this.humanTargeting();
      if (picker && capitalTargetsOf(this.game, picker).some((t) => t.id === id)) this.pickCapitalTarget(picker, id);
      else {
        // otherwise a click selects it, as it does a ship: its window stays on the screen (not an enemy's position in the set-up)
        const d = destroyerById(this.game, id);
        if (!d || (this.game.phase === 'setup' && d.owner !== this.human)) return;
        this.selected = id;
        this.turretSel = null;
        this.render();
      }
    }
  }

  /** The chance to hit a Star Destroyer with a gun, with the dice the crew member's switched-on guns leave (Rules: Fire). The nearest hex the gun reaches is the one aimed at. */
  private destroyerOdds(probe: Ship, crew: string, gun: number, d: Destroyer, switchedOn: number): { chance: number; preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number } {
    const hex = destroyerHexInReach(this.game, probe, gun, crew, d, probe.pos, probe.facing) ?? d.pos!;
    const preview = previewDestroyerShot(this.game, probe, gun, d, hex, crew, probe.pos, probe.facing);
    const seat = seatOf(crew);
    const skill = seat === null ? probe.gunnerySkill : probe.gunners![seat]!.skill;
    const penalty = Math.max(0, switchedOn - 1);
    return { chance: chanceAtLeast(skill, penalty, preview.difficulty), preview, skill, penalty };
  }

  /** The Star Destroyers in reach of the aiming crew member, for the cards beside the board. */
  private destroyerEntries(): { t: { id: string }; d: Destroyer; gun: number; probe: Ship; range: number; o: { chance: number; preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number }; aimedGuns: string[]; done: boolean }[] {
    const ship = this.currentHumanShip();
    const a = this.aim;
    if (!ship || !a || a.shipId !== ship.id) return [];
    const probe = this.aimProbe(ship, a.kind);
    const crew = a.active;
    const usable = crewGunStatus(probe, crew).filter((s) => s.state === 'ready' || s.state === 'reserved');
    const selected = selectedGuns(a, crew);
    const canSpecial = crew === PILOT && !!specialFor(this.game, probe);
    const reaches = (g: number, d: Destroyer): boolean => destroyerHexInReach(this.game, probe, g, crew, d, probe.pos, probe.facing) !== null;
    return this.enemyDestroyers(ship)
      .map((d) => {
        const aimed = selected.find((g) => a.per[crew]!.guns[g] === d.id && reaches(g, d));
        const gun = aimed ?? selected.filter((g) => g !== SPECIAL).find((g) => reaches(g, d)) ?? selected.find((g) => reaches(g, d)) ?? usable.find((s) => reaches(s.gun, d))?.gun ?? (canSpecial && reaches(SPECIAL, d) ? SPECIAL : undefined);
        return { d, gun };
      })
      .filter((x): x is { d: Destroyer; gun: number } => x.gun !== undefined)
      .map(({ d, gun }) => {
        const hex = destroyerHexInReach(this.game, probe, gun, crew, d, probe.pos, probe.facing) ?? d.pos!;
        return {
          t: { id: d.id },
          d,
          gun,
          probe,
          range: hexDistance(probe.pos!, hex),
          o: this.destroyerOdds(probe, crew, gun, d, Math.max(1, selected.length)),
          aimedGuns: selected.filter((g) => a.per[crew]!.guns[g] === d.id).map((g) => this.gunLabel(probe, g, crew)),
          done: a.per[crew]!.done,
        };
      })
      .sort((x, y) => x.range - y.range);
  }

  private destroyerCard(e: ReturnType<App['destroyerEntries']>[number]): HTMLElement {
    const d = e.d;
    const compact = this.sideLevel === 1;
    const classes = 'shipcard emplacementcard' + (compact ? ' compact' : '') + ' target' + (e.aimedGuns.length ? ' aimed' : '');
    const title = `${destroyerName(d)} · ${structureLeft(d)} of ${specOf(d).structure} structure points left`;
    if (this.sideLevel === 2) {
      return h('div', { class: classes + ' icon', title: `${title}: ${percent(e.o.chance)} to hit at range ${e.range}, difficulty ${e.o.preview.difficulty}`, onclick: () => { if (!e.done) this.aimDestroyer(d.id); } },
        h('div', { class: 'icode' }, `${specOf(d).tag}${d.idNumber}`), h('div', { class: 'tcchance' }, percent(e.o.chance)));
    }
    return h('div', { class: classes, onmouseenter: () => this.setHovered(d.id), onmouseleave: () => this.setHovered(null), onclick: () => { if (!e.done) this.aimDestroyer(d.id); } },
      h('div', { class: 'shiptitle' }, h('b', { style: { color: SIDE_COLORS[d.owner] } }, title)),
      ...this.targetBlock(e),
    );
  }

  /** The Star Destroyers in the ship list: whose, how much structure is left, and what is damaged. */
  private destroyerSection(): HTMLElement[] {
    const list = (this.game.destroyers ?? []).filter((d) => !d.exploded);
    if (list.length === 0) return [];
    const icons = this.sideLevel === 2;
    return [
      h('h4', null, icons ? 'Cap' : 'Capital ships'),
      ...list.map((d) => {
        const spec = specOf(d);
        const left = structureLeft(d);
        const notes = [
          d.escaped ? 'escaped' : null,
          d.lost >= spec.deadAt ? 'dead in space' : d.lost >= spec.silentAt ? 'guns out' : null,
          d.fireControl ? 'fire control damaged' : null,
          d.noTurns ? 'no turns' : null,
          `speed ${speedText(destroyerSpeedNow(d))}${d.speedLost ? ` (top ${destroyerMaxSpeed(d)})` : ''}`,
          d.gunsDamaged ? `guns −${d.gunsDamaged}` : null,
          d.outOfControl ? `out of control (${d.outOfControl})` : null,
        ].filter((x): x is string => !!x);
        const title = `${destroyerName(d)}: ${left} of ${spec.structure} structure points left${notes.length ? `; ${notes.join(', ')}` : ''}`;
        return h('div', { class: 'shipcard' + (d.lost >= spec.silentAt ? ' dim' : ''), title, onmouseenter: () => this.setHovered(d.id), onmouseleave: () => this.setHovered(null) },
          h('div', { class: 'shiptitle' }, h('b', { style: { color: SIDE_COLORS[d.owner] } }, icons ? `${spec.tag}${d.idNumber}` : destroyerName(d)), h('span', null, ` ${left}/${spec.structure}`)),
          icons || notes.length === 0 ? null : h('div', { class: 'note' }, notes.join(' · ')),
        );
      }),
    ];
  }

  // ---- setting up a Star Destroyer

  /** The Star Destroyers of the human that are to be placed now (in the set-up). */
  private sdToPlace(): Destroyer[] {
    const g = this.game;
    if (g.phase !== 'setup') return [];
    return destroyersOf(g, this.human).filter((d) => d.pos === null || this.draft.has(d.id) || !g.placed[this.human]);
  }

  /** The hexes the Star Destroyers that are placed (not yet confirmed) fill. */
  private sdHexes(): Hex[] {
    return this.sdToPlace().flatMap((d) => {
      const placed = this.draft.get(d.id);
      return placed ? destroyerHexes(placed.pos, placed.facing, specOf(d).kind) : [];
    });
  }

  /** Does a Star Destroyer with its nose here fit in the set-up area, clear of the other ships and Star Destroyers? */
  private sdFits(pos: Hex, facing: Facing, id: string): boolean {
    const g = this.game;
    const zone = this.placeZone();
    const mine = destroyerById(g, id);
    const hexes = destroyerHexes(pos, facing, mine ? specOf(mine).kind : 'star-destroyer');
    if (!hexes.every((x) => zone.some((z) => hexEquals(z, x)))) return false;
    if (g.asteroids && hexes.some((x) => rockAt(g.asteroids!, x))) return false;
    for (const [other, d] of this.draft) {
      if (other === id) continue;
      const otherShip = destroyerById(g, other);
      const taken = otherShip ? destroyerHexes(d.pos, d.facing, specOf(otherShip).kind) : [d.pos];
      if (hexes.some((x) => taken.some((t) => hexEquals(t, x)))) return false;
    }
    return true;
  }

  private placeDestroyer(id: string, hex: Hex): void {
    const previous = this.draft.get(id);
    const g = this.game;
    const facing: Facing = previous?.facing ?? this.facingToward(hex, g.zones[this.aiPlayer][Math.floor(g.zones[this.aiPlayer].length / 2)]!);
    if (!this.sdFits(hex, facing, id)) {
      this.message = 'The whole ship has to fit in the shaded area, clear of the other ships. Click the hex it should turn on: the second from the front for a big ship, the front one for a frigate.';
      this.render();
      return;
    }
    this.draft.set(id, { pos: hex, facing });
    sound.play('ui.place');
    this.turning = id;
    this.message = '';
    const next = [...this.toPlace().map((s) => s.id), ...this.sdToPlace().map((d) => d.id)].find((x) => !this.draft.has(x));
    this.placingId = next ?? this.placingId;
    this.render();
  }

  // ---- picking the target of a capital ship (after all of them have moved)

  /** The capital ship of the human that has to pick its target now. */
  private humanTargeting(): Destroyer | null {
    const g = this.game;
    if (g.phase !== 'destroyers' || g.pending || this.animating) return null;
    const id = g.capitalTargets?.asking[0];
    const d = id ? destroyerById(g, id) : undefined;
    return d && d.owner === this.human ? d : null;
  }

  /** The distance between the nearest hexes of two capital ships. */
  private capitalRange(a: Destroyer, b: Destroyer): number {
    return Math.min(...destroyerHexes(a.pos!, a.facing, specOf(a).kind).map((h) => nearestHexOf(b, h)?.distance ?? 99));
  }

  private pickCapitalTarget(d: Destroyer, target: string): void {
    this.send({ type: 'targetCapital', player: this.human, id: d.id, target });
  }

  private targetingView(d: Destroyer): ActionPanel {
    const targets = capitalTargetsOf(this.game, d);
    const waiting = (this.game.capitalTargets?.asking.length ?? 1) - 1;
    return {
      title: `${destroyerName(d)} · pick its target`,
      lead: 'One enemy capital ship; every capital ship fires at the one it picked, together, once all have picked.',
      buttons: targets.map((t) => ({
        label: `${destroyerName(t)} · range ${this.capitalRange(d, t)} · ${structureLeft(t)}/${specOf(t).structure}`,
        onClick: () => this.pickCapitalTarget(d, t.id),
      })),
      body: waiting > 0 ? [h('p', { class: 'note' }, `${waiting} more of your capital ships ${waiting === 1 ? 'has' : 'have'} to pick after this one.`)] : [],
    };
  }

  // ---- moving a Star Destroyer

  /** The Star Destroyer of the human whose move it is, if it is the human's turn to move one. */
  private humanDestroyer(): Destroyer | null {
    const g = this.game;
    if (g.phase !== 'destroyers' || g.pending || this.animating) return null;
    const d = currentDestroyer(g);
    if (!d || d.owner !== this.human || !destroyerCanMove(d)) return null;
    const key = `${g.turn}:${d.id}`;
    if (key !== this.sdKey) {
      this.sdKey = key;
      this.sdSteps = [];
      this.sdGroups = [];
      this.sdSpeed = null;
    }
    return d;
  }

  /** Where the move drawn up so far takes the Star Destroyer. */
  private sdSim(d: Destroyer): { pos: Hex; facing: Facing; path: Hex[]; legal: MoveStep[]; complete: boolean; budget: number } {
    let pos = d.pos!;
    let facing = d.facing;
    const path: Hex[] = [pos];
    for (const step of this.sdSteps) {
      const moved = applyStepToPosition(pos, facing, step);
      pos = moved.pos;
      facing = moved.facing;
      path.push(pos);
    }
    const speed = this.sdChosenSpeed(d);
    const budget = hexesAtSpeed(speed) - this.sdSteps.filter((x) => x === 'forward').length;
    return { pos, facing, path, legal: destroyerLegalSteps(this.game, d.id, this.sdSteps, speed), complete: destroyerMoveComplete(this.game, d.id, this.sdSteps, speed), budget };
  }

  /** The speed the move is drawn up for: the one chosen with the arrows, else its speed now. */
  private sdChosenSpeed(d: Destroyer): number {
    return this.sdSpeed !== null && destroyerSpeedChoices(d).includes(this.sdSpeed) ? this.sdSpeed : destroyerSpeedNow(d);
  }

  /** The speed can be changed freely until the move has begun: with the first step taken the arrows and the buttons are frozen, and the undo of that step frees them again. */
  private sdSpeedLocked(): boolean {
    return this.sdSteps.length > 0;
  }

  /** Speeds up or slows down by a step: the speed is chosen before the move begins. */
  private sdChangeSpeed(delta: 1 | -1): void {
    const d = this.humanDestroyer();
    if (!d || this.sdSpeedLocked()) return;
    const next = this.sdChosenSpeed(d) + delta * specOf(d).speedStep;
    if (!destroyerSpeedChoices(d).includes(next)) return;
    this.sdSpeed = next;
    this.sdSteps = [];
    this.sdGroups = [];
    this.render();
  }

  private sdRingButtons(d: Destroyer, sim: ReturnType<App['sdSim']>): RingButtons {
    const off = (title: string): RingButton => ({ enabled: false, title });
    const can = (step: MoveStep, yes: string, no: string): RingButton => ({ enabled: sim.legal.includes(step), title: sim.legal.includes(step) ? yes : no });
    const turnWhy = d.noTurns ? 'its steering is damaged: it can’t turn any more' : `it can’t turn yet (turn number ${destroyerMoveContext(d, this.sdChosenSpeed(d)).turnNumber})`;
    const started = this.sdSteps.length > 0;
    return {
      forward: can('forward', 'Forward: moves on until the first hex where it may turn', 'Forward isn’t possible here'),
      slipLeft: off('A capital ship can’t slip'),
      slipRight: off('A capital ship can’t slip'),
      turnLeft: can('turnLeft', 'Turn one hex side to the left', `Turn left: ${turnWhy}`),
      turnRight: can('turnRight', 'Turn one hex side to the right', `Turn right: ${turnWhy}`),
      halfLoop: off('A capital ship can’t make a half loop'),
      snapFire: off('A capital ship fires by itself'),
      undo: { enabled: started, title: 'Undo the last step' },
      restart: { enabled: started, title: 'Start the move over' },
    };
  }

  private sdRingClick(action: RingAction): void {
    const d = this.humanDestroyer();
    if (!d) return;
    if (action === 'undo') this.sdSteps.length -= this.sdGroups.pop() ?? this.sdSteps.length;
    else if (action === 'restart') {
      this.sdSteps = [];
      this.sdGroups = [];
    } else if (action === 'forward' || action === 'turnLeft' || action === 'turnRight') {
      const before = this.sdSteps.length;
      this.sdSteps.push(action);
      // forward runs on while there is nothing else to choose
      for (let guard = 0; guard < 12 && action === 'forward'; guard++) {
        const legal = destroyerLegalSteps(this.game, d.id, this.sdSteps, this.sdChosenSpeed(d));
        if (legal.length === 1 && legal[0] === 'forward') this.sdSteps.push('forward');
        else break;
      }
      this.sdGroups.push(this.sdSteps.length - before);
    }
    this.render();
  }

  private sdMoveView(d: Destroyer): ActionPanel {
    const sim = this.sdSim(d);
    const speed = this.sdChosenSpeed(d);
    const ctx = destroyerMoveContext(d, speed);
    const choices = destroyerSpeedChoices(d);
    const turnText = d.noTurns ? 'Its steering is damaged: no turns at all.' : speed === 0 ? 'Standing still it turns freely.' : `It may turn one hex side after every ${ctx.turnNumber} hex${ctx.turnNumber === 1 ? '' : 'es'}.`;
    const body: Child[] = [
      h('p', { class: 'note' }, `Speed ${speedText(speed)}${speed !== destroyerSpeedNow(d) ? ` (it was ${speedText(destroyerSpeedNow(d))})` : ''}${hexesAtSpeed(speed) !== speed ? `, so it moves ${hexesAtSpeed(speed)} hexes` : ''}. A ${specOf(d).name} changes its speed by ${specOf(d).speedStep === 1 ? 'one hex' : 'half a hex'} a game-turn, between 0 and ${destroyerMaxSpeed(d)}. ${turnText} It fires by itself at every fighter that comes within ten hexes of it.`),
    ];
    if (this.game.map.mode === 'static' && !isOnMap(this.game.map, sim.pos)) body.push(h('p', { class: 'error' }, 'This move takes the ship off the map. It would escape and leave the game.'));
    if (this.sdSteps.length > 0) body.push(h('p', { class: 'path' }, `Path: ${this.sdSteps.map((x) => stepLabel(x)).join(' ')}`));
    return {
      title: `${destroyerName(d)} · ${sim.budget} hex${sim.budget === 1 ? '' : 'es'} left`,
      lead: `Speed ${speedText(speed)} · ${speed === 0 ? 'turns freely' : `turn number ${ctx.turnNumber}`}`,
      buttons: [{
        label: 'Slower',
        disabled: this.sdSpeedLocked() || !choices.includes(speed - specOf(d).speedStep),
        title: this.sdSpeedLocked() ? 'The speed is frozen once the move has begun: undo the move to change it' : `Slow down by ${specOf(d).speedStep === 1 ? 'one hex' : 'half a hex'}`,
        onClick: () => this.sdChangeSpeed(-1),
      }, {
        label: 'Faster',
        disabled: this.sdSpeedLocked() || !choices.includes(speed + specOf(d).speedStep),
        title: this.sdSpeedLocked() ? 'The speed is frozen once the move has begun: undo the move to change it' : `Speed up by ${specOf(d).speedStep === 1 ? 'one hex' : 'half a hex'}`,
        onClick: () => this.sdChangeSpeed(1),
      }, {
        label: sim.complete ? 'Finish move' : `Finish move (${sim.budget} hex${sim.budget === 1 ? '' : 'es'} left)`,
        primary: true,
        disabled: !sim.complete,
        onClick: () => { this.send({ type: 'moveDestroyer', player: this.human, id: d.id, steps: [...this.sdSteps], speed }); },
      }],
      body,
    };
  }

  // ------------------------------------------------------------------ turret guns and the ground target (20, 29)

  /** The turret guns and the ground target of the other side that are still there. */
  private enemyEmplacements(ship: Ship): EmplacementTarget[] {
    const g = this.game;
    return [...(g.emplacements ?? []).filter((e) => e.status === 'active'), ...(g.groundTarget?.status === 'active' ? [g.groundTarget] : [])].filter((t) => t.owner !== ship.owner);
  }

  private emplacementName(t: EmplacementTarget): string {
    return t.id === GROUND_TARGET_ID ? 'the ground target' : turretName(t as Emplacement);
  }

  /** The turret guns and the ground target the active crew member's switched-on guns can reach. */
  private aimEmplacementIds(): string[] {
    const ship = this.currentHumanShip();
    const a = this.aim;
    if (!ship || !a || a.per[a.active]!.done) return [];
    const probe = this.aimProbe(ship, a.kind);
    const guns = selectedGuns(a, a.active);
    return this.enemyEmplacements(ship).filter((t) => guns.some((g) => emplacementInReach(this.game, probe, g, a.active, t, probe.pos, probe.facing))).map((t) => t.id);
  }

  private aimEmplacement(id: string): void {
    const ship = this.currentHumanShip();
    const a = this.aim;
    const target = ship ? this.enemyEmplacements(ship).find((t) => t.id === id) : undefined;
    if (!ship || !a || !target) return;
    const probe = this.aimProbe(ship, a.kind);
    this.aim = aimAt(a, a.active, id, (g) => emplacementInReach(this.game, probe, g, a.active, target, probe.pos, probe.facing));
    this.render();
  }

  /** The chance to hit a turret gun or the ground target with a gun (Rules: Ground attack), with the dice the crew member's switched-on guns leave (Rules: Fire). */
  private emplacementOdds(probe: Ship, crew: string, gun: number, target: EmplacementTarget, switchedOn: number): { chance: number; preview: ShotPreview; skill: { dice: number; pips: number }; penalty: number } {
    const preview = previewEmplacementShot(this.game, probe, gun, target, crew, probe.pos, probe.facing);
    const seat = seatOf(crew);
    const skill = seat === null ? probe.gunnerySkill : probe.gunners![seat]!.skill;
    const penalty = Math.max(0, switchedOn - 1);
    return { chance: chanceAtLeast(skill, penalty, preview.difficulty), preview, skill, penalty };
  }

  private onTurretClick(id: string): void {
    if (this.animating) {
      clock.skip = true;
      return;
    }
    if (this.aim && this.aimEmplacementIds().includes(id)) {
      this.aimEmplacement(id);
      return;
    }
    if (this.turretsPhase() && this.turretDraft.has(id)) this.selectTurret(this.turretSel === id ? null : id);
  }

  /** The turret guns and the ground target in reach of the aiming crew member, nearest first, for the cards beside the board. */
  private emplacementEntries(): EmplacementEntry[] {
    const ship = this.currentHumanShip();
    const a = this.aim;
    if (!ship || !a || a.shipId !== ship.id) return [];
    const probe = this.aimProbe(ship, a.kind);
    const crew = a.active;
    const usable = crewGunStatus(probe, crew).filter((s) => s.state === 'ready' || s.state === 'reserved');
    const selected = selectedGuns(a, crew);
    const canSpecial = crew === PILOT && !!specialFor(this.game, probe);
    const reaches = (g: number, t: EmplacementTarget): boolean => emplacementInReach(this.game, probe, g, crew, t, probe.pos, probe.facing);
    return this.enemyEmplacements(ship)
      .map((t) => {
        const aimed = selected.find((g) => a.per[crew]!.guns[g] === t.id && reaches(g, t));
        const gun = aimed ?? selected.filter((g) => g !== SPECIAL).find((g) => reaches(g, t)) ?? selected.find((g) => reaches(g, t)) ?? usable.find((s) => reaches(s.gun, t))?.gun ?? (canSpecial && reaches(SPECIAL, t) ? SPECIAL : undefined);
        return { t, gun };
      })
      .filter((x): x is { t: EmplacementTarget; gun: number } => x.gun !== undefined)
      .sort((x, y) => hexDistance(probe.pos!, x.t.pos) - hexDistance(probe.pos!, y.t.pos))
      .map(({ t, gun }) => ({
        t,
        gun,
        probe,
        range: hexDistance(probe.pos!, t.pos),
        o: this.emplacementOdds(probe, crew, gun, t, Math.max(1, selected.length)),
        aimedGuns: selected.filter((g) => a.per[crew]!.guns[g] === t.id).map((g) => this.gunLabel(probe, g, crew)),
        done: a.per[crew]!.done,
      }));
  }

  private emplacementCard(e: EmplacementEntry): HTMLElement {
    const t = e.t;
    const name = this.emplacementName(t);
    const compact = this.sideLevel === 1;
    const classes = 'shipcard emplacementcard' + (compact ? ' compact' : '') + ' target' + (e.aimedGuns.length ? ' aimed' : '');
    const label = t.id === GROUND_TARGET_ID ? 'Ground target' : `${t.id} · ${(t as Emplacement).kind === 'double' ? ((t as Emplacement).reduced ? 'double (one gun)' : 'double') : 'single'}`;
    if (this.sideLevel === 2) {
      return h('div', { class: classes + ' icon', title: `${name}: ${percent(e.o.chance)} to hit at range ${e.range}, difficulty ${e.o.preview.difficulty}`, onmouseenter: () => this.setHovered(t.id), onmouseleave: () => this.setHovered(null), onclick: () => { if (!e.done) this.aimEmplacement(t.id); } },
        h('div', { class: 'icode' }, t.id), h('div', { class: 'tcchance' }, percent(e.o.chance)));
    }
    return h('div', { class: classes, onmouseenter: () => this.setHovered(t.id), onmouseleave: () => this.setHovered(null), onclick: () => { if (!e.done) this.aimEmplacement(t.id); } },
      h('div', { class: 'shiptitle' }, h('b', null, label)),
      ...this.targetBlock(e),
    );
  }

  // ---- giving orders to the turret guns (Rules: Ground attack), while planning

  /** The human has turret guns to give orders to this game-turn: they turn, track and take up their rules of engagement while the plans are made. */
  private turretsPhase(): boolean {
    const g = this.game;
    return g.phase === 'planning' && !g.pending && !g.planSubmitted[this.human] && (g.emplacements ?? []).some((e) => e.status === 'active' && e.owner === this.human);
  }

  /** The orders drawn up so far start from "no change" once for each game-turn: no gun turns by itself. */
  private ensureTurretDraft(): void {
    if (!this.turretsPhase()) {
      if (this.turretDraftTurn !== -1) {
        this.turretDraft.clear();
        this.turretDraftTurn = -1;
        this.turretSel = null;
      }
      return;
    }
    if (this.turretDraftTurn === this.game.turn) return;
    this.turretDraft.clear();
    for (const turret of this.game.emplacements!.filter((e) => e.status === 'active' && e.owner === this.human)) {
      this.turretDraft.set(turret.id, { turn: 0, target: null, chance: turret.chance, lastChance: turret.lastChance ?? 0 });
    }
    this.turretDraftTurn = this.game.turn;
    this.turretSel = null;
  }

  /** The way a turret gun will face once its order is carried out. */
  private draftFacing(id: string): Facing {
    const turret = this.game.emplacements!.find((e) => e.id === id)!;
    return turnFacing(turret.facing, this.turretDraft.get(id)?.turn ?? 0);
  }

  /** The enemy ships in the forward arc the turret gun will have, which it may track. */
  private turretArcShips(id: string): Ship[] {
    const turret = this.game.emplacements?.find((e) => e.id === id);
    if (!turret) return [];
    return this.game.ships.filter((s) => s.status === 'active' && s.pos && s.owner !== turret.owner && turretReaches({ pos: turret.pos, facing: this.draftFacing(id) }, s.pos));
  }

  /** The arrows beside a turret gun: one hex side to the left or right of the way it faces now (Rules: Ground attack). */
  private turnTurret(id: string, direction: -1 | 1): void {
    const draft = this.turretDraft.get(id);
    if (!draft) return;
    draft.turn = Math.max(-1, Math.min(1, draft.turn + direction)) as -1 | 0 | 1;
    if (draft.target && !this.turretArcShips(id).some((s) => s.id === draft.target)) draft.target = null;
    this.render();
  }

  private selectTurret(id: string | null): void {
    this.turretSel = id;
    this.roeStage = null;
    if (id) this.selected = null;
    this.render();
  }

  /** The turret orders go with the plans: sent just before them, for every gun (no change for the ones left alone). */
  private turretOrdersToSend(): TurretOrder[] {
    return [...this.turretDraft].map(([id, d]) => ({ id, turn: d.turn, target: d.target, chance: d.chance, lastChance: d.lastChance }));
  }

  /** The rules of engagement chosen in the bar go to one gun, or to all of the player's guns: nobody has to micromanage, but may. */
  private giveRulesOfEngagement(ids: string[], chance: number | null, lastChance: number): void {
    for (const id of ids) {
      const d = this.turretDraft.get(id);
      if (!d) continue;
      d.chance = chance;
      d.lastChance = lastChance;
    }
    this.roeStage = null;
    this.render();
  }

  /** The rows under the planning strip while a turret gun is selected: what it tracks, and its rules of engagement, for this gun or for all. */
  private turretRows(): Child[] {
    const g = this.game;
    const sel = this.turretSel ? g.emplacements!.find((e) => e.id === this.turretSel) : undefined;
    const draft = sel ? this.turretDraft.get(sel.id) : undefined;
    if (!sel || !draft) return [];
    const ships = this.turretArcShips(sel.id);
    const percents = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
    // the limits on offer start from what this gun has now; they only count once given with one of the two buttons
    if (!this.roeStage || this.roeStage.id !== sel.id) this.roeStage = { id: sel.id, chance: draft.chance, lastChance: draft.lastChance };
    const stage = this.roeStage;
    const pick = (chance: number | null, last: number): void => {
      stage.chance = chance !== null && last > chance ? last : chance;
      stage.lastChance = last;
      this.render();
    };
    const changed = stage.chance !== draft.chance || stage.lastChance !== draft.lastChance;
    const allSame = [...this.turretDraft.values()].every((d) => d.chance === stage.chance && d.lastChance === stage.lastChance);
    return [
      h('div', { class: 'cmdrow turretrow' },
        h('b', null, `${turretName(sel)}`),
        h('span', { class: 'cmdlead' }, 'Turn it with the arrows beside it on the board (one hex side).'),
        h('label', null, 'Tracks ',
          h('select', { onchange: (e: Event) => { draft.target = (e.target as HTMLSelectElement).value || null; this.render(); }, title: 'The ship this gun tracks. Shots at it are easier by 5, or by 10 if the gun tracked the same ship last game-turn. You can also click the ship on the board.' },
            h('option', { value: '', selected: draft.target === null }, 'nothing'),
            ...ships.map((s) => h('option', { value: s.id, selected: draft.target === s.id }, `${fullName(s)} (range ${hexDistance(sel.pos, s.pos!)})`)))),
        h('button', { onclick: () => this.selectTurret(null), title: 'Back to the ships' }, 'Done'),
      ),
      h('div', { class: 'cmdrow turretrow' },
        h('b', null, 'Rules of engagement'),
        h('label', null, 'Fire at once at ',
          h('select', { onchange: (e: Event) => pick((e.target as HTMLSelectElement).value === '' ? null : Number((e.target as HTMLSelectElement).value), stage.lastChance), title: 'The upper limit. As soon as the chance to hit a ship in the arc reaches this number, the gun fires. Never: the gun waits for the last chance.' },
            h('option', { value: '', selected: stage.chance === null }, 'never'),
            ...percents.map((c) => h('option', { value: String(c), selected: stage.chance === c }, `${c}%`)))),
        h('label', null, ' or better. At the last chance fire at ',
          h('select', { onchange: (e: Event) => { const last = Number((e.target as HTMLSelectElement).value); pick(stage.chance !== null && stage.chance < last ? last : stage.chance, last); }, title: 'The lower limit. The last chance is when the ship is about to leave the arc or the range, or when its move ends. The gun then fires only if the chance to hit is at least this high; otherwise it keeps its shot for another ship. A shot that can’t hit is never fired.' },
            h('option', { value: '0', selected: stage.lastChance === 0 }, 'any shot'),
            ...percents.map((c) => h('option', { value: String(c), selected: stage.lastChance === c }, `${c}%`)))),
        h('div', { class: 'cmdbtns' },
          h('button', { class: changed ? 'primary' : '', disabled: !changed, title: 'Give these limits to this gun only', onclick: () => this.giveRulesOfEngagement([sel.id], stage.chance, stage.lastChance) }, 'Set for this gun'),
          h('button', { class: changed || !allSame ? 'primary' : '', disabled: !changed && allSame, title: 'Give these limits to all your turret guns', onclick: () => this.giveRulesOfEngagement([...this.turretDraft.keys()], stage.chance, stage.lastChance) }, 'Set for all guns'),
        ),
      ),
      h('div', { class: 'cmdnote' }, `${turretName(sel)} fires ${chanceText(draft.chance, draft.lastChance)}. ${ships.length === 0 ? 'No enemy ship is in its arc after turning.' : `${ships.length} enemy ship${ships.length === 1 ? ' is' : 's are'} in the arc: click one on the board to track it.`}`),
    ];
  }

  /** The range of fire of the capital ships (like the arcs of turret guns): all that can fire, if the button is on, and the one under the mouse or selected, whoever's it is. */
  private addCapitalRangeOverlay(overlay: Overlay): void {
    const g = this.game;
    if (!g.destroyers?.length) return;
    const ranges = new Set<string>();
    if (this.showCapitalRange) for (const d of g.destroyers) if (d.pos && !d.exploded && canFire(d)) ranges.add(d.id);
    if (this.hovered && g.destroyers.some((d) => d.id === this.hovered && d.pos && !d.exploded)) ranges.add(this.hovered);
    if (this.selected && g.destroyers.some((d) => d.id === this.selected && d.pos && !d.exploded)) ranges.add(this.selected);
    overlay.capitalRanges = [...ranges];
  }

  /** What the board shows of the turret guns: their arcs (the danger zones), and, while the plans are made, the orders so far. */
  private addTurretOverlay(overlay: Overlay): void {
    const g = this.game;
    if (!g.emplacements?.length) return;
    this.ensureTurretDraft();
    const arcs = new Set<string>();
    if (this.showTurretArcs) for (const e of g.emplacements) if (e.status === 'active' && e.owner !== this.human) arcs.add(e.id);
    // the turret gun under the mouse shows its arc, whoever's it is
    if (this.hovered && g.emplacements.some((e) => e.id === this.hovered && e.status === 'active')) arcs.add(this.hovered);
    if (this.turretsPhase()) {
      overlay.turretDraft = Object.fromEntries([...this.turretDraft.keys()].map((id) => [id, { facing: this.draftFacing(id), target: this.turretDraft.get(id)!.target }]));
      overlay.turretClickable = [...this.turretDraft.keys()];
      overlay.turretSelected = this.turretSel;
      if (this.turretSel) {
        arcs.add(this.turretSel);
        overlay.targets = this.turretArcShips(this.turretSel).map((s) => s.id);
        const tracked = this.turretDraft.get(this.turretSel)?.target;
        overlay.aimed = tracked ? [tracked] : [];
        const turret = g.emplacements.find((e) => e.id === this.turretSel);
        if (turret) overlay.turn = { pos: turret.pos, facing: this.draftFacing(turret.id) };
      }
    }
    overlay.turretArcs = [...arcs];
  }

  // ------------------------------------------------------------------ advanced initiative (19)

  /** The ship whose turn it is to say when it moves, when that is one of the human's. */
  private myPickShip(): Ship | null {
    const g = this.game;
    const id = g.phase === 'initiative' && g.initiativeTable ? nextPicker(g.initiativeTable) : null;
    const ship = id ? shipById(g, id) : undefined;
    return ship && ship.owner === this.human && !g.pending ? ship : null;
  }

  private moveWithButton(target: Ship): HTMLElement {
    return h('button', { class: 'primary cardmove', title: `The ship moves with ${fullName(target)}, before or after it as its owner decides when its turn comes`, onclick: (e: Event) => { e.stopPropagation(); this.send({ type: 'slot', player: this.human, moveWith: target.id }); } }, 'Move with');
  }

  /** What the initiative table says about a ship: its roll, then its slot or the ship it moves with. */
  private initiativeTag(ship: Ship, short: boolean): HTMLElement | null {
    const table = this.game.initiativeTable;
    if (!this.game.advancedInitiative || !table || !(ship.id in table.rolls)) return null;
    const slot = slotOf(table, ship.id);
    const leader = table.follows[ship.id];
    const where = slot >= 0 ? `slot ${slot + 1}` : leader ? `with ${shortName(shipById(this.game, leader)!)}` : 'no slot yet';
    return h('span', { class: 'tag init', title: `Piloting roll ${table.rolls[ship.id]} in the Initiative Phase` }, short ? `${table.rolls[ship.id]} · ${where}` : `roll ${table.rolls[ship.id]} · ${where}`);
  }

  /** A ship in the initiative table: its picture, its name (as long as the right column allows), and its roll. */
  private initChip(ship: Ship): HTMLElement {
    const table = this.game.initiativeTable!;
    const icons = this.sideLevel === 2;
    return h('span', { class: 'initchip' + (ship.status !== 'active' ? ' gone' : '') + (this.selected === ship.id ? ' sel' : ''), title: `${fullName(ship)}: piloting roll ${table.rolls[ship.id]}`,
      onmouseenter: () => this.setHovered(ship.id), onmouseleave: () => this.setHovered(null),
      onclick: () => { this.pickShip(ship.id); if (ship.pos) this.board.reveal(ship.pos, 90); this.render(); } },
      this.thumbnail(ship),
      h('b', null, icons || this.sideLevel === 1 ? shortName(ship) : fullName(ship)),
      icons ? null : h('span', { class: 'tag' }, String(table.rolls[ship.id])),
    );
  }

  /**
   * The initiative table (19): the slots in the order of movement, each with the ship that moves then and, under it and a little to the left, the ships that move
   * with it. Ships that move with a ship that has no slot yet are listed under the table. While the owner picks, the free slots are buttons.
   */
  private initiativePanel(): HTMLElement | null {
    const g = this.game;
    const table = g.initiativeTable;
    if (!g.advancedInitiative || !table || !['initiative', 'planning', 'ships'].includes(g.phase)) return null;
    const asking = this.myPickShip();
    const now = g.phase === 'ships' ? table.cursor - 1 : -1;
    const chain = (lead: string): HTMLElement[] =>
      chainFrom(table, lead).slice(1).map((id) => h('div', { class: 'initfollow' }, h('span', { class: 'initwith' }, '↳ with'), this.initChip(shipById(g, id)!)));
    // once the picking is over, a slot nobody took (its ship moves with another) says nothing and is left out
    const rows = table.slots.flatMap((lead, i) => {
      if (!lead && g.phase !== 'initiative') return [];
      const done = g.phase === 'ships' && i < now;
      const cls = 'initrow' + (i === now ? ' now' : '') + (done ? ' done' : '') + (!lead ? ' free' : '');
      let body: Child[];
      if (lead) body = [h('div', { class: 'initlead' }, this.initChip(shipById(g, lead)!)), ...chain(lead)];
      else if (asking) body = [h('button', { class: 'initfree primary', title: `${fullName(asking)} moves ${slotName(i)}`, onclick: () => this.send({ type: 'slot', player: this.human, slot: i + 1 }) }, `Take slot ${i + 1}`)];
      else body = [h('span', { class: 'initempty' }, 'free')];
      return [h('div', { class: cls }, h('span', { class: 'initno' }, String(i + 1)), h('div', { class: 'initbody' }, ...body))];
    });
    // ships that move with a ship that has not chosen its slot yet
    const waiting = Object.keys(table.follows).filter((id) => slotOf(table, rootOf(table, id)) < 0);
    const unslotted = waiting.length
      ? [h('h4', null, this.sideLevel === 2 ? 'With' : 'Moving with a ship that has no slot yet'), ...waiting.map((id) => h('div', { class: 'initfollow pending' }, this.initChip(shipById(g, id)!), h('span', { class: 'initwith' }, ' → with '), this.initChip(shipById(g, table.follows[id]!)!)))]
      : [];
    // while the owners pick: the ships in the order of their rolls, one to a line, then the slots they pick from
    const picking = g.phase === 'initiative';
    const picks = picking
      ? [h('div', { class: 'initorder' }, ...table.order.map((id) => {
          const declared = slotOf(table, id) >= 0 || id in table.follows;
          return h('div', { class: 'initpick' + (declared ? ' declared' : '') + (nextPicker(table) === id ? ' next' : '') }, this.initChip(shipById(g, id)!));
        })),
        h('h4', null, 'Order of movement')]
      : [];
    return h('section', { class: 'inittable' }, h('h3', null, picking ? 'Initiative picking order' : 'Order of movement'), ...picks, ...rows, ...unslotted);
  }

  // ------------------------------------------------------------------ ship cards and log

  /**
   * The list of ships. Normally every ship; when the player chooses the ship to move, the ships that may move come first with a Move button and
   * the others follow dimmed; while aiming, the ships that can be shot come first with their chance, and the others follow dimmed.
   */
  private shipList(): HTMLElement[] {
    const g = this.game;
    const ships = g.ships
      .filter((s) => s.status === 'active' && (g.phase !== 'setup' || s.owner === this.human))
      .sort((a, b) => Number(b.owner === this.human) - Number(a.owner === this.human) || a.id.localeCompare(b.id));
    const icons = this.sideLevel === 2;
    // the narrowest column has room for one short word
    const section = (text: string, short = text): HTMLElement => h('h4', null, icons ? short : text);
    const asking = this.myPickShip();
    if (asking) {
      // advanced initiative: the ships this one tails may be moved with; the others are only to look at
      const options = new Set(moveWithOptions(g, asking));
      const rest = ships.filter((s) => !options.has(s.id));
      return [
        ...(options.size ? [section('Move with one of these', 'With'), ...ships.filter((s) => options.has(s.id)).map((s) => this.shipCard(s, { moveWith: true }))] : []),
        ...(rest.length ? [...(options.size ? [section('Other ships', 'Ships')] : []), ...rest.map((s) => this.shipCard(s, options.size ? { dim: true } : {}))] : []),
      ];
    }
    if (this.choosing()) {
      const movable = ships.filter((s) => !s.moved);
      const moved = ships.filter((s) => s.moved);
      return [
        section('Choose a ship to move', 'Move'),
        ...movable.map((s) => this.shipCard(s, { move: true })),
        ...(moved.length ? [section('Already moved', 'Moved'), ...moved.map((s) => this.shipCard(s, { dim: true }))] : []),
        ...this.destroyerSection(),
      ];
    }
    const targets = this.targetEntries();
    if (targets) {
      const crew = this.aim!.active;
      const member = crewOf(this.currentHumanShip()!).find((c) => c.id === crew);
      const ids = new Set(targets.map((e) => e.t.id));
      const rest = ships.filter((s) => !ids.has(s.id));
      const emplacements = this.emplacementEntries();
      const sdEntries = this.destroyerEntries();
      const any = targets.length + emplacements.length + sdEntries.length > 0;
      return [
        section(any ? `Pick a target for the ${member?.label.toLowerCase() ?? 'crew member'}` : 'No enemy ship is within reach', any ? 'Target' : 'None'),
        ...targets.map((e) => this.shipCard(e.t, { target: e })),
        ...emplacements.map((e) => this.emplacementCard(e)),
        ...sdEntries.map((e) => this.destroyerCard(e)),
        ...(rest.length ? [section(targets.length ? 'Out of reach' : 'Ships', targets.length ? 'Out' : 'Ships'), ...rest.map((s) => this.shipCard(s, { dim: true }))] : []),
      ];
    }
    return [...ships.map((s) => this.shipCard(s)), ...this.destroyerSection(), ...this.reserveSection()];
  }

  /** The ships that wait off the map (Rules: Reserves): how many, whose, and when they can come in. */
  private reserveSection(): HTMLElement[] {
    const g = this.game;
    const waiting = (g.reserves ?? []).filter((r) => !r.entered);
    if (waiting.length === 0) return [];
    const icons = this.sideLevel === 2;
    return [
      h('h4', null, icons ? 'Wait' : 'In reserve'),
      ...waiting.map((r) => {
        const ships = r.shipIds.map((id) => shipById(g, id)!).filter((x) => x.status === 'reserve');
        const kinds = [...new Set(ships.map((x) => typeOf(x).name))].map((name) => `${ships.filter((x) => typeOf(x).name === name).length} × ${name}`).join(', ');
        const mine = r.owner === this.human;
        const when = r.entry.kind === 'scheduled'
          ? `Come in after game-turn ${r.entry.afterTurn}.`
          : r.entry.kind === 'declared'
            ? `${mine ? 'You bring' : 'The ' + SIDE_NAMES[r.owner] + ' can bring'} them in at the start of a game-turn from game-turn ${r.entry.fromTurn} on.`
            : `${mine ? 'You try' : 'The ' + SIDE_NAMES[r.owner] + ' can try'} to bring them in at the start of a game-turn from game-turn ${r.entry.fromTurn} on, with a die roll.`;
        return h('div', { class: 'shipcard dim reserve', title: `${kinds}. ${when}` },
          h('div', { class: 'shiptitle' }, h('b', { style: { color: SIDE_COLORS[r.owner] } }, icons ? String(ships.length) : kinds)),
          icons ? null : h('div', { class: 'motion' }, when),
        );
      }),
    ];
  }

  private shipCard(ship: Ship, o: CardOptions = {}): HTMLElement {
    const g = this.game;
    const type = typeOf(ship);
    const level = this.sideLevel;
    const compact = level === 1;
    // while the human is still planning, their own ships show what the draft plan would give
    const drafting = g.phase === 'planning' && !g.planSubmitted[this.human] && ship.owner === this.human;
    const motion = motionOf(g, ship, drafting ? this.plans[ship.id] ?? emptyPlan() : undefined);
    const hullTotal = bodyRating(g, type);
    const hull = `${Math.max(0, hullTotal - ship.bodyDamage)}/${hullTotal}`;
    // units of auxiliary power and the R2 unit, when those rules are in effect
    const power = [
      ...(g.damageRules ? [ship.aux ? `Aux ${ship.aux}` : null, ship.r2?.aboard ? 'R2' : null].filter((x): x is string => x !== null) : []),
      // projectiles left, when the rule for missiles, torpedoes and bombs is in effect (22)
      ...(ship.projectiles !== undefined && specialOf(type) ? [`${specialOf(type)!.kind} ${ship.projectiles}`] : []),
    ];
    const hasShields = ship.shields.front + ship.shields.rear + ship.shields.left + ship.shields.right > 0 || !!type.shields;
    const tags = [
      this.initiativeTag(ship, compact),
      ship.tag && ship.status === 'active' ? h('span', { class: 'tag role' }, ship.tag) : null,
      ship.moved && !o.dim ? h('span', { class: 'tag' }, 'moved') : null,
      drafting && this.submitted.has(ship.id) ? h('span', { class: 'tag ok' }, compact ? '✓' : 'submitted') : null,
    ];
    const title = h('div', { class: 'shiptitle' },
      this.thumbnail(ship),
      h('b', null, compact ? shortName(ship) : fullName(ship)),
      ...tags,
      o.move ? h('button', { class: 'primary cardmove', title: 'Move this ship now', onclick: (e: Event) => { e.stopPropagation(); this.chooseShip(ship.id); } }, 'Move') : null,
      o.moveWith ? this.moveWithButton(ship) : null,
    );
    const classes = 'shipcard' + (compact ? ' compact' : '') + (this.selected === ship.id ? ' sel' : '') + (ship.moved ? ' moved' : '') + (o.dim ? ' dim' : '') + (o.target ? ' target' + (o.target.aimedGuns.length ? ' aimed' : '') : '');
    const onclick = (): void => {
      if (o.target && !o.target.done) {
        this.aimTarget(ship.id);
        return;
      }
      this.pickShip(ship.id);
      if (ship.pos) this.board.reveal(ship.pos, 90);
      this.render();
    };
    const head = { class: classes, onmouseenter: () => this.setHovered(ship.id), onmouseleave: () => this.setHovered(null), onclick };
    if (level === 2) return this.iconCard(ship, o, head, motion, hull, hasShields, power);
    if (compact) {
      const sp = motion.planned ? `${motion.speed}→${motion.planned.speed}` : `${motion.speed}`;
      const tn = motion.planned ? `${fmtTurn(motion.turn)}→${fmtTurn(motion.planned.turn)}` : fmtTurn(motion.turn);
      return h('div', head,
        title,
        h('div', { class: 'stats cstats' },
          h('span', null, `Sp ${sp}`), h('span', null, `T ${tn}`), h('span', null, `HP ${hull}`),
          hasShields ? h('span', null, `Sh ${shieldBrief(g, ship)}`) : null,
          ...power.map((t) => h('span', null, t)),
        ),
        ...(o.target ? this.targetBlock(o.target) : []),
      );
    }
    const markers: string[] = [];
    if (ship.stabilizerDamage) markers.push(`stabilizer ×${ship.stabilizerDamage}`);
    if (ship.lateralDamage) markers.push(`lateral ×${ship.lateralDamage}`);
    if (ship.actionPenalty) markers.push(`action penalty +${ship.actionPenalty * 3}`);
    if (ship.forcedRoll) markers.push(`forced roll ×${ship.forcedRoll}`);
    if (ship.maxSpeed < type.speedMax) markers.push(`max speed ${ship.maxSpeed}`);
    const revealed = g.phase === 'ships' || ship.owner === this.human;
    const planned = revealed && g.phase === 'ships'
      ? (Object.entries(ship.plan).filter(([, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${k}${v === 2 ? ' ×2' : ''}`))
      : [];
    const tailing = activeShips(g).filter((e) => tails(ship, e)).map(shortName);
    const tailedBy = activeShips(g).filter((e) => tails(e, ship)).map(shortName);
    return h('div', head,
      title,
      h('div', { class: 'motion' }, motionText(motion)),
      h('div', { class: 'stats' }, `Max speed ${ship.maxSpeed} · Hull ${hull}`, hasShields ? ` · Shields ${shieldBrief(g, ship)}` : '', power.length ? ` · ${power.join(' · ')}` : ''),
      markers.length ? h('div', { class: 'markers' }, markers.join(' · ')) : null,
      planned.length ? h('div', { class: 'planned' }, `Plan: ${planned.join(', ')}`) : null,
      tailing.length ? h('div', { class: 'tailing' }, `Tailing ${tailing.join(', ')}`) : null,
      tailedBy.length ? h('div', { class: 'tailedby' }, `Tailed by ${tailedBy.join(', ')}`) : null,
      ...(o.target ? this.targetBlock(o.target) : []),
    );
  }

  /** The narrowest card: the ship's picture with its code under it (and the chance to hit, or a Move button, when it is a choice). The rest is in the tooltip. */
  private iconCard(ship: Ship, o: CardOptions, head: { class: string; onmouseenter: () => void; onmouseleave: () => void; onclick: () => void }, motion: Motion, hull: string, hasShields: boolean, power: string[]): HTMLElement {
    const sp = motion.planned ? `${motion.speed}→${motion.planned.speed}` : `${motion.speed}`;
    const tn = motion.planned ? `${fmtTurn(motion.turn)}→${fmtTurn(motion.planned.turn)}` : fmtTurn(motion.turn);
    const facts = [fullName(ship), `Sp ${sp}`, `T ${tn}`, `HP ${hull}`, hasShields ? `Sh ${shieldBrief(this.game, ship)}` : '', ...power].filter(Boolean).join(' · ');
    const aim = o.target ? ` · ${percent(o.target.o.chance)} to hit at range ${o.target.range}, difficulty ${o.target.o.preview.difficulty}${o.target.aimedGuns.length ? `, aimed: ${o.target.aimedGuns.join(', ')}` : ''}` : '';
    const drafting = this.game.phase === 'planning' && !this.game.planSubmitted[this.human] && ship.owner === this.human;
    return h('div', { ...head, class: `${head.class} icon`, title: facts + aim },
      this.thumbnail(ship),
      h('div', { class: 'icode' }, shortName(ship), drafting && this.submitted.has(ship.id) ? ' ✓' : ''),
      o.target ? h('div', { class: 'tcchance' }, percent(o.target.o.chance)) : null,
      o.move ? h('button', { class: 'primary cardmove', title: 'Move this ship now', onclick: (e: Event) => { e.stopPropagation(); this.chooseShip(ship.id); } }, 'Move') : null,
      o.moveWith ? this.moveWithButton(ship) : null,
    );
  }

  /** A small picture of the ship in its side's colour, turned the way the ship faces on the board; a plain dot when there is no picture. */
  private thumbnail(ship: Ship): HTMLElement {
    const color = SIDE_COLORS[ship.owner];
    const facing = this.game.phase === 'setup' ? this.draft.get(ship.id)?.facing ?? ship.facing : ship.facing;
    const url = spriteUrl(ship.typeId, facing);
    const dot = h('span', { class: 'dot', style: { background: color } });
    if (!url) return dot;
    const img = h('img', { class: 'thumb', src: url, alt: '', style: { border: `2px solid ${color}`, background: `${color}33` } });
    img.addEventListener('error', () => img.replaceWith(dot));
    return img;
  }

  /** The game log, in its own panel on the left. It follows new events unless the player has scrolled up. */
  private renderLog(): void {
    const panel = this.logEl;
    clear(panel);
    const box = h('div', { class: 'log' }, ...logLines(this.game.log.slice(-600), this.logFull, this.labels));
    const toggle = h('label', { class: 'logtoggle', title: 'Show every sentence in full, with all the numbers behind each roll' },
      h('input', { type: 'checkbox', checked: this.logFull, onchange: (e: Event) => { this.logFull = (e.target as HTMLInputElement).checked; this.renderLog(); } }),
      ' Full text');
    panel.append(h('div', { class: 'loghead' }, h('h3', null, 'Game log'), toggle), box);
    // the newest line is always in view: scroll up to read, the next line brings the log back down
    box.scrollTop = box.scrollHeight;
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }
}

/** What a scenario file says about itself on its card: its own description, or the forces of both sides. */
function scenarioLines(def: ScenarioDef): string[] {
  if (def.description?.length) return def.description;
  const side = (i: 0 | 1): string => {
    const counts = new Map<string, number>();
    for (const sh of def.sides[i].ships) {
      const key = `${SHIPS[sh.typeId]?.name ?? sh.typeId} (${sh.quality} pilot)`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return `${i === 0 ? 'Rebels' : 'Empire'}: ${[...counts].map(([k, n]) => (n > 1 ? `${n} × ${k}` : k)).join(', ') || 'no ships'}.`;
  };
  return [side(0), side(1)];
}

/** One line of a difficulty or power breakdown: the first line is the starting number, the others are modifiers. */
function partRow(p: DifficultyPart, first: boolean): HTMLElement {
  const sign = first ? String(p.value) : p.value > 0 ? `+${p.value}` : p.value < 0 ? `−${-p.value}` : '±0';
  const cls = first ? 'base' : p.value > 0 ? 'harder' : p.value < 0 ? 'easier' : 'zero';
  return h('div', { class: `bdrow ${cls}` }, h('span', { class: 'bdlabel' }, p.label), h('span', { class: 'bdval' }, sign));
}

function nearestOf(shooter: Ship, ships: Ship[]): Ship {
  return ships.reduce((a, b) => (hexDistance(shooter.pos!, b.pos!) < hexDistance(shooter.pos!, a.pos!) ? b : a));
}

function stepLabel(step: MoveStep): string {
  switch (step) {
    case 'forward': return '↑';
    case 'slipLeft': return '⇖';
    case 'slipRight': return '⇗';
    case 'turnLeft': return '⟲';
    case 'turnRight': return '⟳';
    case 'halfLoop': return '↺';
    case 'snapFire': return '✱';
  }
}

import type { Facing, Hex } from './hex';
import type { Level } from './fire';
import type { ShieldBox } from './data';
import type { MapSpec } from './movement';
import type { PilotQuality, SkillCode, SkillReduction } from './skill';
import type { Force } from './purchase';
import type { Plan, PlanAction } from './plan';
import type { RepairNotes, R2Unit } from './repair';
import type { AsteroidField, RockFrame } from './asteroids';
import type { BaseKit, Emplacement, GroundTarget, MapEdge, TurretOrder } from './emplacements';
import type { ReserveGroup } from './reserves';
import type { Destroyer } from './destroyers';
import type { InitiativeTable, Placing } from './initiative';
import type { ScenarioRules } from './scenario';

export type PlayerId = 0 | 1;

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** 'reserve': not on the map yet; it comes in later (Rules: Reserves) and takes part in nothing until then. */
export type ShipStatus = 'active' | 'destroyed' | 'escaped' | 'reserve';

/** One piece of damage a ship has suffered, kept so the interface can show what happened to it. */
export interface Wound {
  turn: number;
  kind: 'body' | 'shield' | 'aux' | 'r2' | 'repair' | 'engine' | 'gun' | 'lateral' | 'stabilizer' | 'penalty' | 'pilot' | 'speed' | 'roll' | 'turn' | 'lose';
  text: string;
  /** The ship that fired, or the hazard row, when known. */
  source?: string;
  /** In a move: the step (of the command's steps) during which it was suffered, for the playback to show it there. */
  moveStep?: number;
  /** In the asteroid phase: the frame of the asteroid movement (see `GameEvent.rocks`) in which an asteroid struck the ship. */
  frame?: number;
}

/** A gunner (14): their own skill and plan; a dead gunner (Sk-1 hits, 14) does nothing more. */
export interface Gunner {
  quality: PilotQuality;
  skill: SkillCode;
  /** What the gunner plans this game-turn: only pinpoint fire, snap fire, targeting and angling deflectors (Rules: Gunners and turrets). */
  plan: Plan;
  dead?: boolean;
}

export interface Ship {
  id: string;
  owner: PlayerId;
  typeId: string;
  /** Number printed on the counter, distinguishing ships of the same type (Rules: Ships and crews). */
  idNumber: number;
  quality: PilotQuality;
  /** A label the scenario gave the ship, such as convoy: the rules of the scenario speak of the ships that carry it (30). */
  tag?: string;
  /** The reserve group of a ship that comes in later (Rules: Reserves). */
  reserve?: string;
  /** The Star Destroyers that have fired at it and marked it: 5 easier for them next time (Rules: Star Destroyers). */
  sdMarkers?: string[];
  pilotSkill: SkillCode;
  gunnerySkill: SkillCode;
  /** The gunners bought for this ship (35), with their skills. Only ships bought in a points game have any; the gunner rules (14) are not in yet. */
  gunners?: Gunner[];
  status: ShipStatus;

  pos: Hex | null;
  facing: Facing;
  /** Throttle position: the ship's current speed (Rules: Markers step). */
  speed: number;
  /** Current maximum speed; engine damage lowers it. */
  maxSpeed: number;

  /** Gun codes; null once a gun is destroyed. */
  guns: (string | null)[];
  bodyDamage: number;
  /** Shield markers in the boxes of the Deflector Shields section (each x2 marker counts as 2). Left and right stay empty unless the advanced arcs are played (Rules: Advanced arcs). */
  shields: Record<ShieldBox, number>;

  /** Persistent markers (13). */
  stabilizerDamage: Level;
  lateralDamage: Level;
  /** Action penalty box for this game-turn's hazard phase: 0, 1 (+3) or 2 (+6). */
  actionPenalty: Level;
  /** Penalties suffered this game-turn that take effect next turn (red marker). */
  pendingPenalty: Level;

  /** Projectiles left for the ship's missiles, torpedoes or bombs (Rules: Missiles, torpedoes and bombs); only when those rules are in effect. */
  projectiles?: number;
  /** The ship turned in the last hex of its move: it may not fire special weapons now (Rules: Missiles, torpedoes and bombs). */
  turnedInLastHex?: boolean;
  /** Auxiliary power units left (Rules: R2 units, auxiliary power and damage control); only when the R2, auxiliary power and damage control rules are in effect. */
  aux?: number;
  /** The R2 unit of a ship that carries one (Rules: R2 units, auxiliary power and damage control): still aboard, and whether it may plan free actions this game-turn (Rules: R2 units, auxiliary power and damage control). */
  r2?: R2Unit;
  /** Systems that damage control has damaged beyond repair (Rules: R2 units, auxiliary power and damage control). */
  noRepair?: RepairNotes;

  /** Effects that carry into the next planning phase (red markers become the next turn's plan). */
  forcedRoll: Level;
  forcedOverspeed: Level;
  /** Overspeed caused by a random speed change this game-turn (Rules: Markers step). */
  hazardOverspeed: Level;

  /** T+n results this game-turn (Rules: Hazards). */
  turnPenalty: number;

  plan: Plan;
  /** Tracking marker placed by the targeting action this game-turn (Rules: Tailing and targeting). */
  tracking: { target: string; level: Level } | null;
  /** Who has fired each turret this game-turn, by gun: a turret is fired by the pilot or by its gunner, not both (Rules: Gunners and turrets). */
  turretClaims?: Record<number, string>;
  /** Ship counter shows its blue-striped side: it has moved this game-turn (Rules: Ships and crews). */
  moved: boolean;
  /** Everything that has damaged this ship, oldest first. */
  wounds: Wound[];
}

/** One gun firing at one target, kept in the log so the interface can play it back. */
export interface ShotRecord {
  /** A ship's id, or an emplacement's ("E3"). */
  shooter: string;
  target: string;
  gun: string;
  ion: boolean;
  hit: boolean;
  range: number;
  /** Where the shooter stood when firing (for a snap shot, partway through its move) and where the target was. */
  from: Hex;
  to: Hex;
  /** What a hit did, for the picture of it: only shields hurt, the hull was hurt, a lot was done, or an asteroid broke. */
  effect?: 'shield' | 'hull' | 'heavy' | 'rock';
}

/** How a piece of a log line is coloured: an outcome, or the side of the ship it names. */
export type Tone = 'good' | 'warn' | 'bad' | 'gold' | 'muted' | 'miss' | 'p0' | 'p1';

/** A piece of a short log line. */
export interface Seg {
  t: string;
  tone?: Tone;
  /** A hex number: the short log leaves it out unless the player has asked to see hex numbers. */
  hex?: boolean;
}

/** One piece of damage, so that several in a row can be told as one sentence ("suffers +6 penalty and loses overturn"). */
export interface HurtRecord {
  shipId: string;
  name: Seg;
  /** Pieces with the same key are merged: counts add up, the latest wording wins. */
  key: string;
  verb: string;
  noun: string;
  count?: number;
}

export interface GameEvent {
  turn: number;
  kind: string;
  text: string;
  /** Present on the 'fire' events. */
  shot?: ShotRecord;
  /** The short, coloured version of the line the log shows by default; `text` is the full one. */
  brief?: Seg[];
  /** A detail of the line above it (a roll behind a result): shown indented and quiet. */
  detail?: boolean;
  /** Present on damage events. */
  hurt?: HurtRecord;
  /** Present on the event that tells of the asteroids moving: what moved, in order, for the animation (24). */
  rocks?: RockFrame[];
  /** In a move: the step (of the command's steps) during which this happened, so that the playback can show it where it happened. */
  moveStep?: number;
  /** On a 'destroyed' event: the ship that was destroyed. */
  shipId?: string;
  /** In the asteroid phase: the frame of the asteroid movement in which this happened. */
  frame?: number;
}

/** A choice the game needs from a player before it can continue. */
export type Pending =
  | { kind: 'lose'; player: PlayerId; shipId: string; letter: string; options: PlanAction[]; /** Whose action is lost: 'pilot' or a gunner. */ crew?: string }
  /** A Sk-1 hit on a ship with a gunner: the owner chooses who is hurt (Rules: Damage). */
  | { kind: 'skill'; player: PlayerId; shipId: string; options: string[]; /** The ship whose shot it was (for the victory point). */ shooter?: string }
  | { kind: 'gun'; player: PlayerId; shipId: string; options: number[] }
  /** A P result on a ship that can lose something else instead of a shield (Rules: Damage): what goes, with `left` units still to lose. */
  | { kind: 'power'; player: PlayerId; shipId: string; options: PowerLoss[]; box: ShieldBox; left: number; ion: boolean; shooter?: string }
  | { kind: 'steal'; player: PlayerId; target: string; candidates: string[]; queue: string[]; chooser: PlayerId }
  | { kind: 'pass'; player: PlayerId; candidates: string[]; queue: string[]; chooser: PlayerId }
  /** Advanced initiative (19.22): `ship` moves with the ship before it in `chain`; its owner says whether it moves before or after it. `placing` holds the answers so far for the links before it. */
  | { kind: 'follow'; player: PlayerId; ship: string; leader: string; chain: string[]; placing: Placing[] };

/** Work the game still has to do; processed in order until a decision is needed. */
export type Task =
  | { t: 'hazard'; shipId: string; crew?: string }
  | { t: 'code'; shipId: string; code: string; row: string | null; fromFire: boolean; quarter?: ShieldBox; ion?: boolean; shooter?: string; crew?: string; /** The step of a move whose snap fire this is: its damage is told with that step. */ step?: number }
  | { t: 'markers' }
  | { t: 'asteroids' }
  | { t: 'destroyers' }
  | { t: 'startShips' }
  | { t: 'afterMove' }
  | { t: 'endShip' };

export interface ActivePhase {
  /** Ships that will move, in order (steals and passes put ships before the one chosen). */
  queue: string[];
  index: number;
  chooser: PlayerId;
  stage: 'move' | 'fire';
  /** The full-turn movement context, fixed when movement starts. */
  waived: string[];
}

/** 'entry': the owner of a reserve group decides whether it comes in now; 'arrival': a group that comes in is placed (Rules: Reserves). */
export type GamePhase = 'forces' | 'setup' | 'entry' | 'arrival' | 'initiative' | 'planning' | 'destroyers' | 'ships' | 'over';

/** A game with ships bought by points (35): how many points each side has, and what each has bought (secret until both have). */
export interface Purchase {
  limits: [number, number];
  /** Set when one player chooses both forces (a scenario made to make sense): only that player may buy, for both sides, in one go. */
  chooser?: PlayerId;
  chosen: [Force | null, Force | null];
}

/** What a power loss (P) takes from a ship: a shield, a unit of auxiliary power, the R2 unit, or (no shield left) a body point. */
export type PowerLoss = 'shield' | 'aux' | 'r2' | 'body';

export interface GameState {
  /** The Star Destroyers of the game (Rules: Star Destroyers), and who moves next while they move (phase 'destroyers'). */
  destroyers?: Destroyer[];
  destroyerQueue?: { ids: string[]; index: number };
  /**
   * The capital ships have all moved and now pick their targets (Rules: Star Destroyers, the owner's rule for more than one capital ship on a side): `order` are the
   * ships that fire at an enemy capital ship, `asking` the ones whose owner still has to pick (more than one target), `declared` the targets so far.
   */
  capitalTargets?: { order: string[]; asking: string[]; declared: Record<string, string> };
  /** Ships that wait off the map and come in later, by group (Rules: Reserves). */
  reserves?: ReserveGroup[];
  /** The reserve group the owner decides about (phase 'entry'). */
  entry?: { group: string };
  /** The reserve group that is being placed (phase 'arrival'), and what follows: the next game-turn, or the rest of the entry decisions of this one. */
  arrival?: { group: string; then: 'turn' | 'entry' };
  /** A side that picks the edge it starts along, from the options the scenario gives (Rules: Reserves), and the edge once it has. */
  edgeChoice?: { side: PlayerId; options: MapEdge[]; edge: MapEdge | null };
  /** The gun emplacements (20) of a game that has them, and the ground target of the Ground Attack (29). */
  emplacements?: Emplacement[];
  groundTarget?: GroundTarget;
  /** The Ground Attack (29): which side attacks. The game ends when the attackers are gone. */
  /** The Ground Attack (29): which side attacks, and the edge the attackers come from once they have chosen it (Rules: Ground attack). */
  groundAttack?: { attacker: PlayerId; edge?: MapEdge };
  /**
   * The defender places the ground target and the base by hand (Rules: Ground attack) before anybody places ships; `done` once they have. Missing when the game
   * made the layout itself (a computer defender).
   */
  baseSetup?: { defender: PlayerId; kit: BaseKit; turretSkill: SkillCode; done: boolean };
  /**
   * While planning: the turret orders each player has given so far (rotations, tracking and when to fire, see Rules: Ground attack), null for none yet. They stay hidden
   * from the other side and take effect when both have planned.
   */
  turretOrders?: [TurretOrder[] | null, TurretOrder[] | null];
  /** The asteroid field (24), when the game has one: it makes the map static. */
  asteroids?: AsteroidField;
  /** The rules for missiles, torpedoes and bombs (22) are in effect. */
  specialWeapons?: boolean;
  /** The R2, auxiliary power and damage control rules (16, 17) are in effect: ships use their second body rating (Rules: R2 units, auxiliary power and damage control). */
  damageRules?: boolean;
  /** Advanced initiative (19): every pilot rolls and the owners pick when each ship moves, in place of choosing ships one by one (9). */
  advancedInitiative?: boolean;
  /** Advanced arcs (Rules: Advanced arcs): a ship with a body rating of 10 or more has port and starboard quarters, and angles its shields left and right too. */
  advancedArcs?: boolean;
  /** What the scenario adds to the rules of the game: roles, victory points for escaping, how the game ends (30). */
  rules?: ScenarioRules;
  /** The initiative table of the game-turn under advanced initiative. */
  initiativeTable?: InitiativeTable;
  turn: number;
  phase: GamePhase;
  rngState: number;
  map: MapSpec;
  ships: Ship[];
  /** Present in a points game: the ships are created once both sides have bought theirs. */
  purchase?: Purchase;
  /** Kept to roll the skills of ships bought later. */
  skillReduction?: SkillReduction;
  /** Setup zones: which hexes each player may place ships in. */
  zones: [Hex[], Hex[]];
  placed: [boolean, boolean];
  planSubmitted: [boolean, boolean];
  initiative: PlayerId | null;
  chooser: PlayerId;
  active: ActivePhase | null;
  tasks: Task[];
  pending: Pending | null;
  vp: [number, number];
  winner: PlayerId | 'draw' | null;
  log: GameEvent[];
}

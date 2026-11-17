import scenariosFile from '../../data/scenarios.json';
import { getShip, type ShieldBox, type ShipType } from './data';
import { applyVariants, escapeVpOf, exitBlocked, gameShouldEnd, scenarioDef, verdictOf, winnerOf, type ScenarioRules, type Variant } from './scenario';
import { arrivalError, arrivalZone, entryGroups, rollNeeded, scheduledGroups, type ReserveDef, type ReserveGroup } from './reserves';
import {
  CAPITAL,
  capitalDistance,
  capitalNose,
  destroyerShields,
  isCapitalType,
  specOf,
  speedText,
  structureLeft,
  attackBoxes,
  canFire,
  canMove,
  crashDifficulty,
  destroyerHexes,
  destroyerMaxSpeed,
  destroyerMoveContext,
  destroyerSpeedChoices,
  destroyerSpeedNow,
  facingStep,
  hexesOf,
  nearestHexOf,
  rangeIndex,
  vitalResult,
  type Destroyer,
} from './destroyers';
import { describeDamageCode, parseDamageCode } from './damage';
import { degradeGun, parseGun, powerNumber, toHitNumber } from './guns';
import {
  ACTION_HAZARD_CODE,
  hazardDamageCodes,
  hazardRowSequence,
  hazardsFromRoll,
  totalDifficulty,
  type HazardCode,
} from './hazard';
import {
  DIRECTIONS,
  arcOf,
  canFireAt,
  facingRelation,
  hexDistance,
  hexEquals,
  isTailing,
  turnFacing,
  type Facing,
  type Hex,
} from './hex';
import { quarterOf, resolveHit, shotBreakdown, topRollBodyDamage, type DifficultyPart, type Level } from './fire';
import {
  STANDARD_MAP,
  LARGE_MAP,
  isStandardSize,
  applyStepToPosition,
  canComplete,
  exceedsOpenLimits,
  hexId,
  isOnMap,
  isTrackerComplete,
  legalSteps,
  startTracker,
  stepTracker,
  fromOffset,
  withFeasibleObligations,
  type MapSpec,
  type MoveContext,
  type MoveStep,
  type MoveTracker,
} from './movement';
import {
  PAY_GROUPS,
  PLAN_ACTIONS,
  auxSpent,
  clonePlan,
  freeSteps,
  groupLevel,
  isLadder,
  trimPay,
  emptyPlan,
  PLAN_LABELS,
  planDifficultyEntries,
  planDifficultyParts,
  planHazardLetters,
  planShapeError,
  type Plan,
  type PlanAction,
} from './plan';
import { roll2d6, rollDie, stateRng, type Rng } from './rng';
import { chainFrom, chainOrder, freeSlots, movesWithChain, followerOf, nextPicker, slotName, slotOf, type Placing } from './initiative';
import {
  GROUND_TARGET_BODY,
  GROUND_TARGET_ID,
  GROUND_TARGET_POINTS,
  TURRET_BODY,
  TURRET_POINTS,
  TURRET_FIRE_AT,
  TURRET_LAST_CHANCE,
  TURRET_SKILL,
  MAP_EDGES,
  attackerZoneFor,
  autoBase,
  baseItems,
  baseLayoutError,
  isEmplacementTarget,
  itemGuns,
  kitFor,
  turretName,
  turretPower,
  turretQuarter,
  turretReaches,
  turretToHit,
  defenderZone,
  type BaseKit,
  type MapEdge,
  type BasePlacement,
  type Emplacement,
  type TurretOrder,
  type GroundTarget,
} from './emplacements';
import { createField, driftTurn, moveEvents, nearestHex, reduceRock, rockAt, rockName, rockSize, spawnLost, coveredHexes, keyOf, type AsteroidOptions, type MotionHooks, type Rock, type RockFrame } from './asteroids';
import {
  GUNNER_ACTIONS,
  PILOT,
  allGuns,
  canCrewFire,
  crewGuns,
  crewLabel,
  crewOrPilot,
  crewPlans,
  gunReaches,
  gunSlot,
  gunnerCrewId,
  livingGunners,
  pilotGunOptions,
  planOf,
  seatOf,
} from './crew';
import { SPECIAL, SPECIAL_DICE, SPECIAL_NAMES, specialOf, specialReaches, specialToHit, type SpecialKind } from './special';
import { applyRepair, canRepair, describeRepairChoice, markBeyondRepair } from './repair';
import { MAX_LIMIT, MIN_LIMIT, bonusPoints, describeForceShip, forceCost, forceError, type Force, type ForceShip } from './purchase';
import { chanceAtLeast, reduceSkill, rollSkill, rollSkillCode, type PilotQuality, type SkillCode, type SkillReduction } from './skill';
import {
  other,
  type GameEvent,
  type GameState,
  type PlayerId,
  type Seg,
  type PowerLoss,
  type Ship,
  type Task,
  type Tone,
  type Wound,
} from './state';
import { baseTurnNumber, turnBreakdown } from './turn';

// ---------------------------------------------------------------- setup

export interface ShipSpec {
  owner: PlayerId;
  typeId: string;
  quality: PilotQuality;
  /** Gunners that came with the ship (a points game, 35). */
  gunners?: PilotQuality[];
  /** A label of the scenario (convoy) that its rules refer to. */
  tag?: string;
  /** The reserve group the ship waits in until it comes in (Rules: Reserves). */
  reserve?: string;
  /** A Star Destroyer's gunnery skill (5D when missing; Rules: Star Destroyers). */
  skill?: { dice: number; pips: number };
}

export interface GameOptions {
  seed: number;
  ships: ShipSpec[];
  map?: MapSpec;
  /** Bonus victory points each player starts with. */
  bonusVp?: [number, number];
  /** Narrows the dice that set the pilots' and gunners' skills at the start; play itself is unchanged. */
  skillReduction?: SkillReduction;
  /** A points game (35): the ship points of the Rebels and the Empire. the ship list is then empty, both sides buy theirs first. */
  points?: [number, number];
  /** In a points game: the player who chooses both forces, instead of each side buying its own. */
  forceChooser?: PlayerId;
  /** The R2, auxiliary power and damage control rules (16, 17) are in effect. */
  damageRules?: boolean;
  /** The rules for missiles, torpedoes and bombs (22) are in effect. */
  specialWeapons?: boolean;
  /** Advanced initiative (19): every pilot rolls and the owners pick when each ship moves. */
  advancedInitiative?: boolean;
  /** What the scenario adds to the rules: roles, victory points for escaping, how the game ends (30). */
  rules?: ScenarioRules;
  /** The groups of ships that come in later, and the edges a side may start along (Rules: Reserves). */
  reserves?: Record<string, ReserveDef>;
  startEdges?: [MapEdge[] | null, MapEdge[] | null];
  /** Changes to the forces that apply only with some options: the adjustable map, the special weapons (Rules: Scenarios; Ground attack; Convoy). */
  variants?: Variant[];
  /** Advanced arcs (Rules: Advanced arcs): port and starboard quarters, and shields angled left and right, for ships with a body rating of 10 or more. */
  advancedArcs?: boolean;
  /** An asteroid field (24): made at the start and drifting by itself. The map is static then. */
  asteroids?: AsteroidOptions;
  /** The gunnery skill of every flagship (Star Destroyer, Mon Calamari cruiser), instead of the one the scenario gives (a way to balance a scenario). */
  destroyerSkill?: { dice: number; pips: number };
  /** The Ground Attack (29): the defender has a ground target and this many double and single turret guns. The map is static. */
  groundAttack?: { attacker: PlayerId; doubles: number; singles: number; /** The defender places the ground target and the base by hand (a human defender); otherwise the game does. */ manualBase?: boolean; /** The skill of the turret guns (5D when missing); a way to balance the scenario. */ turretSkill?: { dice: number; pips: number }; /** Which ground attack mix it is (for the additions of the Advanced game, when the special weapon rules are on). */ mix?: 1 | 2 | 3 };
}

/** A ship type's body rating: the first number of the chart in the Standard Game, the second when the R2 and auxiliary power rules are in effect (Rules: R2 units, auxiliary power and damage control). */
export function bodyRating(game: { damageRules?: boolean }, type: ShipType): number {
  return type.body[game.damageRules ? 1 : 0];
}

/** Does the ship have the port and starboard quarters and the left and right shields of the advanced arcs (Rules: Advanced arcs)? Not with a body rating below 10 (Rules: Advanced arcs). */
export function hasSideQuarters(game: { advancedArcs?: boolean; damageRules?: boolean }, ship: Ship): boolean {
  return !!game.advancedArcs && bodyRating(game, getShip(ship.typeId)) >= 10;
}

/** The side of a ship that a shot from `from` strikes: the shield box that guards it and, for the Fire Table, its quarter (Rules: Fire; Advanced arcs). */
export function quarterAgainst(game: GameState, ship: Ship, from: Hex): ShieldBox {
  return quarterOf(ship.pos!, ship.facing, from, hasSideQuarters(game, ship));
}

/** Why a plan to angle deflectors cannot be carried out by this ship, if it cannot (Rules: Markers step; Advanced arcs). */
function shieldMoveError(game: GameState, ship: Ship, plan: Plan): string | null {
  if (plan.angleDeflectors === 0 || !plan.deflectorDirection) return null;
  const to = plan.deflectorDirection;
  const from = plan.deflectorFrom ?? (to === 'front' ? 'rear' : 'front');
  if (from === to) return 'The shields are already angled that way; choose another box to move them to.';
  const standard = (box: ShieldBox): boolean => box === 'front' || box === 'rear';
  if (!hasSideQuarters(game, ship) && !(standard(from) && standard(to))) {
    return 'Only a ship with a body rating of 10 or more can angle its shields to the left and right, and only with the advanced arcs.';
  }
  return null;
}

const SCORING = scenariosFile as unknown as {
  shipValue: Record<string, number>;
  pilotValue: Record<PilotQuality, number>;
  gunnerValue: Record<PilotQuality, number>;
};

/** The scenario a game was started from: a printed ship mix, or 'points' for forces bought with points (35). */
export type DogfightMix = 'asteroid2' | 'one' | 'two' | 'three' | 'four' | 'showcase' | 'points' | 'ground1' | 'ground2' | 'ground3' | 'convoy1' | 'convoy2' | 'convoy3' | (string & {});

/** The options of a scenario of data/scenarios.json (see scenario.ts): its forces, bonus victory points, rules, variants and base. */
function optionsFromData(id: string, seed: number): GameOptions {
  const def = scenarioDef(id);
  if (!def) throw new Error(`Unknown mix ${id}`);
  const ships: ShipSpec[] = def.sides.flatMap((side, owner) => side.ships.map((s) => ({ owner: owner as PlayerId, ...s })));
  const bonus: [number, number] = [def.sides[0].bonusVp ?? 0, def.sides[1].bonusVp ?? 0];
  const roles: ScenarioRules['roles'] = [def.sides[0].role ?? null, def.sides[1].role ?? null];
  const rules: ScenarioRules | undefined = def.rules ? { ...def.rules, ...(def.rules.roles ? {} : { roles }) } : roles[0] || roles[1] ? { roles } : undefined;
  return {
    seed,
    ships,
    ...(bonus[0] || bonus[1] ? { bonusVp: bonus } : {}),
    ...(def.groundAttack ? { groundAttack: { ...def.groundAttack } } : {}),
    ...(def.reserves ? { reserves: def.reserves } : {}),
    ...(def.startEdges ? { startEdges: def.startEdges } : {}),
    ...(rules ? { rules } : {}),
    ...(def.variants ? { variants: def.variants } : {}),
    ...(def.map === 'static' ? { map: { ...STANDARD_MAP, mode: 'static' as const } } : {}),
  };
}

/** Dogfight ship mix (Rules: Scenarios) or Convoy (Rules: Convoy): Rebels are player 0, Empire is player 1. */
export function dogfightOptions(mix: DogfightMix, seed: number): GameOptions {
  return optionsFromData(mix, seed);
}

/**
 * The Ground Attack (Rules: Ground attack). Mix One: Rebel attackers against a standard base, an interceptor and two fighters. Mix Two: the Rebels defend the base
 * with three X-wings against Imperial attackers. Mix Three: three Rebel ships against 15 turret guns and no ships (solitaire).
 */
export function groundAttackOptions(mix: 1 | 2 | 3, seed: number): GameOptions {
  return optionsFromData(`ground${mix}`, seed);
}

/** The options for any scenario of the menu; a points game needs the points of both sides. */
export function scenarioOptions(mix: DogfightMix, seed: number, points?: [number, number], forceChooser?: PlayerId): GameOptions {
  if (mix !== 'points') return optionsFromData(mix, seed);
  if (!points || points.some((p) => !Number.isInteger(p) || p < MIN_LIMIT || p > MAX_LIMIT)) {
    throw new Error(`A points game needs between ${MIN_LIMIT} and ${MAX_LIMIT} points for each side.`);
  }
  return { seed, ships: [], points: [points[0], points[1]], ...(forceChooser !== undefined ? { forceChooser } : {}) };
}

/** Each side sets up in its own area at opposite ends of the map (Rules: Scenarios). */
function defaultZones(map: MapSpec): [Hex[], Hex[]] {
  // on the larger map of the capital ship games the areas are half as big again as well (they have to hold a ship 17 hexes long)
  const scale = map.rows > STANDARD_MAP.rows ? 1.5 : 1;
  const margin = Math.round(8 * scale);
  const from = Math.round(6 * scale);
  const to = Math.round(14 * scale);
  const zoneFor = (rowFrom: number, rowTo: number): Hex[] => {
    const hexes: Hex[] = [];
    for (let col = margin; col < map.cols - margin; col++) {
      for (let row = rowFrom; row <= rowTo; row++) hexes.push(fromOffset(col, row));
    }
    return hexes;
  };
  return [zoneFor(from, to), zoneFor(map.rows - 1 - to, map.rows - 1 - from)];
}

export function createGame(options: GameOptions): GameState {
  // turret guns (Rules: Ground attack) and asteroid fields (Rules: Asteroid fields) are never played together
  if (options.asteroids && options.ships.some((s) => isCapitalType(s.typeId))) throw new Error('Capital ships and asteroids are not combined: the ships are far bigger than in the board game and do not fire at asteroids.');
  if (options.asteroids && options.groundAttack) throw new Error('A Ground Attack has no asteroid field: turret guns and asteroids are not combined.');
  // a game with a capital ship is played on a larger map (a points game gets it when the forces are chosen)
  const wanted = options.map ?? STANDARD_MAP;
  const sized: MapSpec = options.ships.some((s) => isCapitalType(s.typeId)) && isStandardSize(wanted) ? { ...LARGE_MAP, mode: wanted.mode } : wanted;
  const map: MapSpec = options.asteroids || options.groundAttack ? { ...sized, mode: 'static' } : sized;
  const game: GameState = {
    turn: 0,
    phase: options.points ? 'forces' : 'setup',
    rngState: options.seed >>> 0,
    map,
    ships: [],
    ...(options.points
      ? { purchase: { limits: [options.points[0], options.points[1]] as [number, number], ...(options.forceChooser !== undefined ? { chooser: options.forceChooser } : {}), chosen: [null, null] as [Force | null, Force | null] } }
      : {}),
    ...(options.skillReduction ? { skillReduction: options.skillReduction } : {}),
    ...(options.damageRules ? { damageRules: true } : {}),
    ...(options.specialWeapons ? { specialWeapons: true } : {}),
    ...(options.advancedInitiative ? { advancedInitiative: true } : {}),
    ...(options.advancedArcs ? { advancedArcs: true } : {}),
    ...(options.rules ? { rules: structuredClone(options.rules) } : {}),
    zones: defaultZones(map),
    placed: [false, false],
    planSubmitted: [false, false],
    initiative: null,
    chooser: 0,
    active: null,
    tasks: [],
    pending: null,
    vp: options.bonusVp ? [options.bonusVp[0], options.bonusVp[1]] : [0, 0],
    winner: null,
    log: [],
  };
  if (options.asteroids) {
    game.asteroids = createField(map, game.zones, options.asteroids, stateRng(game));
    say(game, 'setup', `An asteroid field (${options.asteroids.density}) covers the map. The map is static.`);
  }
  const specs = applyVariants(options.ships, options.variants, { specialWeapons: !!options.specialWeapons, damageRules: !!options.damageRules, adjustableMap: map.mode === 'open' });
  addShips(game, options.destroyerSkill ? specs.map((s) => (s.typeId === 'star-destroyer' || s.typeId === 'mon-calamari' ? { ...s, skill: { ...options.destroyerSkill! } } : s)) : specs);
  setUpReserves(game, options);
  if (options.groundAttack) setUpGroundAttack(game, options.groundAttack);
  if (options.skillReduction) say(game, 'setup', `Pilot and gunner skills were rolled with reduced randomness (level ${options.skillReduction}).`);
  say(game, 'setup', options.points ? 'Both sides are choosing their forces.' : 'Ships are being placed on the map.');
  return game;
}

/**
 * The Ground Attack (Rules: Ground attack): the defender's ground target and turret guns, the attackers' set-up area along the top edge, and the defender's ships
 * anywhere else. The ground target and the guns are placed by a human defender before the ships (command `base`, with `manualBase`); otherwise the game
 * lays them out itself. A side with no ships (Mix Three) has nothing to place.
 */
function setUpGroundAttack(game: GameState, options: NonNullable<GameOptions['groundAttack']>): void {
  const defender = other(options.attacker);
  const kit = kitFor(options.doubles, options.singles);
  const skill = { ...(options.turretSkill ?? TURRET_SKILL) };
  game.groundAttack = { attacker: options.attacker };
  game.emplacements = [];
  game.turretOrders = [null, null];
  // the set-up areas follow once the attackers have chosen their edge (Rules: Ground attack); a side without ships has nothing to place
  game.placed = [activeShips(game, 0).length === 0, activeShips(game, 1).length === 0];
  const names = ['Rebels', 'Empire'];
  const guns = `${options.doubles} double and ${options.singles} single turret guns`;
  if (options.manualBase) {
    game.baseSetup = { defender, kit, turretSkill: skill, done: false };
    say(game, 'setup', `Ground Attack. Attacker: the ${names[options.attacker]}. Defender: the ${names[defender]}, with a ground target and ${guns}. The defender places the base first. The map is static.`);
  } else {
    installBase(game, defender, kit, autoBase(stateRng(game), game.map, kit), skill);
    say(game, 'setup', `Ground Attack. Attacker: the ${names[options.attacker]}. Defender: the ${names[defender]}, with a ground target and ${guns}. The map is static.`);
  }
}

/** Puts the ground target and the turret guns of the defender on the map, and takes their hexes out of the defender's set-up area. */
function installBase(game: GameState, defender: PlayerId, kit: BaseKit, placements: BasePlacement[], skill: SkillCode): void {
  const items = baseItems(kit);
  const guns: ReturnType<typeof itemGuns> = [];
  for (const p of placements) {
    const item = items.find((i) => i.id === p.id)!;
    if (item.kind === 'ground') game.groundTarget = { id: GROUND_TARGET_ID, owner: defender, pos: { ...p.pos }, damage: 0, status: 'active' };
    else guns.push(...itemGuns(item.kind, p));
  }
  game.emplacements = guns.map((t, i) => ({
    id: `E${i + 1}`,
    owner: defender,
    kind: t.kind,
    pos: t.pos,
    facing: t.facing,
    skill: { ...skill },
    status: 'active' as const,
    fired: false,
    tracking: null,
    chance: TURRET_FIRE_AT,
    lastChance: TURRET_LAST_CHANCE,
  }));
  // the defender's ships stand anywhere clear of the rim (Rules: Ground attack), but not on a turret gun or the ground target
  const taken = new Set([...game.emplacements.map((e) => keyOf(e.pos)), ...(game.groundTarget ? [keyOf(game.groundTarget.pos)] : [])]);
  game.zones[defender] = defenderZone(game.map).filter((h) => !taken.has(keyOf(h)));
}

/** The attackers choose the edge they come from (Rules: Ground attack), in secret: their set-up area follows. */
function chooseEdge(game: GameState, cmd: Extract<Command, { type: 'edge' }>): void {
  // a side that picks the edge it starts along (Rules: Reserves)
  const choice = game.edgeChoice;
  if (choice && game.phase === 'setup' && !choice.edge && cmd.player === choice.side) {
    if (!choice.options.includes(cmd.edge)) fail(`The ships can start along ${choice.options.join(' or ')} only.`);
    choice.edge = cmd.edge;
    game.zones[choice.side] = attackerZoneFor(game.map, cmd.edge);
    say(game, 'setup', `The ${SIDES[choice.side]} start along the ${cmd.edge} edge.`);
    return;
  }
  const ground = game.groundAttack;
  if (game.phase !== 'setup' || !ground || ground.edge || (game.baseSetup && !game.baseSetup.done)) fail('There is no edge to choose now.');
  if (cmd.player !== ground!.attacker) fail('Only the attacking player chooses the edge.');
  if (!MAP_EDGES.includes(cmd.edge)) fail('The edge is the top, bottom, left or right one.');
  ground!.edge = cmd.edge;
  if (game.placed[cmd.player]) fail('You have already placed your ships.');
  game.zones[ground!.attacker] = attackerZoneFor(game.map, cmd.edge);
  // the defender does not learn the edge until both have placed their ships: the log does not say
  say(game, 'setup', 'The attacker has chosen the edge to attack from.');
}

/** The defender's ground target and base (Rules: Ground attack), before the ships are placed. */
function placeBase(game: GameState, cmd: Extract<Command, { type: 'base' }>): void {
  const setup = game.baseSetup;
  if (game.phase !== 'setup' || !setup || setup.done) fail('There is no ground target or base to place now.');
  if (cmd.player !== setup!.defender) fail('Only the defending player places the ground target and the base.');
  const items = baseItems(setup!.kit);
  const placed = cmd.items.map((p) => {
    const item = items.find((i) => i.id === p.id);
    if (!item) return fail(`Not an item of the base: ${p.id}`);
    return { item, placement: p };
  });
  const error = baseLayoutError(game.map, setup!.kit, placed, true);
  if (error) fail(error);
  installBase(game, setup!.defender, setup!.kit, cmd.items, setup!.turretSkill);
  setup!.done = true;
  say(game, 'setup', `The defender has placed the ground target and ${game.emplacements?.length ?? 0} turret guns. The attackers choose their edge next, then both sides place their ships.`);
}

/** Puts ships into the game, rolling the skills of their pilots and gunners (Rules: Ships and crews). */
function addShips(game: GameState, specs: ShipSpec[]): void {
  const rng = stateRng(game);
  const seq: [number, number] = [0, 0];
  for (const ship of game.ships) seq[ship.owner] = Math.max(seq[ship.owner], ship.idNumber);
  for (const spec of specs) {
    // a Star Destroyer is not a ship (Rules: Star Destroyers)
    if (isCapitalType(spec.typeId)) {
      addDestroyer(game, spec);
      continue;
    }
    const type = getShip(spec.typeId);
    seq[spec.owner] += 1;
    const shields = type.shields ?? 0;
    const pilotSkill = rollSkillCode(rng, spec.quality, game.skillReduction);
    const gunnerySkill = rollSkillCode(rng, spec.quality, game.skillReduction);
    const gunners = spec.gunners?.map((quality) => ({ quality, skill: rollSkillCode(rng, quality, game.skillReduction), plan: emptyPlan() }));
    game.ships.push({
      id: `P${spec.owner}-${seq[spec.owner]}`,
      owner: spec.owner,
      typeId: spec.typeId,
      idNumber: seq[spec.owner],
      quality: spec.quality,
      ...(spec.tag ? { tag: spec.tag } : {}),
      pilotSkill,
      gunnerySkill,
      ...(gunners?.length ? { gunners } : {}),
      status: spec.reserve ? 'reserve' : 'active',
      ...(spec.reserve ? { reserve: spec.reserve } : {}),
      pos: null,
      facing: 0,
      speed: Math.min(6, type.speedMax),
      maxSpeed: type.speedMax,
      guns: allGuns(type),
      ...(game.specialWeapons && specialOf(type) ? { projectiles: specialOf(type)!.load } : {}),
      ...(game.damageRules ? { aux: type.auxPower ?? 0, ...(type.r2 ? { r2: { aboard: true, ready: false } } : {}) } : {}),
      bodyDamage: 0,
      shields: type.shieldsAdvancedArcs && hasSideQuarters(game, { typeId: spec.typeId } as Ship)
        ? { ...type.shieldsAdvancedArcs }
        : { front: Math.ceil(shields / 2), rear: Math.floor(shields / 2), left: 0, right: 0 },
      stabilizerDamage: 0,
      lateralDamage: 0,
      actionPenalty: 0,
      pendingPenalty: 0,
      forcedRoll: 0,
      forcedOverspeed: 0,
      hazardOverspeed: 0,
      turnPenalty: 0,
      plan: emptyPlan(),
      tracking: null,
      moved: false,
      wounds: [],
    });
  }
}

// ---------------------------------------------------------------- helpers

export function shipById(game: GameState, id: string): Ship | undefined {
  return game.ships.find((s) => s.id === id);
}

export function typeOf(ship: Ship): ShipType {
  return getShip(ship.typeId);
}

export function activeShips(game: GameState, owner?: PlayerId): Ship[] {
  return game.ships.filter((s) => s.status === 'active' && (owner === undefined || s.owner === owner));
}

export function shipName(ship: Ship): string {
  return `${typeOf(ship).name} #${ship.idNumber} (player ${ship.owner + 1})`;
}

function say(game: GameState, kind: string, text: string, brief?: Seg[], detail = false): GameEvent {
  const event: GameEvent = { turn: game.turn, kind, text };
  if (brief) event.brief = brief;
  if (detail) event.detail = true;
  game.log.push(event);
  return event;
}

/** The ship's name for the short log, in its side's colour unless told otherwise. */
const nameSeg = (ship: Ship, tone?: Tone): Seg => ({
  t: `${typeOf(ship).name} #${ship.idNumber} (p${ship.owner + 1})`,
  tone: tone ?? (ship.owner === 0 ? 'p0' : 'p1'),
});

const FACING_ARROWS = ['↑', '↗', '↘', '↓', '↙', '↖'];

/** The sides as the log names them. */
const SIDES = ['Rebels', 'Empire'] as const;

const rngOf = (game: GameState): Rng => stateRng(game);

const skillText = (c: SkillCode): string => (c.pips ? `${c.dice}D+${c.pips}` : `${c.dice}D`);

function betterPilot(a: Ship, b: Ship): boolean {
  return a.pilotSkill.dice * 100 + a.pilotSkill.pips > b.pilotSkill.dice * 100 + b.pilotSkill.pips;
}

function ownPosition(ship: Ship): { pos: Hex; facing: Facing } {
  if (!ship.pos) throw new Error(`${ship.id} is not on the map`);
  return { pos: ship.pos, facing: ship.facing };
}

/** Does `tailer` currently tail `enemy`? (Rules: The map) */
export function tails(tailer: Ship, enemy: Ship): boolean {
  if (!tailer.pos || !enemy.pos || tailer.owner === enemy.owner) return false;
  return isTailing(tailer.pos, tailer.facing, enemy.pos, enemy.facing);
}

// ---------------------------------------------------------------- commands

export type MoveStepCommand = { kind: Exclude<MoveStep, 'snapFire'> } | { kind: 'snapFire'; shots: ShotOrder[] };

export interface ShotOrder {
  /** Index into the ship's guns. */
  gun: number;
  target: string;
  /** Who fires it: 'pilot' (the default) or 'gunner1', 'gunner2' (14). */
  crew?: string;
  /** For the special weapon (`gun` is `SPECIAL`): how many tubes are fired, all at this target (Rules: Missiles, torpedoes and bombs). */
  tubes?: number;
}

export type Command =
  | { type: 'buy'; player: PlayerId; ships: ForceShip[] }
  /** When one player chooses both forces: the Rebel ships, then the Empire's. */
  | { type: 'buyBoth'; player: PlayerId; ships: [ForceShip[], ForceShip[]] }
  | { type: 'place'; player: PlayerId; placements: { shipId: string; pos: Hex; facing: Facing }[] }
  /** The defender's ground target and base, before the ships are placed (29.2). */
  | { type: 'base'; player: PlayerId; items: BasePlacement[] }
  /** The attackers choose the edge they come from, after seeing the base (29.26). */
  | { type: 'edge'; player: PlayerId; edge: MapEdge }
  /** `plans` are the pilots' plans; `crewPlans` the gunners' (in seat order) for the ships that have gunners: a missing one plans nothing. */
  | { type: 'plan'; player: PlayerId; plans: Record<string, Plan>; crewPlans?: Record<string, Plan[]> }
  | { type: 'chooseShip'; player: PlayerId; shipId: string }
  /** Advanced initiative (19.12): the owner of the ship whose turn it is to say when it moves takes a slot (1 = the first ship phase) or has it move with a tailed enemy ship (19.14). */
  | { type: 'slot'; player: PlayerId; slot?: number; moveWith?: string }
  | { type: 'move'; player: PlayerId; shipId: string; steps: MoveStepCommand[] }
  | { type: 'fire'; player: PlayerId; shipId: string; shots: ShotOrder[] }
  | { type: 'turrets'; player: PlayerId; orders: TurretOrder[] }
  | { type: 'decide'; player: PlayerId; choice: string | number | null }
  /** The owner of a reserve group says whether it comes in now (Rules: Reserves); a group that needs a roll is rolled for. */
  | { type: 'enter'; player: PlayerId; enter: boolean }
  /** A reserve group that comes in is placed, along the edge the owner chose when the scenario lets him choose (Rules: Reserves). */
  | { type: 'arrive'; player: PlayerId; edge?: MapEdge; placements: { shipId: string; pos: Hex; facing: Facing }[] }
  /** A Star Destroyer's move: forward and turns, 5 hexes (Rules: Star Destroyers). */
  /** A capital ship picks the enemy capital ship it fires at, one only, after all of them have moved. */
  | { type: 'targetCapital'; player: PlayerId; id: string; target: string }
  | { type: 'moveDestroyer'; player: PlayerId; id: string; steps: MoveStep[]; /** The speed it moves at this game-turn: one more or less than now, or the same (the speed now when missing). */ speed?: number };

export type CommandResult = { ok: true; events: GameEvent[] } | { ok: false; error: string };

class RuleError extends Error {}
function fail(message: string): never {
  throw new RuleError(message);
}

/**
 * Apply a command. The command is first tried on a copy of the game, so a rejected command
 * never leaves the real game half-changed.
 */
export function applyCommand(game: GameState, cmd: Command): CommandResult {
  // The trial copy does not need the (long) event log, which would make every command cost more
  const log = game.log;
  game.log = [];
  const trial = structuredClone(game);
  game.log = log;
  try {
    execute(trial, cmd);
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message };
    throw e;
  }
  const before = game.log.length;
  execute(game, cmd);
  return { ok: true, events: game.log.slice(before) };
}

function execute(game: GameState, cmd: Command): void {
  if (game.phase === 'over') fail('The game is over.');
  if (cmd.type === 'decide') return decide(game, cmd);
  if (game.pending) fail('A decision is waiting for a player.');
  switch (cmd.type) {
    case 'buy': return buyForce(game, cmd);
    case 'buyBoth': return buyBoth(game, cmd);
    case 'place': return place(game, cmd);
    case 'base': return placeBase(game, cmd);
    case 'edge': return chooseEdge(game, cmd);
    case 'plan': return submitPlans(game, cmd);
    case 'chooseShip': return chooseShip(game, cmd);
    case 'slot': return declareInitiative(game, cmd);
    case 'move': return moveShip(game, cmd);
    case 'fire': return fireCommand(game, cmd);
    case 'turrets': return submitTurrets(game, cmd);
    case 'enter': return enterCommand(game, cmd);
    case 'arrive': return arrive(game, cmd);
    case 'moveDestroyer': return moveDestroyer(game, cmd);
    case 'targetCapital': return targetCapital(game, cmd);
  }
}

// ---------------------------------------------------------------- forces phase (35)

function buyForce(game: GameState, cmd: Extract<Command, { type: 'buy' }>): void {
  const purchase = game.purchase;
  if (game.phase !== 'forces' || !purchase) fail('Ships can only be bought before the game starts.');
  if (purchase.chooser !== undefined) fail('One player chooses both forces in this game.');
  if (purchase.chosen[cmd.player]) fail('You have already chosen your force.');
  const error = forceError(cmd.player, purchase.limits[cmd.player], cmd.ships, !!game.asteroids);
  if (error) fail(error);
  const ships = cmd.ships.map((s) => ({ typeId: s.typeId, quality: s.quality, gunners: [...s.gunners] }));
  purchase.chosen[cmd.player] = { ships, cost: forceCost(ships) };
  say(game, 'forces', `The ${SIDES[cmd.player]} chose a force.`);
  if (purchase.chosen[0] && purchase.chosen[1]) startFromForces(game, purchase.chosen as [Force, Force], purchase.limits);
}

function buyBoth(game: GameState, cmd: Extract<Command, { type: 'buyBoth' }>): void {
  const purchase = game.purchase;
  if (game.phase !== 'forces' || !purchase) fail('Ships can only be bought before the game starts.');
  if (purchase.chooser === undefined) fail('Each player buys their own force in this game.');
  if (purchase.chooser !== cmd.player) fail('Only the player who sets the game up chooses the forces.');
  if (purchase.chosen[0] || purchase.chosen[1]) fail('The forces have already been chosen.');
  if (!Array.isArray(cmd.ships) || cmd.ships.length !== 2) fail('Choose a force for each side.');
  for (const side of [0, 1] as PlayerId[]) {
    const error = forceError(side, purchase.limits[side], cmd.ships[side], !!game.asteroids);
    if (error) fail(`${side === 0 ? 'Rebels' : 'Empire'}: ${error}`);
  }
  const forces = ([0, 1] as PlayerId[]).map((side) => {
    const ships = cmd.ships[side].map((s) => ({ typeId: s.typeId, quality: s.quality, gunners: [...s.gunners] }));
    return { ships, cost: forceCost(ships) };
  }) as [Force, Force];
  purchase.chosen = forces;
  say(game, 'forces', 'The host chose both forces.');
  startFromForces(game, forces, purchase.limits);
}

/** Both sides have bought: the ships come into the game, the side with fewer points gets its bonus (Rules: Scenarios), and set-up begins. */
function startFromForces(game: GameState, chosen: [Force, Force], limits: [number, number]): void {
  const specs: ShipSpec[] = ([0, 1] as PlayerId[]).flatMap((owner) => chosen[owner].ships.map((s) => ({ owner, typeId: s.typeId, quality: s.quality, gunners: s.gunners })));
  addShips(game, specs);
  if (specs.some((s) => isCapitalType(s.typeId)) && isStandardSize(game.map)) {
    game.map = { ...LARGE_MAP, mode: game.map.mode };
    game.zones = defaultZones(game.map);
  }
  const bonus = bonusPoints(limits);
  game.vp = [game.vp[0] + bonus[0], game.vp[1] + bonus[1]];
  for (const owner of [0, 1] as PlayerId[]) {
    const force = chosen[owner];
    say(game, 'forces', `${owner === 0 ? 'Rebels' : 'Empire'} (${force.cost} of ${limits[owner]} points): ${force.ships.map(describeForceShip).join('; ')}.`);
  }
  if (bonus[0] || bonus[1]) say(game, 'forces', `The ${bonus[0] ? 'Rebels start' : 'Empire starts'} with ${bonus[0] || bonus[1]} bonus victory point${(bonus[0] || bonus[1]) === 1 ? '' : 's'} because ${bonus[0] ? 'they have' : 'it has'} fewer ship points.`);
  game.phase = 'setup';
  say(game, 'setup', 'Ships are being placed on the map.');
}

// ---------------------------------------------------------------- setup phase

function place(game: GameState, cmd: Extract<Command, { type: 'place' }>): void {
  if (game.phase !== 'setup') fail('Ships can only be placed during setup.');
  if (game.placed[cmd.player]) fail('You have already placed your ships.');
  if (game.baseSetup && !game.baseSetup.done) fail('The defending player places the ground target and the base first.');
  if (game.groundAttack && cmd.player === game.groundAttack.attacker && !game.groundAttack.edge) fail('The attackers choose the edge they come from before they place their ships.');
  if (game.edgeChoice && game.edgeChoice.side === cmd.player && !game.edgeChoice.edge) fail('Choose the edge you start along before you place your ships.');
  const mine = game.ships.filter((s) => s.owner === cmd.player && s.status === 'active');
  const myDestroyers = (game.destroyers ?? []).filter((d) => d.owner === cmd.player && d.pos === null);
  const zone = game.zones[cmd.player];
  const used = new Set<string>();
  if (cmd.placements.length !== mine.length + myDestroyers.length) fail('Place every one of your ships.');
  for (const p of cmd.placements) {
    // a Star Destroyer fills eight hexes, all of which have to be in the setup area
    const big = myDestroyers.find((d) => d.id === p.shipId);
    if (big) {
      if (!Number.isInteger(p.facing) || p.facing < 0 || p.facing > 5) fail('A facing is one of the six hex sides.');
      if (!destroyerHexes(p.pos, p.facing, specOf(big).kind).every((h) => zone.some((z) => hexEquals(z, h)))) fail(`The whole ${specOf(big).name} has to be in your setup area.`);
      continue;
    }
    const ship = mine.find((s) => s.id === p.shipId);
    if (!ship) return fail(`Not your ship: ${p.shipId}`);
    if (!zone.some((h) => hexEquals(h, p.pos))) fail('That hex is outside your setup area.');
    if (game.asteroids && coveredHexes(game.asteroids).has(keyOf(p.pos))) fail('That hex is taken by an asteroid.');
    const k = `${p.pos.q},${p.pos.r}`;
    if (used.has(k)) fail('Two ships can’t start in the same hex.');
    used.add(k);
  }
  for (const p of cmd.placements) {
    const big = myDestroyers.find((d) => d.id === p.shipId);
    if (big) {
      big.pos = { ...p.pos };
      big.facing = p.facing;
      continue;
    }
    const ship = shipById(game, p.shipId)!;
    ship.pos = { ...p.pos };
    ship.facing = p.facing;
  }
  game.placed[cmd.player] = true;
  say(game, 'placed', `The ${SIDES[cmd.player]} placed ${mine.length + myDestroyers.length} ships.`);
  if (game.placed[0] && game.placed[1]) {
    // the edge the attackers chose was secret until now
    if (game.groundAttack?.edge) say(game, 'setup', `The attackers start along the ${game.groundAttack.edge} edge.`);
    startTurn(game);
  }
}

// ---------------------------------------------------------------- reserves (Rules: Reserves)

const reserveById = (game: GameState, id: string): ReserveGroup | undefined => game.reserves?.find((g) => g.id === id);

/** The groups of reserve ships of a scenario, and the edge a side starts along; a side whose ships all wait has nothing to place at the start. */
function setUpReserves(game: GameState, options: GameOptions): void {
  if (options.reserves) {
    game.reserves = Object.entries(options.reserves).flatMap(([id, def]) => {
      const ships = game.ships.filter((s) => s.reserve === id);
      return ships.length === 0 ? [] : [{ ...structuredClone(def), id, owner: ships[0]!.owner, shipIds: ships.map((s) => s.id), attempts: 0, entered: false }];
    });
    for (const p of [0, 1] as PlayerId[]) {
      if (game.ships.some((s) => s.owner === p && s.status === 'reserve') && !game.ships.some((s) => s.owner === p && s.status === 'active')) game.placed[p] = true;
    }
  }
  for (const side of [0, 1] as PlayerId[]) {
    const edges = options.startEdges?.[side];
    if (edges?.length) {
      game.edgeChoice = { side, options: [...edges], edge: null };
      game.zones[side] = [];
    }
  }
}

/** Asks the owner of the next reserve group that comes in when he says; false when there is none to ask this game-turn. */
function askEntry(game: GameState): boolean {
  const next = entryGroups(game, game.turn).find((g) => g.askedTurn !== game.turn);
  if (!next) {
    delete game.entry;
    return false;
  }
  game.phase = 'entry';
  game.entry = { group: next.id };
  return true;
}

function enterCommand(game: GameState, cmd: Extract<Command, { type: 'enter' }>): void {
  const group = game.entry ? reserveById(game, game.entry.group) : undefined;
  if (game.phase !== 'entry' || !group) fail('No ships come in now.');
  if (cmd.player !== group!.owner) fail('Only the owner of those ships says whether they come in.');
  group!.askedTurn = game.turn;
  if (cmd.enter) {
    if (group!.entry.kind === 'rolled') {
      const need = rollNeeded(group!.attempts);
      const roll = rollDie(rngOf(game));
      if (roll < need) {
        group!.attempts += 1;
        say(game, 'arrival', `The ${SIDES[group!.owner]} try to bring their reserves in: rolled ${roll}, ${need} was needed.`);
        if (!askEntry(game)) beginTurn(game);
        return;
      }
      say(game, 'arrival', `The ${SIDES[group!.owner]} bring their reserves in: rolled ${roll}, ${need} was needed.`);
    } else {
      say(game, 'arrival', `The ${SIDES[group!.owner]} bring their reserves in.`);
    }
    return startArrival(game, group!, 'entry');
  }
  if (!askEntry(game)) beginTurn(game);
}

/** The group is to be placed now by its owner. */
function startArrival(game: GameState, group: ReserveGroup, then: 'turn' | 'entry'): void {
  game.phase = 'arrival';
  game.arrival = { group: group.id, then };
  delete game.entry;
}

function arrive(game: GameState, cmd: Extract<Command, { type: 'arrive' }>): void {
  const group = game.arrival ? reserveById(game, game.arrival.group) : undefined;
  if (game.phase !== 'arrival' || !group) fail('No ships are coming in now.');
  if (cmd.player !== group!.owner) fail('Only the owner of those ships places them.');
  const ships = group!.shipIds.map((id) => shipById(game, id)!).filter((s) => s.status === 'reserve');
  if (cmd.placements.length !== ships.length) fail('Place every ship that comes in.');
  for (const p of cmd.placements) {
    if (!ships.some((s) => s.id === p.shipId)) fail(`Not one of the ships that come in: ${p.shipId}`);
    if (!Number.isInteger(p.facing) || p.facing < 0 || p.facing > 5) fail('A facing is one of the six hex sides.');
  }
  const covered = game.asteroids ? coveredHexes(game.asteroids) : new Set<string>();
  const error = arrivalError(game, group!, cmd.edge, cmd.placements.map((p) => p.pos), covered, keyOf);
  if (error) fail(error);
  for (const p of cmd.placements) {
    const ship = shipById(game, p.shipId)!;
    ship.status = 'active';
    ship.pos = { ...p.pos };
    ship.facing = p.facing;
    ship.moved = false;
  }
  group!.entered = true;
  const then = game.arrival!.then;
  delete game.arrival;
  const along = group!.along.kind === 'any' ? cmd.edge : undefined;
  say(game, 'arrival', `The ${SIDES[group!.owner]} ships come in${along ? ` along the ${along} edge` : ''}: ${ships.length} ${ships.length === 1 ? 'ship' : 'ships'}.`);
  if (then === 'turn') {
    const more = scheduledGroups(game, game.turn)[0];
    if (more) return startArrival(game, more, 'turn');
    return startTurn(game);
  }
  if (!askEntry(game)) beginTurn(game);
}

/** The hexes a reserve group may be placed in now, for the screen (the edge is the owner's choice when the scenario lets him choose). */
export function arrivalHexes(game: GameState, edge?: MapEdge): Hex[] {
  const group = game.arrival ? reserveById(game, game.arrival.group) : undefined;
  return group ? arrivalZone(game, group, edge) : [];
}

export const reserveGroup = (game: GameState, id: string): ReserveGroup | undefined => reserveById(game, id);

// ---------------------------------------------------------------- Star Destroyers and the frigate (Rules: Star Destroyers)

export const isDestroyerTarget = (id: string): boolean => id.startsWith('SD');
export const destroyerById = (game: GameState, id: string): Destroyer | undefined => game.destroyers?.find((d) => d.id === id);
export const destroyerName = (d: Destroyer): string => `${specOf(d).name} #${d.idNumber} (player ${d.owner + 1})`;
const destroyerSeg = (d: Destroyer): Seg => ({ t: `${specOf(d).name} #${d.idNumber} (p${d.owner + 1})`, tone: d.owner === 0 ? 'p0' : 'p1' });

/** The Star Destroyers of a side (or both) that are still in the game: not blown up and, for the end rules, not out of it. */
export const destroyersOf = (game: GameState, owner?: PlayerId): Destroyer[] => (game.destroyers ?? []).filter((d) => owner === undefined || d.owner === owner);

function addDestroyer(game: GameState, spec: ShipSpec): void {
  game.destroyers ??= [];
  const idNumber = game.destroyers.filter((x) => x.owner === spec.owner).length + 1;
  const kind = CAPITAL[spec.typeId as keyof typeof CAPITAL];
  game.destroyers.push({
    id: `SD${spec.owner}-${idNumber}`,
    owner: spec.owner,
    idNumber,
    kind: kind.kind,
    pos: null,
    facing: 0,
    skill: spec.skill ? { ...spec.skill } : { ...kind.skill },
    lost: 0,
    exploded: false,
    awarded: 0,
    moved: false,
    firedThisTurn: false,
    fireControl: false,
    noTurns: false,
    speedLost: 0,
    speed: kind.startSpeed,
    gunsDamaged: 0,
    outOfControl: 0,
  });
}

/** Structure points off a Star Destroyer, and the victory points for the side that did it: 50 at the eighth, 25 more at the ninth (dead in space), 100 for a ship that blows up (Rules: Scoring). */
export function loseStructure(game: GameState, d: Destroyer, points: number, by: PlayerId, why: string): void {
  if (points <= 0 || d.exploded) return;
  const before = d.lost;
  const spec = specOf(d);
  d.lost = Math.min(spec.deadAt, d.lost + points);
  say(game, 'damage', `${destroyerName(d)} loses ${points === 1 ? 'a structure point' : `${points} structure points`}${why ? ` ${why}` : ''}: ${Math.min(d.lost, spec.structure)} of ${spec.structure} lost.`, [destroyerSeg(d), { t: ` loses ${points} structure point${points === 1 ? '' : 's'}`, tone: 'gold' }, { t: ` (${Math.min(d.lost, spec.structure)}/${spec.structure})` }]);
  const award = (to: number): void => {
    if (to > d.awarded) {
      game.vp[by] += to - d.awarded;
      d.awarded = to;
    }
  };
  if (spec.silentAt < spec.deadAt && before < spec.silentAt && d.lost >= spec.silentAt) {
    award(spec.vp[0]);
    say(game, 'damage', `${destroyerName(d)} can no longer fire.`);
  }
  if (before < spec.deadAt && d.lost >= spec.deadAt) {
    award(spec.vp[0]);
    award(spec.vp[1]);
    say(game, 'damage', `${destroyerName(d)} is dead in space: it can neither move nor fire.`);
  }
  checkGameOver(game);
}

/** The Vital Systems Hit Table (Rules: Star Destroyers): what a lucky hit, or a crash, does to a Star Destroyer. */
export function vitalHit(game: GameState, d: Destroyer, by: PlayerId, again = false): void {
  if (d.exploded) return;
  const rng = rngOf(game);
  const roll = roll2d6(rng);
  const result = vitalResult(roll);
  const say1 = (text: string): void => void say(game, 'damage', `Vital systems of ${destroyerName(d)} (roll ${roll}): ${text}`);
  switch (result) {
    case 'chain':
      say1('internal chain reaction.');
      if (again) return;
      {
        const second = roll2d6(rng);
        if (second === 12) {
          d.exploded = true;
          d.lost = specOf(d).deadAt;
          if (d.awarded < specOf(d).vp[2]) {
            game.vp[by] += specOf(d).vp[2] - d.awarded;
            d.awarded = specOf(d).vp[2];
          }
          say(game, 'destroyed', `${destroyerName(d)} explodes (rolled ${second}): it is destroyed.`, [destroyerSeg(d), { t: ' explodes', tone: 'gold' }]);
          // every fighter within three hexes rolls on the Front Quarter line of the Fire Table at −1
          const tasks: Task[] = [];
          for (const ship of activeShips(game)) {
            if (!ship.pos || !hexesOf(d).some((h) => hexDistance(h, ship.pos!) <= 3)) continue;
            const blast = roll2d6(rng);
            const hit = resolveHit({ power: -1, shields: 0, ion: false, quarter: 'front', roll: blast });
            say(game, 'damageRoll', `The explosion hits ${shipName(ship)}: ${blast} − 1 = ${hit.modifiedRoll}: ${hit.outcome === 'destroyed' ? 'destroyed' : hit.codes.length ? hit.codes.join(', ') : 'no effect'}.`, [{ t: `explosion on ${shipName(ship)}: ${blast} − 1 → ${hit.outcome === 'destroyed' ? 'destroyed' : hit.codes.length ? hit.codes.join(', ') : 'no effect'}` }], true);
            if (hit.outcome === 'destroyed') tasks.push({ t: 'code', shipId: ship.id, code: 'KILL', row: null, fromFire: true });
            for (const code of hit.codes) tasks.push({ t: 'code', shipId: ship.id, code, row: null, fromFire: true, quarter: 'front' });
          }
          for (const task of tasks) if (task.t === 'code' && !needsDecision(task.code)) applyAtStep(game, task);
          checkGameOver(game);
        } else {
          d.lost = specOf(d).deadAt;
          if (d.awarded < specOf(d).vp[1]) {
            game.vp[by] += specOf(d).vp[1] - d.awarded;
            d.awarded = specOf(d).vp[1];
          }
          say(game, 'damage', `${destroyerName(d)}: all the hits are taken (rolled ${second}): it is dead in space.`);
          checkGameOver(game);
        }
      }
      return;
    case 'fireControl':
      d.fireControl = true;
      say1('fire control damaged: it can fire at fighters or at enemy capital ships, not both.');
      return;
    case 'explosion':
      say1('explosions: one more hit.');
      loseStructure(game, d, 1, by, 'to the explosions');
      return;
    case 'steering':
      d.noTurns = true;
      say1('steering damaged: it can make no more turns.');
      return;
    case 'power':
      d.speedLost = Math.min(4, d.speedLost + 1);
      d.speed = destroyerSpeedNow(d);
      say1(`power lost: its top speed is ${destroyerMaxSpeed(d)} now.`);
      return;
    case 'guns':
      d.gunsDamaged += 1;
      say1('guns damaged: all its fire at fighters is one worse on the attack table.');
      return;
    case 'bridge':
      d.outOfControl = 6;
      say1('bridge destroyed: it moves out of control for six game-turns.');
      return;
    default:
      say1('no effect.');
  }
}

// ---- how a Star Destroyer's shot against a fighter is worked out

interface PathState {
  /** The step after which the fighter stands here; -1 for where it starts. */
  at: number;
  pos: Hex;
  facing: Facing;
}

/** Where the fighter stands at the start of its move and after each step of it (a snap shot changes nothing). */
function pathStates(ship: Ship, steps: MoveStepCommand[]): PathState[] {
  const out: PathState[] = [{ at: -1, pos: { ...ship.pos! }, facing: ship.facing }];
  let pos = ship.pos!;
  let facing = ship.facing;
  steps.forEach((s, i) => {
    if (s.kind === 'snapFire') return;
    const moved = applyStepToPosition(pos, facing, s.kind);
    pos = moved.pos;
    facing = moved.facing;
    out.push({ at: i, pos, facing });
  });
  return out;
}

const destroyerSpeed = (d: Destroyer): number => destroyerSpeedNow(d);

/** The difficulty of one attack of a Star Destroyer on a fighter standing in `state` (Rules: Star Destroyers): the number on the table, the fighter's jinks, half loops and speed, no rolls, and the target and tracking markers. */
export function destroyerShotParts(game: GameState, d: Destroyer, ship: Ship, state: { pos: Hex; facing: Facing }, base: number): DifficultyPart[] {
  const { parts } = shotBreakdown({
    base,
    firer: { halfLoop: 0, roll: 0, jink: 0, pinpointFire: 0 },
    // "ignore rolls by the target; all other maneuvers do affect the difficulty"
    target: { halfLoop: ship.plan.halfLoop, roll: 0, jink: ship.plan.jink, pinpointFire: 0 },
    // the target marker counts as the Star Destroyer tracking the fighter: 5 less, never doubled
    firerTracking: ship.sdMarkers?.includes(d.id) ? 1 : 0,
    targetTracking: ship.tracking && ship.tracking.target !== d.id ? ship.tracking.level : 0,
    firerSpeed: destroyerSpeed(d),
    targetSpeed: ship.speed,
    facing: facingRelation(d.facing, state.facing),
  });
  // a fighter that tracks the Star Destroyer is easier to hit by it
  if (ship.tracking?.target === d.id) parts.push({ label: `Target is tracking the ${specOf(d).name}`, value: -5 * ship.tracking.level });
  return parts;
}

const sumParts = (parts: DifficultyPart[]): number => parts.reduce((s, p) => s + p.value, 0);

const ROLL_ODDS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((n) => n / 36);

/** The modifier to the attack roll: 1 worse for a target in the front arc, 1 worse once the Star Destroyer has already fired at a fighter this game-turn, and for damaged guns. */
function attackRollPenalty(d: Destroyer, target: Hex): number {
  const nose = capitalNose(d.pos!, d.facing, specOf(d).kind);
  return (!hexEquals(nose, target) && arcOf(nose, d.facing, target) === 'FC' ? 1 : 0) + (d.firedThisTurn ? 1 : 0) + d.gunsDamaged;
}

/** How good it would be for the Star Destroyer to fire from `origin` at a fighter in this state: the expected hits, weighted by how hard they hit. Only to choose the moment and the hex. */
function destroyerExpectation(game: GameState, d: Destroyer, ship: Ship, state: PathState, origin: Hex): number {
  const idx = rangeIndex(hexDistance(origin, state.pos));
  if (idx === null) return 0;
  const penalty = attackRollPenalty(d, state.pos);
  // a fighter in the very hex it is fired from is hit on its front shields, as a ship struck by an asteroid is
  const quarter = hexEquals(origin, state.pos) ? 'front' : quarterOf(state.pos, state.facing, origin, hasSideQuarters(game, ship));
  const shields = ship.shields[quarter];
  let total = 0;
  for (let roll = 2; roll <= 12; roll++) {
    const modified = Math.max(2, roll - penalty);
    let value = 0;
    for (const box of attackBoxes(modified, specOf(d).kind)) {
      const chance = chanceAtLeast(d.skill, 0, sumParts(destroyerShotParts(game, d, ship, state, box.hit[idx]!)));
      const power = Math.max(0, box.power[idx]! - shields);
      value += box.count * chance * (box.ion ? 0.4 : 1 + power * 0.6);
    }
    total += ROLL_ODDS[roll]! * value;
  }
  return total;
}

interface PlannedShot {
  destroyer: Destroyer;
  at: number;
  origin: Hex;
}

/**
 * The Star Destroyers of the other side fire once at a fighter that moves (Rules: Star Destroyers). The move is known when it is given, so each Star Destroyer
 * fires at the moment and from the hex of its own that give the best chance, wherever along the path that is.
 */
function planDestroyerShots(game: GameState, ship: Ship, steps: MoveStepCommand[]): PlannedShot[] {
  const out: PlannedShot[] = [];
  const states = pathStates(ship, steps);
  for (const d of destroyersOf(game, ship.owner === 0 ? 1 : 0)) {
    if (!canFire(d)) continue;
    let best: { at: number; origin: Hex; value: number } | null = null;
    for (const state of states) {
      for (const origin of hexesOf(d)) {
        const value = destroyerExpectation(game, d, ship, state, origin);
        if (value > 0 && (!best || value > best.value)) best = { at: state.at, origin, value };
      }
    }
    if (best) out.push({ destroyer: d, at: best.at, origin: best.origin });
  }
  return out;
}

/**
 * One Star Destroyer fires at a fighter (Rules: Star Destroyers): the roll on the attack table, then every gun it names is an attack of its own against the
 * fighter. Returns the guns' damage that needs a decision from the fighter's owner, to be dealt when the move is over.
 */
function fireDestroyer(game: GameState, d: Destroyer, ship: Ship, origin: Hex, step: number, deferred: Task[]): void {
  const rng = rngOf(game);
  const position = ship.pos!;
  const state = { pos: position, facing: ship.facing };
  const range = hexDistance(origin, position);
  const idx = rangeIndex(range);
  if (idx === null) return;
  const penalty = attackRollPenalty(d, position);
  const dice = roll2d6(rng);
  const modified = Math.max(2, dice - penalty);
  d.firedThisTurn = true;
  const boxes = attackBoxes(modified, specOf(d).kind);
  const gunsText = boxes.map((b) => `${b.count} × ${b.code}${b.ion ? '(I)' : ''}`).join(' and ');
  const head = say(
    game,
    'fire',
    `${destroyerName(d)} fires at ${shipName(ship)} (range ${range}): the attack roll ${dice}${penalty ? ` − ${penalty}` : ''} = ${modified}${boxes.length ? `: ${gunsText}` : ': no fire'}.`,
    [destroyerSeg(d), { t: ' fires at ' }, nameSeg(ship), { t: ` (range ${range}): roll ${dice}${penalty ? `−${penalty}` : ''} → ${boxes.length ? gunsText : 'no fire'}` }],
  );
  head.moveStep = step;
  for (const box of boxes) {
    for (let n = 0; n < box.count; n++) {
      if (ship.status !== 'active' || game.phase === 'over') return;
      const base = box.hit[idx]!;
      const parts = destroyerShotParts(game, d, ship, state, base);
      const difficulty = sumParts(parts);
      const skillRoll = rollSkill(rng, d.skill);
      const hit = skillRoll >= difficulty;
      const code = `${box.code}${box.ion ? '(I)' : ''}`;
      const event = say(
        game,
        'fire',
        `${destroyerName(d)} ${code} at ${shipName(ship)}: difficulty ${difficulty}, roll ${skillRoll}: ${hit ? 'hit' : 'miss'}.`,
        [destroyerSeg(d), { t: ` ${code} at ` }, nameSeg(ship), { t: `: difficulty ${difficulty}, rolled ${skillRoll} → ` }, { t: hit ? 'HIT' : 'MISS', tone: hit ? 'bad' : 'miss' }],
      );
      event.moveStep = step;
      event.shot = { shooter: d.id, target: ship.id, gun: code, ion: !!box.ion, hit, range, from: { ...origin }, to: { ...position } };
      if (!hit) continue;
      const damageRoll = roll2d6(rng);
      const quarter = hexEquals(origin, position) ? 'front' : quarterAgainst(game, ship, origin);
      const result = resolveHit({ power: box.power[idx]!, shields: ship.shields[quarter], ion: !!box.ion, quarter, roll: damageRoll });
      const powerText = `${damageRoll} ${result.power >= 0 ? '+' : '−'} power ${Math.abs(result.power)} = ${result.modifiedRoll}`;
      const outcome = result.outcome === 'destroyed' ? 'destroyed (14 or more always kills)' : result.codes.length ? `${quarter} quarter hit: ${result.codes.join(', ')}` : 'no effect';
      const line = say(game, 'damageRoll', `Damage roll ${powerText}: ${outcome}.`, [{ t: `damage roll ${powerText} → ${result.outcome === 'destroyed' ? 'destroyed' : result.codes.length ? result.codes.join(', ') : 'no effect'}` }], true);
      line.moveStep = step;
      const effects = result.codes.map((c) => parseDamageCode(c));
      const bodyPoints = effects.reduce((sum, e) => sum + (e?.kind === 'body' ? e.points : 0), 0);
      event.shot.effect = result.outcome === 'destroyed' || bodyPoints >= 3 ? 'heavy' : effects.every((e) => !e || e.kind === 'power') ? 'shield' : 'hull';
      const tasks: Task[] = [];
      if (result.outcome === 'destroyed') tasks.push({ t: 'code', shipId: ship.id, code: 'KILL', row: null, fromFire: true, shooter: d.id, step });
      for (const c of result.codes) tasks.push({ t: 'code', shipId: ship.id, code: c, row: null, fromFire: true, quarter, shooter: d.id, step, ...(box.ion ? { ion: true } : {}) });
      for (const task of tasks) {
        if (task.t === 'code' && needsDecision(task.code)) deferred.push(task);
        else if (task.t === 'code') applyAtStep(game, task);
      }
    }
  }
}

/**
 * A Rebel fighter that a Star Destroyer has destroyed flies on in a straight line, as far as its move had still to go, and if that line touches the Star Destroyer
 * the pilot may crash into it (Rules: Star Destroyers): the difficulty is 20 and 5 for every hex to the point of impact.
 */
export function crashIntoDestroyer(game: GameState, ship: Ship, d: Destroyer, from: Hex, facing: Facing, hexesLeft: number): void {
  if (ship.owner !== 0 || d.exploded || d.pos === null) return;
  const dir = facingStep(facing);
  const hexes = hexesOf(d);
  let impact: number | null = null;
  for (let n = 0; n <= hexesLeft; n++) {
    const h = { q: from.q + dir.q * n, r: from.r + dir.r * n };
    if (hexes.some((x) => hexEquals(x, h))) {
      impact = n;
      break;
    }
  }
  if (impact === null) return;
  const difficulty = crashDifficulty(impact);
  const roll = rollSkill(rngOf(game), ship.pilotSkill);
  const verdict = roll >= difficulty ? 'a vital system is hit' : roll >= difficulty - 3 ? 'it costs a structure point' : 'it misses';
  say(game, 'damage', `${shipName(ship)} crashes into ${destroyerName(d)}: difficulty ${difficulty}, roll ${roll}: ${verdict}.`, [nameSeg(ship), { t: ' crashes into ' }, destroyerSeg(d), { t: `: difficulty ${difficulty}, rolled ${roll} → ` }, { t: verdict, tone: roll >= difficulty - 3 ? 'gold' : 'muted' }]);
  if (roll >= difficulty) vitalHit(game, d, ship.owner);
  else if (roll >= difficulty - 3) loseStructure(game, d, 1, ship.owner, 'in the crash');
}

/** After a fighter's move: the target markers (Rules: Star Destroyers). A Star Destroyer that fired at it and is within ten hexes of where it stopped marks it; one that didn't fire, or is further away, takes its marker off. */
function updateMarkers(game: GameState, ship: Ship, firedBy: Set<string>): void {
  if (ship.status !== 'active' || !ship.pos) {
    delete ship.sdMarkers;
    return;
  }
  const markers = new Set(ship.sdMarkers ?? []);
  for (const d of destroyersOf(game, ship.owner === 0 ? 1 : 0)) {
    const near = nearestHexOf(d, ship.pos);
    if (firedBy.has(d.id) && near && near.distance <= 10) markers.add(d.id);
    else markers.delete(d.id);
  }
  if (markers.size > 0) ship.sdMarkers = [...markers];
  else delete ship.sdMarkers;
}

// ---- Star Destroyers against Star Destroyers and the asteroids

/** The enemy capital ships a capital ship could fire at now: on the map, not yet dead in space, and within its range (20 hexes for a Star Destroyer or a cruiser, 15 for a frigate). */
export function capitalTargetsOf(game: GameState, d: Destroyer): Destroyer[] {
  return destroyersOf(game, d.owner === 0 ? 1 : 0).filter((t) => t.pos !== null && !t.exploded && !t.escaped && t.lost < specOf(t).deadAt && capitalDistance(d, t) <= specOf(d).range);
}

/** Does this capital ship fire at enemy capital ships this game-turn? Not if it can't fire, or its fire control is damaged and the enemy has fighters left (fighters or capital ships, not both). */
function firesAtCapitalShips(game: GameState, d: Destroyer): boolean {
  if (!canFire(d) || capitalTargetsOf(game, d).length === 0) return false;
  return !(d.fireControl && activeShips(game, d.owner === 0 ? 1 : 0).length > 0);
}

/**
 * Once all the capital ships have moved (so that the distances are known), each one that fires at enemy capital ships picks one of them as its target
 * (the owner's rule for more than one capital ship on a side; with one target there is nothing to pick). Then they all fire together.
 */
function startCapitalTargets(game: GameState): void {
  const shooters = (game.destroyers ?? []).filter((d) => firesAtCapitalShips(game, d));
  // the side that won the initiative picks first, then the other, the ships of a side in order
  const first: PlayerId = game.advancedInitiative && game.initiativeTable ? (shipById(game, game.initiativeTable.order[0] ?? '')?.owner ?? 0) : (game.initiative ?? 0);
  shooters.sort((a, b) => (a.owner === first ? 0 : 1) - (b.owner === first ? 0 : 1) || a.idNumber - b.idNumber);
  if (shooters.length === 0) {
    finishDestroyerPhase(game);
    return;
  }
  const declared: Record<string, string> = {};
  const asking: string[] = [];
  for (const d of shooters) {
    const choices = capitalTargetsOf(game, d);
    if (choices.length === 1) declared[d.id] = choices[0]!.id;
    else asking.push(d.id);
  }
  game.capitalTargets = { order: shooters.map((d) => d.id), asking, declared };
  if (asking.length === 0) resolveCapitalFire(game);
}

function targetCapital(game: GameState, cmd: Extract<Command, { type: 'targetCapital' }>): void {
  const t = game.capitalTargets;
  if (game.phase !== 'destroyers' || !t || t.asking.length === 0) fail('No capital ship is picking a target now.');
  const id = t!.asking[0]!;
  const d = destroyerById(game, id)!;
  if (cmd.id !== id) fail(`${destroyerName(d)} picks its target now.`);
  if (d.owner !== cmd.player) fail('That ship belongs to the other player.');
  const target = capitalTargetsOf(game, d).find((x) => x.id === cmd.target);
  if (!target) fail('That is not an enemy capital ship it can fire at.');
  t!.declared[id] = target!.id;
  say(game, 'fire', `${destroyerName(d)} aims at ${destroyerName(target!)}.`, [destroyerSeg(d), { t: ' aims at ' }, destroyerSeg(target!)]);
  t!.asking.shift();
  if (t!.asking.length === 0) resolveCapitalFire(game);
}

/** Every capital ship fires at the one it picked: a die for every structure point it had left, each six takes one off the target. All fire together. */
function resolveCapitalFire(game: GameState): void {
  const t = game.capitalTargets!;
  const rng = rngOf(game);
  const volleys = t.order.map((id) => {
    const d = destroyerById(game, id)!;
    const target = destroyerById(game, t.declared[id]!)!;
    const rolls = Array.from({ length: structureLeft(d) }, () => rollDie(rng));
    return { d, target, rolls, sixes: rolls.filter((r) => r === 6).length };
  });
  for (const v of volleys) {
    say(game, 'fire', `${destroyerName(v.d)} fires at ${destroyerName(v.target)}: ${v.rolls.join(', ') || 'no dice'}: ${v.sixes === 0 ? 'no hit' : `${v.sixes} six${v.sixes === 1 ? '' : 'es'}`}.`, [destroyerSeg(v.d), { t: ' fires at ' }, destroyerSeg(v.target), { t: `: ${v.sixes} hit${v.sixes === 1 ? '' : 's'}` }]);
  }
  for (const v of volleys) if (v.sixes > 0) loseStructure(game, v.target, v.sixes, v.d.owner, 'from the fire');
  finishDestroyerPhase(game);
}

/** An asteroid and a Star Destroyer collide (Rules: Asteroid fields): the Destroyer rolls 5D against five times the asteroid's size; a miss costs a structure point, a miss by more than 5 is a roll on the Vital Systems Hit Table. */
function destroyerAsteroid(game: GameState, d: Destroyer, rock: Rock): void {
  if (d.exploded) return;
  const size = rockSize(rock);
  const difficulty = size * 5;
  const roll = rollSkill(rngOf(game), { dice: 5, pips: 0 });
  say(game, 'asteroid', `${destroyerName(d)} and ${rockName(rock)} collide: difficulty ${difficulty}, roll ${roll}: ${roll >= difficulty ? 'no harm' : 'damage'}.`, [destroyerSeg(d), { t: ` and ${rockName(rock)} collide: diff. ${difficulty}, rolled ${roll} → ` }, roll >= difficulty ? { t: 'no harm', tone: 'good' } : { t: 'damage', tone: 'bad' }]);
  if (roll >= difficulty) return;
  // nobody fired: the points go to the side the Destroyer is not on
  const other: PlayerId = d.owner === 0 ? 1 : 0;
  loseStructure(game, d, 1, other, 'to the asteroid');
  if (roll < difficulty - 5) vitalHit(game, d, other);
}

/** The asteroids that overlap a Star Destroyer now. */
function rocksOnDestroyer(game: GameState, d: Destroyer): Rock[] {
  if (!game.asteroids) return [];
  const found = new Set<Rock>();
  for (const h of hexesOf(d)) {
    const rock = rockAt(game.asteroids, h);
    if (rock) found.add(rock);
  }
  return [...found];
}

// ---- the Star Destroyers' own movement

/** Who moves first among Star Destroyers: the player with the initiative, then they alternate (Rules: Star Destroyers). */
function destroyerOrder(game: GameState): string[] {
  const movers = (game.destroyers ?? []).filter(canMove);
  const first: PlayerId = game.advancedInitiative && game.initiativeTable ? (shipById(game, game.initiativeTable.order[0] ?? '')?.owner ?? 0) : (game.initiative ?? 0);
  const queues: Destroyer[][] = [movers.filter((d) => d.owner === first), movers.filter((d) => d.owner !== first)];
  const out: string[] = [];
  for (let i = 0; out.length < movers.length; i++) {
    const d = queues[i % 2]!.shift() ?? queues[(i + 1) % 2]!.shift();
    if (d) out.push(d.id);
  }
  return out;
}

/** The Star Destroyers move after the Markers step and before the first ship phase (Rules: Star Destroyers). */
function startDestroyerPhase(game: GameState): void {
  const ids = destroyerOrder(game);
  if (ids.length === 0) return;
  game.phase = 'destroyers';
  game.destroyerQueue = { ids, index: 0 };
  advanceDestroyers(game);
}

/** Lets the Star Destroyers that move by themselves go (the ones out of control), and stops at the first that needs its owner; when all have moved the ship phases begin. */
function advanceDestroyers(game: GameState): void {
  const queue = game.destroyerQueue;
  if (!queue) return;
  while (queue.index < queue.ids.length) {
    const d = destroyerById(game, queue.ids[queue.index]!)!;
    if (game.phase === 'over') break;
    if (!canMove(d)) {
      queue.index += 1;
      continue;
    }
    if (d.outOfControl > 0) {
      moveOutOfControl(game, d);
      queue.index += 1;
      continue;
    }
    return;
  }
  delete game.destroyerQueue;
  if (game.phase === 'over') return;
  // all have moved: the capital ships pick their targets and fire at each other
  startCapitalTargets(game);
}

/** The ships go on: the capital ships have moved and fired at each other. */
function finishDestroyerPhase(game: GameState): void {
  delete game.capitalTargets;
  if (game.phase === 'over') return;
  game.phase = 'ships';
  run(game);
}

/** A Star Destroyer without a bridge: forward 3, a turn by the dice, then the rest of the move (Rules: Star Destroyers). */
function moveOutOfControl(game: GameState, d: Destroyer): void {
  const roll = roll2d6(rngOf(game));
  const turn = roll <= 6 ? 'turnLeft' : roll === 7 ? null : 'turnRight';
  const speed = destroyerSpeed(d);
  const steps: MoveStep[] = [];
  for (let i = 0; i < Math.min(3, speed); i++) steps.push('forward');
  if (turn) steps.push(turn);
  while (steps.filter((s) => s === 'forward').length < speed) steps.push('forward');
  d.outOfControl -= 1;
  say(game, 'move', `${destroyerName(d)} is out of control (rolled ${roll}).`);
  applyDestroyerMove(game, d, steps);
}

function applyDestroyerMove(game: GameState, d: Destroyer, steps: MoveStep[]): void {
  let pos = d.pos!;
  let facing = d.facing;
  for (const step of steps) {
    const moved = applyStepToPosition(pos, facing, step);
    pos = moved.pos;
    facing = moved.facing;
  }
  d.pos = pos;
  d.facing = facing;
  d.moved = true;
  // off the edge of a static map: it has escaped, like a ship (31.5)
  if (game.map.mode === 'static' && !isOnMap(game.map, pos)) {
    d.escaped = true;
    d.pos = null;
    say(game, 'escaped', `${destroyerName(d)} escapes: it has flown off the edge of the map.`, [destroyerSeg(d), { t: ' escapes: it has flown off the edge of the map', tone: 'muted' }]);
    checkGameOver(game);
    return;
  }
  say(game, 'move', `${destroyerName(d)} moves to ${describeHex(pos)} facing ${FACING_ARROWS[facing]}.`, [destroyerSeg(d), { t: ' moves' }, { t: ` to ${describeHex(pos)}`, hex: true }, { t: ` ${FACING_ARROWS[facing]}` }]);
  // the asteroids it meets
  for (const rock of rocksOnDestroyer(game, d)) destroyerAsteroid(game, d, rock);
}

function moveDestroyer(game: GameState, cmd: Extract<Command, { type: 'moveDestroyer' }>): void {
  const queue = game.destroyerQueue;
  if (game.phase !== 'destroyers' || !queue) fail('No capital ship moves now.');
  const d = destroyerById(game, queue!.ids[queue!.index]!)!;
  if (d.id !== cmd.id) fail(`It is ${destroyerName(d)}’s turn to move.`);
  if (d.owner !== cmd.player) fail('That ship belongs to the other player.');
  const speed = cmd.speed ?? destroyerSpeedNow(d);
  if (!destroyerSpeedChoices(d).includes(speed)) fail(`${specOf(d).name}s change their speed by ${specOf(d).speedStep === 1 ? 'one hex' : 'half a hex'} at most each game-turn: it can move at ${destroyerSpeedChoices(d).join(', ')}.`);
  const ctx = destroyerMoveContext(d, speed);
  let tr = startTracker(ctx);
  let pos = d.pos!;
  let facing = d.facing;
  const steps: MoveStep[] = [];
  for (const step of cmd.steps) {
    if (step !== 'forward' && step !== 'turnLeft' && step !== 'turnRight') fail('A capital ship moves forward and turns, nothing else.');
    const next = stepTracker(ctx, tr, step);
    if (!next) fail(`Illegal step: ${step}.`);
    tr = next!;
    const moved = applyStepToPosition(pos, facing, step);
    pos = moved.pos;
    facing = moved.facing;
    steps.push(step);
  }
  if (!isTrackerComplete(ctx, tr)) fail(`${specOf(d).name}s have to move ${ctx.speed} hexes (${tr.budget} to go).`);
  const before = destroyerSpeedNow(d);
  d.speed = speed;
  if (speed !== before) say(game, 'move', `${destroyerName(d)} ${speed > before ? 'speeds up' : 'slows down'} to ${speedText(speed)}.`, [destroyerSeg(d), { t: ` ${speed > before ? 'speeds up' : 'slows down'} to ${speedText(speed)}` }]);
  applyDestroyerMove(game, d, steps);
  queue!.index += 1;
  advanceDestroyers(game);
}

/** The Star Destroyer whose move it is now, if the game is waiting for one. */
export const currentDestroyer = (game: GameState): Destroyer | undefined => (game.phase === 'destroyers' && game.destroyerQueue ? destroyerById(game, game.destroyerQueue.ids[game.destroyerQueue.index]!) : undefined);

/** Do these steps make a whole legal move for the Star Destroyer (for the screen and the computer)? */
export function destroyerMoveComplete(game: GameState, id: string, steps: MoveStep[], speed?: number): boolean {
  const d = destroyerById(game, id);
  if (!d || !d.pos) return false;
  const ctx = destroyerMoveContext(d, speed);
  let tr = startTracker(ctx);
  for (const step of steps) {
    const next = stepTracker(ctx, tr, step);
    if (!next) return false;
    tr = next;
  }
  return isTrackerComplete(ctx, tr);
}

/** How much damage the Star Destroyers of the other side would be expected to do to `ship` if it stood at `pos` facing `facing` when they fire (for the computer's choice of a move). */
export function destroyerThreat(game: GameState, ship: Ship, pos: Hex | null = ship.pos, facing: Facing = ship.facing): number {
  if (!pos) return 0;
  let total = 0;
  for (const d of destroyersOf(game, ship.owner === 0 ? 1 : 0)) {
    if (!canFire(d)) continue;
    const near = nearestHexOf(d, pos);
    if (!near || near.distance > 10) continue;
    total += destroyerExpectation(game, d, ship, { at: 0, pos, facing }, near.hex);
  }
  return total;
}

/** The steps of a move that a Star Destroyer may still add to the ones taken (for the screen and the computer). */
export function destroyerLegalSteps(game: GameState, id: string, taken: MoveStep[] = [], speed?: number): MoveStep[] {
  const d = destroyerById(game, id);
  if (!d || !d.pos) return [];
  const ctx = destroyerMoveContext(d, speed);
  let tr = startTracker(ctx);
  let pos = d.pos;
  let facing = d.facing;
  for (const step of taken) {
    const next = stepTracker(ctx, tr, step);
    if (!next) return [];
    tr = next;
    const moved = applyStepToPosition(pos, facing, step);
    pos = moved.pos;
    facing = moved.facing;
  }
  return legalSteps(ctx, tr).filter((s) => {
    if (s === 'slipLeft' || s === 'slipRight' || s === 'halfLoop' || s === 'snapFire') return false;
    return true;
  });
}

// ---- fighters shooting at a Star Destroyer

/** The hex of a Star Destroyer that a weapon of the shooter can hit from where it stands, the nearest one (Rules: Star Destroyers: the firing player chooses it). */
export function destroyerHexInReach(game: GameState, shooter: Ship, gun: number, crew: string, d: Destroyer, pos: Hex | null = shooter.pos, facing: Facing = shooter.facing): Hex | null {
  if (!pos || d.pos === null || d.owner === shooter.owner) return null;
  const reach = (h: Hex): boolean => {
    if (gun === SPECIAL) {
      const weapon = specialFor(game, shooter);
      return !!weapon && crew === PILOT && !shooter.turnedInLastHex && specialReaches(weapon.kind, pos, facing, h);
    }
    return shooter.guns[gun] !== null && gunReaches(shooter, gun, crew, pos, facing, h);
  };
  const near = hexesOf(d).filter(reach).sort((a, b) => hexDistance(pos, a) - hexDistance(pos, b));
  return near[0] ?? null;
}

/** The enemy Star Destroyers one crew member (or the special weapon, for the pilot) could fire at from where the ship stands, or from `pos` and `facing`. */
export function destroyersForCrew(game: GameState, ship: Ship, crew: string, pos: Hex | null = ship.pos, facing: Facing = ship.facing): Destroyer[] {
  if (!pos) return [];
  const guns = crewGuns(ship, crew);
  const special = crew === PILOT && !!specialFor(game, ship);
  return destroyersOf(game, ship.owner === 0 ? 1 : 0).filter(
    (d) => d.pos !== null && !d.exploded && (guns.some((g) => destroyerHexInReach(game, ship, g, crew, d, pos, facing) !== null) || (special && destroyerHexInReach(game, ship, SPECIAL, crew, d, pos, facing) !== null)),
  );
}

/** What a shot at a Star Destroyer would face (Rules: Star Destroyers): the normal modifiers, and for a special weapon the body rating of the ship (40, 25 or 8) off the difficulty; the damage is worked out apart. */
export function previewDestroyerShot(game: GameState, shooter: Ship, gun: number, d: Destroyer, hex: Hex, crew: string = PILOT, pos: Hex | null = shooter.pos, facing: Facing = shooter.facing): ShotPreview {
  const range = hexDistance(pos!, hex);
  const crewPlan = planOf(shooter, crew);
  let base: number;
  let label: string;
  let power = 0;
  let ion = false;
  const powerParts: DifficultyPart[] = [];
  if (gun === SPECIAL) {
    const kind = specialFor(game, shooter)!.kind;
    base = specialToHit(kind, Math.max(1, range)) ?? 99;
    label = kind;
    power = SPECIAL_DICE[kind];
    powerParts.push({ label: `${kind}: ${power} dice of damage`, value: power });
  } else {
    const code = shooter.guns[gun]!;
    const parsed = parseGun(code);
    base = toHitNumber(parsed, range, seatOf(crew) === null ? 'pilot' : 'gunner');
    label = code;
    ion = parsed.ion;
    power = powerNumber(parsed, range);
    powerParts.push({ label: `${code} power at range ${range}`, value: power });
  }
  const { parts } = shotBreakdown({
    base,
    firer: { halfLoop: shooter.plan.halfLoop, roll: shooter.plan.roll, jink: shooter.plan.jink, pinpointFire: gun === SPECIAL ? 0 : crewPlan.pinpointFire },
    target: { halfLoop: 0, roll: 0, jink: 0, pinpointFire: 0 },
    firerTracking: shooter.tracking?.target === d.id ? shooter.tracking.level : 0,
    targetTracking: 0,
    firerSpeed: shooter.speed,
    targetSpeed: destroyerSpeed(d),
    facing: facingRelation(shooter.facing, d.facing),
  });
  parts[0] = { label: `${label} at range ${range}`, value: base };
  if (gun === SPECIAL) parts.push({ label: `${specOf(d).name}: body rating ${specOf(d).bodyRating}`, value: -specOf(d).bodyRating });
  return { gun: label, range, difficulty: sumParts(parts), power, ion, quarter: 'rear', parts, powerParts };
}

/** Shots at a Star Destroyer, all of one weapon (Rules: Star Destroyers). Guns do damage on the rear line of the Fire Table, the shields of its kind (6 for a Star Destroyer, 3 for a frigate) minus the structure points lost; special weapons need 8 body points in one shot (6 for a frigate). */
function shootDestroyer(game: GameState, shooter: Ship, order: ShotOrder, crew: string, how: string, penalty: number, tubes: number): void {
  const d = destroyerById(game, order.target);
  if (!d || d.pos === null || d.exploded) fail(`There is no such target: ${order.target}.`);
  const { pos, facing } = ownPosition(shooter);
  const hex = destroyerHexInReach(game, shooter, order.gun, crew, d!, pos, facing);
  if (!hex) fail(`${destroyerName(d!)} is out of reach of that weapon.`);
  const rng = rngOf(game);
  const special = order.gun === SPECIAL;
  const preview = previewDestroyerShot(game, shooter, order.gun, d!, hex!, crew, pos, facing);
  const seat = seatOf(crew);
  const skill = seat === null ? shooter.gunnerySkill : shooter.gunners![seat]!.skill;
  const who = seat === null ? shipName(shooter) : `${shipName(shooter)} (${crewLabel(shooter, crew)})`;
  const name = destroyerName(d!);
  for (let tube = 0; tube < (special ? tubes : 1); tube++) {
    if (d!.exploded) return;
    if (special) shooter.projectiles = (shooter.projectiles ?? 0) - 1;
    const roll = rollSkill(rng, skill, penalty);
    const hit = roll >= preview.difficulty;
    const near = !hit && special && roll >= preview.difficulty - 3;
    const result = hit ? 'hit' : near ? 'near miss' : 'miss';
    const event = say(
      game,
      'fire',
      `${who} ${how === 'snap fire' ? 'snap-fires' : 'fires'} ${special ? `a ${preview.gun}` : `its ${preview.gun}`} at ${name} (range ${preview.range}): difficulty ${preview.difficulty}, roll ${roll}: ${result}.`,
      [nameSeg(shooter), { t: how === 'snap fire' ? ' snap-fires at ' : ' fires at ' }, destroyerSeg(d!), { t: ` (range ${preview.range}): difficulty ${preview.difficulty}, rolled ${roll} → ` }, { t: result.toUpperCase(), tone: hit ? 'bad' : 'miss' }],
    );
    event.shot = { shooter: shooter.id, target: d!.id, gun: preview.gun, ion: preview.ion, hit, range: preview.range, from: { ...pos }, to: { ...hex! } };
    if (!hit && !near) continue;
    if (preview.ion) continue; // ion guns have no effect on a Star Destroyer
    let body = 0;
    let vital = false;
    if (special) {
      const dice = SPECIAL_DICE[specialFor(game, shooter)!.kind] - (hit ? 0 : 1);
      const rolls = Array.from({ length: dice }, () => rollDie(rng));
      const sum = rolls.reduce((a, b) => a + b, 0);
      // the dice less the shields of the ship (Rules 22.35, 23.42: 6 for a Star Destroyer, less the structure points it has lost) are the body points; it takes `special` of them in one shot
      const shields = destroyerShields(d!);
      const net = Math.max(0, sum - shields);
      const need = specOf(d!).special;
      const enough = net >= need;
      say(
        game,
        'damageRoll',
        `Damage roll ${dice}D: ${rolls.join(' + ')} = ${sum}${shields ? ` − ${shields} shields = ${net}` : ''} body points${enough ? '.' : `: not enough (${need} needed in one shot).`}`,
        [{ t: `damage ${dice}D: ${rolls.join('+')} = ${sum}${shields ? ` − ${shields} = ${net}` : ''}${enough ? '' : ` (${need} needed)`}` }],
        true,
      );
      body = enough ? need : 0;
    } else {
      const damageRoll = roll2d6(rng);
      const shields = destroyerShields(d!);
      const res = resolveHit({ power: preview.power, shields, ion: false, quarter: 'rear', roll: damageRoll });
      // only body and P results count (a P is one body point); a 14 or more is the top column
      const effects = res.codes.map((c) => parseDamageCode(c));
      body = effects.reduce((sum, e) => sum + (e?.kind === 'body' ? e.points : e?.kind === 'power' ? e.count : 0), 0);
      if (res.outcome === 'destroyed') body = Math.max(body, 2);
      vital = damageRoll === 12;
      say(game, 'damageRoll', `Damage roll ${damageRoll} + power ${preview.power}${shields ? ` − ${shields} shields` : ''} = ${res.modifiedRoll}: ${body} body point${body === 1 ? '' : 's'}${vital ? '; a 12: a vital system may be hit' : ''}.`, [{ t: `damage roll ${damageRoll} → ${body} body point${body === 1 ? '' : 's'}${vital ? ', 12!' : ''}` }], true);
      if (event.shot) event.shot.effect = body >= 2 ? 'heavy' : 'shield';
    }
    if (body >= 2) loseStructure(game, d!, 1, shooter.owner, special ? 'to the hit' : 'to the hit');
    if (vital) vitalHit(game, d!, shooter.owner);
  }
}

// ---------------------------------------------------------------- turn structure

function startTurn(game: GameState): void {
  game.turn += 1;
  // the owners of reserves that come in when they say decide first (Rules: Reserves), before the Initiative Phase
  if (askEntry(game)) return;
  beginTurn(game);
}

function beginTurn(game: GameState): void {
  game.phase = 'planning';
  game.planSubmitted = [activeShips(game, 0).length === 0, activeShips(game, 1).length === 0];
  if (game.emplacements?.length) game.turretOrders = [null, null];
  if (game.advancedInitiative && activeShips(game).length > 0) {
    // 19: every pilot rolls and the owners pick the order of movement before anybody plans
    game.initiative = null;
    say(game, 'turn', `Game-turn ${game.turn}.`);
    rollR2Units(game);
    startInitiative(game);
    return;
  }
  game.initiative = rollInitiative(game);
  say(game, 'turn', `Game-turn ${game.turn}. Initiative: the ${SIDES[game.initiative]}.`);
  rollR2Units(game);
  // nothing to plan on either side (only Star Destroyers on the map): the movement begins at once
  if (game.planSubmitted[0] && game.planSubmitted[1]) revealPlans(game);
}

// ---------------------------------------------------------------- advanced initiative (19)

/** The Initiative Phase (Rules: A game-turn; Advanced initiative): every pilot rolls his piloting skill; the owners then say, highest roll first, when each ship moves. */
function startInitiative(game: GameState): void {
  const ships = activeShips(game);
  const rng = rngOf(game);
  const rolls: Record<string, number> = {};
  // what decides the order: the roll, then the ship's speed (Rules: Initiative); whoever is still level rolls again
  const keys = new Map<string, number[]>();
  for (const s of ships) {
    rolls[s.id] = rollSkill(rng, s.pilotSkill);
    keys.set(s.id, [rolls[s.id]!, s.speed]);
  }
  for (;;) {
    const groups = new Map<string, string[]>();
    for (const s of ships) {
      const k = keys.get(s.id)!.join(',');
      groups.set(k, [...(groups.get(k) ?? []), s.id]);
    }
    const tied = [...groups.values()].filter((g) => g.length > 1);
    if (tied.length === 0) break;
    for (const g of tied) for (const id of g) keys.get(id)!.push(rollSkill(rng, shipById(game, id)!.pilotSkill));
  }
  const compare = (a: string, b: string): number => {
    const ka = keys.get(a)!;
    const kb = keys.get(b)!;
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
    return 0;
  };
  const order = ships.map((s) => s.id).sort(compare);
  game.initiativeTable = { rolls, order, slots: ships.map(() => null), follows: {}, cursor: 0 };
  game.phase = 'initiative';
  say(game, 'initiative', `Initiative rolls: ${order.map((id) => `${shipName(shipById(game, id)!)} ${rolls[id]}`).join(', ')}.`);
  advanceInitiative(game);
}

/** The enemy ships `ship` could be made to move with: the ones it tails that no other ship moves with yet (Rules: Advanced initiative). */
export function moveWithOptions(game: GameState, ship: Ship): string[] {
  const table = game.initiativeTable;
  if (!table || ship.status !== 'active') return [];
  return activeShips(game)
    .filter((e) => e.owner !== ship.owner && tails(ship, e) && followerOf(table, e.id) === null && !movesWithChain(table, ship.id, e.id))
    .map((e) => e.id);
}

function declareInitiative(game: GameState, cmd: Extract<Command, { type: 'slot' }>): void {
  const table = game.initiativeTable;
  const id = game.phase === 'initiative' && table ? nextPicker(table) : null;
  if (!table || !id) fail('Nobody is choosing when a ship moves right now.');
  const ship = shipById(game, id!)!;
  if (ship.owner !== cmd.player) fail(`It is the other player's turn to say when ${shipName(ship)} moves.`);
  if (cmd.moveWith !== undefined) {
    if (!moveWithOptions(game, ship).includes(cmd.moveWith)) fail(`${shipName(ship)} can’t move with that ship: it must be an enemy ship it tails that no other ship moves with.`);
    table!.follows[id!] = cmd.moveWith;
    say(game, 'initiative', `${SIDES[cmd.player]}: ${shipName(ship)} moves with ${shipName(shipById(game, cmd.moveWith)!)}.`);
  } else {
    const slot = (cmd.slot ?? 0) - 1;
    if (!Number.isInteger(slot) || slot < 0 || slot >= table!.slots.length) fail('Choose one of the slots of the table.');
    if (table!.slots[slot] !== null) fail('That slot is taken.');
    table!.slots[slot] = id!;
    say(game, 'initiative', `${SIDES[cmd.player]}: ${shipName(ship)} moves ${slotName(slot)}.`);
  }
  advanceInitiative(game);
}

/** The next ship to declare: a ship with one slot left and nothing to move with takes it without being asked (Rules: Advanced initiative); with nobody left, planning begins. */
function advanceInitiative(game: GameState): void {
  const table = game.initiativeTable!;
  for (;;) {
    const id = nextPicker(table);
    if (!id) break;
    const free = freeSlots(table);
    if (free.length !== 1 || moveWithOptions(game, shipById(game, id)!).length > 0) return;
    table.slots[free[0]!] = id;
    say(game, 'initiative', `${shipName(shipById(game, id)!)} moves ${slotName(free[0]!)}: the only slot left.`);
  }
  game.phase = 'planning';
  const lines = table.slots.flatMap((lead, i) => (lead ? [`${i + 1}. ${chainFrom(table, lead).map((id) => shipName(shipById(game, id)!)).join(' + ')}`] : []));
  say(game, 'initiative', `Order of movement: ${lines.join('; ')}.`);
}

/** The movement of a game-turn: slot after slot, each ship with those that move with it (Rules: Advanced initiative). */
function advanceSlots(game: GameState): void {
  const table = game.initiativeTable!;
  for (;;) {
    if (game.phase === 'over') return;
    if (activeShips(game).every((s) => s.moved)) {
      bookkeeping(game);
      return;
    }
    if (table.cursor >= table.slots.length) {
      // cannot happen: every ship is in the chain of some slot. Whatever is left moves in turn rather than hanging the game.
      const rest = activeShips(game).filter((s) => !s.moved);
      beginActive(game, rest.map((s) => s.id), rest[0]!.owner);
      return;
    }
    const lead = table.slots[table.cursor];
    table.cursor += 1;
    if (lead && startChain(game, chainFrom(table, lead), [])) return;
  }
}

/** A ship's phase and those of the ships that move with it. Asks each follower's owner whether it goes before or after, in turn; false when nothing in the chain is left to move. */
function startChain(game: GameState, chain: string[], placing: Placing[]): boolean {
  for (;;) {
    const i = placing.length;
    if (i >= chain.length - 1) break;
    const leader = shipById(game, chain[i]!)!;
    const follower = shipById(game, chain[i + 1]!)!;
    if (leader.status === 'active' && !leader.moved && follower.status === 'active' && !follower.moved) {
      game.pending = { kind: 'follow', player: follower.owner, ship: follower.id, leader: leader.id, chain, placing };
      return true;
    }
    // a ship that is gone leaves its follower to move in its place
    placing.push('after');
  }
  const queue = chainOrder(chain, placing).filter((id) => {
    const s = shipById(game, id)!;
    return s.status === 'active' && !s.moved;
  });
  if (queue.length === 0) return false;
  const table = game.initiativeTable!;
  say(game, 'ships', `Ship phase ${slotOf(table, chain[0]!) + 1}: ${queue.map((id) => shipName(shipById(game, id)!)).join(', then ')}.`);
  beginActive(game, queue, shipById(game, queue[0]!)!.owner);
  return true;
}

/** Each R2 unit is rolled for before planning: on 5 or less it may plan free actions this game-turn, otherwise only damage control (Rules: R2 units, auxiliary power and damage control). */
function rollR2Units(game: GameState): void {
  if (!game.damageRules) return;
  const rng = rngOf(game);
  for (const ship of activeShips(game)) {
    if (!ship.r2?.aboard) continue;
    const roll = roll2d6(rng);
    ship.r2.ready = roll <= 5;
    say(
      game,
      'r2',
      `${shipName(ship)}’s R2 unit rolled ${roll}: ${ship.r2.ready ? 'it can do a free action this game-turn' : 'it can only help with damage control this game-turn'}.`,
      [nameSeg(ship), { t: ` R2 unit: roll ${roll} → ` }, ship.r2.ready ? { t: 'ready', tone: 'good' } : { t: 'busy', tone: 'muted' }],
      true,
    );
  }
}

/** Initiative (Rules: A game-turn; Initiative): each side rolls its best pilot's piloting skill. */
function rollInitiative(game: GameState): PlayerId {
  // a side with no ships (all turrets) has nothing to roll for
  const present = ([0, 1] as PlayerId[]).filter((p) => activeShips(game, p).length > 0);
  if (present.length === 1) return present[0]!;
  // only Star Destroyers on the map: nothing to roll for, the lot decides who moves first
  if (present.length === 0) return rollDie(rngOf(game)) > 3 ? 1 : 0;
  const rng = rngOf(game);
  const best = (p: PlayerId): Ship => activeShips(game, p).reduce((a, b) => (betterPilot(b, a) ? b : a));
  for (;;) {
    const a = best(0);
    const b = best(1);
    const ra = rollSkill(rng, a.pilotSkill);
    const rb = rollSkill(rng, b.pilotSkill);
    say(game, 'initiative', `Initiative rolls: Rebels ${ra}, Empire ${rb}.`);
    if (ra !== rb) return ra > rb ? 0 : 1;
    if (a.speed !== b.speed) return a.speed > b.speed ? 0 : 1;
  }
}

function submitPlans(game: GameState, cmd: Extract<Command, { type: 'plan' }>): void {
  if (game.phase !== 'planning') fail('It isn’t the planning phase.');
  if (game.planSubmitted[cmd.player]) fail('You have already planned this game-turn.');
  const mine = activeShips(game, cmd.player);
  for (const ship of mine) {
    const plan = cmd.plans[ship.id];
    if (!plan) fail(`Missing plan for ${shipName(ship)}.`);
    const type = typeOf(ship);
    const error = planShapeError(plan!, type.shields !== null) ?? shieldMoveError(game, ship, plan!);
    if (error) fail(`${shipName(ship)}: ${error}`);
    checkTargeting(game, ship, plan!, PILOT);
    checkCrewPlans(game, ship, plan!, cmd.crewPlans?.[ship.id] ?? []);
    checkPowerAndRepairs(game, ship, plan!, cmd.crewPlans?.[ship.id] ?? []);
  }
  for (const id of [...Object.keys(cmd.plans), ...Object.keys(cmd.crewPlans ?? {})]) {
    if (!mine.some((s) => s.id === id)) fail(`Not one of your active ships: ${id}`);
  }
  for (const ship of mine) {
    const plan = clonePlan(cmd.plans[ship.id]!);
    // auxiliary power is spent as the plan is handed in (Rules: R2 units, auxiliary power and damage control)
    if (ship.aux !== undefined && !typeOf(ship).r2) ship.aux -= auxSpent(plan);
    // Red markers from last game-turn are now blue: they are part of this turn's plan (13)
    plan.roll = Math.min(2, plan.roll + ship.forcedRoll) as Level;
    plan.overspeed = Math.max(plan.overspeed, ship.forcedOverspeed) as Level;
    // what last turn's hazards forced on the ship is paid for by its crew, not by auxiliary power
    if (ship.forcedOverspeed > 0 && plan.pay?.overspeed) plan.pay.overspeed = 'c'.repeat(ship.forcedOverspeed) + plan.pay.overspeed.slice(ship.forcedOverspeed);
    trimPay(plan);
    ship.forcedRoll = 0;
    ship.forcedOverspeed = 0;
    ship.plan = plan;
    const gunnerPlans = cmd.crewPlans?.[ship.id] ?? [];
    ship.gunners?.forEach((g, i) => {
      g.plan = g.dead || !gunnerPlans[i] ? emptyPlan() : clonePlan(gunnerPlans[i]!);
    });
  }
  game.planSubmitted[cmd.player] = true;
  say(game, 'planned', `The ${SIDES[cmd.player]} finished planning.`);
  if (game.planSubmitted[0] && game.planSubmitted[1]) revealPlans(game);
}

/** Both sides have planned (or have no ship to plan for): the plans are revealed and the movement of the game-turn begins. */
function revealPlans(game: GameState): void {
  applyTurretOrders(game);
  game.phase = 'ships';
  say(game, 'plans', 'Both players have planned. The plans are revealed.');
  const order = [...activeShips(game, 0), ...activeShips(game, 1)];
  // each crew member makes their own piloting or gunnery roll (Rules: Gunners and turrets): the pilot first, then the gunners
  const hazards = order.flatMap((s): Task[] => [{ t: 'hazard', shipId: s.id }, ...livingGunners(s).map((seat): Task => ({ t: 'hazard', shipId: s.id, crew: gunnerCrewId(seat) }))]);
  game.tasks.push(...hazards, { t: 'markers' }, { t: 'asteroids' }, { t: 'destroyers' }, { t: 'startShips' });
  run(game);
}

/**
 * May `crew` track `target` with targeting (Rules: Tailing and targeting)? The ship must be tailing it; a gunner on a pivot gun may track any enemy that faces
 * the same way, tailing or not (Rules: Gunners and turrets).
 */
export function mayTrack(ship: Ship, target: Ship, crew: string): boolean {
  if (target.status !== 'active' || target.owner === ship.owner || !target.pos || !ship.pos) return false;
  if (tails(ship, target)) return true;
  if (seatOf(crew) === null) return false;
  return crewGuns(ship, crew).length > 0 && facingRelation(ship.facing, target.facing) === 'same';
}

/**
 * May `crew` track a turret gun or the ground target with targeting (Rules: Ground attack)? The ship need not be in the turret's rear center arc, but the
 * target must lie in the ship's forward center arc, unless a gunner is manning a pivot gun (Rules: Gunners and turrets).
 */
export function mayTrackEmplacement(ship: Ship, target: EmplacementTarget, crew: string): boolean {
  if (target.status !== 'active' || target.owner === ship.owner || !ship.pos) return false;
  if (seatOf(crew) !== null) return crewGuns(ship, crew).length > 0;
  return !hexEquals(ship.pos, target.pos) && arcOf(ship.pos, ship.facing, target.pos) === 'FC';
}

function checkTargeting(game: GameState, ship: Ship, plan: Plan, crew: string): void {
  if (plan.targeting === 0) return;
  const wanted = plan.targetingTarget;
  const target = wanted ? shipById(game, wanted) : undefined;
  const ground = wanted && !target && isEmplacementTarget(wanted) ? emplacementById(game, wanted) : undefined;
  const allowed = target ? mayTrack(ship, target, crew) : ground ? mayTrackEmplacement(ship, ground, crew) : false;
  if (!allowed) {
    fail(seatOf(crew) === null
      ? `${shipName(ship)} can only plan targeting against a ship it is tailing, or a turret gun or the ground target in its forward center arc.`
      : `${shipName(ship)}'s gunner can only plan targeting against a ship it is tailing, or one facing the same way, or a turret gun or the ground target.`);
  }
}

/** The gunners' plans of one ship (Rules: Gunners and turrets): only their own actions, and the ship's one tracking marker and one shield move. */
function checkCrewPlans(game: GameState, ship: Ship, pilotPlan: Plan, plans: Plan[]): void {
  const gunners = ship.gunners ?? [];
  if (plans.length > gunners.length) fail(`${shipName(ship)} has only ${gunners.length} gunner${gunners.length === 1 ? '' : 's'}.`);
  const targets = new Set<string>(pilotPlan.targeting > 0 && pilotPlan.targetingTarget ? [pilotPlan.targetingTarget] : []);
  let angling = pilotPlan.angleDeflectors > 0 ? 1 : 0;
  plans.forEach((plan, seat) => {
    const crew = gunnerCrewId(seat);
    const who = `${shipName(ship)} ${crewLabel(ship, crew)}`;
    const busy = PLAN_ACTIONS.filter((a) => plan[a] > 0);
    if (gunners[seat]?.dead && busy.length > 0) fail(`${who} is dead and can’t plan anything.`);
    for (const action of busy) {
      if (!GUNNER_ACTIONS.includes(action)) fail(`${who} can’t plan ${PLAN_LABELS[action]}: a gunner may only plan pinpoint fire, snap fire, targeting and angling deflectors.`);
    }
    const error = planShapeError(plan, typeOf(ship).shields !== null) ?? shieldMoveError(game, ship, plan);
    if (error) fail(`${who}: ${error}`);
    checkTargeting(game, ship, plan, crew);
    if (plan.targeting > 0 && plan.targetingTarget) targets.add(plan.targetingTarget);
    if (plan.angleDeflectors > 0) angling += 1;
  });
  if (targets.size > 1) fail(`${shipName(ship)} can only track one target.`);
  if (angling > 1) fail(`Only one crew member of ${shipName(ship)} may move the shields.`);
}

/**
 * The R2, auxiliary power and damage control rules (16, 17) for the plans of one ship: damage control once per ship and only for damage
 * that is there, free steps paid by auxiliary power (the pilot's only, see Rules: Gunners and turrets) or by the one R2 unit.
 */
function checkPowerAndRepairs(game: GameState, ship: Ship, pilotPlan: Plan, gunnerPlans: Plan[]): void {
  const who = shipName(ship);
  const plans = [{ crew: PILOT, plan: pilotPlan }, ...gunnerPlans.map((plan, seat) => ({ crew: gunnerCrewId(seat), plan }))];
  const touched = plans.some(({ plan }) => plan.damageControl > 0 || plan.repair || PAY_GROUPS.some((g) => freeSteps(plan, g) > 0));
  if (!game.damageRules) {
    if (touched) fail(`${who}: the R2, auxiliary power and damage control rules aren’t in effect in this game.`);
    return;
  }
  const type = typeOf(ship);
  const attempts = plans.filter(({ plan }) => plan.damageControl > 0);
  if (attempts.length > 1) fail(`${who} can only make one damage control attempt per game-turn.`);
  if (attempts[0] && !canRepair(ship, attempts[0].plan.repair)) fail(`${who}: there is no damage to repair there.`);
  let r2Uses = 0;
  let aux = 0;
  for (const { crew, plan } of plans) {
    for (const group of PAY_GROUPS) {
      const free = freeSteps(plan, group);
      if (free === 0) continue;
      if (type.r2) {
        if (!ship.r2?.aboard) fail(`${who} has lost its R2 unit.`);
        r2Uses += 1;
        if (group === 'damageControl') {
          if (free !== 1) fail(`${who}: an R2 unit does one step of damage control; the rest is paid for as usual.`);
        } else {
          if (crew !== PILOT) fail(`${who}: gunners may not use R2 free actions.`);
          if (!ship.r2!.ready) fail(`${who}: its R2 unit can only be used for damage control this game-turn.`);
          // the tight turn and the changes of speed are ladders of several actions: not something one R2 unit plans
          const difficulty = isLadder(group) ? null : type.difficulty[group as keyof typeof type.difficulty];
          if (difficulty === null || difficulty === undefined || (free === 1 && difficulty > 4) || (free === 2 && difficulty > 2)) {
            fail(`${who}: an R2 unit can only plan a single action of difficulty 4 or less, or a double action of difficulty 2 or less; not a tight turn or a change of speed.`);
          }
        }
      } else if (type.auxPower) {
        if (crew !== PILOT) fail(`${who}: gunners may not use auxiliary power.`);
        aux += free;
      } else {
        fail(`${who} has neither an R2 unit nor auxiliary power.`);
      }
    }
  }
  if (r2Uses > 1) fail(`${who} has one R2 unit, which can plan one action.`);
  if (aux > (ship.aux ?? 0)) fail(`${who} has only ${ship.aux ?? 0} unit${ship.aux === 1 ? '' : 's'} of auxiliary power left (this plan spends ${aux}).`);
}

/** A damage code, applied; the damage of a snap shot (and what it destroys) is marked with the step of the move it was fired in. */
function applyAtStep(game: GameState, task: Extract<Task, { t: 'code' }>): void {
  if (task.step === undefined) {
    applyCodeTask(game, task);
    return;
  }
  const logFrom = game.log.length;
  const counts = new Map(game.ships.map((s) => [s.id, s.wounds.length]));
  applyCodeTask(game, task);
  for (let k = logFrom; k < game.log.length; k++) game.log[k]!.moveStep = task.step;
  for (const s of game.ships) for (let k = counts.get(s.id) ?? 0; k < s.wounds.length; k++) s.wounds[k]!.moveStep = task.step;
}

/** Process queued work until a player has to decide something. */
function run(game: GameState): void {
  while (!game.pending && game.tasks.length > 0 && game.phase !== 'over' && game.phase !== 'destroyers') {
    const task = game.tasks.shift()!;
    switch (task.t) {
      case 'hazard': hazardPhase(game, task.shipId, task.crew ?? PILOT); break;
      case 'code': applyAtStep(game, task); break;
      case 'markers': markersPhase(game); break;
      case 'asteroids': asteroidPhase(game); break;
      case 'destroyers': startDestroyerPhase(game); break;
      case 'startShips': startShipPhases(game); break;
      case 'afterMove': afterMove(game); break;
      case 'endShip': endShip(game); break;
    }
  }
}

// ---------------------------------------------------------------- hazard phase (7)

/** What a gunner's hazards can do (Rules: Gunners and turrets): everything else on the Hazard Table has no effect on them. */
const GUNNER_CODES = ['A+3', 'A+6', 'LOSE', 'P', 'G'];

/** One crew member's piloting or gunnery roll against the difficulty of their own actions (Rules: Hazards; Gunners and turrets). */
function hazardPhase(game: GameState, shipId: string, crew: string): void {
  const ship = shipById(game, shipId);
  if (!ship || ship.status !== 'active') return;
  const seat = seatOf(crew);
  const gunner = seat === null ? null : ship.gunners?.[seat];
  if (seat !== null && (!gunner || gunner.dead)) return;
  const type = typeOf(ship);
  const rng = rngOf(game);
  const plan = planOf(ship, crew);
  const skill = gunner ? gunner.skill : ship.pilotSkill;
  const total = totalDifficulty(planDifficultyEntries(plan, type.difficulty, ship.stabilizerDamage, ship.actionPenalty));
  // a gunner with nothing planned has nothing to fail: no roll
  if (gunner && total === 0) return;
  const roll = rollSkill(rng, skill);
  const { hazards, minor } = hazardsFromRoll(total, roll);
  const parts = planDifficultyParts(plan, type.difficulty, ship.stabilizerDamage, ship.actionPenalty);
  const sum = parts.length > 0 ? ` (${parts.map((p) => `${p.label} ${p.value}`).join(' + ')})` : '';
  const missed = total - roll;
  const trouble = [hazards > 0 ? `${hazards} haz` : null, minor > 0 ? 'min' : null].filter(Boolean).join(' + ');
  const who = gunner ? `${shipName(ship)} (${crewLabel(ship, crew)})` : shipName(ship);
  const whoSegs: Seg[] = gunner ? [nameSeg(ship), { t: ` (${crewLabel(ship, crew)})` }] : [nameSeg(ship)];
  say(
    game,
    'hazard',
    `${who}: difficulty ${total}${sum}; ${gunner ? 'gunnery' : 'piloting'} ${skillText(skill)} rolled ${roll}` +
      (hazards + minor === 0
        ? total > 0 ? ': made it, no hazards.' : ': no hazards.'
        : `: missed by ${missed} → ${hazards} hazard${hazards === 1 ? '' : 's'}${minor ? `${hazards ? ' and' : ''} a minor hazard` : ''}.`),
    hazards + minor === 0
      ? [...whoSegs, { t: `: difficulty ${total}, rolled ${roll}: ` }, ...(total > 0 ? [{ t: 'success', tone: 'good' as const }, { t: ', no hazards' }] : [{ t: 'no hazards' }])]
      : [...whoSegs, { t: `: difficulty ${total}, rolled ${roll} → ` }, { t: trouble, tone: 'warn' }],
  );
  if (hazards + minor === 0) return;
  const letters = planHazardLetters(plan, ship.stabilizerDamage, ship.actionPenalty);
  const rows = hazardRowSequence(letters, hazards + minor);
  const tasks: Task[] = [];
  rows.forEach((row, i) => {
    const hazardRoll = roll2d6(rng);
    const isMinor = i >= hazards;
    const codes = hazardDamageCodes(row, hazardRoll, isMinor);
    // a gunner suffers only some of the codes (Rules: Gunners and turrets)
    const felt = gunner ? codes.filter((c) => GUNNER_CODES.includes(c)) : codes;
    const causes = PLAN_ACTIONS.filter((a) => plan[a] > 0 && ACTION_HAZARD_CODE[a] === row).map((a) => PLAN_LABELS[a]);
    if ((row === 'B') && (ship.stabilizerDamage > 0 || ship.actionPenalty > 0)) causes.push('damage markers');
    const ignored = codes.length - felt.length;
    say(
      game,
      'hazardRoll',
      `${who}: ${isMinor ? 'minor hazard' : 'hazard'} on row ${row}${causes.length ? ` (${causes.join(', ')})`: ''}, rolled ${hazardRoll}` +
        (codes.length ? `: ${codes.map((c) => `${c} = ${describeDamageCode(c)}`).join('; ')}${isMinor ? ' (a minor hazard uses only the top code)' : ''}${ignored > 0 ? ` (a gunner isn’t affected by ${ignored === codes.length ? 'this' : 'the other'})` : ''}.` : hazardRoll === 7 ? ': a 7 is always no effect.' : ': no effect.'),
      [{ t: `row ${row}${isMinor ? ' (minor)' : ''}${causes.length ? ` · ${causes.join(', ')}` : ''}: roll ${hazardRoll} → ${codes.length ? codes.join(', ') : 'no effect'}${ignored > 0 ? ` (gunner: ${felt.length ? felt.join(', ') : 'unaffected'})` : ''}` }],
      true,
    );
    for (const code of felt) tasks.push({ t: 'code', shipId, code, row, fromFire: false, ...(gunner ? { crew } : {}) });
  });
  game.tasks.unshift(...tasks);
}

// ---------------------------------------------------------------- damage

/** Whoever did the damage: a ship, or an emplacement (20). Only what scoring and the log need to know. */
interface Attacker {
  id: string;
  owner: PlayerId;
  name: string;
}

function attackerOf(game: GameState, id: string | undefined): Attacker | undefined {
  if (!id) return undefined;
  const ship = shipById(game, id);
  if (ship) return { id: ship.id, owner: ship.owner, name: shipName(ship) };
  const turret = game.emplacements?.find((e) => e.id === id);
  if (turret) return { id: turret.id, owner: turret.owner, name: turretName(turret) };
  const destroyer = destroyerById(game, id);
  return destroyer ? { id: destroyer.id, owner: destroyer.owner, name: destroyerName(destroyer) } : undefined;
}

function applyCodeTask(game: GameState, task: Extract<Task, { t: 'code' }>): void {
  const ship = shipById(game, task.shipId);
  if (!ship || ship.status !== 'active') return;
  const shooter = attackerOf(game, task.shooter);

  if (task.code === 'KILL') {
    destroy(game, ship, shooter, 'is destroyed');
    return;
  }
  const effect = parseDamageCode(task.code);
  if (!effect) return;
  const rng = rngOf(game);
  const hit = (): void => {
    // Victory points for hits: one victory point per engine, body or Sk-1 hit on a ship that survives
    if (shooter && ship.status === 'active') game.vp[shooter.owner] += 1;
  };
  const source = shooter ? shooter.name : task.row ? `hazard row ${task.row}` : undefined;
  /** Record the wound on the ship and tag the damage line just logged with it, for the short log. */
  const wound = (kind: Wound['kind'], text: string, key: string, verb: string, noun: string, count?: number): void => {
    ship.wounds.push({ turn: game.turn, kind, text, source });
    markHurt(game, ship, key, verb, noun, count);
  };

  switch (effect.kind) {
    case 'actionPenalty':
      ship.pendingPenalty = effect.amount === 6 || ship.pendingPenalty > 0 ? 2 : 1;
      say(game, 'damage', `${shipName(ship)} suffers an action penalty.`);
      wound('penalty', 'Action penalty', 'penalty', 'suffers', `+${ship.pendingPenalty * 3} penalty`);
      break;
    case 'body':
      ship.bodyDamage += effect.points;
      say(game, 'damage', `${shipName(ship)} takes ${effect.points} body damage (${ship.bodyDamage} of ${bodyRating(game, typeOf(ship))} lost).`);
      wound('body', `${effect.points} body damage`, 'body', 'takes', 'body damage', effect.points);
      if (ship.bodyDamage >= bodyRating(game, typeOf(ship))) destroy(game, ship, shooter, 'is destroyed by body damage');
      else hit();
      break;
    case 'engine': {
      const oldMax = ship.maxSpeed;
      ship.maxSpeed = Math.max(0, oldMax - 1);
      if (ship.speed >= oldMax) ship.speed = Math.max(0, ship.speed - 1);
      say(game, 'damage', `${shipName(ship)} suffers engine damage: maximum speed ${ship.maxSpeed}.`);
      wound('engine', `Engine hit: maximum speed ${ship.maxSpeed}`, 'engine', 'suffers', `engine hit (max speed ${ship.maxSpeed})`);
      hit();
      break;
    }
    case 'gun': {
      // a hit may take any working gun; a hazard takes a gun of the crew member who caused it (the pilot's own, or his turrets when he has no gun of his own)
      const options = task.fromFire
        ? ship.guns.flatMap((g, i) => (g ? [i] : []))
        : task.crew ? crewGuns(ship, task.crew) : pilotGunOptions(ship);
      const distinct = new Set(options.map((i) => ship.guns[i]));
      if (options.length === 0) {
        say(game, 'damage', `${shipName(ship)} has no gun to lose.`);
        break;
      }
      if (distinct.size === 1) damageGun(game, ship, options[0]!, source);
      else game.pending = { kind: 'gun', player: ship.owner, shipId: ship.id, options };
      break;
    }
    case 'lateral':
      ship.lateralDamage = Math.min(2, ship.lateralDamage + 1) as Level;
      say(game, 'damage', `${shipName(ship)} suffers lateral control damage.`);
      wound('lateral', 'Lateral control damage', 'lateral', 'suffers', 'lateral damage');
      break;
    case 'lose': {
      const row = task.row as HazardCode | null;
      const crew = task.crew ?? PILOT;
      const plan = planOf(ship, crew);
      const options = PLAN_ACTIONS.filter((a) => plan[a] > 0 && ACTION_HAZARD_CODE[a] === row);
      if (options.length === 1) loseAction(game, ship, options[0]!, source, crew);
      else if (options.length > 1) game.pending = { kind: 'lose', player: ship.owner, shipId: ship.id, letter: row!, options, ...(task.crew ? { crew } : {}) };
      else say(game, 'damage', `${shipName(ship)}${task.crew ? ` (${crewLabel(ship, crew)})` : ''} has no action to lose.`);
      break;
    }
    case 'power':
      powerLoss(game, ship, effect.count, task.quarter ?? 'front', !!task.ion, shooter);
      break;
    case 'roll':
      ship.forcedRoll = Math.min(2, ship.forcedRoll + 1) as Level;
      say(game, 'damage', `${shipName(ship)} must roll next game-turn.`);
      wound('roll', 'Forced to roll next turn', 'roll', 'must', 'roll next turn');
      break;
    case 'speedChange': {
      const up = rollDie(rng) >= 4;
      const target = Math.max(0, ship.speed + (up ? effect.amount : -effect.amount));
      const newSpeed = Math.min(target, ship.maxSpeed + 2);
      ship.speed = newSpeed;
      if (newSpeed > ship.maxSpeed) {
        const over = Math.min(2, newSpeed - ship.maxSpeed) as Level;
        ship.hazardOverspeed = Math.max(ship.hazardOverspeed, over) as Level;
        ship.forcedOverspeed = Math.max(ship.forcedOverspeed, over) as Level;
      }
      say(game, 'damage', `${shipName(ship)} has a random speed change: now speed ${ship.speed}.`);
      wound('speed', `Random speed change: now speed ${ship.speed}`, 'speed', 'gets', `a random speed change (now ${ship.speed})`);
      break;
    }
    case 'skillReduction': {
      // with a gunner aboard the owner may hurt the gunner instead of the pilot (Rules: Damage, Sk-1)
      const living = livingGunners(ship);
      if (living.length > 0) {
        game.pending = { kind: 'skill', player: ship.owner, shipId: ship.id, options: [PILOT, ...living.map(gunnerCrewId)], ...(shooter ? { shooter: shooter.id } : {}) };
        break;
      }
      hurtCrew(game, ship, PILOT, shooter);
      break;
    }
    case 'stabilizer':
      ship.stabilizerDamage = Math.min(2, ship.stabilizerDamage + 1) as Level;
      say(game, 'damage', `${shipName(ship)} suffers stabilizer damage.`);
      wound('stabilizer', 'Stabilizer damage', 'stabilizer', 'suffers', 'stabilizer damage');
      break;
    case 'turnIncrease':
      ship.turnPenalty += effect.amount;
      say(game, 'damage', `${shipName(ship)} turn number +${effect.amount} this game-turn.`);
      wound('turn', `Turn number +${effect.amount} this turn`, 'turn', 'gets', `turn number +${effect.amount}`);
      break;
  }
}

/** Tag the damage line that was just logged, so the short log can join it with the lines around it. */
function markHurt(game: GameState, ship: Ship, key: string, verb: string, noun: string, count?: number): void {
  const event = game.log[game.log.length - 1];
  if (event?.kind === 'damage') event.hurt = { shipId: ship.id, name: nameSeg(ship), key, verb, noun, count };
}

/** What a P result may take from a ship (Rules: Damage): a shield, or by the owner's choice a unit of auxiliary power or the R2 unit; a body point when no shield is left. */
function powerOptions(game: GameState, ship: Ship, box: ShieldBox, ion: boolean): PowerLoss[] {
  const shield = ship.shields[box] > 0;
  const options: PowerLoss[] = [];
  if (shield) options.push('shield');
  else if (!ion) options.push('body');
  // with an ion cannon and no shield nothing would be lost, so there is nothing to give up instead (Rules: Fire)
  if (game.damageRules && (shield || !ion)) {
    if ((ship.aux ?? 0) > 0) options.push('aux');
    if (ship.r2?.aboard) options.push('r2');
  }
  return options;
}

/** `count` power losses, one at a time; where the owner has a choice the game waits for it. */
function powerLoss(game: GameState, ship: Ship, count: number, box: ShieldBox, ion: boolean, shooter?: Attacker): void {
  for (let left = count; left > 0 && ship.status === 'active'; left--) {
    const options = powerOptions(game, ship, box, ion);
    if (options.length === 0) {
      // Fire: an ion cannon cannot inflict body damage, and a power loss with no shield left would be a body point
      say(game, 'damage', `${shipName(ship)} has no ${box} shield left; an ion cannon can’t do body damage.`);
      return;
    }
    if (options.length === 1) {
      applyPowerLoss(game, ship, options[0]!, box, shooter);
      continue;
    }
    game.pending = { kind: 'power', player: ship.owner, shipId: ship.id, options, box, left, ion, ...(shooter ? { shooter: shooter.id } : {}) };
    return;
  }
}

function applyPowerLoss(game: GameState, ship: Ship, loss: PowerLoss, box: ShieldBox, shooter?: Attacker): void {
  const source = shooter ? shooter.name : undefined;
  const wound = (kind: Wound['kind'], text: string, key: string, noun: string, verb = 'loses'): void => {
    ship.wounds.push({ turn: game.turn, kind, text, source });
    markHurt(game, ship, key, verb, noun, 1);
  };
  switch (loss) {
    case 'shield':
      ship.shields[box] -= 1;
      say(game, 'damage', `${shipName(ship)} loses a ${box} shield.`);
      wound('shield', `Lost a ${box} shield`, `shield-${box}`, `${box} shield`);
      break;
    case 'aux':
      ship.aux = Math.max(0, (ship.aux ?? 0) - 1);
      say(game, 'damage', `${shipName(ship)} loses a unit of auxiliary power (${ship.aux} left).`);
      wound('aux', `Lost a unit of auxiliary power (${ship.aux} left)`, 'aux', 'auxiliary power');
      break;
    case 'r2':
      loseR2(game, ship);
      wound('r2', 'Lost its R2 unit', 'r2', 'its R2 unit');
      break;
    case 'body':
      ship.bodyDamage += 1;
      say(game, 'damage', `${shipName(ship)} has no ${box} shield left and takes 1 body damage.`);
      wound('body', `1 body damage (no ${box} shield left)`, 'body', 'body damage', 'takes');
      if (ship.bodyDamage >= bodyRating(game, typeOf(ship))) destroy(game, ship, shooter, 'is destroyed by body damage');
      break;
  }
}

/** The R2 unit is gone (Rules: R2 units, auxiliary power and damage control): whatever it was to do this game-turn is not done. */
function loseR2(game: GameState, ship: Ship): void {
  if (!ship.r2) return;
  ship.r2 = { aboard: false, ready: false };
  say(game, 'damage', `${shipName(ship)} loses its R2 unit.`);
  for (const { plan } of crewPlans(ship)) {
    for (const group of PAY_GROUPS) {
      const free = freeSteps(plan, group);
      if (free === 0 || isLadder(group)) continue;
      // an R2 unit only plans single groups of two steps: the steps it did are gone
      const action = group as PlanAction;
      plan[action] = Math.max(0, plan[action] - free) as Level;
      trimPay(plan);
      if (action === 'damageControl' && plan.damageControl === 0) plan.repair = null;
    }
  }
}

function damageGun(game: GameState, ship: Ship, index: number, source?: string): void {
  const code = ship.guns[index];
  if (!code) return;
  ship.guns[index] = degradeGun(code);
  const result = ship.guns[index] ? `reduced to ${ship.guns[index]}` : 'destroyed';
  say(game, 'damage', `${shipName(ship)} gun ${index + 1} ${result}.`);
  ship.wounds.push({ turn: game.turn, kind: 'gun', text: `Gun ${index + 1} ${code} ${result}`, source });
  if (ship.guns[index]) markHurt(game, ship, `gun${index}`, 'suffers', `a gun hit (gun ${index + 1}: ${code} → ${ship.guns[index]})`);
  else markHurt(game, ship, `gun${index}`, 'loses', `gun ${index + 1} (${code})`);
}

/** Sk-1 (Rules: Damage): the pilot's skills fall by 1D, or (advanced game) a gunner's does. A skill below 1D is the end of that person. */
function hurtCrew(game: GameState, ship: Ship, crew: string, shooter?: Attacker): void {
  const source = shooter ? shooter.name : undefined;
  // Victory points for hits: one victory point for every Sk-1 hit on a ship that survives
  const award = (): void => {
    if (shooter && ship.status === 'active') game.vp[shooter.owner] += 1;
  };
  const seat = seatOf(crew);
  if (seat === null) {
    const pilot = reduceSkill(ship.pilotSkill);
    const gunnery = reduceSkill(ship.gunnerySkill);
    if (!pilot || !gunnery) {
      destroy(game, ship, shooter, 'loses its pilot');
      return;
    }
    ship.pilotSkill = pilot;
    ship.gunnerySkill = gunnery;
    say(game, 'damage', `${shipName(ship)} pilot is hurt: piloting ${skillText(pilot)}, gunnery ${skillText(gunnery)}.`);
    ship.wounds.push({ turn: game.turn, kind: 'pilot', text: `Pilot hurt: piloting ${skillText(pilot)}, gunnery ${skillText(gunnery)}`, source });
    markHurt(game, ship, 'pilot', 'suffers', `a pilot injury (piloting ${skillText(pilot)}, gunnery ${skillText(gunnery)})`);
    award();
    return;
  }
  const gunner = ship.gunners?.[seat];
  if (!gunner || gunner.dead) return;
  const next = reduceSkill(gunner.skill);
  if (!next) {
    gunner.dead = true;
    gunner.plan = emptyPlan();
    say(game, 'damage', `${shipName(ship)} ${crewLabel(ship, crew)} is killed.`);
    ship.wounds.push({ turn: game.turn, kind: 'pilot', text: `${crewLabel(ship, crew)[0]!.toUpperCase()}${crewLabel(ship, crew).slice(1)} killed`, source });
    markHurt(game, ship, `gunner${seat}`, 'loses', `its ${crewLabel(ship, crew)}`);
  } else {
    gunner.skill = next;
    say(game, 'damage', `${shipName(ship)} ${crewLabel(ship, crew)} is hurt: gunnery ${skillText(next)}.`);
    ship.wounds.push({ turn: game.turn, kind: 'pilot', text: `${crewLabel(ship, crew)[0]!.toUpperCase()}${crewLabel(ship, crew).slice(1)} hurt: gunnery ${skillText(next)}`, source });
    markHurt(game, ship, `gunner${seat}`, 'suffers', `a ${crewLabel(ship, crew)} injury (gunnery ${skillText(next)})`);
  }
  award();
}

/** LOSE (Rules: Damage): remove one level of an action, with overturn and over-speed changes turning into doubles. */
function loseAction(game: GameState, ship: Ship, action: PlanAction, source?: string, crew: string = PILOT): void {
  const plan = planOf(ship, crew);
  const level = plan[action];
  if (level === 0) return;
  if (level === 2) {
    plan[action] = 1;
  } else {
    plan[action] = 0;
    if (action === 'damageControl') plan.repair = null;
    if (action === 'overturn') plan.bank = 2;
    if (action === 'overaccelerate') plan.accelerate = 2;
    if (action === 'overdecelerate') plan.decelerate = 2;
  }
  trimPay(plan);
  const who = seatOf(crew) === null ? shipName(ship) : `${shipName(ship)} ${crewLabel(ship, crew)}`;
  say(game, 'damage', `${who} loses its ${action} action.`);
  ship.wounds.push({ turn: game.turn, kind: 'lose', text: `Lost its ${PLAN_LABELS[action]} action`, source });
  markHurt(game, ship, `lose-${action}`, 'loses', PLAN_LABELS[action].toLowerCase());
}

function destroy(game: GameState, ship: Ship, shooter: Attacker | undefined, why: string): void {
  if (ship.status !== 'active') return;
  ship.status = 'destroyed';
  ship.pos = null;
  say(game, 'destroyed', `${shipName(ship)} ${why}.`, [nameSeg(ship), { t: ` ${why}`, tone: 'gold' }]).shipId = ship.id;
  if (shooter && shooter.owner !== ship.owner) {
    // Victory points for hits: points for the ship, its pilot and every gunner still aboard
    const gunners = (ship.gunners ?? []).filter((g) => !g.dead).reduce((sum, g) => sum + SCORING.gunnerValue[g.quality], 0);
    game.vp[shooter.owner] += (SCORING.shipValue[ship.typeId] ?? 0) + SCORING.pilotValue[ship.quality] + gunners;
  }
  checkGameOver(game);
}

function checkGameOver(game: GameState): void {
  if (game.phase === 'over') return;
  // a game from before the scenario rules: the Ground Attack (Rules: Ground attack) ends when no attacker is left, destroyed or off the map; otherwise when one side has no ship left
  const ended = game.rules || !game.groundAttack ? gameShouldEnd(game) : activeShips(game, game.groundAttack.attacker).length === 0;
  if (!ended) return;
  game.phase = 'over';
  game.pending = null;
  game.tasks = [];
  game.winner = winnerOf(game);
  const tie = !verdictOf(game) && game.vp[0] === game.vp[1] && game.winner !== 'draw';
  say(
    game,
    'gameOver',
    `Game over. Victory points: Rebels ${game.vp[0]}, Empire ${game.vp[1]}. ` +
      (game.winner === 'draw' ? 'A draw.' : `The ${SIDES[game.winner]} ${game.winner === 0 ? 'win' : 'wins'}${tie ? ' the tie' : ''}.`),
  );
}

// ---------------------------------------------------------------- decisions

function decide(game: GameState, cmd: Extract<Command, { type: 'decide' }>): void {
  const p = game.pending;
  if (!p) fail('Nothing is waiting for a decision.');
  if (p!.player !== cmd.player) fail('That decision belongs to the other player.');
  game.pending = null;
  switch (p!.kind) {
    case 'lose': {
      const choice = p.options.find((o) => o === cmd.choice);
      if (!choice) return fail('Choose one of the offered actions.');
      loseAction(game, shipById(game, p.shipId)!, choice, undefined, p.crew ?? PILOT);
      break;
    }
    case 'skill': {
      const choice = p.options.find((o) => o === cmd.choice);
      if (!choice) return fail('Choose who is hurt: the pilot or a gunner.');
      hurtCrew(game, shipById(game, p.shipId)!, choice, attackerOf(game, p.shooter));
      break;
    }
    case 'gun': {
      if (typeof cmd.choice !== 'number' || !p.options.includes(cmd.choice)) return fail('Choose one of your working guns.');
      damageGun(game, shipById(game, p.shipId)!, cmd.choice);
      break;
    }
    case 'power': {
      const choice = p.options.find((o) => o === cmd.choice);
      if (!choice) return fail('Choose what the ship gives up.');
      const ship = shipById(game, p.shipId)!;
      const shooter = attackerOf(game, p.shooter);
      applyPowerLoss(game, ship, choice, p.box, shooter);
      powerLoss(game, ship, p.left - 1, p.box, p.ion, shooter);
      break;
    }
    case 'steal': {
      if (cmd.choice === null) {
        beginActive(game, p.queue, p.chooser);
        break;
      }
      if (typeof cmd.choice !== 'string' || !p.candidates.includes(cmd.choice)) return fail('Choose a tailing ship, or decline.');
      const queue = [cmd.choice, ...p.queue];
      say(game, 'steal', `${shipName(shipById(game, cmd.choice)!)} steals the move.`);
      // Initiative: the ship that just stole the move may itself be tailed by an enemy that steals in turn
      offerSteal(game, cmd.choice, queue, p.chooser);
      break;
    }
    case 'follow': {
      if (cmd.choice !== 'before' && cmd.choice !== 'after') return fail('Choose whether the ship moves before or after the ship it moves with.');
      say(game, 'follow', `${shipName(shipById(game, p.ship)!)} moves ${cmd.choice} ${shipName(shipById(game, p.leader)!)}.`);
      if (!startChain(game, p.chain, [...p.placing, cmd.choice])) advanceSlots(game);
      break;
    }
    case 'pass': {
      if (cmd.choice === null) {
        beginActive(game, p.queue, p.chooser);
        break;
      }
      if (typeof cmd.choice !== 'string' || !p.candidates.includes(cmd.choice)) return fail('Choose a tailed ship, or decline.');
      say(game, 'pass', `The move is passed to ${shipName(shipById(game, cmd.choice)!)}.`);
      beginActive(game, [cmd.choice, ...p.queue], p.chooser);
      break;
    }
  }
  run(game);
}

// ---------------------------------------------------------------- markers phase (8)

function markersPhase(game: GameState): void {
  for (const ship of activeShips(game)) {
    const plan = ship.plan;
    // Markers step: throttles
    const before = ship.speed;
    ship.speed = speedAfterMarkers(ship, plan);
    if (ship.speed !== before) say(game, 'markers', `${shipName(ship)} changes speed from ${before} to ${ship.speed}.`, [nameSeg(ship), { t: `: speed ${before} → ${ship.speed}` }]);

    // Markers step: shields: whoever of the crew planned it (only one may)
    const angling = crewPlans(ship).find((c) => c.plan.angleDeflectors > 0 && c.plan.deflectorDirection);
    if (angling) {
      const direction = angling.plan.deflectorDirection!;
      const from = angling.plan.deflectorFrom ?? (direction === 'front' ? 'rear' : 'front');
      const moved = Math.min(angling.plan.angleDeflectors, ship.shields[from]);
      ship.shields[from] -= moved;
      ship.shields[direction] += moved;
      if (moved > 0) say(game, 'markers', `${shipName(ship)} angles ${moved} shield${moved === 1 ? '' : 's'} from the ${from} to the ${direction}.`);
    }

    // Tailing and targeting: tracking: one marker for the ship, whoever planned it (Rules: Gunners and turrets); doubled if two of them did it
    const trackers = crewPlans(ship).filter((c) => c.plan.targeting > 0 && c.plan.targetingTarget);
    const first = trackers[0];
    if (first) {
      const wanted = first.plan.targetingTarget!;
      const target = shipById(game, wanted);
      const ground = !target && isEmplacementTarget(wanted) ? emplacementById(game, wanted) : undefined;
      const allowed = trackers.some((c) => (target && mayTrack(ship, target, c.crew)) || (ground && mayTrackEmplacement(ship, ground, c.crew)));
      if (((target && target.status === 'active') || ground) && allowed) {
        const level = Math.max(...trackers.map((c) => c.plan.targeting)) as Level;
        ship.tracking = { target: wanted, level };
        say(game, 'markers', `${shipName(ship)} tracks ${target ? shipName(target) : ground!.id === GROUND_TARGET_ID ? 'the ground target' : turretName(ground as Emplacement)}.`);
      }
    }
  }
}

// ---------------------------------------------------------------- emplacements (20, 29)

/** Does a damage code ask the owner of the ship to decide something (which gun, which action, what to give up)? Those wait until the move is over. */
function needsDecision(code: string): boolean {
  if (code === 'KILL') return false;
  const effect = parseDamageCode(code);
  return !!effect && (effect.kind === 'gun' || effect.kind === 'lose' || effect.kind === 'power' || effect.kind === 'skillReduction');
}

/** May this turret fire at this ship from where it stands? Not when one of its own side's ships is in its arc and nearer (Rules: Ground attack). */
function turretMayFire(game: GameState, turret: Emplacement, ship: Ship): boolean {
  if (!ship.pos || !turretReaches(turret, ship.pos)) return false;
  const distance = hexDistance(turret.pos, ship.pos);
  return !activeShips(game, turret.owner).some((f) => f.pos && f.id !== ship.id && turretReaches(turret, f.pos) && hexDistance(turret.pos, f.pos) < distance);
}

/** What a shot of a turret at a ship would face (Rules: Ground attack): the number on the counter, the target's jinking, tracking and, outside the centre arcs, speed; and the power. */
export function previewTurretShot(game: GameState, turret: Emplacement, ship: Ship): ShotPreview {
  const range = hexDistance(turret.pos, ship.pos!);
  const base = turretToHit(turret, range);
  // Ground attack: targeting, tracking and jinking count; rolls, half loops and pinpoint fire do not, and a turret does not maneuver
  const { parts } = shotBreakdown({
    base,
    firer: { halfLoop: 0, roll: 0, jink: 0, pinpointFire: 0 },
    target: { halfLoop: 0, roll: 0, jink: ship.plan.jink, pinpointFire: 0 },
    firerTracking: turret.tracking?.target === ship.id ? turret.tracking.level : 0,
    targetTracking: ship.tracking && ship.tracking.target !== turret.id ? ship.tracking.level : 0,
    firerSpeed: 0,
    targetSpeed: 0,
    facing: 'other',
  });
  const label = turret.kind === 'single' || turret.reduced ? 'SH' : 'DH';
  parts[0] = { label: `${label} at range ${range}`, value: base };
  // the target's speed counts unless the turret lies in its front or rear centre arc (Rules: Ground attack)
  const seen = arcOf(ship.pos!, ship.facing, turret.pos);
  if (seen !== 'FC' && seen !== 'RC' && ship.speed > 0) parts.push({ label: `Target's speed (${ship.speed}): the turret isn’t ahead of or behind it`, value: ship.speed });
  const quarter = quarterAgainst(game, ship, turret.pos);
  const power = turretPower(turret, range);
  const shields = ship.shields[quarter];
  const powerParts: DifficultyPart[] = [{ label: `${label} power at range ${range}`, value: power }];
  if (shields > 0) powerParts.push({ label: `Target's ${quarter} shields`, value: -shields });
  return { gun: label, range, difficulty: parts.reduce((sum, p) => sum + p.value, 0), power: power - shields, ion: false, quarter, parts, powerParts };
}

/**
 * The turret guns of the other side may fire at a ship that has come to a hex (Rules: Ground attack). Each fires once a game-turn, at the last chance (the ship is
 * about to leave its arc or range, or its move ends: `next` is the next hex of the move, null at the end), or sooner when the chance to hit has
 * reached its standing order. The damage that needs no decision is dealt at once, so that a destroyed ship goes no further; the rest is left in `deferred`.
 */
function turretCheck(game: GameState, ship: Ship, step: number, next: Hex | null, deferred: Task[]): void {
  for (const turret of game.emplacements ?? []) {
    if (ship.status !== 'active' || game.phase === 'over') return;
    if (turret.status !== 'active' || turret.fired || turret.owner === ship.owner || !turretMayFire(game, turret, ship)) continue;
    const chance = chanceAtLeast(turret.skill, 0, previewTurretShot(game, turret, ship).difficulty);
    if (chance <= 0) continue; // a shot that cannot hit is not fired
    const lastChance = next === null || !turretReaches(turret, next);
    // at once at the upper limit; at the last chance only at the lower limit or better, otherwise the shot is kept for another ship
    const go = turret.chance !== null && chance >= turret.chance / 100 ? true : lastChance && chance >= (turret.lastChance ?? 0) / 100;
    if (go) fireTurret(game, turret, ship, step, deferred);
  }
}

function fireTurret(game: GameState, turret: Emplacement, ship: Ship, step: number, deferred: Task[]): void {
  const rng = rngOf(game);
  const preview = previewTurretShot(game, turret, ship);
  turret.fired = true;
  const roll = rollSkill(rng, turret.skill);
  const hit = roll >= preview.difficulty;
  const name = turretName(turret);
  const turretSeg: Seg = { t: name, tone: turret.owner === 0 ? 'p0' : 'p1' };
  const event = say(
    game,
    'fire',
    `${name} fires at ${shipName(ship)} (range ${preview.range}): difficulty ${preview.difficulty}, roll ${roll}: ${hit ? 'hit' : 'miss'}.`,
    [turretSeg, { t: ' fires at ' }, nameSeg(ship), { t: ` (range ${preview.range}): difficulty ${preview.difficulty}, rolled ${roll} → ` }, { t: hit ? 'HIT' : 'MISS', tone: hit ? 'bad' : 'miss' }],
  );
  event.moveStep = step;
  event.shot = { shooter: turret.id, target: ship.id, gun: preview.gun, ion: false, hit, range: preview.range, from: { ...turret.pos }, to: { ...ship.pos! } };
  if (!hit) return;
  const damageRoll = roll2d6(rng);
  const result = resolveHit({ power: turretPower(turret, preview.range), shields: ship.shields[preview.quarter], ion: false, quarter: preview.quarter, roll: damageRoll });
  const powerText = `${damageRoll} ${result.power >= 0 ? '+' : '−'} power ${Math.abs(result.power)} = ${result.modifiedRoll}`;
  const effects = result.codes.map((c) => parseDamageCode(c));
  const bodyPoints = effects.reduce((sum, e) => sum + (e?.kind === 'body' ? e.points : 0), 0);
  event.shot.effect = result.outcome === 'destroyed' || bodyPoints >= 3 ? 'heavy' : effects.every((e) => !e || e.kind === 'power') ? 'shield' : 'hull';
  const outcome = result.outcome === 'destroyed' ? 'destroyed (14 or more always kills)' : result.codes.length ? `${preview.quarter} quarter hit: ${result.codes.join(', ')}` : 'no effect';
  const line = say(game, 'damageRoll', `Damage roll ${powerText}: ${outcome}.`, [{ t: `damage roll ${powerText} → ${result.outcome === 'destroyed' ? 'destroyed' : result.codes.length ? result.codes.join(', ') : 'no effect'}` }], true);
  line.moveStep = step;
  const tasks: Task[] = [];
  if (result.outcome === 'destroyed') tasks.push({ t: 'code', shipId: ship.id, code: 'KILL', row: null, fromFire: true, shooter: turret.id, step });
  for (const code of result.codes) tasks.push({ t: 'code', shipId: ship.id, code, row: null, fromFire: true, quarter: preview.quarter, shooter: turret.id, step });
  for (const task of tasks) {
    if (task.t === 'code' && needsDecision(task.code)) deferred.push(task);
    else if (task.t === 'code') applyAtStep(game, task);
  }
}

export type EmplacementTarget = Emplacement | GroundTarget;

/** An emplacement (or the ground target) that is still there, by its id: "E3", "GT". */
export function emplacementById(game: GameState, id: string): EmplacementTarget | undefined {
  if (id === GROUND_TARGET_ID) return game.groundTarget?.status === 'active' ? game.groundTarget : undefined;
  return game.emplacements?.find((e) => e.id === id && e.status === 'active');
}

/** Could this gun (or the special weapon) of the ship hit the emplacement from `pos`, facing `facing`? (Rules: Ground attack) */
export function emplacementInReach(game: GameState, shooter: Ship, gun: number, crew: string, target: EmplacementTarget, pos: Hex | null = shooter.pos, facing: Facing = shooter.facing): boolean {
  if (!pos || target.owner === shooter.owner) return false;
  if (gun === SPECIAL) {
    const weapon = specialFor(game, shooter);
    return !!weapon && crew === PILOT && !shooter.turnedInLastHex && specialReaches(weapon.kind, pos, facing, target.pos);
  }
  return shooter.guns[gun] !== null && !hexEquals(pos, target.pos) && gunReaches(shooter, gun, crew, pos, facing, target.pos);
}

/** The emplacements (and the ground target) of the other side that a crew member's guns could hit from here. */
export function emplacementsForCrew(game: GameState, ship: Ship, crew: string, pos: Hex | null = ship.pos, facing: Facing = ship.facing): EmplacementTarget[] {
  if (!pos) return [];
  const all: EmplacementTarget[] = [...(game.emplacements ?? []).filter((e) => e.status === 'active'), ...(game.groundTarget?.status === 'active' ? [game.groundTarget] : [])];
  const guns = crewGuns(ship, crew);
  return all.filter((t) => t.owner !== ship.owner && (guns.some((g) => emplacementInReach(game, ship, g, crew, t, pos, facing)) || (crew === PILOT && emplacementInReach(game, ship, SPECIAL, crew, t, pos, facing))));
}

/** What a shot at an emplacement would face (Rules: Ground attack): your own maneuvers and tracking, your speed always, 10 more for the ground target against guns, 5 less for a turret against a special weapon (Rules: Missiles, torpedoes and bombs). */
export function previewEmplacementShot(game: GameState, shooter: Ship, gun: number, target: EmplacementTarget, crew: string = PILOT, pos: Hex | null = shooter.pos, facing: Facing = shooter.facing): ShotPreview {
  if (!pos || !emplacementInReach(game, shooter, gun, crew, target, pos, facing)) fail(`${target.id} is out of reach of that weapon.`);
  const range = hexDistance(pos!, target.pos);
  const crewPlan = planOf(shooter, crew);
  let base: number;
  let label: string;
  let power = 0;
  let ion = false;
  const powerParts: DifficultyPart[] = [];
  if (gun === SPECIAL) {
    const kind = specialFor(game, shooter)!.kind;
    base = specialToHit(kind, Math.max(1, range)) ?? 99;
    label = kind;
    power = SPECIAL_DICE[kind];
    powerParts.push({ label: `${kind}: ${power} dice of damage`, value: power });
  } else {
    const code = shooter.guns[gun]!;
    const parsed = parseGun(code);
    base = toHitNumber(parsed, range, seatOf(crew) === null ? 'pilot' : 'gunner');
    label = code;
    ion = parsed.ion;
    power = powerNumber(parsed, range);
    powerParts.push({ label: `${code} power at range ${range}`, value: power });
  }
  const { parts } = shotBreakdown({
    base,
    firer: { halfLoop: shooter.plan.halfLoop, roll: shooter.plan.roll, jink: shooter.plan.jink, pinpointFire: gun === SPECIAL ? 0 : crewPlan.pinpointFire },
    target: { halfLoop: 0, roll: 0, jink: 0, pinpointFire: 0 },
    firerTracking: shooter.tracking?.target === target.id ? shooter.tracking.level : 0,
    targetTracking: 0,
    firerSpeed: 0,
    targetSpeed: 0,
    facing: 'other',
  });
  parts[0] = { label: `${label} at range ${range}`, value: base };
  if (shooter.speed > 0) parts.push({ label: `Your speed (${shooter.speed})`, value: shooter.speed });
  const ground = target.id === GROUND_TARGET_ID;
  if (ground && gun !== SPECIAL) parts.push({ label: 'Firing at the ground target', value: 10 });
  // the target's body rating is taken off the difficulty of a special weapon, as for a ship (Rules: Missiles, torpedoes and bombs)
  if (gun === SPECIAL) {
    const rating = ground ? GROUND_TARGET_BODY : TURRET_BODY;
    parts.push({ label: `${ground ? 'Ground target' : 'Turret gun'}: body rating ${rating}`, value: -rating });
  }
  const quarter = ground ? 'front' : turretQuarter(target as Emplacement, pos!);
  return { gun: label, range, difficulty: parts.reduce((sum, p) => sum + p.value, 0), power, ion, quarter, parts, powerParts };
}

/** A turret gun is destroyed (Rules: Ground attack): the points for it, and, when it took 5 body points, the blast that hurts the ships within two hexes. */
function destroyTurret(game: GameState, turret: Emplacement, by: Ship, blast: boolean, codeTasks: Task[]): void {
  turret.status = 'destroyed';
  const points = turret.reduced ? TURRET_POINTS.single : TURRET_POINTS[turret.kind];
  game.vp[by.owner] += points;
  const name = turretName(turret);
  const event = say(game, 'destroyed', `${name} is destroyed${blast ? ' and blows up' : ''} (${points} victory point${points === 1 ? '' : 's'}).`, [{ t: name, tone: turret.owner === 0 ? 'p0' : 'p1' }, { t: blast ? ' blows up' : ' is destroyed', tone: 'gold' }]);
  event.shipId = turret.id;
  if (!blast) return;
  const rng = rngOf(game);
  for (const ship of activeShips(game)) {
    if (!ship.pos || hexDistance(turret.pos, ship.pos) > 2) continue;
    // each ship in reach: a roll on the Front Quarter line less 2, shields no help (Rules: Ground attack)
    const roll = roll2d6(rng);
    const result = resolveHit({ power: -2, shields: 0, ion: false, quarter: 'front', roll });
    say(game, 'damageRoll', `The blast hits ${shipName(ship)}: ${roll} − 2 = ${result.modifiedRoll}: ${result.outcome === 'destroyed' ? 'destroyed' : result.codes.length ? result.codes.join(', ') : 'no effect'}.`, [{ t: `blast on ${shipName(ship)}: ${roll} − 2 → ${result.outcome === 'destroyed' ? 'destroyed' : result.codes.length ? result.codes.join(', ') : 'no effect'}` }], true);
    // an enemy ship that is hurt counts for the shooter; a friendly one does not
    const scorer = ship.owner !== by.owner ? { shooter: by.id } : {};
    if (result.outcome === 'destroyed') codeTasks.push({ t: 'code', shipId: ship.id, code: 'KILL', row: null, fromFire: true, ...scorer });
    for (const code of result.codes) codeTasks.push({ t: 'code', shipId: ship.id, code, row: null, fromFire: true, quarter: 'front', ...scorer });
  }
}

/** What a hit did to an emplacement (Rules: Ground attack): body points, a G result (a gun lost), or a kill. */
function hurtEmplacement(game: GameState, target: EmplacementTarget, by: Ship, hit: { codes: string[]; kill: boolean; points?: number }, codeTasks: Task[]): void {
  const effects = hit.codes.map((c) => parseDamageCode(c));
  if (target.id === GROUND_TARGET_ID) {
    const ground = target as GroundTarget;
    // only body points count, all other codes are ignored, and so are P results (Rules: Ground attack)
    const points = hit.points ?? effects.reduce((sum, e) => sum + (e?.kind === 'body' ? e.points : 0), 0);
    if (points <= 0 && !hit.kill) return;
    ground.damage += hit.kill ? GROUND_TARGET_BODY : points;
    say(game, 'damage', `The ground target takes ${points} body damage (${Math.min(ground.damage, GROUND_TARGET_BODY)} of ${GROUND_TARGET_BODY} lost).`);
    if (ground.damage >= GROUND_TARGET_BODY) {
      ground.status = 'destroyed';
      game.vp[by.owner] += GROUND_TARGET_POINTS;
      say(game, 'destroyed', `The ground target is destroyed (${GROUND_TARGET_POINTS} victory points).`, [{ t: 'The ground target is destroyed', tone: 'gold' }]).shipId = ground.id;
      checkGameOver(game);
    }
    return;
  }
  const turret = target as Emplacement;
  // body points, and P results as body damage, since a turret has no shields (Rules: Ground attack)
  const body = hit.points ?? effects.reduce((sum, e) => sum + (e?.kind === 'body' ? e.points : e?.kind === 'power' ? e.count : 0), 0);
  if (hit.kill || body >= TURRET_BODY) {
    destroyTurret(game, turret, by, true, codeTasks);
    return;
  }
  if (effects.some((e) => e?.kind === 'gun')) {
    if (turret.kind === 'double' && !turret.reduced) {
      turret.reduced = true;
      game.vp[by.owner] += TURRET_POINTS.double - TURRET_POINTS.single;
      say(game, 'damage', `${turretName(turret)} loses a gun: it is a single turret gun now.`, [{ t: turretName(turret), tone: turret.owner === 0 ? 'p0' : 'p1' }, { t: ' loses a gun', tone: 'gold' }]).shipId = turret.id;
    } else {
      destroyTurret(game, turret, by, false, codeTasks);
    }
  }
}

/** Shots at an emplacement or the ground target, all of one weapon: the roll to hit, then the damage (Rules: Ground attack). Near misses count for special weapons (Rules: Missiles, torpedoes and bombs). */
function shootEmplacement(game: GameState, shooter: Ship, order: ShotOrder, crew: string, how: string, penalty: number, tubes: number, codeTasks: Task[]): void {
  const target = emplacementById(game, order.target);
  if (!target) {
    // an earlier gun of the same volley may just have destroyed it: the volley is fired at once, so the rest is wasted, not illegal
    const known = order.target === GROUND_TARGET_ID ? game.groundTarget : game.emplacements?.find((e) => e.id === order.target);
    if (!known) fail(`There is no such target: ${order.target}.`);
    return;
  }
  const rng = rngOf(game);
  const { pos } = ownPosition(shooter);
  const special = order.gun === SPECIAL;
  const preview = previewEmplacementShot(game, shooter, order.gun, target!, crew);
  const seat = seatOf(crew);
  const skill = seat === null ? shooter.gunnerySkill : shooter.gunners![seat]!.skill;
  const who = seat === null ? shipName(shooter) : `${shipName(shooter)} (${crewLabel(shooter, crew)})`;
  const name = target!.id === GROUND_TARGET_ID ? 'the ground target' : turretName(target as Emplacement);
  for (let n = 0; n < (special ? tubes : 1); n++) {
    if (target!.status !== 'active') break;
    if (special) shooter.projectiles = (shooter.projectiles ?? 0) - 1;
    const roll = rollSkill(rng, skill, penalty);
    const hit = roll >= preview.difficulty;
    const near = !hit && roll >= preview.difficulty - 3;
    const result = hit ? 'hit' : near && special ? 'near miss' : 'miss';
    const event = say(
      game,
      'fire',
      `${who} ${how === 'snap fire' ? 'snap-fires' : 'fires'} ${special ? `a ${preview.gun}` : `its ${preview.gun}`} at ${name} (range ${preview.range}): difficulty ${preview.difficulty}, roll ${roll}: ${result}.`,
      [nameSeg(shooter), { t: how === 'snap fire' ? ' snap-fires at ' : ' fires at ' }, { t: name, tone: 'muted' }, { t: ` (range ${preview.range}): difficulty ${preview.difficulty}, rolled ${roll} → ` }, { t: result.toUpperCase(), tone: hit ? 'bad' : 'miss' }],
    );
    event.shot = { shooter: shooter.id, target: order.target, gun: preview.gun, ion: preview.ion, hit, range: preview.range, from: { ...pos }, to: { ...target!.pos } };
    if (!hit && !(near && special)) continue;
    if (special) {
      const dice = SPECIAL_DICE[specialFor(game, shooter)?.kind ?? 'PT'] - (hit ? 0 : 1);
      const rolls = Array.from({ length: dice }, () => rollDie(rng));
      const sum = rolls.reduce((a, b) => a + b, 0);
      say(game, 'damageRoll', `Damage roll ${dice}D: ${rolls.join(' + ')} = ${sum} body points.`, [{ t: `damage ${dice}D: ${rolls.join('+')} = ${sum}` }], true);
      event.shot.effect = sum >= TURRET_BODY ? 'heavy' : 'hull';
      hurtEmplacement(game, target!, shooter, { codes: [], kill: false, points: sum }, codeTasks);
    } else {
      const damageRoll = roll2d6(rng);
      const res = resolveHit({ power: preview.power, shields: 0, ion: preview.ion, quarter: preview.quarter, roll: damageRoll });
      // only body damage counts against the ground target: a roll of 14 or more is not a kill there but the top column's body damage plus one per point above 13
      const groundTop = target!.id === GROUND_TARGET_ID && res.outcome === 'destroyed' ? (preview.ion ? 0 : topRollBodyDamage(res.modifiedRoll)) : null;
      const text = groundTop !== null ? `${groundTop} body damage (14 or more: the top column plus ${res.modifiedRoll - 13})` : res.outcome === 'destroyed' ? 'destroyed (14 or more always kills)' : res.codes.length ? `${preview.quarter} quarter hit: ${res.codes.join(', ')}` : 'no effect';
      say(game, 'damageRoll', `Damage roll ${damageRoll} + power ${preview.power} = ${res.modifiedRoll}: ${text}.`, [{ t: `damage roll ${damageRoll} + ${preview.power} = ${res.modifiedRoll} → ${groundTop !== null ? `${groundTop} body damage` : res.outcome === 'destroyed' ? 'destroyed' : res.codes.length ? res.codes.join(', ') : 'no effect'}` }], true);
      event.shot.effect = res.outcome === 'destroyed' ? 'heavy' : res.codes.length ? 'hull' : 'shield';
      hurtEmplacement(game, target!, shooter, groundTop !== null ? { codes: [], kill: false, points: groundTop } : { codes: res.codes, kill: res.outcome === 'destroyed' }, codeTasks);
    }
  }
}

// ---------------------------------------------------------------- asteroids (24)

/** The difficulty of the piloting roll of a ship that meets an asteroid (Rules: Asteroid fields): 3 for every hex of its size, and the actions the ship is performing. */
export function asteroidDifficulty(ship: Ship, size: number): number {
  return size * 3 + totalDifficulty(planDifficultyEntries(ship.plan, typeOf(ship).difficulty, ship.stabilizerDamage, ship.actionPenalty));
}

/** A piloting roll for a ship in a hex with an asteroid; if it fails, the shortfall is the body points of damage, less one for each shield marker on the side hit (Rules: Asteroid fields). */
function asteroidContact(game: GameState, ship: Ship, rock: Rock, quarter: ShieldBox, how: string): void {
  if (ship.status !== 'active') return;
  const difficulty = asteroidDifficulty(ship, rockSize(rock));
  const roll = rollSkill(rngOf(game), ship.pilotSkill);
  const name = rockName(rock);
  if (roll >= difficulty) {
    say(game, 'asteroid', `${shipName(ship)} ${how} ${name}: difficulty ${difficulty}, roll ${roll}: no harm.`, [nameSeg(ship), { t: ` ${how} ${name}: difficulty ${difficulty}, rolled ${roll} → ` }, { t: 'no harm', tone: 'good' }]);
    return;
  }
  const points = Math.max(0, difficulty - roll - ship.shields[quarter]);
  const shieldText = ship.shields[quarter] > 0 ? ` less ${ship.shields[quarter]} for the ${quarter} shield${ship.shields[quarter] === 1 ? '' : 's'}` : '';
  say(
    game,
    'asteroid',
    `${shipName(ship)} ${how} ${name}: difficulty ${difficulty}, roll ${roll}: ${difficulty - roll} body points${shieldText} = ${points}.`,
    [nameSeg(ship), { t: ` ${how} ${name}: difficulty ${difficulty}, rolled ${roll} → ` }, { t: points > 0 ? `${points} body point${points === 1 ? '' : 's'}` : 'shielded', tone: points > 0 ? 'bad' : 'good' }],
  );
  if (points === 0) return;
  ship.bodyDamage += points;
  say(game, 'damage', `${shipName(ship)} takes ${points} body damage (${ship.bodyDamage} of ${bodyRating(game, typeOf(ship))} lost).`);
  ship.wounds.push({ turn: game.turn, kind: 'body', text: `${points} body damage`, source: name });
  markHurt(game, ship, 'body', 'takes', 'body damage', points);
  if (ship.bodyDamage >= bodyRating(game, typeOf(ship))) destroy(game, ship, undefined, 'is destroyed by an asteroid');
}

/** After the Markers Phase and before the first ship moves, the asteroids move (Rules: Asteroid fields): by themselves, and what was lost from the field comes back at its edge. */
function asteroidPhase(game: GameState): void {
  const field = game.asteroids;
  // the dice-driven motion starts on the second game-turn, so that the first move is made with the field as it was set up
  if (!field || (field.motion === 'events' && game.turn < 2) || game.turn <= (game.rules?.asteroidsRest ?? 0)) return;
  const rng = rngOf(game);
  // the pictures of earlier asteroid movements are not needed any more (the playback only plays the latest): they would make the saved game grow
  for (const e of game.log) delete e.rocks;
  const frames: RockFrame[] = [];
  const head = say(game, 'asteroids', 'The asteroids move.', [{ t: 'The asteroids move.', tone: 'muted' }]);
  head.rocks = frames;
  const hooks: MotionHooks = {
    log: (text, detail) => void say(game, 'asteroid', text, [{ t: text, tone: 'muted' }], detail),
    entered: (rock, entered, delta) => {
      // what the asteroid does to the ships it has moved onto is marked with the frame of its movement, so that the playback shows it as it happens
      const logFrom = game.log.length;
      const counts = new Map(game.ships.map((s) => [s.id, s.wounds.length]));
      for (const ship of activeShips(game)) {
        if (!ship.pos || !entered.some((h) => hexEquals(h, ship.pos!))) continue;
        const origin = { q: ship.pos.q - delta.q, r: ship.pos.r - delta.r };
        asteroidContact(game, ship, rock, hexEquals(origin, ship.pos) ? 'front' : quarterAgainst(game, ship, origin), 'is struck by');
      }
      const frame = frames.length - 1;
      for (let k = logFrom; k < game.log.length; k++) game.log[k]!.frame = frame;
      for (const s of game.ships) for (let k = counts.get(s.id) ?? 0; k < s.wounds.length; k++) s.wounds[k]!.frame = frame;
    },
    stop: () => game.phase === 'over',
  };
  if (field.motion === 'drift') driftTurn(field, game.map, rng, hooks, frames);
  else moveEvents(field, game.map, rng, hooks, frames);
  if (game.phase === 'over') return;
  // whatever was lost comes back, at the edge, drifting in
  const owed = field.lost;
  const born = spawnLost(field, game.map, rng, activeShips(game).flatMap((s) => (s.pos ? [s.pos] : [])));
  if (born.length > 0) {
    frames.push({ born: structuredClone(born) });
    const text = `New asteroids of total size ${owed - field.lost} drift in from the edge of the map to replace what was lost.`;
    say(game, 'asteroid', text, [{ t: text, tone: 'muted' }], true);
  }
}

// ---------------------------------------------------------------- ship phases (9, see Rules: A game-turn)

function startShipPhases(game: GameState): void {
  game.active = null;
  // no ship is left on the map (the Star Destroyers fight on alone): the game-turn is over
  if (activeShips(game).length === 0) {
    bookkeeping(game);
    return;
  }
  if (game.advancedInitiative) {
    game.initiativeTable!.cursor = 0;
    say(game, 'ships', 'The ships move in the order of the initiative table.');
    advanceSlots(game);
    return;
  }
  game.chooser = game.initiative!;
  say(game, 'ships', `The ${SIDES[game.chooser]} ${game.chooser === 0 ? 'choose' : 'chooses'} the first ship.`);
}

function chooseShip(game: GameState, cmd: Extract<Command, { type: 'chooseShip' }>): void {
  if (game.advancedInitiative) fail('The ships move in the order of the initiative table.');
  if (game.phase !== 'ships' || game.active) fail('You can’t choose a ship right now.');
  if (game.chooser !== cmd.player) fail('It is the other player\'s turn to choose a ship.');
  const ship = shipById(game, cmd.shipId);
  if (!ship || ship.status !== 'active') fail('That ship isn’t in play.');
  if (ship!.moved) fail('That ship has already moved this game-turn.');
  say(game, 'choose', `The ${SIDES[cmd.player]} chose ${shipName(ship!)}.`);
  if (ship!.owner === cmd.player) {
    // Initiative: an enemy tailing the chosen ship may steal its move
    offerSteal(game, ship!.id, [ship!.id], cmd.player);
  } else {
    // Initiative: a chosen ship that tails one of the chooser's ships may pass its move to it
    const candidates = game.ships.filter((s) => s.status === 'active' && !s.moved && s.owner === cmd.player && tails(ship!, s)).map((s) => s.id);
    if (candidates.length > 0) {
      game.pending = { kind: 'pass', player: ship!.owner, candidates, queue: [ship!.id], chooser: cmd.player };
    } else {
      beginActive(game, [ship!.id], cmd.player);
    }
  }
  run(game);
}

function offerSteal(game: GameState, targetId: string, queue: string[], chooser: PlayerId): void {
  const target = shipById(game, targetId)!;
  const candidates = game.ships
    .filter((s) => s.status === 'active' && !s.moved && !queue.includes(s.id) && s.owner !== target.owner && tails(s, target))
    .map((s) => s.id);
  if (candidates.length === 0) {
    beginActive(game, queue, chooser);
    return;
  }
  game.pending = { kind: 'steal', player: other(target.owner), target: targetId, candidates, queue, chooser };
}

function beginActive(game: GameState, queue: string[], chooser: PlayerId): void {
  game.active = { queue, index: 0, chooser, stage: 'move', waived: [] };
  skipUnavailable(game);
}

function currentShip(game: GameState): Ship | undefined {
  const a = game.active;
  return a ? shipById(game, a.queue[a.index]!) : undefined;
}

/** A ship in the queue that was destroyed or escaped before its turn simply does not move. */
function skipUnavailable(game: GameState): void {
  for (;;) {
    const a = game.active;
    if (!a) return;
    const ship = currentShip(game);
    if (ship && ship.status === 'active') {
      a.stage = 'move';
      return;
    }
    a.index += 1;
    if (a.index >= a.queue.length) {
      finishChoice(game);
      return;
    }
  }
}

function endShip(game: GameState): void {
  const a = game.active;
  if (!a) return;
  const ship = currentShip(game);
  if (ship) damageControlSegment(game, ship);
  if (ship) ship.moved = true;
  a.index += 1;
  if (a.index >= a.queue.length) finishChoice(game);
  else skipUnavailable(game);
}

/** Damage control (Rules: R2 units, auxiliary power and damage control): in the End Segment of the ship's phase, two dice decide whether the chosen system is repaired, left alone or lost for good. */
function damageControlSegment(game: GameState, ship: Ship): void {
  if (!game.damageRules || ship.status !== 'active') return;
  const attempt = crewPlans(ship).find((c) => c.plan.damageControl > 0);
  if (!attempt) return;
  const choice = attempt.plan.repair;
  if (!canRepair(ship, choice)) {
    say(game, 'repair', `${shipName(ship)}'s damage control finds nothing it can still repair.`);
    return;
  }
  const doubled = attempt.plan.damageControl === 2;
  const roll = roll2d6(rngOf(game));
  const what = describeRepairChoice(ship, choice);
  const name = nameSeg(ship);
  if (roll >= 9) {
    markBeyondRepair(ship, choice);
    say(game, 'repair', `${shipName(ship)}’s damage control on ${what}: rolled ${roll}, damaged beyond repair.`, [name, { t: ` damage control: roll ${roll} → ${what} beyond repair`, tone: 'bad' }]);
    ship.wounds.push({ turn: game.turn, kind: 'repair', text: `${what[0]!.toUpperCase()}${what.slice(1)} damaged beyond repair` });
  } else if (roll <= (doubled ? 8 : 6)) {
    const done = applyRepair(ship, choice);
    say(game, 'repair', `${shipName(ship)}’s damage control on ${what}: rolled ${roll}, ${done}.`, [name, { t: ` damage control: roll ${roll} → ${done}`, tone: 'good' }]);
  } else {
    say(game, 'repair', `${shipName(ship)}’s damage control on ${what}: rolled ${roll}, no luck this time.`, [name, { t: ` damage control: roll ${roll} → no luck`, tone: 'muted' }]);
  }
}

function finishChoice(game: GameState): void {
  const a = game.active;
  game.active = null;
  if (game.phase === 'over') return;
  if (activeShips(game).every((s) => s.moved)) {
    bookkeeping(game);
    return;
  }
  if (game.advancedInitiative) {
    advanceSlots(game);
    return;
  }
  if (a) game.chooser = other(a.chooser);
  // A player with no unmoved ships left does not have to pick the enemy's: the other player carries on
  if (activeShips(game, game.chooser).every((s) => s.moved)) game.chooser = other(game.chooser);
}

/** Bookkeeping phase (Rules: A game-turn). */
function bookkeeping(game: GameState): void {
  for (const d of game.destroyers ?? []) {
    d.moved = false;
    d.firedThisTurn = false;
  }
  for (const ship of game.ships) {
    if (ship.status !== 'active') continue;
    ship.moved = false;
    ship.plan = emptyPlan();
    for (const g of ship.gunners ?? []) g.plan = emptyPlan();
    delete ship.turretClaims;
    delete ship.turnedInLastHex;
    ship.tracking = null;
    ship.actionPenalty = ship.pendingPenalty;
    ship.pendingPenalty = 0;
    ship.turnPenalty = 0;
    ship.hazardOverspeed = 0;
  }
  say(game, 'bookkeeping', 'Markers step.');
  // the turret guns may fire again (Rules: Ground attack); their owners turn them and have them track a ship while they plan (Rules: Ground attack)
  for (const e of game.emplacements ?? []) e.fired = false;
  // reserves that come in on their own at the Markers step (Rules: Reserves)
  const coming = scheduledGroups(game, game.turn)[0];
  if (coming) return startArrival(game, coming, 'turn');
  startTurn(game);
}

/**
 * Reasonable orders for a player's turret guns: each turned (or left) so that as many enemy ships as possible, and the nearest of them, are in
 * its arc, or, when none is, so that it faces the nearest enemy; tracking the nearest ship in its arc. They keep the standing order they have.
 * For the computer players and for a player who just wants the turrets looked after.
 */
export function turretOrdersFor(game: GameState, player: PlayerId): TurretOrder[] {
  const enemies = activeShips(game, other(player)).filter((s) => s.pos);
  const orders: TurretOrder[] = [];
  for (const turret of (game.emplacements ?? []).filter((e) => e.status === 'active' && e.owner === player)) {
    let best: { turn: -1 | 0 | 1; score: number; target: string | null } | null = null;
    for (const turn of [0, -1, 1] as const) {
      const probe = { pos: turret.pos, facing: turnFacing(turret.facing, turn) };
      const reached = enemies.filter((e) => turretReaches(probe, e.pos!));
      let score = reached.reduce((sum, e) => sum + 12 - hexDistance(turret.pos, e.pos!), 0);
      if (reached.length === 0 && enemies.length > 0) {
        // nothing in the arc: face the nearest enemy as well as a hex side can
        const ahead = { q: turret.pos.q + DIRECTIONS[probe.facing]!.q * 10, r: turret.pos.r + DIRECTIONS[probe.facing]!.r * 10 };
        score = -Math.min(...enemies.map((e) => hexDistance(ahead, e.pos!)));
      }
      const nearest = reached.sort((a, b) => hexDistance(turret.pos, a.pos!) - hexDistance(turret.pos, b.pos!))[0];
      if (!best || score > best.score) best = { turn, score, target: nearest?.id ?? null };
    }
    orders.push({ id: turret.id, turn: best?.turn ?? 0, target: best?.target ?? null });
  }
  return orders;
}

/** Does this player still have to give orders to their turret guns this game-turn (the computer players ask)? */
export function needsTurretOrders(game: GameState, player: PlayerId): boolean {
  return game.phase === 'planning' && !!game.turretOrders && game.turretOrders[player] === null && (game.emplacements ?? []).some((e) => e.status === 'active' && e.owner === player);
}

interface PlannedTurret {
  facing: Facing;
  target: string | null;
  chance: number | null;
  lastChance: number;
}

/** What the orders of one player would make of their turret guns, or why they are not allowed (Rules: Ground attack). */
function checkTurretOrders(game: GameState, player: PlayerId, orders: TurretOrder[]): Map<string, PlannedTurret> {
  const mine = (game.emplacements ?? []).filter((e) => e.status === 'active' && e.owner === player);
  const seen = new Set<string>();
  const planned = new Map<string, PlannedTurret>();
  for (const turret of mine) planned.set(turret.id, { facing: turret.facing, target: null, chance: turret.chance, lastChance: turret.lastChance ?? 0 });
  for (const order of orders) {
    const turret = mine.find((e) => e.id === order.id);
    if (!turret) fail(`Not one of your turret guns: ${order.id}`);
    if (seen.has(order.id)) fail(`Two orders for ${order.id}.`);
    seen.add(order.id);
    const turn = order.turn ?? 0;
    if (turn !== -1 && turn !== 0 && turn !== 1) fail('A turret gun turns one hex side to the left or right.');
    const now = planned.get(order.id)!;
    now.facing = turnFacing(turret!.facing, turn);
    if (order.chance !== undefined) {
      if (order.chance !== null && (!Number.isInteger(order.chance) || order.chance < 10 || order.chance > 100 || order.chance % 10 !== 0)) fail('The chance to fire at is a multiple of 10 from 10 to 100 percent.');
      now.chance = order.chance;
    }
    if (order.lastChance !== undefined) {
      if (!Number.isInteger(order.lastChance) || order.lastChance < 0 || order.lastChance > 100 || order.lastChance % 10 !== 0) fail('The lowest chance for a last shot is a multiple of 10 from 0 to 100 percent.');
      now.lastChance = order.lastChance;
    }
    if (now.chance !== null && now.chance < now.lastChance) fail('A gun can’t fire at once at a lower chance than it fires at the last chance: the upper limit is at least the lower one.');
    if (order.target) {
      const target = shipById(game, order.target);
      if (!target || target.status !== 'active' || !target.pos || target.owner === player) fail(`${turretName(turret!)} can only track an enemy ship.`);
      if (!turretReaches({ pos: turret!.pos, facing: now.facing }, target!.pos!)) fail(`${shipName(target!)} isn’t in the forward centre arc of ${turretName(turret!)}, within ten hexes.`);
      now.target = order.target;
    }
  }
  return planned;
}

/**
 * The turret orders of one player (Rules: Ground attack), given while planning: rotations (Rules: Ground attack), tracking (Rules: Ground attack) and the standing order for when to fire. They can be
 * given again until the game-turn's planning is over, are secret from the other side, and take effect when both have planned. A turret gun with no order
 * stays as it is and tracks nothing.
 */
function submitTurrets(game: GameState, cmd: Extract<Command, { type: 'turrets' }>): void {
  if (game.phase !== 'planning' || !game.turretOrders) fail('Orders to the turret guns are given while planning.');
  checkTurretOrders(game, cmd.player, cmd.orders);
  game.turretOrders![cmd.player] = cmd.orders.map((o) => ({ ...o }));
}

/** Planning is over: the turret guns turn, track and take up their standing orders (Rules: Ground attack). */
function applyTurretOrders(game: GameState): void {
  if (!game.turretOrders) return;
  for (const player of [0, 1] as PlayerId[]) {
    const planned = checkTurretOrders(game, player, game.turretOrders[player] ?? []);
    let turned = 0;
    for (const turret of (game.emplacements ?? []).filter((e) => e.status === 'active' && e.owner === player)) {
      const now = planned.get(turret.id)!;
      // Ground attack: tracking the same ship as in the last game-turn makes the marker a -10 one
      turret.tracking = now.target ? { target: now.target, level: turret.tracking?.target === now.target ? 2 : 1 } : null;
      if (now.facing !== turret.facing) turned += 1;
      turret.facing = now.facing;
      turret.chance = now.chance;
      turret.lastChance = now.lastChance;
    }
    const guns = (game.emplacements ?? []).filter((e) => e.status === 'active' && e.owner === player).length;
    if (guns > 0) say(game, 'turrets', `The ${SIDES[player]}’${player === 0 ? '' : 's'} turret guns: ${turned} turned, ${[...planned.values()].filter((t) => t.target).length} tracking.`);
  }
  game.turretOrders = [null, null];
}

// ---------------------------------------------------------------- movement (10)

/** The movement rules for this ship's phase: speed, turn number and what it is obliged to do. */
export function moveContext(ship: Ship): MoveContext {
  const plan = ship.plan;
  return {
    speed: ship.speed,
    turnNumber: turnNumberAt(ship, plan, ship.speed),
    ...moveObligations(ship),
  };
}

/** The speed a ship will have after the Markers Phase if it carries out `plan` (Rules: Markers step). */
export function speedAfterMarkers(ship: Ship, plan: Plan): number {
  const delta =
    plan.accelerate + (plan.overaccelerate ? 2 + plan.overaccelerate : 0) -
    plan.decelerate - (plan.overdecelerate ? 2 + plan.overdecelerate : 0);
  const permitted = ship.maxSpeed + Math.max(plan.overspeed, ship.hazardOverspeed);
  return Math.min(Math.max(0, ship.speed + delta), permitted);
}

/** Turn number at a speed, with the maneuvers in `plan` and the ship's damage applied (Rules: Planning). */
export function turnNumberAt(ship: Ship, plan: Plan, speed: number): number {
  return turnBreakdownAt(ship, plan, speed).total;
}

/** The same turn number, with each term listed for display. */
export function turnBreakdownAt(ship: Ship, plan: Plan, speed: number): { total: number; parts: DifficultyPart[] } {
  return turnBreakdown(baseTurnNumber(typeOf(ship), speed), speed, {
    slip: plan.slip > 0,
    roll: plan.roll > 0,
    jink: plan.jink > 0,
    bank: plan.bank,
    overturn: plan.overturn,
    lateralDamage: ship.lateralDamage,
    extra: ship.turnPenalty,
  });
}

function moveObligations(ship: Ship): Omit<MoveContext, 'speed' | 'turnNumber'> {
  const plan = ship.plan;
  return {
    slipLevel: plan.slip,
    loopLevel: plan.halfLoop,
    // how many crew members may snap fire during the move: each at most once (Rules: Movement; Gunners and turrets)
    snapLevel: crewPlans(ship).filter((c) => c.plan.snapFire > 0 && canCrewFire(ship, c.crew)).length,
    slipRequired: plan.slip > 0 && ship.speed >= 1,
    loopsRequired: ship.speed >= 1 ? plan.halfLoop : 0,
  };
}

function requireActive(game: GameState, player: PlayerId, shipId: string, stage: 'move' | 'fire'): Ship {
  const a = game.active;
  if (game.phase !== 'ships' || !a) return fail('No ship is moving right now.');
  const ship = currentShip(game);
  if (!ship || ship.id !== shipId) return fail('That isn’t the ship whose turn it is.');
  if (ship.owner !== player) return fail('That ship belongs to the other player.');
  if (a!.stage !== stage) return fail(stage === 'move' ? 'The ship has already moved.' : 'The ship hasn’t moved yet.');
  return ship;
}

function moveShip(game: GameState, cmd: Extract<Command, { type: 'move' }>): void {
  const ship = requireActive(game, cmd.player, cmd.shipId, 'move');
  const { ctx, waived } = withFeasibleObligations(moveContext(ship));
  if (waived.length > 0) say(game, 'rules', `${shipName(ship)} can’t do its planned ${waived.map((w) => (w === 'halfLoop' ? 'half loop' : w)).join(' and ')}, so it doesn’t have to.`);

  let tracker: MoveTracker = startTracker(ctx);
  const start = ownPosition(ship).pos;
  const rng = rngOf(game);
  void rng;
  const shots: { order: ShotOrder[] }[] = [];
  const snapped = new Set<string>();
  let hexesBefore = 0;
  // has the ship turned in the hex it stands in? Then it may not fire special weapons from it (Rules: Missiles, torpedoes and bombs)
  let turned = false;
  // the turret guns of the other side fire at it as it goes (Rules: Ground attack): in each hex it stands in, before it leaves it or fires from it (Rules: Ground attack)
  const hasTurrets = (game.emplacements ?? []).some((t) => t.status === 'active' && t.owner !== ship.owner);
  const visits: Hex[] = [ship.pos!];
  if (hasTurrets) {
    let p = ship.pos!;
    let f = ship.facing;
    for (const s of cmd.steps) {
      if (s.kind === 'snapFire') continue;
      const m = applyStepToPosition(p, f, s.kind);
      if (!hexEquals(m.pos, p)) visits.push(m.pos);
      p = m.pos;
      f = m.facing;
    }
  }
  // the Star Destroyers of the other side fire at the moment of the move that gives the best chance (Rules: Star Destroyers)
  const plannedSd = (game.destroyers?.length ?? 0) > 0 ? planDestroyerShots(game, ship, cmd.steps) : [];
  const firedBy = new Set<string>();
  const fireSdAt = (at: number): void => {
    for (const p of plannedSd) {
      if (p.at !== at || ship.status !== 'active' || game.phase === 'over' || !canFire(p.destroyer)) continue;
      const here = { pos: { ...ship.pos! }, facing: ship.facing };
      fireDestroyer(game, p.destroyer, ship, p.origin, Math.max(0, at), deferred);
      firedBy.add(p.destroyer.id);
      if ((ship.status as string) === 'destroyed') crashIntoDestroyer(game, ship, p.destroyer, here.pos, here.facing, tracker.budget);
    }
  };
  let visit = 0;
  let checked = false;
  let arrivedBy = -1;
  const deferred: Task[] = [];
  const turretsFire = (): void => {
    if (!hasTurrets || checked || ship.status !== 'active') return;
    checked = true;
    const next = visits[visit + 1];
    turretCheck(game, ship, arrivedBy, next && isOnMap(game.map, next) ? next : null, deferred);
  };

  fireSdAt(-1);
  for (let index = 0; index < cmd.steps.length; index++) {
    const step = cmd.steps[index]!;
    if (ship.status !== 'active') break; // it escaped off the map edge: the rest of the plan is moot
    // before it fires or leaves the hex, the turret guns may fire at it
    if (hasTurrets && (step.kind === 'snapFire' || !hexEquals(applyStepToPosition(ship.pos!, ship.facing, step.kind).pos, ship.pos!))) {
      turretsFire();
      if (ship.status !== 'active' || game.phase === 'over') break;
    }
    // what happens during a step is marked with it, so that the playback shows it at that step and not after the whole move
    const logFrom = game.log.length;
    const woundsFrom = ship.wounds.length;
    const tag = (): void => {
      for (let k = logFrom; k < game.log.length; k++) game.log[k]!.moveStep = index;
      for (let k = woundsFrom; k < ship.wounds.length; k++) ship.wounds[k]!.moveStep = index;
    };
    const next = stepTracker(ctx, tracker, step.kind);
    if (!next) fail(`Illegal step: ${step.kind}.`);
    if (!canComplete(ctx, next!)) fail(`After "${step.kind}" the ship couldn’t finish a legal move.`);
    const trackerBefore = tracker;
    tracker = next!;

    if (step.kind === 'snapFire') {
      // every shot comes from a crew member who planned snap fire and has not used it yet
      const here = new Set<string>();
      for (const order of step.shots) {
        const crew = crewOrPilot(order.crew);
        if (!(planOf(ship, crew).snapFire > 0 && canCrewFire(ship, crew))) fail(`${shipName(ship)} ${crewLabel(ship, crew)} didn’t plan snap fire.`);
        if (snapped.has(crew)) fail(`${shipName(ship)} ${crewLabel(ship, crew)} has already snap fired in this move.`);
        here.add(crew);
      }
      for (const crew of here) snapped.add(crew);
      shots.push({ order: step.shots });
      resolveFire(game, ship, step.shots, 'snap fire', turned, index);
      tag();
      continue;
    }
    turned = step.kind === 'turnLeft' || step.kind === 'turnRight' ? true : step.kind === 'forward' || step.kind === 'slipLeft' || step.kind === 'slipRight' || step.kind === 'halfLoop' ? false : turned;
    const previous = ship.pos!;
    const moved = applyStepToPosition(ship.pos!, ship.facing, step.kind);
    // the way off the map across a closed edge is shut, unless it is the only way left (Rules: Reserves)
    if (exitBlocked(game, ship, moved.pos) && stepsAvoidingClosedExits(game, ship, ctx, trackerBefore).length > 0) fail(`${shipName(ship)} can leave the map only across the edge opposite the one it started from.`);
    ship.facing = moved.facing;
    ship.pos = moved.pos;
    if (!hexEquals(previous, ship.pos)) {
      visit += 1;
      checked = false;
      arrivedBy = index;
    }
    if (tracker.hexesMoved > hexesBefore) {
      hexesBefore = tracker.hexesMoved;
      checkEscape(game, ship);
    }
    // a ship that flies into a hex with an asteroid in it has to make a piloting roll (Rules: Asteroid fields); it meets it head on
    if (game.asteroids && ship.status === 'active' && ship.pos && !hexEquals(ship.pos, previous)) {
      const rock = rockAt(game.asteroids, ship.pos);
      if (rock) asteroidContact(game, ship, rock, 'front', 'flies into');
    }
    fireSdAt(index);
    tag();
  }
  // the end of its move is the last chance to fire at it
  if (game.phase !== 'over') turretsFire();
  updateMarkers(game, ship, firedBy);
  if (ship.status === 'active' && !isTrackerComplete(ctx, tracker)) {
    fail(`The ship must move ${ctx.speed} hex(es) of movement and meet its planned actions (${tracker.budget} remaining).`);
  }
  if (ship.status === 'active' && ship.pos && !hexEquals(ship.pos, start)) {
    say(game, 'move', `${shipName(ship)} moves to ${describeHex(ship.pos)} facing ${FACING_ARROWS[ship.facing]}.`, [nameSeg(ship), { t: ' moves' }, { t: ` to ${describeHex(ship.pos)}`, hex: true }, { t: ` ${FACING_ARROWS[ship.facing]}` }]);
  }
  ship.turnedInLastHex = turned;
  // the damage of the turrets that needs a decision of the owner is dealt with now that the move is over
  game.tasks.push(...deferred);
  game.tasks.push({ t: 'afterMove' });
  run(game);
}

function describeHex(h: Hex): string {
  return hexId(h);
}

/**
 * Would `ship` have left the game if it stood at `pos`? On a static map that is any hex off the
 * edge (Rules: The map). On an open map it happens when the fleet would be too spread out for the printed
 * board to be shifted around it (Rules: The map).
 */
export function leavesMap(game: GameState, ship: Ship, pos: Hex): boolean {
  if (game.map.mode === 'static') return !isOnMap(game.map, pos);
  const others = activeShips(game).flatMap((s) => (s.id !== ship.id && s.pos ? [s.pos] : []));
  return exceedsOpenLimits(game.map, [...others, pos]);
}

function checkEscape(game: GameState, ship: Ship): void {
  if (!ship.pos || !leavesMap(game, ship, ship.pos)) return;
  ship.status = 'escaped';
  ship.pos = null;
  // Convoy: the ships the scenario wants to get away earn their owner points when they do
  const bonus = escapeVpOf(game, ship);
  game.vp[ship.owner] += bonus;
  const how = game.map.mode === 'static' ? 'it has flown off the edge of the map' : 'it has flown too far from the rest of the fleet';
  say(game, 'escaped', `${shipName(ship)} escapes: ${how}${bonus ? `, and earns ${bonus} victory points` : ''}.`);
  checkGameOver(game);
}

function afterMove(game: GameState): void {
  const a = game.active;
  const ship = currentShip(game);
  if (!a || !ship || ship.status !== 'active') {
    endShip(game);
    return;
  }
  // A game-turn: a single snap fire uses up that crew member's fire; the others may fire now
  const crews = endFireCrew(ship);
  // a ship, or an asteroid (Rules: Asteroid fields), in reach of a gun
  const canFire = crews.some((crew) => targetsForCrew(game, ship, crew).length > 0 || rocksForCrew(game, ship, crew).length > 0 || emplacementsForCrew(game, ship, crew).length > 0 || destroyersForCrew(game, ship, crew).length > 0) || (crews.includes(PILOT) && targetsForSpecial(game, ship).length > 0);
  if (canFire) a.stage = 'fire';
  else endShip(game);
}

/** The crew members who may still fire in the Fire Segment: all but those whose single snap fire is already their shot (Rules: Movement; Gunners and turrets). */
export function endFireCrew(ship: Ship): string[] {
  // the pilot may still fire missiles, torpedoes or bombs (22) when every gun is gone
  const projectiles = (ship.projectiles ?? 0) > 0;
  return crewPlans(ship).filter((c) => c.plan.snapFire !== 1 && canCrewFire(ship, c.crew) && (crewGuns(ship, c.crew).length > 0 || (c.crew === PILOT && projectiles))).map((c) => c.crew);
}

/** Enemy and friendly ships in the pilot's forward centre arc within five hexes (Rules: Fire). */
export function targetsInRange(game: GameState, ship: Ship): Ship[] {
  return targetsForCrew(game, ship, PILOT);
}

/** The ships one crew member's working guns could reach from where the ship stands (or from `pos` and `facing`, for a snap shot). */
export function targetsForCrew(game: GameState, ship: Ship, crew: string, pos: Hex | null = ship.pos, facing: Facing = ship.facing): Ship[] {
  if (!pos) return [];
  const guns = crewGuns(ship, crew);
  return activeShips(game).filter((t) => t.id !== ship.id && t.pos && guns.some((g) => gunReaches(ship, g, crew, pos, facing, t.pos!)));
}

/** The legal next steps of a ship that do not take it off the map across a closed edge (Rules: Reserves). */
export function stepsAvoidingClosedExits(game: GameState, ship: Ship, ctx: MoveContext, tr: MoveTracker, from?: { pos: Hex; facing: Facing }): MoveStep[] {
  const pos = from?.pos ?? ship.pos!;
  const facing = from?.facing ?? ship.facing;
  return legalSteps(ctx, tr).filter((k) => k !== 'snapFire' && !exitBlocked(game, ship, applyStepToPosition(pos, facing, k).pos));
}

/** The steps the ship may take next, given the steps already taken this movement. */
export function legalMoveSteps(game: GameState, shipId: string, taken: MoveStep[] = []): MoveStep[] {
  const ship = shipById(game, shipId);
  if (!ship) return [];
  const { ctx } = withFeasibleObligations(moveContext(ship));
  let tr = startTracker(ctx);
  for (const step of taken) {
    const next = stepTracker(ctx, tr, step);
    if (!next) return [];
    tr = next;
  }
  return legalSteps(ctx, tr);
}

/** Has the movement been completed legally by these steps? */
export function isMoveComplete(game: GameState, shipId: string, taken: MoveStep[]): boolean {
  const ship = shipById(game, shipId);
  if (!ship) return false;
  const { ctx } = withFeasibleObligations(moveContext(ship));
  let tr = startTracker(ctx);
  for (const step of taken) {
    const next = stepTracker(ctx, tr, step);
    if (!next) return false;
    tr = next;
  }
  return isTrackerComplete(ctx, tr);
}

// ---------------------------------------------------------------- fire (11, 12)

function fireCommand(game: GameState, cmd: Extract<Command, { type: 'fire' }>): void {
  const ship = requireActive(game, cmd.player, cmd.shipId, 'fire');
  const mayFire = endFireCrew(ship);
  for (const order of cmd.shots) {
    const crew = crewOrPilot(order.crew);
    if (!mayFire.includes(crew)) {
      fail(seatOf(crew) !== null && !canCrewFire(ship, crew)
        ? `${shipName(ship)} ${crewLabel(ship, crew)} can’t fire: a ship that rolls can’t use its gunners.`
        : `${shipName(ship)} ${crewLabel(ship, crew)} can’t fire in the Fire Segment.`);
    }
  }
  if (cmd.shots.length > 0) resolveFire(game, ship, cmd.shots, 'fire', !!ship.turnedInLastHex);
  game.tasks.push({ t: 'endShip' });
  run(game);
}

export interface ShotPreview {
  gun: string;
  range: number;
  /** Difficulty to hit (Rules: Fire). */
  difficulty: number;
  /** Power after the target's shields (Rules: Fire). */
  power: number;
  ion: boolean;
  quarter: ShieldBox;
  /** Every term of the difficulty, starting with the gun's own number. */
  parts: DifficultyPart[];
  /** Where the power comes from: the gun at this range, then the target's shields. */
  powerParts: DifficultyPart[];
}

/** What a shot from `shooter`'s current position would face, without rolling anything. */
export function previewShot(game: GameState, shooter: Ship, gunIndex: number, target: Ship, crew: string = PILOT): ShotPreview {
  const code = shooter.guns[gunIndex];
  if (!code) fail('That gun isn’t working.');
  if (!shooter.pos || !target.pos) fail('Both ships must be on the map.');
  const pos = shooter.pos!;
  const gun = parseGun(code!);
  const range = hexDistance(pos, target.pos!);
  const quarter = quarterAgainst(game, target, pos);
  // the crew member's own pinpoint fire; the ship's maneuvers and tracking count for everyone aboard (Rules: Fire; Gunners and turrets)
  const crewPlan = planOf(shooter, crew);
  const { total: difficulty, parts } = shotBreakdown({
    base: toHitNumber(gun, range, seatOf(crew) === null ? 'pilot' : 'gunner'),
    firer: { halfLoop: shooter.plan.halfLoop, roll: shooter.plan.roll, jink: shooter.plan.jink, pinpointFire: crewPlan.pinpointFire },
    target: { halfLoop: target.plan.halfLoop, roll: target.plan.roll, jink: target.plan.jink, pinpointFire: 0 },
    firerTracking: shooter.tracking?.target === target.id ? shooter.tracking.level : 0,
    targetTracking: target.tracking && target.tracking.target !== shooter.id ? target.tracking.level : 0,
    firerSpeed: shooter.speed,
    targetSpeed: target.speed,
    facing: facingRelation(shooter.facing, target.facing),
  });
  parts[0] = { label: `${code} at range ${range}${gun.ion ? ' (ion cannon: 3 less)' : ''}`, value: parts[0]!.value };
  const gunPower = powerNumber(gun, range);
  const shields = gun.ion ? 0 : target.shields[quarter];
  const powerParts: DifficultyPart[] = [{ label: `${code} power at range ${range}`, value: gunPower }];
  if (shields > 0) powerParts.push({ label: `Target's ${quarter} shields`, value: -shields });
  else if (gun.ion && target.shields[quarter] > 0) powerParts.push({ label: 'Ion cannons ignore shields', value: 0 });
  const power = gunPower - shields;
  void game;
  return { gun: code!, range, difficulty, power, ion: gun.ion, quarter, parts, powerParts };
}

/** Does the ship have projectiles left, and the rules for them in effect? Returns its weapon and how many tubes it can fire now (Rules: Missiles, torpedoes and bombs). */
export function specialFor(game: GameState, ship: Ship): { kind: SpecialKind; tubes: number } | null {
  if (!game.specialWeapons || !ship.projectiles || ship.projectiles <= 0) return null;
  const weapon = specialOf(typeOf(ship));
  return weapon ? { kind: weapon.kind, tubes: Math.min(weapon.tubes, ship.projectiles) } : null;
}

/** May this target be fired at with the special weapon from here? Bombs only at a target in the same hex that is not moving (Rules: Missiles, torpedoes and bombs). */
export function specialMayHit(kind: SpecialKind, pos: Hex, facing: Facing, target: Ship): boolean {
  if (!target.pos || !specialReaches(kind, pos, facing, target.pos)) return false;
  return kind !== 'CB' || target.speed === 0;
}

/** The ships a ship could fire its special weapon at from where it stands (or from `pos` and `facing`). */
export function targetsForSpecial(game: GameState, ship: Ship, pos: Hex | null = ship.pos, facing: Facing = ship.facing): Ship[] {
  const weapon = specialFor(game, ship);
  if (!weapon || !pos || ship.turnedInLastHex) return [];
  return activeShips(game).filter((t) => t.id !== ship.id && t.owner !== ship.owner && specialMayHit(weapon.kind, pos, facing, t));
}

/** What a special weapon shot from `shooter`'s position would face: to hit (Rules: Missiles, torpedoes and bombs) and the dice of damage (Rules: Missiles, torpedoes and bombs). */
export function previewSpecial(game: GameState, shooter: Ship, target: Ship): ShotPreview {
  const weapon = specialOf(typeOf(shooter));
  if (!weapon) fail(`${shipName(shooter)} carries no missiles, torpedoes or bombs.`);
  if (!shooter.pos || !target.pos) fail('Both ships must be on the map.');
  const kind = weapon!.kind;
  const pos = shooter.pos!;
  const range = Math.max(1, hexDistance(pos, target.pos!));
  const base = specialToHit(kind, range);
  if (base === null) fail(`${SPECIAL_NAMES[kind]} don’t reach that far.`);
  // a bomb dropped in the target's own hex has no direction to come from: it falls on the front shields
  const quarter = hexEquals(pos, target.pos!) ? 'front' : quarterAgainst(game, target, pos);
  const { total, parts } = shotBreakdown({
    base: base!,
    // pinpoint fire has no effect on special weapons (Rules: Missiles, torpedoes and bombs)
    firer: { halfLoop: shooter.plan.halfLoop, roll: shooter.plan.roll, jink: shooter.plan.jink, pinpointFire: 0 },
    target: { halfLoop: target.plan.halfLoop, roll: target.plan.roll, jink: target.plan.jink, pinpointFire: 0 },
    firerTracking: shooter.tracking?.target === target.id ? shooter.tracking.level : 0,
    targetTracking: target.tracking && target.tracking.target !== shooter.id ? target.tracking.level : 0,
    firerSpeed: shooter.speed,
    targetSpeed: target.speed,
    facing: facingRelation(shooter.facing, target.facing),
  });
  parts[0] = { label: `${kind} at range ${range}`, value: base! };
  // the larger the target, the easier to hit (Rules: Missiles, torpedoes and bombs)
  const rating = bodyRating(game, typeOf(target));
  parts.push({ label: `Target's body rating (${rating})`, value: -rating });
  const dice = SPECIAL_DICE[kind];
  const shields = target.shields[quarter];
  const powerParts: DifficultyPart[] = [{ label: `${kind}: ${dice} dice of damage`, value: dice }];
  if (shields > 0) powerParts.push({ label: `Target's ${quarter} shields come off the roll`, value: -shields });
  return { gun: kind, range, difficulty: total - rating, power: dice, ion: false, quarter, parts, powerParts };
}

// ---------------------------------------------------------------- firing at asteroids (Rules: Asteroid fields)

/** An asteroid as the target of a shot: the id of the shot's target is "A" and the number of the asteroid. */
export const rockTargetId = (id: number): string => `A${id}`;

export function rockIdOf(target: string): number | null {
  const m = /^A(\d+)$/.exec(target);
  return m ? Number(m[1]) : null;
}

/** The hex of an asteroid that a gun (or the special weapon) of a ship at `pos` can hit: the nearest one in reach (Rules: Asteroid fields). Bombs do not hit asteroids (Rules: Missiles, torpedoes and bombs). */
export function rockHexInReach(game: GameState, shooter: Ship, gun: number, crew: string, rock: Rock, pos: Hex | null = shooter.pos, facing: Facing = shooter.facing): Hex | null {
  if (!pos) return null;
  const weapon = gun === SPECIAL ? specialFor(game, shooter) : null;
  if (gun === SPECIAL && (!weapon || weapon.kind === 'CB' || shooter.turnedInLastHex || crew !== PILOT)) return null;
  let best: Hex | null = null;
  for (const h of rock.hexes) {
    // a ship in one hex of an asteroid may fire at another hex of it, but not at its own
    if (hexEquals(h, pos)) continue;
    const reaches = gun === SPECIAL ? specialReaches(weapon!.kind, pos, facing, h) : shooter.guns[gun] !== null && gunReaches(shooter, gun, crew, pos, facing, h);
    if (reaches && (!best || hexDistance(pos, h) < hexDistance(pos, best))) best = h;
  }
  return best;
}

/** The asteroids a crew member's working guns could hit from here. */
export function rocksForCrew(game: GameState, ship: Ship, crew: string, pos: Hex | null = ship.pos, facing: Facing = ship.facing): Rock[] {
  const field = game.asteroids;
  if (!field || !pos) return [];
  const guns = crewGuns(ship, crew);
  return field.rocks.filter((r) => guns.some((g) => rockHexInReach(game, ship, g, crew, r, pos, facing) !== null) || (crew === PILOT && rockHexInReach(game, ship, SPECIAL, crew, r, pos, facing) !== null));
}

/** What a shot at an asteroid would face (Rules: Asteroid fields): the gun's number, 10 more, your speed; a special weapon is 5 easier for every hex of size. */
export function previewRockShot(game: GameState, shooter: Ship, gun: number, rock: Rock, crew: string = PILOT, pos: Hex | null = shooter.pos, facing: Facing = shooter.facing): ShotPreview {
  const hex = rockHexInReach(game, shooter, gun, crew, rock, pos, facing);
  if (!hex || !pos) fail(`${rockName(rock)} is out of reach of that weapon.`);
  const range = hexDistance(pos!, hex!);
  const crewPlan = planOf(shooter, crew);
  let base: number;
  let label: string;
  let power = 0;
  let ion = false;
  const powerParts: DifficultyPart[] = [];
  if (gun === SPECIAL) {
    const kind = specialFor(game, shooter)!.kind;
    base = specialToHit(kind, Math.max(1, range)) ?? 99;
    label = kind;
    power = SPECIAL_DICE[kind];
    powerParts.push({ label: `${kind}: ${power} dice of damage; 8 body points in one shot reduce an asteroid`, value: power });
  } else {
    const code = shooter.guns[gun]!;
    const parsed = parseGun(code);
    base = toHitNumber(parsed, range, seatOf(crew) === null ? 'pilot' : 'gunner');
    label = code;
    ion = parsed.ion;
    power = powerNumber(parsed, range);
    powerParts.push({ label: `${code} power at range ${range}`, value: power }, { label: 'On 2d6 + power, 14 or more reduces the asteroid', value: 0 });
  }
  // only your own maneuvers and speed count: an asteroid does nothing, and its speed is ignored (Rules: Asteroid fields)
  const { parts } = shotBreakdown({
    base,
    firer: { halfLoop: shooter.plan.halfLoop, roll: shooter.plan.roll, jink: shooter.plan.jink, pinpointFire: gun === SPECIAL ? 0 : crewPlan.pinpointFire },
    target: { halfLoop: 0, roll: 0, jink: 0, pinpointFire: 0 },
    firerTracking: 0,
    targetTracking: 0,
    firerSpeed: 0,
    targetSpeed: 0,
    facing: 'other',
  });
  parts[0] = { label: `${label} at range ${range}`, value: base };
  if (shooter.speed > 0) parts.push({ label: `Your speed (${shooter.speed})`, value: shooter.speed });
  if (gun === SPECIAL) parts.push({ label: `Asteroid of size ${rockSize(rock)}: 5 less for each`, value: -5 * rockSize(rock) });
  else parts.push({ label: 'Firing at an asteroid', value: 10 });
  return { gun: label, range, difficulty: parts.reduce((sum, p) => sum + p.value, 0), power, ion, quarter: 'front', parts, powerParts };
}

/** Shots at an asteroid, all of one weapon: the roll to hit, then 2d6 plus power of 14 or more for a gun, or 8 body points in one shot for the special weapon (Rules: Asteroid fields). */
function shootRock(game: GameState, shooter: Ship, order: ShotOrder, crew: string, how: string, penalty: number, tubes: number): void {
  const field = game.asteroids;
  const rock = field?.rocks.find((r) => r.id === rockIdOf(order.target));
  if (!field || !rock) fail('There is no such asteroid.');
  const rng = rngOf(game);
  const { pos } = ownPosition(shooter);
  const special = order.gun === SPECIAL;
  const preview = previewRockShot(game, shooter, order.gun, rock!, crew);
  const seat = seatOf(crew);
  const skill = seat === null ? shooter.gunnerySkill : shooter.gunners![seat]!.skill;
  const who = seat === null ? shipName(shooter) : `${shipName(shooter)} (${crewLabel(shooter, crew)})`;
  const aim = rockHexInReach(game, shooter, order.gun, crew, rock!)!;
  const name = rockName(rock!);
  for (let n = 0; n < (special ? tubes : 1); n++) {
    if (!field.rocks.includes(rock!)) break;
    if (special) shooter.projectiles = (shooter.projectiles ?? 0) - 1;
    const roll = rollSkill(rng, skill, penalty);
    const hit = roll >= preview.difficulty;
    // Missiles, torpedoes and bombs: a roll within 3 of the difficulty is a near miss; it matters for the special weapons (Rules: Missiles, torpedoes and bombs)
    const near = !hit && roll >= preview.difficulty - 3;
    const result = hit ? 'hit' : near && special ? 'near miss' : 'miss';
    const event = say(
      game,
      'fire',
      `${who} ${how === 'snap fire' ? 'snap-fires' : 'fires'} ${special ? `a ${preview.gun}` : `its ${preview.gun}`} at ${name} (range ${preview.range}): difficulty ${preview.difficulty}, roll ${roll}: ${result}.`,
      [nameSeg(shooter), { t: how === 'snap fire' ? ' snap-fires at ' : ' fires at ' }, { t: name, tone: 'muted' }, { t: ` (range ${preview.range}): difficulty ${preview.difficulty}, rolled ${roll} → ` }, { t: result.toUpperCase(), tone: hit ? 'bad' : 'miss' }],
    );
    event.shot = { shooter: shooter.id, target: order.target, gun: preview.gun, ion: preview.ion, hit, range: preview.range, from: { ...pos }, to: { ...aim } };
    if (!hit && !(near && special)) continue;
    let reduced = false;
    if (special) {
      const dice = SPECIAL_DICE[specialFor(game, shooter)?.kind ?? 'PT'] - (hit ? 0 : 1);
      const rolls = Array.from({ length: dice }, () => rollDie(rng));
      const sum = rolls.reduce((a, b) => a + b, 0);
      reduced = sum >= 8;
      say(game, 'damageRoll', `Damage roll ${dice}D: ${rolls.join(' + ')} = ${sum} body points${reduced ? ': the asteroid is reduced.' : ': not enough (8 needed in one shot).'}`, [{ t: `damage ${dice}D: ${rolls.join('+')} = ${sum}${reduced ? ' → reduced' : ''}` }], true);
    } else if (!preview.ion) {
      const dice = roll2d6(rng);
      reduced = dice + preview.power >= 14;
      say(game, 'damageRoll', `Damage roll ${dice} + power ${preview.power} = ${dice + preview.power}: ${reduced ? 'the asteroid is reduced (14 or more).' : 'no effect on the asteroid.'}`, [{ t: `damage roll ${dice} + ${preview.power} = ${dice + preview.power}${reduced ? ' → reduced' : ''}` }], true);
    }
    if (!reduced) continue;
    const frames: RockFrame[] = [];
    const size = rockSize(rock!);
    const kept = reduceRock(field, rock!, nearestHex(rock!, pos), frames);
    event.shot.effect = 'rock';
    const text = kept ? `${cap(name)} is reduced to size ${size - 1}.` : `${cap(name)} is destroyed.`;
    say(game, 'asteroid', text, [{ t: text, tone: 'gold' }]).rocks = frames;
    if (!kept) break;
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** One volley: every gun is rolled at once, then the damage is applied (Rules: Fire). */
function resolveFire(game: GameState, shooter: Ship, shots: ShotOrder[], kind: string, turned = false, moveStep?: number): void {
  if (shots.length === 0) return;
  // the damage of a snap shot is applied when the move is done, but told with the step it was fired in
  const stepOf = moveStep !== undefined ? { step: moveStep } : {};
  const rng = rngOf(game);
  const used = new Set<number>();
  // Fire: one die less for a crew member who fires two guns, two for three; a gunner and the pilot do not reduce each other (Rules: Gunners and turrets)
  const volley = new Map<string, number>();
  // all the tubes of the special weapon are one weapon (Rules: Missiles, torpedoes and bombs)
  for (const order of shots) volley.set(crewOrPilot(order.crew), (volley.get(crewOrPilot(order.crew)) ?? 0) + 1);
  const codeTasks: Task[] = [];
  const { pos, facing } = ownPosition(shooter);
  const claims = (shooter.turretClaims ??= {});

  for (const order of shots) {
    const crew = crewOrPilot(order.crew);
    const seat = seatOf(crew);
    const who = seat === null ? shipName(shooter) : `${shipName(shooter)} (${crewLabel(shooter, crew)})`;
    if (seat !== null && !canCrewFire(shooter, crew)) fail(`${who} can’t fire this game-turn (a ship that rolls can’t use its gunners).`);
    if (order.gun === SPECIAL) {
      if (seat !== null) fail(`${who}: only the pilot fires missiles, torpedoes and bombs.`);
      const weapon = specialFor(game, shooter);
      if (!weapon) fail(`${shipName(shooter)} has no missiles, torpedoes or bombs to fire.`);
      if (turned) fail(`${shipName(shooter)} turned in this hex and may not fire its ${SPECIAL_NAMES[weapon!.kind]} from it.`);
      if (used.has(SPECIAL)) fail('The special weapon can only fire once per volley.');
      used.add(SPECIAL);
      const tubes = order.tubes ?? 1;
      if (!Number.isInteger(tubes) || tubes < 1 || tubes > weapon!.tubes) fail(`${shipName(shooter)} can fire between 1 and ${weapon!.tubes} tubes.`);
      if (rockIdOf(order.target) !== null) {
        shootRock(game, shooter, order, crew, kind, volley.get(crew)! - 1, tubes);
        continue;
      }
      if (isDestroyerTarget(order.target)) {
        shootDestroyer(game, shooter, order, crew, kind, volley.get(crew)! - 1, tubes);
        continue;
      }
      if (isEmplacementTarget(order.target)) {
        shootEmplacement(game, shooter, order, crew, kind, volley.get(crew)! - 1, tubes, codeTasks);
        continue;
      }
      const target = shipById(game, order.target);
      if (!target || target.status !== 'active' || !target.pos || target.id === shooter.id) fail('Not a valid target.');
      if (!specialMayHit(weapon!.kind, pos, facing, target!)) {
        fail(weapon!.kind === 'CB'
          ? `${shipName(target!)} must be in the same hex and not moving to be bombed.`
          : `${shipName(target!)} isn’t in the forward centre arc within ten hexes.`);
      }
      const preview = previewSpecial(game, shooter, target!);
      const skill = shooter.gunnerySkill;
      for (let tube = 0; tube < tubes; tube++) {
        shooter.projectiles = (shooter.projectiles ?? 0) - 1;
        const skillRoll = rollSkill(rng, skill, volley.get(crew)! - 1);
        const hit = skillRoll >= preview.difficulty;
        const event = say(
          game,
          'fire',
          `${who} ${kind === 'snap fire' ? 'snap-fires' : 'fires'} a ${weapon!.kind} at ${shipName(target!)} (range ${preview.range}): difficulty ${preview.difficulty}, roll ${skillRoll}: ${hit ? 'hit' : 'miss'} (${shooter.projectiles} left).`,
          [
            nameSeg(shooter),
            { t: kind === 'snap fire' ? ` snap-fires a ${weapon!.kind} at ` : ` fires a ${weapon!.kind} at ` },
            nameSeg(target!),
            { t: ` (range ${preview.range}): diff. ${preview.difficulty}, roll ${skillRoll} → ` },
            { t: hit ? 'HIT' : 'MISS', tone: hit ? 'bad' : 'miss' },
          ],
        );
        event.shot = { shooter: shooter.id, target: target!.id, gun: weapon!.kind, ion: false, hit, range: preview.range, from: { ...pos }, to: { ...target!.pos! } };
        if (!hit) continue;
        // Missiles, torpedoes and bombs: the dice of the weapon, less the target's shields, are body points; no Fire Table
        const dice = SPECIAL_DICE[weapon!.kind];
        const rolls = Array.from({ length: dice }, () => rollDie(rng));
        const sum = rolls.reduce((a, b) => a + b, 0);
        const shields = target!.shields[preview.quarter];
        const damage = Math.max(0, sum - shields);
        say(
          game,
          'damageRoll',
          `Damage roll ${dice}D: ${rolls.join(' + ')} = ${sum}${shields > 0 ? ` less ${shields} for the ${preview.quarter} shields` : ''}: ${damage} body point${damage === 1 ? '' : 's'}.`,
          [{ t: `damage ${dice}D: ${rolls.join('+')}${shields > 0 ? ` − ${shields}` : ''} → ${damage} body point${damage === 1 ? '' : 's'}` }],
          true,
        );
        if (event.shot) event.shot.effect = damage >= 6 ? 'heavy' : damage > 0 ? 'hull' : 'shield';
        if (damage > 0) codeTasks.push({ t: 'code', ...stepOf, shipId: target!.id, code: `${damage}Bdy`, row: null, fromFire: true, quarter: preview.quarter, shooter: shooter.id });
      }
      continue;
    }
    const code = shooter.guns[order.gun];
    if (!code) fail('That gun isn’t working.');
    if (!crewGuns(shooter, crew).includes(order.gun)) fail(`${who} can’t fire gun ${order.gun + 1}.`);
    if (used.has(order.gun)) fail('A gun can only fire once per volley.');
    const claim = claims[order.gun];
    if (claim !== undefined && claim !== crew) fail(`The ${crewLabel(shooter, claim)} has already fired that turret this game-turn.`);
    used.add(order.gun);
    if (!gunSlot(typeOf(shooter), order.gun).own) claims[order.gun] = crew;
    if (rockIdOf(order.target) !== null) {
      shootRock(game, shooter, order, crew, kind, volley.get(crew)! - 1, 1);
      continue;
    }
    if (isDestroyerTarget(order.target)) {
      shootDestroyer(game, shooter, order, crew, kind, volley.get(crew)! - 1, 1);
      continue;
    }
    if (isEmplacementTarget(order.target)) {
      shootEmplacement(game, shooter, order, crew, kind, volley.get(crew)! - 1, 1, codeTasks);
      continue;
    }
    const target = shipById(game, order.target);
    if (!target || target.status !== 'active' || !target.pos || target.id === shooter.id) fail('Not a valid target.');
    if (!gunReaches(shooter, order.gun, crew, pos, facing, target!.pos!)) {
      fail(seat === null ? `${shipName(target!)} isn’t in the forward centre arc within five hexes.` : `${shipName(target!)} is out of reach of that turret (five hexes; the rear turret only fires behind).`);
    }

    const gun = parseGun(code!);
    const { range, difficulty } = previewShot(game, shooter, order.gun, target!, crew);
    const skill = seat === null ? shooter.gunnerySkill : shooter.gunners![seat]!.skill;
    const skillRoll = rollSkill(rng, skill, volley.get(crew)! - 1);
    const hit = skillRoll >= difficulty;
    const event = say(
      game,
      'fire',
      `${who} ${kind} at ${shipName(target!)} (range ${range}) with ${code}: difficulty ${difficulty}, roll ${skillRoll}: ${hit ? 'hit' : 'miss'}.`,
      [
        nameSeg(shooter),
        ...(seat === null ? [] : [{ t: ` (${crewLabel(shooter, crew)})` }]),
        { t: kind === 'snap fire' ? ' snap-fires at ' : ' fires at ' },
        nameSeg(target!),
        { t: ` (range ${range}): diff. ${difficulty}, roll ${skillRoll} → ` },
        { t: hit ? 'HIT' : 'MISS', tone: hit ? 'bad' : 'miss' },
      ],
    );
    event.shot = { shooter: shooter.id, target: target!.id, gun: code!, ion: gun.ion, hit, range, from: { ...pos }, to: { ...target!.pos! } };
    if (!hit) continue;

    const quarter = quarterAgainst(game, target!, pos);
    const damageRoll = roll2d6(rng);
    const result = resolveHit({
      power: powerNumber(gun, range),
      shields: target!.shields[quarter],
      ion: gun.ion,
      quarter,
      roll: damageRoll,
    });
    const powerText = `${damageRoll} ${result.power >= 0 ? '+' : '−'} power ${Math.abs(result.power)} = ${result.modifiedRoll}`;
    const outcomeText =
      result.outcome === 'destroyed' ? 'destroyed (14 or more always kills)'
      : result.codes.length > 0 ? `${quarter} quarter hit: ${result.codes.map((c) => `${c} = ${describeDamageCode(c)}`).join('; ')}`
      : result.modifiedRoll <= 2 ? 'a total of 2 or less does nothing'
      : 'no effect';
    say(
      game,
      'damageRoll',
      `Damage roll ${powerText}: ${outcomeText}.`,
      [{ t: `damage roll ${powerText} → ${result.outcome === 'destroyed' ? 'destroyed' : result.codes.length ? `${quarter}: ${result.codes.join(', ')}` : 'no effect'}` }],
      true,
    );
    // how much it did, for the picture of the hit: a shield loss or nothing, a hurt hull, or a heavy blow
    const effects = result.codes.map((c) => parseDamageCode(c));
    const bodyPoints = effects.reduce((sum, e) => sum + (e?.kind === 'body' ? e.points : 0), 0);
    if (event.shot) event.shot.effect = result.outcome === 'destroyed' || bodyPoints >= 3 ? 'heavy' : effects.every((e) => !e || e.kind === 'power') ? 'shield' : 'hull';
    if (result.outcome === 'destroyed') {
      codeTasks.push({ t: 'code', ...stepOf, shipId: target!.id, code: 'KILL', row: null, fromFire: true, shooter: shooter.id });
    }
    for (const c of result.codes) {
      codeTasks.push({ t: 'code', ...stepOf, shipId: target!.id, code: c, row: null, fromFire: true, quarter, ...(gun.ion ? { ion: true } : {}), shooter: shooter.id });
    }
  }
  game.tasks.push(...codeTasks);
}

/**
 * Apply damage codes to a ship as if they had come from a hazard or a hit. Used by scenario
 * scripts and tests; decisions (such as which gun to lose) still come back through `decide`.
 */
export function inflictDamage(
  game: GameState,
  shipId: string,
  codes: string[],
  options: { row?: string; quarter?: ShieldBox; shooter?: string; crew?: string } = {},
): void {
  for (const code of codes) {
    game.tasks.push({
      t: 'code',
      shipId,
      code,
      row: options.row ?? null,
      fromFire: options.shooter !== undefined,
      ...(options.quarter ? { quarter: options.quarter } : {}),
      ...(options.shooter ? { shooter: options.shooter } : {}),
      ...(options.crew ? { crew: options.crew } : {}),
    });
  }
  run(game);
}

// ---------------------------------------------------------------- queries for AIs and UIs

/** Arc of a hex relative to a ship, for display. */
export function arcFrom(ship: Ship, hex: Hex): string {
  return arcOf(ownPosition(ship).pos, ship.facing, hex);
}

export function waitingFor(game: GameState): PlayerId[] {
  if (game.phase === 'over') return [];
  if (game.pending) return [game.pending.player];
  switch (game.phase) {
    case 'forces':
      // when one player chooses both forces, the game waits for them alone
      if (game.purchase?.chooser !== undefined) return game.purchase.chosen[0] ? [] : [game.purchase.chooser];
      return ([0, 1] as PlayerId[]).filter((p) => !game.purchase?.chosen[p]);
    case 'setup': {
      // the defender sets up first (Rules: Ground attack): the ground target and the base; then both place their ships at once, the attacker having chosen his edge in secret (Rules: Ground attack)
      if (game.baseSetup && !game.baseSetup.done) return [game.baseSetup.defender];
      return ([0, 1] as PlayerId[]).filter((p) => !game.placed[p]);
    }
    case 'initiative': {
      const picker = game.initiativeTable ? nextPicker(game.initiativeTable) : null;
      return picker ? [shipById(game, picker)!.owner] : [];
    }
    case 'entry': return game.entry ? [reserveById(game, game.entry.group)!.owner] : [];
    case 'arrival': return game.arrival ? [reserveById(game, game.arrival.group)!.owner] : [];
    case 'destroyers': return game.capitalTargets?.asking[0] ? [destroyerById(game, game.capitalTargets.asking[0])!.owner] : game.destroyerQueue ? [destroyerById(game, game.destroyerQueue.ids[game.destroyerQueue.index]!)!.owner] : [];
    case 'planning': return ([0, 1] as PlayerId[]).filter((p) => !game.planSubmitted[p]);
    case 'ships': return game.active ? [currentShip(game)!.owner] : [game.chooser];
    default: return [];
  }
}

import scenariosFile from '../../data/scenarios.json';
import { CAPITAL, isCapitalType, isOut, type CapitalKind } from './destroyers';
import type { MapEdge } from './emplacements';
import type { Hex } from './hex';
import { toOffset } from './movement';
import type { ShipSpec } from './game';
import type { ReserveDef } from './reserves';
import { SHIPS } from './data';
import { QUALITIES } from './purchase';
import type { PilotQuality } from './skill';
import type { GameState, PlayerId, Ship } from './state';

/**
 * Scenarios as data (data/scenarios.json). A scenario is its forces plus a few named parts, each of which is a small rule that the engine
 * knows how to play; a scenario switches the parts it needs on and says how. New kinds of scenario are new parts (with their own code and
 * tests), not new scripting. The parts so far:
 *
 *   sides       the forces: ship types, pilot and gunner qualities, tags, bonus victory points (Rules: Scenarios; Convoy)
 *   variants    changes to the forces when an option is in play: the adjustable map, the special weapons (Rules: Scenarios; Ground attack; Convoy)
 *   map         'static' or 'adjustable' by default (Rules: The map); the menu may change it
 *   groundAttack  the base and the turret guns (20, 29)
 *   rules       roles, victory points for escaping, how the game ends, who wins a tie (30), who wins when something happens, where a ship may leave
 *   reserves    ships that wait off the map and come in later, and the edge a side starts along (Rules: Reserves)
 *   suggests    options that are switched on at the start of the scenario but may be switched off again
 */

/** What a side is in a scenario: for the texts on the screen and for the computer's mission. */
export type Role = 'attacker' | 'defender' | 'convoy';

/** A rule that can end the game; the game ends as soon as one of those of the scenario holds (Rules: Scenarios; Convoy). */
export type EndRule =
  /** The side has no ship left on the map: all destroyed or escaped. */
  | { kind: 'sideGone'; side: PlayerId }
  /** No ship that carries the tag is left on the map. */
  | { kind: 'tagGone'; tag: string };

/** What can decide the game on the spot (Rules: Reserves): a ship with the tag has escaped or was destroyed, or a side has no ship left, in play or in reserve. */
export type Condition =
  | { kind: 'escaped'; tag: string }
  | { kind: 'destroyed'; tag: string }
  | { kind: 'sideGone'; side: PlayerId };

/** When the condition holds the game is over and this side has won, whatever the victory points say. The first that holds counts. */
export interface Verdict {
  when: Condition;
  winner: PlayerId;
}

export interface ScenarioRules {
  /** What each side is told to do, in its own words, for the screen. */
  objectives?: [string | null, string | null];
  /** The asteroids stay where they are for this many game-turns (Rules: Reserves; the asteroid scenarios). */
  asteroidsRest?: number;
  /** Who wins as soon as something happens (Rules: Reserves). */
  verdicts?: Verdict[];
  /** A ship with the tag may leave the map only across the edge opposite the one the side started along; any other way is closed to it (Rules: Reserves). */
  exits?: { tag: string; only: 'opposite'; of: PlayerId }[];
  /** What each side is, Rebels first. */
  roles?: [Role | null, Role | null];
  /** Victory points a side earns for each of its ships with this tag that escapes (Rules: The map; Convoy). */
  escapeVp?: { tag: string; vp: number }[];
  /** Without a list the game ends when one side has no ship left (Rules: Scenarios). */
  end?: EndRule[];
  /** Who wins when the victory points are equal; a draw otherwise. */
  tieWinner?: PlayerId;
}

/** The conditions of a variant; all of those given must hold. */
export interface VariantWhen {
  specialWeapons?: boolean;
  damageRules?: boolean;
  /** The map is the adjustable one (Rules: The map), not the static one. */
  adjustableMap?: boolean;
}

/** A change to the forces of a scenario that only applies when some options are in play (the "Advanced game" and "Adjustable map" paragraphs of 28 to 30). */
export interface Variant {
  when: VariantWhen;
  /** More ships, added after the ones the owner already has. */
  add?: ShipSpec[];
  /** Every ship of this type of the owner becomes another type. */
  replace?: { owner: PlayerId; typeId: string; with: string }[];
  /** The pilots of all ships of these types of the owner get this quality. */
  setQuality?: { owner: PlayerId; typeIds: string[]; quality: PilotQuality }[];
}

/** The state of the options a variant looks at. */
export type VariantState = Required<VariantWhen>;

/** The ships of a scenario once the variants that apply to the options in play are applied. */
export function applyVariants(ships: ShipSpec[], variants: Variant[] | undefined, state: VariantState): ShipSpec[] {
  let result = ships.map((s) => ({ ...s }));
  for (const variant of variants ?? []) {
    const wanted = Object.entries(variant.when) as [keyof VariantState, boolean][];
    if (!wanted.every(([key, value]) => state[key] === value)) continue;
    for (const r of variant.replace ?? []) result = result.map((s) => (s.owner === r.owner && s.typeId === r.typeId ? { ...s, typeId: r.with } : s));
    for (const q of variant.setQuality ?? []) result = result.map((s) => (s.owner === q.owner && q.typeIds.includes(s.typeId) ? { ...s, quality: q.quality } : s));
    result.push(...(variant.add ?? []).map((s) => ({ ...s })));
  }
  return result;
}

/** Is any ship of the side, or with the tag, still on the map? */
const alive = (game: GameState, test: (s: Ship) => boolean): boolean => game.ships.some((s) => (s.status === 'active' || s.status === 'reserve') && test(s));

/** Has a side nothing left in the game: no ship on the map or waiting, and no Star Destroyer that is not out? */
const sideGone = (game: GameState, side: PlayerId): boolean => !alive(game, (s) => s.owner === side) && !hasDestroyer(game, side);

/** A side still has a capital ship that is not out: not blown up, and with fewer structure points lost than it takes to silence it (8 for a Star Destroyer, 7 for a Mon Calamari cruiser, 4 for a frigate). */
const hasDestroyer = (game: GameState, side: PlayerId): boolean => (game.destroyers ?? []).some((d) => d.owner === side && !isOut(d));

/** Does a rule that ends the game hold? Without end rules in the scenario, the standard rule (Rules: Scenarios) is the one. */
/** The verdict of the scenario that holds now, if one does (Rules: Reserves). */
export function verdictOf(game: GameState): Verdict | null {
  for (const v of game.rules?.verdicts ?? []) {
    const c = v.when;
    const holds = c.kind === 'escaped' ? game.ships.some((s) => s.tag === c.tag && s.status === 'escaped')
      : c.kind === 'destroyed' ? game.ships.some((s) => s.tag === c.tag && s.status === 'destroyed')
        : sideGone(game, c.side);
    if (holds) return v;
  }
  return null;
}

const OPPOSITE: Record<MapEdge, MapEdge> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** The edges a hex lies beyond, when it is off a static map. */
function edgesBeyond(game: GameState, pos: { q: number; r: number }): MapEdge[] {
  const { col, row } = toOffset(pos as Hex);
  const out: MapEdge[] = [];
  if (row < 0) out.push('top');
  if (row >= game.map.rows) out.push('bottom');
  if (col < 0) out.push('left');
  if (col >= game.map.cols) out.push('right');
  return out;
}

/** The only edge a ship with an exit rule may leave across (Rules: Reserves), or null when it has no such rule or the side has not chosen its start edge yet. */
export function exitEdgeOf(game: GameState, ship: Ship): MapEdge | null {
  if (!ship.tag || game.map.mode !== 'static') return null;
  const rule = game.rules?.exits?.find((e) => e.tag === ship.tag);
  const start = rule && game.edgeChoice?.side === rule.of ? game.edgeChoice.edge : null;
  return start ? OPPOSITE[start] : null;
}

/** Is the way off the map at `pos` closed to this ship (Rules: Reserves)? It is when it may leave only across the far edge and `pos` is beyond another one. */
export function exitBlocked(game: GameState, ship: Ship, pos: { q: number; r: number }): boolean {
  const only = exitEdgeOf(game, ship);
  return only !== null && edgesBeyond(game, pos).some((e) => e !== only);
}

export function gameShouldEnd(game: GameState): boolean {
  if (verdictOf(game)) return true;
  const rules = game.rules?.end;
  if (!rules) return sideGone(game, 0) || sideGone(game, 1);
  return rules.some((rule) => (rule.kind === 'sideGone' ? sideGone(game, rule.side) : !alive(game, (s) => s.tag === rule.tag)));
}

/** The victory points a ship earns its owner by escaping (Rules: Convoy). */
export function escapeVpOf(game: GameState, ship: Ship): number {
  if (!ship.tag) return 0;
  return (game.rules?.escapeVp ?? []).filter((e) => e.tag === ship.tag).reduce((sum, e) => sum + e.vp, 0);
}

/** The winner when the game is over: the side with more victory points; a tie goes to the side the scenario names, otherwise it is a draw. */
export function winnerOf(game: GameState): PlayerId | 'draw' {
  const verdict = verdictOf(game);
  if (verdict) return verdict.winner;
  if (game.vp[0] !== game.vp[1]) return game.vp[0] > game.vp[1] ? 0 : 1;
  return game.rules?.tieWinner ?? 'draw';
}

/** The role of a side in the game, if the scenario gives one. */
export const roleOf = (game: Pick<GameState, 'rules'>, side: PlayerId): Role | null => game.rules?.roles?.[side] ?? null;

/** Does a ship carry out the escape objective of the scenario (does its escape earn points)? */
export const isObjectiveShip = (game: Pick<GameState, 'rules'>, ship: Pick<Ship, 'tag'>): boolean =>
  !!ship.tag && (!!game.rules?.escapeVp?.some((e) => e.tag === ship.tag) || !!game.rules?.verdicts?.some((v) => v.when.kind === 'escaped' && v.when.tag === ship.tag));

// ---------------------------------------------------------------- the catalogue

interface SideDef {
  faction: string;
  role?: Role;
  bonusVp?: number;
  ships: ShipSpecDef[];
}

type ShipSpecDef = Omit<ShipSpec, 'owner'> & { tag?: string };

export interface ScenarioDef {
  /** The lines on the scenario's card in the menu (the scenarios of the player's own); the forces are listed when missing. */
  description?: string[];
  /** The edges a side may start along, which it chooses before it places its ships (Rules: Reserves). */
  startEdges?: [MapEdge[] | null, MapEdge[] | null];
  /** The groups of ships that come in later: the ships of the sides name their group with `reserve` (Rules: Reserves). */
  reserves?: Record<string, ReserveDef>;
  /** An asteroid field the scenario needs: the density; how it moves is the menu's choice. */
  asteroids?: { density: 'sparse' | 'medium' | 'dense' };
  name: string;
  /** A short label for the scenario's rules, kept for reference. */
  rule?: string;
  map?: 'static' | 'adjustable';
  suggests?: string[];
  groundAttack?: { attacker: PlayerId; doubles: number; singles: number; mix: 1 | 2 | 3 };
  rules?: ScenarioRules;
  variants?: Variant[];
  sides: [SideDef, SideDef];
}

const CATALOGUE = (scenariosFile as unknown as { scenarios: Record<string, ScenarioDef> }).scenarios;

/** Scenarios of the player's own, read from the scenarios folder (see server/files.ts); they are added while the menu is open. */
let custom: Record<string, ScenarioDef> = {};

/** The ids of scenarios of the player's own start with this. */
export const CUSTOM_PREFIX = 'custom-';

/** A scenario of the menu by its id (the ship mixes of 28, the Ground Attacks of 29, the Convoys of 30, or one of the player's own). */
export function scenarioDef(id: string): ScenarioDef | undefined {
  return CATALOGUE[id] ?? custom[id];
}

export const scenarioIds = (): string[] => Object.keys(CATALOGUE);

/** Replaces the scenarios of the player's own by the ones in this list (id to definition); they have been checked with `validateScenario`. */
export function registerCustomScenarios(defs: Record<string, ScenarioDef>): void {
  custom = defs;
}

export const customScenarioIds = (): string[] => Object.keys(custom);

/** What is wrong with a scenario file, or null when this game can play it. */
export function validateScenario(def: unknown): string | null {
  const bad = (text: string): string => text;
  if (!def || typeof def !== 'object' || Array.isArray(def)) return bad('A scenario is an object.');
  const d = def as Partial<ScenarioDef>;
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 60) return bad('A scenario needs a name (up to 60 characters).');
  if (!Array.isArray(d.sides) || d.sides.length !== 2) return bad('A scenario has two sides: the Rebels first, then the Empire.');
  if (d.map !== undefined && d.map !== 'static' && d.map !== 'adjustable') return bad('The map is "static" or "adjustable".');
  for (const [i, side] of d.sides.entries()) {
    if (!side || typeof side !== 'object' || !Array.isArray(side.ships)) return bad(`Side ${i + 1} needs a list of ships.`);
    for (const ship of side.ships) {
      const destroyer = !!ship && typeof ship === 'object' && isCapitalType(ship.typeId);
      if (!ship || typeof ship !== 'object' || (!destroyer && !SHIPS[ship.typeId])) return bad(`Side ${i + 1} has a ship this game doesn’t know ("${String((ship as { typeId?: unknown })?.typeId)}").`);
      if (destroyer) {
        const spec = CAPITAL[ship.typeId as CapitalKind];
        if (!spec.sides.includes(i as PlayerId)) return bad(`A ${spec.name} is ${spec.sides[0] === 0 ? 'a Rebel' : 'an Imperial'} ship: only the ${spec.sides[0] === 0 ? 'first side, the Rebels' : 'second side, the Empire'}, can have one.`);
        const skill = ship.skill;
        if (skill !== undefined && (!skill || !Number.isInteger(skill.dice) || skill.dice < 1 || skill.dice > 12 || !Number.isInteger(skill.pips) || skill.pips < 0 || skill.pips > 2)) return bad('A capital ship’s gunnery skill is dice (1 to 12) and pips (0 to 2).');
      } else if (!QUALITIES.includes(ship.quality)) return bad(`A ${SHIPS[ship.typeId]!.name} needs a pilot quality (${QUALITIES.join(', ')}).`);
      if (ship.reserve !== undefined && !d.reserves?.[ship.reserve]) return bad(`A ship waits in the reserve "${ship.reserve}", which the scenario doesn’t describe.`);
    }
  }
  if (d.sides.every((s) => s.ships.length === 0)) return bad('A scenario needs at least one ship.');
  return null;
}

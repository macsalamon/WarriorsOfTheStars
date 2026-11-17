import {
  GUNNER_ACTIONS,
  PILOT,
  canCrewFire,
  crewGuns,
  crewLabel,
  crewOrPilot,
  gunSlot,
  gunnerCrewId,
  seatOf,
} from './crew';
import { getShip } from './data';
import { totalDifficulty } from './hazard';
import { PLAN_ACTIONS, planDifficultyEntries, planDifficultyParts, type PlanAction, type Plan } from './plan';
import { chanceAtLeast, type SkillCode } from './skill';
import { SPECIAL } from './special';
import { emplacementById, mayTrack, mayTrackEmplacement, previewShot, previewSpecial, type EmplacementTarget, type ShotOrder, type ShotPreview } from './game';
import type { GameState, Ship } from './state';

/*
 * Read-only answers for the planning and aiming screens: what a crew member may plan, what their plan risks, which guns they may use
 * and what a volley is likely to do. None of it changes the game.
 */

/** The actions a crew member may plan (Rules: Gunners and turrets): everything for the pilot, A, F and G actions for a gunner, nothing for a dead one. */
export function plannableActions(ship: Ship, crew: string): readonly PlanAction[] {
  const seat = seatOf(crew);
  if (seat === null) return PLAN_ACTIONS;
  const gunner = ship.gunners?.[seat];
  return gunner && !gunner.dead ? GUNNER_ACTIONS : [];
}

/** The skill a crew member's hazard roll uses: the pilot's piloting, a gunner's gunnery (Rules: Hazards; Gunners and turrets). */
export function hazardSkill(ship: Ship, crew: string): SkillCode {
  const seat = seatOf(crew);
  return seat === null ? ship.pilotSkill : ship.gunners![seat]!.skill;
}

export interface HazardOdds {
  /** Total difficulty of the plan with stabilizer damage and action penalty (Rules: Hazards; Gunners and turrets). */
  total: number;
  parts: { label: string; value: number }[];
  /** Chance of no hazard at all, and of no full hazard (a minor one at most): the rest is one full hazard or worse (Rules: Hazards). */
  none: number;
  noFull: number;
}

/** What a crew member's plan risks: the difficulty with its terms, and the chances of the hazard roll. */
export function hazardOdds(ship: Ship, crew: string, plan: Plan): HazardOdds {
  const difficulty = getShip(ship.typeId).difficulty;
  const total = totalDifficulty(planDifficultyEntries(plan, difficulty, ship.stabilizerDamage, ship.actionPenalty));
  const skill = hazardSkill(ship, crew);
  return {
    total,
    parts: planDifficultyParts(plan, difficulty, ship.stabilizerDamage, ship.actionPenalty),
    none: chanceAtLeast(skill, 0, total),
    noFull: chanceAtLeast(skill, 0, total - 4),
  };
}

/** The enemy ships a crew member could plan targeting against (Rules: Tailing and targeting; Gunners and turrets). */
export function trackableTargets(game: GameState, ship: Ship, crew: string): Ship[] {
  return game.ships.filter((t) => t.id !== ship.id && mayTrack(ship, t, crew));
}

/** The turret guns and the ground target a crew member could plan targeting against (Rules: Ground attack). */
export function trackableEmplacements(game: GameState, ship: Ship, crew: string): EmplacementTarget[] {
  const all = [...(game.emplacements ?? []), ...(game.groundTarget ? [game.groundTarget] : [])];
  return all.filter((t) => emplacementById(game, t.id) && mayTrackEmplacement(ship, t, crew));
}

export type GunState =
  /** Free to be fired by this crew member. */
  | 'ready'
  /** A turret the pilot leaves to its gunner unless he turns it on (14.21). */
  | 'reserved'
  /** Already fired this game-turn by somebody else (14.21). */
  | 'claimed'
  /** Nobody on this crew member's side can use it now: the ship rolls (14.31). */
  | 'blocked';

export interface GunStatus {
  gun: number;
  code: string;
  state: GunState;
  /** Why, in a few words, for a tooltip. */
  note: string;
}

/** The working guns a crew member may fire and the state of each: ready, reserved for the gunner, claimed, or blocked by a roll. */
export function crewGunStatus(ship: Ship, crew: string): GunStatus[] {
  const type = getShip(ship.typeId);
  const claims = ship.turretClaims ?? {};
  return crewGuns(ship, crew).map((gun): GunStatus => {
    const code = ship.guns[gun]!;
    const slot = gunSlot(type, gun);
    const claim = claims[gun];
    if (!canCrewFire(ship, crew)) return { gun, code, state: 'blocked', note: 'A ship that rolls can’t use its gunners.' };
    if (claim !== undefined && claim !== crew) return { gun, code, state: 'claimed', note: `Already fired by the ${crewLabel(ship, claim)} this game-turn.` };
    if (crewOrPilot(crew) === PILOT && !slot.own && slot.seat !== null && canCrewFire(ship, gunnerCrewId(slot.seat))) {
      return { gun, code, state: 'reserved', note: 'The gunner’s turret. Switch it on to fire it yourself, like a fixed gun that only fires forward.' };
    }
    return { gun, code, state: 'ready', note: '' };
  });
}

export interface VolleyShot extends ShotOrder {
  code: string;
  range: number;
  difficulty: number;
  power: number;
  /** Chance to hit with the skill this volley rolls with (the dice a crew member's second and third gun cost, see Rules: Fire). */
  chance: number;
  preview: ShotPreview;
}

/**
 * What a volley is likely to do, shot by shot, as it would be fired from where `shooter` stands: the difficulty and chance of each shot,
 * with every crew member's dice reduced for the extra guns they fire (Rules: Fire; Gunners and turrets).
 */
export function volleyOdds(game: GameState, shooter: Ship, shots: ShotOrder[]): VolleyShot[] {
  const count = new Map<string, number>();
  for (const s of shots) count.set(crewOrPilot(s.crew), (count.get(crewOrPilot(s.crew)) ?? 0) + 1);
  return shots.map((s) => {
    const crew = crewOrPilot(s.crew);
    const target = game.ships.find((t) => t.id === s.target)!;
    const preview = s.gun === SPECIAL ? previewSpecial(game, shooter, target) : previewShot(game, shooter, s.gun, target, crew);
    const seat = seatOf(crew);
    const skill = seat === null ? shooter.gunnerySkill : shooter.gunners![seat]!.skill;
    return {
      ...s,
      code: preview.gun,
      range: preview.range,
      difficulty: preview.difficulty,
      power: preview.power,
      chance: chanceAtLeast(skill, count.get(crew)! - 1, preview.difficulty),
      preview,
    };
  });
}

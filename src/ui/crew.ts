import { typeOf, type PilotQuality, type PlayerId, type Ship, type SkillCode } from '../engine';

/** Pictures of the people who fly with a ship: the pilots' are the FotG emblems of the two sides, the gunners' a drawn crosshair (see CREDITS.md). */
const BASE = import.meta.env.BASE_URL;
export const R2_URL = `${BASE}assets/crew/r2.png`;

const SIDE_FILES = ['rebel', 'empire'] as const;

/** One person aboard a ship: the pilot, a gunner (up to two), or the R2 unit. */
export interface CrewMember {
  /** 'pilot', 'gunner1', 'gunner2' or 'r2': the same on every ship, so a plan or a button can name them. */
  id: string;
  kind: 'pilot' | 'gunner' | 'r2';
  /** Which gunner, from 1. */
  seat?: number;
  /** The short name for headlines and titles: "Pilot", "Gunner 2", "R2 astromech". */
  label: string;
  quality?: PilotQuality;
  /** The gunnery skill this person fires with (the pilot's piloting skill is always on the sheet). */
  skill?: SkillCode;
  /** A gunner who has been killed. */
  dead?: boolean;
  picture: string;
}

/** Everyone who flies this ship, in the order the icons are shown: pilot, gunner(s), R2. */
export function crewOf(ship: Ship): CrewMember[] {
  const side: PlayerId = ship.owner;
  const crew: CrewMember[] = [
    { id: 'pilot', kind: 'pilot', label: 'Pilot', quality: ship.quality, skill: ship.gunnerySkill, picture: `${BASE}assets/crew/pilot-${SIDE_FILES[side]}.png` },
  ];
  (ship.gunners ?? []).forEach((g, i) => {
    crew.push({ id: `gunner${i + 1}`, kind: 'gunner', seat: i + 1, label: (ship.gunners ?? []).length > 1 ? `Gunner ${i + 1}` : 'Gunner', quality: g.quality, skill: g.skill, ...(g.dead ? { dead: true } : {}), picture: `${BASE}assets/crew/gunner-${SIDE_FILES[side]}.svg` });
  });
  if (typeOf(ship).r2) crew.push({ id: 'r2', kind: 'r2', label: 'R2 astromech', picture: R2_URL });
  return crew;
}

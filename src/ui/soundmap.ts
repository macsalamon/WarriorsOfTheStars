import table from '../../data/sounds.json';

/*
 * The sound table (data/sounds.json) and which of its entries belongs to what happens on the board. No audio here: this part can be tested.
 * The entries name files of the Fate of the Galaxy sounds folder; tools/sound-pack.mjs converts the picked ones into public/assets/sounds.
 */

export interface SoundEntry {
  id: string;
  what: string;
  /** The files that play, one at random; none is silence. */
  pick: string[];
  candidates?: string[];
  volume?: number;
  /** The ship types a weapon or engine entry is for. */
  ships?: string[];
  max?: number;
}

/** The volume groups of the settings. */
export type Bus = 'effects' | 'engines' | 'interface';

export const SOUND_ENTRIES: readonly SoundEntry[] = table.sounds as unknown as SoundEntry[];
export const SOUNDS: ReadonlyMap<string, SoundEntry> = new Map(SOUND_ENTRIES.map((e) => [e.id, e]));

export const busOf = (id: string): Bus => (id.startsWith('engine.') ? 'engines' : /^(ui|turn|dice|game)\./.test(id) ? 'interface' : 'effects');

/** Who fires: a ship of a type, a turret gun, or a capital ship. */
export type Shooter = { kind: 'ship'; typeId: string } | { kind: 'turret' } | { kind: 'capital' };

const forShip = (prefix: string, typeId: string): string | null => SOUND_ENTRIES.find((e) => e.id.startsWith(prefix) && e.ships?.includes(typeId))?.id ?? null;

/** The sound of a gun firing: by the weapon for torpedoes, missiles and bombs, otherwise by who fires and whether it is an ion cannon. */
export function fireSound(shooter: Shooter, gun: string, ion: boolean): string | null {
  if (gun === 'PT') return 'fire.torpedo';
  if (gun === 'CM') return 'fire.missile';
  if (gun === 'CB') return 'fire.bomb';
  if (shooter.kind === 'turret') return 'fire.turret';
  if (shooter.kind === 'capital') return ion ? 'fire.capital.ion' : 'fire.capital';
  // a ship without an entry of its own for ion cannons fires them with its laser sound
  return (ion ? forShip('fire.ion.', shooter.typeId) : null) ?? forShip('fire.laser.', shooter.typeId);
}

/** The sound of a hit, from what the board shows for it: the weapon that landed, or what the hit did. */
export function hitSound(look: { effect?: string | undefined; weapon?: string | undefined }): string {
  if (look.effect === 'rock') return 'explode.asteroid';
  if (look.weapon === 'torpedo') return 'hit.torpedo';
  if (look.weapon === 'missile') return 'hit.missile';
  if (look.effect === 'heavy') return 'hit.heavy';
  if (look.weapon === 'ion') return 'hit.ion';
  return look.effect === 'shield' ? 'hit.shield' : 'hit.hull';
}

/** The engine loop of a ship type: the soft one from the cockpit (the ship is selected) or the one from outside (it is moving). */
export const engineSound = (where: 'cockpit' | 'external', typeId: string): string | null => forShip(`engine.${where}.`, typeId);

/**
 * How loud the cockpit loop of the selected ship is, as a part of the full volume (the owner): 10% when the ship stands still, rising evenly
 * to 40% at its top speed (a ship that overspeeds is no louder).
 */
export const cockpitLevel = (speed: number, topSpeed: number): number => 0.1 + 0.3 * Math.min(1, Math.max(0, topSpeed > 0 ? speed / topSpeed : 0));

/**
 * How fast the cockpit loop plays, which is its pitch: a step of speed is hard to hear in the volume alone (the owner), so the engine also
 * turns over faster, from four fifths of its recorded speed at a standstill to five quarters at the ship's top speed.
 */
export const cockpitPitch = (speed: number, topSpeed: number): number => 0.8 + 0.45 * Math.min(1, Math.max(0, topSpeed > 0 ? speed / topSpeed : 0));

/** Every file the game may play. */
export const pickedFiles = (): string[] => [...new Set(SOUND_ENTRIES.flatMap((e) => e.pick))];

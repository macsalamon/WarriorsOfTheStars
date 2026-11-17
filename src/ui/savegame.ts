import { SHIPS, scenarioDef, type SkillReduction, type Command, type DogfightMix, type Facing, type ForceShip, type GameState, type Hex, type Plan, type PlayerId } from '../engine';

export const SAVE_APP = 'star-warriors';
/** Bump when the layout of a save file changes in a way old files cannot be read as they are. */
export const SAVE_VERSION = 1;

/** What the player had on screen but the game itself does not hold: plans being drawn up and ships being placed. */
export interface SaveDraft {
  plans: Record<string, Plan>;
  /** The gunners' plans, by ship, in seat order. */
  crewPlans?: Record<string, Plan[]>;
  submitted: string[];
  planShip: string | null;
  placements: [string, { pos: Hex; facing: Facing }][];
  /** The ships being bought in a points game, before the force is handed in. */
  forces?: [ForceShip[], ForceShip[]];
}

export interface SaveFile {
  app: typeof SAVE_APP;
  version: number;
  savedAt: string;
  meta: { mix: DogfightMix; /** The ship points of both sides in a points game. */ points?: [number, number]; seed: number; human: PlayerId; /** Missing in older saves: no reduction. */ skillReduction?: SkillReduction };
  /** The complete game, including its dice: loading it continues exactly where it stopped. */
  game: GameState;
  /** The computer player's own dice, so that it plays on as it would have without the pause. */
  aiRngState: number;
  /** Every command given since the first, by both sides: enough to replay the game from its start options. */
  commands: Command[];
  draft: SaveDraft;
}

export class SaveError extends Error {}

export function makeSave(parts: Omit<SaveFile, 'app' | 'version' | 'savedAt'>): SaveFile {
  return { app: SAVE_APP, version: SAVE_VERSION, savedAt: new Date().toISOString(), ...parts };
}

export const serialise = (save: SaveFile): string => JSON.stringify(save);

/** Reads a save back, refusing anything that is not a save of this game or that this version cannot play on. */
export function parseSave(text: string): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('This isn’t a save file.');
  }
  const save = raw as Partial<SaveFile> | null;
  if (!save || typeof save !== 'object' || save.app !== SAVE_APP) throw new SaveError('This file isn’t a Warriors of the Stars save.');
  if (typeof save.version !== 'number' || save.version < 1) throw new SaveError('The save file has no version number.');
  if (save.version > SAVE_VERSION) throw new SaveError('This save was made by a newer version of the game. Update the game to open it.');
  const game = save.game as GameState | undefined;
  if (!game || !Array.isArray(game.ships) || typeof game.phase !== 'string' || typeof game.rngState !== 'number') {
    throw new SaveError('The save file holds no readable game.');
  }
  const unknown = game.ships.find((s) => !SHIPS[s.typeId]);
  if (unknown) throw new SaveError(`The save uses a ship that this version doesn’t know ("${unknown.typeId}").`);
  // saves from before the advanced arcs know only a front and a rear box
  for (const ship of game.ships) {
    ship.shields.left ??= 0;
    ship.shields.right ??= 0;
  }
  const human = save.meta?.human;
  if ((human !== 0 && human !== 1) || typeof save.meta?.seed !== 'number' || typeof save.meta?.mix !== 'string') {
    throw new SaveError('The save file doesn’t say who was playing, or it lacks the starting options.');
  }
  if (typeof save.aiRngState !== 'number' || !Array.isArray(save.commands)) throw new SaveError('The save file is incomplete.');
  const draft: SaveDraft = { plans: {}, submitted: [], planShip: null, placements: [], ...save.draft };
  return { ...(save as SaveFile), draft };
}

/** The name of a scenario for the menu and the save file; a points game has no scenario of its own. */
const mixName = (mix: DogfightMix): string => (mix === 'points' ? 'Points game' : scenarioDef(mix)?.name ?? mix);

/** One line that tells a player which game this is. */
export function describeSave(save: SaveFile): string {
  const g = save.game;
  const where = g.phase === 'over' ? 'finished' : g.turn > 0 ? `game-turn ${g.turn}` : g.phase === 'forces' ? 'choosing forces' : 'set-up';
  const limits = g.purchase?.limits;
  const name = limits ? `Points game (${limits[0]} against ${limits[1]})` : mixName(save.meta.mix);
  return `${name} · ${where} · Rebels ${g.vp[0]} – Empire ${g.vp[1]}`;
}

const AUTOSAVE_KEY = 'star-warriors.autosave';

/** The game the browser kept automatically after the last command, if any and if it can still be read. */
export function readAutosave(): SaveFile | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? parseSave(text) : null;
  } catch {
    return null;
  }
}

/** Keeps the game in the browser; a full or blocked store is not worth interrupting the game for. */
export function writeAutosave(save: SaveFile | null): void {
  try {
    if (save) localStorage.setItem(AUTOSAVE_KEY, serialise(save));
    else localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* storage can be full or blocked */
  }
}

/** The name of a saved game: the scenario, the game-turn, and the date and time, so that a later save never replaces an earlier one. */
export function saveFileName(save: SaveFile, when: Date = new Date()): string {
  const mix = mixName(save.meta.mix).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const two = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}_${two(when.getHours())}${two(when.getMinutes())}${two(when.getSeconds())}`;
  return `${mix}-turn-${save.game.turn}-${stamp}.json`;
}

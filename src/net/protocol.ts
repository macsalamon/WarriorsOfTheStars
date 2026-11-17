import type { AsteroidOptions, Command, DogfightMix, GameState, PlayerId, SkillReduction } from '../engine';

/** Bump when the messages below change in a way an older page or host cannot follow. */
export const PROTOCOL = 2;

/** The port a host listens on, unless told otherwise. */
export const DEFAULT_PORT = 8787;

/** Which game the host is running: what its players chose when it was created. */
export interface GameInfo {
  mix: DogfightMix;
  /** In a points game: the ship points of the Rebels and the Empire. */
  points?: [number, number];
  /** In a points game: the host chooses both forces. */
  hostChooses?: boolean;
  seed: number;
  skillReduction: SkillReduction;
  /** The side the creating player took. */
  hostSide: PlayerId;
}

export interface SeatInfo {
  /** Somebody has claimed this side. */
  taken: boolean;
  /** …and is connected right now. */
  connected: boolean;
}

export type ClientMessage =
  | { type: 'join'; protocol: number; /** Given back by the host when the seat was first taken: it reclaims the seat after a dropped connection. */ token?: string }
  | { type: 'create'; mix: DogfightMix; points?: [number, number]; hostChooses?: boolean; seed: number; skillReduction: SkillReduction; hostSide: PlayerId; /** The R2, auxiliary power and damage control rules (16, 17). */ damageRules?: boolean; /** Missiles, torpedoes and bombs (22). */ specialWeapons?: boolean; /** An asteroid field (24). */ asteroids?: AsteroidOptions; /** Advanced initiative (19). */ advancedInitiative?: boolean; /** Advanced arcs (Rules: Advanced arcs). */ advancedArcs?: boolean; /** The map, when the host chose another than the scenario's own (Rules: The map). */ mapMode?: 'static' | 'open' }
  | { type: 'command'; /** Echoed in a rejection, so the page knows which command it was. */ id: number; cmd: Command }
  /** The host player asks for the whole game to be sent as a save file. */
  | { type: 'saveRequest' }
  /** A saved game, as the text of its file, for the host to carry on with: only while no game is running (or the last one is over). Answered like a join; the player then claims a side with `create`. */
  | { type: 'load'; text: string };

export type ServerMessage =
  /** The answer to `join`. `seat` is null while there is no game for this player yet (they wait for the host to create one). */
  | { type: 'welcome'; protocol: number; seat: PlayerId | null; token: string | null; host: boolean; game: GameInfo | null; view: GameState | null; seats: [SeatInfo, SeatInfo] }
  /** The game was created while this player was waiting: here is their seat. */
  | { type: 'started'; seat: PlayerId; token: string; host: boolean; game: GameInfo; view: GameState; seats: [SeatInfo, SeatInfo] }
  /** A command was applied: the new game as this player may see it. `cmd` is what the command looked like to them (a secret plan arrives empty). */
  | { type: 'update'; seq: number; cmd: Command; view: GameState; seats: [SeatInfo, SeatInfo] }
  | { type: 'reject'; id: number; error: string }
  | { type: 'presence'; seats: [SeatInfo, SeatInfo] }
  | { type: 'saveFile'; name: string; text: string }
  /** `fatal` means the host will not talk to this page any more (wrong version, game full). */
  | { type: 'error'; message: string; fatal: boolean };

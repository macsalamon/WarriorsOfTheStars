import {
  applyCommand,
  waitingFor,
  type Command,
  type CommandResult,
  type GameState,
  type PlayerId,
} from '../engine';

/** A computer player: given the game, returns the command it wants to give next, if it is waiting on them. */
export type Ai = (game: GameState, player: PlayerId) => Command | null;

export interface PlayOptions {
  maxCommands?: number;
  onCommand?: (cmd: Command, result: CommandResult) => void;
}

/** Play a whole game between two computer players. Throws if the engine rejects a command. */
export function playGame(game: GameState, ais: [Ai, Ai], options: PlayOptions = {}): void {
  const limit = options.maxCommands ?? 20000;
  for (let i = 0; i < limit && game.phase !== 'over'; i++) {
    const waiting = waitingFor(game);
    if (waiting.length === 0) throw new Error(`Nobody is waiting in phase ${game.phase}`);
    let cmd: Command | null = null;
    let player: PlayerId = waiting[0]!;
    for (const p of waiting) {
      cmd = ais[p](game, p);
      if (cmd) {
        player = p;
        break;
      }
    }
    if (!cmd) throw new Error('No computer player had a command available');
    const result = applyCommand(game, cmd);
    options.onCommand?.(cmd, result);
    if (!result.ok) throw new Error(`Engine rejected ${cmd.type} from player ${player + 1}: ${result.error}`);
  }
}

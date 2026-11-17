import { applyCommand, createGame, scenarioOptions, STANDARD_MAP, type Command, type GameState, type PlayerId } from '../engine';
import { SaveError, makeSave, parseSave, saveFileName, serialise, type SaveFile } from '../ui/savegame';
import { PROTOCOL, type ClientMessage, type GameInfo, type SeatInfo, type ServerMessage } from './protocol';
import { publicCommand, viewFor } from './redact';

/** A message for one connection. */
export interface Outgoing {
  to: number;
  msg: ServerMessage;
}

interface Seat {
  /** Given to the player who took the side; shown again later, it gets the side back. */
  token: string | null;
  conn: number | null;
}

export interface HostOptions {
  /** A game to carry on with (a save file): its players take their sides again when they connect. */
  load?: SaveFile;
  newToken?: () => string;
  /** Called after the game was created and after every command, so the caller can keep it. */
  onChange?: (save: SaveFile) => void;
}

/**
 * One game for two players, run for them. It holds the real game, decides what each player may see of it and checks every
 * command before it is applied. It knows nothing about sockets: connections are numbers, and every call returns the
 * messages to send, so all of it can be tested without a network.
 */
export class GameHost {
  private game: GameState | null = null;
  private info: GameInfo | null = null;
  private commands: Command[] = [];
  private seq = 0;
  private seats: [Seat, Seat] = [{ token: null, conn: null }, { token: null, conn: null }];
  private hostSeat: PlayerId | null = null;
  private waiting = new Set<number>();
  private known = new Set<number>();
  private readonly newToken: () => string;

  constructor(private options: HostOptions = {}) {
    this.newToken = options.newToken ?? (() => globalThis.crypto.randomUUID());
    const save = options.load;
    if (save) {
      this.game = save.game;
      this.commands = [...save.commands];
      this.seq = this.commands.length;
      this.info = { mix: save.meta.mix, seed: save.meta.seed, skillReduction: save.meta.skillReduction ?? 0, hostSide: save.meta.human };
    }
  }

  connect(id: number): void {
    this.known.add(id);
  }

  receive(id: number, msg: ClientMessage): Outgoing[] {
    if (!this.known.has(id)) return [];
    switch (msg.type) {
      case 'join': return this.join(id, msg);
      case 'create': return this.create(id, msg);
      case 'command': return this.command(id, msg);
      case 'saveRequest': return this.saveRequest(id);
      case 'load': return this.load(id, msg);
      default: return [this.error(id, 'The host didn’t understand that message.', false)];
    }
  }

  disconnect(id: number): Outgoing[] {
    this.known.delete(id);
    this.waiting.delete(id);
    const seat = this.seatOf(id);
    if (seat === null) return [];
    this.seats[seat].conn = null;
    return this.presence();
  }

  /** Who is where, for the host's console. */
  describe(): string {
    if (!this.game || !this.info) return 'No game yet: waiting for the first player to create one.';
    const side = (i: number) => (this.seats[i]!.conn !== null ? 'connected' : this.seats[i]!.token !== null ? 'away' : 'free');
    return `Game ${this.info.mix} (seed ${this.info.seed}), turn ${this.game.turn}, ${this.game.phase}. Rebels: ${side(0)}, Empire: ${side(1)}.`;
  }

  // ---------------------------------------------------------------- messages

  private join(id: number, msg: Extract<ClientMessage, { type: 'join' }>): Outgoing[] {
    if (msg.protocol !== PROTOCOL) {
      return [this.error(id, `This page and the host are different versions (page ${msg.protocol}, host ${PROTOCOL}). Reload the page from the host's address.`, true)];
    }
    const out: Outgoing[] = [];
    // coming back to a side taken before
    const back = msg.token ? this.seats.findIndex((s) => s.token === msg.token) : -1;
    if (back >= 0) {
      const old = this.seats[back as PlayerId].conn;
      if (old !== null && old !== id) out.push(this.error(old, 'You joined from another window, which took over your side.', true));
      this.seats[back as PlayerId].conn = id;
      out.push({ to: id, msg: this.welcome(id, back as PlayerId) });
      return [...out, ...this.presence()];
    }
    // a saved game nobody has claimed yet: the first player chooses their side with `create`
    if (!this.game || this.unclaimed()) {
      this.waiting.add(id);
      out.push({ to: id, msg: { type: 'welcome', protocol: PROTOCOL, seat: null, token: null, host: false, game: this.info, view: null, seats: this.seatInfo() } });
      return out;
    }
    // an unclaimed side first; failing that the side of a player who has gone (they lost their token, or closed their window)
    let free = this.seats.findIndex((s) => s.token === null);
    if (free < 0) free = this.seats.findIndex((s) => s.conn === null);
    if (free < 0) return [this.error(id, 'The game already has two players.', true)];
    out.push({ to: id, msg: this.claim(id, free as PlayerId, false) });
    return [...out, ...this.presence()];
  }

  private create(id: number, msg: Extract<ClientMessage, { type: 'create' }>): Outgoing[] {
    if (this.seatOf(id) !== null) return [this.error(id, 'You are already in the game.', false)];
    if (this.game && !this.unclaimed()) return [this.error(id, 'A game is already running on this host.', false)];
    if (msg.hostSide !== 0 && msg.hostSide !== 1) return [this.error(id, 'Choose a side.', false)];
    if (!this.game) {
      try {
        const scenario = scenarioOptions(msg.mix, msg.seed, msg.points, msg.hostChooses ? msg.hostSide : undefined);
        // two people play: the defender places the ground target and the base by hand (Rules: Ground attack)
        if (scenario.groundAttack) scenario.groundAttack = { ...scenario.groundAttack, manualBase: true };
        // turret guns and asteroids are never combined
        this.game = createGame({ ...scenario, skillReduction: msg.skillReduction, ...(msg.damageRules ? { damageRules: true } : {}), ...(msg.specialWeapons ? { specialWeapons: true } : {}), ...(msg.advancedInitiative ? { advancedInitiative: true } : {}), ...(msg.advancedArcs ? { advancedArcs: true } : {}), ...(msg.mapMode && !scenario.groundAttack && !msg.asteroids ? { map: { ...STANDARD_MAP, mode: msg.mapMode } } : {}), ...(msg.asteroids && !scenario.groundAttack ? { asteroids: msg.asteroids } : {}) });
      } catch (e) {
        return [this.error(id, e instanceof Error ? e.message : 'That game couldn’t be set up.', false)];
      }
      this.info = { mix: msg.mix, ...(msg.points ? { points: msg.points } : {}), ...(msg.hostChooses ? { hostChooses: true } : {}), seed: msg.seed, skillReduction: msg.skillReduction, hostSide: msg.hostSide };
      this.commands = [];
      this.seq = 0;
    } else {
      this.info = { ...this.info!, hostSide: msg.hostSide };
    }
    this.hostSeat = msg.hostSide;
    this.waiting.delete(id);
    const out: Outgoing[] = [{ to: id, msg: this.claim(id, msg.hostSide, true) }];
    // players who connected before the game existed take the other side
    for (const other of this.waiting) {
      const free = this.seats.findIndex((s) => s.token === null);
      if (free < 0) break;
      this.waiting.delete(other);
      out.push({ to: other, msg: this.claim(other, free as PlayerId, false) });
    }
    this.changed();
    return [...out, ...this.presence()];
  }

  private command(id: number, msg: Extract<ClientMessage, { type: 'command' }>): Outgoing[] {
    const seat = this.seatOf(id);
    const reject = (error: string): Outgoing[] => [{ to: id, msg: { type: 'reject', id: msg.id, error } }];
    if (seat === null || !this.game) return reject('You aren’t in a game.');
    const cmd = msg.cmd;
    if (!cmd || typeof cmd !== 'object' || cmd.player !== seat) return reject('That command isn’t yours to give.');
    let result;
    try {
      result = applyCommand(this.game, cmd);
    } catch (e) {
      return reject(`The host couldn’t carry that out (${e instanceof Error ? e.message : 'unknown error'}).`);
    }
    if (!result.ok) return reject(result.error);
    this.commands.push(cmd);
    this.seq += 1;
    this.changed();
    const seats = this.seatInfo();
    const out: Outgoing[] = [];
    for (const s of [0, 1] as PlayerId[]) {
      const conn = this.seats[s].conn;
      if (conn === null) continue;
      out.push({ to: conn, msg: { type: 'update', seq: this.seq, cmd: publicCommand(cmd, s), view: viewFor(this.game, s), seats } });
    }
    return out;
  }

  /** Carries on with a saved game the page sent: allowed while no game is running, or the last one is over, or a loaded game nobody has claimed yet. */
  private load(id: number, msg: Extract<ClientMessage, { type: 'load' }>): Outgoing[] {
    if (this.seatOf(id) !== null) return [this.error(id, 'You are already in the game.', false)];
    if (this.game && !this.unclaimed() && this.game.phase !== 'over') return [this.error(id, 'A game is already running on this host.', false)];
    let save: SaveFile;
    try {
      save = parseSave(msg.text);
    } catch (e) {
      return [this.error(id, e instanceof SaveError ? e.message : 'That save couldn’t be read.', false)];
    }
    this.game = save.game;
    this.commands = [...save.commands];
    this.seq = this.commands.length;
    this.info = { mix: save.meta.mix, seed: save.meta.seed, skillReduction: save.meta.skillReduction ?? 0, hostSide: save.meta.human };
    this.seats = [{ token: null, conn: null }, { token: null, conn: null }];
    this.hostSeat = null;
    this.waiting.add(id);
    return [{ to: id, msg: { type: 'welcome', protocol: PROTOCOL, seat: null, token: null, host: false, game: this.info, view: null, seats: this.seatInfo() } }];
  }

  private saveRequest(id: number): Outgoing[] {
    const seat = this.seatOf(id);
    if (seat === null || seat !== this.hostSeat || !this.game) return [this.error(id, 'Only the player who created the game can save it.', false)];
    const save = this.saveFile()!;
    return [{ to: id, msg: { type: 'saveFile', name: saveFileName(save), text: serialise(save) } }];
  }

  // ---------------------------------------------------------------- helpers

  /** The whole game as a save file, for the host's disk. */
  saveFile(): SaveFile | null {
    if (!this.game || !this.info) return null;
    return makeSave({
      meta: { mix: this.info.mix, seed: this.info.seed, human: this.info.hostSide, skillReduction: this.info.skillReduction },
      game: this.game,
      aiRngState: 0,
      commands: this.commands,
      draft: { plans: {}, submitted: [], planShip: null, placements: [] },
    });
  }

  private changed(): void {
    const save = this.saveFile();
    if (save) this.options.onChange?.(save);
  }

  private seatOf(id: number): PlayerId | null {
    const i = this.seats.findIndex((s) => s.conn === id);
    return i < 0 ? null : (i as PlayerId);
  }

  /** A game was loaded from a save and nobody has taken a side in it yet. */
  private unclaimed(): boolean {
    return this.game !== null && this.seats.every((s) => s.token === null) && this.hostSeat === null;
  }

  private seatInfo(): [SeatInfo, SeatInfo] {
    const one = (s: Seat): SeatInfo => ({ taken: s.token !== null, connected: s.conn !== null });
    return [one(this.seats[0]), one(this.seats[1])];
  }

  private presence(): Outgoing[] {
    const seats = this.seatInfo();
    const out: Outgoing[] = [];
    for (const s of this.seats) if (s.conn !== null) out.push({ to: s.conn, msg: { type: 'presence', seats } });
    return out;
  }

  private claim(id: number, seat: PlayerId, host: boolean): ServerMessage {
    const token = this.newToken();
    this.seats[seat] = { token, conn: id };
    return { type: 'started', seat, token, host, game: this.info!, view: viewFor(this.game!, seat), seats: this.seatInfo() };
  }

  private welcome(id: number, seat: PlayerId): ServerMessage {
    void id;
    return { type: 'welcome', protocol: PROTOCOL, seat, token: this.seats[seat].token, host: seat === this.hostSeat, game: this.info, view: this.game ? viewFor(this.game, seat) : null, seats: this.seatInfo() };
  }

  private error(to: number, message: string, fatal: boolean): Outgoing {
    return { to, msg: { type: 'error', message, fatal } };
  }
}

import { describe, expect, it } from 'vitest';
import { tacticalAi } from '../src/ai/tactical';
import { createGame, dogfightOptions, emptyPlan, stateRng, waitingFor, type Command, type GameState, type PlayerId } from '../src/engine';
import { GameHost, type Outgoing } from '../src/net/host';
import { PROTOCOL, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { publicCommand, viewFor } from '../src/net/redact';
import { makeSave, parseSave, serialise } from '../src/ui/savegame';

/** A pretend connection: remembers the last view it was sent and what else arrived. */
class Client {
  seat: PlayerId | null = null;
  token: string | null = null;
  view: GameState | null = null;
  inbox: ServerMessage[] = [];
  private nextId = 1;
  constructor(readonly host: GameHost, readonly id: number) {
    host.connect(id);
  }
  send(msg: ClientMessage, others: Client[] = []): ServerMessage[] {
    const out = this.host.receive(this.id, msg);
    return deliver(out, [this, ...others]);
  }
  join(token?: string, others: Client[] = []): ServerMessage[] {
    return this.send({ type: 'join', protocol: PROTOCOL, token }, others);
  }
  command(cmd: Command, others: Client[] = []): ServerMessage[] {
    return this.send({ type: 'command', id: this.nextId++, cmd }, others);
  }
  take(msg: ServerMessage): void {
    this.inbox.push(msg);
    if (msg.type === 'welcome' || msg.type === 'started') {
      this.seat = msg.seat;
      this.token = msg.token ?? this.token;
      if (msg.view) this.view = msg.view;
    }
    if (msg.type === 'update') this.view = msg.view;
  }
}

function deliver(out: Outgoing[], clients: Client[]): ServerMessage[] {
  const mine: ServerMessage[] = [];
  for (const { to, msg } of out) {
    const client = clients.find((c) => c.id === to);
    client?.take(msg);
    if (client === clients[0]) mine.push(msg);
  }
  return mine;
}

const placements = (game: GameState, player: PlayerId) => {
  const mine = game.ships.filter((s) => s.owner === player);
  return mine.map((s, i) => ({ shipId: s.id, pos: game.zones[player][10 + i * 7]!, facing: (player === 0 ? 3 : 0) as 0 | 3 }));
};

/** A host with a Rebel (host) and an Empire player seated. */
function table(options?: ConstructorParameters<typeof GameHost>[0]) {
  const host = new GameHost(options);
  const a = new Client(host, 1);
  const b = new Client(host, 2);
  a.join();
  b.join();
  a.send({ type: 'create', mix: 'two', seed: 3, skillReduction: 0, hostSide: 0 }, [b]);
  return { host, a, b };
}

describe('what each player may see', () => {
  it('hides the other side\'s set-up until both have placed, and never sends the dice', () => {
    const game = createGame(dogfightOptions('two', 1));
    for (const s of game.ships) {
      s.pos = game.zones[s.owner][s.idNumber]!;
      s.facing = 2;
    }
    const view = viewFor(game, 0);
    expect(view.ships.filter((s) => s.owner === 0).every((s) => s.pos !== null)).toBe(true);
    expect(view.ships.filter((s) => s.owner === 1).every((s) => s.pos === null)).toBe(true);
    expect(view.rngState).toBe(0);
    expect(game.ships.every((s) => s.pos !== null)).toBe(true); // the real game is untouched
    expect(game.rngState).not.toBe(0);
    game.phase = 'planning';
    expect(viewFor(game, 0).ships.every((s) => s.pos !== null)).toBe(true);
  });

  it('hides the other side\'s plans until both have planned', () => {
    const game = createGame(dogfightOptions('two', 1));
    game.phase = 'planning';
    for (const s of game.ships) { s.pos = game.zones[s.owner][s.idNumber]!; s.plan = { ...emptyPlan(), roll: 2, snapFire: 1 }; }
    const view = viewFor(game, 1);
    expect(view.ships.filter((s) => s.owner === 1).every((s) => s.plan.roll === 2)).toBe(true);
    expect(view.ships.filter((s) => s.owner === 0).every((s) => s.plan.roll === 0 && s.plan.snapFire === 0)).toBe(true);
    game.phase = 'ships';
    expect(viewFor(game, 1).ships.every((s) => s.plan.roll === 2)).toBe(true);
  });

  it('shows the other player\'s secret orders as empty, and everything else as it is', () => {
    const place: Command = { type: 'place', player: 0, placements: [{ shipId: 'P0-1', pos: { q: 1, r: 1 }, facing: 0 }] };
    const plan: Command = { type: 'plan', player: 1, plans: { 'P1-1': emptyPlan() } };
    const move: Command = { type: 'move', player: 0, shipId: 'P0-1', steps: [{ kind: 'forward' }] };
    expect(publicCommand(place, 1)).toEqual({ type: 'place', player: 0, placements: [] });
    expect(publicCommand(place, 0)).toBe(place);
    expect(publicCommand(plan, 0)).toEqual({ type: 'plan', player: 1, plans: {}, crewPlans: {} });
    expect(publicCommand(move, 1)).toBe(move);
  });
});

describe('the host', () => {
  it('plays advanced initiative over the network: the rolls and the picks are public, each owner picks for his own ships (19)', () => {
    const host = new GameHost();
    const a = new Client(host, 1);
    const b = new Client(host, 2);
    a.join();
    b.join();
    a.send({ type: 'create', mix: 'two', seed: 3, skillReduction: 0, hostSide: 0, advancedInitiative: true }, [b]);
    const full = (host as unknown as { game: GameState }).game;
    expect(full.advancedInitiative).toBe(true);
    a.command({ type: 'place', player: 0, placements: placements(full, 0) }, [b]);
    b.command({ type: 'place', player: 1, placements: placements(full, 1) }, [a]);
    expect(a.view!.phase).toBe('initiative');
    expect(Object.keys(b.view!.initiativeTable!.rolls)).toHaveLength(full.ships.length);
    // the owner of the first ship in the order picks; the other player is refused
    const first = full.ships.find((s) => s.id === full.initiativeTable!.order[0])!;
    const [mine, theirs] = first.owner === 0 ? [a, b] : [b, a];
    const refused = theirs.command({ type: 'slot', player: first.owner === 0 ? 1 : 0, slot: 1 }, [mine]);
    expect(refused.some((m) => m.type === 'reject')).toBe(true);
    const accepted = mine.command({ type: 'slot', player: first.owner, slot: 1 }, [theirs]);
    expect(accepted.some((m) => m.type === 'reject')).toBe(false);
    expect(theirs.view!.initiativeTable!.slots[0]).toBe(first.id);
  });

  it('seats the second player on the other side and tells the first', () => {
    const { a, b } = table();
    expect(a.seat).toBe(0);
    expect(b.seat).toBe(1);
    expect(a.inbox.some((m) => m.type === 'presence' && m.seats[1].connected)).toBe(true);
    expect(a.view!.ships.length).toBe(b.view!.ships.length);
  });

  it('keeps each player\'s placement from the other until both are down, then shows everything', () => {
    const { host, a, b } = table();
    const full = (host as unknown as { game: GameState }).game;
    const first = a.command({ type: 'place', player: 0, placements: placements(full, 0) }, [b]);
    expect(first.some((m) => m.type === 'reject')).toBe(false);
    expect(b.view!.ships.filter((s) => s.owner === 0).every((s) => s.pos === null)).toBe(true);
    expect(b.inbox.at(-1)).toMatchObject({ type: 'update', cmd: { type: 'place', player: 0, placements: [] } });
    b.command({ type: 'place', player: 1, placements: placements(full, 1) }, [a]);
    expect(a.view!.phase).toBe('planning');
    expect(a.view!.ships.every((s) => s.pos !== null)).toBe(true);
    expect(b.view!.ships.every((s) => s.pos !== null)).toBe(true);
  });

  it('refuses commands that are not the sender\'s, are illegal, or come from nobody', () => {
    const { host, a, b } = table();
    const full = (host as unknown as { game: GameState }).game;
    expect(a.command({ type: 'place', player: 1, placements: placements(full, 1) }, [b])[0]).toMatchObject({ type: 'reject', error: expect.stringContaining('yours to give') });
    expect(a.command({ type: 'plan', player: 0, plans: {} }, [b])[0]).toMatchObject({ type: 'reject' });
    const stranger = new Client(host, 9);
    expect(stranger.command({ type: 'place', player: 0, placements: [] })[0]).toMatchObject({ type: 'reject', error: expect.stringContaining('in a game') });
  });

  it('lets a player back in to the same side with the token, and takes over the old connection', () => {
    const { a, b, host } = table();
    const token = b.token!;
    const out = host.disconnect(b.id);
    deliver(out, [a]);
    expect(a.inbox.at(-1)).toMatchObject({ type: 'presence', seats: [{ connected: true }, { connected: false }] });
    const back = new Client(host, 7);
    back.join(token, [a]);
    expect(back.seat).toBe(1);
    expect(back.view).not.toBeNull();
    const again = new Client(host, 8);
    const msgs = again.join(token, [back]);
    expect(again.seat).toBe(1);
    expect(back.inbox.some((m) => m.type === 'error' && m.fatal)).toBe(true);
    expect(msgs.some((m) => m.type === 'welcome')).toBe(true);
  });

  it('turns away a third player and a page of another version', () => {
    const { host } = table();
    const third = new Client(host, 5);
    expect(third.join()[0]).toMatchObject({ type: 'error', fatal: true, message: expect.stringContaining('two players') });
    const old = new Client(host, 6);
    expect(old.send({ type: 'join', protocol: PROTOCOL + 1 })[0]).toMatchObject({ type: 'error', fatal: true, message: expect.stringContaining('versions') });
  });

  it('lets only the host player ask for a save, and the save carries the whole game', () => {
    const { a, b } = table();
    expect(b.send({ type: 'saveRequest' })[0]).toMatchObject({ type: 'error', fatal: false });
    const reply = a.send({ type: 'saveRequest' })[0] as Extract<ServerMessage, { type: 'saveFile' }>;
    expect(reply.type).toBe('saveFile');
    const save = parseSave(reply.text);
    expect(save.game.rngState).not.toBe(0);
    expect(save.meta.human).toBe(0);
  });

  it('can carry on a saved game: the first player picks a side, the second gets the other', () => {
    const first = table();
    const full = (first.host as unknown as { game: GameState }).game;
    first.a.command({ type: 'place', player: 0, placements: placements(full, 0) }, [first.b]);
    const text = (first.a.send({ type: 'saveRequest' })[0] as Extract<ServerMessage, { type: 'saveFile' }>).text;

    const host = new GameHost({ load: parseSave(text) });
    const a = new Client(host, 1);
    const b = new Client(host, 2);
    a.join();
    expect(a.seat).toBeNull();
    expect(a.inbox[0]).toMatchObject({ type: 'welcome', game: { mix: 'two' } });
    a.send({ type: 'create', mix: 'four', seed: 99, skillReduction: 3, hostSide: 1 }, [b]);
    expect(a.seat).toBe(1);
    b.join(undefined, [a]);
    expect(b.seat).toBe(0);
    expect(b.view!.placed[0]).toBe(true);
    expect(host.saveFile()!.meta.mix).toBe('two'); // the saved game, not the form's options
  });

  it('keeps the game going through a whole game of two computer players that see only what they may', () => {
    const saves: string[] = [];
    const { host, a, b } = table({ onChange: (save) => saves.push(save.game.phase) });
    const clients = [a, b];
    const rngs = [{ rngState: 5 }, { rngState: 6 }];
    const ais = [tacticalAi(stateRng(rngs[0]!)), tacticalAi(stateRng(rngs[1]!))];
    let rejected = 0;
    for (let i = 0; i < 20000; i++) {
      const done = clients.every((c) => c.view!.phase === 'over');
      if (done) break;
      let moved = false;
      for (const c of clients) {
        const view = c.view!;
        if (view.phase === 'over' || !waitingFor(view).includes(c.seat!)) continue;
        const cmd = ais[c.seat!]!(view, c.seat!);
        if (!cmd) continue;
        const replies = c.command(cmd, clients.filter((o) => o !== c));
        if (replies.some((m) => m.type === 'reject')) rejected += 1;
        moved = true;
        break;
      }
      if (!moved) throw new Error('nobody could move');
    }
    expect(rejected).toBe(0);
    expect(a.view!.phase).toBe('over');
    expect(b.view!.winner).toBe(a.view!.winner);
    expect(a.view!.log.length).toBe(b.view!.log.length);
    expect(host.describe()).toContain('over');
    expect(saves.length).toBeGreaterThan(50);
    expect(parseSave(serialise(host.saveFile()!)).game.phase).toBe('over');
  });
});

describe('a points game over the network', () => {
  it('keeps each side\'s purchase secret until both have bought, then shows both', () => {
    const host = new GameHost();
    const a = new Client(host, 1);
    const b = new Client(host, 2);
    a.join();
    b.join();
    a.send({ type: 'create', mix: 'points', points: [30, 40], seed: 5, skillReduction: 0, hostSide: 0 }, [b]);
    expect(a.view!.phase).toBe('forces');
    expect(b.view!.phase).toBe('forces');
    const buy = (player: PlayerId, typeId: string): Command => ({ type: 'buy', player, ships: [{ typeId, quality: 'veteran', gunners: [] }] });
    // the Rebels buy: the Empire sees that they did, not what
    const reply = a.command(buy(0, 'x-wing'), [b]);
    expect(reply.some((m) => m.type === 'reject')).toBe(false);
    expect(b.view!.purchase!.chosen).toEqual([null, null]);
    const toB = b.inbox.filter((m): m is Extract<ServerMessage, { type: 'update' }> => m.type === 'update').at(-1)!;
    expect(toB.cmd).toMatchObject({ type: 'buy', ships: [] });
    // the Empire buys: now both see both, and the ships exist
    b.command(buy(1, 'tie-fighter'), [a]);
    for (const c of [a, b]) {
      expect(c.view!.phase).toBe('setup');
      expect(c.view!.purchase!.chosen.map((f) => f!.ships[0]!.typeId)).toEqual(['x-wing', 'tie-fighter']);
      expect(c.view!.ships.map((s) => s.typeId)).toEqual(['x-wing', 'tie-fighter']);
    }
    expect(a.view!.vp).toEqual([5, 0]);
  });

  it('refuses a points game with silly points', () => {
    const host = new GameHost();
    const a = new Client(host, 1);
    a.join();
    const reply = a.send({ type: 'create', mix: 'points', points: [1, 40], seed: 5, skillReduction: 0, hostSide: 0 });
    expect(reply.some((m) => m.type === 'error')).toBe(true);
    expect(host.describe()).toMatch(/No game yet/);
  });
});

describe('a points game where the host chooses both forces', () => {
  it('has the joiner wait, and shows both of them the forces once the host has chosen', () => {
    const host = new GameHost();
    const a = new Client(host, 1);
    const b = new Client(host, 2);
    a.join();
    b.join();
    a.send({ type: 'create', mix: 'points', points: [30, 30], hostChooses: true, seed: 5, skillReduction: 0, hostSide: 0 }, [b]);
    expect(b.view!.phase).toBe('forces');
    expect(b.view!.purchase!.chooser).toBe(0);
    const ships = (typeId: string) => [{ typeId, quality: 'average' as const, gunners: [] }];
    // the joining player may not buy, not even for their own side
    expect(b.command({ type: 'buy', player: 1, ships: ships('tie-fighter') }, [a]).some((m) => m.type === 'reject')).toBe(true);
    expect(b.command({ type: 'buyBoth', player: 1, ships: [ships('x-wing'), ships('tie-fighter')] }, [a]).some((m) => m.type === 'reject')).toBe(true);
    expect(a.command({ type: 'buyBoth', player: 0, ships: [ships('x-wing'), ships('tie-fighter')] }, [b]).some((m) => m.type === 'reject')).toBe(false);
    for (const c of [a, b]) {
      expect(c.view!.phase).toBe('setup');
      expect(c.view!.ships.map((s) => s.typeId)).toEqual(['x-wing', 'tie-fighter']);
    }
  });
});

describe('a game with reserves over the network', () => {
  it('plays the Asteroid Run through, with the edge choice, the arrival and the verdict seen by both sides', () => {
    const host = new GameHost();
    const a = new Client(host, 1);
    const b = new Client(host, 2);
    a.join();
    b.join();
    a.send({ type: 'create', mix: 'asteroid2', seed: 3, skillReduction: 0, hostSide: 0, asteroids: { density: 'dense', motion: 'drift', chaos: 4 } }, [b]);
    const clients = [a, b];
    const ais = [tacticalAi(stateRng({ rngState: 7 })), tacticalAi(stateRng({ rngState: 8 }))];
    let rejected = 0;
    for (let i = 0; i < 20000 && !clients.every((c) => c.view!.phase === 'over'); i++) {
      let moved = false;
      for (const c of clients) {
        const view = c.view!;
        if (view.phase === 'over' || !waitingFor(view).includes(c.seat!)) continue;
        const cmd = ais[c.seat!]!(view, c.seat!);
        if (!cmd) continue;
        if (c.command(cmd, clients.filter((o) => o !== c)).some((m) => m.type === 'reject')) rejected += 1;
        moved = true;
        break;
      }
      if (!moved) throw new Error('nobody could move');
    }
    expect(rejected).toBe(0);
    expect(a.view!.phase).toBe('over');
    expect(b.view!.winner).toBe(a.view!.winner);
    expect(b.view!.log.some((e) => e.kind === 'arrival' || a.view!.reserves?.[0]?.entered === false)).toBe(true);
    expect(b.view!.edgeChoice!.edge).toBe(a.view!.edgeChoice!.edge);
  });
});

describe('carrying on with a saved game from the page', () => {
  const saveText = (): string => serialise(makeSave({ meta: { mix: 'two', seed: 3, human: 0 }, game: createGame(dogfightOptions('two', 3)), aiRngState: 1, commands: [], draft: { plans: {}, submitted: [], planShip: null, placements: [] } }));

  it('takes a save while no game runs, then lets the first player claim a side and the second take the other', () => {
    const host = new GameHost();
    const a = new Client(host, 1);
    const b = new Client(host, 2);
    a.join();
    b.join();
    const replies = a.send({ type: 'load', text: saveText() }, [b]);
    expect(replies.some((m) => m.type === 'welcome' && m.seat === null && m.game !== null)).toBe(true);
    a.send({ type: 'create', mix: 'two', seed: 3, skillReduction: 0, hostSide: 1 }, [b]);
    expect(a.seat).toBe(1);
    expect(b.seat).toBe(0);
    expect(a.view!.ships.length).toBeGreaterThan(0);
  });

  it('refuses a save while a game is running, and one that is not a save', () => {
    const { a, b } = table();
    expect(a.send({ type: 'load', text: saveText() }, [b]).some((m) => m.type === 'error')).toBe(true);
    const host = new GameHost();
    const c = new Client(host, 5);
    c.join();
    expect(c.send({ type: 'load', text: '{"hello":1}' }).some((m) => m.type === 'error')).toBe(true);
  });
});

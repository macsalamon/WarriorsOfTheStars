import { describe, expect, it } from 'vitest';
import { playGame } from '../src/ai/player';
import { tacticalAi } from '../src/ai/tactical';
import { applyCommand, createGame, dogfightOptions, stateRng, type Command, type DogfightMix, type GameState } from '../src/engine';
import { SAVE_VERSION, SaveError, describeSave, makeSave, parseSave, serialise } from '../src/ui/savegame';

const mix: DogfightMix = 'two';
const seed = 7;

interface Players {
  game: GameState;
  rng: [{ rngState: number }, { rngState: number }];
  commands: Command[];
}

const newPlayers = (): Players => ({
  game: createGame(dogfightOptions(mix, seed)),
  rng: [{ rngState: 11 }, { rngState: 22 }],
  commands: [],
});

/** Plays on with two computer players whose dice live in `rng`, recording every command. */
function play(p: Players, maxCommands: number): void {
  const ais: [ReturnType<typeof tacticalAi>, ReturnType<typeof tacticalAi>] = [tacticalAi(stateRng(p.rng[0])), tacticalAi(stateRng(p.rng[1]))];
  playGame(p.game, ais, { maxCommands, onCommand: (cmd, result) => { if (result.ok) p.commands.push(cmd); } });
}

describe('saving and loading a game', () => {
  it('survives a trip through a file, down to the last die', () => {
    const p = newPlayers();
    play(p, 150);
    const save = makeSave({ meta: { mix, seed, human: 0 }, game: p.game, aiRngState: p.rng[1].rngState, commands: p.commands, draft: { plans: {}, submitted: [], planShip: null, placements: [] } });
    const loaded = parseSave(serialise(save));
    expect(loaded.game).toEqual(p.game);
    expect(loaded.commands).toEqual(p.commands);
    expect(loaded.aiRngState).toBe(p.rng[1].rngState);
    expect(describeSave(loaded)).toContain('Dogfight Two');
  });

  it('plays on from a loaded game exactly as the uninterrupted game would', () => {
    const straight = newPlayers();
    play(straight, 100000);
    expect(straight.game.phase).toBe('over');

    const first = newPlayers();
    play(first, 200);
    const text = serialise(makeSave({ meta: { mix, seed, human: 0 }, game: first.game, aiRngState: first.rng[1].rngState, commands: first.commands, draft: { plans: {}, submitted: [], planShip: null, placements: [] } }));
    const loaded = parseSave(text);
    const second: Players = { game: loaded.game, rng: [{ rngState: first.rng[0].rngState }, { rngState: loaded.aiRngState }], commands: [...loaded.commands] };
    play(second, 100000);

    expect(second.game).toEqual(straight.game);
    expect(second.commands).toEqual(straight.commands);
  });

  it('can be replayed from its start options and the recorded commands alone', () => {
    const p = newPlayers();
    play(p, 100000);
    const replay = createGame(dogfightOptions(mix, seed));
    for (const cmd of p.commands) expect(applyCommand(replay, cmd).ok).toBe(true);
    expect(replay).toEqual(p.game);
  });

  it('refuses files that are not saves of this game', () => {
    const p = newPlayers();
    const good = makeSave({ meta: { mix, seed, human: 1 }, game: p.game, aiRngState: 1, commands: [], draft: { plans: {}, submitted: [], planShip: null, placements: [] } });
    const bad = (change: (s: Record<string, unknown>) => void): string => {
      const copy = JSON.parse(serialise(good)) as Record<string, unknown>;
      change(copy);
      return JSON.stringify(copy);
    };
    expect(() => parseSave('not json')).toThrow(SaveError);
    expect(() => parseSave('{"hello": 1}')).toThrow(/isn.t a Warriors of the Stars save/);
    expect(() => parseSave(bad((s) => { s.version = SAVE_VERSION + 1; }))).toThrow(/newer version/);
    expect(() => parseSave(bad((s) => { delete s.game; }))).toThrow(/no readable game/);
    expect(() => parseSave(bad((s) => { (s.meta as Record<string, unknown>).human = 5; }))).toThrow(/who was playing/);
    expect(() => parseSave(bad((s) => { ((s.game as GameState).ships[0] as { typeId: string }).typeId = 'death-star'; }))).toThrow(/doesn.t know/);
    expect(parseSave(serialise(good)).meta.human).toBe(1);
  });
});

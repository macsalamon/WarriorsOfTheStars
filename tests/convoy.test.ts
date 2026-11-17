import { describe, expect, it } from 'vitest';
import { playGame } from '../src/ai/player';
import { tacticalAi } from '../src/ai/tactical';
import {
  STANDARD_MAP,
  applyVariants,
  createGame,
  createRng,
  dogfightOptions,
  escapeVpOf,
  gameShouldEnd,
  isObjectiveShip,
  roleOf,
  scenarioDef,
  scenarioIds,
  scenarioOptions,
  shipById,
  winnerOf,
  type DogfightMix,
  type GameState,
} from '../src/engine';

const open = { ...STANDARD_MAP, mode: 'open' as const };
const convoy = (n: 1 | 2 | 3, adjustable = false): GameState => createGame({ ...dogfightOptions(`convoy${n}` as DogfightMix, 3), ...(adjustable ? { map: open } : {}) });
const count = (g: GameState, owner: 0 | 1): number => g.ships.filter((s) => s.owner === owner).length;

describe('the scenarios as data', () => {
  it('knows every scenario of the menu', () => {
    expect(scenarioIds().sort()).toEqual(['asteroid2', 'convoy1', 'convoy2', 'convoy3', 'destroyers1', 'destroyers2', 'destroyers3', 'destroyers4', 'destroyers5', 'destroyers6', 'destroyers7', 'destroyers8', 'four', 'ground1', 'ground2', 'ground3', 'one', 'showcase', 'three', 'two']);
    expect(scenarioDef('convoy2')!.name).toBe('Convoy Two');
  });

  it('sets up the three convoys as printed, on the static map', () => {
    const one = convoy(1);
    expect(one.map.mode).toBe('static');
    expect(one.ships.filter((s) => s.owner === 0).map((s) => [s.typeId, s.quality])).toEqual([['a-wing', 'veteran'], ['a-wing', 'veteran'], ['a-wing', 'veteran']]);
    expect(one.ships.filter((s) => s.owner === 1).map((s) => s.typeId)).toEqual(['tie-fighter', 'tie-fighter', 'tie-fighter', 'stock-freighter']);
    expect(one.vp).toEqual([0, 1]);
    const freighter = one.ships.find((s) => s.typeId === 'stock-freighter')!;
    expect(freighter.tag).toBe('convoy');
    expect(freighter.quality).toBe('poor');
    expect(freighter.gunners!.map((g) => g.quality)).toEqual(['poor']);

    const two = convoy(2);
    expect(two.ships.filter((s) => s.tag === 'convoy').map((s) => s.typeId)).toEqual(['stock-freighter', 'stock-freighter']);
    expect(two.ships.filter((s) => s.owner === 1)).toHaveLength(6);

    const three = convoy(3);
    expect(three.ships.filter((s) => s.tag === 'convoy').map((s) => [s.typeId, s.quality, s.gunners![0]!.quality])).toEqual([['imperial-shuttle', 'average', 'average']]);
    expect(three.ships.filter((s) => s.owner === 0).map((s) => s.typeId)).toEqual(['y-wing-1seat', 'y-wing-1seat', 'y-wing-1seat', 'b-wing', 'b-wing', 'b-wing']);
  });

  it('gives roles, and says what the convoy earns and when the game ends', () => {
    const g = convoy(2);
    expect(roleOf(g, 0)).toBe('convoy');
    expect(roleOf(g, 1)).toBe('attacker');
    expect(roleOf(createGame(dogfightOptions('one', 1)), 0)).toBeNull();
    const freighter = g.ships.find((s) => s.typeId === 'stock-freighter')!;
    expect(escapeVpOf(g, freighter)).toBe(10);
    expect(isObjectiveShip(g, freighter)).toBe(true);
    expect(escapeVpOf(g, g.ships.find((s) => s.typeId === 'x-wing')!)).toBe(0);
  });
});

describe('the adjustable map gives the weaker side more', () => {
  it('adds the forces of each mix when the map is adjustable, and not when it is static', () => {
    expect(count(convoy(2), 0)).toBe(4);
    expect(count(convoy(2, true), 0)).toBe(5);
    expect(convoy(2, true).ships.filter((s) => s.owner === 0 && s.typeId === 'x-wing').map((s) => s.quality)).toEqual(['veteran', 'veteran', 'veteran']);
    expect(count(convoy(3), 1)).toBe(4);
    const three = convoy(3, true);
    expect(count(three, 1)).toBe(5);
    expect(three.ships.filter((s) => s.typeId === 'tie-interceptor-prototype').map((s) => s.quality)).toEqual(['veteran']);
    // mix one: every TIE pilot a veteran
    expect(convoy(1).ships.filter((s) => s.typeId === 'tie-fighter').map((s) => s.quality)).toEqual(['veteran', 'average', 'average']);
    expect(convoy(1, true).ships.filter((s) => s.typeId === 'tie-fighter').map((s) => s.quality)).toEqual(['veteran', 'veteran', 'veteran']);
  });

  it('keeps the static map for an asteroid field, so no variant of the adjustable map applies', () => {
    const g = createGame({ ...dogfightOptions('convoy2', 3), map: open, asteroids: { density: 'sparse', motion: 'drift', chaos: 4 } });
    expect(g.map.mode).toBe('static');
    expect(count(g, 0)).toBe(4);
  });

  it('applies variants by their conditions only', () => {
    const ships = [{ owner: 0 as const, typeId: 'x-wing', quality: 'average' as const }, { owner: 1 as const, typeId: 'tie-fighter', quality: 'average' as const }];
    const state = { specialWeapons: false, damageRules: false, adjustableMap: false };
    const variants = [{ when: { specialWeapons: true }, add: [{ owner: 1 as const, typeId: 'tie-bomber', quality: 'poor' as const }], replace: [{ owner: 1 as const, typeId: 'tie-fighter', with: 'tie-interceptor' }] }];
    expect(applyVariants(ships, variants, state)).toEqual(ships);
    expect(applyVariants(ships, variants, { ...state, specialWeapons: true }).map((s) => s.typeId)).toEqual(['x-wing', 'tie-interceptor', 'tie-bomber']);
  });
});

describe('how a convoy game ends and who wins', () => {
  it('is over when every convoy ship is gone, or every attacker, but not when the escorts are gone', () => {
    const g = convoy(1); // the Rebels attack, the Empire has the convoy and three escorts
    expect(gameShouldEnd(g)).toBe(false);
    for (const s of g.ships.filter((x) => x.owner === 1 && !x.tag)) s.status = 'destroyed';
    expect(gameShouldEnd(g)).toBe(false); // the freighter is still there
    g.ships.find((s) => s.tag === 'convoy')!.status = 'escaped';
    expect(gameShouldEnd(g)).toBe(true);

    const h = convoy(1);
    for (const s of h.ships.filter((x) => x.owner === 0)) s.status = 'destroyed';
    expect(gameShouldEnd(h)).toBe(true);
  });

  it('gives a tie to the side the mix names, and calls it a draw otherwise', () => {
    const two = convoy(2);
    two.vp = [4, 4];
    expect(winnerOf(two)).toBe(0);
    two.vp = [4, 5];
    expect(winnerOf(two)).toBe(1);
    const one = convoy(1);
    one.vp = [3, 3];
    expect(winnerOf(one)).toBe('draw');
  });

  it('ends the other scenarios as before: when one side has no ship left', () => {
    const g = createGame(dogfightOptions('four', 1));
    expect(gameShouldEnd(g)).toBe(false);
    for (const s of g.ships.filter((x) => x.owner === 0)) s.status = 'escaped';
    expect(gameShouldEnd(g)).toBe(true);
    g.vp = [2, 2];
    expect(winnerOf(g)).toBe('draw');
  });

  it('ends a Ground Attack when no attacker is left, whoever the attacker is', () => {
    const g = createGame(scenarioOptions('ground2', 1));
    expect(g.rules!.end).toEqual([{ kind: 'sideGone', side: 1 }]);
    expect(gameShouldEnd(g)).toBe(false);
    for (const s of g.ships.filter((x) => x.owner === 1)) s.status = 'destroyed';
    expect(gameShouldEnd(g)).toBe(true);
  });
});

describe('computer players in a convoy', () => {
  it('play whole games, and the convoy ships run for the edge and earn their points', () => {
    let escapes = 0;
    let games = 0;
    for (const n of [1, 2, 3] as const) {
      for (let seed = 1; seed <= 3; seed++) {
        const g = createGame({ ...dogfightOptions(`convoy${n}` as DogfightMix, seed) });
        playGame(g, [tacticalAi(createRng(seed)), tacticalAi(createRng(seed * 13))], { maxCommands: 12000 });
        expect(g.phase).toBe('over');
        games += 1;
        const out = g.ships.filter((s) => s.tag === 'convoy' && s.status === 'escaped');
        escapes += out.length;
        // each escape is told in the log with its points, and the owner of the ships has at least those points
        expect(g.log.filter((e) => e.kind === 'escaped' && /earns 10 victory points/.test(e.text))).toHaveLength(out.length);
        for (const owner of [0, 1] as const) {
          const mine = out.filter((s) => s.owner === owner).length;
          expect(g.vp[owner]).toBeGreaterThanOrEqual(10 * mine);
        }
        expect(shipById(g, g.ships[0]!.id)).toBeTruthy();
      }
    }
    console.log(`convoy ships that escaped: ${escapes} in ${games} games`);
    expect(escapes).toBeGreaterThan(0);
  });
});

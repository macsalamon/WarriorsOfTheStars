import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  bonusPoints,
  createGame,
  createRng,
  forceCost,
  forceError,
  getShip,
  isCapitalType,
  pilotFiredGuns,
  purchasable,
  scenarioOptions,
  stateRng,
  waitingFor,
  type ForceShip,
} from '../src/engine';
import { buildForce } from '../src/ai/force';
import { tacticalAi } from '../src/ai/tactical';
import { playGame } from '../src/ai/player';
import { publicCommand, viewFor } from '../src/net/redact';

const ship = (typeId: string, quality: ForceShip['quality'] = 'average', gunners: ForceShip['quality'][] = []): ForceShip => ({ typeId, quality, gunners });

describe('purchasing ships (35)', () => {
  it('costs the ship, the pilot and the gunners', () => {
    // an example: an A-wing (5) with a veteran pilot (8) is 13
    expect(forceCost([ship('a-wing', 'veteran')])).toBe(13);
    // Y-wing (5) + trainee pilot (1) + average gunner (2)
    expect(forceCost([ship('y-wing-2seat', 'trainee', ['average'])])).toBe(8);
  });

  it('lets each side buy only its own ships, and the capital ships that are theirs', () => {
    expect(purchasable(0)).toEqual(expect.arrayContaining(['x-wing', 'a-wing', 'b-wing', 'y-wing-1seat', 'y-wing-2seat', 'stock-freighter', 'millennium-falcon', 'pirate-pinnace']));
    expect(purchasable(1)).toEqual(expect.arrayContaining(['tie-fighter', 'tie-interceptor', 'tie-interceptor-prototype', 'tie-bomber', 'stock-freighter', 'imperial-shuttle', 'slave-i', 'pirate-pinnace']));
    expect(purchasable(0)).not.toContain('tie-fighter');
    expect(purchasable(1)).not.toContain('x-wing');
    // the Star Destroyer is Imperial, the Mon Calamari cruiser Rebel, the frigate either side's
    expect(purchasable(1)).toContain('star-destroyer');
    expect(purchasable(0)).not.toContain('star-destroyer');
    expect(purchasable(0)).toContain('mon-calamari');
    expect(purchasable(1)).not.toContain('mon-calamari');
    expect(purchasable(0)).toContain('nebulon-b');
    expect(purchasable(1)).toContain('nebulon-b');
  });

  it('prices a capital ship at its value, with no pilot or gunners', () => {
    expect(forceCost([ship('star-destroyer', 'hotshot'), ship('nebulon-b', 'trainee')])).toBe(130);
    expect(forceError(1, 130, [ship('star-destroyer', 'average'), ship('nebulon-b', 'average')])).toBeNull();
    expect(forceError(1, 129, [ship('star-destroyer', 'average'), ship('nebulon-b', 'average')])).toMatch(/130 points/);
    expect(forceError(0, 500, [ship('star-destroyer', 'average')])).toMatch(/can.t buy/);
    expect(forceError(0, 500, [ship('mon-calamari', 'average', ['average'])])).toMatch(/no gunners/);
  });

  it('turns bought capital ships into capital ships of the game', () => {
    const g = createGame({ seed: 1, ships: [], points: [100, 130] });
    applyCommand(g, { type: 'buy', player: 0, ships: [ship('mon-calamari', 'average')] });
    applyCommand(g, { type: 'buy', player: 1, ships: [ship('star-destroyer', 'average'), ship('nebulon-b', 'average')] });
    expect(g.phase).toBe('setup');
    expect(g.destroyers!.map((d) => d.kind)).toEqual(['mon-calamari', 'star-destroyer', 'nebulon-b']);
  });

  it('knows which ships have gunners', () => {
    const withGunners = Object.fromEntries(['imperial-shuttle', 'y-wing-2seat', 'stock-freighter', 'millennium-falcon', 'x-wing', 'slave-i', 'pirate-pinnace'].map((id) => [id, getShip(id).gunnerWeapons.length]));
    expect(withGunners).toEqual({ 'imperial-shuttle': 1, 'y-wing-2seat': 1, 'stock-freighter': 2, 'millennium-falcon': 2, 'x-wing': 0, 'slave-i': 0, 'pirate-pinnace': 0 });
  });

  it('refuses forces that break the rules', () => {
    expect(forceError(0, 50, [])).toMatch(/at least one/);
    expect(forceError(0, 50, [ship('tie-fighter')])).toMatch(/can.t buy/);
    expect(forceError(0, 50, [ship('x-wing', 'average', ['average'])])).toMatch(/room for 0 gunners/);
    expect(forceError(0, 50, [ship('millennium-falcon', 'average', ['average', 'average', 'average'])])).toMatch(/room for 2 gunners/);
    expect(forceError(0, 10, [ship('x-wing', 'veteran')])).toMatch(/3 more than the limit of 10/);
    expect(forceError(0, 13, [ship('x-wing', 'veteran')])).toBeNull();
  });

  it('gives the side with fewer points a bonus point for every two points the other has more', () => {
    expect(bonusPoints([40, 40])).toEqual([0, 0]);
    expect(bonusPoints([40, 50])).toEqual([5, 0]);
    expect(bonusPoints([51, 40])).toEqual([0, 5]);
    expect(bonusPoints([40, 41])).toEqual([0, 0]);
  });

  it('computer forces stay within the points and can shoot by themselves', () => {
    const rng = createRng(7);
    for (const player of [0, 1] as const) {
      for (let limit = 5; limit <= 120; limit += 5) {
        const force = buildForce(player, limit, rng);
        expect(force.length).toBeGreaterThan(0);
        expect(forceError(player, limit, force)).toBeNull();
        // (a capital ship fires by itself)
        for (const s of force.filter((x) => !isCapitalType(x.typeId))) expect(pilotFiredGuns(getShip(s.typeId)).length).toBeGreaterThan(0);
        // it spends nearly all: what is left would not buy even the cheapest ship and pilot
        expect(limit - forceCost(force)).toBeLessThan(5);
      }
    }
  });
});

describe('a points game', () => {
  const start = () => createGame(scenarioOptions('points', 11, [30, 40]));

  it('starts with the forces phase, no ships, and both sides to choose', () => {
    const game = start();
    expect(game.phase).toBe('forces');
    expect(game.ships).toHaveLength(0);
    expect(waitingFor(game)).toEqual([0, 1]);
    expect(() => scenarioOptions('points', 1)).toThrow();
    expect(() => scenarioOptions('points', 1, [3, 40])).toThrow();
  });

  it('creates the ships once both have bought, rolls their skills, and gives the bonus', () => {
    const game = start();
    expect(applyCommand(game, { type: 'buy', player: 0, ships: [ship('y-wing-2seat', 'veteran', ['average']), ship('x-wing', 'poor')] }).ok).toBe(true);
    expect(game.phase).toBe('forces');
    expect(waitingFor(game)).toEqual([1]);
    expect(game.ships).toHaveLength(0);
    expect(applyCommand(game, { type: 'buy', player: 1, ships: [ship('tie-fighter', 'average'), ship('imperial-shuttle', 'poor', ['poor'])] }).ok).toBe(true);
    expect(game.phase).toBe('setup');
    expect(game.ships.map((s) => `${s.owner}:${s.typeId}`)).toEqual(['0:y-wing-2seat', '0:x-wing', '1:tie-fighter', '1:imperial-shuttle']);
    expect(game.ships.map((s) => s.idNumber)).toEqual([1, 2, 1, 2]);
    expect(game.ships[0]!.gunners).toHaveLength(1);
    expect(game.ships[0]!.gunners![0]!.quality).toBe('average');
    expect(game.ships[1]!.gunners).toBeUndefined();
    // 30 against 40 points: the Rebels get 5 bonus points
    expect(game.vp).toEqual([5, 0]);
    expect(game.log.map((e) => e.text).join('\n')).toMatch(/Rebels \(\d+ of 30 points\)/);
    expect(waitingFor(game)).toEqual([0, 1]);
  });

  it('rejects a second purchase, an invalid one, and buying during the game', () => {
    const game = start();
    expect(applyCommand(game, { type: 'buy', player: 0, ships: [ship('x-wing', 'hotshot'), ship('x-wing', 'hotshot')] }).ok).toBe(false);
    expect(applyCommand(game, { type: 'buy', player: 0, ships: [ship('x-wing')] }).ok).toBe(true);
    expect(applyCommand(game, { type: 'buy', player: 0, ships: [ship('a-wing')] }).ok).toBe(false);
    const preset = createGame(scenarioOptions('four', 1));
    expect(applyCommand(preset, { type: 'buy', player: 0, ships: [ship('x-wing')] }).ok).toBe(false);
  });

  it('is the same game every time from the same seed and purchases', () => {
    const make = () => {
      const g = start();
      applyCommand(g, { type: 'buy', player: 1, ships: [ship('tie-interceptor', 'veteran')] });
      applyCommand(g, { type: 'buy', player: 0, ships: [ship('a-wing', 'average')] });
      return g;
    };
    expect(make().ships.map((s) => [s.pilotSkill, s.gunnerySkill])).toEqual(make().ships.map((s) => [s.pilotSkill, s.gunnerySkill]));
  });

  it('can be played to the end by the computer', () => {
    const game = createGame(scenarioOptions('points', 5, [25, 25]));
    const rng = createRng(3);
    playGame(game, [tacticalAi(rng), tacticalAi(createRng(4))], { maxCommands: 6000 });
    expect(game.ships.length).toBeGreaterThan(1);
    expect(['over', 'planning', 'ships']).toContain(game.phase);
  }, 60000);

  it('keeps what each side bought secret until both have bought', () => {
    const game = start();
    applyCommand(game, { type: 'buy', player: 0, ships: [ship('x-wing', 'veteran')] });
    // the Empire has not bought: it must not learn what the Rebels have
    expect(viewFor(game, 1).purchase!.chosen).toEqual([null, null]);
    expect(viewFor(game, 0).purchase!.chosen[0]!.ships).toHaveLength(1);
    expect(publicCommand({ type: 'buy', player: 0, ships: [ship('x-wing')] }, 1)).toMatchObject({ type: 'buy', ships: [] });
    applyCommand(game, { type: 'buy', player: 1, ships: [ship('tie-fighter')] });
    // once both have, the forces are public (and the ships exist)
    expect(viewFor(game, 1).purchase!.chosen[0]!.ships).toHaveLength(1);
    void stateRng;
  });
});

describe('a points game where one player chooses both forces', () => {
  const make = () => createGame(scenarioOptions('points', 9, [30, 30], 0));
  const rebels = [ship('x-wing', 'veteran'), ship('x-wing', 'average')];
  const empire = [ship('tie-interceptor', 'veteran'), ship('tie-fighter', 'average')];

  it('waits for the chooser alone, who buys both forces in one go', () => {
    const game = make();
    expect(game.purchase!.chooser).toBe(0);
    expect(waitingFor(game)).toEqual([0]);
    expect(applyCommand(game, { type: 'buyBoth', player: 0, ships: [rebels, empire] }).ok).toBe(true);
    expect(game.phase).toBe('setup');
    expect(game.ships.map((s) => `${s.owner}:${s.typeId}`)).toEqual(['0:x-wing', '0:x-wing', '1:tie-interceptor', '1:tie-fighter']);
    expect(game.purchase!.chosen.map((f) => f!.ships.length)).toEqual([2, 2]);
    expect(waitingFor(game)).toEqual([0, 1]);
  });

  it('lets nobody else buy, and nobody buy singly', () => {
    const game = make();
    expect(applyCommand(game, { type: 'buyBoth', player: 1, ships: [rebels, empire] }).ok).toBe(false);
    expect(applyCommand(game, { type: 'buy', player: 0, ships: rebels }).ok).toBe(false);
    expect(applyCommand(game, { type: 'buy', player: 1, ships: empire }).ok).toBe(false);
    // and in an ordinary points game nobody may buy both
    const normal = createGame(scenarioOptions('points', 9, [30, 30]));
    expect(applyCommand(normal, { type: 'buyBoth', player: 0, ships: [rebels, empire] }).ok).toBe(false);
  });

  it('checks each side\'s force against that side\'s ships and points', () => {
    const game = make();
    const tooMuch = [ship('x-wing', 'hotshot'), ship('x-wing', 'hotshot')];
    const wrongSide = applyCommand(game, { type: 'buyBoth', player: 0, ships: [empire, empire] });
    expect(wrongSide.ok).toBe(false);
    const over = applyCommand(game, { type: 'buyBoth', player: 0, ships: [tooMuch, empire] });
    expect(over).toMatchObject({ ok: false });
    expect((over as { error: string }).error).toMatch(/^Rebels:/);
    expect(applyCommand(game, { type: 'buyBoth', player: 0, ships: [rebels, []] }).ok).toBe(false);
    expect(game.phase).toBe('forces');
  });

  it('can be played by the computer once the forces are chosen', () => {
    const game = make();
    applyCommand(game, { type: 'buyBoth', player: 0, ships: [rebels, empire] });
    playGame(game, [tacticalAi(createRng(1)), tacticalAi(createRng(2))], { maxCommands: 6000 });
    expect(game.phase).not.toBe('forces');
  }, 60000);
});

describe('capital ships and asteroids are never combined', () => {
  it('refuse an asteroid field in a scenario with a capital ship, but not without one', () => {
    const field = { density: 'sparse' as const, motion: 'drift' as const, chaos: 4 as const };
    for (const id of ['destroyers1', 'destroyers6', 'destroyers7', 'destroyers8']) {
      expect(() => createGame({ ...scenarioOptions(id, 1), asteroids: field })).toThrow(/Capital ships and asteroids/);
    }
    expect(() => createGame({ ...scenarioOptions('one', 1), asteroids: field })).not.toThrow();
  });

  it('do not let a force with an asteroid field include one', () => {
    expect(forceError(1, 200, [ship('star-destroyer', 'average')], true)).toMatch(/asteroid field/);
    expect(forceError(0, 200, [ship('nebulon-b', 'average')], true)).toMatch(/asteroid field/);
    expect(forceError(1, 200, [ship('star-destroyer', 'average')])).toBeNull();
    expect(forceError(1, 200, [ship('tie-fighter', 'average')], true)).toBeNull();
  });

  it('make the computer buy no capital ship when there is a field', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(buildForce(1, 300, createRng(seed), true).some((s) => isCapitalType(s.typeId))).toBe(false);
    }
    expect(Array.from({ length: 30 }, (_, i) => buildForce(1, 300, createRng(i + 1))).some((f) => f.some((s) => isCapitalType(s.typeId)))).toBe(true);
  });
});

describe('the larger map of the capital ship games', () => {
  const size = (g: { map: { cols: number; rows: number } }): [number, number] => [g.map.cols, g.map.rows];

  it('is used when a capital ship is in the game, and not otherwise', () => {
    for (const id of ['destroyers1', 'destroyers6', 'destroyers7', 'destroyers8']) expect(size(createGame(scenarioOptions(id, 1)))).toEqual([50, 68]);
    expect(size(createGame(scenarioOptions('one', 1)))).toEqual([33, 45]);
    expect(size(createGame(scenarioOptions('ground1', 1)))).toEqual([33, 45]);
  });

  it('keeps the map mode the player chose', () => {
    expect(createGame({ ...scenarioOptions('destroyers7', 1), map: { cols: 33, rows: 45, mode: 'static' } }).map).toEqual({ cols: 50, rows: 68, mode: 'static' });
    expect(createGame(scenarioOptions('destroyers7', 1)).map.mode).toBe('open');
  });

  it('has set-up areas half as big again, at the two ends of the map', () => {
    const g = createGame(scenarioOptions('destroyers7', 1));
    const rows = (zone: { q: number; r: number }[]): number[] => [...new Set(zone.map((h) => h.r + Math.floor(h.q / 2)))].sort((a, b) => a - b);
    expect(g.zones[0].length).toBe(26 * 13);
    expect(g.zones[1].length).toBe(26 * 13);
    expect(rows(g.zones[0])[0]).toBe(9);
    expect(rows(g.zones[1]).at(-1)).toBe(58);
  });

  it('comes with the forces in a points game when one of them has a capital ship', () => {
    const g = createGame(scenarioOptions('points', 1, [150, 150]));
    expect(size(g)).toEqual([33, 45]);
    applyCommand(g, { type: 'buy', player: 0, ships: [ship('x-wing', 'average')] });
    applyCommand(g, { type: 'buy', player: 1, ships: [ship('star-destroyer', 'average')] });
    expect(g.phase).toBe('setup');
    expect(size(g)).toEqual([50, 68]);
    expect(g.zones[1].length).toBe(26 * 13);
    const small = createGame(scenarioOptions('points', 1, [50, 50]));
    applyCommand(small, { type: 'buy', player: 0, ships: [ship('x-wing', 'average')] });
    applyCommand(small, { type: 'buy', player: 1, ships: [ship('tie-fighter', 'average')] });
    expect(size(small)).toEqual([33, 45]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createGame,
  fromOffset,
  getShip,
  parseGun,
  pilotFiredGuns,
  shipById,
  toHitNumber,
  type Facing,
  type GameState,
  type Hex,
} from '../src/engine';

/** A pilot may fire a gunner's weapon, like a fixed gun and only ahead (Rules: Gunners and turrets); the Lambda's rear-mounted one he cannot (Rules: Gunners and turrets). */
describe('turret guns fired by the pilot', () => {
  const guns = (id: string): string[] => pilotFiredGuns(getShip(id));

  it('gives the ships with turrets their turret guns, under their real codes', () => {
    expect(guns('millennium-falcon')).toEqual(['QMP', 'QMP']);
    expect(guns('stock-freighter')).toEqual(['DLP', 'DLP']);
    // the Y-wing's turret is an ion gun: it stays one
    expect(guns('y-wing-2seat')).toEqual(['DMF', 'DLP(I)']);
  });

  it('hits a pilot-fired turret like a fixed gun, and a gunner-fired one like the pivot gun it is', () => {
    const turret = parseGun('QMP');
    const fixed = parseGun('QMF');
    for (let range = 1; range <= 10; range++) {
      expect(toHitNumber(turret, range)).toBe(toHitNumber(fixed, range));
      expect(toHitNumber(turret, range, 'pilot')).toBe(toHitNumber(fixed, range));
    }
    expect([1, 2, 3, 4, 5].map((r) => toHitNumber(turret, r, 'gunner'))).not.toEqual([1, 2, 3, 4, 5].map((r) => toHitNumber(fixed, r)));
    // a ship's own guns are not changed by this
    expect(toHitNumber(parseGun('QLF'), 3, 'pilot')).toBe(toHitNumber(parseGun('QLF'), 3, 'gunner'));
  });

  it('leaves the Lambda\'s rear-mounted gun to its gunner, and ships without turrets as they were', () => {
    expect(guns('imperial-shuttle')).toEqual(['QLS', 'QMF']);
    expect(guns('x-wing')).toEqual(getShip('x-wing').pilotGuns);
    expect(guns('tie-fighter')).toEqual(getShip('tie-fighter').pilotGuns);
  });

  it('has a "to hit" number for every one of them at every range', () => {
    for (const id of ['millennium-falcon', 'stock-freighter', 'y-wing-2seat']) {
      for (const code of guns(id)) for (let range = 1; range <= 10; range++) expect(() => toHitNumber(parseGun(code), range)).not.toThrow();
    }
  });

  it('fires in the game: both turrets can shoot a target ahead, but not one behind', () => {
    const at = (col: number, row: number): Hex => fromOffset(col, row);
    // the Falcon faces north; one TIE is two hexes ahead of it, another two hexes behind
    const make = (): GameState => {
      const game = createGame({
        seed: 2,
        ships: [
          { owner: 0, typeId: 'millennium-falcon', quality: 'average' },
          { owner: 1, typeId: 'tie-fighter', quality: 'average' },
          { owner: 1, typeId: 'tie-fighter', quality: 'average' },
        ],
      });
      expect(shipById(game, 'P0-1')!.guns).toEqual(['QMP', 'QMP']);
      const place = (index: number, pos: Hex, facing: Facing): void => {
        game.ships[index]!.pos = pos;
        game.ships[index]!.facing = facing;
      };
      place(0, at(10, 20), 0);
      place(1, at(10, 18), 3);
      place(2, at(10, 22), 3); // facing the Falcon, so that it does not tail it
      game.phase = 'ships';
      game.turn = 1;
      game.initiative = 0;
      game.chooser = 0;
      for (const s of game.ships) s.speed = 0;
      expect(applyCommand(game, { type: 'chooseShip', player: 0, shipId: 'P0-1' }).ok).toBe(true);
      expect(applyCommand(game, { type: 'move', player: 0, shipId: 'P0-1', steps: [] }).ok).toBe(true);
      expect(game.active?.stage).toBe('fire');
      return game;
    };
    const ahead = make();
    expect(applyCommand(ahead, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-1' }, { gun: 1, target: 'P1-1' }] }).ok).toBe(true);
    expect(ahead.log.filter((e) => e.kind === 'fire')).toHaveLength(2);
    const behind = make();
    expect(applyCommand(behind, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun: 0, target: 'P1-2' }] }).ok).toBe(false);
  });
});

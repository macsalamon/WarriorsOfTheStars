import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, fromOffset, shipById, type GameState } from '../src/engine';

/** The 2-seat Y-wing fires one of its guns at a TIE fighter (no shields) two hexes ahead of it, in the Fire Segment. */
function volley(seed: number, gun: number): GameState {
  const game = createGame({
    seed,
    ships: [
      { owner: 0, typeId: 'y-wing-2seat', quality: 'hotshot' },
      { owner: 1, typeId: 'tie-fighter', quality: 'average' },
    ],
  });
  game.ships[0]!.pos = fromOffset(10, 20);
  game.ships[0]!.facing = 0;
  game.ships[1]!.pos = fromOffset(10, 19);
  game.ships[1]!.facing = 3;
  game.phase = 'ships';
  game.turn = 1;
  game.initiative = 0;
  game.chooser = 0;
  for (const s of game.ships) s.speed = 0;
  expect(applyCommand(game, { type: 'chooseShip', player: 0, shipId: 'P0-1' }).ok).toBe(true);
  expect(applyCommand(game, { type: 'move', player: 0, shipId: 'P0-1', steps: [] }).ok).toBe(true);
  expect(applyCommand(game, { type: 'fire', player: 0, shipId: 'P0-1', shots: [{ gun, target: 'P1-1' }] }).ok).toBe(true);
  return game;
}

describe('ion cannons', () => {
  const ionGun = 1; // the turret, DLP(I)
  const blaster = 0; // DMF

  it('never inflict body damage, not even through a power loss with no shield left', () => {
    let hits = 0;
    let shieldless = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const game = volley(seed, ionGun);
      const tie = shipById(game, 'P1-1')!;
      if (game.log.some((e) => e.kind === 'fire' && e.shot?.hit)) hits++;
      if (game.log.some((e) => /an ion cannon can.t do body damage/.test(e.text))) shieldless++;
      expect(tie.bodyDamage).toBe(0);
      expect(tie.wounds.filter((w) => w.kind === 'body')).toEqual([]);
      expect(tie.status).toBe('active');
    }
    expect(hits).toBeGreaterThan(50);
    expect(shieldless).toBeGreaterThan(0);
  });

  it('while the same power loss from a blaster does take a body point on a ship without shields', () => {
    let body = 0;
    for (let seed = 1; seed <= 400; seed++) body += shipById(volley(seed, blaster), 'P1-1')!.bodyDamage;
    expect(body).toBeGreaterThan(0);
  });
});

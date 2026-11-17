import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, emptyPlan, fromOffset, shipById, type GameState } from '../src/engine';

/** An X-wing that has planned a single snap fire, and a TIE fighter ahead of it. */
function scene(seed: number): GameState {
  const g = createGame({ seed, ships: [{ owner: 0, typeId: 'x-wing', quality: 'average' }, { owner: 1, typeId: 'tie-fighter', quality: 'average' }] });
  const x = shipById(g, 'P0-1')!;
  const t = shipById(g, 'P1-1')!;
  x.pos = fromOffset(10, 28);
  x.facing = 0;
  x.speed = 4;
  x.gunnerySkill = { dice: 12, pips: 0 };
  x.plan = { ...emptyPlan(), snapFire: 1 };
  t.pos = fromOffset(10, 22);
  t.facing = 3;
  t.speed = 0;
  g.phase = 'ships';
  g.turn = 1;
  g.placed = [true, true];
  g.chooser = 0;
  g.active = { queue: ['P0-1'], index: 0, chooser: 0, stage: 'move', waived: [] };
  return g;
}

const STEPS = [
  { kind: 'forward' as const },
  { kind: 'forward' as const },
  { kind: 'snapFire' as const, shots: [{ gun: 0, target: 'P1-1' }] },
  { kind: 'forward' as const },
  { kind: 'forward' as const },
];

describe('the damage of a snap shot', () => {
  it('is told with the step of the move it was fired in, though it is applied when the move is done', () => {
    let hurt = 0;
    let killed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = scene(seed);
      const r = applyCommand(g, { type: 'move', player: 0, shipId: 'P0-1', steps: STEPS });
      expect(r.ok).toBe(true);
      const target = shipById(g, 'P1-1')!;
      const wounds = target.wounds.filter((w) => w.moveStep !== undefined);
      for (const w of wounds) expect(w.moveStep).toBe(2);
      if (wounds.length > 0) hurt += 1;
      const dead = g.log.find((e) => e.kind === 'destroyed');
      if (dead) {
        killed += 1;
        expect(dead.shipId).toBe('P1-1');
        expect(dead.moveStep).toBe(2);
      }
      // the shot itself, and every line about it, belongs to the same step
      for (const e of g.log.filter((x) => x.shot)) expect(e.moveStep).toBe(2);
    }
    expect(hurt).toBeGreaterThan(0);
    expect(killed).toBeGreaterThan(0);
  });
});

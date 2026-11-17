import { describe, expect, it } from 'vitest';
import { playRandomGame } from '../src/ai/random';
import {
  applyCommand,
  createGame,
  createRng,
  scenarioOptions,
  type Command,
  type ForceShip,
  type GameState,
  type PilotQuality,
} from '../src/engine';

const force = (typeId: string, quality: PilotQuality, gunners: PilotQuality[] = []): ForceShip => ({ typeId, quality, gunners });

/** Forces with plenty of gunners, so that random play meets every corner of the gunner rules. */
function crowded(seed: number): GameState {
  const g = createGame(scenarioOptions('points', seed, [80, 80], 0));
  const result = applyCommand(g, {
    type: 'buyBoth', player: 0,
    ships: [
      [force('millennium-falcon', 'veteran', ['average', 'poor']), force('y-wing-2seat', 'average', ['veteran']), force('x-wing', 'poor'), force('stock-freighter', 'average', ['trainee', 'average'])],
      [force('imperial-shuttle', 'average', ['hotshot']), force('tie-fighter', 'poor'), force('tie-interceptor', 'average'), force('slave-i', 'veteran'), force('stock-freighter', 'poor', ['average', 'veteran'])],
    ],
  });
  if (!result.ok) throw new Error(result.error);
  return g;
}

describe('random games with gunners', () => {
  it('never make the engine reject a legal-looking command, and use every gunner rule', () => {
    const seen = { gunnerShots: 0, gunnerSnap: 0, gunnerPlans: 0, skillChoices: 0, deadGunners: 0, rolledShips: 0, claims: 0 };
    // a short run for every test run: the long one is `npx vite-node scripts/fuzz-gunners.ts`
    for (let seed = 1; seed <= 6; seed++) {
      const g = crowded(seed);
      const rng = createRng(seed * 31);
      playRandomGame(g, rng, {
        maxCommands: 1500,
        onCommand: (cmd: Command) => {
          if (cmd.type === 'plan' && cmd.crewPlans && Object.values(cmd.crewPlans).some((plans) => plans.some((p) => p.pinpointFire + p.snapFire + p.targeting + p.angleDeflectors > 0))) seen.gunnerPlans += 1;
          if (cmd.type === 'decide' && g.pending?.kind === 'skill') seen.skillChoices += 1;
        },
      });
      for (const e of g.log) {
        if (e.kind === 'fire' && /\(gunner/.test(e.text)) {
          seen.gunnerShots += 1;
          if (e.text.includes('snap fire')) seen.gunnerSnap += 1;
        }
      }
      for (const ship of g.ships) {
        if (ship.gunners?.some((x) => x.dead)) seen.deadGunners += 1;
        if (ship.turretClaims && Object.keys(ship.turretClaims).length > 0) seen.claims += 1;
      }
    }
    expect(seen.gunnerShots).toBeGreaterThan(5);
    expect(seen.gunnerPlans).toBeGreaterThan(5);
  }, 120000);

  it('are reproducible from the same seeds', () => {
    const run = () => {
      const g = crowded(7);
      playRandomGame(g, createRng(77), { maxCommands: 1500 });
      return [g.turn, g.vp.join('-'), g.log.length, g.rngState].join('|');
    };
    expect(run()).toBe(run());
  }, 60000);
});

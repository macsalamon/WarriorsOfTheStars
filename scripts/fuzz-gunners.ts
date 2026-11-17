/*
 * A long run of random games with gunners aboard: every command the random players give must be accepted by the engine.
 * Usage: npx vite-node scripts/fuzz-gunners.ts [games, default 40] [first seed, default 1]
 */
import { playRandomGame } from '../src/ai/random';
import { applyCommand, createGame, createRng, scenarioOptions, type ForceShip, type PilotQuality } from '../src/engine';

const force = (typeId: string, quality: PilotQuality, gunners: PilotQuality[] = []): ForceShip => ({ typeId, quality, gunners });
const games = Number(process.argv[2] ?? 40);
const first = Number(process.argv[3] ?? 1);
const seen = { games: 0, finished: 0, gunnerShots: 0, gunnerSnap: 0, deadGunners: 0 };

for (let seed = first; seed < first + games; seed++) {
  const g = createGame(scenarioOptions('points', seed, [80, 80], 0));
  const bought = applyCommand(g, {
    type: 'buyBoth', player: 0,
    ships: [
      [force('millennium-falcon', 'veteran', ['average', 'poor']), force('y-wing-2seat', 'average', ['veteran']), force('x-wing', 'poor'), force('stock-freighter', 'average', ['trainee', 'average'])],
      [force('imperial-shuttle', 'average', ['hotshot']), force('tie-fighter', 'poor'), force('tie-interceptor', 'average'), force('slave-i', 'veteran'), force('stock-freighter', 'poor', ['average', 'veteran'])],
    ],
  });
  if (!bought.ok) throw new Error(bought.error);
  try {
    playRandomGame(g, createRng(seed * 31), { maxCommands: 6000 });
  } catch (e) {
    console.log(`seed ${seed}: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    continue;
  }
  seen.games += 1;
  if (g.phase === 'over') seen.finished += 1;
  for (const e of g.log) {
    if (e.kind === 'fire' && /\(gunner/.test(e.text)) {
      seen.gunnerShots += 1;
      if (e.text.includes('snap fire')) seen.gunnerSnap += 1;
    }
  }
  seen.deadGunners += g.ships.filter((s) => s.gunners?.some((x) => x.dead)).length;
}
console.log(seen);

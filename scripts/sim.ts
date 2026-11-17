/**
 * Headless simulation: plays computer-vs-computer games and prints statistics.
 * Run with: npx vite-node scripts/sim.ts [games] [mix|all] [rebelsAi] [empireAi]
 *   AIs: tactical | basic (alias simple) | random   (default: tactical tactical)
 */
import { playGame, type Ai } from '../src/ai/player';
import { randomAi } from '../src/ai/random';
import { simpleAi } from '../src/ai/simple';
import { tacticalAi } from '../src/ai/tactical';
import { createGame, createRng, dogfightOptions, type DogfightMix, type Rng } from '../src/engine';

const games = Number(process.argv[2] ?? 100);
const mixArg = process.argv[3] ?? 'all';
const mixes: DogfightMix[] = mixArg === 'all' ? ['one', 'two', 'three', 'four'] : [mixArg as DogfightMix];
const kindOf = [process.argv[4] ?? 'tactical', process.argv[5] ?? 'tactical'];

const makeAi = (kind: string, rng: Rng): Ai => {
  if (kind === 'simple' || kind === 'basic') return simpleAi(rng);
  if (kind === 'tactical') return tacticalAi(rng);
  if (kind === 'random') return randomAi(rng);
  throw new Error(`Unknown AI: ${kind}`);
};

for (const mix of mixes) {
  const kinds = new Map<string, number>();
  const wins = { 0: 0, 1: 0, draw: 0, unfinished: 0 };
  let turns = 0;
  let finished = 0;
  let vp0 = 0;
  let vp1 = 0;
  const started = Date.now();
  for (let seed = 1; seed <= games; seed++) {
    const game = createGame(dogfightOptions(mix, seed));
    const ais: [Ai, Ai] = [makeAi(kindOf[0]!, createRng(seed * 104729)), makeAi(kindOf[1]!, createRng(seed * 15485863))];
    playGame(game, ais, { maxCommands: 8000 });
    for (const e of game.log) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    vp0 += game.vp[0];
    vp1 += game.vp[1];
    if (game.phase === 'over') {
      finished += 1;
      turns += game.turn;
      wins[game.winner as 0 | 1 | 'draw'] += 1;
    } else wins.unfinished += 1;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nMix ${mix} (${kindOf[0]} rebels vs ${kindOf[1]} empire): ${games} games in ${secs}s, ${finished} finished, avg ${(turns / Math.max(1, finished)).toFixed(1)} turns`);
  console.log(`  wins: rebels ${wins[0]}, empire ${wins[1]}, draws ${wins.draw}, unfinished ${wins.unfinished}; avg VP ${(vp0 / games).toFixed(1)} to ${(vp1 / games).toFixed(1)}`);
  const interesting = ['hazard', 'fire', 'destroyed', 'escaped', 'map', 'steal', 'pass', 'rules'];
  console.log('  events per game: ' + interesting.map((k) => `${k} ${((kinds.get(k) ?? 0) / games).toFixed(1)}`).join(', '));
}

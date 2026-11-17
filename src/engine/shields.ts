import { hexDistance } from './hex';
import { hasSideQuarters, quarterAgainst } from './game';
import type { ShieldBox } from './data';
import type { GameState, Ship } from './state';

const BOXES: readonly ShieldBox[] = ['front', 'rear', 'left', 'right'];

/**
 * Which way a computer player should angle one shield marker (Rules: Markers step; Advanced arcs), for a ship that can angle them left and right too: from the box with most
 * to spare to the box that is short, by where its enemies lie now (the side each would shoot at it from, the near ones and those that can already
 * hit it counting more). Null when the shields are placed about right, or there is no enemy to guard against.
 */
export function shieldMove(game: GameState, ship: Ship, enemies: Ship[]): { from: ShieldBox; to: ShieldBox } | null {
  if (!ship.pos || !hasSideQuarters(game, ship)) return null;
  const threat: Record<ShieldBox, number> = { front: 0, rear: 0, left: 0, right: 0 };
  for (const enemy of enemies) {
    if (!enemy.pos || enemy.status !== 'active') continue;
    const range = hexDistance(ship.pos, enemy.pos);
    if (range === 0 || range > 10) continue;
    threat[quarterAgainst(game, ship, enemy.pos)] += range <= 5 ? 2 : 1;
  }
  const total = BOXES.reduce((sum, b) => sum + threat[b], 0);
  if (total === 0) return null;
  const markers = BOXES.reduce((sum, b) => sum + ship.shields[b], 0);
  const want = (b: ShieldBox): number => (markers * threat[b]) / total;
  const short = [...BOXES].sort((a, b) => want(b) - ship.shields[b] - (want(a) - ship.shields[a]));
  const to = short[0]!;
  const from = [...BOXES].filter((b) => b !== to && ship.shields[b] > 0).sort((a, b) => want(a) - ship.shields[a] - (want(b) - ship.shields[b]))[0];
  if (!from) return null;
  // worth a marker only when the short box lacks a whole one and the other holds at least half a marker too many
  return want(to) - ship.shields[to] >= 1 && ship.shields[from] - want(from) >= 0.5 ? { from, to } : null;
}

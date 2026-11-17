import type { Hex } from '../engine';

/** Where a counter sits inside its hex when several ships share it: an offset in hex radii from the centre, and a size. */
export interface Slot {
  dx: number;
  dy: number;
  k: number;
}

/**
 * Lays out the ships that share a hex side by side: two in a row, three in a triangle, four in a square, more
 * on a ring. Ships alone in their hex get no slot. The order inside a hex follows the ship ids, so a stack
 * keeps its arrangement from one redraw to the next.
 */
export function stackSlots(ships: { id: string; pos: Hex | null }[]): Map<string, Slot> {
  const byHex = new Map<string, string[]>();
  for (const s of ships) {
    if (!s.pos) continue;
    const key = `${s.pos.q},${s.pos.r}`;
    byHex.set(key, [...(byHex.get(key) ?? []), s.id]);
  }
  const slots = new Map<string, Slot>();
  for (const ids of byHex.values()) {
    if (ids.length < 2) continue;
    ids.sort();
    const n = ids.length;
    ids.forEach((id, i) => {
      if (n === 2) slots.set(id, { dx: i === 0 ? -0.5 : 0.5, dy: 0, k: 0.52 });
      else if (n === 3) slots.set(id, { dx: [0, -0.55, 0.55][i]!, dy: [-0.55, 0.4, 0.4][i]!, k: 0.46 });
      else if (n === 4) slots.set(id, { dx: i % 2 === 0 ? -0.5 : 0.5, dy: i < 2 ? -0.5 : 0.5, k: 0.44 });
      else {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        slots.set(id, { dx: 0.62 * Math.cos(angle), dy: 0.62 * Math.sin(angle), k: 0.38 });
      }
    });
  }
  return slots;
}

export interface Disc {
  x: number;
  y: number;
  r: number;
}

/**
 * Where to put a floating box of `box` size inside a view of `view` size so that it hides as few ships as
 * possible, close to the ship the player is working on (`focus`) and never on top of it. Every ship is a
 * disc; the view is searched on a grid and the best spot wins: fewest ships covered, then nearest.
 */
export function choosePanelSpot(
  view: { w: number; h: number },
  box: { w: number; h: number },
  focus: Disc,
  ships: Disc[],
  margin = 8,
  /** Smaller things to keep clear if possible (the hexes of the ship's firing arc), each worth less than a ship. */
  avoid: Disc[] = [],
): { x: number; y: number } {
  const maxX = Math.max(margin, view.w - box.w - margin);
  const maxY = Math.max(margin, view.h - box.h - margin);
  const step = 16;
  const covers = (x: number, y: number, d: Disc): boolean => {
    const nx = Math.min(Math.max(d.x, x), x + box.w);
    const ny = Math.min(Math.max(d.y, y), y + box.h);
    return (d.x - nx) ** 2 + (d.y - ny) ** 2 < d.r ** 2;
  };
  let best = { x: margin, y: margin };
  let bestScore = Infinity;
  for (let y = margin; y <= maxY + step; y += step) {
    for (let x = margin; x <= maxX + step; x += step) {
      const px = Math.min(x, maxX);
      const py = Math.min(y, maxY);
      let score = 0;
      if (covers(px, py, focus)) score += 100000;
      for (const s of ships) if (covers(px, py, s)) score += 1000;
      for (const d of avoid) if (covers(px, py, d)) score += 100;
      // near the ship being planned: distance from the ship to the box
      const nx = Math.min(Math.max(focus.x, px), px + box.w);
      const ny = Math.min(Math.max(focus.y, py), py + box.h);
      score += Math.hypot(focus.x - nx, focus.y - ny);
      if (score < bestScore) {
        bestScore = score;
        best = { x: px, y: py };
      }
    }
  }
  return best;
}

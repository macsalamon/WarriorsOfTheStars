import type { PlayerId } from '../engine';

/** Which colour each side wears, chosen in the menu. "You" is whoever plays at this computer. */
export type Scheme = 'me-blue' | 'me-red' | 'rebels-blue' | 'rebels-red';

/** `blue` and `red` are who wears each colour, as the menu card names them. */
export const SCHEMES: { id: Scheme; blue: string; red: string; hint: string }[] = [
  { id: 'me-blue', blue: 'You', red: 'Opponent', hint: 'Your ships are blue and the opponent’s red, whichever side you play' },
  { id: 'me-red', blue: 'Opponent', red: 'You', hint: 'Your ships are red and the opponent’s blue, whichever side you play' },
  { id: 'rebels-blue', blue: 'Rebels', red: 'Empire', hint: 'Rebels are always blue and the Empire red' },
  { id: 'rebels-red', blue: 'Empire', red: 'Rebels', hint: 'Rebels are always red and the Empire blue' },
];

export const BLUE = { fill: '#4fc3f7', text: '#4fc3f7' };
export const RED = { fill: '#ef5350', text: '#ff7b78' };

/** The fill of each side's ships and counters, by player. Changed by `applyColours`, so read it when drawing. */
export const SIDE_COLORS: [string, string] = [BLUE.fill, RED.fill];

const STORE_KEY = 'star-warriors.colours';

export function loadScheme(): Scheme {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (SCHEMES.some((s) => s.id === saved)) return saved as Scheme;
  } catch {
    /* storage can be blocked */
  }
  return 'me-blue';
}

export function saveScheme(scheme: Scheme): void {
  try {
    localStorage.setItem(STORE_KEY, scheme);
  } catch {
    /* storage can be blocked */
  }
}

/** Whether the given player is blue under the scheme, when `human` is the player at this computer. */
export const isBlue = (scheme: Scheme, human: PlayerId, player: PlayerId): boolean => {
  switch (scheme) {
    case 'me-blue': return player === human;
    case 'me-red': return player !== human;
    case 'rebels-blue': return player === 0;
    case 'rebels-red': return player === 1;
  }
};

/** Sets the colours the board, the sheets and the log use for each side. */
export function applyColours(scheme: Scheme, human: PlayerId): void {
  const root = document.documentElement;
  ([0, 1] as PlayerId[]).forEach((p) => {
    const c = isBlue(scheme, human, p) ? BLUE : RED;
    SIDE_COLORS[p] = c.fill;
    root.style.setProperty(`--p${p}-text`, c.text);
  });
}

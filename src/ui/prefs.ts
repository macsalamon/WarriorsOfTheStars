/** Small on/off choices of the player, remembered by the browser. */
export function loadFlag(key: string, fallback = false): boolean {
  try {
    const saved = localStorage.getItem(`star-warriors.${key}`);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    /* storage can be blocked */
  }
  return fallback;
}

export function loadNumber(key: string, fallback = 0): number {
  try {
    const saved = Number(localStorage.getItem(`star-warriors.${key}`));
    if (Number.isInteger(saved)) return saved;
  } catch {
    /* storage can be blocked */
  }
  return fallback;
}

export function saveNumber(key: string, value: number): void {
  try {
    localStorage.setItem(`star-warriors.${key}`, String(value));
  } catch {
    /* storage can be blocked */
  }
}

/** A larger choice (the menu's), kept as one piece of JSON; null when there is none or it cannot be read. */
export function loadJson(key: string): Record<string, unknown> | null {
  try {
    const saved = localStorage.getItem(`star-warriors.${key}`);
    const value: unknown = saved ? JSON.parse(saved) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(`star-warriors.${key}`, JSON.stringify(value));
  } catch {
    /* storage can be blocked */
  }
}

export function saveFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(`star-warriors.${key}`, on ? '1' : '0');
  } catch {
    /* storage can be blocked */
  }
}

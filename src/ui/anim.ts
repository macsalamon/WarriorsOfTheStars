/** Playback speed of the turn animations, chosen in the menu. */
export type Speed = 'off' | 'fast' | 'normal' | 'slow';

export const SPEEDS: { id: Speed; label: string; factor: number; hint: string }[] = [
  { id: 'off', label: 'Off', factor: 0, hint: 'No animation: every move happens at once' },
  { id: 'fast', label: 'Fast', factor: 0.5, hint: 'Quick moves and shots' },
  { id: 'normal', label: 'Normal', factor: 1, hint: 'Easy to follow' },
  { id: 'slow', label: 'Slow', factor: 1.8, hint: 'Take your time to see what happens' },
];

const STORE_KEY = 'star-warriors.speed';

export function loadSpeed(): Speed {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (SPEEDS.some((s) => s.id === saved)) return saved as Speed;
  } catch {
    /* storage can be blocked */
  }
  return 'normal';
}

export function saveSpeed(speed: Speed): void {
  try {
    localStorage.setItem(STORE_KEY, speed);
  } catch {
    /* storage can be blocked */
  }
}

/** The animation clock: how fast time runs, and whether the player has asked to skip the rest. */
export const clock = { factor: 1, skip: false };

export const setSpeed = (speed: Speed): void => {
  clock.factor = SPEEDS.find((s) => s.id === speed)?.factor ?? 1;
};

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * Run `frame(t)` for `ms` (scaled by the playback speed), with t going from 0 to 1. The last frame is
 * always t = 1, also when the animation is skipped or the page is in the background and the browser
 * has stopped drawing frames.
 */
export function tween(ms: number, frame: (t: number) => void, ease: (t: number) => number = (t) => t): Promise<void> {
  const duration = ms * clock.factor;
  if (duration <= 0 || clock.skip) {
    frame(1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      frame(1);
      resolve();
    };
    const step = (now: number): void => {
      if (done) return;
      if (clock.skip) return finish();
      const t = Math.min(1, (now - start) / duration);
      if (t >= 1) return finish();
      frame(ease(t));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(finish, duration + 60);
  });
}

export const pause = (ms: number): Promise<void> => tween(ms, () => undefined);

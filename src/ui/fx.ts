import { clock } from './anim';

/*
 * Effects from the Fate of the Galaxy animations (public/assets/fx, made by tools/fx-pack.mjs; see CREDITS.md): explosions, hit flashes and
 * puffs, and the streaks that are the bolts. They are frames on black, so they are drawn on a canvas over the board with additive blending
 * ('lighter'): the black does not show. An effect lives at a point of the board, and is drawn where that point is on the screen whenever the
 * board is panned or zoomed.
 */

interface Sheet {
  image: HTMLImageElement;
  frames: number;
  cols: number;
  cw: number;
  ch: number;
  seconds: number;
}

/** How an effect looks at a moment of its life (t from 0 to 1): where, how large, turned how much, how bright, and which frame (by default, by time). */
export interface FxPose {
  x: number;
  y: number;
  /** Width and height in board pixels. */
  w: number;
  h: number;
  angle?: number;
  alpha?: number;
  frame?: number;
}

interface Live {
  sheet: Sheet;
  pose: (t: number) => FxPose;
  start: number;
  duration: number;
  resolve: () => void;
}

export interface FxView {
  tx: number;
  ty: number;
  scale: number;
}

export class Fx {
  private sheets = new Map<string, Sheet>();
  private live: Live[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private running = false;

  constructor(
    host: HTMLElement,
    private view: () => FxView,
    private size: () => { w: number; h: number },
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fxcanvas';
    this.ctx = this.canvas.getContext('2d');
    host.append(this.canvas);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.fit()).observe(host);
    this.fit();
    void this.load();
  }

  private fit(): void {
    const { w, h } = this.size();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** Fetches the list of effects and their pictures; effects that have not arrived (or are missing) are simply not shown. */
  private async load(): Promise<void> {
    try {
      const base = `${import.meta.env.BASE_URL}assets/fx/`;
      const meta = (await (await fetch(`${base}fx.json`)).json()) as Record<string, { file: string; frames: number; cols: number; cw: number; ch: number; seconds: number }>;
      for (const [name, m] of Object.entries(meta)) {
        const image = new Image();
        image.onload = () => this.sheets.set(name, { image, frames: m.frames, cols: m.cols, cw: m.cw, ch: m.ch, seconds: m.seconds });
        image.src = `${base}${m.file}`;
      }
    } catch {
      /* no effects: the board draws its plain ones */
    }
  }

  has(name: string): boolean {
    return this.sheets.has(name);
  }

  /** How long an effect plays, in seconds at normal speed. */
  seconds(name: string): number {
    return this.sheets.get(name)?.seconds ?? 0;
  }

  /**
   * Plays an effect. `pose` says where it is and how it looks at each moment; `seconds` overrides how long it lasts (the playback speed of
   * the game applies). The promise is kept when it has finished.
   */
  play(name: string, pose: (t: number) => FxPose, seconds?: number): Promise<void> {
    const sheet = this.sheets.get(name);
    const duration = (seconds ?? sheet?.seconds ?? 0) * 1000 * clock.factor;
    if (!sheet || duration <= 0 || clock.skip) return Promise.resolve();
    return new Promise((resolve) => {
      const live: Live = { sheet, pose, start: performance.now(), duration, resolve };
      this.live.push(live);
      this.run();
      // a page in the background draws no frames: the effect is over by the clock all the same
      setTimeout(() => {
        if (!this.live.includes(live)) return;
        this.live = this.live.filter((l) => l !== live);
        resolve();
      }, duration + 100);
    });
  }

  /** An effect that stays at one place of the board. */
  at(name: string, x: number, y: number, size: number, options: { seconds?: number; angle?: number; alpha?: number } = {}): Promise<void> {
    return this.play(name, () => ({ x, y, w: size, h: size, angle: options.angle, alpha: options.alpha }), options.seconds);
  }

  private run(): void {
    if (this.running) return;
    this.running = true;
    const step = (now: number): void => {
      this.draw(now);
      if (this.live.length > 0) requestAnimationFrame(step);
      else this.running = false;
    };
    requestAnimationFrame(step);
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    const { tx, ty, scale } = this.view();
    const done: Live[] = [];
    for (const fx of this.live) {
      const t = clock.skip ? 1 : Math.min(1, (now - fx.start) / fx.duration);
      if (t >= 1) {
        done.push(fx);
        continue;
      }
      const p = fx.pose(t);
      const sheet = fx.sheet;
      const position = p.frame ?? t * (sheet.frames - 1);
      const base = Math.min(sheet.frames - 1, Math.max(0, Math.floor(position)));
      const next = Math.min(sheet.frames - 1, base + 1);
      const mix = position - base;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx + dpr * scale * p.x, dpr * ty + dpr * scale * p.y);
      ctx.rotate(p.angle ?? 0);
      // two neighbouring frames, so that the thinned animation still runs smoothly
      for (const [index, weight] of [[base, 1 - mix], [next, mix]] as const) {
        if (weight <= 0.001) continue;
        ctx.globalAlpha = (p.alpha ?? 1) * weight;
        ctx.drawImage(sheet.image, (index % sheet.cols) * sheet.cw, Math.floor(index / sheet.cols) * sheet.ch, sheet.cw, sheet.ch, -p.w / 2, -p.h / 2, p.w, p.h);
      }
    }
    ctx.globalAlpha = 1;
    if (done.length > 0) {
      this.live = this.live.filter((l) => !done.includes(l));
      for (const l of done) l.resolve();
    }
  }
}

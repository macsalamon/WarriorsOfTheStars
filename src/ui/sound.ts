import { clock } from './anim';
import { loadJson, saveJson } from './prefs';
import { SOUNDS, busOf, engineSound, pickedFiles, type Bus } from './soundmap';

/*
 * The sounds of the game (Web Audio). What plays when is in data/sounds.json (see soundmap.ts); the files are in public/assets/sounds
 * (made by tools/sound-pack.mjs from the Fate of the Galaxy sounds; see CREDITS.md). A sound that is missing, or a browser without
 * audio, is silence: nothing here may ever stop the game.
 *
 * Browsers allow sound only after the player has clicked or pressed a key, so the audio starts with the first click.
 */

export interface SoundSettings {
  muted: boolean;
  master: number;
  effects: number;
  engines: number;
  interface: number;
}

const DEFAULTS: SoundSettings = { muted: false, master: 0.8, effects: 1, engines: 1, interface: 0.6 };
const SETTINGS_VERSION = 2;
const BUSES: readonly Bus[] = ['effects', 'engines', 'interface'];
const unit = (value: unknown, fallback: number): number => (typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback);

function loadSettings(): SoundSettings {
  const saved = loadJson('sound');
  return {
    muted: saved?.muted === true,
    master: unit(saved?.master, DEFAULTS.master),
    effects: unit(saved?.effects, DEFAULTS.effects),
    // settings kept before the cockpit loops followed the ship's speed had the engines at 60%: those start again at full
    engines: saved?.v === SETTINGS_VERSION ? unit(saved?.engines, DEFAULTS.engines) : DEFAULTS.engines,
    interface: unit(saved?.interface, DEFAULTS.interface),
  };
}

interface Loop {
  id: string;
  /** How loud it plays, on top of the entry's own volume. */
  level: number;
  /** How fast it plays (1: as recorded): its pitch. */
  rate: number;
  gain: GainNode | null;
  source: AudioBufferSourceNode | null;
}

/** Where a buffer really starts and ends: MP3 files carry a little silence at both ends, which would click in a loop. */
function soundingPart(buffer: AudioBuffer): { start: number; end: number } {
  const data = buffer.getChannelData(0);
  let first = 0;
  let last = data.length - 1;
  while (first < last && Math.abs(data[first]!) < 0.002) first++;
  while (last > first && Math.abs(data[last]!) < 0.002) last--;
  return { start: first / buffer.sampleRate, end: (last + 1) / buffer.sampleRate };
}

class SoundPlayer {
  readonly settings: SoundSettings = loadSettings();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  private buffers = new Map<string, AudioBuffer | null>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private lastPlayed = new Map<string, number>();
  private lastInterface = 0;
  private loops = new Map<string, Loop>();

  /** Call once: the audio starts with the player's first click or key, and the buttons get their clicks. */
  install(): void {
    if (typeof window === 'undefined') return;
    const start = (): void => this.unlock();
    window.addEventListener('pointerdown', start, { capture: true });
    window.addEventListener('keydown', start, { capture: true });
    // after the button's own handler, so that a more telling sound of that handler wins (see `play`)
    document.addEventListener('click', (e) => {
      const button = e.target instanceof Element ? e.target.closest('button') : null;
      if (!button || button.disabled) return;
      this.play(button.classList.contains('primary') ? 'ui.commit' : 'ui.click');
    });
    // a page in the background is quiet
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend().catch(() => undefined);
      else void this.ctx.resume().catch(() => undefined);
    });
  }

  private unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        for (const bus of BUSES) {
          const gain = this.ctx.createGain();
          gain.connect(this.master);
          this.buses.set(bus, gain);
        }
        this.applyVolumes();
        // everything is small: fetch it all now, so that nothing is late the first time it is needed
        for (const file of pickedFiles()) void this.load(file);
      }
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null; // no audio in this browser
    }
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, now, 0.03);
    for (const bus of BUSES) this.buses.get(bus)?.gain.setTargetAtTime(this.settings[bus], now, 0.03);
  }

  /** Changes the settings and keeps them. */
  set(change: Partial<SoundSettings>): void {
    Object.assign(this.settings, change);
    saveJson('sound', { ...this.settings, v: SETTINGS_VERSION });
    this.applyVolumes();
  }

  private load(file: string): Promise<AudioBuffer | null> {
    const known = this.buffers.get(file);
    if (known !== undefined) return Promise.resolve(known);
    let pending = this.loading.get(file);
    if (!pending) {
      pending = fetch(`${import.meta.env.BASE_URL}assets/sounds/${file}.mp3`)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
        .then((data) => this.ctx!.decodeAudioData(data))
        .catch(() => null)
        .then((buffer) => {
          this.buffers.set(file, buffer);
          this.loading.delete(file);
          return buffer;
        });
      this.loading.set(file, pending);
    }
    return pending;
  }

  /**
   * Plays a moment of the sound table once. The same moment is not played twice within a moment's breath (a volley of six guns is one
   * sound), and one click makes one interface sound: the first that asks. Sounds of the animations are left out while the player skips.
   */
  play(id: string, options: { volume?: number } = {}): void {
    const ctx = this.ctx;
    const entry = SOUNDS.get(id);
    if (!ctx || !entry || entry.pick.length === 0 || this.settings.muted || ctx.state !== 'running') return;
    const bus = busOf(id);
    if (bus !== 'interface' && clock.skip) return;
    const now = performance.now();
    if (bus === 'interface') {
      if (now - this.lastInterface < 60) return;
      this.lastInterface = now;
    } else if (now - (this.lastPlayed.get(id) ?? -1000) < 70) return;
    this.lastPlayed.set(id, now);
    const file = entry.pick[Math.floor(Math.random() * entry.pick.length)]!;
    const volume = (entry.volume ?? 1) * (options.volume ?? 1);
    void this.load(file).then((buffer) => {
      // a sound that had to be fetched first and is late is better left out
      if (!buffer || performance.now() - now > 400) return;
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        // the same shot never sounds quite the same twice
        if (bus === 'effects') source.playbackRate.value = 0.96 + Math.random() * 0.08;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.connect(gain).connect(this.buses.get(bus)!);
        source.start();
      } catch {
        /* a sound that cannot play is silence */
      }
    });
  }

  /** Starts, changes or (with null) stops one of the looped sounds, with a short fade; `level` is how loud, on top of the entry's own volume. */
  private loop(key: string, id: string | null, fadeIn: number, fadeOut: number, level = 1, rate = 1): void {
    const ctx = this.ctx;
    const old = this.loops.get(key);
    if (old?.id === id) {
      // the same loop, louder or softer
      if (old && id && (old.level !== level || old.rate !== rate)) {
        old.level = level;
        old.rate = rate;
        if (ctx && old.gain) old.gain.gain.setTargetAtTime((SOUNDS.get(id)?.volume ?? 1) * level, ctx.currentTime, 0.15);
        if (ctx && old.source) old.source.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.15);
      }
      return;
    }
    if (old) {
      this.loops.delete(key);
      if (ctx && old.gain && old.source) {
        const t = ctx.currentTime;
        old.gain.gain.cancelScheduledValues(t);
        old.gain.gain.setTargetAtTime(0, t, fadeOut / 3);
        try { old.source.stop(t + fadeOut * 2); } catch { /* already stopped */ }
      }
    }
    const entry = id ? SOUNDS.get(id) : undefined;
    if (!ctx || !id || !entry || entry.pick.length === 0) return;
    const mine: Loop = { id, level, rate, gain: null, source: null };
    this.loops.set(key, mine);
    void this.load(entry.pick[0]!).then((buffer) => {
      // stopped or changed while the file was on its way
      if (!buffer || this.loops.get(key) !== mine) return;
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const part = soundingPart(buffer);
        source.loopStart = part.start;
        source.loopEnd = part.end;
        source.playbackRate.value = mine.rate;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.gain.setTargetAtTime((entry.volume ?? 1) * mine.level, ctx.currentTime, fadeIn / 3);
        source.connect(gain).connect(this.buses.get('engines')!);
        source.start(0, part.start);
        mine.gain = gain;
        mine.source = source;
      } catch {
        this.loops.delete(key);
      }
    });
  }

  /** The soft cockpit hum of the ship being planned (a ship type), or none; `level` is how loud and `rate` its pitch (see `cockpitLevel`, `cockpitPitch`: they follow the planned speed). */
  cockpit(typeId: string | null, level = 1, rate = 1): void {
    this.loop('cockpit', typeId ? engineSound('cockpit', typeId) : null, 0.5, 0.4, level, rate);
  }

  /** The engines of the ship that is moving in the animation, heard from outside, or none. */
  external(typeId: string | null): void {
    this.loop('external', typeId && !clock.skip ? engineSound('external', typeId) : null, 0.12, 0.3);
  }
}

export const sound = new SoundPlayer();

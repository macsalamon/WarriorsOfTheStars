import './style.css';
import { tacticalAi } from '../ai/tactical';
import type { Ai } from '../ai/player';
import { applyCommand, createGame, createRng, dogfightOptions, emptyPlan, shipById, typeOf, waitingFor, type Command, type GameState, type MoveStep, type PlayerId } from '../engine';
import { clock, setSpeed, SPEEDS, type Speed } from '../ui/anim';
import { playCommand } from '../ui/playback';
import { sound } from '../ui/sound';
import { Board3D } from './board3d';

/*
 * The test page of the 3D board (3d.html): two computer players fight a dogfight with the real rules, and the 3D board shows it with the
 * same playback and sounds as the flat board. Nothing can be ordered here yet: it is for looking.
 */

const DISPLAY = 'display';

const MIXES: { id: string; label: string }[] = [
  { id: 'one', label: 'Three X-wings against four TIEs' },
  { id: 'two', label: 'Three A-wings against three interceptors' },
  { id: 'three', label: 'Two X-wings and a Y-wing against six TIE fighters' },
  { id: 'four', label: 'One X-wing against three TIE fighters' },
  { id: 'showcase', label: 'Every ship of the game' },
  { id: DISPLAY, label: 'Flying display: slides, a roll, turns and half loops' },
];

/**
 * The figure of the flying display: out with a slide to each side, a roll and a turn each way, a half loop, and the same back, which
 * brings the ship to where it started, facing as it did. It is flown outside the rules (no ship could plan all of it in one game-turn).
 */
const OUT: MoveStep[] = ['forward', 'slipLeft', 'forward', 'slipRight', 'forward', 'forward', 'turnRight', 'forward', 'turnLeft', 'forward'];
const FIGURE: MoveStep[] = [...OUT, 'halfLoop', ...OUT, 'halfLoop'];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) node.className = className;
  Object.assign(node, rest);
  node.append(...children);
  return node;
}

sound.install();
const root = document.getElementById('app3d')!;
const stage = el('div', { class: 'stage3d' });
root.append(stage);
const board = new Board3D(stage);

let game: GameState;
let ais: [Ai, Ai];
/** Each battle has a number: a battle that has been replaced stops playing. */
let battle = 0;
let paused = false;
let mix = 'one';
let speed: Speed = 'normal';
setSpeed(speed);

const state = el('span', { class: 'state' });
const log = el('div', { class: 'log3d' });
const toggle = (label: string, on: () => boolean, flip: () => void): HTMLButtonElement => {
  const button = el('button', { class: on() ? 'on' : '' }, label);
  button.onclick = () => {
    flip();
    button.className = on() ? 'on' : '';
  };
  return button;
};
const mixSelect = el('select', {}, ...MIXES.map((m) => el('option', { value: m.id }, m.label)));
mixSelect.onchange = () => {
  mix = mixSelect.value;
  start();
};
const speedSelect = el('select', {}, ...SPEEDS.filter((s) => s.id !== 'off').map((s) => el('option', { value: s.id, selected: s.id === speed }, `Speed: ${s.label}`)));
speedSelect.onchange = () => {
  speed = speedSelect.value as Speed;
  setSpeed(speed);
};
root.append(
  el('div', { class: 'bar3d' },
    el('b', {}, '3D BOARD TEST'),
    mixSelect,
    el('button', { onclick: () => start() }, 'New battle'),
    toggle('Pause', () => paused, () => (paused = !paused)),
    speedSelect,
    toggle('Camera follows', () => board.follow, () => (board.follow = !board.follow)),
    el('button', { onclick: () => board.fit(game.ships.flatMap((s) => (s.status === 'active' && s.pos ? [s.pos] : []))) }, 'Show all ships'),
    el('button', { onclick: () => board.view('top') }, 'From above'),
    el('button', { onclick: () => board.view('tilted') }, 'At an angle'),
    toggle('Sound', () => !sound.settings.muted, () => sound.set({ muted: !sound.settings.muted })),
    state,
  ),
  log,
  el('div', { class: 'hint3d' }, 'Drag: move the map · Right drag: turn the view · Wheel: zoom'),
);

function showState(): void {
  const left = (p: PlayerId): number => game.ships.filter((s) => s.owner === p && s.status === 'active').length;
  const over = game.phase === 'over' ? (game.winner === 'draw' || game.winner === null ? ' · Draw' : ` · ${game.winner === 0 ? 'The Rebels win' : 'The Empire wins'}`) : '';
  state.textContent = `Game-turn ${game.turn} · Rebels ${left(0)} · Empire ${left(1)}${over}`;
  log.replaceChildren(...game.log.filter((e) => !e.detail).slice(-5).map((e) => el('div', {}, e.text)));
}

function start(): void {
  const mine = ++battle;
  const seed = (Date.now() % 1_000_000) + 1;
  const display = mix === DISPLAY;
  game = createGame(dogfightOptions(display ? 'showcase' : mix, seed));
  ais = [tacticalAi(createRng(seed * 7919 + 13)), tacticalAi(createRng(seed * 104729 + 7))];
  clock.skip = false;
  board.reset();
  if (display) {
    // the computer players put the ships on the map; after that the ships fly the figure and the game stands still
    for (let guard = 0; guard < 50 && game.phase === 'setup'; guard++) {
      const cmd = waitingFor(game).map((p) => ais[p](game, p)).find((c) => c);
      if (!cmd || !applyCommand(game, cmd).ok) break;
    }
  }
  board.render({ game, selected: null });
  showState();
  void (display ? fly(mine) : run(mine));
}

/** The flying display: one ship after the other flies the figure, for as long as the page is open. */
async function fly(mine: number): Promise<void> {
  state.textContent = 'Flying display';
  log.replaceChildren();
  const ships = game.ships.filter((s) => s.status === 'active' && s.pos);
  for (let i = 0; ships.length > 0 && mine === battle; i = (i + 1) % ships.length) {
    while (paused && mine === battle) await sleep(120);
    const ship = ships[i]!;
    ship.plan = { ...emptyPlan(), roll: 1 };
    state.textContent = `Flying display · ${typeOf(ship).name}`;
    const cmd: Command = { type: 'move', player: ship.owner, shipId: ship.id, steps: FIGURE.map((kind) => ({ kind }) as { kind: Exclude<MoveStep, 'snapFire'> }) };
    await playCommand(board, game, cmd, [], game);
    if (mine !== battle) return;
    board.render({ game, selected: null });
    await sleep(700 * clock.factor);
  }
}

async function run(mine: number): Promise<void> {
  for (let guard = 0; guard < 20000 && mine === battle && game.phase !== 'over'; guard++) {
    if (paused) {
      await sleep(120);
      continue;
    }
    let cmd: Command | null = null;
    for (const p of waitingFor(game)) {
      cmd = ais[p](game, p);
      if (cmd) break;
    }
    if (!cmd) break;
    const visible = cmd.type === 'move' || (cmd.type === 'fire' && cmd.shots.length > 0);
    const before = visible ? structuredClone(game) : null;
    const logStart = game.log.length;
    const result = applyCommand(game, cmd);
    if (!result.ok) {
      state.textContent = `The computer player gave an order the game refused: ${result.error}`;
      return;
    }
    if (before) {
      const shown = await playCommand(board, before, cmd, game.log.slice(logStart), game);
      if (mine !== battle) return;
      // the damage the playback has not shown where it happened is shown now, as the flat board does
      for (const ship of game.ships) {
        const old = shipById(before, ship.id);
        if (!old?.pos) continue;
        const seen = new Set(shown.wounds.get(ship.id) ?? []);
        let slot = 0;
        ship.wounds.forEach((w, i) => {
          if (i >= old.wounds.length && !seen.has(i)) board.popup(old.pos!, w.text, `k-${w.kind}`, slot++);
        });
        if (old.status === 'active' && ship.status === 'destroyed' && !shown.destroyed.has(ship.id)) {
          board.popup(old.pos, 'DESTROYED', 'kill', slot);
          board.explode(old.pos, typeOf(old).body[0] >= 12);
        }
      }
    }
    board.render({ game, selected: null });
    showState();
    await sleep(before ? 450 * clock.factor : 0);
  }
  if (mine === battle) showState();
}

// handles for poking at the page from the browser console while developing
if (import.meta.env.DEV) Object.assign(window, { board3d: board, game3d: () => game });

// A browser lets a page make sound only after the player has clicked in it. A battle that began by itself would be silent until some
// later click, so the first battle waits for one.
const begin = el('div', { class: 'begin3d' });
begin.append(
  el('button', {
    class: 'on',
    onclick: () => {
      begin.remove();
      start();
    },
  }, 'Start'),
);
root.append(begin);

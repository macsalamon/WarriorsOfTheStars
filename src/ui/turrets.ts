import {
  GROUND_TARGET_BODY,
  GROUND_TARGET_POINTS,
  TURRET_BODY,
  TURRET_POINTS,
  TURRET_RANGE,
  actsAsSingle,
  turretName,
  turretPower,
  turretToHit,
  typeOf,
  type Emplacement,
  type GameState,
  type GroundTarget,
  type PlayerId,
} from '../engine';
import { h, s } from './dom';
import { SIDE_COLORS } from './colours';

/**
 * The turret guns are pictures of 3D models (see CREDITS.md), one for each of the six hex sides the gun can face, in public/assets/ships:
 * a single turret, a double one and a double one that has lost a barrel (Rules: Ground attack); the ground target is one picture. `r` is the radius of a hex.
 */
const TURRET_ART = {
  single: { file: 'turret-single', w: 415, h: 512, size: 1.9 },
  double: { file: 'turret-double', w: 345, h: 512, size: 2.2 },
  reduced: { file: 'turret-double-reduced', w: 345, h: 512, size: 2.2 },
};

const artOf = (turret: Pick<Emplacement, 'kind' | 'reduced'>): (typeof TURRET_ART)[keyof typeof TURRET_ART] =>
  turret.kind === 'single' ? TURRET_ART.single : turret.reduced ? TURRET_ART.reduced : TURRET_ART.double;

/** The picture for the turret's window (seen from the front and above). */
const turretFront = (turret: Pick<Emplacement, 'kind' | 'reduced'>): string => `${import.meta.env.BASE_URL}assets/ships/${artOf(turret).file}-front.png`;

/** A turret gun counter at the origin: a disc in its side's colour, and on it the picture of the gun, turned toward the way it faces. */
export function turretCounter(turret: Emplacement, facing: number = turret.facing, r = 26): SVGGElement {
  const colour = SIDE_COLORS[turret.owner];
  const g = s('g', { class: `turret ${turret.kind}${turret.reduced ? ' reduced' : ''}${turret.fired ? ' fired' : ''}` });
  g.append(s('circle', { r: r * (turret.kind === 'double' ? 0.92 : 0.78), class: 'tbase', stroke: colour }));
  const art = artOf(turret);
  const k = (r * art.size) / Math.max(art.w, art.h);
  const side = ((Math.round(facing) % 6) + 6) % 6;
  g.append(s('image', { href: `${import.meta.env.BASE_URL}assets/ships/${art.file}-f${side}.png`, x: (-art.w * k) / 2, y: (-art.h * k) / 2, width: art.w * k, height: art.h * k, class: 'tpicture' }));
  g.append(s('text', { class: 'turretlabel', y: r * 1.18 }, turret.id));
  return g;
}

/** The ground target: the round arena-like building of the Death Star surface model, with its ten body points as cells under it. */
export function groundCounter(target: GroundTarget, r = 26): SVGGElement {
  const colour = SIDE_COLORS[target.owner];
  const g = s('g', { class: 'groundtarget' });
  const w = r * 1.6;
  const h = (w * 475) / 512;
  g.append(
    s('circle', { r: r * 0.98, class: 'gtbase', stroke: colour }),
    s('image', { href: `${import.meta.env.BASE_URL}assets/ships/ground-target.png`, x: -w / 2, y: -h / 2, width: w, height: h, class: 'gtpicture' }),
  );
  const width = r * 1.5;
  const cell = width / GROUND_TARGET_BODY;
  const left = Math.max(0, GROUND_TARGET_BODY - target.damage);
  const tone = left / GROUND_TARGET_BODY > 0.5 ? 'good' : left / GROUND_TARGET_BODY > 0.25 ? 'warn' : 'bad';
  for (let i = 0; i < GROUND_TARGET_BODY; i++) {
    g.append(s('rect', { x: -width / 2 + i * cell, y: r * 0.98, width: Math.max(1.5, cell - 1.4), height: 4, rx: 1, class: `mb ${i < left ? tone : 'gone'}` }));
  }
  g.append(s('text', { class: 'turretlabel', y: r * 1.5 }, 'Ground target'));
  return g;
}

/** The ground target's window: what it is, how much it has left, and what shoots at it how. */
export function groundSheet(target: GroundTarget, human: PlayerId): HTMLElement {
  const left = Math.max(0, GROUND_TARGET_BODY - target.damage);
  return h('div', { class: 'sheet turretsheet' },
    h('div', { class: 'sheethead' },
      h('b', { style: { color: SIDE_COLORS[target.owner] } }, 'Ground target'),
      h('span', { class: 'sub' }, `${target.owner === human ? 'yours to defend' : 'to be destroyed'} · ${left} of ${GROUND_TARGET_BODY} body points left`),
    ),
    h('img', { class: 'turretpic', src: `${import.meta.env.BASE_URL}assets/ships/ground-target.png`, alt: '' }),
    h('ul', null,
      h('li', null, 'Only body damage hurts it. Shields, guns, engines and the rest don’t count.'),
      h('li', null, 'Guns have +10 difficulty against it. Missiles, torpedoes and bombs subtract its body rating (10) from the difficulty, as they do for any target, and their damage dice count as body damage.'),
      h('li', null, `Destroying it is worth ${GROUND_TARGET_POINTS} victory points.`),
    ),
  );
}

/** What the standing order of a turret says, in words. */
export function chanceText(chance: number | null, lastChance = 0): string {
  const last = lastChance > 0 ? `at ${lastChance}% or better` : 'at any shot that can hit';
  return chance === null ? `only at the last chance, ${last}` : `at once when the chance to hit is ${chance}% or more. Otherwise at the last chance, ${last}`;
}

/** The numbers of a turret gun, as in the ship window: the counter's to-hit numbers and the power at each range. */
export function turretSheet(game: GameState, turret: Emplacement, human: PlayerId): HTMLElement {
  const single = actsAsSingle(turret);
  const ranges = [1, 2, 3, 4, 5, 6];
  const mine = turret.owner === human;
  const row = (label: string, value: (range: number) => number | string): HTMLElement =>
    h('tr', null, h('th', null, label), ...ranges.map((range) => h('td', null, String(value(range)))));
  const tracked = turret.tracking ? game.ships.find((sh) => sh.id === turret.tracking!.target) : undefined;
  return h('div', { class: 'sheet turretsheet' },
    h('div', { class: 'sheethead' },
      h('b', { style: { color: SIDE_COLORS[turret.owner] } }, turretName(turret)),
      h('span', { class: 'sub' }, `${mine ? 'yours' : 'enemy'} · ${turret.status === 'active' ? `facing ${['↑', '↗', '↘', '↓', '↙', '↖'][turret.facing]}` : 'destroyed'}`),
    ),
    h('img', { class: 'turretpic', src: turretFront(turret), alt: '' }),
    h('p', null, turret.kind === 'double' && !turret.reduced
      ? 'A double turret gun, with two barrels. A gun hit (G) takes one barrel; a second one destroys it.'
      : turret.reduced ? 'A double turret gun that has lost a barrel. It fires like a single one.' : 'A single turret gun.'),
    h('table', { class: 'turrettable' },
      h('thead', null, h('tr', null, h('th', null, 'Range'), ...ranges.map((range) => h('th', null, range === 6 ? '6–10' : String(range))))),
      h('tbody', null,
        row('To hit', (range) => turretToHit(turret, range)),
        row('Power', (range) => turretPower(turret, range)),
      ),
    ),
    h('ul', null,
      h('li', null, `Fires once per game-turn into its forward centre arc, up to range ${TURRET_RANGE}, rolling ${turret.skill.dice}D against the shot difficulty.`),
      h('li', null, `Destroyed by ${TURRET_BODY} body damage in one shot, or by a gun hit (G) on a single turret. It then blows up and hurts every ship within 2 hexes. Worth ${turret.reduced ? TURRET_POINTS.single : TURRET_POINTS[turret.kind]} victory point${(turret.reduced ? TURRET_POINTS.single : TURRET_POINTS[turret.kind]) === 1 ? '' : 's'}.`),
      tracked ? h('li', null, `Tracking ${typeOf(tracked).name} #${tracked.idNumber}: shots at it are easier by ${turret.tracking!.level === 2 ? '10' : '5'}.`) : null,
      h('li', null, `Fires ${chanceText(turret.chance, turret.lastChance)}.${turret.fired ? ' Has fired this game-turn.' : ''}`),
    ),
  );
}

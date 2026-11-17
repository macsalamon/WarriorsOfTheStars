import {
  attackBoxes,
  canFire,
  canMove,
  destroyerMaxSpeed,
  destroyerMoveContext,
  destroyerShields,
  destroyerSpeedNow,
  hexId,
  hexesAtSpeed,
  specOf,
  speedText,
  structureLeft,
  type Destroyer,
  type GameState,
  type PlayerId,
} from '../engine';
import { SIDE_COLORS } from './colours';
import { h, type Child } from './dom';

const ARROWS = ['↑', '↗', '↘', '↓', '↙', '↖'];
const SIDE_NAMES = ['Rebel Alliance', 'Galactic Empire'] as const;

const skillText = (c: { dice: number; pips: number }): string => (c.pips ? `${c.dice}D+${c.pips}` : `${c.dice}D`);
const fmtTurn = (n: number): string => (n === 0.5 ? '½' : String(n));

/** Green while healthy, amber when half gone, red when nearly gone. Always read together with the number. */
const tone = (left: number, total: number): string => (total <= 0 ? 'good' : left / total > 0.5 ? 'good' : left / total > 0.25 ? 'warn' : 'bad');

function segments(count: number, cell: (i: number) => string): HTMLElement {
  return h('div', { class: 'segs' }, ...Array.from({ length: count }, (_, i) => h('i', { class: `seg ${cell(i)}` })));
}

function statRow(label: string, bar: Child, value: Child, title?: string): HTMLElement {
  return h('div', { class: 'srow', title }, h('span', { class: 'slabel' }, label), bar, h('span', { class: 'sval' }, value));
}

/** The picture for the ship's window: the model seen from the front and above (tools/assemble-destroyer.cjs). */
export const capitalPortraitUrl = (d: Destroyer): string => `${import.meta.env.BASE_URL}assets/ships/${specOf(d).kind}-front.png`;

/** How much bigger than a fighter's a capital ship's picture is in its window (1 fills the disc to 88%): 50% bigger, so it goes beyond the circle. */
const PORTRAIT_SCALE = 1.5;

function portraitDisc(d: Destroyer, color: string): HTMLElement {
  const frame = h('div', { class: 'portrait over' });
  frame.style.setProperty('--side', color);
  const img = h('img', { src: capitalPortraitUrl(d), alt: specOf(d).name });
  img.style.width = `${88 * PORTRAIT_SCALE}%`;
  img.style.height = `${88 * PORTRAIT_SCALE}%`;
  frame.append(img);
  return frame;
}

/** What the guns of a capital ship are, row by row, for the attack roll: "2 × TH + 1 × DM(I)". */
function attackTable(d: Destroyer): HTMLElement {
  const kind = specOf(d).kind;
  const rows = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((roll) => {
    const boxes = attackBoxes(roll, kind);
    return h('tr', null, h('th', null, String(roll)), h('td', null, boxes.length ? boxes.map((b) => `${b.count} × ${b.code}${b.ion ? ' (ion)' : ''}`).join(' + ') : 'no fire'));
  });
  return h('details', { class: 'attacktable' },
    h('summary', null, 'Attack table: which guns fire'),
    h('table', { class: 'turrettable' }, h('thead', null, h('tr', null, h('th', null, 'Roll'), h('th', null, 'Guns'))), h('tbody', null, h('tr', null, h('th', null, '2'), h('td', null, 'no fire')), ...rows)),
    h('p', { class: 'sub2' }, 'The roll is 2d6, 1 less if the fighter is straight ahead of the nose, 1 less if it has fired already this game-turn, 1 less for every hit on its guns. Every gun is an attack of its own against the fighter, rolled with the gunnery skill.'),
  );
}

/**
 * The window of a capital ship (Rules: Star Destroyers): what it is, how much structure and shield it has, how fast it goes and turns, what is wrong with it,
 * and what its guns and the guns against it do. `chosen` is the speed its owner is drawing a move for, when one is.
 */
export function capitalSheet(game: GameState, d: Destroyer, human: PlayerId, chosen?: number): HTMLElement {
  const spec = specOf(d);
  const color = SIDE_COLORS[d.owner];
  const left = structureLeft(d);
  const speed = destroyerSpeedNow(d);
  const moving = chosen !== undefined && chosen !== speed ? chosen : null;
  const shown = moving ?? speed;
  const ctx = destroyerMoveContext(d, shown);
  const shields = destroyerShields(d);
  const dead = d.lost >= spec.deadAt;
  const silent = d.lost >= spec.silentAt;

  const chips: HTMLElement[] = [];
  const chip = (text: string, cls: string, title?: string): void => void chips.push(h('span', { class: `chip ${cls}`, title }, text));
  if (d.exploded) chip('destroyed', 'bad', 'It blew up (chain reaction on the Vital Systems Hit Table).');
  else if (d.escaped) chip('escaped', 'plain', 'It flew off the edge of the map.');
  else if (dead) chip('dead in space', 'bad', 'It can neither move nor fire.');
  else if (silent) chip('guns out', 'bad', 'It can’t fire any more, but it still moves.');
  if (d.fireControl) chip('fire control damaged', 'bad', 'It can fire at fighters or at enemy capital ships, not both: at fighters while the other side has any.');
  if (d.noTurns) chip('steering damaged', 'bad', 'It can make no more turns.');
  if (d.speedLost) chip(`power −${d.speedLost}`, 'bad', `Its top speed is ${destroyerMaxSpeed(d)} now.`);
  if (d.gunsDamaged) chip(`guns −${d.gunsDamaged}`, 'bad', 'Every attack roll against fighters is that much worse.');
  if (d.outOfControl) chip(`out of control (${d.outOfControl})`, 'warn', 'The bridge is destroyed: it moves by the dice for this many more game-turns.');
  if (d.firedThisTurn) chip('has fired', 'plain', 'It has fired at a fighter this game-turn: its next attack roll is 1 worse.');
  if (d.moved) chip('moved', 'plain', 'It has moved this game-turn.');

  const identity = h('div', { class: 'ident' },
    h('div', { class: 'sidename', style: { color } }, SIDE_NAMES[d.owner]),
    h('div', { class: 'shipname' }, `${spec.name} #${d.idNumber}`),
    h('div', { class: 'sub2' }, `Capital ship · ${d.owner === human ? 'yours' : 'enemy'}${d.pos ? ` · nose at hex ${hexId(d.pos)} ${ARROWS[d.facing]}` : ' · off the map'}`),
    h('div', { class: 'dicerow', title: `Gunnery skill ${skillText(d.skill)}: every attack rolls that against its difficulty` },
      h('span', { class: 'slabel' }, 'Gunnery'),
      h('div', { class: 'dice' }, ...Array.from({ length: Math.max(6, d.skill.dice) }, (_, i) => h('i', { class: i < d.skill.dice ? 'die on' : 'die' }))),
      h('span', { class: 'sval' }, skillText(d.skill)),
    ),
  );

  const rows: HTMLElement[] = [
    statRow('Structure', segments(spec.structure, (i) => (i < left ? `full ${tone(left, spec.structure)}` : 'lost')), `${left}/${spec.structure}`,
      `Structure points left. With ${spec.silentAt} lost it can’t fire any more${spec.deadAt > spec.silentAt ? `, with ${spec.deadAt} it is dead in space` : ' and it is dead in space'}. A hit that does 2 or more body points takes one off.`),
    statRow('Shields', segments(spec.shields, (i) => (i < shields ? 'full shield' : 'lost')), `${shields}`,
      `${spec.shields} at the start, one less for every structure point lost. They take that much power off every gun hit (ion cannons do nothing to it).`),
    statRow('Speed', segments(spec.maxSpeed, (i) => `norm${i + 1 <= Math.ceil(shown) ? ' on' : ''}${i + 1 > destroyerMaxSpeed(d) ? ' lost' : ''}`),
      moving !== null ? `${speedText(speed)} → ${speedText(moving)}` : speedText(speed),
      `It moves ${hexesAtSpeed(shown)} hexes at this speed. It changes its speed by ${spec.speedStep === 1 ? 'one hex' : 'half a hex'} a game-turn (the speed is kept with the fraction, the hexes are rounded up).`),
  ];

  const tiles = h('div', { class: 'tiles' },
    h('div', { class: 'tile', title: 'Hexes it moves this game-turn' }, h('span', { class: 'tl' }, 'Moves'), h('b', null, `${hexesAtSpeed(shown)}`)),
    h('div', { class: 'tile', title: 'Turn number: how many forward hexes it needs before each turn of one hex side. At speed 0 it turns freely.' }, h('span', { class: 'tl' }, 'Turn number'), h('b', null, d.noTurns ? '—' : fmtTurn(ctx.turnNumber))),
    h('div', { class: 'tile', title: 'The most it can move' }, h('span', { class: 'tl' }, 'Top speed'), h('b', null, `${destroyerMaxSpeed(d)}`)),
  );

  const facts: (HTMLElement | null)[] = [
    h('li', null, `${spec.pattern.length} hexes. It moves by itself after the Markers step and fires at every fighter that moves within 10 hexes of it, once at each, at the best moment of the fighter’s move.`),
    h('li', null, spec.boxes === 'both' ? 'Both columns of the attack table: blasters and ion cannons.' : 'Only the first column of the attack table, no ion guns.'),
    h('li', null, `Against capital ships: it picks one enemy capital ship within ${spec.range} hexes (from any of its hexes to the nearest of the target’s), and then a die for every structure point it has left, each 6 takes one off it.`),
    h('li', null, `Missiles, torpedoes and bombs: its body rating is ${spec.bodyRating}, so their difficulty is ${spec.bodyRating} lower; the shields (${shields} now) are taken off the damage dice, and ${spec.special} or more body points in one shot take a structure point off it.`),
    h('li', null, spec.vp[0] === spec.vp[1] ? `Scores the other side ${spec.vp[1]} victory points when it is dead in space, ${spec.vp[2]} if it blows up.` : `Scores the other side ${spec.vp[0]} victory points when it can’t fire any more, ${spec.vp[1]} when it is dead in space and ${spec.vp[2]} if it blows up.`),
    canFire(d) || canMove(d) ? null : h('li', null, 'It is out of the fight.'),
  ].filter((x) => x !== null);

  const sheet = h('section', { class: `sheet side${d.owner}` },
    h('div', { class: 'sheettop' }, h('div', { class: 'portraitcol cap' }, h('div', { class: 'portraitwrap' }, portraitDisc(d, color))), identity),
    chips.length ? h('div', { class: 'chips' }, ...chips) : null,
    h('div', { class: 'stats2' }, ...rows),
    tiles,
    h('ul', { class: 'capfacts' }, ...facts),
    attackTable(d),
  );
  sheet.style.setProperty('--side', color);
  void game;
  return sheet;
}

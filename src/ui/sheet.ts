import { GROUND_TARGET_ID, activeShips, bodyRating, hasSideQuarters, hexId, PLAN_ACTIONS, PLAN_LABELS, SPECIAL_NAMES, allGuns, specialOf, tails, turretName, typeOf, type GameState, type Ship, type Wound } from '../engine';
import { SHORT_NAMES, portraitUrl } from './board';
import { SIDE_COLORS } from './colours';
import { crewOf, type CrewMember } from './crew';
import { h, type Child } from './dom';
import { gunTable, specialTable, tipOn } from './guntable';

/** Current speed and turn number, and what the plan being drawn up would give. */
export interface SheetMotion {
  speed: number;
  turn: number;
  planned: { speed: number; turn: number } | null;
}

const ARROWS = ['↑', '↗', '↘', '↓', '↙', '↖'];
const SIDE_NAMES = ['Rebel Alliance', 'Galactic Empire'] as const;
const QUALITY_NAMES: Record<string, string> = { trainee: 'Trainee', poor: 'Poor', average: 'Average', veteran: 'Veteran', hotshot: 'Hot-shot' };

const WOUND_ICONS: Record<Wound['kind'], string> = {
  body: '◼',
  shield: '◈',
  engine: '⚙',
  gun: '⌖',
  lateral: '↔',
  stabilizer: '⟳',
  penalty: '⚠',
  pilot: '☻',
  speed: '⇅',
  roll: '↻',
  turn: '⟲',
  lose: '✖',
  aux: '⚡',
  r2: '◉',
  repair: '✚',
};

const fmtTurn = (n: number): string => (n === 0.5 ? '½' : String(n));
const skillText = (c: { dice: number; pips: number }): string => (c.pips ? `${c.dice}D+${c.pips}` : `${c.dice}D`);
const shortName = (s: Ship): string => `${SHORT_NAMES[s.typeId] ?? '?'}${s.idNumber}`;
const fullName = (s: Ship): string => `${typeOf(s).name} #${s.idNumber}`;

/** Green while healthy, amber when half gone, red when nearly gone. Always read together with the number. */
const tone = (left: number, total: number): string => (total <= 0 ? 'good' : left / total > 0.5 ? 'good' : left / total > 0.25 ? 'warn' : 'bad');

/** A row of small cells, each with its own state class. */
function segments(count: number, cell: (i: number) => string): HTMLElement {
  return h('div', { class: 'segs' }, ...Array.from({ length: count }, (_, i) => h('i', { class: `seg ${cell(i)}` })));
}

function statRow(label: string, bar: Child, value: Child, title?: string): HTMLElement {
  return h('div', { class: 'srow', title }, h('span', { class: 'slabel' }, label), bar, h('span', { class: 'sval' }, value));
}

/** Makes the crew icons buttons: which one is chosen, and what a click on one does. */
export interface CrewPick {
  selected: string;
  onPick(crew: string): void;
  /** Crew members whose choice is confirmed (aiming). */
  done?: ReadonlySet<string>;
  /** Which crew members can be picked; all but R2 and the dead when missing. */
  enabled?: (crew: string) => boolean;
  /** Why a crew member cannot be picked right now, for the tooltip. */
  hint?: (crew: string) => string | undefined;
}

/** One gun as a chip in the aiming panel. */
export interface AimGunView {
  gun: number;
  code: string;
  state: 'off' | 'armed' | 'aimed';
  /** Who it is aimed at, when it is. */
  target?: string;
  /** Why it cannot be switched on, if it cannot. */
  locked?: string;
  /** For the missiles, torpedoes or bombs: how many tubes fire together, and how many there are. */
  tubes?: { count: number; max: number };
  title: string;
  /** The table of the gun (to hit and power at every range), shown while the pointer is over it. */
  tip?: () => HTMLElement;
}

/** One line of the aiming panel: what a gun is aimed at and the odds, with how the difficulty is made up (opened by clicking the line). */
export interface AimLine {
  key: string;
  text: string;
  why?: HTMLElement;
}

/** The lines of the aiming panel the player has closed (the breakdown is open by default). */
const closedLines = new Set<string>();

/** What the strip under the menu shows while a crew member aims (the sidebar only lists the targets). */
export interface AimView {
  kind: 'snap' | 'fire';
  crewLabel: string;
  /** Everybody who aims now, to switch between them (empty when only one does). */
  crews: { id: string; label: string; picture: string; selected: boolean; done: boolean }[];
  onCrew(id: string): void;
  guns: AimGunView[];
  /** One line for every aimed gun: "Gun 1 → TIE Fighter #1: 61% to hit". */
  lines: AimLine[];
  note: string;
  confirmed: boolean;
  canConfirm: boolean;
  /** "Fire", "Snap fire" or "Confirm", depending on whether this confirmation is the last one. */
  confirmLabel: string;
  onToggle(gun: number): void;
  onSwitchOff(gun: number): void;
  onTubes(count: number): void;
  onConfirm(): void;
  onHold(): void;
  onReopen(): void;
  /** The shared button that fires what everybody confirmed, when several crew members aim. */
  fire: { label: string; enabled: boolean; onClick(): void } | null;
  onCancel: (() => void) | null;
}

/** What the ship has to do or decide now (its move, a choice the game asks for), for the strip under the menu. */
export interface ActionPanel {
  title: string;
  /** The question or the one-line state. */
  lead?: string;
  buttons: { label: string; primary?: boolean; disabled?: boolean; title?: string; onClick(): void }[];
  /** Facts and explanations under the buttons. */
  body?: Child[];
}

/** The aiming panel: guns as chips to switch on and off, what they are aimed at, and the confirm buttons. */
export function aimPanel(v: AimView): HTMLElement {
  return h('div', { class: 'aimpanel' },
    h('div', { class: 'aimhead' }, `${v.kind === 'snap' ? 'Snap fire' : 'Fire'} · ${v.crewLabel}${v.confirmed ? ' ✓' : ''}`),
    v.crews.length > 1
      ? h('div', { class: 'aimcrew' }, ...v.crews.map((c) =>
        h('button', { class: `aimcrewbtn${c.selected ? ' sel' : ''}${c.done ? ' done' : ''}`, title: `${c.label}${c.done ? ' (confirmed)' : ''}`, onclick: () => v.onCrew(c.id) }, h('img', { src: c.picture, alt: c.label }))))
      : null,
    h('div', { class: 'aimguns' }, ...v.guns.map((g) => {
      const wrap = h('span', { class: 'gunwrap' },
        h('button', {
          class: `gunchip ${g.state}`,
          disabled: g.locked !== undefined || v.confirmed,
          ...(g.tip ? {} : { title: g.locked ?? g.title }),
          onclick: () => v.onToggle(g.gun),
        }, g.code, g.target ? h('span', { class: 'gunto' }, ` → ${g.target}`) : null),
        g.tubes && g.tubes.max > 1 && g.state !== 'off' && !v.confirmed
          ? h('button', { class: 'gunoff tubebtn', title: `Tubes fired together: ${g.tubes.count} of ${g.tubes.max}. Click to change`, onclick: () => v.onTubes(g.tubes!.count % g.tubes!.max + 1) }, `×${g.tubes.count}`)
          : null,
        g.state !== 'off' && !v.confirmed ? h('button', { class: 'gunoff', title: 'Switch this gun off', onclick: () => v.onSwitchOff(g.gun) }, '×') : null);
      if (g.tip) tipOn(wrap, g.tip);
      return wrap;
    })),
    ...v.lines.map((line) => line.why
      ? h('details', { class: 'aimline why', open: !closedLines.has(line.key), ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) closedLines.delete(line.key); else closedLines.add(line.key); } }, h('summary', null, line.text), line.why)
      : h('div', { class: 'aimline' }, line.text)),
    v.note ? h('div', { class: 'aimnote' }, v.note) : null,
    h('div', { class: 'aimbtns' },
      v.confirmed ? h('button', { onclick: () => v.onReopen() }, 'Change') : null,
      v.confirmed ? null : h('button', { class: 'primary', disabled: !v.canConfirm, onclick: () => v.onConfirm(), title: v.canConfirm ? '' : 'Aim every gun that is switched on, or switch it off' }, v.confirmLabel),
      v.confirmed ? null : h('button', { onclick: () => v.onHold(), title: 'This crew member doesn’t fire' }, 'Hold fire'),
      v.onCancel ? h('button', { onclick: () => v.onCancel!() }, 'Cancel') : null,
    ),
    v.fire ? h('button', { class: 'primary aimfire', disabled: !v.fire.enabled, onclick: () => v.fire!.onClick() }, v.fire.label) : null,
  );
}

/** The big picture of the ship, on a disc in its side's colour, with the crew's icons below it. */
function portrait(ship: Ship, pick?: CrewPick): HTMLElement {
  return h('div', { class: 'portraitcol' }, h('div', { class: 'portraitwrap' }, portraitDisc(ship)), crewRow(ship, pick));
}

/** One icon for each person aboard (at most three). They become the buttons that plan and fire for that person. */
function crewRow(ship: Ship, pick?: CrewPick): HTMLElement {
  const usable = (c: CrewMember): boolean => !!pick && c.kind !== 'r2' && !c.dead && (pick.enabled ? pick.enabled(c.id) : true);
  const describe = (c: CrewMember): string => {
    if (c.kind === 'r2') return 'R2 astromech unit';
    const skill = c.skill ? ` · gunnery ${skillText(c.skill)}` : '';
    return `${c.label}: ${QUALITY_NAMES[c.quality ?? ''] ?? c.quality ?? ''}${skill}`;
  };
  const gunners = ship.gunners?.length ?? 0;
  return h('div', { class: 'crewrow' }, ...crewOf(ship).map((c) =>
    h('div', {
      class: `crewicon ${c.kind}${c.dead ? ' dead' : ''}${usable(c) ? ' pickable' : ''}${pick?.selected === c.id ? ' sel' : ''}${pick?.done?.has(c.id) ? ' done' : ''}`,
      title: `${describe(c)}${c.dead ? ' (dead)' : ''}${usable(c) ? ' · click to choose this crew member' : pick?.hint?.(c.id) ? ` · ${pick.hint(c.id)}` : ''}`,
      'data-crew': c.id,
      onclick: usable(c) ? () => pick!.onPick(c.id) : undefined,
    },
      h('img', { src: c.picture, alt: c.label }),
      c.kind === 'gunner' && c.seat && gunners > 1 ? h('span', { class: 'seat' }, String(c.seat)) : null,
    )));
}

/** How large a ship's picture is in the ship window, against the others (1 fills the disc to 88%): a ship drawn larger may go beyond the circle. */
const PORTRAIT_SCALE: Record<string, number> = {
  'a-wing': 0.8,
  'b-wing': 1.2,
  'stock-freighter': 1.4,
  'millennium-falcon': 1.4,
  'imperial-shuttle': 1.4,
};

function portraitDisc(ship: Ship): HTMLElement {
  const color = SIDE_COLORS[ship.owner];
  const url = portraitUrl(ship.typeId);
  const fallback = h('span', { class: 'portrait-fallback' }, SHORT_NAMES[ship.typeId] ?? '?');
  const frame = h('div', { class: 'portrait' });
  frame.style.setProperty('--side', color);
  if (!url) {
    frame.append(fallback);
    return frame;
  }
  const img = h('img', { src: url, alt: fullName(ship) });
  const scale = PORTRAIT_SCALE[ship.typeId] ?? 1;
  if (scale !== 1) {
    img.style.width = `${88 * scale}%`;
    img.style.height = `${88 * scale}%`;
  }
  // a picture larger than the disc is not cut off by it
  if (scale > 1) frame.classList.add('over');
  img.addEventListener('error', () => img.replaceWith(fallback));
  frame.append(img);
  return frame;
}

function diceRow(label: string, code: { dice: number; pips: number }): HTMLElement {
  const slots = Math.max(6, code.dice);
  return h('div', { class: 'dicerow', title: `${label} skill ${skillText(code)}: roll ${code.dice} dice${code.pips ? ` and add ${code.pips}` : ''}` },
    h('span', { class: 'slabel' }, label),
    h('div', { class: 'dice' }, ...Array.from({ length: slots }, (_, i) => h('i', { class: i < code.dice ? 'die on' : 'die' }))),
    h('span', { class: 'sval' }, skillText(code)),
  );
}

function woundLine(w: Wound): HTMLElement {
  return h('div', { class: `wound k-${w.kind}` },
    h('span', { class: 'wturn' }, `T${w.turn}`),
    h('span', { class: 'wicon' }, WOUND_ICONS[w.kind]),
    h('span', { class: 'wtext' }, w.text),
    w.source ? h('span', { class: 'wsrc' }, w.source) : null,
  );
}

const SHOWN_WOUNDS = 7;

/** The projectiles a ship has left, as a chip beside its guns, when the rule for missiles, torpedoes and bombs is in effect (22). */
function ammoChips(ship: Ship): HTMLElement[] {
  const weapon = specialOf(typeOf(ship));
  if (!weapon || ship.projectiles === undefined) return [];
  const name = SPECIAL_NAMES[weapon.kind];
  const cls = ship.projectiles === 0 ? 'chip gun dead' : 'chip gun';
  const chip = h('span', { class: cls }, `${weapon.kind} ${ship.projectiles}`);
  tipOn(chip, () => specialTable(weapon.kind, `${weapon.tubes} tube${weapon.tubes === 1 ? '' : 's'}: ${ship.projectiles} of ${weapon.load} ${name} left. The pilot fires them.`));
  return [chip];
}

/** The record sheet for one ship: picture, pilot, hull, shields, speed, guns, markers and every hit it has taken. */
export function shipSheet(game: GameState, ship: Ship, motion: SheetMotion, pick?: CrewPick, showHex = false): HTMLElement {
  const type = typeOf(ship);
  const color = SIDE_COLORS[ship.owner];

  // ---- identity
  const chips: HTMLElement[] = [];
  const chip = (text: string, cls: string, title?: string): void => void chips.push(h('span', { class: `chip ${cls}`, title }, text));
  if (ship.moved) chip('moved', 'plain', 'This ship has moved this game-turn');
  if (ship.stabilizerDamage) chip(`stabilizer ×${ship.stabilizerDamage}`, 'bad', 'Stabilizer damage: adds to the difficulty of every plan');
  if (ship.lateralDamage) chip(`lateral ×${ship.lateralDamage}`, 'bad', 'Lateral control damage: the turn number is higher by 1 for every hit');
  if (ship.actionPenalty) chip(`action penalty +${ship.actionPenalty * 3}`, 'bad', 'Adds to this turn’s total difficulty');
  if (ship.pendingPenalty) chip(`penalty next turn +${ship.pendingPenalty * 3}`, 'warn', 'Takes effect when you plan the next game-turn');
  if (ship.forcedRoll) chip(`forced roll ×${ship.forcedRoll}`, 'warn', 'The ship has to roll next game-turn');
  if (ship.forcedOverspeed) chip(`forced overspeed ×${ship.forcedOverspeed}`, 'warn', 'The ship is above its maximum speed and has to plan overspeed');
  if (ship.tracking) {
    const id = ship.tracking.target;
    const other = game.ships.find((s) => s.id === id);
    const turret = game.emplacements?.find((e) => e.id === id);
    const name = other ? fullName(other) : id === GROUND_TARGET_ID ? 'the ground target' : turret ? turretName(turret) : id;
    chip(`tracking ${name}`, 'good', 'Tracking marker. Your shots at it are easier, but shots at you from other ships are easier too.');
  }
  if (game.damageRules) {
    const gone = ship.noRepair;
    const beyond = [gone?.body ? 'body' : '', gone?.engine ? 'engine' : '', gone?.lateral ? 'lateral' : '', gone?.stabilizer ? 'stabilizer' : '', ...Object.entries(gone?.guns ?? {}).filter(([, v]) => v).map(([i]) => `gun ${Number(i) + 1}`)].filter(Boolean);
    if (beyond.length) chip(`no repairs: ${beyond.join(', ')}`, 'bad', 'Damaged beyond repair by damage control');
  }

  const gunChips = allGuns(type).map((original, i) => {
    const now = ship.guns[i] ?? null;
    const turret = i >= type.pilotGuns.length ? (original.includes('(R)') ? ' Rear-mounted turret: only its gunner can fire it, into the rear arcs.' : ' Turret: a gunner can fire it in any direction. The pilot fires it like a fixed gun, forward only.') : '';
    const by = i >= type.pilotGuns.length ? 'both' : 'pilot';
    const chip = now === null ? h('span', { class: 'chip gun dead' }, original) : now !== original ? h('span', { class: 'chip gun hurt' }, `${original}→${now}`) : h('span', { class: 'chip gun' }, now);
    const state = now === null ? 'Destroyed.' : now !== original ? `Damaged: was ${original}.` : 'Working.';
    tipOn(chip, () => gunTable(now ?? original, by, `${state}${turret}`));
    return chip;
  });

  const identity = h('div', { class: 'ident' },
    h('div', { class: 'sidename', style: { color } }, SIDE_NAMES[ship.owner]),
    h('div', { class: 'shipname' }, fullName(ship)),
    h('div', { class: 'sub2' }, `${QUALITY_NAMES[ship.quality] ?? ship.quality} pilot${!ship.pos ? ' · off the map' : showHex ? ` · hex ${hexId(ship.pos)} ${ARROWS[ship.facing]}` : ''}`),
    diceRow('Piloting', ship.pilotSkill),
    diceRow('Gunnery', ship.gunnerySkill),
    h('div', { class: 'gunline' }, h('span', { class: 'slabel' }, 'Guns'), ...(gunChips.length ? gunChips : [h('span', { class: 'sub2' }, 'none')]), ...ammoChips(ship)),
  );

  // ---- hull and shields
  const hullTotal = bodyRating(game, type);
  const hullLeft = Math.max(0, hullTotal - ship.bodyDamage);
  const hullTone = tone(hullLeft, hullTotal);
  const rows: HTMLElement[] = [
    statRow('Hull', segments(hullTotal, (i) => (i < hullLeft ? `full ${hullTone}` : 'lost')), `${hullLeft}/${hullTotal}`, 'Body points left. The ship is destroyed when none are left.'),
  ];
  if (type.shields !== null) {
    const wide = hasSideQuarters(game, ship);
    rows.push(
      statRow('Front shield', segments(ship.shields.front, () => 'full shield'), `${ship.shields.front}`, wide ? 'Each marker takes away 1 point of power from shots from the forward centre arc.' : 'Each marker takes away 1 point of power from shots hitting the front half.'),
      statRow('Rear shield', segments(ship.shields.rear, () => 'full shield'), `${ship.shields.rear}`, wide ? 'Each marker takes away 1 point of power from shots from the rear centre arc.' : 'Each marker takes away 1 point of power from shots hitting the rear half.'),
    );
    if (wide) {
      rows.push(
        statRow('Left shield', segments(ship.shields.left, () => 'full shield'), `${ship.shields.left}`, 'Each marker takes away 1 point of power from shots from the forward left and rear left arcs.'),
        statRow('Right shield', segments(ship.shields.right, () => 'full shield'), `${ship.shields.right}`, 'Each marker takes away 1 point of power from shots from the forward right and rear right arcs.'),
      );
    }
  } else {
    rows.push(statRow('Shields', h('span', { class: 'sub2' }, 'none'), '–'));
  }

  // ---- auxiliary power and the R2 unit (16)
  if (game.damageRules) {
    if (type.auxPower) rows.push(statRow('Aux power', segments(type.auxPower, (i) => (i < (ship.aux ?? 0) ? 'full shield' : 'lost')), `${ship.aux ?? 0}`, 'Units of auxiliary power: each pays for one free step of an action in the planning phase. A spent unit is gone for good.'));
    if (type.r2) rows.push(statRow('R2 unit', h('span', { class: 'sub2' }, ship.r2?.aboard ? (ship.r2.ready ? 'ready for free actions' : 'busy: damage control only') : 'lost'), ship.r2?.aboard ? '✓' : '–', 'Rolled before planning: on 5 or less it can do a free action. It can always help with damage control.'));
  }

  // ---- speed and turning
  const top = type.speedMax + 2;
  const plannedSpeed = motion.planned ? motion.planned.speed : null;
  rows.push(
    statRow('Speed', segments(top, (i) => {
      const v = i + 1;
      const base = v > ship.maxSpeed + 2 ? 'lost' : v > ship.maxSpeed ? 'over' : 'norm';
      const filled = v <= motion.speed ? ' on' : '';
      const mark = plannedSpeed !== null && plannedSpeed !== motion.speed && v === plannedSpeed ? ' planned' : '';
      return `${base}${filled}${mark}`;
    }),
      plannedSpeed !== null && plannedSpeed !== motion.speed ? `${motion.speed} → ${plannedSpeed}` : `${motion.speed}`,
      `Maximum speed ${ship.maxSpeed}${ship.maxSpeed < type.speedMax ? ` (was ${type.speedMax}, engine damage)` : ''}. Hatched cells are overspeed.`),
  );

  const turnTiles = h('div', { class: 'tiles' },
    h('div', { class: 'tile', title: 'Turn number: how many forward hexes the ship needs before each turn of one hex side' }, h('span', { class: 'tl' }, 'Turn number'), h('b', null, fmtTurn(motion.turn))),
    motion.planned ? h('div', { class: 'tile planned' }, h('span', { class: 'tl' }, 'Planned'), h('b', null, fmtTurn(motion.planned.turn))) : null,
    h('div', { class: 'tile', title: 'Highest speed allowed without overspeed' }, h('span', { class: 'tl' }, 'Max speed'), h('b', null, String(ship.maxSpeed))),
  );

  // ---- relations and plan
  const tailing = activeShips(game).filter((e) => tails(ship, e)).map(shortName);
  const tailedBy = activeShips(game).filter((e) => tails(e, ship)).map(shortName);
  const revealed = game.phase === 'ships';
  const planned = revealed ? PLAN_ACTIONS.filter((a) => ship.plan[a] > 0).map((a) => `${PLAN_LABELS[a]}${ship.plan[a] === 2 ? ' ×2' : ''}`) : [];

  // ---- damage record
  const wounds = ship.wounds;
  const shown = wounds.slice(-SHOWN_WOUNDS).reverse();
  const damage = h('div', { class: 'damage' },
    h('div', { class: 'dmgtitle' }, 'Damage taken', h('span', { class: 'dmgcount' }, wounds.length ? `${wounds.length} hit${wounds.length === 1 ? '' : 's'}` : 'none')),
    wounds.length === 0 ? h('div', { class: 'sub2' }, 'Undamaged.') : null,
    ...shown.map(woundLine),
    wounds.length > shown.length ? h('div', { class: 'sub2' }, `+ ${wounds.length - shown.length} earlier`) : null,
  );

  const sheet = h('section', { class: `sheet side${ship.owner}` },
    h('div', { class: 'sheettop' }, portrait(ship, pick), identity),
    chips.length ? h('div', { class: 'chips' }, ...chips) : null,
    h('div', { class: 'stats2' }, ...rows),
    turnTiles,
    planned.length ? h('div', { class: 'relline' }, h('span', { class: 'slabel' }, 'Plan'), planned.join(', ')) : null,
    tailing.length ? h('div', { class: 'relline good' }, h('span', { class: 'slabel' }, 'Tailing'), tailing.join(', ')) : null,
    tailedBy.length ? h('div', { class: 'relline bad' }, h('span', { class: 'slabel' }, 'Tailed by'), tailedBy.join(', ')) : null,
    damage,
  );
  sheet.style.setProperty('--side', color);
  return sheet;
}

export function emptySheet(): HTMLElement {
  return h('section', { class: 'sheet empty' }, h('p', null, 'Hover over a ship on the board or in the list to see its record sheet: picture, pilot, hull, shields, speed, guns and the damage it has taken.'));
}

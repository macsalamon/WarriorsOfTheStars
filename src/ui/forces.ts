import {
  QUALITIES,
  QUALITY_NAMES,
  bonusPoints,
  describeForceShip,
  forceCost,
  forceError,
  forceShipCost,
  capitalSummary,
  getShip,
  gunnerCost,
  gunnerSlots,
  pilotCost,
  isCapitalType,
  purchasable,
  purchaseName,
  shipCost,
  type Force,
  type ForceShip,
  type PilotQuality,
  type PlayerId,
} from '../engine';
import { portraitUrl } from './board';
import { h, type Child } from './dom';

const SIDE_NAMES = ['Rebels', 'Empire'] as const;

/** The ship's picture, if it has one. */
function picture(typeId: string, size: number): HTMLElement {
  // a capital ship has the picture of its window, as every ship has
  const url = isCapitalType(typeId) ? `${import.meta.env.BASE_URL}assets/ships/${typeId}-front.png` : portraitUrl(typeId);
  const img = h('img', { class: 'fpic', src: url ?? '', alt: '', style: { width: `${size}px`, height: `${size}px` } });
  img.addEventListener('error', () => img.remove());
  return img;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A sentence about the bonus victory points that the unequal points give (Rules: Scenarios), or an empty string. */
export function bonusText(limits: [number, number]): string {
  const bonus = bonusPoints(limits);
  const side = bonus[0] ? 0 : bonus[1] ? 1 : null;
  if (side === null) return '';
  return `${side === 0 ? 'The Rebels have fewer points, so they start' : 'The Empire has fewer points, so it starts'} with ${plural(bonus[side], 'bonus victory point')}: one for every two points the other side has more.`;
}

export interface BuilderOptions {
  /** The side whose force is on screen (with `both`, the one whose tab is open). */
  side: PlayerId;
  /** One player chooses the forces of both sides: two tabs and one confirmation. */
  both: boolean;
  limits: [number, number];
  /** There is an asteroid field: capital ships can't be bought. */
  asteroids?: boolean;
  /** What has been put into each side's force so far. */
  forces: [ForceShip[], ForceShip[]];
  /** The force has been handed in: the screen only waits for the other side. */
  confirmed: boolean;
  /** What a rejected command said, if anything. */
  error: string;
  /** Who the other side is, for the waiting message. */
  opponent: string;
  onSide(side: PlayerId): void;
  onChange(side: PlayerId, ships: ForceShip[]): void;
  onConfirm(): void;
}

/** What is wrong with a side's force, or null. */
function problemWith(side: PlayerId, limits: [number, number], ships: ForceShip[], asteroids = false): string | null {
  return ships.length === 0 ? 'Buy at least one ship.' : forceError(side, limits[side], ships, asteroids);
}

/** The screen where a player spends their ship points on ships, pilots and gunners (35). */
export function forceBuilder(o: BuilderOptions): HTMLElement {
  const side = o.side;
  const ships = o.forces[side];
  const limit = o.limits[side];
  const spent = forceCost(ships);
  const left = limit - spent;
  const problem = o.both
    ? ([0, 1] as PlayerId[]).map((s) => { const p = problemWith(s, o.limits, o.forces[s], o.asteroids); return p ? `${SIDE_NAMES[s]}: ${p}` : null; }).find((p) => p !== null) ?? null
    : problemWith(side, o.limits, ships, o.asteroids);
  const locked = o.confirmed;

  const optionList = (kind: 'pilot' | 'gunner', current: PilotQuality | null): HTMLOptionElement[] => {
    const cost = kind === 'pilot' ? pilotCost : gunnerCost;
    const options = QUALITIES.map((q) => h('option', { value: q, selected: q === current }, `${QUALITY_NAMES[q]} ${kind} · ${cost(q)}`));
    return kind === 'gunner' ? [h('option', { value: '', selected: current === null }, 'No gunner'), ...options] : options;
  };

  const roster = ships.map((ship, index) => {
    const name = purchaseName(ship.typeId);
    const capital = isCapitalType(ship.typeId);
    const change = (next: ForceShip): void => o.onChange(side, ships.map((s, i) => (i === index ? next : s)));
    const pilot = h('select', { disabled: locked, onchange: (e: Event) => change({ ...ship, quality: (e.target as HTMLSelectElement).value as PilotQuality }) }, ...optionList('pilot', ship.quality));
    const gunners = Array.from({ length: gunnerSlots(ship.typeId) }, (_, slot) => {
      const current = ship.gunners[slot] ?? null;
      return h('select', {
        disabled: locked,
        onchange: (e: Event) => {
          const value = (e.target as HTMLSelectElement).value;
          // gunners are kept in their seats from the first: an empty seat before a full one moves up
          const seats = Array.from({ length: gunnerSlots(ship.typeId) }, (_, i) => (i === slot ? (value || null) : ship.gunners[i] ?? null)) as (PilotQuality | null)[];
          change({ ...ship, gunners: seats.filter((q): q is PilotQuality => q !== null) });
        },
      }, ...optionList('gunner', current));
    });
    return h('div', { class: 'frow' },
      picture(ship.typeId, 44),
      h('div', { class: 'fname' },
        h('b', null, name),
        h('span', { class: 'sub' }, `${capital ? 'Capital ship' : 'Ship'}: ${shipCost(ship.typeId)} points`),
      ),
      h('div', { class: 'fchoose' }, ...(capital ? [h('span', { class: 'sub' }, capitalSummary(ship.typeId) ?? '')] : [pilot, ...gunners])),
      h('div', { class: 'fcost' }, `${forceShipCost(ship)}`),
      locked ? null : h('button', { class: 'fremove', title: 'Take this ship out of the force', onclick: () => o.onChange(side, ships.filter((_, i) => i !== index)) }, '✕'),
    );
  });

  const catalog = purchasable(side).filter((typeId) => !(o.asteroids && isCapitalType(typeId))).map((typeId) => {
    const type = { name: purchaseName(typeId) };
    const slots = gunnerSlots(typeId);
    // the cheapest way to add it: an average pilot if that fits, otherwise a trainee (a capital ship has no pilot)
    const quality: PilotQuality | null = isCapitalType(typeId)
      ? (shipCost(typeId) <= left ? 'average' : null)
      : shipCost(typeId) + pilotCost('average') <= left ? 'average' : shipCost(typeId) + pilotCost('trainee') <= left ? 'trainee' : null;
    const notes: string[] = [];
    if (slots > 0) notes.push(`${plural(slots, 'gunner seat')}`);
    if (isCapitalType(typeId)) notes.push('capital ship');
    return h('button', {
      class: 'fcard',
      disabled: locked || quality === null,
      title: quality === null ? 'Not enough points left' : isCapitalType(typeId) ? `Add ${/^[AEIOU]/i.test(type.name) ? 'an' : 'a'} ${type.name} (${capitalSummary(typeId)})` : `Add ${/^[AEIOU]/i.test(type.name) || /^X-/.test(type.name) ? 'an' : 'a'} ${type.name} with ${quality === 'average' ? 'an average' : 'a trainee'} pilot`,
      onclick: () => quality && o.onChange(side, [...ships, { typeId, quality, gunners: [] }]),
    },
    picture(typeId, 64),
    h('div', null,
      h('b', null, type.name),
      h('span', { class: 'sub' }, `${shipCost(typeId)} points${notes.length ? ' · ' + notes.join(', ') : ''}`),
    ));
  });

  const bonus = bonusText(o.limits);
  const waiting = locked ? h('p', { class: 'fwait' }, `Your force is chosen. Waiting for ${o.opponent} to choose theirs…`) : null;
  const tabs = o.both
    ? h('div', { class: 'ftabs' }, ...([0, 1] as PlayerId[]).map((s) =>
      h('button', { class: `ftab side${s}${s === side ? ' on' : ''}`, onclick: () => o.onSide(s) },
        SIDE_NAMES[s], h('span', null, ` ${forceCost(o.forces[s])} of ${o.limits[s]} points · ${plural(o.forces[s].length, 'ship')}`))))
    : null;
  const other = side === 0 ? 1 : 0;

  return h('div', { class: 'forcescreen' },
    h('div', { class: 'fpanel' },
      o.both
        ? h('h2', null, 'Choose both forces')
        : h('h2', null, 'Choose your force ', h('span', { class: `fside side${side}` }, SIDE_NAMES[side])),
      h('p', { class: 'sub' }, o.both
        ? 'You choose both forces, for a scenario that makes sense. Every ship, pilot and gunner costs its victory point value, up to the point limit of each side. The other player sees both forces when you confirm.'
        : 'Every ship, pilot and gunner costs its victory point value. Your opponent chooses at the same time. You both see the forces when both are done.'),
      tabs,
      h('div', { class: `fbudget${left < 0 ? ' over' : ''}` },
        h('div', { class: 'fbar' }, h('div', { class: 'fbarfill', style: { width: `${Math.min(100, (spent / limit) * 100)}%` } })),
        h('span', null, `${spent} of ${limit} points spent · ${left >= 0 ? `${left} left` : `${-left} over`}`),
        o.both ? null : h('span', { class: 'sub' }, `${other === 0 ? 'The Rebels’' : 'The Empire’s'} limit is ${o.limits[other]} points.`),
      ),
      bonus ? h('p', { class: 'fbonus' }, bonus) : null,
      h('div', { class: 'fcols' },
        h('div', { class: 'fcol' },
          h('h3', null, 'Ships to buy'),
          h('div', { class: 'fcatalog' }, ...catalog),
        ),
        h('div', { class: 'fcol' },
          h('h3', null, `${o.both ? `${SIDE_NAMES[side]} force` : 'Your force'} (${plural(ships.length, 'ship')})`),
          h('div', { class: 'froster' }, ...(roster.length ? roster : [h('p', { class: 'sub' }, 'Nothing yet: click a ship on the left to buy it.')])),
        ),
      ),
      h('div', { class: 'ffoot' },
        o.error ? h('span', { class: 'error' }, o.error) : problem && !locked ? h('span', { class: 'sub' }, problem) : h('span'),
        waiting,
        locked ? null : h('button', { class: 'primary', disabled: problem !== null, onclick: () => o.onConfirm() }, o.both ? 'Confirm both forces' : 'Confirm force'),
      ),
    ),
  );
}

/** What the other player sees while the host chooses both forces. */
export function forceWaiting(o: { host: string }): HTMLElement {
  return h('div', { class: 'forcescreen' },
    h('div', { class: 'fpanel' },
      h('h2', null, 'The forces are being chosen'),
      h('p', { class: 'fwait' }, `${o.host} is choosing both forces. You will see them when they are done. Then you deploy your ships.`),
    ),
  );
}

/** One side's force as a list, for the screen that shows both. */
function forceList(side: PlayerId, force: Force, limit: number, mine: boolean): HTMLElement {
  return h('div', { class: 'fcol' },
    h('h3', null, h('span', { class: `fside side${side}` }, SIDE_NAMES[side]), mine ? ' (you)' : ''),
    h('p', { class: 'sub' }, `${force.cost} of ${limit} points · ${plural(force.ships.length, 'ship')}`),
    h('div', { class: 'froster' }, ...force.ships.map((s): Child =>
      h('div', { class: 'frow' },
        picture(s.typeId, 44),
        h('div', { class: 'fname' }, h('b', null, purchaseName(s.typeId)), h('span', { class: 'sub' }, describeForceShip(s).split(', ').slice(1).join(', '))),
        h('div', { class: 'fcost' }, `${forceShipCost(s)}`),
      ))),
  );
}

/** Both forces side by side, once both players have chosen, with the way on to deployment. */
export function forceReveal(o: { player: PlayerId; limits: [number, number]; chosen: [Force, Force]; onStart(): void }): HTMLElement {
  const bonus = bonusText(o.limits);
  return h('div', { class: 'forcescreen' },
    h('div', { class: 'fpanel' },
      h('h2', null, 'The forces'),
      h('p', { class: 'sub' }, 'Both sides have chosen. This is what each side bought.'),
      bonus ? h('p', { class: 'fbonus' }, bonus) : null,
      h('div', { class: 'fcols' },
        forceList(0, o.chosen[0], o.limits[0], o.player === 0),
        forceList(1, o.chosen[1], o.limits[1], o.player === 1),
      ),
      h('div', { class: 'ffoot' }, h('span'), h('button', { class: 'primary', onclick: () => o.onStart() }, 'Start deployment')),
    ),
  );
}

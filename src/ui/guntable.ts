import { SPECIAL_DICE, SPECIAL_NAMES, parseGun, powerNumber, specialToHit, toHitNumber, type SpecialKind } from '../engine';
import { h } from './dom';

/*
 * The table of a weapon, as a tip when the pointer is over it: the number the shot has to beat (the base difficulty, before the modifiers for speed, jinks and
 * the rest are added) and the power of a hit, at every range. It lets a player see at a glance that a gun is easier to fire at two hexes than at one.
 */

const RANGES = [1, 2, 3, 4, 5, 6] as const;
const HEAD = ['1', '2', '3', '4', '5', '6–10'];

function table(rows: { label: string; hint: string; values: (string | number)[] }[]): HTMLElement {
  return h('table', { class: 'guntable' },
    h('thead', null, h('tr', null, h('th', null, 'Range'), ...HEAD.map((x) => h('th', null, x)))),
    h('tbody', null, ...rows.map((r) => h('tr', { title: r.hint }, h('th', null, r.label), ...r.values.map((v) => h('td', null, String(v)))))),
  );
}

/**
 * The table of a gun code (such as "DLF" or "QMP(R)"). `by` says who fires it: a pivot gun (P) fired by the pilot acts as a fixed one, so a turret has both lines.
 * `note` is added under the table (the state of the gun, why it cannot be switched on).
 */
export function gunTable(code: string, by: 'pilot' | 'gunner' | 'both', note?: string): HTMLElement {
  const gun = parseGun(code);
  const hit = (who: 'pilot' | 'gunner'): number[] => RANGES.map((r) => toHitNumber(gun, r, who));
  const rows: Parameters<typeof table>[0] = [];
  const fixedLike = gun.mount === 'P';
  if (by === 'both' && fixedLike) {
    rows.push({ label: 'To hit (gunner)', hint: 'The difficulty a gunner rolls against, before the modifiers', values: hit('gunner') });
    rows.push({ label: 'To hit (pilot)', hint: 'The pilot fires a turret like a fixed gun, forward only', values: hit('pilot') });
  } else {
    rows.push({ label: 'To hit', hint: 'The difficulty to roll against, before the modifiers for speed, jinks, tracking and so on', values: hit(by === 'gunner' ? 'gunner' : 'pilot') });
  }
  rows.push({ label: 'Power', hint: 'How hard a hit is at that range', values: RANGES.map((r) => powerNumber(gun, r)) });
  return h('div', { class: 'guntip' },
    h('b', null, `${code}${gun.ion ? ' (ion cannon)' : ''}`),
    table(rows),
    h('p', null, 'To hit: the number to roll against, lower is easier; speed, maneuvers and tracking are added to it. Power: higher is better.'),
    gun.ion ? h('p', null, 'An ion cannon is 3 easier to hit with, and has one flat power at every range.') : null,
    note ? h('p', { class: 'tipnote' }, note) : null,
  );
}

/** The table of a missile, torpedo or bomb: the number to roll against at each range, and the dice of damage. */
export function specialTable(kind: SpecialKind, note?: string): HTMLElement {
  const hits = RANGES.map((r) => specialToHit(kind, r));
  return h('div', { class: 'guntip' },
    h('b', null, SPECIAL_NAMES[kind]),
    table([{ label: 'To hit', hint: 'The difficulty to roll against, before the modifiers', values: hits.map((v) => (v === null ? '–' : v)) }]),
    h('p', null, `${SPECIAL_DICE[kind]}D of body damage with a hit${kind === 'CB' ? '; bombs only hit a ship in the same hex' : '; fired into the forward centre arc, up to ten hexes'}. The target's body rating is taken off the difficulty: big targets are easier to hit.`),
    note ? h('p', { class: 'tipnote' }, note) : null,
  );
}

let tip: HTMLElement | null = null;
let watch: ReturnType<typeof setInterval> | null = null;

function hideTip(): void {
  tip?.remove();
  tip = null;
  if (watch) clearInterval(watch);
  watch = null;
}

/** Shows what `build` makes beside an element while the pointer is over it (the tip floats over the page, so that no panel cuts it off). */
export function tipOn(el: HTMLElement, build: () => HTMLElement): void {
  el.addEventListener('mouseenter', () => {
    hideTip();
    tip = h('div', { class: 'floattip' }, build());
    document.body.append(tip);
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    tip.style.left = `${Math.max(6, Math.min(r.left, window.innerWidth - w - 6))}px`;
    tip.style.top = `${r.bottom + hgt + 8 > window.innerHeight ? Math.max(6, r.top - hgt - 4) : r.bottom + 4}px`;
    // an element that is drawn again while the pointer is over it never says that the pointer has left
    watch = setInterval(() => { if (!el.isConnected || !el.matches(':hover')) hideTip(); }, 300);
  });
  el.addEventListener('mouseleave', hideTip);
}

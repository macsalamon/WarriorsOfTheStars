import { describe, expect, it } from 'vitest';
import { aimAt, allDone, allShots, armedLeft, canConfirm, confirm, gunAim, hold, newAim, reopen, selectedGuns, shotsOf, switchOff, toggleGun } from '../src/ui/aim';

const start = () => newAim('fire', 'P0-1', [{ id: 'pilot', ready: [0, 1] }, { id: 'gunner1', ready: [2] }], 'pilot');

describe('aiming', () => {
  it('arms every gun it is given to begin with, for the first crew member', () => {
    const a = start();
    expect(a.active).toBe('pilot');
    expect(selectedGuns(a, 'pilot')).toEqual([0, 1]);
    expect(gunAim(a, 'pilot', 0)).toBe('armed');
    expect(gunAim(a, 'pilot', 5)).toBe('off');
    expect(armedLeft(a, 'pilot')).toBe(2);
    expect(canConfirm(a, 'pilot')).toBe(false);
  });

  it('gives a clicked target to the armed guns that reach it', () => {
    let a = start();
    a = aimAt(a, 'pilot', 'P1-1', () => true);
    expect(shotsOf(a, 'pilot')).toEqual([{ gun: 0, target: 'P1-1' }, { gun: 1, target: 'P1-1' }]);
    expect(canConfirm(a, 'pilot')).toBe(true);
    // a target no armed gun reaches changes nothing
    const b = aimAt(start(), 'pilot', 'P1-2', () => false);
    expect(shotsOf(b, 'pilot')).toEqual([]);
  });

  it('splits the fire: an aimed gun goes back to armed when pressed, and takes the next target', () => {
    let a = aimAt(start(), 'pilot', 'P1-1', () => true);
    a = toggleGun(a, 'pilot', 1);
    expect(gunAim(a, 'pilot', 1)).toBe('armed');
    expect(gunAim(a, 'pilot', 0)).toBe('aimed');
    a = aimAt(a, 'pilot', 'P1-2', () => true);
    expect(shotsOf(a, 'pilot')).toEqual([{ gun: 0, target: 'P1-1' }, { gun: 1, target: 'P1-2' }]);
  });

  it('switches a gun off and on, and does not touch a confirmed crew member', () => {
    let a = switchOff(start(), 'pilot', 1);
    expect(gunAim(a, 'pilot', 1)).toBe('off');
    // pressing an armed gun does not cycle it: only the × switches it off
    expect(toggleGun(start(), 'pilot', 1)).toEqual(start());
    a = aimAt(a, 'pilot', 'P1-1', () => true);
    expect(canConfirm(a, 'pilot')).toBe(true);
    a = confirm(a, 'pilot');
    expect(toggleGun(a, 'pilot', 1)).toBe(a);
    expect(aimAt(a, 'pilot', 'P1-2', () => true)).toBe(a);
    a = reopen(a, 'pilot');
    expect(gunAim(toggleGun(a, 'pilot', 1), 'pilot', 1)).toBe('armed');
  });

  it('moves on to the next crew member who has not confirmed, and is done when all have', () => {
    let a = aimAt(start(), 'pilot', 'P1-1', () => true);
    a = confirm(a, 'pilot');
    expect(a.active).toBe('gunner1');
    expect(allDone(a)).toBe(false);
    a = hold(a, 'gunner1');
    expect(allDone(a)).toBe(true);
    expect(allShots(a)).toEqual([{ gun: 0, target: 'P1-1' }, { gun: 1, target: 'P1-1' }]);
  });

  it('names the gunner on his shots, and leaves out a crew member who has not confirmed', () => {
    let a = aimAt(start(), 'gunner1', 'P1-3', () => true);
    expect(shotsOf(a, 'gunner1')).toEqual([{ gun: 2, target: 'P1-3', crew: 'gunner1' }]);
    expect(allShots(a)).toEqual([]);
    a = confirm(a, 'gunner1');
    expect(allShots(a)).toEqual([{ gun: 2, target: 'P1-3', crew: 'gunner1' }]);
  });
});

import { heldBy, lockedBy } from '../src/ui/aim';

describe('a gun fires once', () => {
  it('knows when another crew member has switched a gun on', () => {
    const a = newAim('fire', 'P0-1', [{ id: 'pilot', ready: [] }, { id: 'gunner1', ready: [1] }], 'pilot');
    expect(heldBy(a, 1, 'pilot')).toBe('gunner1');
    expect(heldBy(a, 1, 'gunner1')).toBeNull();
    expect(heldBy(a, 0, 'pilot')).toBeNull();
  });
});

describe('changing your mind', () => {
  it('aims the guns again when a new target is clicked and no gun is armed', () => {
    let a = aimAt(start(), 'pilot', 'P1-1', () => true);
    a = aimAt(a, 'pilot', 'P1-2', () => true);
    expect(shotsOf(a, 'pilot')).toEqual([{ gun: 0, target: 'P1-2' }, { gun: 1, target: 'P1-2' }]);
    // only the guns that reach the new target move
    a = aimAt(a, 'pilot', 'P1-1', (g) => g === 1);
    expect(shotsOf(a, 'pilot')).toEqual([{ gun: 0, target: 'P1-2' }, { gun: 1, target: 'P1-1' }]);
    // clicking the target a gun already has changes nothing
    expect(aimAt(a, 'pilot', 'P1-1', (g) => g === 1)).toBe(a);
  });

  it('prefers armed guns to guns that are already aimed', () => {
    let a = aimAt(start(), 'pilot', 'P1-1', () => true);
    a = toggleGun(a, 'pilot', 1);
    a = aimAt(a, 'pilot', 'P1-2', () => true);
    expect(shotsOf(a, 'pilot')).toEqual([{ gun: 0, target: 'P1-1' }, { gun: 1, target: 'P1-2' }]);
  });

  it('switches an aimed gun off in one step, and back on', () => {
    let a = aimAt(start(), 'pilot', 'P1-1', () => true);
    a = switchOff(a, 'pilot', 1);
    expect(gunAim(a, 'pilot', 1)).toBe('off');
    expect(selectedGuns(a, 'pilot')).toEqual([0]);
    a = toggleGun(a, 'pilot', 1);
    expect(gunAim(a, 'pilot', 1)).toBe('armed');
    expect(armedLeft(a, 'pilot')).toBe(1);
  });
});

describe('claiming a turret', () => {
  const turret = () => newAim('fire', 'P0-1', [{ id: 'pilot', ready: [] }, { id: 'gunner1', ready: [1] }], 'pilot');

  it('lets the pilot take a turret from the gunner before anyone has confirmed', () => {
    let a = toggleGun(turret(), 'pilot', 1);
    expect(gunAim(a, 'pilot', 1)).toBe('armed');
    expect(gunAim(a, 'gunner1', 1)).toBe('off');
    expect(heldBy(a, 1, 'gunner1')).toBe('pilot');
    // and the gunner can take it back
    a = toggleGun(a, 'gunner1', 1);
    expect(gunAim(a, 'gunner1', 1)).toBe('armed');
    expect(gunAim(a, 'pilot', 1)).toBe('off');
  });

  it('does not take a turret from a crew member who has confirmed', () => {
    let a = aimAt(turret(), 'gunner1', 'P1-1', () => true);
    a = confirm(a, 'gunner1');
    expect(lockedBy(a, 1, 'pilot')).toBe('gunner1');
    expect(toggleGun(a, 'pilot', 1)).toBe(a);
    a = reopen(a, 'gunner1');
    expect(lockedBy(a, 1, 'pilot')).toBeNull();
    expect(gunAim(toggleGun(a, 'pilot', 1), 'gunner1', 1)).toBe('off');
  });
});

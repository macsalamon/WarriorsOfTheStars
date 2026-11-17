import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHIPS } from '../src/engine';
import { SOUND_ENTRIES, SOUNDS, busOf, cockpitLevel, cockpitPitch, engineSound, fireSound, hitSound, pickedFiles } from '../src/ui/soundmap';

describe('the sound table (data/sounds.json)', () => {
  it('has every id once, and a volume between 0 and 1', () => {
    expect(new Set(SOUND_ENTRIES.map((e) => e.id)).size).toBe(SOUND_ENTRIES.length);
    for (const e of SOUND_ENTRIES) {
      expect(Array.isArray(e.pick), e.id).toBe(true);
      expect(e.volume ?? 1, e.id).toBeGreaterThan(0);
      expect(e.volume ?? 1, e.id).toBeLessThanOrEqual(1);
    }
  });

  it('has a packed file for every pick (run "npm run sounds" after changing picks)', () => {
    for (const file of pickedFiles()) expect(existsSync(`public/assets/sounds/${file}.mp3`), file).toBe(true);
  });

  it('only names ship types the game has', () => {
    const capital = ['star-destroyer', 'mon-calamari', 'nebulon-b'];
    for (const e of SOUND_ENTRIES) for (const ship of e.ships ?? []) expect(ship in SHIPS || capital.includes(ship), `${e.id}: ${ship}`).toBe(true);
  });

  it('gives every ship a sound for its guns and both engine loops', () => {
    for (const [typeId, type] of Object.entries(SHIPS)) {
      const guns = [...type.pilotGuns, ...type.gunnerWeapons];
      expect(fireSound({ kind: 'ship', typeId }, guns[0] ?? 'DLP', false), typeId).toMatch(/^fire\.laser\./);
      if (guns.some((g) => g.includes('(I)'))) expect(fireSound({ kind: 'ship', typeId }, 'DLF(I)', true), typeId).toMatch(/^fire\.ion\./);
      expect(engineSound('cockpit', typeId), typeId).not.toBeNull();
      expect(engineSound('external', typeId), typeId).not.toBeNull();
    }
  });
});

describe('which sound belongs to what', () => {
  it('fires torpedoes, missiles and bombs with their own sounds, whoever fires', () => {
    expect(fireSound({ kind: 'ship', typeId: 'x-wing' }, 'PT', false)).toBe('fire.torpedo');
    expect(fireSound({ kind: 'ship', typeId: 'millennium-falcon' }, 'CM', false)).toBe('fire.missile');
    expect(fireSound({ kind: 'ship', typeId: 'tie-bomber' }, 'CB', false)).toBe('fire.bomb');
  });

  it('tells the weapon groups apart', () => {
    expect(fireSound({ kind: 'ship', typeId: 'x-wing' }, 'QMF', false)).toBe('fire.laser.rebel');
    expect(fireSound({ kind: 'ship', typeId: 'b-wing' }, 'TMF(I)', true)).toBe('fire.ion.rebel');
    expect(fireSound({ kind: 'ship', typeId: 'tie-interceptor' }, 'QLF', false)).toBe('fire.laser.tie');
    expect(fireSound({ kind: 'turret' }, 'DMP', false)).toBe('fire.turret');
    expect(fireSound({ kind: 'capital' }, 'DL', false)).toBe('fire.capital');
    expect(fireSound({ kind: 'capital' }, 'DL(I)', true)).toBe('fire.capital.ion');
    // a ship with an ion cannon but no entry for it falls back on its laser sound
    expect(fireSound({ kind: 'ship', typeId: 'tie-fighter' }, 'DMF(I)', true)).toBe('fire.laser.tie');
  });

  it('picks the hit sound by the weapon that landed, then by what the hit did', () => {
    expect(hitSound({ weapon: 'torpedo', effect: 'heavy' })).toBe('hit.torpedo');
    expect(hitSound({ weapon: 'missile' })).toBe('hit.missile');
    expect(hitSound({ weapon: 'laser', effect: 'heavy' })).toBe('hit.heavy');
    expect(hitSound({ weapon: 'ion', effect: 'shield' })).toBe('hit.ion');
    expect(hitSound({ weapon: 'laser', effect: 'shield' })).toBe('hit.shield');
    expect(hitSound({ weapon: 'laser', effect: 'hull' })).toBe('hit.hull');
    expect(hitSound({ effect: 'rock' })).toBe('explode.asteroid');
    expect(hitSound({})).toBe('hit.hull');
  });

  it('plays the cockpit loop at 10% for a ship that stands still, up to 40% at its top speed', () => {
    expect(cockpitLevel(0, 6)).toBeCloseTo(0.1);
    expect(cockpitLevel(3, 6)).toBeCloseTo(0.25);
    expect(cockpitLevel(6, 6)).toBeCloseTo(0.4);
    expect(cockpitLevel(8, 6)).toBeCloseTo(0.4); // overspeed is no louder
    expect(cockpitLevel(2, 0)).toBeCloseTo(0.1);
  });

  it('turns the cockpit loop over faster the faster the ship is planned to fly, so that every step of speed can be heard', () => {
    expect(cockpitPitch(0, 9)).toBeCloseTo(0.8);
    expect(cockpitPitch(9, 9)).toBeCloseTo(1.25);
    expect(cockpitPitch(11, 9)).toBeCloseTo(1.25);
    // a step of speed is at least a twentieth of the pitch, also for the ship with the most steps
    expect(cockpitPitch(5, 9) - cockpitPitch(4, 9)).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('sorts the sounds into the three volume groups, and knows every id it hands out', () => {
    expect(busOf('engine.cockpit.x-wing')).toBe('engines');
    expect(busOf('ui.click')).toBe('interface');
    expect(busOf('turn.new')).toBe('interface');
    expect(busOf('fire.torpedo')).toBe('effects');
    for (const id of ['fire.torpedo', 'fire.missile', 'fire.bomb', 'fire.turret', 'fire.capital', 'fire.capital.ion', 'hit.shield', 'hit.hull', 'hit.heavy', 'hit.ion', 'hit.torpedo', 'hit.missile', 'miss', 'explode.fighter', 'explode.large', 'explode.turret', 'explode.asteroid', 'ui.click', 'ui.commit', 'ui.illegal', 'ui.select', 'ui.place', 'turn.new', 'turn.yours', 'dice.roll', 'game.won', 'game.lost']) expect(SOUNDS.has(id), id).toBe(true);
  });
});

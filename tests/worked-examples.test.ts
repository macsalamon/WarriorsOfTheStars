import { describe, expect, it } from 'vitest';
import {
  ACTION_HAZARD_CODE,
  arcOf,
  baseTurnNumber,
  canFireAt,
  createRng,
  degradeGun,
  facingRelation,
  formatSkill,
  getShip,
  hazardDamageCodes,
  hazardRowSequence,
  hazardsFromRoll,
  hexDistance,
  isTailing,
  parseDamageCode,
  parseGun,
  powerNumber,
  quarterOf,
  reduceSkill,
  parseSkill,
  resolveHit,
  rollSkill,
  scriptedRng,
  TABLES,
  shotBreakdown,
  shotDifficulty,
  skillFromRoll,
  toHitNumber,
  totalDifficulty,
  turnBreakdown,
  turnNumber,
  describeDamageCode,
  type Maneuvers,
  type ShotInput,
} from '../src/engine';

const calm: Maneuvers = { halfLoop: 0, roll: 0, jink: 0, pinpointFire: 0 };

const shot = (over: Partial<ShotInput>): ShotInput => ({
  base: 15,
  firer: calm,
  target: calm,
  firerTracking: 0,
  targetTracking: 0,
  firerSpeed: 0,
  targetSpeed: 0,
  facing: 'other',
  ...over,
});

describe('skill codes', () => {
  it('rolls dice and adds pips', () => {
    // 5, 2 and 4 on three dice with 3D+1 gives 12 (Rules: Skill — example)
    expect(rollSkill(scriptedRng([5, 2, 4]), parseSkill('3D+1'))).toBe(12);
  });

  it('maps rolls to the Pilot Skill Table', () => {
    expect(formatSkill(skillFromRoll(17))).toBe('7D+1');
    expect(formatSkill(skillFromRoll(12))).toBe('5D+2');
    expect(formatSkill(skillFromRoll(4))).toBe('3D');
  });

  it('reduces skills by 1D (Sk-1) and kills a pilot below 1D', () => {
    expect(formatSkill(reduceSkill(parseSkill('3D+2'))!)).toBe('2D+2');
    expect(reduceSkill(parseSkill('1D'))).toBeNull();
  });

  it('removes dice for multiple guns', () => {
    // 5D+2 firing three guns rolls 3D+2: all-sixes would be 18+2
    expect(rollSkill(scriptedRng([6, 6, 6]), parseSkill('5D+2'), 2)).toBe(20);
  });
});

describe('guns', () => {
  it('gives QLF the printed to-hit and power rows', () => {
    const qlf = parseGun('QLF');
    expect([1, 2, 3, 4, 5].map((r) => toHitNumber(qlf, r))).toEqual([13, 16, 19, 21, 24]);
    expect([1, 2, 3, 4, 5].map((r) => powerNumber(qlf, r))).toEqual([3, 3, 2, 1, 0]);
  });

  it('subtracts 3 from to-hit for ion cannons', () => {
    const ion = parseGun('DMF(I)');
    expect([1, 2, 3, 4, 5].map((r) => toHitNumber(ion, r))).toEqual([12, 15, 18, 20, 23]);
  });

  it('uses the flat ion power column (B-wing TMF(I) is -4 everywhere)', () => {
    const tmf = parseGun('TMF(I)');
    expect([1, 2, 3, 4, 5].map((r) => powerNumber(tmf, r))).toEqual([-4, -4, -4, -4, -4]);
  });

  it('degrades guns Q, T, D, S and then none (G damage)', () => {
    expect(degradeGun('QLF')).toBe('TLF');
    expect(degradeGun('DMF(I)')).toBe('SMF(I)');
    expect(degradeGun('SMF')).toBeNull();
  });
});

describe('every ship in the data file', () => {
  const ids = [
    'tie-interceptor', 'tie-interceptor-prototype', 'tie-fighter', 'tie-bomber', 'imperial-shuttle',
    'x-wing', 'y-wing-1seat', 'y-wing-2seat', 'a-wing', 'b-wing', 'stock-freighter',
    'millennium-falcon', 'slave-i', 'pirate-pinnace',
  ];

  it.each(ids)('%s has a turn number for every speed and usable guns', (id) => {
    const ship = getShip(id);
    expect(ship.turn).toHaveLength(ship.speedMax + 2);
    for (let speed = 0; speed <= ship.speedMax + 2; speed++) {
      expect(baseTurnNumber(ship, speed)).toBeGreaterThanOrEqual(0);
    }
    for (const code of ship.pilotGuns) {
      const gun = parseGun(code);
      for (let range = 1; range <= 5; range++) {
        // the Standard Game only uses the bold rows
        toHitNumber(gun, range);
        powerNumber(gun, range);
      }
    }
  });
});

describe('turn numbers', () => {
  it('gives the TIE interceptor base turn number 5 at speed 6', () => {
    expect(baseTurnNumber(getShip('tie-interceptor'), 6)).toBe(5);
  });

  it('adds slip, roll, overturn and lateral damage cumulatively', () => {
    const n = turnNumber(4, 6, { slip: true, roll: true, overturn: 1, lateralDamage: 1 });
    expect(n).toBe(4); // 4 + 1 + 1 - 3 + 1
  });

  it('lists each term of the turn number and the parts add up to it', () => {
    const { total, parts } = turnBreakdown(4, 6, { slip: true, roll: true, overturn: 1, lateralDamage: 1 });
    expect(total).toBe(4);
    expect(parts.map((p) => p.value)).toEqual([4, 1, 1, -3, 1]);
    expect(parts[0]!.label).toContain('speed 6');
  });

  it('shows the 1/2 floor as its own line', () => {
    const { total, parts } = turnBreakdown(2, 5, { overturn: 1 });
    expect(total).toBe(0.5);
    expect(parts.at(-1)).toMatchObject({ label: 'Never lower than ½', value: 1.5 });
  });

  it('never drops below 1/2 and is 0 at speed 0', () => {
    expect(turnNumber(2, 5, { overturn: 1 })).toBe(0.5);
    expect(turnNumber(5, 0)).toBe(0);
  });

  it('counts double bank as -2 and double overturn as -4', () => {
    expect(turnNumber(6, 4, { bank: 2 })).toBe(4);
    expect(turnNumber(6, 4, { overturn: 2 })).toBe(2);
  });
});

describe('hazards (7)', () => {
  it('adds up total difficulty', () => {
    const tie = getShip('tie-interceptor').difficulty;
    expect(
      totalDifficulty([{ difficulty: tie.halfLoop }, { difficulty: tie.overturn }, { difficulty: tie.snapFire }]),
    ).toBe(13);
    expect(
      totalDifficulty([
        { difficulty: tie.slip, doubled: true },
        { difficulty: tie.roll, doubled: true },
        { difficulty: tie.snapFire },
      ]),
    ).toBe(15);
  });

  it("matches Bart's X-wing example: double slip, double roll, stabilizer damage = 17", () => {
    const x = getShip('x-wing').difficulty;
    const total = totalDifficulty([
      { difficulty: x.slip, doubled: true },
      { difficulty: x.roll, doubled: true },
      { difficulty: x.stabilizer },
    ]);
    expect(total).toBe(17);
    expect(hazardsFromRoll(total, 5)).toEqual({ hazards: 2, minor: 1 });
  });

  it('counts hazards and minor hazards', () => {
    expect(hazardsFromRoll(15, 8)).toEqual({ hazards: 1, minor: 1 });
    expect(hazardsFromRoll(26, 12)).toEqual({ hazards: 2, minor: 1 });
    expect(hazardsFromRoll(18, 14)).toEqual({ hazards: 0, minor: 1 });
    expect(hazardsFromRoll(15, 15)).toEqual({ hazards: 0, minor: 0 });
    expect(hazardsFromRoll(10, 5)).toEqual({ hazards: 1, minor: 0 });
  });

  it('orders hazard rows alphabetically and recycles', () => {
    expect(hazardRowSequence(['C', 'C', 'E', 'G'], 3)).toEqual(['C', 'E', 'G']);
    expect(hazardRowSequence(['C', 'F'], 3)).toEqual(['C', 'F', 'C']);
    expect(hazardRowSequence([], 2)).toEqual([]);
  });

  it('looks up the example hazard results', () => {
    expect(hazardDamageCodes('B', 10, false)).toEqual(['T+1', 'L']);
    expect(hazardDamageCodes('C', 8, false)).toEqual(['A+3', 'LOSE']);
    expect(hazardDamageCodes('B', 12, true)).toEqual(['SPD?']); // minor: top code only
    expect(hazardDamageCodes('B', 7, false)).toEqual([]); // a 7 is always no effect
  });

  it('explains every damage code on both tables in plain words', () => {
    const codes = new Set<string>();
    for (const q of ['front', 'rear', 'portStarboard'] as const) TABLES.fire[q].flat().forEach((c) => codes.add(c));
    for (const row of Object.values(TABLES.hazard.rows)) [...row.top, ...row.bottom].forEach((c) => codes.add(c));
    for (const code of codes) expect(describeDamageCode(code).length).toBeGreaterThan(5);
    expect(describeDamageCode('T+2')).toContain('+2');
    expect(describeDamageCode('3Bdy')).toContain('3 body points');
    expect(describeDamageCode('-')).toBe('no effect');
  });

  it('maps the action circles to hazard codes', () => {
    expect(ACTION_HAZARD_CODE.slip).toBe('C');
    expect(ACTION_HAZARD_CODE.overturn).toBe('D');
    expect(ACTION_HAZARD_CODE.snapFire).toBe('F');
  });
});

describe('shot difficulty', () => {
  it('adds the target speed when neither facing matches', () => {
    expect(shotDifficulty(shot({ base: 15, targetSpeed: 5, facing: 'other' }))).toBe(20);
  });

  it('adds the speed difference for the same facing', () => {
    expect(shotDifficulty(shot({ base: 15, firerSpeed: 6, targetSpeed: 5, facing: 'same' }))).toBe(16);
  });

  it('adds both speeds for opposite facing', () => {
    expect(shotDifficulty(shot({ base: 15, firerSpeed: 6, targetSpeed: 5, facing: 'opposite' }))).toBe(26);
  });

  it('works through the full TIE interceptor example', () => {
    // base 19; firer rolls and double pinpoints; target rolls, jinks and is tracking a third ship
    const d = shotDifficulty({
      base: 19,
      firer: { ...calm, roll: 1, pinpointFire: 2 },
      target: { ...calm, roll: 1, jink: 1 },
      firerTracking: 0,
      targetTracking: 1,
      firerSpeed: 6,
      targetSpeed: 8,
      facing: 'opposite',
    });
    expect(d).toBe(23);
  });

  it('cancels rolls but counts a one-roll difference', () => {
    expect(shotDifficulty(shot({ firer: { ...calm, roll: 1 } }))).toBe(20);
    expect(shotDifficulty(shot({ firer: { ...calm, roll: 2 } }))).toBe(25);
    expect(shotDifficulty(shot({ firer: { ...calm, roll: 1 }, target: { ...calm, roll: 2 } }))).toBe(20);
    expect(shotDifficulty(shot({ firer: { ...calm, roll: 2 }, target: { ...calm, roll: 2 } }))).toBe(15);
  });

  it('adds jinks together and treats half loops as firer +5 / target -5', () => {
    const both = shot({ firer: { ...calm, jink: 2 }, target: { ...calm, jink: 1 } });
    expect(shotDifficulty(both)).toBe(15 + 10 + 5);
    expect(shotDifficulty(shot({ firer: { ...calm, halfLoop: 2 } }))).toBe(20);
    expect(shotDifficulty(shot({ target: { ...calm, halfLoop: 1 } }))).toBe(10);
  });

  it('lists every modifier and the parts always add up to the difficulty', () => {
    const input = shot({
      base: 19,
      firer: { ...calm, roll: 1, pinpointFire: 2 },
      target: { ...calm, roll: 1, jink: 1 },
      targetTracking: 1,
      firerSpeed: 6,
      targetSpeed: 8,
      facing: 'opposite',
    });
    const { total, parts } = shotBreakdown(input);
    expect(total).toBe(shotDifficulty(input));
    expect(total).toBe(23);
    expect(parts[0]).toMatchObject({ value: 19 });
    expect(parts.find((p) => p.label.includes('Head-on'))?.value).toBe(14);
    expect(parts.find((p) => p.label.includes('rolls cancel'))?.value).toBe(0);
    expect(parts.find((p) => p.label.includes('pinpoint'))?.value).toBe(-10);
    expect(parts.reduce((sum, p) => sum + p.value, 0)).toBe(total);
  });

  it('leaves out modifiers that are zero', () => {
    const { parts } = shotBreakdown(shot({ base: 15, facing: 'same', firerSpeed: 3, targetSpeed: 3 }));
    expect(parts).toHaveLength(1);
  });

  it('applies tracking to both the firer and the tracking target', () => {
    expect(shotDifficulty(shot({ firerTracking: 1 }))).toBe(10);
    expect(shotDifficulty(shot({ firerTracking: 2 }))).toBe(5);
    expect(shotDifficulty(shot({ targetTracking: 2 }))).toBe(5);
  });
});

describe('damage resolution (12)', () => {
  it('reduces power by shields, then looks up the Fire Table', () => {
    // power 2 against 2 shield markers is 0; a roll of 10 is column 10 of the front quarter
    const r = resolveHit({ power: 2, shields: 2, ion: false, quarter: 'front', roll: 10 });
    expect(r.power).toBe(0);
    expect(r.codes).toEqual(['A+3', 'P', 'Body']);
  });

  it('can reduce power below zero', () => {
    const r = resolveHit({ power: 1, shields: 3, ion: false, quarter: 'front', roll: 6 });
    expect(r.power).toBe(-2);
    expect(r.modifiedRoll).toBe(4);
    expect(r.codes).toEqual(['Roll', 'Stb']);
  });

  it('does nothing at 2 or less and destroys at 14 or more', () => {
    expect(resolveHit({ power: 0, shields: 0, ion: false, quarter: 'front', roll: 2 }).outcome).toBe('none');
    expect(resolveHit({ power: 3, shields: 0, ion: false, quarter: 'rear', roll: 11 }).outcome).toBe('destroyed');
  });

  it('uses the rear-quarter row for shots from behind', () => {
    const r = resolveHit({ power: 0, shields: 0, ion: false, quarter: 'rear', roll: 6 });
    expect(r.codes).toEqual(['E', 'Body']);
  });

  it('ion cannons ignore shields, floor at -1 and never cause body damage', () => {
    const low = resolveHit({ power: -4, shields: 5, ion: true, quarter: 'front', roll: 2 });
    expect(low.power).toBe(-4);
    expect(low.modifiedRoll).toBe(-1);
    expect(low.codes).toEqual(['L', 'Sk-1', 'P']);

    const high = resolveHit({ power: 0, shields: 0, ion: true, quarter: 'front', roll: 10 });
    expect(high.codes).toEqual(['A+3', 'P']); // Body dropped
  });

  it('ion cannons still look up a modified roll of 2 or less', () => {
    const r = resolveHit({ power: 0, shields: 0, ion: true, quarter: 'front', roll: 2 });
    expect(r.outcome).toBe('damage');
    expect(r.codes).toEqual(['G', 'P', 'T+1']);
  });

  it('parses every damage code on both tables', () => {
    const codes = new Set<string>();
    for (const q of ['front', 'rear', 'portStarboard'] as const) {
      TABLES.fire[q].flat().forEach((c) => codes.add(c));
    }
    for (const row of Object.values(TABLES.hazard.rows)) {
      row.top.forEach((c) => codes.add(c));
      row.bottom.forEach((c) => codes.add(c));
    }
    for (const code of codes) expect(() => parseDamageCode(code)).not.toThrow();
  });
});

describe('hex geometry', () => {
  const origin = { q: 0, r: 0 };

  it('measures range counting the target but not the firer', () => {
    expect(hexDistance(origin, { q: 0, r: -3 })).toBe(3);
    expect(hexDistance(origin, { q: 2, r: -3 })).toBe(3);
    expect(hexDistance(origin, { q: 3, r: -1 })).toBe(3);
  });

  it('puts hexes straight ahead and within 30 degrees in the forward centre arc', () => {
    expect(arcOf(origin, 0, { q: 0, r: -1 })).toBe('FC');
    expect(arcOf(origin, 0, { q: 0, r: -5 })).toBe('FC');
    expect(arcOf(origin, 0, { q: 1, r: -3 })).toBe('FC');
    expect(arcOf(origin, 0, { q: 2, r: -5 })).toBe('FC');
  });

  it('gives boundary hexes to the side arcs', () => {
    expect(arcOf(origin, 0, { q: 1, r: -2 })).toBe('FR');
    expect(arcOf(origin, 0, { q: -1, r: -1 })).toBe('FL');
    expect(arcOf(origin, 0, { q: 2, r: -4 })).toBe('FR');
  });

  it('identifies all six arcs around a ship facing up', () => {
    expect(arcOf(origin, 0, { q: 1, r: -1 })).toBe('FR');
    expect(arcOf(origin, 0, { q: 1, r: 0 })).toBe('RR');
    expect(arcOf(origin, 0, { q: 0, r: 1 })).toBe('RC');
    expect(arcOf(origin, 0, { q: -1, r: 1 })).toBe('RL');
    expect(arcOf(origin, 0, { q: -1, r: 0 })).toBe('FL');
  });

  it('rotates arcs with the ship facing', () => {
    // facing 2 (down-right): its forward centre is the hex at (1, 0)
    expect(arcOf(origin, 2, { q: 1, r: 0 })).toBe('FC');
    expect(arcOf(origin, 2, { q: -1, r: 0 })).toBe('RC');
  });

  it('lets a ship fire only forward-centre within five hexes', () => {
    expect(canFireAt(origin, 0, { q: 0, r: -5 })).toBe(true);
    expect(canFireAt(origin, 0, { q: 0, r: -6 })).toBe(false);
    expect(canFireAt(origin, 0, { q: 1, r: -2 })).toBe(false);
    expect(canFireAt(origin, 0, { q: 0, r: 3 })).toBe(false);
    expect(canFireAt(origin, 0, origin)).toBe(false);
  });

  it('detects tailing', () => {
    const lead = { q: 0, r: -3 };
    expect(isTailing(origin, 0, lead, 0)).toBe(true); // same direction, in its rear centre arc
    expect(isTailing(origin, 0, lead, 3)).toBe(false); // lead is flying toward the tailer
    expect(isTailing(lead, 0, origin, 0)).toBe(false);
    expect(isTailing(origin, 0, { q: 0, r: -11 }, 0)).toBe(false); // beyond ten hexes
  });

  it('classifies relative facing', () => {
    expect(facingRelation(0, 0)).toBe('same');
    expect(facingRelation(0, 3)).toBe('opposite');
    expect(facingRelation(5, 2)).toBe('opposite');
    expect(facingRelation(0, 2)).toBe('other');
  });

  it('chooses front or rear quarter from the target facing', () => {
    const target = origin;
    expect(quarterOf(target, 0, { q: 0, r: -2 })).toBe('front');
    expect(quarterOf(target, 0, { q: 0, r: 2 })).toBe('rear');
    expect(quarterOf(target, 0, { q: 1, r: 0 })).toBe('rear');
  });
});

describe('rng', () => {
  it('is reproducible for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
});

import { describe, expect, it } from 'vitest';
import { legAngle, legLength, legPoint, legSlide, planFlight, type FlightStep } from '../src/ui3d/flight';

type Leg = Extract<FlightStep, { kind: 'leg' }>;
const HEX = 45;
/** The hex ahead of a point, for a ship turned to an angle of the board (up the map is 0, clockwise). */
const ahead = (p: { x: number; y: number }, angle: number): { x: number; y: number } => ({ x: p.x + Math.sin((angle * Math.PI) / 180) * HEX, y: p.y - Math.cos((angle * Math.PI) / 180) * HEX });

describe('a move flown as one curve (3D board)', () => {
  // two hexes forward, a turn to the right, two hexes forward
  const start = { x: 0, y: 0, angle: 0 };
  const a = { ...ahead(start, 0), angle: 0 };
  const b = { ...ahead(a, 0), angle: 0 };
  const turned = { x: b.x, y: b.y, angle: 60 };
  const c = { ...ahead(b, 60), angle: 60 };
  const d = { ...ahead(c, 60), angle: 60 };
  const steps = planFlight(start, [a, b, turned, c, d])!;
  const legs = steps.filter((s): s is Leg => s.kind === 'leg');

  it('has a step for every pose: legs between hexes, and the turn made on the way', () => {
    expect(steps.map((s) => s.kind)).toEqual(['leg', 'leg', 'absorbed', 'leg', 'leg']);
  });

  it('starts and ends in the middle of its hexes, and flies straight through a hex it does not turn in', () => {
    expect(legPoint(legs[0]!, 0)).toEqual({ x: 0, y: 0 });
    expect(legPoint(legs[0]!, 1).x).toBeCloseTo(a.x);
    expect(legPoint(legs[0]!, 1).y).toBeCloseTo(a.y);
    expect(legPoint(legs[3]!, 1).x).toBeCloseTo(d.x);
    expect(legPoint(legs[3]!, 1).y).toBeCloseTo(d.y);
  });

  it('cuts the corner of the hex it turns in, on the inside, and passes close by its middle', () => {
    const p = legPoint(legs[1]!, 1);
    const off = Math.hypot(p.x - b.x, p.y - b.y);
    expect(off).toBeGreaterThan(1);
    expect(off).toBeLessThan(HEX / 6);
    // a turn to the right: the path is to the right of the hex's middle
    expect(p.x).toBeGreaterThan(b.x);
  });

  it('is one unbroken path: each leg begins where the one before ended', () => {
    for (let i = 1; i < legs.length; i++) {
      const end = legPoint(legs[i - 1]!, 1);
      const begin = legPoint(legs[i]!, 0);
      expect(begin.x).toBeCloseTo(end.x);
      expect(begin.y).toBeCloseTo(end.y);
    }
  });

  it('turns steadily and only the way of the turn: no swing the other way first', () => {
    let last = 0;
    for (const leg of legs) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const now = legAngle(leg, Math.min(1, t), last);
        expect(now - last).toBeGreaterThan(-0.001);
        expect(now - last).toBeLessThan(5);
        last = now;
      }
    }
    expect(last).toBeCloseTo(60);
    // half the turn is made by the middle of the hex
    expect(legAngle(legs[1]!, 1, 0)).toBeCloseTo(30);
  });

  it('turns made before the first hex and after the last are flown on the way too', () => {
    const first = { x: 0, y: 0, angle: 60 };
    const hex = { ...ahead(first, 60), angle: 60 };
    const last = { x: hex.x, y: hex.y, angle: 120 };
    const plan = planFlight(start, [first, hex, last])!;
    expect(plan.map((s) => s.kind)).toEqual(['absorbed', 'leg', 'absorbed']);
    const leg = plan[1] as Leg;
    expect(legAngle(leg, 0, 0)).toBeCloseTo(0);
    expect(legAngle(leg, 0.5, 0)).toBeCloseTo(60);
    expect(legAngle(leg, 1, 120)).toBeCloseTo(120);
  });

  it('a turn to the left runs on below zero, as the angles of the playback do', () => {
    const left = { x: a.x, y: a.y, angle: -60 };
    const on = { ...ahead(a, -60), angle: -60 };
    const plan = planFlight(start, [a, left, on])!;
    expect(legAngle(plan[0] as Leg, 1, 0)).toBeCloseTo(-30);
    expect(legAngle(plan[2] as Leg, 1, -30)).toBeCloseTo(-60);
  });

  it('a half loop is flown on the spot, and a ship that only turns has no curve', () => {
    const about = { x: a.x, y: a.y, angle: 180 };
    const back = { ...ahead(about, 180), angle: 180 };
    const plan = planFlight(start, [a, about, back])!;
    expect(plan.map((s) => s.kind)).toEqual(['leg', 'spot', 'leg']);
    expect(legPoint(plan[0] as Leg, 1).x).toBeCloseTo(a.x);
    expect(legPoint(plan[0] as Leg, 1).y).toBeCloseTo(a.y);
    expect(legAngle(plan[0] as Leg, 1, 0)).toBeCloseTo(0);
    expect(legAngle(plan[2] as Leg, 0, 180)).toBeCloseTo(180);
    expect(planFlight(start, [{ x: 0, y: 0, angle: 60 }])).toBeNull();
  });

  it('a snap shot in a hex where the ship turns is fired where the nose points best at the target', () => {
    // the target is straight ahead of the ship as it comes in: it fires before it has turned away, short of the middle of the hex
    const far = { x: b.x, y: b.y - HEX * 6 };
    const early = planFlight(start, [a, { ...b, aim: far }, turned, c, d])!.filter((s): s is Leg => s.kind === 'leg');
    expect(legLength(early[1]!)).toBeLessThan(0.75);
    expect(legAngle(early[1]!, 1, 0)).toBeLessThan(15);
    // the target is where the ship is turning to: it fires when it has come round, past the middle of the hex
    const side = { x: c.x + (c.x - b.x) * 6, y: c.y + (c.y - b.y) * 6 };
    const late = planFlight(start, [a, b, { ...turned, aim: side }, c, d])!.filter((s): s is Leg => s.kind === 'leg');
    expect(legLength(late[1]!)).toBeGreaterThan(1.25);
    expect(legAngle(late[1]!, 1, 0)).toBeGreaterThan(45);
    // either way the move is as long as it was, and in one piece
    for (const plan of [early, late]) {
      expect(plan.reduce((sum, l) => sum + legLength(l), 0)).toBeCloseTo(4);
      for (let i = 1; i < plan.length; i++) {
        expect(legPoint(plan[i]!, 0).x).toBeCloseTo(legPoint(plan[i - 1]!, 1).x);
        expect(legPoint(plan[i]!, 0).y).toBeCloseTo(legPoint(plan[i - 1]!, 1).y);
      }
      expect(legPoint(plan[3]!, 1).x).toBeCloseTo(d.x);
    }
    // a shot in a hex the ship flies straight through is fired in the middle of it
    const straight = planFlight(start, [{ ...a, aim: far }, b])!.filter((s): s is Leg => s.kind === 'leg');
    expect(legLength(straight[0]!)).toBeCloseTo(1);
  });

  it('a planned roll is flown as one whole roll over two legs in the middle of the move', () => {
    const rolled = planFlight(start, [a, b, turned, c, d], 1)!.filter((s): s is Leg => s.kind === 'leg');
    expect(rolled.map((l) => l.spin)).toEqual([null, [0, 0.5], [0.5, 1], null]);
    expect(legs.every((l) => l.spin === null)).toBe(true);
  });

  it('a slide is flown sideways: the nose stays nearly where it was, and the ship is known to be drifting', () => {
    // forward, a slide to the left (the hex ahead and to the left, facing unchanged), forward
    const slid = { ...ahead(a, -60), angle: 0 };
    const on = { ...ahead(slid, 0), angle: 0 };
    const plan = planFlight(start, [a, slid, on])!.filter((s): s is Leg => s.kind === 'leg');
    let last = 0;
    for (const leg of plan) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        last = legAngle(leg, Math.min(1, t), last);
        expect(Math.abs(last)).toBeLessThan(12);
      }
    }
    expect(last).toBeCloseTo(0);
    expect(legSlide(plan[1]!, 0.5)).toBeCloseTo(-60);
    expect(legSlide(plan[0]!, 0.25)).toBeCloseTo(0);
    expect(legPoint(plan[2]!, 1).x).toBeCloseTo(on.x);
    expect(legPoint(plan[2]!, 1).y).toBeCloseTo(on.y);
  });

  it('the leg into a half loop is marked: the ship sinks a little for it', () => {
    const about = { x: a.x, y: a.y, angle: 180 };
    const plan = planFlight(start, [a, about, { ...ahead(about, 180), angle: 180 }])!;
    expect(plan.map((s) => (s.kind === 'leg' ? s.dip : null))).toEqual([true, null, false]);
  });

  it('rolls need hexes to be flown in: no more are shown than there are free hexes', () => {
    const spins = (poses: Parameters<typeof planFlight>[1], rolls: number): ([number, number] | null)[] => (planFlight(start, poses, rolls) ?? []).flatMap((s) => (s.kind === 'leg' ? [s.spin] : []));
    // two rolls and four hexes: both, one after the other, each over two legs
    expect(spins([a, b, turned, c, d], 2)).toEqual([[0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2]]);
    // two rolls and one hex: one roll
    expect(spins([a], 2)).toEqual([[0, 1]]);
    // two rolls, one hex and a half loop in it: the hex is taken up by the loop, no roll is shown
    const about = { x: a.x, y: a.y, angle: 180 };
    expect(spins([a, about], 2)).toEqual([null]);
    // a hex, a half loop and a hex back: only the hex after the loop is free, so one roll there
    expect(spins([a, about, { ...ahead(about, 180), angle: 180 }], 2)).toEqual([null, [0, 1]]);
  });
});

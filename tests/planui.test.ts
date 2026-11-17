import { describe, expect, it } from 'vitest';
import { createGame, dogfightOptions, emptyPlan, planShapeError, speedAfterMarkers, type DogfightMix } from '../src/engine';
import { applySpeed, applyTightTurn, speedChoices, tightTurnOf, TIGHT_TURNS } from '../src/ui/planmodel';
import { choosePanelSpot } from '../src/ui/placement';
import { stackSlots } from '../src/ui/stacks';

const mixes: DogfightMix[] = ['one', 'two', 'three', 'four'];

describe('speed bar choices', () => {
  it('every reachable speed is reached by exactly the plan it comes with', () => {
    let reachable = 0;
    for (const mix of mixes) {
      for (const ship of createGame(dogfightOptions(mix, 1)).ships) {
        for (const speed of [0, 2, 5]) {
          ship.speed = speed;
          for (const choice of speedChoices(ship)) {
            if (!choice.fields) continue;
            const plan = emptyPlan();
            applySpeed(plan, choice);
            expect(planShapeError(plan, true)).toBeNull();
            expect(speedAfterMarkers(ship, plan)).toBe(choice.speed);
            reachable += 1;
          }
        }
      }
    }
    expect(reachable).toBeGreaterThan(50);
  });

  it('costs nothing to keep the speed, and charges overspeed above the maximum', () => {
    const ship = createGame(dogfightOptions('one', 1)).ships[0]!;
    ship.speed = ship.maxSpeed;
    const choices = speedChoices(ship);
    expect(choices[ship.speed]!.cost).toBe(0);
    expect(choices[ship.maxSpeed + 1]!.overspeed).toBe(true);
    expect(choices[ship.maxSpeed + 1]!.fields!.overspeed).toBe(1);
    expect(choices[ship.maxSpeed + 1]!.cost).toBeGreaterThan(choices[ship.maxSpeed - 1]!.cost ?? 0);
  });

  it('lets a ship above its maximum fall back to it for nothing, but charges for slowing further', () => {
    const ship = createGame(dogfightOptions('one', 1)).ships[0]!;
    ship.speed = ship.maxSpeed + 1;
    const choices = speedChoices(ship);
    const back = choices[ship.maxSpeed]!;
    expect(back.cost).toBe(0);
    expect(back.fields).toEqual({ accelerate: 0, overaccelerate: 0, decelerate: 0, overdecelerate: 0, overspeed: 0 });
    expect(speedAfterMarkers(ship, emptyPlan())).toBe(ship.maxSpeed);
    // one step further down is a double decelerate from the speed it really has
    const lower = choices[ship.maxSpeed - 1]!;
    expect(lower.fields!.decelerate).toBe(2);
    expect(speedAfterMarkers(ship, { ...emptyPlan(), decelerate: 2 })).toBe(ship.maxSpeed - 1);
    // staying above the maximum still needs overspeed
    expect(choices[ship.speed]!.fields!.overspeed).toBe(1);
  });

  it('cannot reach a speed more than four away', () => {
    const ship = createGame(dogfightOptions('one', 1)).ships[0]!;
    ship.speed = 0;
    expect(speedChoices(ship).find((c) => c.speed === 5)!.fields).toBeNull();
  });
});

describe('tight turns', () => {
  it('round-trips through the plan and keeps bank and overturn apart', () => {
    for (const t of TIGHT_TURNS) {
      const plan = emptyPlan();
      applyTightTurn(plan, t.reduction);
      expect(tightTurnOf(plan)).toBe(t.reduction);
      expect(plan.bank > 0 && plan.overturn > 0).toBe(false);
    }
    const plan = emptyPlan();
    applyTightTurn(plan, 3);
    applyTightTurn(plan, 0);
    expect(tightTurnOf(plan)).toBe(0);
  });
});

describe('planning box placement', () => {
  const view = { w: 1000, h: 600 };
  const box = { w: 300, h: 400 };

  it('goes beside the ship, on the side with room', () => {
    const focus = { x: 800, y: 300, r: 30 };
    const spot = choosePanelSpot(view, box, focus, [focus]);
    expect(spot.x + box.w).toBeLessThanOrEqual(focus.x - focus.r);
  });

  it('keeps off the ships and inside the view', () => {
    const focus = { x: 150, y: 300, r: 30 };
    const others = [{ x: 450, y: 300, r: 30 }, { x: 500, y: 100, r: 30 }];
    const spot = choosePanelSpot(view, box, focus, [focus, ...others]);
    expect(spot.x).toBeGreaterThanOrEqual(0);
    expect(spot.y).toBeGreaterThanOrEqual(0);
    expect(spot.x + box.w).toBeLessThanOrEqual(view.w);
    expect(spot.y + box.h).toBeLessThanOrEqual(view.h);
    for (const d of [focus, ...others]) {
      const covered = d.x > spot.x - d.r && d.x < spot.x + box.w + d.r && d.y > spot.y - d.r && d.y < spot.y + box.h + d.r;
      expect(covered).toBe(false);
    }
  });

  it('keeps off the firing arc when it can', () => {
    const focus = { x: 500, y: 300, r: 30 };
    // an arc running to the right of the ship: the nearest free place is to its left
    const arc = Array.from({ length: 5 }, (_, k) => ({ x: 560 + k * 50, y: 300, r: 25 }));
    const spot = choosePanelSpot(view, box, focus, [focus], 8, arc);
    for (const d of arc) {
      const covered = d.x > spot.x - d.r && d.x < spot.x + box.w + d.r && d.y > spot.y - d.r && d.y < spot.y + box.h + d.r;
      expect(covered).toBe(false);
    }
  });
});

describe('ships sharing a hex', () => {
  it('gives each ship of a stack its own slot and leaves single ships alone', () => {
    const at = (q: number, r: number) => ({ q, r });
    const ships = [
      { id: 'A', pos: at(1, 1) }, { id: 'B', pos: at(1, 1) }, { id: 'C', pos: at(5, 5) },
      { id: 'D', pos: at(2, 2) }, { id: 'E', pos: at(2, 2) }, { id: 'F', pos: at(2, 2) }, { id: 'G', pos: null },
    ];
    const slots = stackSlots(ships);
    expect(slots.has('C')).toBe(false);
    expect(slots.has('G')).toBe(false);
    for (const group of [['A', 'B'], ['D', 'E', 'F']]) {
      const spots = group.map((id) => slots.get(id)!);
      expect(new Set(spots.map((s) => `${s.dx},${s.dy}`)).size).toBe(group.length);
      expect(spots.every((s) => s.k < 0.6)).toBe(true);
    }
  });
});

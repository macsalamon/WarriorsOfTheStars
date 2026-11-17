import { describe, expect, it } from 'vitest';
import { createGame } from '../src/engine';
import { crewOf } from '../src/ui/crew';

describe('the crew aboard a ship', () => {
  it('has a pilot, the gunners that were bought, and the R2 unit: at most three', () => {
    // ships with their gunners, as the purchase creates them
    const g = createGame({ seed: 1, ships: [
      { owner: 0, typeId: 'millennium-falcon', quality: 'average', gunners: ['average', 'veteran'] },
      { owner: 0, typeId: 'y-wing-2seat', quality: 'average', gunners: ['average'] },
      { owner: 0, typeId: 'x-wing', quality: 'average' },
      { owner: 1, typeId: 'imperial-shuttle', quality: 'average', gunners: ['poor'] },
    ] });
    const ids = (i: number) => crewOf(g.ships[i]!).map((c) => c.id);
    expect(ids(0)).toEqual(['pilot', 'gunner1', 'gunner2']);
    expect(ids(1)).toEqual(['pilot', 'gunner1', 'r2']);
    expect(ids(2)).toEqual(['pilot', 'r2']);
    expect(ids(3)).toEqual(['pilot', 'gunner1']);
    for (let i = 0; i < 4; i++) expect(ids(i).length).toBeLessThanOrEqual(3);
    expect(crewOf(g.ships[0]!).map((c) => c.label)).toEqual(['Pilot', 'Gunner 1', 'Gunner 2']);
    expect(crewOf(g.ships[1]!)[1]!.label).toBe('Gunner');
    expect(crewOf(g.ships[0]!)[2]!.quality).toBe('veteran');
    // the pilot's icon speaks of his gunnery: the piloting skill is always on the sheet
    expect(crewOf(g.ships[0]!)[0]!.skill).toEqual(g.ships[0]!.gunnerySkill);
    expect(crewOf(g.ships[0]!)[1]!.skill).toEqual(g.ships[0]!.gunners![0]!.skill);
    // the pictures follow the side
    expect(crewOf(g.ships[0]!)[0]!.picture).toContain('pilot-rebel');
    expect(crewOf(g.ships[3]!)[1]!.picture).toContain('gunner-empire');
  });
});

import {
  assertPrereqsResolved,
  prerequisiteClosure,
  topologicalSortSkills,
  UnitsGraphError,
} from './units-graph.util';

describe('units-graph.util', () => {
  const skills = [
    { id: 'a', title: 'A', prerequisites: [], level: 1 },
    { id: 'b', title: 'B', prerequisites: ['a'], level: 1 },
    { id: 'c', title: 'C', prerequisites: ['b'], level: 2 },
  ];

  it('topo-sorts prerequisites first', () => {
    expect(topologicalSortSkills(skills).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('rejects cycles', () => {
    expect(() =>
      topologicalSortSkills([
        { id: 'a', title: 'A', prerequisites: ['b'], level: 1 },
        { id: 'b', title: 'B', prerequisites: ['a'], level: 1 },
      ]),
    ).toThrow(UnitsGraphError);
  });

  it('rejects unresolved prereqs', () => {
    expect(() =>
      assertPrereqsResolved([
        { id: 'a', title: 'A', prerequisites: ['missing'], level: 1 },
      ]),
    ).toThrow(/CONTENT_PREREQ_UNRESOLVED|not in skills/);
  });

  it('closes prerequisites', () => {
    const map = new Map(skills.map((s) => [s.id, s]));
    expect([...prerequisiteClosure(['c'], map)].sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

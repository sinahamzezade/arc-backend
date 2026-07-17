import type { Unit } from './entities/unit.entity';
import {
  battleUnitQuestionVersionId,
  battleUnitTemplateId,
  extractQuizQuestions,
  flattenQuizUnitsToPool,
  levelToDifficulty,
  mapQuizQuestionToSnapshot,
  skillIdMatchesTaught,
  topicMatchesSkills,
  uuidV5FromName,
} from './unit-battle-question.util';

function quizUnit(
  overrides: Partial<Unit> & Pick<Unit, 'id' | 'content'>,
): Unit {
  return {
    id: overrides.id,
    title: overrides.title ?? 'Quiz',
    skillsTaught: overrides.skillsTaught ?? ['sql:select'],
    prerequisites: [],
    level: overrides.level ?? 1,
    estimatedMinutes: overrides.estimatedMinutes ?? 10,
    formats: ['quiz'],
    lessonType: 'quiz',
    domain: 'data',
    stack: overrides.stack ?? 'sql',
    provider: null,
    url: null,
    xp: 25,
    content: overrides.content,
    servesStage: [1],
    unitRole: 'checkpoint',
    profileSkillSlug: 'sql',
    sourceTemplateId: null,
    sourceVersionId: null,
    isActive: overrides.isActive ?? true,
    simulationAssetKey: null,
    actionVocabulary: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Unit;
}

describe('unit-battle-question.util', () => {
  it('uuidV5 is stable and version-5 shaped', () => {
    const a = uuidV5FromName('battle-unit:u1:0');
    const b = uuidV5FromName('battle-unit:u1:0');
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(battleUnitTemplateId('u1')).not.toBe(
      battleUnitQuestionVersionId('u1', 0),
    );
  });

  it('maps level to difficulty bands', () => {
    expect(levelToDifficulty(1).difficulty).toBe('easy');
    expect(levelToDifficulty(2).difficulty).toBe('medium');
    expect(levelToDifficulty(3).difficulty).toBe('hard');
    expect(levelToDifficulty(4).difficulty).toBe('expert');
  });

  it('maps mcq quiz question to battle snapshot', () => {
    const unit = quizUnit({
      id: 'sql-select-quiz',
      level: 2,
      content: {
        objective: 't',
        passScore: 1,
        questions: [
          {
            q: 'Which clause filters rows?',
            type: 'mcq',
            options: ['WHERE', 'HAVING', 'GROUP BY'],
            answer: 0,
            explain: 'WHERE filters before aggregate',
          },
        ],
      },
    });
    const q = extractQuizQuestions(unit.content)[0]!;
    const snap = mapQuizQuestionToSnapshot(unit, q, 0, 30);
    expect(snap).not.toBeNull();
    expect(snap!.prompt).toEqual({ stem: 'Which clause filters rows?' });
    expect(snap!.options).toEqual([
      { id: 'o0', label: 'WHERE' },
      { id: 'o1', label: 'HAVING' },
      { id: 'o2', label: 'GROUP BY' },
    ]);
    expect(snap!.correctOptionIds).toEqual(['o0']);
    expect(snap!.difficulty).toBe('medium');
    expect(snap!.explanation).toBe('WHERE filters before aggregate');
    expect(snap!.questionTemplateId).toBe(battleUnitTemplateId(unit.id));
    expect(snap!.questionVersionId).toBe(
      battleUnitQuestionVersionId(unit.id, 0),
    );
  });

  it('maps boolean quiz question to True/False options', () => {
    const unit = quizUnit({
      id: 'bool-quiz',
      content: {
        objective: 't',
        passScore: 1,
        questions: [{ q: 'NULL equals NULL?', type: 'boolean', answer: false }],
      },
    });
    const q = extractQuizQuestions(unit.content)[0]!;
    const snap = mapQuizQuestionToSnapshot(unit, q, 0);
    expect(snap!.options).toEqual([
      { id: 'o0', label: 'True' },
      { id: 'o1', label: 'False' },
    ]);
    expect(snap!.correctOptionIds).toEqual(['o1']);
    expect(snap!.questionType).toBe('boolean');
  });

  it('flattens quiz units and skips non-quiz / inactive', () => {
    const units = [
      quizUnit({
        id: 'a',
        content: {
          objective: 't',
          passScore: 1,
          questions: [
            {
              q: 'Q1',
              type: 'mcq',
              options: ['A', 'B'],
              answer: 1,
            },
          ],
        },
      }),
      quizUnit({
        id: 'b',
        isActive: false,
        content: {
          objective: 't',
          passScore: 1,
          questions: [
            { q: 'Q2', type: 'mcq', options: ['A', 'B'], answer: 0 },
          ],
        },
      }),
      {
        ...quizUnit({
          id: 'c',
          content: { objective: 'read', sections: ['x'] },
        }),
        lessonType: 'reading',
      } as Unit,
    ];
    const pool = flattenQuizUnitsToPool(units);
    expect(pool).toHaveLength(1);
    expect(pool[0]!.unitId).toBe('a');
    expect(pool[0]!.correctOptionIds).toEqual(['o1']);
  });

  it('matches topic / skill filters', () => {
    expect(topicMatchesSkills(['sql:select'], 'SELECT')).toBe(true);
    expect(topicMatchesSkills(['sql:select'], 'where')).toBe(false);
    expect(skillIdMatchesTaught(['sql:select'], 'sql:select')).toBe(true);
    expect(skillIdMatchesTaught(['sql:select'], 'sql:where')).toBe(false);
  });
});

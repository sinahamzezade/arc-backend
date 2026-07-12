import { ContentPublicationStatus, SELECTION_WEIGHTS } from './content-pool.constants';
import { ContentPersonalizationService } from './content-personalization.service';
import { ContentPublicationService } from './content-publication.service';
import { QuestionPoolService } from './question-pool.service';

describe('ContentPublicationService graph validation', () => {
  it('detects cycles via adjacency walk', async () => {
    const skills = [
      { id: 'a', prerequisiteSkillIds: ['b'], isActive: true },
      { id: 'b', prerequisiteSkillIds: ['a'], isActive: true },
    ];
    const svc = Object.create(ContentPublicationService.prototype) as {
      skillsRepo: { find: () => Promise<typeof skills> };
      validateGraph: ContentPublicationService['validateGraph'];
    };
    svc.skillsRepo = { find: async () => skills };
    svc.validateGraph = ContentPublicationService.prototype.validateGraph;

    await expect(svc.validateGraph()).rejects.toMatchObject({
      code: 'CONTENT_GRAPH_CYCLE',
    });
  });
});

describe('selection weights', () => {
  it('sums to 1', () => {
    const sum = Object.values(SELECTION_WEIGHTS).reduce(
      (a: number, b: number) => a + b,
      0,
    );
    expect(sum).toBeCloseTo(1);
  });
});

describe('ContentPersonalizationService budget', () => {
  it('flags required budget exceeded', () => {
    const svc = Object.create(
      ContentPersonalizationService.prototype,
    ) as ContentPersonalizationService;
    expect(() =>
      svc.assertFeasible({
        goalId: 'g',
        budgetMinutes: 100,
        feasibility: 'required_budget_exceeded',
        requiredMinutes: 500,
        selected: [],
        skippedKnownSkillIds: [],
        language: 'en',
        gap: {} as never,
      }),
    ).toThrow();
  });
});

describe('QuestionPoolService play payload', () => {
  it('strips answer keys', () => {
    const svc = Object.create(QuestionPoolService.prototype) as QuestionPoolService;
    const play = svc.toPlayPayload({
      questionTemplateId: 't',
      questionVersionId: 'v',
      version: 1,
      questionType: 'mcq',
      difficulty: 'beginner',
      difficultyScore: 0.4,
      estimatedSeconds: 30,
      prompt: { stem: 'Q?' },
      options: [{ id: 'a', label: 'A' }],
      correctOptionIds: ['a'],
      explanation: 'Because A',
      calibrationKey: 'beginner:0.4',
    });
    expect(play).not.toHaveProperty('answer');
    expect(play).not.toHaveProperty('correctOptionIds');
    expect(play).not.toHaveProperty('explanation');
    expect(play.options).toEqual([{ id: 'a', label: 'A' }]);
  });
});

describe('ContentPublicationStatus', () => {
  it('has draft→published lifecycle values', () => {
    expect(ContentPublicationStatus.Draft).toBe('draft');
    expect(ContentPublicationStatus.Published).toBe('published');
    expect(ContentPublicationStatus.Retired).toBe('retired');
  });
});

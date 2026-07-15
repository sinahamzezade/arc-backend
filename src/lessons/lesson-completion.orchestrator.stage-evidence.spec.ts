import { Unit } from '../content-pool/entities/unit.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import {
  LearnerProfileSnapshot,
  LearnerProfileStatus,
  StageConfidence,
} from '../questionnaire/entities/learner-profile-snapshot.entity';
import {
  LearnerSkillEstimate,
  SkillEvidenceSource,
} from '../questionnaire/entities/learner-skill-estimate.entity';
import { RemediationEvent } from './entities/remediation-event.entity';
import { LessonCompletionOrchestrator } from './lesson-completion.orchestrator';

describe('LessonCompletionOrchestrator stage evidence', () => {
  it('raises verified stage and refreshes aggregate profile after a strong checkpoint quiz', async () => {
    const profile = {
      id: 'profile-1',
      userId: 'user-1',
      status: LearnerProfileStatus.Provisional,
      provisionalStage: 2,
      verifiedStage: null,
      targetStage: 4,
      stageGap: 2,
      stageConfidence: StageConfidence.Medium,
    } as LearnerProfileSnapshot;
    const estimate = {
      id: 'estimate-1',
      profileId: profile.id,
      skillSlug: 'digital-marketing',
      selfExposureLevel: 'follow_with_help',
      provisionalStage: 2,
      verifiedStage: null,
      confidence: StageConfidence.Medium,
      evidenceSource: SkillEvidenceSource.Questionnaire,
      evidenceMeta: {},
    } as LearnerSkillEstimate;

    const profileRepo = {
      findOne: jest.fn().mockResolvedValue(profile),
      save: jest.fn(async (row: LearnerProfileSnapshot) => row),
    };
    const estimateRepo = {
      findOne: jest.fn().mockResolvedValue(estimate),
      find: jest.fn().mockResolvedValue([estimate]),
      create: jest.fn((row: Partial<LearnerSkillEstimate>) => row),
      save: jest.fn(async (row: LearnerSkillEstimate) => row),
    };
    const remediationRepo = {
      exists: jest.fn().mockResolvedValue(false),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === LearnerProfileSnapshot) return profileRepo;
        if (entity === LearnerSkillEstimate) return estimateRepo;
        if (entity === RemediationEvent) return remediationRepo;
        if (entity === Unit) return { findOne: jest.fn() };
        throw new Error('unexpected repo');
      }),
    };
    const orchestrator = new LessonCompletionOrchestrator(
      dataSource as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );

    await (
      orchestrator as unknown as {
        recordSkillEvidence: (input: {
          userId: string;
          lesson: Lesson;
          attemptId: string;
          quizCorrect: number;
          quizTotal: number;
          practiceDone: boolean;
        }) => Promise<void>;
      }
    ).recordSkillEvidence({
      userId: 'user-1',
      lesson: {
        id: 'lesson-1',
        unitId: 'email-quiz',
        unitRole: 'checkpoint',
        servesStage: [3, 4, 5],
        skillsTaught: ['digital-marketing:email-marketing'],
      } as Lesson,
      attemptId: 'attempt-1',
      quizCorrect: 4,
      quizTotal: 5,
      practiceDone: false,
    });

    expect(estimate.provisionalStage).toBe(3);
    expect(estimate.verifiedStage).toBe(3);
    expect(estimate.confidence).toBe(StageConfidence.High);
    expect(profile.provisionalStage).toBe(3);
    expect(profile.verifiedStage).toBe(3);
    expect(profile.stageGap).toBe(1);
    expect(profile.stageConfidence).toBe(StageConfidence.High);
  });
});

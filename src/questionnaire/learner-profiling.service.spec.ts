import { LearnerProfilingService } from './learner-profiling.service';
import { StageConfidence } from './entities/learner-profile-snapshot.entity';

describe('LearnerProfilingService', () => {
  const service = new LearnerProfilingService();

  it('derives beginner profile from empty/low evidence', () => {
    const derived = service.derive({
      goal: { primary: 'frontend', secondary: [] },
      motivation: ['personal_interest'],
      currentContext: 'student',
      useFrequency: 'never_used',
      skills: [],
      selfStage: '1',
      studyHours: '3-5',
      preferredSessionMinutes: '45',
      schedule: { days: ['mon', 'wed', 'fri'], times: ['evening'] },
      timezone: 'UTC',
      targetOutcome: 'understand_basics',
      deadline: '3-6',
      learningStyle: ['doing', 'videos'],
      confidence: 'starting',
      barriers: ['lack_of_time'],
    });

    expect(derived.primaryTrackSlug).toBe('frontend');
    expect(derived.selfReportedStage).toBe(1);
    expect(derived.provisionalStage).toBeLessThanOrEqual(2);
    expect(derived.targetStage).toBe(2);
    expect(derived.weeklyDeclaredMinutes).toBe(240);
    expect(derived.weeklyEffectiveMinutes).toBeLessThanOrEqual(240);
    expect(derived.diagnosticRequired).toBe(false);
  });

  it('maps per-skill exposure to stages and flags placement for high claims', () => {
    const derived = service.derive({
      goal: { primary: 'frontend', secondary: ['backend'] },
      motivation: ['change_career'],
      currentContext: 'career_switcher',
      useFrequency: 'personal_projects',
      skills: [
        { skillSlug: 'html-css', exposureLevel: 'use_professionally' },
        { skillSlug: 'javascript', exposureLevel: 'heard_of' },
      ],
      selfStage: '4',
      studyHours: '8-12',
      preferredSessionMinutes: '60',
      schedule: {
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        times: ['evening'],
      },
      targetOutcome: 'job_ready',
      deadline: '1-3',
      learningStyle: ['doing'],
      confidence: 'very',
      barriers: ['unclear_plan'],
    });

    expect(derived.secondaryTrackSlugs).toContain('backend');
    expect(derived.targetStage).toBe(5);
    expect(derived.skillEstimates).toHaveLength(2);
    const html = derived.skillEstimates.find((s) => s.skillSlug === 'html-css');
    expect(html?.provisionalStage).toBeGreaterThanOrEqual(3);
    expect(derived.diagnosticRequired).toBe(true);
    expect(derived.diagnosticReasonCodes.length).toBeGreaterThan(0);
  });

  it('scoreToStage uses documented boundaries', () => {
    expect(service.scoreToStage(0)).toBe(1);
    expect(service.scoreToStage(19)).toBe(1);
    expect(service.scoreToStage(20)).toBe(2);
    expect(service.scoreToStage(39)).toBe(2);
    expect(service.scoreToStage(40)).toBe(3);
    expect(service.scoreToStage(59)).toBe(3);
    expect(service.scoreToStage(60)).toBe(4);
    expect(service.scoreToStage(79)).toBe(4);
    expect(service.scoreToStage(80)).toBe(5);
    expect(service.scoreToStage(100)).toBe(5);
  });

  it('builds a readable preview', () => {
    const derived = service.derive({
      goal: { primary: 'frontend', secondary: [] },
      motivation: ['earn_more'],
      currentContext: 'employed',
      useFrequency: 'work_sometimes',
      skills: [{ skillSlug: 'javascript', exposureLevel: 'follow_with_help' }],
      selfStage: '2',
      studyHours: '5-8',
      preferredSessionMinutes: '45',
      schedule: { days: ['sat', 'sun'], times: ['morning'] },
      targetOutcome: 'use_independently',
      deadline: '6-12',
      learningStyle: ['reading', 'quizzes'],
      confidence: 'somewhat',
      barriers: ['motivation_drops'],
    });
    const preview = service.toPreview(derived);
    expect(preview.youAreHere).toContain('Stage');
    expect(preview.youWantToReach).toContain('Stage 3');
    expect(preview.yourPace).toContain('min/week');
    expect(preview.skillMap[0]?.skillSlug).toBe('javascript');
    expect(preview.stageConfidence).toBeDefined();
    expect([
      StageConfidence.Low,
      StageConfidence.Medium,
      StageConfidence.High,
    ]).toContain(preview.stageConfidence);
  });
});

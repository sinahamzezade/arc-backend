import { Injectable } from '@nestjs/common';
import {
  CAPACITY_SUSTAINABILITY,
  CONFIDENCE_CALIBRATION,
  EXPOSURE_LEVELS,
  EXPOSURE_SCORES,
  PROFILING_MODEL_VERSION,
  SELF_STAGE_SCORES,
  SESSION_MINUTE_OPTIONS,
  STYLE_TO_FORMAT,
  TARGET_OUTCOME_STAGE,
  USE_FREQUENCY_SCORES,
  WEEKLY_HOURS_MINUTES,
  type ExposureLevel,
} from './constants/profiling';
import {
  PaceClass,
  StageConfidence,
  type LearnerProfileSnapshot,
} from './entities/learner-profile-snapshot.entity';
import { SkillEvidenceSource } from './entities/learner-skill-estimate.entity';
import {
  asOptionalString,
  asSchedule,
  asSkillEvidence,
  asString,
  asStringArray,
  type QuestionnaireAnswers,
  type SkillEvidenceAnswer,
} from './types/answers';

export type DerivedSkillEstimate = {
  skillSlug: string;
  selfExposureLevel: string;
  provisionalStage: number;
  verifiedStage: null;
  confidence: StageConfidence;
  evidenceSource: SkillEvidenceSource;
};

export type DerivedLearnerProfile = {
  primaryTrackSlug: string;
  secondaryTrackSlugs: string[];
  selfReportedStage: number;
  provisionalStage: number;
  verifiedStage: null;
  stageScore: number;
  stageConfidence: StageConfidence;
  targetStage: number;
  stageGap: number;
  weeklyDeclaredMinutes: number;
  weeklyEffectiveMinutes: number;
  preferredSessionMinutes: number;
  preferredDays: string[];
  preferredTimeWindows: string[];
  timezone: string;
  paceClass: PaceClass;
  motivationTags: string[];
  learningStyleWeights: Record<string, number>;
  blockerTags: string[];
  diagnosticRequired: boolean;
  diagnosticReasonCodes: string[];
  profilingModelVersion: string;
  normalizedInput: Record<string, unknown>;
  skillEstimates: DerivedSkillEstimate[];
  feasibility: FeasibilityPreview;
};

export type FeasibilityPreview = {
  state: 'feasible' | 'slightly_tight' | 'intensive_option' | 'unrealistic';
  requiredWeeksEstimate: number | null;
  deadlineWeeks: number | null;
  message: string;
  alternatives: string[];
};

export type ProfilePreviewDto = {
  primaryTrackSlug: string;
  secondaryTrackSlugs: string[];
  selfReportedStage: number;
  provisionalStage: number;
  stageConfidence: StageConfidence;
  targetStage: number;
  stageGap: number;
  paceClass: PaceClass;
  weeklyEffectiveMinutes: number;
  preferredSessionMinutes: number;
  skillMap: Array<{
    skillSlug: string;
    provisionalStage: number;
    confidence: StageConfidence;
    exposureLevel: string;
  }>;
  diagnosticRequired: boolean;
  diagnosticReasonCodes: string[];
  feasibility: FeasibilityPreview;
  youAreHere: string;
  youWantToReach: string;
  yourPace: string;
};

const STAGE_LABELS: Record<number, string> = {
  1: 'Beginner',
  2: 'Medium',
  3: 'Pro',
  4: 'Advanced',
  5: 'Job-ready Specialist',
};

const DEADLINE_WEEKS: Record<string, number | null> = {
  '1-3': 8,
  '3-6': 16,
  '6-12': 24,
  '12+': 40,
  none: null,
};

@Injectable()
export class LearnerProfilingService {
  derive(answers: QuestionnaireAnswers): DerivedLearnerProfile {
    const tracks = this.resolveTracks(answers);
    const selfReportedStage = this.resolveSelfStage(answers);
    const skillEvidence = asSkillEvidence(answers, 'skills');
    const skillEstimates = this.deriveSkillEstimates(skillEvidence);
    const useFrequency =
      asString(answers, 'useFrequency') ||
      asString(answers, 'currentContextFrequency') ||
      'never_used';
    const contextScore =
      USE_FREQUENCY_SCORES[useFrequency] ?? USE_FREQUENCY_SCORES.never_used;

    const skillAvg =
      skillEstimates.length > 0
        ? skillEstimates.reduce(
            (sum, s) =>
              sum +
              (EXPOSURE_SCORES[s.selfExposureLevel as ExposureLevel] ?? 15),
            0,
          ) / skillEstimates.length
        : null;

    const selfScore = SELF_STAGE_SCORES[selfReportedStage] ?? 10;
    const confidenceToken =
      asString(answers, 'confidence') || asString(answers, 'confidenceLevel');
    const confidenceAdj = CONFIDENCE_CALIBRATION[confidenceToken] ?? 0;

    const signals: Array<{ value: number; weight: number }> = [
      { value: selfScore, weight: 30 },
    ];
    if (skillAvg != null) signals.push({ value: skillAvg, weight: 40 });
    signals.push({ value: contextScore, weight: 15 });
    // confidence calibrates ±5, modelled as small weighted signal
    signals.push({
      value: Math.max(0, Math.min(100, selfScore + confidenceAdj * 5)),
      weight: 5,
    });

    const weightSum = signals.reduce((s, x) => s + x.weight, 0);
    let stageScore =
      signals.reduce((s, x) => s + x.value * x.weight, 0) / weightSum;
    stageScore = Math.max(0, Math.min(100, stageScore + confidenceAdj));

    const provisionalStage = this.scoreToStage(stageScore);
    const stageConfidence = this.computeConfidence({
      signalCount: signals.length,
      signalValues: signals.map((s) => s.value),
      selfReportedStage,
      skillEstimates,
      hasSkillDepth: skillEstimates.length > 0,
    });

    const targetOutcome =
      asString(answers, 'targetOutcome') ||
      asString(answers, 'outcome') ||
      'understand_basics';
    const targetStage = TARGET_OUTCOME_STAGE[targetOutcome] ?? 2;
    const stageGap = Math.max(0, targetStage - provisionalStage);

    const capacity = this.computeCapacity(answers);
    const motivationTags = asStringArray(answers, 'motivation').filter(
      (v) => v !== 'other',
    );
    const blockerTags = asStringArray(answers, 'barriers').length
      ? asStringArray(answers, 'barriers')
      : asStringArray(answers, 'quitReasons');
    const learningStyleWeights = this.normalizeStyleWeights(
      asStringArray(answers, 'learningStyle'),
    );

    const diagnostic = this.placementDecision({
      provisionalStage,
      selfReportedStage,
      stageConfidence,
      skillEstimates,
      targetStage,
    });

    const deadline =
      asString(answers, 'deadline') || asString(answers, 'targetDeadline');
    const feasibility = this.computeFeasibility({
      weeklyEffectiveMinutes: capacity.weeklyEffectiveMinutes,
      deadlineToken: deadline,
      stageGap,
    });

    const schedule = asSchedule(answers, 'schedule');
    const timezone =
      asOptionalString(answers, 'timezone') ||
      (typeof answers.schedule === 'object' &&
      answers.schedule &&
      'timezone' in (answers.schedule as object)
        ? String((answers.schedule as { timezone?: string }).timezone || 'UTC')
        : 'UTC');

    return {
      primaryTrackSlug: tracks.primary,
      secondaryTrackSlugs: tracks.secondary,
      selfReportedStage,
      provisionalStage,
      verifiedStage: null,
      stageScore: Math.round(stageScore * 10) / 10,
      stageConfidence,
      targetStage,
      stageGap,
      weeklyDeclaredMinutes: capacity.weeklyDeclaredMinutes,
      weeklyEffectiveMinutes: capacity.weeklyEffectiveMinutes,
      preferredSessionMinutes: capacity.preferredSessionMinutes,
      preferredDays: schedule.days.map((d) => d.toLowerCase()),
      preferredTimeWindows: schedule.times,
      timezone,
      paceClass: capacity.paceClass,
      motivationTags,
      learningStyleWeights,
      blockerTags: blockerTags.filter((v) => v !== 'other'),
      diagnosticRequired: diagnostic.required,
      diagnosticReasonCodes: diagnostic.reasons,
      profilingModelVersion: PROFILING_MODEL_VERSION,
      normalizedInput: {
        tracks,
        selfReportedStage,
        skillEvidence,
        useFrequency,
        targetOutcome,
        deadline,
        confidenceToken,
      },
      skillEstimates,
      feasibility,
    };
  }

  toPreview(derived: DerivedLearnerProfile): ProfilePreviewDto {
    return {
      primaryTrackSlug: derived.primaryTrackSlug,
      secondaryTrackSlugs: derived.secondaryTrackSlugs,
      selfReportedStage: derived.selfReportedStage,
      provisionalStage: derived.provisionalStage,
      stageConfidence: derived.stageConfidence,
      targetStage: derived.targetStage,
      stageGap: derived.stageGap,
      paceClass: derived.paceClass,
      weeklyEffectiveMinutes: derived.weeklyEffectiveMinutes,
      preferredSessionMinutes: derived.preferredSessionMinutes,
      skillMap: derived.skillEstimates.map((s) => ({
        skillSlug: s.skillSlug,
        provisionalStage: s.provisionalStage,
        confidence: s.confidence,
        exposureLevel: s.selfExposureLevel,
      })),
      diagnosticRequired: derived.diagnosticRequired,
      diagnosticReasonCodes: derived.diagnosticReasonCodes,
      feasibility: derived.feasibility,
      youAreHere: `Stage ${derived.provisionalStage} — ${STAGE_LABELS[derived.provisionalStage] ?? 'Learner'} (${derived.stageConfidence} confidence)`,
      youWantToReach: `Stage ${derived.targetStage} — ${STAGE_LABELS[derived.targetStage] ?? 'Target'}`,
      yourPace: `${derived.paceClass} · ~${derived.weeklyEffectiveMinutes} effective min/week · ${derived.preferredSessionMinutes} min sessions`,
    };
  }

  toPublicSummary(profile: LearnerProfileSnapshot) {
    return {
      id: profile.id,
      version: profile.version,
      status: profile.status,
      primaryTrackSlug: profile.primaryTrackSlug,
      secondaryTrackSlugs: profile.secondaryTrackSlugs,
      selfReportedStage: profile.selfReportedStage,
      provisionalStage: profile.provisionalStage,
      verifiedStage: profile.verifiedStage,
      stageConfidence: profile.stageConfidence,
      targetStage: profile.targetStage,
      stageGap: profile.stageGap,
      paceClass: profile.paceClass,
      weeklyEffectiveMinutes: profile.weeklyEffectiveMinutes,
      preferredSessionMinutes: profile.preferredSessionMinutes,
      diagnosticRequired: profile.diagnosticRequired,
      diagnosticReasonCodes: profile.diagnosticReasonCodes,
      skillEstimates: (profile.skillEstimates ?? []).map((s) => ({
        skillSlug: s.skillSlug,
        provisionalStage: s.provisionalStage,
        verifiedStage: s.verifiedStage,
        confidence: s.confidence,
        exposureLevel: s.selfExposureLevel,
        evidenceSource: s.evidenceSource,
      })),
      createdAt: profile.createdAt?.toISOString?.() ?? null,
    };
  }

  scoreToStage(score: number): number {
    if (score < 20) return 1;
    if (score < 40) return 2;
    if (score < 60) return 3;
    if (score < 80) return 4;
    return 5;
  }

  exposureToStage(exposure: string): number {
    const score = EXPOSURE_SCORES[exposure as ExposureLevel] ?? 15;
    return this.scoreToStage(score);
  }

  private resolveTracks(answers: QuestionnaireAnswers): {
    primary: string;
    secondary: string[];
  } {
    // New shape: { primary, secondary[] }
    const track = answers.goal;
    if (track && typeof track === 'object' && !Array.isArray(track)) {
      const row = track as { primary?: unknown; secondary?: unknown };
      const primary = typeof row.primary === 'string' ? row.primary.trim() : '';
      const secondary = Array.isArray(row.secondary)
        ? row.secondary.filter((s): s is string => typeof s === 'string')
        : [];
      if (primary) {
        return {
          primary,
          secondary: secondary.filter((s) => s && s !== primary),
        };
      }
    }
    // Legacy multi-select: first = primary
    const roles = asStringArray(answers, 'goal');
    const primary = roles[0] ?? '';
    return {
      primary,
      secondary: roles.slice(1).filter((s) => s !== primary),
    };
  }

  private resolveSelfStage(answers: QuestionnaireAnswers): number {
    const raw =
      asString(answers, 'selfStage') || asString(answers, 'currentStage') || '';
    const n = Number(raw);
    if (n >= 1 && n <= 5) return n;
    // Map legacy confidence tokens roughly
    const conf = asString(answers, 'confidence');
    if (conf === 'starting' || conf === 'beginner') return 1;
    if (conf === 'somewhat') return 2;
    if (conf === 'confident') return 3;
    if (conf === 'very') return 4;
    return 1;
  }

  private deriveSkillEstimates(
    evidence: SkillEvidenceAnswer[],
  ): DerivedSkillEstimate[] {
    return evidence
      .filter((e) => e.skillSlug && e.skillSlug !== 'none')
      .map((e) => {
        const exposure = EXPOSURE_LEVELS.includes(
          e.exposureLevel as ExposureLevel,
        )
          ? e.exposureLevel
          : 'heard_of';
        const provisionalStage = this.exposureToStage(exposure);
        const confidence =
          exposure === 'use_professionally' || exposure === 'use_independently'
            ? StageConfidence.Medium
            : StageConfidence.Low;
        return {
          skillSlug: e.skillSlug,
          selfExposureLevel: exposure,
          provisionalStage,
          verifiedStage: null,
          confidence,
          evidenceSource: SkillEvidenceSource.Questionnaire,
        };
      });
  }

  private computeConfidence(input: {
    signalCount: number;
    signalValues: number[];
    selfReportedStage: number;
    skillEstimates: DerivedSkillEstimate[];
    hasSkillDepth: boolean;
  }): StageConfidence {
    const values = input.signalValues;
    const spread =
      values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;

    if (
      (input.selfReportedStage >= 4 && !input.hasSkillDepth) ||
      !input.hasSkillDepth ||
      spread > 35
    ) {
      return StageConfidence.Low;
    }
    if (input.signalCount >= 3 && spread <= 20) {
      return StageConfidence.High;
    }
    if (input.signalCount >= 2 && spread <= 35) {
      return StageConfidence.Medium;
    }
    return StageConfidence.Low;
  }

  private computeCapacity(answers: QuestionnaireAnswers): {
    weeklyDeclaredMinutes: number;
    weeklyEffectiveMinutes: number;
    preferredSessionMinutes: number;
    paceClass: PaceClass;
  } {
    const hoursToken =
      asString(answers, 'studyHours') ||
      asString(answers, 'weeklyHours') ||
      '3-5';
    const declared =
      WEEKLY_HOURS_MINUTES[hoursToken] ?? WEEKLY_HOURS_MINUTES['3-5'];

    let session = Number(
      asString(answers, 'preferredSessionMinutes') ||
        asString(answers, 'sessionMinutes') ||
        45,
    );
    if (
      !(SESSION_MINUTE_OPTIONS as readonly number[]).includes(session) &&
      !(session >= 15 && session <= 180)
    ) {
      session = 45;
    }

    const schedule = asSchedule(answers, 'schedule');
    const dayCount = Math.max(1, schedule.days.length || 3);
    const scheduleCap = dayCount * session;
    const effective = Math.round(
      Math.min(declared, scheduleCap) * CAPACITY_SUSTAINABILITY,
    );

    let paceClass = PaceClass.Balanced;
    if (effective < 150) paceClass = PaceClass.Light;
    else if (effective <= 300) paceClass = PaceClass.Balanced;
    else if (effective <= 540) paceClass = PaceClass.Focused;
    else paceClass = PaceClass.Intensive;

    return {
      weeklyDeclaredMinutes: declared,
      weeklyEffectiveMinutes: effective,
      preferredSessionMinutes: session,
      paceClass,
    };
  }

  private normalizeStyleWeights(styles: string[]): Record<string, number> {
    const mapped = styles.map((s) => STYLE_TO_FORMAT[s] ?? s).filter(Boolean);
    if (!mapped.length) {
      return { doing: 0.35, reading: 0.25, videos: 0.2, quiz: 0.2 };
    }
    const unique = [...new Set(mapped)];
    const w = 1 / unique.length;
    const out: Record<string, number> = {};
    for (const k of unique) out[k] = Math.round(w * 1000) / 1000;
    return out;
  }

  private placementDecision(input: {
    provisionalStage: number;
    selfReportedStage: number;
    stageConfidence: StageConfidence;
    skillEstimates: DerivedSkillEstimate[];
    targetStage: number;
  }): { required: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (input.provisionalStage >= 3) {
      reasons.push('PROVISIONAL_STAGE_HIGH');
    }
    if (Math.abs(input.selfReportedStage - input.provisionalStage) > 1) {
      reasons.push('SELF_EVIDENCE_MISMATCH');
    }
    if (
      input.stageConfidence === StageConfidence.Low &&
      input.provisionalStage >= 2
    ) {
      reasons.push('LOW_STAGE_CONFIDENCE');
    }
    const proClaim = input.skillEstimates.some(
      (s) => s.selfExposureLevel === 'use_professionally',
    );
    if (proClaim && input.stageConfidence !== StageConfidence.High) {
      reasons.push('PROFESSIONAL_CLAIM_WEAK_CONTEXT');
    }
    if (
      input.targetStage >= 4 &&
      input.stageConfidence === StageConfidence.Low
    ) {
      reasons.push('ADVANCED_TARGET_UNRELIABLE_LEVEL');
    }
    // Clear beginners with no skips do not need a heavy placement gate.
    if (
      input.provisionalStage <= 1 &&
      input.selfReportedStage <= 2 &&
      input.targetStage <= 3 &&
      !proClaim
    ) {
      return { required: false, reasons: [] };
    }
    return { required: reasons.length > 0, reasons };
  }

  private computeFeasibility(input: {
    weeklyEffectiveMinutes: number;
    deadlineToken: string;
    stageGap: number;
  }): FeasibilityPreview {
    const deadlineWeeks = DEADLINE_WEEKS[input.deadlineToken] ?? null;
    // Rough: ~180 min of content per stage-gap skill band
    const estimatedContentMin = Math.max(1, input.stageGap) * 6 * 45;
    const weeksNeeded =
      input.weeklyEffectiveMinutes > 0
        ? Math.ceil(estimatedContentMin / input.weeklyEffectiveMinutes)
        : null;

    if (deadlineWeeks == null || weeksNeeded == null) {
      return {
        state: 'feasible',
        requiredWeeksEstimate: weeksNeeded,
        deadlineWeeks,
        message: 'No hard deadline — pace will adapt to your capacity.',
        alternatives: [],
      };
    }

    const ratio = weeksNeeded / deadlineWeeks;
    if (ratio <= 1) {
      return {
        state: 'feasible',
        requiredWeeksEstimate: weeksNeeded,
        deadlineWeeks,
        message: `Fits your deadline (~${weeksNeeded} weeks needed of ${deadlineWeeks}).`,
        alternatives: [],
      };
    }
    if (ratio <= 1.1) {
      return {
        state: 'slightly_tight',
        requiredWeeksEstimate: weeksNeeded,
        deadlineWeeks,
        message: 'Slightly tight — a few optional modules may be deferred.',
        alternatives: [
          'Accept a focused pace',
          'Extend deadline one band',
          'Drop optional enrichment',
        ],
      };
    }
    if (ratio <= 1.25) {
      return {
        state: 'intensive_option',
        requiredWeeksEstimate: weeksNeeded,
        deadlineWeeks,
        message: 'Deadline needs an intensive plan or more weekly time.',
        alternatives: [
          'Increase weekly study time',
          'Choose a later deadline',
          'Lower target outcome one stage',
          'Accept intensive pace',
        ],
      };
    }
    return {
      state: 'unrealistic',
      requiredWeeksEstimate: weeksNeeded,
      deadlineWeeks,
      message: 'Deadline is not feasible with current capacity and target.',
      alternatives: [
        'Increase weekly study time',
        'Choose a later deadline',
        'Lower target outcome',
        'Continue without a hard deadline',
      ],
    };
  }
}

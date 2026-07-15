import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Goal } from '../../goals/entities/goal.entity';
import { QuestionnaireResponse } from './questionnaire-response.entity';
import { LearnerSkillEstimate } from './learner-skill-estimate.entity';
import { StageConfidence } from './stage-confidence.enum';

export { StageConfidence };

export enum LearnerProfileStatus {
  Provisional = 'provisional',
  Verified = 'verified',
  Superseded = 'superseded',
}

export enum PaceClass {
  Light = 'light',
  Balanced = 'balanced',
  Focused = 'focused',
  Intensive = 'intensive',
}

@Entity('learner_profile_snapshots')
@Unique(['userId', 'version'])
@Index(['userId', 'status'])
export class LearnerProfileSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'questionnaire_response_id', type: 'uuid', nullable: true })
  questionnaireResponseId: string | null;

  @ManyToOne(() => QuestionnaireResponse, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'questionnaire_response_id' })
  questionnaireResponse: QuestionnaireResponse | null;

  @Column({ name: 'goal_id', type: 'uuid', nullable: true })
  goalId: string | null;

  @ManyToOne(() => Goal, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'goal_id' })
  goal: Goal | null;

  @Column({ type: 'int' })
  version: number;

  @Column({
    type: 'enum',
    enum: LearnerProfileStatus,
    default: LearnerProfileStatus.Provisional,
  })
  status: LearnerProfileStatus;

  @Column({ name: 'primary_track_slug', type: 'varchar' })
  primaryTrackSlug: string;

  @Column({
    name: 'secondary_track_slugs',
    type: 'text',
    array: true,
    default: '{}',
  })
  secondaryTrackSlugs: string[];

  @Column({ name: 'self_reported_stage', type: 'int' })
  selfReportedStage: number;

  @Column({ name: 'provisional_stage', type: 'int' })
  provisionalStage: number;

  @Column({ name: 'verified_stage', type: 'int', nullable: true })
  verifiedStage: number | null;

  @Column({ name: 'stage_score', type: 'float' })
  stageScore: number;

  @Column({
    name: 'stage_confidence',
    type: 'enum',
    enum: StageConfidence,
    default: StageConfidence.Low,
  })
  stageConfidence: StageConfidence;

  @Column({ name: 'target_stage', type: 'int' })
  targetStage: number;

  @Column({ name: 'stage_gap', type: 'int' })
  stageGap: number;

  @Column({ name: 'weekly_declared_minutes', type: 'int' })
  weeklyDeclaredMinutes: number;

  @Column({ name: 'weekly_effective_minutes', type: 'int' })
  weeklyEffectiveMinutes: number;

  @Column({ name: 'preferred_session_minutes', type: 'int', default: 45 })
  preferredSessionMinutes: number;

  @Column({
    name: 'preferred_days',
    type: 'text',
    array: true,
    default: '{}',
  })
  preferredDays: string[];

  @Column({
    name: 'preferred_time_windows',
    type: 'text',
    array: true,
    default: '{}',
  })
  preferredTimeWindows: string[];

  @Column({ type: 'varchar', default: 'UTC' })
  timezone: string;

  @Column({
    name: 'pace_class',
    type: 'enum',
    enum: PaceClass,
    default: PaceClass.Balanced,
  })
  paceClass: PaceClass;

  @Column({
    name: 'motivation_tags',
    type: 'text',
    array: true,
    default: '{}',
  })
  motivationTags: string[];

  @Column({
    name: 'learning_style_weights',
    type: 'jsonb',
    default: () => "'{}'",
  })
  learningStyleWeights: Record<string, number>;

  @Column({
    name: 'blocker_tags',
    type: 'text',
    array: true,
    default: '{}',
  })
  blockerTags: string[];

  @Column({ name: 'diagnostic_required', type: 'boolean', default: false })
  diagnosticRequired: boolean;

  @Column({
    name: 'diagnostic_reason_codes',
    type: 'text',
    array: true,
    default: '{}',
  })
  diagnosticReasonCodes: string[];

  @Column({
    name: 'profiling_model_version',
    type: 'varchar',
    default: 'learner_profile_v1',
  })
  profilingModelVersion: string;

  @Column({
    name: 'normalized_input',
    type: 'jsonb',
    default: () => "'{}'",
  })
  normalizedInput: Record<string, unknown>;

  @OneToMany(() => LearnerSkillEstimate, (e) => e.profile, { cascade: true })
  skillEstimates: LearnerSkillEstimate[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

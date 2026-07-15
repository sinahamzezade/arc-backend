import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { LearnerProfileSnapshot } from './learner-profile-snapshot.entity';
import { StageConfidence } from './stage-confidence.enum';

export enum SkillEvidenceSource {
  Questionnaire = 'questionnaire',
  Placement = 'placement',
  LessonPerformance = 'lesson_performance',
  Project = 'project',
}

@Entity('learner_skill_estimates')
@Unique(['profileId', 'skillSlug'])
export class LearnerSkillEstimate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId: string;

  @ManyToOne(() => LearnerProfileSnapshot, (p) => p.skillEstimates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'profile_id' })
  profile: LearnerProfileSnapshot;

  @Column({ name: 'skill_slug', type: 'varchar' })
  skillSlug: string;

  @Column({ name: 'self_exposure_level', type: 'varchar' })
  selfExposureLevel: string;

  @Column({ name: 'provisional_stage', type: 'int' })
  provisionalStage: number;

  @Column({ name: 'verified_stage', type: 'int', nullable: true })
  verifiedStage: number | null;

  @Column({
    type: 'enum',
    enum: StageConfidence,
    default: StageConfidence.Low,
  })
  confidence: StageConfidence;

  @Column({
    name: 'evidence_source',
    type: 'enum',
    enum: SkillEvidenceSource,
    default: SkillEvidenceSource.Questionnaire,
  })
  evidenceSource: SkillEvidenceSource;

  @Column({
    name: 'evidence_meta',
    type: 'jsonb',
    default: () => "'{}'",
  })
  evidenceMeta: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

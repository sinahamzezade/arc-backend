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
import { ContentPublicationStatus } from '../content-pool.constants';
import { QuestionTemplate } from './question-template.entity';

export type QuestionVersionPrompt = {
  stem: string;
  mediaUrl?: string;
  code?: string;
  language?: string;
};

export type QuestionVersionAnswer = {
  /** Never sent in play payloads. */
  correctOptionIds?: string[];
  correctText?: string;
  options?: Array<{ id: string; label: string }>;
  explanation?: string;
};

@Entity('question_versions')
@Unique(['questionTemplateId', 'version'])
export class QuestionVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'question_template_id', type: 'uuid' })
  questionTemplateId: string;

  @ManyToOne(() => QuestionTemplate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_template_id' })
  questionTemplate: QuestionTemplate;

  @Column({ type: 'int' })
  version: number;

  @Column({
    type: 'varchar',
    default: ContentPublicationStatus.Draft,
  })
  status: ContentPublicationStatus;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  prompt: QuestionVersionPrompt | Record<string, unknown>;

  /** Access-restricted grading payload. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  answer: QuestionVersionAnswer | Record<string, unknown>;

  @Column({ type: 'text', default: '' })
  explanation: string;

  @Column({ name: 'schema_version', type: 'int', default: 1 })
  schemaVersion: number;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @Column({ name: 'reviewer_id', type: 'uuid', nullable: true })
  reviewerId: string | null;

  @Column({ name: 'change_note', type: 'text', default: '' })
  changeNote: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

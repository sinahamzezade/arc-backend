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
import { LessonTemplate } from '../../skill-graph/entities/lesson-template.entity';
import { ContentPublicationStatus } from '../content-pool.constants';

export type LessonVersionBody = {
  schemaVersion: number;
  objective: string;
  sections: Array<{
    id: string;
    title: string;
    blocks: Array<Record<string, unknown>>;
  }>;
  practiceIds?: string[];
  quizIds?: string[];
  resourceIds?: string[];
};

@Entity('lesson_versions')
@Unique(['lessonTemplateId', 'version'])
export class LessonVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lesson_template_id', type: 'uuid' })
  lessonTemplateId: string;

  @ManyToOne(() => LessonTemplate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_template_id' })
  lessonTemplate: LessonTemplate;

  @Column({ type: 'int' })
  version: number;

  @Column({
    type: 'varchar',
    default: ContentPublicationStatus.Draft,
  })
  status: ContentPublicationStatus;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  body: LessonVersionBody | Record<string, unknown>;

  @Column({ name: 'schema_version', type: 'int', default: 2 })
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

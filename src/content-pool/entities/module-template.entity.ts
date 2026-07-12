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
import { CourseTemplate } from './course-template.entity';

@Entity('module_templates')
@Unique(['courseTemplateId', 'slug'])
export class ModuleTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'course_template_id', type: 'uuid' })
  courseTemplateId: string;

  @ManyToOne(() => CourseTemplate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'course_template_id' })
  courseTemplate: CourseTemplate;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'order_hint', type: 'int', default: 0 })
  orderHint: number;

  @Column({ name: 'estimated_minutes', type: 'int', default: 0 })
  estimatedMinutes: number;

  @Column({
    name: 'lesson_template_ids',
    type: 'uuid',
    array: true,
    default: '{}',
  })
  lessonTemplateIds: string[];

  @Column({
    type: 'varchar',
    default: ContentPublicationStatus.Draft,
  })
  status: ContentPublicationStatus;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

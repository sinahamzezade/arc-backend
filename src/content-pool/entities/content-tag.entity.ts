import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('content_tags')
@Unique(['namespace', 'slug'])
export class ContentTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** e.g. learning_style, scheduling, questionnaire */
  @Column({ type: 'varchar', default: 'general' })
  namespace: string;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  label: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

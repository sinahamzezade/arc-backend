import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('datasets')
export class Dataset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  slug: string;

  @Column({ type: 'varchar' })
  title: string;

  /** Immutable object-storage key. */
  @Column({ name: 'storage_key', type: 'varchar' })
  storageKey: string;

  @Column({ name: 'schema_metadata', type: 'jsonb', default: () => "'{}'" })
  schemaMetadata: Record<string, unknown>;

  @Column({ name: 'preview_rows', type: 'jsonb', default: () => "'[]'" })
  previewRows: unknown[];

  @Column({ type: 'varchar', nullable: true })
  license: string | null;

  @Column({ type: 'varchar', nullable: true })
  source: string | null;

  @Column({ type: 'varchar' })
  checksum: string;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: string;

  @Column({ type: 'varchar', default: 'csv' })
  format: string;

  @Column({
    name: 'allowed_lesson_template_ids',
    type: 'uuid',
    array: true,
    default: '{}',
  })
  allowedLessonTemplateIds: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

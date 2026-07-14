import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SystemFlagValueType = 'boolean' | 'string';

@Entity('system_flags')
export class SystemFlag {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ name: 'value_type', type: 'varchar', length: 16 })
  valueType: SystemFlagValueType;

  @Column({ type: 'varchar', length: 128 })
  label: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

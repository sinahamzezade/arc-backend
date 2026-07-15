import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Flat skills index — prerequisite DAG for topo-sort.
 * Id is namespaced slug e.g. `html-css:css-intro`.
 */
@Entity('skills')
export class Skill {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({
    type: 'text',
    array: true,
    default: '{}',
  })
  prerequisites: string[];

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

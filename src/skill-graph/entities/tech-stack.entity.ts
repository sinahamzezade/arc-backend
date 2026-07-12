import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SkillNode } from './skill-node.entity';

@Entity('tech_stacks')
export class TechStack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  slug: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  category: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'icon_key', type: 'varchar', nullable: true })
  iconKey: string | null;

  @Column({ name: 'default_difficulty', type: 'varchar', default: 'beginner' })
  defaultDifficulty: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @OneToMany(() => SkillNode, (node) => node.techStack)
  skillNodes: SkillNode[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

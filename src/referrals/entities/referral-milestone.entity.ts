import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('referral_milestones')
@Unique(['userId', 'qualifiedRequired'])
export class ReferralMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'qualified_required', type: 'int' })
  qualifiedRequired: number;

  @Column({ name: 'coins_awarded', type: 'int', default: 0 })
  coinsAwarded: number;

  @Column({ name: 'gems_awarded', type: 'int', default: 0 })
  gemsAwarded: number;

  @Column({ name: 'badge', type: 'varchar', length: 64, nullable: true })
  badge: string | null;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;
}

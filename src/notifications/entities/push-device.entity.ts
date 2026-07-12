import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum PushDevicePlatform {
  Web = 'web',
  Ios = 'ios',
  Android = 'android',
}

@Entity('push_devices')
@Index(['userId', 'deviceId'], { unique: true })
export class PushDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'device_id', type: 'varchar', length: 128 })
  deviceId: string;

  @Column({ type: 'enum', enum: PushDevicePlatform, default: PushDevicePlatform.Web })
  platform: PushDevicePlatform;

  @Column({ type: 'text' })
  token: string;

  @Column({ name: 'endpoint', type: 'text', nullable: true })
  endpoint: string | null;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

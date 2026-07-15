import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Admin-uploaded images (rank/badge icons) stored in Postgres so they
 * survive ephemeral container filesystems (Railway redeploys/restarts).
 * `key` is the public URL path, e.g. `/uploads/ranks/curious-egg-ab12cd34ef.png`.
 */
@Entity('uploaded_assets')
export class UploadedAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 191 })
  key: string;

  @Column({ type: 'varchar', length: 64 })
  mime: string;

  @Column({ type: 'bytea' })
  data: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

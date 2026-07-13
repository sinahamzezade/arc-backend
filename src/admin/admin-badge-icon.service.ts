import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { Repository } from 'typeorm';
import { BadgeDefinition } from '../badges/entities/badge-definition.entity';

const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

const MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class AdminBadgeIconService {
  private readonly uploadDir = join(
    process.cwd(),
    'public',
    'uploads',
    'badges',
  );

  constructor(
    @InjectRepository(BadgeDefinition)
    private readonly badges: Repository<BadgeDefinition>,
  ) {}

  /** Public URL path stored in iconAssetKey for uploaded files. */
  static isUploadPath(key: string | null | undefined): boolean {
    return Boolean(key?.startsWith('/uploads/badges/'));
  }

  async saveIcon(
    badgeId: string,
    file: { buffer: Buffer; size: number; mimetype: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image uploaded');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Image must be 2MB or smaller');
    }
    const ext = ALLOWED_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Allowed types: PNG, JPEG, WebP, GIF, SVG',
      );
    }

    const badge = await this.badges.findOne({ where: { id: badgeId } });
    if (!badge) throw new NotFoundException('Badge not found');

    await mkdir(this.uploadDir, { recursive: true });

    const safeCode = badge.code.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const hash = createHash('sha1')
      .update(randomBytes(8))
      .digest('hex')
      .slice(0, 10);
    const filename = `${safeCode}-${hash}${ext}`;
    const absPath = join(this.uploadDir, filename);
    const publicPath = `/uploads/badges/${filename}`;

    await writeFile(absPath, file.buffer);

    const previous = badge.iconAssetKey;
    badge.iconAssetKey = publicPath;
    await this.badges.save(badge);

    if (
      previous &&
      AdminBadgeIconService.isUploadPath(previous) &&
      previous !== publicPath
    ) {
      await this.tryDeleteUpload(previous);
    }

    return badge;
  }

  async clearIcon(badgeId: string) {
    const badge = await this.badges.findOne({ where: { id: badgeId } });
    if (!badge) throw new NotFoundException('Badge not found');
    const previous = badge.iconAssetKey;
    badge.iconAssetKey = null;
    await this.badges.save(badge);
    if (previous && AdminBadgeIconService.isUploadPath(previous)) {
      await this.tryDeleteUpload(previous);
    }
    return badge;
  }

  private async tryDeleteUpload(publicPath: string) {
    const name = publicPath.replace(/^\/uploads\/badges\//, '');
    if (!name || name.includes('..') || name.includes('/')) return;
    try {
      await unlink(join(this.uploadDir, name));
    } catch {
      /* ignore missing file */
    }
  }
}

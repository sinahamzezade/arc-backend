import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { BadgeDefinition } from '../badges/entities/badge-definition.entity';
import { UploadsService } from '../uploads/uploads.service';

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
  constructor(
    @InjectRepository(BadgeDefinition)
    private readonly badges: Repository<BadgeDefinition>,
    private readonly uploads: UploadsService,
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

    const safeCode = badge.code.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const hash = createHash('sha1')
      .update(randomBytes(8))
      .digest('hex')
      .slice(0, 10);
    const publicPath = `/uploads/badges/${safeCode}-${hash}${ext}`;

    await this.uploads.put(publicPath, file.mimetype, file.buffer);

    const previous = badge.iconAssetKey;
    badge.iconAssetKey = publicPath;
    await this.badges.save(badge);

    if (
      previous &&
      AdminBadgeIconService.isUploadPath(previous) &&
      previous !== publicPath
    ) {
      await this.uploads.remove(previous);
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
      await this.uploads.remove(previous);
    }
    return badge;
  }
}

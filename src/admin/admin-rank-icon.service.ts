import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { RankDefinition } from '../ranks/entities/rank-definition.entity';
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
export class AdminRankIconService {
  constructor(
    @InjectRepository(RankDefinition)
    private readonly ranks: Repository<RankDefinition>,
    private readonly uploads: UploadsService,
  ) {}

  /** Public URL path stored in iconAssetKey for uploaded files. */
  static isUploadPath(key: string | null | undefined): boolean {
    return Boolean(key?.startsWith('/uploads/ranks/'));
  }

  async saveIcon(
    rankId: string,
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

    const rank = await this.ranks.findOne({ where: { id: rankId } });
    if (!rank) throw new NotFoundException('Rank not found');

    const safeSlug = rank.slug.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const hash = createHash('sha1')
      .update(randomBytes(8))
      .digest('hex')
      .slice(0, 10);
    const publicPath = `/uploads/ranks/${safeSlug}-${hash}${ext}`;

    await this.uploads.put(publicPath, file.mimetype, file.buffer);

    const previous = rank.iconAssetKey;
    rank.iconAssetKey = publicPath;
    await this.ranks.save(rank);

    if (
      previous &&
      AdminRankIconService.isUploadPath(previous) &&
      previous !== publicPath
    ) {
      await this.uploads.remove(previous);
    }

    return rank;
  }

  async clearIcon(rankId: string) {
    const rank = await this.ranks.findOne({ where: { id: rankId } });
    if (!rank) throw new NotFoundException('Rank not found');
    const previous = rank.iconAssetKey;
    rank.iconAssetKey = null;
    await this.ranks.save(rank);
    if (previous && AdminRankIconService.isUploadPath(previous)) {
      await this.uploads.remove(previous);
    }
    return rank;
  }
}

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
import { RankDefinition } from '../ranks/entities/rank-definition.entity';

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
  private readonly uploadDir = join(
    process.cwd(),
    'public',
    'uploads',
    'ranks',
  );

  constructor(
    @InjectRepository(RankDefinition)
    private readonly ranks: Repository<RankDefinition>,
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

    await mkdir(this.uploadDir, { recursive: true });

    const safeSlug = rank.slug.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const hash = createHash('sha1')
      .update(randomBytes(8))
      .digest('hex')
      .slice(0, 10);
    const filename = `${safeSlug}-${hash}${ext}`;
    const absPath = join(this.uploadDir, filename);
    const publicPath = `/uploads/ranks/${filename}`;

    await writeFile(absPath, file.buffer);

    const previous = rank.iconAssetKey;
    rank.iconAssetKey = publicPath;
    await this.ranks.save(rank);

    if (
      previous &&
      AdminRankIconService.isUploadPath(previous) &&
      previous !== publicPath
    ) {
      await this.tryDeleteUpload(previous);
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
      await this.tryDeleteUpload(previous);
    }
    return rank;
  }

  private async tryDeleteUpload(publicPath: string) {
    const name = publicPath.replace(/^\/uploads\/ranks\//, '');
    if (!name || name.includes('..') || name.includes('/')) return;
    try {
      await unlink(join(this.uploadDir, name));
    } catch {
      /* ignore missing file */
    }
  }
}

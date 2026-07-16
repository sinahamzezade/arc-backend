import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { UploadsService } from '../uploads/uploads.service';
import { Profile } from './entities/profile.entity';
import { ProfileCacheService } from './profile-cache.service';

const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class ProfileAvatarService {
  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    private readonly uploads: UploadsService,
    private readonly profileCache: ProfileCacheService,
  ) {}

  static isUploadPath(key: string | null | undefined): boolean {
    return Boolean(key?.startsWith('/uploads/avatars/'));
  }

  async setAvatar(
    userId: string,
    file: { buffer: Buffer; size: number; mimetype: string },
  ): Promise<Profile> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image uploaded');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Image must be 2MB or smaller');
    }
    const ext = ALLOWED_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Allowed types: PNG, JPEG, WebP, GIF');
    }

    const profile = await this.profilesRepo.findOne({ where: { userId } });
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const hash = createHash('sha1')
      .update(randomBytes(8))
      .digest('hex')
      .slice(0, 10);
    const publicPath = `/uploads/avatars/${userId.slice(0, 8)}-${hash}${ext}`;

    await this.uploads.put(publicPath, file.mimetype, file.buffer);

    const previous = profile.avatarUrl;
    profile.avatarUrl = publicPath;
    const saved = await this.profilesRepo.save(profile);
    await this.profileCache.invalidate(userId);

    if (
      previous &&
      ProfileAvatarService.isUploadPath(previous) &&
      previous !== publicPath
    ) {
      await this.uploads.remove(previous);
    }

    return saved;
  }

  async clearAvatar(userId: string): Promise<Profile> {
    const profile = await this.profilesRepo.findOne({ where: { userId } });
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const previous = profile.avatarUrl;
    profile.avatarUrl = null;
    const saved = await this.profilesRepo.save(profile);
    await this.profileCache.invalidate(userId);

    if (previous && ProfileAvatarService.isUploadPath(previous)) {
      await this.uploads.remove(previous);
    }

    return saved;
  }
}

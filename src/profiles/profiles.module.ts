import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadsModule } from '../uploads/uploads.module';
import { Profile } from './entities/profile.entity';
import { ProfileAvatarService } from './profile-avatar.service';
import { ProfileCacheService } from './profile-cache.service';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile]), UploadsModule],
  providers: [ProfilesService, ProfileCacheService, ProfileAvatarService],
  exports: [
    ProfilesService,
    ProfileCacheService,
    ProfileAvatarService,
    TypeOrmModule,
  ],
})
export class ProfilesModule {}

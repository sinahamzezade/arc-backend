import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from './entities/profile.entity';
import { ProfileCacheService } from './profile-cache.service';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile])],
  providers: [ProfilesService, ProfileCacheService],
  exports: [ProfilesService, ProfileCacheService, TypeOrmModule],
})
export class ProfilesModule {}

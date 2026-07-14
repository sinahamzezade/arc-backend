import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RankDefinition } from './entities/rank-definition.entity';
import { UserRankState } from './entities/user-rank-state.entity';
import { RankAvatarService } from './rank-avatar.service';

/** Thin module — no Social/Leagues deps → safe import from peer surfaces. */
@Module({
  imports: [TypeOrmModule.forFeature([UserRankState, RankDefinition])],
  providers: [RankAvatarService],
  exports: [RankAvatarService],
})
export class RankAvatarModule {}

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPoolModule } from '../content-pool/content-pool.module';
import { GamificationModule } from '../gamification/gamification.module';
import { UserLeagueState } from '../leagues/entities/user-league-state.entity';
import { LeaguesModule } from '../leagues/leagues.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Profile } from '../profiles/entities/profile.entity';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocialModule } from '../social/social.module';
import { UsersModule } from '../users/users.module';
import { BattlesController } from './battles.controller';
import { BattlesService } from './battles.service';
import { BattleAnswer } from './entities/battle-answer.entity';
import { BattleCoinEscrow } from './entities/battle-coin-escrow.entity';
import { BattleEvent } from './entities/battle-event.entity';
import { BattleParticipant } from './entities/battle-participant.entity';
import { BattleQuestion } from './entities/battle-question.entity';
import { BattleResult } from './entities/battle-result.entity';
import { Battle } from './entities/battle.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Battle,
      BattleParticipant,
      BattleQuestion,
      BattleAnswer,
      BattleCoinEscrow,
      BattleEvent,
      BattleResult,
      UserLeagueState,
      Profile,
    ]),
    ContentPoolModule,
    ProfilesModule,
    UsersModule,
    NotificationsModule,
    LeaguesModule,
    SocialModule,
    forwardRef(() => GamificationModule),
  ],
  controllers: [BattlesController],
  providers: [BattlesService],
  exports: [BattlesService],
})
export class BattlesModule {}

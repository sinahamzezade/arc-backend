import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { QuestsModule } from '../quests/quests.module';
import { RankAvatarModule } from '../ranks/rank-avatar.module';
import { SocialModule } from '../social/social.module';
import { User } from '../users/entities/user.entity';
import { LeagueCohort } from './entities/league-cohort.entity';
import { LeagueFinalResult } from './entities/league-final-result.entity';
import { LeagueMembership } from './entities/league-membership.entity';
import { LeagueScoreEvent } from './entities/league-score-event.entity';
import { LeagueSeason } from './entities/league-season.entity';
import { UserLeagueState } from './entities/user-league-state.entity';
import { LeagueCohortService } from './league-cohort.service';
import { LeagueFinalizeService } from './league-finalize.service';
import { LeagueLiveScoresService } from './league-live-scores.service';
import { LeagueScoreService } from './league-score.service';
import { LeagueSeasonService } from './league-season.service';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeagueSeason,
      LeagueCohort,
      LeagueMembership,
      LeagueScoreEvent,
      LeagueFinalResult,
      UserLeagueState,
      User,
    ]),
    ProfilesModule,
    NotificationsModule,
    SocialModule,
    QuestsModule,
    RankAvatarModule,
    forwardRef(() => GamificationModule),
  ],
  controllers: [LeaguesController],
  providers: [
    LeaguesService,
    LeagueSeasonService,
    LeagueCohortService,
    LeagueScoreService,
    LeagueFinalizeService,
    LeagueLiveScoresService,
  ],
  exports: [LeaguesService, LeagueScoreService],
})
export class LeaguesModule {}

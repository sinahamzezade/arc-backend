import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { LeagueScoreSourceType } from './entities/league.enums';
import {
  HistoryQueryDto,
  IngestLeagueXpDto,
  LeaderboardQueryDto,
  UpdateLeaguePrivacyDto,
  UpdateRankGateDto,
} from './dto/leagues.dto';
import { LeaguesService } from './leagues.service';

@ApiTags('leagues')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('leagues')
export class LeaguesController {
  constructor(private readonly leagues: LeaguesService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current league season + cohort snapshot' })
  getCurrent(@CurrentUser() user: AuthUserPayload) {
    return this.leagues.getCurrent(user.userId);
  }

  @Get('current/leaderboard')
  @ApiOperation({ summary: 'Current cohort leaderboard (cursor page)' })
  getLeaderboard(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: LeaderboardQueryDto,
  ) {
    return this.leagues.getLeaderboard(user.userId, query.cursor);
  }

  @Get('current/me')
  @ApiOperation({ summary: 'Viewer position, zone, score breakdown' })
  getMe(@CurrentUser() user: AuthUserPayload) {
    return this.leagues.getMe(user.userId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Past season final results' })
  getHistory(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: HistoryQueryDto,
  ) {
    return this.leagues.getHistory(user.userId, query.cursor);
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Public league card (privacy filtered)' })
  getUserLeague(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.leagues.getUserLeague(user.userId, userId);
  }

  @Patch('privacy')
  @ApiOperation({ summary: 'Hide league from public profile' })
  setPrivacy(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateLeaguePrivacyDto,
  ) {
    return this.leagues.setPrivacy(user.userId, dto.hideFromProfile);
  }

  @Patch('rank-gates')
  @ApiOperation({
    summary: 'Sync rank level / weekly seals (ranking system hook)',
  })
  updateRankGates(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateRankGateDto,
  ) {
    return this.leagues.updateRankGateInputs(user.userId, dto);
  }

  /**
   * Internal/dev ingest until gamification outbox exists.
   * Production path: gamification.reward_granted → LeagueScoreService.
   */
  @Post('score-events')
  @ApiOperation({
    summary: 'Ingest qualified League XP (ledger-backed, idempotent)',
  })
  ingestScore(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: IngestLeagueXpDto,
  ) {
    const sourceType = Object.values(LeagueScoreSourceType).includes(
      dto.sourceType as LeagueScoreSourceType,
    )
      ? (dto.sourceType as LeagueScoreSourceType)
      : LeagueScoreSourceType.Lesson;

    return this.leagues.ingestQualifiedXp({
      userId: user.userId,
      ledgerEntryId: dto.ledgerEntryId,
      xpDelta: dto.xpDelta,
      sourceType,
      sourceId: dto.sourceId ?? null,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      isProofWeighted: dto.isProofWeighted,
    });
  }

  @Post('admin/finalize-due')
  @ApiOperation({ summary: 'Finalize seasons past endsAt (job trigger)' })
  finalizeDue() {
    return this.leagues.finalizeDueSeasons();
  }

  @Post('admin/finalize/:seasonId')
  @ApiOperation({ summary: 'Finalize one season idempotently' })
  finalizeSeason(@Param('seasonId', ParseUUIDPipe) seasonId: string) {
    return this.leagues.finalizeSeason(seasonId);
  }
}

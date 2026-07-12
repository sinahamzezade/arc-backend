import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { GamificationService } from './gamification.service';
import { RewardLedgerService } from './reward-ledger.service';

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly gamification: GamificationService,
    private readonly ledger: RewardLedgerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Authoritative wallet balances' })
  async getWallet(@CurrentUser() user: AuthUserPayload) {
    const wallet = await this.gamification.getWallet(user.userId);
    return {
      lifetimeXp: wallet.lifetimeXp,
      weeklyLeagueXp: wallet.weeklyLeagueXp,
      gems: wallet.gems,
      coins: wallet.coins,
      version: wallet.version,
    };
  }

  @Get('ledger')
  @ApiOperation({ summary: 'Reward ledger cursor page' })
  ledgerPage(
    @CurrentUser() user: AuthUserPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ledger.listLedger(user.userId, {
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }
}

@ApiTags('rewards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rewards')
export class RewardsController {
  constructor(private readonly ledger: RewardLedgerService) {}

  @Get(':transactionGroupId')
  @ApiOperation({ summary: 'Reward grant by transaction group' })
  async byGroup(
    @CurrentUser() user: AuthUserPayload,
    @Param('transactionGroupId') transactionGroupId: string,
  ) {
    const group = await this.ledger.getTransactionGroup(
      user.userId,
      transactionGroupId,
    );
    if (!group) {
      throw new AppException(
        AuthErrorCode.REWARD_RULE_NOT_FOUND,
        'Reward transaction not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return group;
  }
}

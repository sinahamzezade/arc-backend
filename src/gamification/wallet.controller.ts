import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { CurrencyExchangeService } from './currency-exchange.service';
import { GamificationService } from './gamification.service';
import { RewardLedgerService } from './reward-ledger.service';

class BuyCurrencyPackDto {
  @IsString()
  @MinLength(1)
  sku!: string;

  /** xp now; iap reserved for real-money settlement later */
  @IsIn(['xp'])
  paymentMethod!: 'xp';
}

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly gamification: GamificationService,
    private readonly ledger: RewardLedgerService,
    private readonly currencyExchange: CurrencyExchangeService,
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

  @Get('currency-packs')
  @ApiOperation({ summary: 'Gem/coin packs (XP now; IAP later)' })
  listCurrencyPacks(@Query('target') target?: 'gems' | 'coins') {
    return this.currencyExchange.listPacks({
      target: target === 'gems' || target === 'coins' ? target : undefined,
    });
  }

  @Post('currency-packs/purchase')
  @ApiOperation({ summary: 'Buy gem/coin pack (XP payment; IAP later)' })
  purchaseCurrencyPack(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: BuyCurrencyPackDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key =
      idempotencyKey?.trim() ||
      `currency-pack:${user.userId}:${body.sku}:${Date.now()}`;
    if (body.paymentMethod !== 'xp') {
      throw new AppException(
        AuthErrorCode.ITEM_NOT_AVAILABLE,
        'Only XP payment is enabled; real money coming soon',
      );
    }
    return this.currencyExchange.purchaseWithXp({
      userId: user.userId,
      sku: body.sku,
      idempotencyKey: key.slice(0, 96),
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

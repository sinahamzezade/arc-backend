import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { RewardCurrency } from './entities/reward-ledger-entry.entity';
import { StoreItemType } from './entities/store-item.entity';
import { StoreService } from './store.service';

class PurchaseDto {
  @IsString()
  @MinLength(1)
  sku!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;
}

@ApiTags('store')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('store')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @ApiOperation({ summary: 'Store catalog' })
  list(
    @Query('currency') currency?: RewardCurrency,
    @Query('type') type?: StoreItemType,
  ) {
    return this.store.listCatalog({ currency, type });
  }

  @Post('purchases')
  @ApiOperation({ summary: 'Purchase store item (idempotent)' })
  purchase(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: PurchaseDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key =
      idempotencyKey?.trim() ||
      `purchase:${user.userId}:${body.sku}:${Date.now()}`;
    return this.store.purchase({
      userId: user.userId,
      sku: body.sku,
      quantity: body.quantity,
      idempotencyKey: key.slice(0, 96),
    });
  }
}

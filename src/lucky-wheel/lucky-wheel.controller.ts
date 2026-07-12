import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { LuckyWheelService } from './lucky-wheel.service';

class SpinDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  idempotencyKey?: string;
}

class RespinDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  idempotencyKey?: string;
}

class HistoryQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('lucky-wheel')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lucky-wheel')
export class LuckyWheelController {
  constructor(private readonly wheel: LuckyWheelService) {}

  @Get()
  @ApiOperation({ summary: 'Current wheel layout + entitlement' })
  getCurrent(@CurrentUser() user: AuthUserPayload) {
    return this.wheel.getCurrent(user.userId);
  }

  @Post('spin')
  @ApiOperation({ summary: 'Authoritative spin (idempotent)' })
  spin(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: SpinDto,
    @Headers('idempotency-key') headerKey?: string,
  ) {
    const key =
      body.idempotencyKey?.trim() ||
      headerKey?.trim() ||
      '';
    return this.wheel.spin(user.userId, key);
  }

  @Post('respin/purchase')
  @ApiOperation({ summary: 'Spend gems for one re-spin entitlement' })
  purchaseRespin(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: RespinDto,
    @Headers('idempotency-key') headerKey?: string,
  ) {
    const key =
      body.idempotencyKey?.trim() ||
      headerKey?.trim() ||
      `respin:${user.userId}:${Date.now()}`;
    return this.wheel.purchaseRespin(user.userId, key);
  }

  @Get('history')
  @ApiOperation({ summary: 'Spin history' })
  history(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: HistoryQueryDto,
  ) {
    return this.wheel.history(user.userId, query.cursor);
  }

  @Get('rewards/:spinId')
  @ApiOperation({ summary: 'Re-fetch spin result' })
  getReward(
    @CurrentUser() user: AuthUserPayload,
    @Param('spinId', ParseUUIDPipe) spinId: string,
  ) {
    return this.wheel.getSpin(user.userId, spinId);
  }
}

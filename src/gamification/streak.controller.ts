import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { StreakService } from './streak.service';

class RestoreStreakDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 3])
  days!: 1 | 2 | 3;
}

@ApiTags('streaks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('streaks')
export class StreakController {
  constructor(private readonly streaks: StreakService) {}

  @Get()
  @ApiOperation({ summary: 'Daily/weekly streak state' })
  get(@CurrentUser() user: AuthUserPayload) {
    return this.streaks.getStreak(user.userId);
  }

  @Post('restore')
  @ApiOperation({ summary: 'Restore missed streak days with gems' })
  restore(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: RestoreStreakDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key =
      idempotencyKey?.trim() ||
      `restore:${user.userId}:${body.days}:${Date.now()}`;
    return this.streaks.restore({
      userId: user.userId,
      days: body.days,
      idempotencyKey: key.slice(0, 96),
    });
  }
}

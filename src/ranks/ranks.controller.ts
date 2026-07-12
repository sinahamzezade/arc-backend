import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { RanksService } from './ranks.service';

class RankPrivacyDto {
  @IsBoolean()
  hideFromProfile!: boolean;
}

class RankActivityDto {
  @IsString()
  actionType!: string;

  @IsOptional()
  @IsString()
  actionId?: string;

  @IsOptional()
  @IsObject()
  counterDeltas?: Record<string, number>;

  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('ranks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ranks')
export class RanksController {
  constructor(private readonly ranks: RanksService) {}

  @Get()
  @ApiOperation({ summary: 'List active rank definitions' })
  list() {
    return this.ranks.listDefinitions();
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user rank + next requirements' })
  getMe(@CurrentUser() user: AuthUserPayload) {
    return this.ranks.getMe(user.userId);
  }

  @Get('me/ladder')
  @ApiOperation({ summary: 'Full rank ladder for current user' })
  getLadder(@CurrentUser() user: AuthUserPayload) {
    return this.ranks.getLadder(user.userId);
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Public rank card (privacy filtered)' })
  getUser(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.ranks.getUserRank(user.userId, userId);
  }

  @Patch('me/privacy')
  @ApiOperation({ summary: 'Hide rank from public profile' })
  setPrivacy(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: RankPrivacyDto,
  ) {
    return this.ranks.setPrivacy(user.userId, body.hideFromProfile);
  }

  @Post('me/evaluate')
  @ApiOperation({ summary: 'Force rank evaluation' })
  evaluate(@CurrentUser() user: AuthUserPayload) {
    return this.ranks.evaluate(user.userId, 'api');
  }

  @Post('me/activity')
  @ApiOperation({ summary: 'Record milestone progress + evaluate' })
  activity(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: RankActivityDto,
  ) {
    return this.ranks.recordActivity(user.userId, {
      actionType: body.actionType,
      actionId: body.actionId,
      counterDeltas: body.counterDeltas,
      reason: body.reason,
    });
  }
}

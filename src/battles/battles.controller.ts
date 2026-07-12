import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  BattleHistoryQueryDto,
  BattleIdempotencyDto,
  CreateBattleDto,
  SubmitBattleAnswerDto,
} from './dto/battles.dto';
import { BattlesService } from './battles.service';

@ApiTags('battles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('battles')
export class BattlesController {
  constructor(private readonly battles: BattlesService) {}

  @Post()
  @ApiOperation({ summary: 'Create battle invite' })
  create(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateBattleDto,
  ) {
    return this.battles.create(user.userId, dto);
  }

  @Get('invites')
  @ApiOperation({ summary: 'Incoming + outgoing open invites' })
  invites(@CurrentUser() user: AuthUserPayload) {
    return this.battles.listInvites(user.userId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Battle history cursor page' })
  history(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: BattleHistoryQueryDto,
  ) {
    return this.battles.history(user.userId, query.cursor);
  }

  @Get('stats/me')
  @ApiOperation({ summary: 'Aggregate battle stats for viewer' })
  statsMe(@CurrentUser() user: AuthUserPayload) {
    return this.battles.statsMe(user.userId);
  }

  @Post(':id/accept')
  accept(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BattleIdempotencyDto,
  ) {
    return this.battles.accept(user.userId, id, dto.idempotencyKey);
  }

  @Post(':id/decline')
  decline(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BattleIdempotencyDto,
  ) {
    return this.battles.decline(user.userId, id, dto.idempotencyKey);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BattleIdempotencyDto,
  ) {
    return this.battles.cancel(user.userId, id, dto.idempotencyKey);
  }

  @Post(':id/ready')
  ready(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BattleIdempotencyDto,
  ) {
    return this.battles.ready(user.userId, id, dto.idempotencyKey);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.battles.getBattle(user.userId, id);
  }

  @Get(':id/state')
  getState(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.battles.getState(user.userId, id);
  }

  @Post(':id/answers')
  submitAnswer(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitBattleAnswerDto,
  ) {
    return this.battles.submitAnswer(user.userId, id, dto);
  }

  @Post(':id/heartbeat')
  @ApiOperation({ summary: 'Live heartbeat (disconnect enforcement)' })
  heartbeat(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.battles.heartbeat(user.userId, id);
  }

  @Post(':id/forfeit')
  forfeit(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BattleIdempotencyDto,
  ) {
    return this.battles.forfeit(user.userId, id, dto.idempotencyKey);
  }

  @Post(':id/rematch')
  rematch(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BattleIdempotencyDto,
  ) {
    return this.battles.rematch(user.userId, id, dto.idempotencyKey);
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  ArloChatDto,
  CheckDebateDto,
  CheckDragOrderDto,
  CheckPracticeDto,
  CheckQuizDto,
  CheckSandboxSimulationDto,
  CheckScenarioDto,
  CheckVisualHotspotDto,
  CompleteLessonDto,
  UpdateLessonProgressDto,
} from './dto/lesson-play.dto';
import { LessonsService } from './lessons.service';

@ApiTags('lessons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get(':lessonId/play')
  @ApiOperation({ summary: 'Playable lesson payload (no answer keys)' })
  getPlay(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
  ) {
    return this.lessonsService.getPlay(user.userId, lessonId);
  }

  @Post(':lessonId/start')
  @ApiOperation({ summary: 'Start or restart a lesson session' })
  start(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
  ) {
    return this.lessonsService.start(user.userId, lessonId);
  }

  @Patch(':lessonId/progress')
  @ApiOperation({ summary: 'Persist in-lesson session progress' })
  saveProgress(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: UpdateLessonProgressDto,
  ) {
    return this.lessonsService.saveProgress(user.userId, lessonId, dto);
  }

  @Post(':lessonId/practice/check')
  @ApiOperation({
    summary:
      'Self-attest task completion (practice / mini_project / interactive)',
  })
  checkPractice(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CheckPracticeDto,
  ) {
    return this.lessonsService.checkPractice(user.userId, lessonId, dto);
  }

  @Post(':lessonId/quiz/check')
  @ApiOperation({
    summary:
      'Grade one quiz question by id (q0..) or index — server-side answers',
  })
  checkQuiz(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CheckQuizDto,
  ) {
    return this.lessonsService.checkQuiz(user.userId, lessonId, dto);
  }

  @Post(':lessonId/scenario/:blockId/check')
  @ApiOperation({ summary: 'Grade scenario_decision block' })
  checkScenario(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('blockId') blockId: string,
    @Body() dto: CheckScenarioDto,
  ) {
    return this.lessonsService.checkScenario(
      user.userId,
      lessonId,
      blockId,
      dto,
    );
  }

  @Post(':lessonId/visual-hotspot/:blockId/check')
  @ApiOperation({ summary: 'Grade visual_hotspot block' })
  checkVisualHotspot(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('blockId') blockId: string,
    @Body() dto: CheckVisualHotspotDto,
  ) {
    return this.lessonsService.checkVisualHotspot(
      user.userId,
      lessonId,
      blockId,
      dto,
    );
  }

  @Post(':lessonId/drag-order/:blockId/check')
  @ApiOperation({ summary: 'Grade drag_order block' })
  checkDragOrder(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('blockId') blockId: string,
    @Body() dto: CheckDragOrderDto,
  ) {
    return this.lessonsService.checkDragOrder(
      user.userId,
      lessonId,
      blockId,
      dto,
    );
  }

  @Post(':lessonId/sandbox-simulation/:blockId/check')
  @ApiOperation({ summary: 'Grade sandbox_simulation block' })
  checkSandboxSimulation(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('blockId') blockId: string,
    @Body() dto: CheckSandboxSimulationDto,
  ) {
    return this.lessonsService.checkSandboxSimulation(
      user.userId,
      lessonId,
      blockId,
      dto,
    );
  }

  @Post(':lessonId/debate/:blockId/check')
  @ApiOperation({ summary: 'Grade debate_pick block (scenario-class proof)' })
  checkDebate(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Param('blockId') blockId: string,
    @Body() dto: CheckDebateDto,
  ) {
    return this.lessonsService.checkDebate(user.userId, lessonId, blockId, dto);
  }

  @Post(':lessonId/complete')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated unique key for this completion claim',
  })
  @ApiOperation({
    summary: 'Complete lesson — award XP/gems/coins via ledger, unlock next',
  })
  complete(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CompleteLessonDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = idempotencyKey?.trim();
    if (!key) {
      throw new AppException(
        AuthErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'Idempotency-Key header is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.lessonsService.complete(user.userId, lessonId, dto, key);
  }

  @Post(':lessonId/arlo/chat')
  @ApiOperation({ summary: 'Lesson-scoped Arlo coach reply' })
  arloChat(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: ArloChatDto,
  ) {
    return this.lessonsService.arloChat(user.userId, lessonId, dto.message);
  }
}

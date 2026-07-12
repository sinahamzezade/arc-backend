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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import {
  CheckPracticeDto,
  CheckQuizDto,
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
  @ApiOperation({ summary: 'Grade practice MCQ' })
  checkPractice(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CheckPracticeDto,
  ) {
    return this.lessonsService.checkPractice(user.userId, lessonId, dto);
  }

  @Post(':lessonId/quiz/check')
  @ApiOperation({ summary: 'Grade one quiz question' })
  checkQuiz(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CheckQuizDto,
  ) {
    return this.lessonsService.checkQuiz(user.userId, lessonId, dto);
  }

  @Post(':lessonId/complete')
  @ApiOperation({
    summary: 'Complete lesson — award XP/gems/coins, unlock next',
  })
  complete(
    @CurrentUser() user: AuthUserPayload,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CompleteLessonDto,
  ) {
    return this.lessonsService.complete(user.userId, lessonId, dto);
  }
}

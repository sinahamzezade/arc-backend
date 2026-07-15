import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  IntakeChatCompleteDto,
  IntakeChatMessageDto,
  ProfilePreviewRequestDto,
  SetIntakeModeDto,
  SubmitQuestionnaireDto,
  UpsertQuestionnaireDto,
} from './dto/questionnaire.dto';
import { IntakeChatService } from './intake-chat.service';
import { QuestionnaireService } from './questionnaire.service';

@ApiTags('questionnaire')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('questionnaire')
export class QuestionnaireController {
  constructor(
    private readonly questionnaireService: QuestionnaireService,
    private readonly intakeChat: IntakeChatService,
  ) {}

  @Get('schema')
  @ApiOperation({
    summary: 'Questionnaire steps, questions, and allowed options',
  })
  schema() {
    return this.questionnaireService.getSchema();
  }

  @Get('intake-config')
  @ApiOperation({ summary: 'Form vs chat intake mode config' })
  intakeConfig(@CurrentUser() user: AuthUserPayload) {
    return this.questionnaireService.getIntakeConfig(user.userId);
  }

  @Put('intake-mode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set user intake mode preference' })
  setIntakeMode(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: SetIntakeModeDto,
  ) {
    return this.questionnaireService.setIntakeMode(user.userId, dto.mode);
  }

  @Get('chat')
  @ApiOperation({ summary: 'Current conversational intake state' })
  chatState(@CurrentUser() user: AuthUserPayload) {
    return this.intakeChat.getState(user.userId);
  }

  @Post('chat/start')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start or reset conversational intake' })
  chatStart(@CurrentUser() user: AuthUserPayload) {
    return this.intakeChat.start(user.userId);
  }

  @Post('chat/message')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send conversational intake message' })
  chatMessage(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: IntakeChatMessageDto,
  ) {
    return this.intakeChat.message(user.userId, {
      message: dto.message,
      selection: dto.selection,
    });
  }

  @Post('chat/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Save chat draft and mark ready for review (preferred). Finalize via POST /questionnaire/submit; pass { submit: true } only for legacy immediate submit.',
  })
  chatComplete(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto?: IntakeChatCompleteDto,
  ) {
    return this.intakeChat.complete(user.userId, { submit: dto?.submit });
  }

  @Get('profile')
  @ApiOperation({ summary: 'Current private learner profile snapshot' })
  getProfile(@CurrentUser() user: AuthUserPayload) {
    return this.questionnaireService.getProfile(user.userId);
  }

  @Post('profile-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Non-persistent derived profile preview' })
  profilePreview(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ProfilePreviewRequestDto,
  ) {
    return this.questionnaireService.profilePreview(user.userId, dto.answers);
  }

  @Post('reassess')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create placement/reassess profile revision' })
  reassess(@CurrentUser() user: AuthUserPayload) {
    return this.questionnaireService.reassess(user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get current questionnaire (draft or submitted)' })
  get(@CurrentUser() user: AuthUserPayload) {
    return this.questionnaireService.getForUser(user.userId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upsert questionnaire draft answers' })
  upsertDraft(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpsertQuestionnaireDto,
  ) {
    return this.questionnaireService.upsertDraft(user.userId, dto.answers);
  }

  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit questionnaire, create learner profile, enqueue roadmap',
  })
  submit(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: SubmitQuestionnaireDto,
  ) {
    return this.questionnaireService.submit(user.userId, dto.answers, {
      schemaVersion: dto.schemaVersion,
    });
  }
}

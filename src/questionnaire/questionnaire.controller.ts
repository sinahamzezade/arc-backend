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
  IntakeChatMessageDto,
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
    summary: 'Complete chat intake — same submit path as form',
  })
  chatComplete(@CurrentUser() user: AuthUserPayload) {
    return this.intakeChat.complete(user.userId);
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
    summary: 'Submit questionnaire, upsert goal, enqueue roadmap',
  })
  submit(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: SubmitQuestionnaireDto,
  ) {
    return this.questionnaireService.submit(user.userId, dto.answers);
  }
}

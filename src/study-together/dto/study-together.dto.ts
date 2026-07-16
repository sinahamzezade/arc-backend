import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  STUDY_ALLOWED_DURATIONS_MIN,
  STUDY_CHAT_MESSAGE_MAX_LEN,
  STUDY_MESSAGE_MAX_LEN,
  StudyStartMode,
  StudySubject,
} from '../study.constants';

const SUBJECTS = Object.values(StudySubject);
const START_MODES = Object.values(StudyStartMode);
const DURATIONS = [...STUDY_ALLOWED_DURATIONS_MIN];

export class CreateStudySessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  inviteeId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  lessonId: string;

  @ApiProperty({ enum: SUBJECTS })
  @IsIn(SUBJECTS)
  subject: StudySubject;

  @ApiProperty({ enum: DURATIONS })
  @IsInt()
  @IsIn(DURATIONS)
  durationMinutes: number;

  @ApiProperty({ enum: START_MODES })
  @IsIn(START_MODES)
  startMode: StudyStartMode;

  @ApiPropertyOptional({ maxLength: STUDY_MESSAGE_MAX_LEN })
  @IsOptional()
  @IsString()
  @MaxLength(STUDY_MESSAGE_MAX_LEN)
  message?: string;

  @ApiPropertyOptional({
    description: 'Required when startMode=scheduled',
  })
  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string;
}

/** Create a persistent stack co-roadmap invite. */
export class CreateStudyPathDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  partnerId: string;

  @ApiPropertyOptional({
    description: 'Content-pool stack slug (preferred) — e.g. digital-marketing',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  stack?: string;

  @ApiPropertyOptional({
    description: 'Legacy alias — treated as stack slug',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  unitId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Creator lesson UUID — resolved to stack when stack omitted',
  })
  @IsOptional()
  @IsUUID()
  lessonId?: string;

  @ApiPropertyOptional({ maxLength: STUDY_MESSAGE_MAX_LEN })
  @IsOptional()
  @IsString()
  @MaxLength(STUDY_MESSAGE_MAX_LEN)
  message?: string;
}

/** Start a timed episode room on an accepted/active path. */
export class CreateStudyEpisodeDto {
  @ApiProperty({ enum: DURATIONS })
  @IsInt()
  @IsIn(DURATIONS)
  durationMinutes: number;

  @ApiProperty({ enum: START_MODES })
  @IsIn(START_MODES)
  startMode: StudyStartMode;

  @ApiPropertyOptional({
    description: 'Required when startMode=scheduled',
  })
  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class StudyIdempotencyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class StudyTaskDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  taskLabel?: string;

  @ApiPropertyOptional({
    description: 'Mark a meaningful learning action completed',
  })
  @IsOptional()
  @IsBoolean()
  meaningfulAction?: boolean;
}

export class StudyHeartbeatDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  appVisible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  focusActive?: boolean;
}

export class StudyCompleteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  meaningfulAction?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class StudyHistoryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class StudyChatSendDto {
  @ApiProperty({ maxLength: STUDY_CHAT_MESSAGE_MAX_LEN })
  @IsString()
  @MaxLength(STUDY_CHAT_MESSAGE_MAX_LEN)
  body: string;
}

export class StudyMessagesQueryDto {
  @ApiPropertyOptional({ description: 'Message id cursor for pagination' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

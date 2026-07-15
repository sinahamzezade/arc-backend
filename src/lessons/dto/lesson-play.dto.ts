import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLessonProgressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  contentStep?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  practiceDone?: boolean;

  @ApiPropertyOptional({
    description: 'Answers keyed by question id (q0..): option index or boolean',
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'boolean' }] },
  })
  @IsOptional()
  @IsObject()
  quizAnswers?: Record<string, number | boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quizIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timeSpentMinutes?: number;

  @ApiPropertyOptional({ description: 'Active attempt from start/play' })
  @IsOptional()
  @IsString()
  attemptId?: string;
}

/** Self-attest for practice / mini_project / interactive tasks. */
export class CheckPracticeDto {
  @ApiProperty({ description: 'Active attempt id from start/play' })
  @IsString()
  attemptId!: string;

  @ApiPropertyOptional({ description: 'Learner attests the task is done' })
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({ description: 'True if learner opened a hint' })
  @IsOptional()
  @IsBoolean()
  hintUsed?: boolean;
}

export class CheckQuizDto {
  @ApiProperty({ description: 'Active attempt id from start/play' })
  @IsString()
  attemptId!: string;

  @ApiPropertyOptional({ description: 'Question id (q0, q1, ...)' })
  @IsOptional()
  @IsString()
  questionId?: string;

  @ApiPropertyOptional({ description: 'Question index — fallback for id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  questionIndex?: number;

  @ApiPropertyOptional({ description: 'Selected option index (mcq)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  optionIndex?: number;

  @ApiPropertyOptional({ description: 'Selected answer (boolean questions)' })
  @IsOptional()
  @IsBoolean()
  booleanAnswer?: boolean;
}

export class CompleteLessonDto {
  @ApiPropertyOptional({
    description: 'Answers keyed by question id (q0..): option index or boolean',
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'boolean' }] },
  })
  @IsOptional()
  @IsObject()
  quizAnswers?: Record<string, number | boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timeSpentMinutes?: number;

  @ApiProperty({ description: 'Active attempt id from start/play' })
  @IsString()
  attemptId!: string;
}

export class ArloChatDto {
  @ApiProperty()
  @IsString()
  message!: string;
}

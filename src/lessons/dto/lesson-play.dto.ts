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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  practiceOptionId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  quizAnswers?: Record<string, string>;

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

  @ApiPropertyOptional({ description: 'Active attempt — validates answer IDs' })
  @IsOptional()
  @IsString()
  attemptId?: string;
}

export class CheckPracticeDto {
  @ApiProperty({ description: 'Active attempt id from start/play' })
  @IsString()
  attemptId!: string;

  @ApiProperty({ description: 'Selected option id' })
  @IsString()
  optionId!: string;

  @ApiPropertyOptional({
    description: 'Practice or recovery item id (defaults to practice.id)',
  })
  @IsOptional()
  @IsString()
  itemId?: string;

  @ApiPropertyOptional({ description: 'True if learner opened the hint' })
  @IsOptional()
  @IsBoolean()
  hintUsed?: boolean;
}

export class CheckQuizDto {
  @ApiProperty({ description: 'Active attempt id from start/play' })
  @IsString()
  attemptId!: string;

  @ApiProperty({ description: 'Selected option id' })
  @IsString()
  optionId!: string;

  @ApiPropertyOptional({
    description: 'Quiz question or recovery item id (§16.4)',
  })
  @IsOptional()
  @IsString()
  itemId?: string;

  /** @deprecated Prefer itemId — kept for older clients */
  @ApiPropertyOptional({ description: 'Alias for itemId' })
  @IsOptional()
  @IsString()
  questionId?: string;
}

export class CompleteLessonDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  quizAnswers?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  practiceOptionId?: string;

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

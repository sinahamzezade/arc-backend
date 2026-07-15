import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UpsertQuestionnaireDto {
  @ApiProperty({
    description: 'Partial or full questionnaire answers snapshot',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  answers: Record<string, unknown>;
}

export class SubmitQuestionnaireDto {
  @ApiProperty({
    description: 'Complete questionnaire answers for final submit',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  answers: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Client schema version — rejects if stale',
  })
  @IsOptional()
  schemaVersion?: number;
}

export class ProfilePreviewRequestDto {
  @ApiProperty({
    description: 'Partial or full answers for non-persistent preview',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  answers: Record<string, unknown>;
}

export class SetIntakeModeDto {
  @ApiProperty({ enum: ['form', 'chat'] })
  @IsIn(['form', 'chat'])
  mode: 'form' | 'chat';
}

export class IntakeChatSelectionDto {
  @ApiProperty({ description: 'Schema field id, e.g. goal' })
  @IsString()
  @MinLength(1)
  fieldId: string;

  @ApiProperty({
    description: 'Selected option values (tokens)',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  values: string[];

  @ApiPropertyOptional({ description: 'Free-text when value includes other' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  otherText?: string;

  @ApiPropertyOptional({
    description:
      'Compound-step sub-question this selection answers (e.g. preferredSessionMinutes, deadline, useFrequency, confidence, exposure)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  subField?: string;

  @ApiPropertyOptional({
    description: 'Skill slug when answering an exposure sub-question',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  skillSlug?: string;

  @ApiPropertyOptional({
    description: 'Schedule days when field is schedule',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  days?: string[];

  @ApiPropertyOptional({
    description: 'Schedule times when field is schedule',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  times?: string[];
}

export class IntakeChatCompleteDto {
  @ApiPropertyOptional({
    description:
      'Legacy: submit immediately when complete. Preferred flow leaves this unset — chat/complete then returns readyForReview and the client finalizes via POST /questionnaire/submit.',
  })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class IntakeChatMessageDto {
  @ApiPropertyOptional({ description: 'Free-text chat message' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ type: IntakeChatSelectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntakeChatSelectionDto)
  selection?: IntakeChatSelectionDto;
}

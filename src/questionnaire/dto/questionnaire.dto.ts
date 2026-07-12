import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

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
}

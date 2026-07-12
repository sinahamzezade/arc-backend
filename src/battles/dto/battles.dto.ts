import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  BATTLE_QUESTION_COUNTS,
  BATTLE_SECONDS_OPTIONS,
  BattleDifficulty,
  BattleMode,
} from '../battle.constants';

export class CreateBattleDto {
  @IsUUID()
  opponentId!: string;

  @IsString()
  @Length(1, 64)
  subject!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  topic?: string;

  @IsIn(Object.values(BattleDifficulty))
  difficulty!: BattleDifficulty;

  @IsIn([...BATTLE_QUESTION_COUNTS])
  @Type(() => Number)
  questions!: number;

  @IsIn([...BATTLE_SECONDS_OPTIONS])
  @Type(() => Number)
  secondsPerQuestion!: number;

  @IsIn(Object.values(BattleMode))
  mode!: BattleMode;

  @IsInt()
  @Min(50)
  @Max(1000)
  @Type(() => Number)
  stake!: number;

  @IsString()
  @Length(8, 64)
  idempotencyKey!: string;
}

export class BattleIdempotencyDto {
  @IsString()
  @Length(8, 128)
  idempotencyKey!: string;
}

export class SubmitBattleAnswerDto {
  @IsUUID()
  battleQuestionId!: string;

  @ValidateIf((o: SubmitBattleAnswerDto) => !o.timedOut)
  @IsString()
  @Length(1, 64)
  selectedOptionId?: string;

  @IsOptional()
  @Type(() => Boolean)
  timedOut?: boolean;

  @IsInt()
  @Min(0)
  @Max(120_000)
  @Type(() => Number)
  responseMs!: number;

  @IsString()
  @Length(8, 128)
  idempotencyKey!: string;
}

export class BattleHistoryQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;
}

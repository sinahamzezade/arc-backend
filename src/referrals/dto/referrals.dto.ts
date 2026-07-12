import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { ReferralShareChannel } from '../referral.constants';

export class CreateReferralLinkDto {
  @IsIn(Object.values(ReferralShareChannel))
  channel!: ReferralShareChannel;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  campaign?: string;

  @IsOptional()
  @IsString()
  @Length(2, 8)
  locale?: string;
}

export class ClaimReferralCodeDto {
  @IsString()
  @Length(3, 32)
  code!: string;
}

export class ReferralShareEventDto {
  @IsString()
  @Length(8, 64)
  clientEventId!: string;

  @IsString()
  @Length(1, 64)
  eventType!: string;

  @IsOptional()
  @IsIn(Object.values(ReferralShareChannel))
  channel?: ReferralShareChannel;
}

export class ReferralCursorDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LeaderboardQueryDto {
  @ApiPropertyOptional({ description: 'Offset cursor for pagination' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class HistoryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class UpdateLeaguePrivacyDto {
  @ApiProperty()
  @IsBoolean()
  hideFromProfile!: boolean;
}

export class IngestLeagueXpDto {
  @IsUUID()
  ledgerEntryId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  xpDelta!: number;

  @IsString()
  sourceType!: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;

  @IsOptional()
  @IsBoolean()
  isProofWeighted?: boolean;
}

export class UpdateRankGateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  rankLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weeklySeals?: number;
}

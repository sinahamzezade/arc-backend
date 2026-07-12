import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';
import { BADGE_FEATURED_MAX } from '../badge.constants';

export class SetFeaturedBadgesDto {
  @ApiProperty({ type: [String], maxItems: BADGE_FEATURED_MAX })
  @IsArray()
  @ArrayMaxSize(BADGE_FEATURED_MAX)
  @IsString({ each: true })
  codes: string[];
}

export class SetBadgeVisibilityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showOnProfile?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showProgress?: boolean;
}

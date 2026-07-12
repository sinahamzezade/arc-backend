import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  learningReminders?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  weeklyProgress?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  streakReminders?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rewards?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  social?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  studyTogetherInvites?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  battleInvites?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  leagueUpdates?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  luckyWheel?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  coachMessages?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @ApiPropertyOptional({ example: '22:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  quietHoursStart?: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  quietHoursEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

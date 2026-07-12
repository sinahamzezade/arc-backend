import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'Push: streak, battles, league cuts' })
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({ description: 'Email digests: weekly progress summary' })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({ description: 'Streak reminders: nudge before day ends' })
  @IsOptional()
  @IsBoolean()
  streakReminders?: boolean;

  @ApiPropertyOptional({ description: 'Battle invites: friends can ping live' })
  @IsOptional()
  @IsBoolean()
  battleInvites?: boolean;

  @ApiPropertyOptional({ description: 'Product updates: new features & tips' })
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;
}

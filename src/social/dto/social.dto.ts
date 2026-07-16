import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  InviteFromPolicy,
  MessagesFromPolicy,
  PresenceVisibility,
  ProfileVisibility,
} from '../entities/social-privacy-settings.entity';
import {
  SocialReportContext,
  SocialReportReason,
} from '../entities/user-report.entity';

export class CreateFriendRequestDto {
  @IsUUID()
  receiverId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  message?: string;
}

export class FriendsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  online?: boolean;
}

export class SearchUsersQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  q!: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class CursorQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class ActivityQueryDto {
  @IsOptional()
  @IsIn(['friends', 'following', 'me'])
  scope?: 'friends' | 'following' | 'me';

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class RemoveFriendDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unfollow?: boolean;
}

export class BlockUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;
}

export class CreateReportDto {
  @IsUUID()
  reportedUserId!: string;

  @IsEnum(SocialReportContext)
  contextType!: SocialReportContext;

  @IsOptional()
  @IsUUID()
  contextId?: string;

  @IsEnum(SocialReportReason)
  reason!: SocialReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class UpdatePrivacyDto {
  @IsOptional()
  @IsEnum(ProfileVisibility)
  profileVisibility?: ProfileVisibility;

  @IsOptional()
  @IsBoolean()
  showWeeklyXp?: boolean;

  @IsOptional()
  @IsBoolean()
  showStreak?: boolean;

  @IsOptional()
  @IsBoolean()
  showCurrentLesson?: boolean;

  @IsOptional()
  @IsBoolean()
  showBattleHistory?: boolean;

  @IsOptional()
  @IsBoolean()
  showStudyActivity?: boolean;

  @IsOptional()
  @IsBoolean()
  allowFriendRequests?: boolean;

  @IsOptional()
  @IsBoolean()
  allowFollows?: boolean;

  @IsOptional()
  @IsEnum(InviteFromPolicy)
  allowBattleInvitesFrom?: InviteFromPolicy;

  @IsOptional()
  @IsEnum(InviteFromPolicy)
  allowStudyInvitesFrom?: InviteFromPolicy;

  @IsOptional()
  @IsEnum(MessagesFromPolicy)
  allowMessagesFrom?: MessagesFromPolicy;

  @IsOptional()
  @IsEnum(PresenceVisibility)
  presenceVisibility?: PresenceVisibility;

  @IsOptional()
  @IsBoolean()
  leaderboardVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  hideFromSuggestions?: boolean;
}

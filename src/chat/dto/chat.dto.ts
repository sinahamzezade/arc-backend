import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ChatMessageType,
  ChatReportReason,
  ConversationType,
} from '../chat.constants';

export class CreateConversationDto {
  @IsEnum(ConversationType)
  type!: ConversationType;

  /** Required for direct: exactly one other user. */
  @ValidateIf((o: CreateConversationDto) => o.type === ConversationType.Direct)
  @IsUUID()
  peerUserId?: string;

  @ValidateIf((o: CreateConversationDto) => o.type === ConversationType.Group)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ValidateIf((o: CreateConversationDto) => o.type === ConversationType.Group)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  @IsUUID('4', { each: true })
  memberIds?: string[];
}

export class ConversationsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class MessagesQueryDto {
  @IsOptional()
  @IsString()
  before?: string; // `${iso}|${id}` or just id — use createdAt|id cursor

  @IsOptional()
  @IsString()
  after?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class SendMessageDto {
  @IsUUID()
  clientMsgId!: string;

  @IsEnum(ChatMessageType)
  type!: ChatMessageType;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsUUID()
  attachmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60_000)
  durationMs?: number;

  @IsOptional()
  @IsUUID()
  replyToId?: string;
}

export class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class MarkReadDto {
  @IsUUID()
  lastReadMessageId!: string;
}

export class AddMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class BlockUserDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;
}

export class CreateChatReportDto {
  @IsUUID()
  reportedUserId!: string;

  @IsOptional()
  @IsUUID()
  messageId?: string;

  @IsEnum(ChatReportReason)
  reason!: ChatReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  detail?: string;
}

export class MuteConversationDto {
  @IsBoolean()
  muted!: boolean;
}

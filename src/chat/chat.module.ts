import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Profile } from '../profiles/entities/profile.entity';
import { SocialModule } from '../social/social.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatSchemaService } from './chat-schema.service';
import { ChatService } from './chat.service';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatReport } from './entities/chat-report.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Conversation } from './entities/conversation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationMember,
      ChatMessage,
      ChatAttachment,
      ChatReport,
      Profile,
    ]),
    SocialModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    UploadsModule,
    forwardRef(() => GamificationModule),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatSchemaService],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}

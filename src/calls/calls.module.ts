import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SocialModule } from '../social/social.module';
import { UsersModule } from '../users/users.module';
import { CallSchemaService } from './call-schema.service';
import { CallService } from './call.service';
import { CallsController } from './calls.controller';
import { Call } from './entities/call.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Call]),
    AuthModule,
    UsersModule,
    SocialModule,
    NotificationsModule,
    forwardRef(() => ChatModule),
  ],
  controllers: [CallsController],
  providers: [CallService, CallSchemaService],
  exports: [CallService],
})
export class CallsModule {}

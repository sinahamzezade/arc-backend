import { Module, forwardRef } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SocialModule } from '../social/social.module';
import { AuthModule } from './auth.module';
import { MePulseController } from './me-pulse.controller';
import { MePulseService } from './me-pulse.service';

/**
 * Isolated from AuthModule so Auth ↔ Chat circular imports do not break boot.
 */
@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    SocialModule,
    forwardRef(() => ChatModule),
  ],
  controllers: [MePulseController],
  providers: [MePulseService],
})
export class MePulseModule {}

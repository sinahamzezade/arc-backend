import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationSchedule } from './entities/notification-schedule.entity';
import { Notification } from './entities/notification.entity';
import { PushDevice } from './entities/push-device.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      NotificationPreference,
      PushDevice,
      NotificationSchedule,
      NotificationDelivery,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

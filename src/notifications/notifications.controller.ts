import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { NotificationCategory } from './entities/notification.entity';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { RegisterPushDeviceDto } from './dto/register-push-device.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-preferences.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List inbox notifications (cursor-paginated)' })
  list(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notificationsService.list(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count (home badge)' })
  async unreadCount(@CurrentUser() user: AuthUserPayload) {
    const unreadCount = await this.notificationsService.countUnread(
      user.userId,
    );
    return { unreadCount };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Notification preference toggles' })
  getPreferences(@CurrentUser() user: AuthUserPayload) {
    return this.notificationsService.getPreferences(user.userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification preference toggles' })
  updatePreferences(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(user.userId, dto);
  }

  @Post('devices')
  @ApiOperation({ summary: 'Register push / web-push device' })
  registerDevice(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: RegisterPushDeviceDto,
  ) {
    return this.notificationsService.registerDevice(user.userId, dto);
  }

  @Delete('devices/:id')
  @ApiOperation({ summary: 'Revoke push device' })
  revokeDevice(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.revokeDevice(user.userId, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all (or category) notifications read' })
  markAllRead(
    @CurrentUser() user: AuthUserPayload,
    @Query('category') category?: NotificationCategory,
  ) {
    return this.notificationsService.markAllRead(user.userId, category);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read (or unread)' })
  markRead(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('unread') unread?: string,
  ) {
    return this.notificationsService.markRead(
      user.userId,
      id,
      unread === 'true' || unread === '1',
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hide inbox notification' })
  hide(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.hide(user.userId, id);
  }
}

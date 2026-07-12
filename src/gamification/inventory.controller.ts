import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'User inventory' })
  list(@CurrentUser() user: AuthUserPayload) {
    return this.inventory.list(user.userId);
  }

  @Post(':id/equip')
  @ApiOperation({ summary: 'Equip cosmetic inventory item' })
  equip(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
  ) {
    return this.inventory.equip(user.userId, id);
  }
}

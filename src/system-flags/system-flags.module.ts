import { Global, Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SystemFlag } from './entities/system-flag.entity';
import { UserFeatureFlag } from './entities/user-feature-flag.entity';
import { SystemFlagsController } from './system-flags.controller';
import { SystemFlagsService } from './system-flags.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SystemFlag, UserFeatureFlag]),
    forwardRef(() => AuthModule),
  ],
  controllers: [SystemFlagsController],
  providers: [SystemFlagsService],
  exports: [SystemFlagsService],
})
export class SystemFlagsModule {}

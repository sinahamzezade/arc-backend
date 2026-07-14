import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmUsageEvent } from './entities/llm-usage-event.entity';
import { LlmUsageService } from './llm-usage.service';
import { LlmService } from './llm.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([LlmUsageEvent])],
  providers: [LlmUsageService, LlmService],
  exports: [LlmUsageService, LlmService],
})
export class LlmModule {}

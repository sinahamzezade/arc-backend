import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * BullMQ worker process — run separately from HTTP replicas under load.
 * Usage: node dist/worker.js
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = new Logger('WorkerBootstrap');
  app.enableShutdownHooks();
  logger.log('Arlo worker started');
}

bootstrap();

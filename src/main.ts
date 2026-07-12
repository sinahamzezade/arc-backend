import {
  BadRequestException,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AuthErrorCode } from './common/errors/auth-error.codes';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());

  const corsOrigin =
    config.get<string>('CORS_ORIGIN') || 'http://localhost:3000';
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const message = errors
          .map((e) => Object.values(e.constraints ?? {}).join(', '))
          .filter(Boolean)
          .join('; ');
        return new BadRequestException({
          code: AuthErrorCode.VALIDATION_ERROR,
          message: message || 'Validation failed',
        });
      },
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('Arc API')
    .setDescription('Arc backend — auth & user APIs')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get<number>('PORT') || 9000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Server started at ${await app.getUrl()}`);
  logger.log(`Swagger at ${await app.getUrl()}/docs`);
}

bootstrap();

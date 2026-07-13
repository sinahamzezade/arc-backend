import {
  BadRequestException,
  Logger,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import session from 'express-session';
import { readdirSync, readFileSync, watch } from 'fs';
import hbs from 'hbs';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { AuthErrorCode } from './common/errors/auth-error.codes';

function registerAdminPartials(partialsDir: string) {
  for (const file of readdirSync(partialsDir)) {
    if (!file.endsWith('.hbs')) continue;
    const name = file.slice(0, -'.hbs'.length);
    hbs.registerPartial(name, readFileSync(join(partialsDir, file), 'utf8'));
  }
}

function watchAdminPartials(partialsDir: string, logger: Logger) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(partialsDir, { persistent: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        registerAdminPartials(partialsDir);
        logger.log('Admin HBS partials reloaded');
      } catch (err) {
        logger.warn(`Failed to reload admin partials: ${String(err)}`);
      }
    }, 150);
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const isProd = config.get<string>('NODE_ENV') === 'production';
  const viewsDir = isProd
    ? join(__dirname, 'admin', 'views')
    : join(process.cwd(), 'src', 'admin', 'views');

  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'r/(.*)', method: RequestMethod.ALL },
      { path: 'admin', method: RequestMethod.ALL },
      { path: 'admin/login', method: RequestMethod.ALL },
      { path: 'admin/logout', method: RequestMethod.ALL },
      { path: 'admin/users', method: RequestMethod.ALL },
      { path: 'admin/users/(.*)', method: RequestMethod.ALL },
      { path: 'admin/ranks', method: RequestMethod.ALL },
      { path: 'admin/ranks/(.*)', method: RequestMethod.ALL },
      { path: 'admin/store', method: RequestMethod.ALL },
      { path: 'admin/store/(.*)', method: RequestMethod.ALL },
      { path: 'admin/badges', method: RequestMethod.ALL },
      { path: 'admin/badges/(.*)', method: RequestMethod.ALL },
      { path: 'admin/wheel', method: RequestMethod.ALL },
      { path: 'admin/wheel/(.*)', method: RequestMethod.ALL },
      { path: 'admin/courses', method: RequestMethod.ALL },
      { path: 'admin/courses/(.*)', method: RequestMethod.ALL },
      { path: 'admin/datasets', method: RequestMethod.ALL },
      { path: 'admin/datasets/(.*)', method: RequestMethod.ALL },
      { path: 'admin/roles', method: RequestMethod.ALL },
      { path: 'admin/roles/(.*)', method: RequestMethod.ALL },
      { path: 'admin/skill-graph', method: RequestMethod.ALL },
      { path: 'admin/skill-graph/(.*)', method: RequestMethod.ALL },
      { path: 'admin/questionnaire', method: RequestMethod.ALL },
      { path: 'admin/questionnaire/(.*)', method: RequestMethod.ALL },
      { path: 'admin/roadmap-engine', method: RequestMethod.ALL },
      { path: 'admin/roadmap-engine/(.*)', method: RequestMethod.ALL },
      { path: 'admin/api/(.*)', method: RequestMethod.ALL },
      { path: 'admin-assets/(.*)', method: RequestMethod.ALL },
      { path: 'uploads/(.*)', method: RequestMethod.ALL },
    ],
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/admin')) {
      return helmet({ contentSecurityPolicy: false })(req, res, next);
    }
    return helmet()(req, res, next);
  });

  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(
    session({
      name: 'arc_admin_sid',
      secret:
        config.get<string>('ADMIN_SESSION_SECRET') ||
        'dev-admin-session-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/admin',
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  app.setBaseViewsDir(viewsDir);
  app.setViewEngine('hbs');
  const partialsDir = join(viewsDir, 'partials');
  registerAdminPartials(partialsDir);
  if (!isProd) {
    watchAdminPartials(partialsDir, logger);
  }
  app.useStaticAssets(join(__dirname, '..', 'public', 'admin-ui'), {
    prefix: '/admin-assets',
  });
  app.useStaticAssets(join(__dirname, '..', 'public', 'uploads'), {
    prefix: '/uploads',
  });

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
  logger.log(`Admin panel at ${await app.getUrl()}/admin`);
}

bootstrap();

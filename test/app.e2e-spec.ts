import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AuthErrorCode } from './../src/common/errors/auth-error.codes';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const email = `e2e-${Date.now()}@arc.app`;
  const password = 'Secret1!';
  let accessToken = '';

  it('POST /auth/register', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, agreeToTerms: true })
      .expect(201);

    expect(res.body.user.email).toBe(email);
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.profile).toBeDefined();
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.profile.totalXp).toBe(0);
    expect(res.body.profile.gems).toBe(0);
    expect(res.body.profile.coins).toBe(0);
    accessToken = res.body.accessToken;
  });

  it('POST /auth/register rejects weak password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `weak-${Date.now()}@arc.app`,
        password: 'password',
        agreeToTerms: true,
      })
      .expect(400);

    expect(res.body.code).toBe(AuthErrorCode.PASSWORD_TOO_WEAK);
  });

  it('POST /auth/login', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    accessToken = res.body.accessToken;
  });

  it('GET /me', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.user.email).toBe(email);
    expect(res.body.profile.coins).toBe(0);
  });

  it('PATCH /me/profile', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: 'Soheil',
      })
      .expect(200);

    expect(res.body.profile.displayName).toBe('Soheil');
  });

  it('POST /auth/login fails safely', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Wrong1!' })
      .expect(401);

    expect(res.body.code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
  });
});

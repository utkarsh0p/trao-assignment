import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildServer, signIn } from './serverHelpers.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/server/auth/tokens.js';

const cookieNames = (response) =>
  (response.headers['set-cookie'] ?? []).map((cookie) => cookie.split('=')[0]);

const credentials = { email: 'ada@example.com', password: 'correct-horse-battery' };

describe('auth', () => {
  it('registers a user and puts the session in httpOnly cookies, never in the body', async () => {
    const { app } = buildServer();
    const response = await request(app).post('/auth/register').send(credentials);

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ email: 'ada@example.com' });
    expect(JSON.stringify(response.body)).not.toContain('eyJ'); // no JWT anywhere in the reply

    const cookies = response.headers['set-cookie'];
    expect(cookieNames(response)).toEqual([ACCESS_COOKIE, REFRESH_COOKIE]);
    for (const cookie of cookies) expect(cookie).toContain('HttpOnly');
  });

  it('never stores the password', async () => {
    const { app, store } = buildServer();
    await request(app).post('/auth/register').send(credentials);

    const user = await store.users.findByEmail(credentials.email);
    expect(user.passwordHash).not.toContain(credentials.password);
    expect(user.passwordHash.startsWith('$2')).toBe(true);
  });

  it('refuses a second account on the same email', async () => {
    const { app } = buildServer();
    await request(app).post('/auth/register').send(credentials);

    const second = await request(app).post('/auth/register').send(credentials);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('rejects a short password with the field that was wrong', async () => {
    const { app } = buildServer();
    const response = await request(app)
      .post('/auth/register')
      .send({ email: 'ada@example.com', password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.detail[0].field).toBe('password');
  });

  it('answers a wrong password and an unknown account identically', async () => {
    const { app } = buildServer();
    await request(app).post('/auth/register').send(credentials);

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ ...credentials, password: 'not-the-password' });
    const noSuchUser = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(noSuchUser.body);
  });

  it('logs in and answers /auth/me from the cookie', async () => {
    const { app } = buildServer();
    await request(app).post('/auth/register').send(credentials);

    const agent = request.agent(app);
    await agent.post('/auth/login').send(credentials).expect(200);

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('ada@example.com');
  });

  it('refuses /auth/me without a session', async () => {
    const { app } = buildServer();
    const response = await request(app).get('/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rotates the refresh token, issuing a new one and retiring the old', async () => {
    const { app } = buildServer();
    const agent = await signIn(app);

    const refreshed = await agent.post('/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(cookieNames(refreshed)).toEqual([ACCESS_COOKIE, REFRESH_COOKIE]);

    // The new cookie works, which means the agent is holding the rotated token, not the old one.
    await agent.post('/auth/refresh').expect(200);
  });

  it('revokes the whole family when an already-rotated token comes back', async () => {
    const { app } = buildServer();
    const agent = await signIn(app);

    // Capture the first refresh token, then rotate past it.
    const stolen = await agent
      .post('/auth/refresh')
      .then((response) =>
        response.headers['set-cookie']
          .find((cookie) => cookie.startsWith(REFRESH_COOKIE))
          .split(';')[0],
      );
    await agent.post('/auth/refresh').expect(200);

    // Someone presents the copy they kept. It is valid, signed and unexpired — and it is evidence.
    const replayed = await request(app).post('/auth/refresh').set('Cookie', stolen);
    expect(replayed.status).toBe(401);

    // The legitimate holder is logged out too: one of the two is a thief and we cannot tell which.
    await agent.post('/auth/refresh').expect(401);
  });

  it('logs out for real — the stored token is gone, not merely forgotten by the client', async () => {
    const { app, store } = buildServer();
    const agent = await signIn(app);

    await agent.post('/auth/logout').expect(204);
    await agent.post('/auth/refresh').expect(401);

    const user = await store.users.findByEmail('ada@example.com');
    expect(await store.refreshTokens.deleteForUser(user.id)).toBe(0);
  });

  it('logs out everywhere on request', async () => {
    const { app } = buildServer();
    await request(app).post('/auth/register').send(credentials);

    const laptop = request.agent(app);
    const phone = request.agent(app);
    await laptop.post('/auth/login').send(credentials).expect(200);
    await phone.post('/auth/login').send(credentials).expect(200);

    await laptop.post('/auth/logout-all').expect(204);
    await phone.post('/auth/refresh').expect(401);
  });

  it('rejects a forged access token', async () => {
    const { app } = buildServer();
    const response = await request(app).get('/auth/me').set('Cookie', `${ACCESS_COOKIE}=forged`);

    expect(response.status).toBe(401);
  });
});

'use strict';

const jsonwebtoken = require('jsonwebtoken');
const controllerFactory = require('../../src/api/auth-token/controllers/auth-token');
const routes = require('../../src/api/auth-token/routes/auth-token');

const SECRET = 'test-secret-that-is-at-least-32-bytes-long';
const JWT_OPTIONS = { expiresIn: '1h', issuer: 'tarhelahi-strapi', audience: 'byemoney' };
const DAY = 24 * 60 * 60;

const sign = (payload, options = {}) => {
  const merged = { ...JWT_OPTIONS, ...options };
  if (payload.exp) {
    delete merged.expiresIn;
  }
  return jsonwebtoken.sign(payload, SECRET, merged);
};

function setup(user = { id: 7, documentId: 'doc-7', blocked: false }) {
  const findOne = jest.fn().mockResolvedValue(user);
  const strapi = {
    config: {
      get: (key) => (key === 'plugin::users-permissions.jwtSecret' ? SECRET : JWT_OPTIONS),
    },
    db: { query: jest.fn().mockReturnValue({ findOne }) },
    plugin: () => ({
      service: () => ({ issue: (payload) => jsonwebtoken.sign(payload, SECRET, JWT_OPTIONS) }),
    }),
  };
  return { controller: controllerFactory({ strapi }), findOne };
}

function makeCtx(body, strategy = 'api-token') {
  return {
    state: { auth: { strategy: { name: strategy } } },
    request: { body },
    body: undefined,
    set: jest.fn(),
    forbidden: jest.fn().mockReturnValue('forbidden'),
    badRequest: jest.fn().mockReturnValue('badRequest'),
    unauthorized: jest.fn().mockReturnValue('unauthorized'),
  };
}

describe('POST /auth/token/refresh (BND-08)', () => {
  test('route accepts only the API token strategy', () => {
    expect(routes.routes[0].config.auth.strategies).toEqual(['api-token']);
  });

  test('user JWT strategy is forbidden', async () => {
    const { controller } = setup();
    const ctx = makeCtx({ jwt: sign({ id: 7, documentId: 'doc-7' }) }, 'users-permissions');
    await controller.refresh(ctx);
    expect(ctx.forbidden).toHaveBeenCalled();
    expect(ctx.body).toBeUndefined();
  });

  test('missing token is a bad request', async () => {
    const { controller } = setup();
    const ctx = makeCtx({});
    await controller.refresh(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
  });

  test.each([
    ['wrong signature', jsonwebtoken.sign({ id: 7 }, 'another-secret-another-secret-0000', JWT_OPTIONS)],
    ['wrong audience', sign({ id: 7 }, { audience: 'other' })],
    ['expired beyond session lifetime', sign({ id: 7, exp: Math.floor(Date.now() / 1000) - 31 * DAY })],
  ])('%s is unauthorized', async (_, token) => {
    const { controller } = setup();
    const ctx = makeCtx({ jwt: token });
    await controller.refresh(ctx);
    expect(ctx.unauthorized).toHaveBeenCalled();
    expect(ctx.body).toBeUndefined();
  });

  test.each([
    ['blocked user', { id: 7, documentId: 'doc-7', blocked: true }],
    ['missing user', null],
    ['documentId mismatch', { id: 7, documentId: 'other', blocked: false }],
  ])('%s is unauthorized', async (_, user) => {
    const { controller } = setup(user);
    const ctx = makeCtx({ jwt: sign({ id: 7, documentId: 'doc-7' }) });
    await controller.refresh(ctx);
    expect(ctx.unauthorized).toHaveBeenCalled();
  });

  test('expired token within session lifetime is renewed with same claims and fresh exp', async () => {
    const { controller, findOne } = setup();
    const oldExp = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const ctx = makeCtx({ jwt: sign({ id: 7, documentId: 'doc-7', exp: oldExp }) });
    await controller.refresh(ctx);

    expect(findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
    const decoded = jsonwebtoken.verify(ctx.body.jwt, SECRET, { issuer: 'tarhelahi-strapi', audience: 'byemoney' });
    expect(decoded).toMatchObject({ id: 7, documentId: 'doc-7' });
    expect(decoded.exp).toBeGreaterThan(oldExp);
    expect(decoded.exp - decoded.iat).toBe(60 * 60);
    expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

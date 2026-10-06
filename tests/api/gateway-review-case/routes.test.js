'use strict';

const path = require('node:path');
const coreDir = path.dirname(require.resolve('@strapi/core'));
const registerRoutes = require(path.join(coreDir, 'services/server/register-routes.js'));
const composeEndpoint = require(path.join(coreDir, 'services/server/compose-endpoint.js'));
const createAuthentication = require(path.join(coreDir, 'services/auth/index.js'));
const strategy = require('../../../node_modules/@strapi/plugin-users-permissions/server/strategies/users-permissions');
const routeFactory = require('../../../src/api/gateway-review-case/routes/gateway-review-case');

jest.mock('../../../src/services/gatewayReviewWorkflow', () => ({ money: jest.fn() }));
const { money } = require('../../../src/services/gatewayReviewWorkflow');
const financialPolicy = require('../../../src/policies/has-financial-review-permission');

const actions = ['getSettings', 'updateSettings', 'find', 'findOne', 'resolve', 'reopen'];
let previousStrapi;
beforeEach(() => {
  previousStrapi = global.strapi;
  jest.clearAllMocks();
});
afterEach(() => { global.strapi = previousStrapi; });

function setup() {
  const user = { id: 1, documentId: 'staff-doc', role: { id: 1 }, confirmed: true, blocked: false };
  const ability = { can: jest.fn(() => false) };
  const services = {
    jwt: { getToken: async ctx => ctx.request.headers.authorization === 'Bearer staff-jwt' ? { id: 1 } : null },
    user: { fetchAuthenticatedUser: async () => user },
    permission: { findRolePermissions: async () => [], findPublicPermissions: async () => [], toContentAPIPermission: x => x },
  };
  const auth = createAuthentication();
  auth.register('content-api', strategy);
  const controller = Object.fromEntries(actions.map(action => [action, jest.fn(async ctx => { ctx.body = { action }; })]));
  const api = { routes: { review: routeFactory } };
  const strapi = {
    admin: { routes: {} }, plugins: {}, apis: { 'gateway-review-case': api }, api: () => api,
    server: { routes: jest.fn() }, controller: jest.fn(() => controller),
    plugin: () => ({ service: name => services[name] }),
    store: () => ({ get: async () => ({ email_confirmation: false }) }),
    contentAPI: { permissions: { engine: { generateAbility: async () => ability } } },
    get: name => name === 'auth' ? auth : { resolve: () => [{ handler: financialPolicy, config: {} }] },
  };
  global.strapi = strapi;
  registerRoutes(strapi);
  return { strapi, controller, ability, routes: api.routes.review.routes };
}

test('Strapi registration preserves empty local scopes on every review endpoint', () => {
  const { routes } = setup();
  expect(routes).toHaveLength(6);
  for (const route of routes) {
    expect(route.config.auth).toEqual({ scope: [] });
    expect(route.config.policies).toEqual(['global::has-financial-review-permission']);
  }
});

async function call(strapi, route, authorization = 'Bearer staff-jwt') {
  let handler;
  const router = { [route.method.toLowerCase()]: (_path, composed) => { handler = composed; } };
  route.info.type = 'content-api';
  composeEndpoint(strapi)(route, { router });
  const ctx = { state: {}, request: { headers: { authorization } },
    unauthorized: () => { ctx.status = 401; }, forbidden: () => { ctx.status = 403; } };
  await handler(ctx, async () => {});
  return ctx;
}

test('ByeMoney permission authorizes all endpoints despite no Strapi role permissions', async () => {
  const { strapi, controller, ability, routes } = setup();
  money.mockResolvedValue({ permissions: ['TopUp.Review'] });
  for (const [index, route] of routes.entries()) {
    const ctx = await call(strapi, route);
    expect(ctx.body).toEqual({ action: actions[index] });
    expect(controller[actions[index]]).toHaveBeenCalledWith(ctx);
  }
  expect(ability.can).not.toHaveBeenCalled();
  expect(money).toHaveBeenCalledTimes(6);
});

test('a caller without ByeMoney permission cannot reach the controller', async () => {
  const { strapi, controller, routes } = setup();
  money.mockResolvedValue({ permissions: [] });
  await expect(call(strapi, routes[2])).rejects.toMatchObject({ name: 'PolicyError' });
  expect(controller.find).not.toHaveBeenCalled();
});

test('missing or invalid JWT cannot reach the financial permission check', async () => {
  const { strapi, controller, routes } = setup();
  for (const authorization of ['', 'Bearer invalid-jwt']) {
    expect((await call(strapi, routes[2], authorization)).status).toBe(401);
  }
  expect(money).not.toHaveBeenCalled();
  expect(controller.find).not.toHaveBeenCalled();
});

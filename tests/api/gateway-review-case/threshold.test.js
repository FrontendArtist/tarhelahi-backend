'use strict';

const path = require('node:path');
const coreDir = path.dirname(require.resolve('@strapi/core'));
const registerRoutes = require(path.join(coreDir, 'services/server/register-routes.js'));
const composeEndpoint = require(path.join(coreDir, 'services/server/compose-endpoint.js'));
const createAuthentication = require(path.join(coreDir, 'services/auth/index.js'));
const strategy = require('../../../node_modules/@strapi/plugin-users-permissions/server/strategies/users-permissions');
const routeFactory = require('../../../src/api/gateway-review-case/routes/01-threshold');

jest.mock('@strapi/strapi', () => ({ factories: { createCoreController: (_uid, factory) => factory } }));
const controllerFactory = require('../../../src/api/gateway-review-case/controllers/gateway-review-case');

function storeStrapi(initial) {
  const data = new Map(initial === undefined ? [] : [['noCallbackMinutes', initial]]);
  return { store: () => ({ get: async ({ key }) => data.get(key) ?? null, set: async ({ key, value }) => { data.set(key, value); } }) };
}

describe('user-facing no-callback threshold', () => {
  const read = async (initial) => {
    const ctx = {};
    await controllerFactory({ strapi: storeStrapi(initial) }).getThreshold(ctx);
    return ctx.body;
  };

  test('returns the default 30 when admin never set it', async () => {
    expect(await read(undefined)).toEqual({ noCallbackMinutes: 30 });
  });
  test('returns the admin-changed value and nothing else', async () => {
    expect(await read(45)).toEqual({ noCallbackMinutes: 45 });
  });
  test('falls back to the default for an invalid stored value', async () => {
    expect(await read(0)).toEqual({ noCallbackMinutes: 30 });
  });

  describe('route', () => {
    let previousStrapi;
    beforeEach(() => { previousStrapi = global.strapi; });
    afterEach(() => { global.strapi = previousStrapi; });

    function setup() {
      const user = { id: 2, documentId: 'user-doc', role: { id: 2 }, confirmed: true, blocked: false };
      const services = {
        jwt: { getToken: async ctx => ctx.request.headers.authorization === 'Bearer user-jwt' ? { id: 2 } : null },
        user: { fetchAuthenticatedUser: async () => user },
        permission: { findRolePermissions: async () => [], findPublicPermissions: async () => [], toContentAPIPermission: x => x },
      };
      const auth = createAuthentication();
      auth.register('content-api', strategy);
      const controller = { getThreshold: jest.fn(async ctx => { ctx.body = { noCallbackMinutes: 30 }; }) };
      const api = { routes: { threshold: routeFactory } };
      const strapi = {
        admin: { routes: {} }, plugins: {}, apis: { 'gateway-review-case': api }, api: () => api,
        server: { routes: jest.fn() }, controller: jest.fn(() => controller),
        plugin: () => ({ service: name => services[name] }),
        store: () => ({ get: async () => ({ email_confirmation: false }) }),
        contentAPI: { permissions: { engine: { generateAbility: async () => ({ can: jest.fn(() => false) }) } } },
        get: name => name === 'auth' ? auth : { resolve: () => [] },
      };
      global.strapi = strapi;
      registerRoutes(strapi);
      return { strapi, controller, route: api.routes.threshold.routes[0] };
    }

    async function call(strapi, route, authorization) {
      let handler;
      const router = { [route.method.toLowerCase()]: (_p, composed) => { handler = composed; } };
      route.info.type = 'content-api';
      composeEndpoint(strapi)(route, { router });
      const ctx = { state: {}, request: { headers: { authorization } },
        unauthorized: () => { ctx.status = 401; }, forbidden: () => { ctx.status = 403; } };
      await handler(ctx, async () => {});
      return ctx;
    }

    test('is a non-admin GET path with empty scope, user-only policy and no financial policy', () => {
      const { route } = setup();
      expect(route.method).toBe('GET');
      expect(route.path).toBe('/gateway-reviews/threshold');
      expect(route.config).toEqual({ auth: { scope: [] }, policies: ['global::is-authenticated-user'] });
    });
    test('the user-only policy rejects a request with no authenticated user (live empty scope is public)', () => {
      const policy = require('../../../src/policies/is-authenticated-user');
      expect(policy({ state: {} })).toBe(false);
      expect(policy({})).toBe(false);
      expect(policy({ state: { user: { id: 2 } } })).toBe(true);
    });
    test('a logged-in user without any Strapi role permission reaches the controller', async () => {
      const { strapi, controller, route } = setup();
      const ctx = await call(strapi, route, 'Bearer user-jwt');
      expect(ctx.body).toEqual({ noCallbackMinutes: 30 });
      expect(controller.getThreshold).toHaveBeenCalledTimes(1);
    });
    test('a missing or invalid JWT never reaches the controller', async () => {
      const { strapi, controller, route } = setup();
      for (const authorization of ['', 'Bearer invalid-jwt']) expect((await call(strapi, route, authorization)).status).toBe(401);
      expect(controller.getThreshold).not.toHaveBeenCalled();
    });
  });
});

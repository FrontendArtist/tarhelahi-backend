'use strict';

const { UnauthorizedError, ForbiddenError } = require('@strapi/utils').errors;
const isAdminOrApiToken = require('../../src/policies/is-admin-or-api-token');
const customOrderRoutes = require('../../src/api/order/routes/01-custom-order').routes;
const visitorStatRoutes = require('../../src/api/visitor-stat/routes/visitor-stat').routes;

describe('Admin Routes Policy & HF18 Lockdown', () => {
  test('order admin routes and visitor-stat/stats require auth and global::is-admin-or-api-token', () => {
    const protectedOrderPaths = [
      '/orders/export-excel',
      '/orders/revenue-stats',
      '/orders/sync-excel',
      '/orders/bulk-settle',
    ];

    for (const routePath of protectedOrderPaths) {
      const route = customOrderRoutes.find((r) => r.path === routePath);
      expect(route).toBeDefined();
      expect(route.config.auth).not.toBe(false);
      expect(route.config.policies).toContain('global::is-admin-or-api-token');
    }

    const statsRoute = visitorStatRoutes.find((r) => r.path === '/visitor-stat/stats');
    expect(statsRoute).toBeDefined();
    expect(statsRoute.config.auth).not.toBe(false);
    expect(statsRoute.config.policies).toContain('global::is-admin-or-api-token');

    const trackRoute = visitorStatRoutes.find((r) => r.path === '/visitor-stat/track');
    expect(trackRoute).toBeDefined();
    expect(trackRoute.config.auth).toBe(false);
    expect(trackRoute.config.middlewares).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'global::rate-limit' }),
      ])
    );
  });

  test('policy throws UnauthorizedError (401) for anonymous caller', async () => {
    await expect(
      isAdminOrApiToken({ state: {} }, {}, { strapi: {} })
    ).rejects.toThrow(UnauthorizedError);
  });

  test('policy throws ForbiddenError (403) for normal authenticated user', async () => {
    await expect(
      isAdminOrApiToken(
        { state: { user: { id: 12, role: { type: 'authenticated' } } } },
        {},
        { strapi: {} }
      )
    ).rejects.toThrow(ForbiddenError);
  });

  test('policy allows administrator/admin user and api-token', async () => {
    await expect(
      isAdminOrApiToken(
        { state: { user: { id: 1, role: { type: 'administrator' } } } },
        {},
        { strapi: {} }
      )
    ).resolves.toBe(true);

    await expect(
      isAdminOrApiToken(
        { state: { user: { id: 2, role: { name: 'Admin' } } } },
        {},
        { strapi: {} }
      )
    ).resolves.toBe(true);

    await expect(
      isAdminOrApiToken(
        { state: { auth: { strategy: { name: 'api-token' } } } },
        {},
        { strapi: {} }
      )
    ).resolves.toBe(true);
  });
});

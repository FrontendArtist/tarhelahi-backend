'use strict';

const localityRoutes = require('../../../src/api/locality/routes/locality');
const localityController = require('../../../src/api/locality/controllers/locality');
const syncRoutes = require('../../../src/api/city/routes/01-sync');

describe('GET /localities route', () => {
  const previous = global.strapi;

  afterEach(() => {
    global.strapi = previous;
  });

  it('is a single public read route and restricts sync to admin or service key (S2-08)', () => {
    expect(localityRoutes.routes).toEqual([
      {
        method: 'GET',
        path: '/localities',
        handler: 'locality.list',
        config: { auth: false },
      },
    ]);
    expect(syncRoutes.routes).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/cities/sync-localities',
        handler: 'city.syncLocalities',
        config: {
          auth: false,
          middlewares: [syncRoutes.requireAdminOrServiceKey],
        },
      }),
    ]);
  });

  describe('sync-localities authorization guard (S2-08)', () => {
    const originalEnv = process.env.BYEMONEY_SERVICE_KEY;

    beforeEach(() => {
      process.env.BYEMONEY_SERVICE_KEY = 'secret-service-key-xyz';
    });

    afterEach(() => {
      if (originalEnv) {
        process.env.BYEMONEY_SERVICE_KEY = originalEnv;
      } else {
        delete process.env.BYEMONEY_SERVICE_KEY;
      }
    });

    it('allows request with matching X-Service-Key', async () => {
      const next = jest.fn();
      const ctx = {
        get: jest.fn((h) => (h === 'x-service-key' ? 'secret-service-key-xyz' : null)),
        state: {},
      };

      await syncRoutes.requireAdminOrServiceKey(ctx, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows request for user with admin role', async () => {
      const next = jest.fn();
      const ctx = {
        state: { user: { id: 1, role: { type: 'admin' } } },
      };

      await syncRoutes.requireAdminOrServiceKey(ctx, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows request for user with administrator role', async () => {
      const next = jest.fn();
      const ctx = {
        state: { user: { id: 2, role: { type: 'administrator' } } },
      };

      await syncRoutes.requireAdminOrServiceKey(ctx, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows request for admin auth strategy', async () => {
      const next = jest.fn();
      const ctx = {
        state: { auth: { strategy: { name: 'admin' } } },
      };

      await syncRoutes.requireAdminOrServiceKey(ctx, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects unauthenticated request without service key with 401', async () => {
      const next = jest.fn();
      const ctx = {
        state: {},
        unauthorized: jest.fn(),
      };

      await syncRoutes.requireAdminOrServiceKey(ctx, next);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.unauthorized).toHaveBeenCalledTimes(1);
    });

    it('rejects authenticated non-admin user with 403', async () => {
      const next = jest.fn();
      const ctx = {
        state: { user: { id: 10, role: { type: 'authenticated' } } },
        forbidden: jest.fn(),
      };

      await syncRoutes.requireAdminOrServiceKey(ctx, next);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.forbidden).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid service key with 403', async () => {
      const next = jest.fn();
      const ctx = {
        get: jest.fn(() => 'wrong-key'),
        forbidden: jest.fn(),
      };

      await syncRoutes.requireAdminOrServiceKey(ctx, next);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.forbidden).toHaveBeenCalledTimes(1);
    });
  });

  it('returns { data: [] } when the tables are empty and ignores pagination', async () => {
    global.strapi = {
      db: {
        query: () => ({
          findMany: async () => [],
        }),
      },
    };
    const ctx = { query: { pagination: { page: 1, pageSize: 1 } } };

    await localityController.list(ctx);

    expect(ctx.body).toEqual({ data: [] });
  });

  it('returns names and our city id without carrier ids or pagination meta', async () => {
    global.strapi = {
      db: {
        query: () => ({
          findMany: async () => [
            {
              id: 2,
              externalId: 8,
              name: 'تهران',
              cities: [
                { id: 4, documentId: 'city-rey', externalId: 101, name: 'ری' },
                { id: 3, documentId: 'city-tehran', externalId: 100, name: 'تهران' },
              ],
            },
            {
              id: 1,
              externalId: 1,
              name: 'مازندران',
              cities: [{ id: 10, documentId: 'city-ramsar', externalId: 573, name: 'رامسر' }],
            },
          ],
        }),
      },
    };
    const ctx = { query: { pagination: { page: 2, pageSize: 1 } } };

    await localityController.list(ctx);

    expect(ctx.body).toEqual({
      data: [
        {
          name: 'تهران',
          cities: [
            { documentId: 'city-tehran', name: 'تهران' },
            { documentId: 'city-rey', name: 'ری' },
          ],
        },
        { name: 'مازندران', cities: [{ documentId: 'city-ramsar', name: 'رامسر' }] },
      ],
    });
    expect(ctx.body.meta).toBeUndefined();
    expect(JSON.stringify(ctx.body)).not.toContain('externalId');
  });
});

'use strict';

const localityRoutes = require('../../../src/api/locality/routes/locality');
const localityController = require('../../../src/api/locality/controllers/locality');
const syncRoutes = require('../../../src/api/city/routes/01-sync');

describe('GET /localities route', () => {
  const previous = global.strapi;

  afterEach(() => {
    global.strapi = previous;
  });

  it('is a single public read route and does not change the sync policy', () => {
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
        config: { policies: ['global::is-authenticated-user'] },
      }),
    ]);
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

'use strict';

const integration = require('../../../src/api/integration/controllers/integration');
const integrationRoutes = require('../../../src/api/integration/routes/integration');

describe('POST localities/carrier-code', () => {
  const previous = global.strapi;

  afterEach(() => {
    global.strapi = previous;
  });

  it('is a service-only read and is not on the public catalog', () => {
    const route = integrationRoutes.routes.find((item) => item.path === '/integrations/byemoney/v1/localities/carrier-code');
    expect(route).toEqual({
      method: 'POST',
      path: '/integrations/byemoney/v1/localities/carrier-code',
      handler: 'integration.carrierCityCode',
      config: {
        auth: false,
        policies: ['global::is-service-authenticated'],
      },
    });
  });

  it('returns the carrier code for our city id and nothing else', async () => {
    global.strapi = {
      db: {
        query: () => ({
          findOne: async ({ where }) => (where.documentId === 'city-ramsar' ? { externalId: 573 } : null),
        }),
      },
    };
    const ctx = {
      request: { body: { cityDocumentId: 'city-ramsar', province: 'مازندران', city: 'رامسر' } },
      badRequest: jest.fn(),
      notFound: jest.fn(),
    };

    await integration.carrierCityCode(ctx);

    expect(ctx.body).toEqual({ carrierCityCode: 573 });
    expect(JSON.stringify(ctx.body)).not.toContain('documentId');
  });

  it('returns the carrier code for one exact legacy name pair', async () => {
    global.strapi = {
      db: {
        query: (uid) => {
          if (uid.endsWith('province')) return { findMany: async () => [{ id: 1 }] };
          return { findMany: async () => [{ externalId: 301 }] };
        },
      },
    };
    const ctx = { request: { body: { province: 'تهران', city: 'ری' } }, badRequest: jest.fn(), notFound: jest.fn() };

    await integration.carrierCityCode(ctx);

    expect(ctx.body).toEqual({ carrierCityCode: 301 });
  });

  it('rejects a missing lookup and a non-string city id', async () => {
    const missing = { request: { body: {} }, badRequest: jest.fn(), notFound: jest.fn() };
    await integration.carrierCityCode(missing);
    expect(missing.badRequest).toHaveBeenCalled();

    const numeric = { request: { body: { cityDocumentId: 10 } }, badRequest: jest.fn(), notFound: jest.fn() };
    await integration.carrierCityCode(numeric);
    expect(numeric.badRequest).toHaveBeenCalled();

    global.strapi = { db: { query: () => ({ findOne: async () => null }) } };
    const unknown = {
      request: { body: { cityDocumentId: 'missing' } },
      badRequest: jest.fn(),
      notFound: jest.fn(),
    };
    await integration.carrierCityCode(unknown);
    expect(unknown.notFound).toHaveBeenCalled();
  });
});

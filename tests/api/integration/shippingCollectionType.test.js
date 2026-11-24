'use strict';

const integration = require('../../../src/api/integration/controllers/integration');
const integrationRoutes = require('../../../src/api/integration/routes/integration');

describe('GET shipping/collection-type', () => {
  const previous = global.strapi;

  afterEach(() => {
    global.strapi = previous;
  });

  it('is a service-only read and is not on the public catalog', () => {
    const route = integrationRoutes.routes.find(
      (item) => item.path === '/integrations/byemoney/v1/shipping/collection-type',
    );
    expect(route).toEqual({
      method: 'GET',
      path: '/integrations/byemoney/v1/shipping/collection-type',
      handler: 'integration.shippingCollectionType',
      config: {
        auth: false,
        policies: ['global::is-service-authenticated'],
      },
    });
  });

  it('returns the stored collection type', async () => {
    global.strapi = {
      db: {
        query: () => ({
          findOne: async () => ({ collectionType: 'pick_up' }),
        }),
      },
    };
    const ctx = {};

    await integration.shippingCollectionType(ctx);

    expect(ctx.body).toEqual({
      collectionType: 'pick_up',
      courierCode: 'IR_POST',
      serviceType: 'EXPRESS',
    });
  });

  it('returns the approved default when the stored value is empty', async () => {
    global.strapi = {
      db: {
        query: () => ({
          findOne: async () => ({ collectionType: null, courierCode: ' ', serviceType: 'nope!' }),
        }),
      },
    };
    const ctx = {};

    await integration.shippingCollectionType(ctx);

    expect(ctx.body).toEqual({
      collectionType: 'courier_drop_off',
      courierCode: 'IR_POST',
      serviceType: 'EXPRESS',
    });
  });

  it('returns a stored courier and service', async () => {
    global.strapi = {
      db: {
        query: () => ({
          findOne: async () => ({
            collectionType: 'courier_drop_off',
            courierCode: 'CHAPAR',
            serviceType: 'PRIORITY',
          }),
        }),
      },
    };
    const ctx = {};

    await integration.shippingCollectionType(ctx);

    expect(ctx.body).toEqual({
      collectionType: 'courier_drop_off',
      courierCode: 'CHAPAR',
      serviceType: 'PRIORITY',
    });
  });
});

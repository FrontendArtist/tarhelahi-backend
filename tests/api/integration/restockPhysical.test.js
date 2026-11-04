'use strict';

const routes = require('../../../src/api/integration/routes/integration');
const integrationController = require('../../../src/api/integration/controllers/integration');
const isServiceAuthenticatedPolicy = require('../../../src/policies/is-service-authenticated');
const physicalCartService = require('../../../src/services/physicalCartService');

describe('ByeMoney Integration - restock physical cart', () => {
  const originalEnv = process.env;
  const cartId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  beforeEach(() => {
    process.env = { ...originalEnv, BYEMONEY_SERVICE_KEY: 'test-secret-key-123' };
    global.strapi = {};
  });

  afterEach(() => {
    process.env = originalEnv;
    delete global.strapi;
    jest.restoreAllMocks();
  });

  it('route is service-to-service only', () => {
    const route = routes.routes.find((item) => item.path === '/integrations/byemoney/v1/carts/:cartId/restock');
    expect(route).toMatchObject({
      method: 'POST',
      handler: 'integration.restockPhysical',
      config: { auth: false, policies: ['global::is-service-authenticated'] },
    });
  });

  it('policy rejects missing or wrong service key and accepts the configured key', () => {
    const context = (key) => ({ get: jest.fn(() => key) });
    expect(() => isServiceAuthenticatedPolicy(context(null))).toThrow('Unauthorized');
    expect(() => isServiceAuthenticatedPolicy(context('wrong-key'))).toThrow('Unauthorized');
    expect(isServiceAuthenticatedPolicy(context('test-secret-key-123'))).toBe(true);
    delete process.env.BYEMONEY_SERVICE_KEY;
    expect(() => isServiceAuthenticatedPolicy(context('test-secret-key-123'))).toThrow('Unauthorized');
  });

  it('passes path cartId over body cartId and returns the service result', async () => {
    const restock = jest.spyOn(physicalCartService, 'restock').mockResolvedValue({ success: true, restocked: true });
    const ctx = { params: { cartId }, request: { body: { cartId: 'other', operationId: 'op', items: [] } } };
    await integrationController.restockPhysical(ctx);
    expect(restock).toHaveBeenCalledWith(global.strapi, { cartId, operationId: 'op', items: [] });
    expect(ctx.body).toEqual({ success: true, restocked: true });
  });

  it('maps service errors to {code, error} with status', async () => {
    const error = Object.assign(new Error('conflict'), { status: 409, code: 'CART_CONFLICT' });
    jest.spyOn(physicalCartService, 'restock').mockRejectedValue(error);
    const ctx = { params: { cartId }, request: { body: {} } };
    await integrationController.restockPhysical(ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body).toEqual({ code: 'CART_CONFLICT', error: 'conflict' });
  });

  it('rejects invalid input with 400 CART_INVALID before touching the database', async () => {
    const ctx = { params: { cartId: 'not-a-uuid' }, request: { body: { operationId: cartId, items: [] } } };
    await integrationController.restockPhysical(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body.code).toBe('CART_INVALID');
  });
});

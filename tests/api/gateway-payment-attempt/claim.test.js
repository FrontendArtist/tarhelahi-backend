'use strict';

const controllerFactory = require('../../../src/api/gateway-payment-attempt/controllers/gateway-payment-attempt');

describe('Gateway Payment Attempt Controller - claim', () => {
  let controller;
  let mockDbQuery;
  let mockStrapi;

  beforeEach(() => {
    mockDbQuery = {
      updateMany: jest.fn(),
    };

    mockStrapi = {
      contentType: jest.fn().mockReturnValue({}),
      db: {
        query: jest.fn((uid) => {
          if (uid === 'api::gateway-payment-attempt.gateway-payment-attempt') {
            return mockDbQuery;
          }
          throw new Error(`Unexpected model: ${uid}`);
        }),
      },
    };

    controller = controllerFactory({ strapi: mockStrapi });
  });

  it('should return badRequest if resNum is missing or empty', async () => {
    const ctx = {
      request: { body: {} },
      badRequest: jest.fn(),
    };

    await controller.claim(ctx);

    expect(ctx.badRequest).toHaveBeenCalled();
    expect(mockDbQuery.updateMany).not.toHaveBeenCalled();
  });

  it('should return claimed: true when status is updated from token_issued to verifying', async () => {
    const ctx = {
      request: {
        body: { resNum: 'RES-123456' },
      },
      badRequest: jest.fn(),
    };

    mockDbQuery.updateMany.mockResolvedValueOnce({ count: 1 });

    await controller.claim(ctx);

    expect(mockDbQuery.updateMany).toHaveBeenCalledWith({
      where: { resNum: 'RES-123456', status: 'token_issued', $or: [{ recoveryLeaseUntilUtc: null }, { recoveryLeaseUntilUtc: { $lt: expect.any(String) } }] },
      data: { status: 'verifying', recoveryLeaseUntilUtc: expect.any(String) },
    });
    expect(ctx.body).toEqual({ claimed: true });
  });

  it('should return claimed: false when no record matches (e.g. already claimed)', async () => {
    const ctx = {
      request: {
        body: { resNum: 'RES-ALREADY-CLAIMED' },
      },
      badRequest: jest.fn(),
    };

    mockDbQuery.updateMany.mockResolvedValueOnce({ count: 0 });

    await controller.claim(ctx);

    expect(mockDbQuery.updateMany).toHaveBeenCalledWith({
      where: { resNum: 'RES-ALREADY-CLAIMED', status: 'token_issued', $or: [{ recoveryLeaseUntilUtc: null }, { recoveryLeaseUntilUtc: { $lt: expect.any(String) } }] },
      data: { status: 'verifying', recoveryLeaseUntilUtc: expect.any(String) },
    });
    expect(ctx.body).toEqual({ claimed: false });
  });
});

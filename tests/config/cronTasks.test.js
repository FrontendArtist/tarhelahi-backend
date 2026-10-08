'use strict';

jest.mock('../../src/services/gatewayTopUpRecovery', () => ({ recoverGatewayTopUps: jest.fn() }));
jest.mock('../../src/services/gatewayReviewRecovery', () => ({ recoverGatewayReviews: jest.fn() }));

describe('cronTasks - gateway recovery', () => {
  let cronTasks;
  let strapi;
  let recoverGatewayTopUps;
  let recoverGatewayReviews;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.BYEMONEY_API_URL;
    delete process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY;
    jest.clearAllMocks();
    ({ recoverGatewayReviews } = require('../../src/services/gatewayReviewRecovery'));
    ({ recoverGatewayTopUps } = require('../../src/services/gatewayTopUpRecovery'));
    recoverGatewayReviews.mockResolvedValue({});
    recoverGatewayTopUps.mockResolvedValue({});
    strapi = { log: { warn: jest.fn(), error: jest.fn() } };
    cronTasks = require('../../config/cron-tasks');
  });

  afterEach(() => { process.env = originalEnv; });

  it('always scans and delivers review cases even when ByeMoney delivery is not configured', async () => {
    await cronTasks.retryGatewayTopUps.task({ strapi });

    expect(recoverGatewayReviews).toHaveBeenCalledWith(strapi);
    expect(recoverGatewayTopUps).not.toHaveBeenCalled();
  });

  it('runs bank recovery only when both ByeMoney URL and service key are configured', async () => {
    process.env.BYEMONEY_API_URL = 'https://money.example';
    process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY = 'x'.repeat(40);

    await cronTasks.retryGatewayTopUps.task({ strapi });

    expect(recoverGatewayReviews).toHaveBeenCalledWith(strapi);
    expect(recoverGatewayTopUps).toHaveBeenCalledWith(strapi);
  });

  it('logs recovery failures without exposing service key material', async () => {
    process.env.BYEMONEY_API_URL = 'https://money.example';
    process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY = 'sensitive-key';
    recoverGatewayReviews.mockRejectedValueOnce(new Error('temporary failure'));

    await cronTasks.retryGatewayTopUps.task({ strapi });

    expect(strapi.log.error).toHaveBeenCalledWith('Gateway payment recovery failed: temporary failure');
    expect(strapi.log.error.mock.calls.flat().join(' ')).not.toContain('sensitive-key');
  });

  it('prevents overlapping scheduler executions', async () => {
    let finish;
    recoverGatewayReviews.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = cronTasks.retryGatewayTopUps.task({ strapi });
    await cronTasks.retryGatewayTopUps.task({ strapi });
    expect(strapi.log.warn).toHaveBeenCalledWith(expect.stringContaining('already running'));
    finish({});
    await first;
  });
});

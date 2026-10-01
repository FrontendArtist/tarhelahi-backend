'use strict';

describe('cronTasks - retryGatewayTopUps', () => {
  let cronTasks;
  let mockStrapi;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };

    mockStrapi = {
      log: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
      },
    };

    global.fetch = jest.fn();
    cronTasks = require('../../config/cron-tasks');
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('should skip and warn when NEXT_FRONTEND_URL or BYEMONEY_SERVICE_KEY is missing', async () => {
    delete process.env.NEXT_FRONTEND_URL;
    delete process.env.BYEMONEY_SERVICE_KEY;

    await cronTasks.retryGatewayTopUps.task({ strapi: mockStrapi });

    expect(mockStrapi.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('NEXT_FRONTEND_URL or BYEMONEY_SERVICE_KEY is not configured')
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should call NEXT_FRONTEND_URL endpoint with X-Service-Key', async () => {
    process.env.NEXT_FRONTEND_URL = 'https://frontend.example.com/';
    process.env.BYEMONEY_SERVICE_KEY = 'secret-service-key-123';

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    await cronTasks.retryGatewayTopUps.task({ strapi: mockStrapi });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://frontend.example.com/api/payment/retry-topups',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-Service-Key': 'secret-service-key-123' },
      })
    );
    expect(mockStrapi.log.error).not.toHaveBeenCalled();
  });

  it('should log error when endpoint returns non-ok status', async () => {
    process.env.NEXT_FRONTEND_URL = 'https://frontend.example.com';
    process.env.BYEMONEY_SERVICE_KEY = 'secret-service-key-123';

    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('Internal Server Error'),
    });

    await cronTasks.retryGatewayTopUps.task({ strapi: mockStrapi });

    expect(mockStrapi.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Gateway TopUp retry returned 500: Internal Server Error')
    );
  });

  it('should prevent overlapping executions while a task is running', async () => {
    process.env.NEXT_FRONTEND_URL = 'https://frontend.example.com';
    process.env.BYEMONEY_SERVICE_KEY = 'secret-service-key-123';

    let finishFirstFetch;
    const slowFetchPromise = new Promise((resolve) => {
      finishFirstFetch = resolve;
    });

    global.fetch.mockReturnValueOnce(slowFetchPromise);

    // Start first run
    const run1 = cronTasks.retryGatewayTopUps.task({ strapi: mockStrapi });

    // Immediate second run while first is in-flight
    await cronTasks.retryGatewayTopUps.task({ strapi: mockStrapi });

    expect(mockStrapi.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('already running')
    );

    // Complete first fetch
    finishFirstFetch({ ok: true, status: 200 });
    await run1;
  });
});

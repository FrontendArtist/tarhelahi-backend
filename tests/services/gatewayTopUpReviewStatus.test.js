'use strict';

const { recoverGatewayTopUps } = require('../../src/services/gatewayTopUpRecovery');

describe('حفاظت از درخواست‌های تعیین تکلیف شده در بازیابی برگشت وجه', () => {
  const originalFetch = global.fetch;
  const originalBase = process.env.BYEMONEY_API_URL;
  const originalKey = process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY;
  const originalTerminal = process.env.SEP_TERMINAL_ID;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.BYEMONEY_API_URL;
    else process.env.BYEMONEY_API_URL = originalBase;
    if (originalKey === undefined) delete process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY;
    else process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY = originalKey;
    if (originalTerminal === undefined) delete process.env.SEP_TERMINAL_ID;
    else process.env.SEP_TERMINAL_ID = originalTerminal;
  });

  test.each([
    ['ManuallyRefunded', 'REVIEW_MANUAL_REFUND_NOT_SUPPORTED'],
    ['Unresolved', 'TOPUP_REQUIRES_REVIEW'],
  ])('%s نباید برگشت بانکی جدید ایجاد کند', async (status, code) => {
    process.env.BYEMONEY_API_URL = 'http://byemoney.test';
    process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY = 'test-key'.repeat(5);
    process.env.SEP_TERMINAL_ID = 'terminal';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) });
    const attempt = { resNum: 'TR-TEST', status: 'reverse_required', refNum: 'ref',
      updatedAt: new Date(Date.now() - 120000).toISOString(),
      reverseRetryUntilUtc: new Date(Date.now() + 60000).toISOString() };
    const attempts = { findMany: jest.fn().mockResolvedValue([attempt]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() };
    const events = { findMany: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(where.stage === 'verify' ? [{ rawPayload: { Success: true, ResultCode: 0 } }] : [])),
      findOne: jest.fn().mockResolvedValue(null), create: jest.fn() };
    const strapi = { db: { query: jest.fn(uid => uid.includes('gateway-payment-attempt') ? attempts : events) },
      log: { error: jest.fn() } };

    await recoverGatewayTopUps(strapi);

    expect(strapi.log.error).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(attempts.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'financial_review', lastError: code },
    }));
    expect(events.create).not.toHaveBeenCalled();
  });
});

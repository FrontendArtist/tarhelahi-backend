'use strict';
const { recoverGatewayTopUps } = require('../../src/services/gatewayTopUpRecovery');

describe('پیگیری پرداخت با زمان مستقل از قفل', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-07T00:00:00Z'));
    process.env.BYEMONEY_API_URL = 'http://audit.invalid';
    process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY = 'x'.repeat(32);
    process.env.SEP_TERMINAL_ID = 'terminal';
  });
  afterEach(() => { jest.useRealTimers(); process.env = savedEnv; });

  test('اجرای هر دقیقه، بازیابی دو دقیقه‌ای را عقب نمی‌اندازد', async () => {
    let row = { resNum: 'TR-TEST', status: 'verifying', refNum: 'ref',
      lastAttemptAtUtc: null, updatedAt: new Date().toISOString() };
    const attempts = {
      findMany: jest.fn(async () => [{ ...row }]),
      updateMany: jest.fn(async ({ data }) => {
        row = { ...row, ...data, updatedAt: new Date().toISOString() }; return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => {
        row = { ...row, ...data, updatedAt: new Date().toISOString() }; return row;
      }),
    };
    const prior = { kind: 'Verified', occurredAtUtc: new Date().toISOString(), bankReferenceNumber: 'rrn',
      originalAmountRial: 1000, affectiveAmountRial: 1000 };
    const events = { findMany: jest.fn(async () => []), findOne: jest.fn(async () => prior) };
    const strapi = { db: { query: uid => uid.includes('gateway-payment-attempt') ? attempts : events },
      log: { error: jest.fn() } };

    jest.advanceTimersByTime(60_000);
    await recoverGatewayTopUps(strapi);
    expect(attempts.updateMany).not.toHaveBeenCalled();
    expect(attempts.update).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    await recoverGatewayTopUps(strapi);
    expect(row.status).toBe('verified');
    expect(row.lastAttemptAtUtc).toBe('2026-10-07T00:02:00.000Z');
    expect(strapi.log.error).not.toHaveBeenCalled();
  });

  test('تازه‌شدن زمان رکورد، موعد تلاش بانکی قبلی را تغییر نمی‌دهد', async () => {
    const row = { resNum: 'TR-OLD', status: 'verifying', refNum: 'ref',
      lastAttemptAtUtc: new Date(Date.now() - 180_000).toISOString(), updatedAt: new Date().toISOString() };
    const attempts = { findMany: async () => [row], updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn() };
    const events = { findMany: async () => [], findOne: async () => ({ occurredAtUtc: new Date().toISOString() }) };
    const strapi = { db: { query: uid => uid.includes('gateway-payment-attempt') ? attempts : events }, log: { error: jest.fn() } };
    await recoverGatewayTopUps(strapi);
    expect(attempts.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'verified' }) }));
  });
});

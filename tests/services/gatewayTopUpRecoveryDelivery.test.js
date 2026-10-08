'use strict';

jest.mock('../../src/services/gatewayReviewCases', () => ({
  appendEvidence: jest.fn(),
  getOrCreateCase: jest.fn(async () => ({ reviewCase: { caseId: 'review-test' } })),
}));
const { recoverGatewayTopUps } = require('../../src/services/gatewayTopUpRecovery');

test('قطع پاسخ Verify، تلاش مجدد و تحویل نتیجه بدون استعلام موفق تکراری', async () => {
  const originalFetch = global.fetch;
  const savedEnv = { ...process.env };
  jest.useFakeTimers().setSystemTime(new Date('2026-10-07T00:00:00Z'));
  process.env.BYEMONEY_API_URL = 'http://byemoney.test';
  process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY = 'x'.repeat(32);
  process.env.SEP_TERMINAL_ID = '123';
  let row = { resNum: 'TR-DELIVERY', status: 'verifying', refNum: 'ref', topUpRequestId: 'topup',
    lastAttemptAtUtc: null, updatedAt: new Date().toISOString(), tokenIssuedAtUtc: new Date().toISOString() };
  const stored = [{ eventId: 'callback', stage: 'callback', kind: 'Unknown', deliveryStatus: 'delivered',
    bankTransactionId: 'ref', rawPayload: { State: 'OK', Status: 2 } }];
  const attempts = {
    findMany: async () => ['verifying'].includes(row.status) ? [{ ...row }] : [],
    findOne: async () => row,
    update: async ({ data }) => (row = { ...row, ...data, updatedAt: new Date().toISOString() }),
    updateMany: async ({ data }) => { row = { ...row, ...data }; return { count: 1 }; },
  };
  const events = {
    findMany: async ({ where }) => stored.filter(event =>
      (!where.deliveryStatus || event.deliveryStatus === where.deliveryStatus) &&
      (!where.stage || event.stage === where.stage)),
    findOne: async ({ where }) => stored.find(event =>
      (!where.stage || event.stage === where.stage) && (!where.kind || event.kind === where.kind)),
    create: async ({ data }) => { stored.push(data); return data; },
    update: async ({ where, data }) => Object.assign(stored.find(event => event.eventId === where.eventId), data),
  };
  const history = { findOne: async () => null, create: async () => ({}) };
  const strapi = { db: { query: uid => uid.includes('gateway-payment-attempt') ? attempts :
    uid.includes('gateway-payment-event') ? events : history }, log: { error: jest.fn() } };
  let bankCalls = 0;
  const deliveries = [];
  global.fetch = jest.fn(async (url, options) => {
    if (url.includes('VerifyTransaction')) {
      bankCalls++;
      if (bankCalls === 1) throw new Error('simulated disconnect');
      return { ok: true, json: async () => ({ Success: true, ResultCode: 0,
        TransactionDetail: { RefNum: 'ref', RRN: 'rrn', TerminalNumber: 123,
          OrginalAmount: 1000, AffectiveAmount: 1000 } }) };
    }
    deliveries.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    jest.advanceTimersByTime(60_000);
    await recoverGatewayTopUps(strapi);
    expect(bankCalls).toBe(0);
    jest.advanceTimersByTime(60_000);
    await recoverGatewayTopUps(strapi);
    expect(row.status).toBe('verifying');
    expect(deliveries.map(event => event.kind)).toEqual(['Unknown']);
    jest.advanceTimersByTime(60_000);
    await recoverGatewayTopUps(strapi);
    expect(bankCalls).toBe(1);
    jest.advanceTimersByTime(60_000);
    await recoverGatewayTopUps(strapi);
    expect(row.status).toBe('confirmed');
    expect(deliveries.map(event => event.kind)).toEqual(['Unknown', 'Verified']);
    expect(deliveries[1]).toMatchObject({ originalAmountRial: 1000, affectiveAmountRial: 1000, bankTransactionId: 'ref' });
    jest.advanceTimersByTime(120_000);
    await recoverGatewayTopUps(strapi);
    expect(bankCalls).toBe(2);
    expect(deliveries).toHaveLength(2);
    expect(stored.filter(event => event.kind === 'Verified')).toHaveLength(1);
    expect(strapi.log.error).not.toHaveBeenCalled();
  } finally {
    global.fetch = originalFetch;
    process.env = savedEnv;
    jest.useRealTimers();
  }
});

'use strict';

jest.mock('../../src/services/gatewayReviewCases', () => ({
  ATTEMPT: 'ATTEMPT', CASE: 'CASE',
  getOrCreateCase: jest.fn(), openRequest: jest.fn(row => ({
    clientReferenceCode: row.clientReferenceCode, caseId: row.caseId, reasonCode: row.reasonCode,
  })),
}));

const reviewCases = require('../../src/services/gatewayReviewCases');
const recovery = require('../../src/services/gatewayReviewRecovery');

describe('gatewayReviewRecovery', () => {
  let strapi;
  let attemptQuery;
  let caseQuery;
  let historyQuery;
  let values;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    values = new Map();
    attemptQuery = { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), count: jest.fn() };
    caseQuery = { findMany: jest.fn(), update: jest.fn() };
    historyQuery = { create: jest.fn().mockResolvedValue({}) };
    strapi = {
      store: jest.fn(() => ({
        get: jest.fn(async ({ key }) => values.get(key)),
        set: jest.fn(async ({ key, value }) => values.set(key, value)),
      })),
      db: { query: jest.fn(uid => uid === 'ATTEMPT' ? attemptQuery : uid.includes('history') ? historyQuery : caseQuery) },
    };
    process.env.BYEMONEY_API_URL = 'https://money.example';
    process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY = 'x'.repeat(40);
    global.fetch = jest.fn();
  });

  afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); });

  it('sets the persistent default to 30 minutes and reruns without duplicate case creation or status changes', async () => {
    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    const attempt = { id: 7, resNum: 'TR-00000001', topUpRequestId: 'topup-1', tokenIssuedAtUtc: old };
    attemptQuery.findMany.mockResolvedValue([attempt]);
    attemptQuery.updateMany.mockResolvedValue({ count: 1 });
    attemptQuery.update.mockResolvedValue({});
    reviewCases.getOrCreateCase.mockResolvedValue({ reviewCase: { caseId: 'case-one' }, created: false });

    const first = await recovery.scanNoCallbackAttempts(strapi);
    const second = await recovery.scanNoCallbackAttempts(strapi);

    expect(first.thresholdMinutes).toBe(30);
    expect(second.opened).toBe(0);
    expect(reviewCases.getOrCreateCase).toHaveBeenCalledTimes(2);
    expect(reviewCases.getOrCreateCase).toHaveBeenCalledWith(strapi, attempt, 'NO_CALLBACK', {
      thresholdMinutes: 30, timestampSource: 'tokenIssuedAtUtc',
    });
    expect(attemptQuery.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { reviewScanLeaseUntilUtc: null } });
    expect(attemptQuery.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: expect.anything() } }));
  });

  it('uses createdAt for an old attempt with no token timestamp and reports the fallback count', async () => {
    const attempt = { id: 8, resNum: 'TR-00000008', topUpRequestId: 'topup-8',
      tokenIssuedAtUtc: null, createdAt: new Date(Date.now() - 31 * 60_000).toISOString() };
    attemptQuery.findMany.mockResolvedValue([attempt]);
    attemptQuery.updateMany.mockResolvedValue({ count: 1 });
    attemptQuery.update.mockResolvedValue({});
    reviewCases.getOrCreateCase.mockResolvedValue({ created: true, reviewCase: { caseId: 'case-8' } });
    strapi.log = { warn: jest.fn() };

    const result = await recovery.scanNoCallbackAttempts(strapi);

    expect(result).toEqual({ examined: 1, opened: 1, fallbackCount: 1, thresholdMinutes: 30 });
    expect(attemptQuery.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      $or: [{ tokenIssuedAtUtc: { $lte: expect.any(String) } },
        { tokenIssuedAtUtc: null, createdAt: { $lte: expect.any(String) } }],
    }) }));
    expect(reviewCases.getOrCreateCase).toHaveBeenCalledWith(strapi, attempt, 'NO_CALLBACK', {
      thresholdMinutes: 30, timestampSource: 'createdAt',
    });
    expect(strapi.log.warn).toHaveBeenCalledWith(expect.stringContaining('1 attempts'));
  });

  it('continues past the first scan batch so old null-timestamp attempts are not starved', async () => {
    const firstBatch = Array.from({ length: 200 }, (_, index) => ({ id: index + 1,
      tokenIssuedAtUtc: new Date(Date.now() - 40 * 60_000).toISOString() }));
    const fallback = { id: 201, tokenIssuedAtUtc: null,
      createdAt: new Date(Date.now() - 40 * 60_000).toISOString() };
    attemptQuery.findMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce([fallback]);
    attemptQuery.updateMany.mockResolvedValue({ count: 0 });
    strapi.log = { warn: jest.fn() };

    const result = await recovery.scanNoCallbackAttempts(strapi);

    expect(result.examined).toBe(201);
    expect(result.fallbackCount).toBe(1);
    expect(attemptQuery.findMany).toHaveBeenCalledTimes(2);
  });

  it('releases an attempt to the same pending delivery queue after a network failure and retries it', async () => {
    const pending = { caseId: 'case-1', clientReferenceCode: 'TR-00000001', reasonCode: 'NO_CALLBACK' };
    caseQuery.findMany.mockResolvedValue([pending]);
    caseQuery.update.mockResolvedValue({});
    global.fetch.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ topUpStatus: 'Confirmed' }),
    });

    const first = await recovery.sendPendingReviewOpens(strapi);
    const second = await recovery.sendPendingReviewOpens(strapi);

    expect(first.sent).toBe(0);
    expect(second.sent).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][1].headers['X-Service-Key']).toBe('x'.repeat(40));
    expect(caseQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notificationStatus: 'delivered', topUpStatusAtOpen: 'Confirmed' }),
    }));
  });

  it('records a ByeMoney caseId conflict as recoverable attention, without treating it as delivered', async () => {
    caseQuery.findMany.mockResolvedValue([{ caseId: 'case-1', clientReferenceCode: 'TR-00000001', reasonCode: 'NO_CALLBACK' }]);
    caseQuery.update.mockResolvedValue({});
    global.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'REVIEW_CASE_CONFLICT' }) });

    await recovery.sendPendingReviewOpens(strapi);

    expect(caseQuery.update).toHaveBeenCalledWith(expect.objectContaining({ data: {
      notificationStatus: 'conflict', notificationError: 'REVIEW_CASE_CONFLICT',
    } }));
  });

  it('reports abandoned statuses read-only and includes the current in-progress states', async () => {
    attemptQuery.count.mockResolvedValue(3);
    const report = await recovery.backfillLegacyCases(strapi);
    expect(report).toEqual({ mode: 'report_only', counts: expect.objectContaining({
      created: 3, verifying: 3, verified: 3, financial_review: 3, reverse_required: 3, pending_sync: 3,
      token_issued_created_at_fallback: 3,
    }) });
    expect(reviewCases.getOrCreateCase).not.toHaveBeenCalled();
  });

  it('creates cases for the reported abandoned states only in the explicit apply pass', async () => {
    attemptQuery.count.mockResolvedValue(1);
    attemptQuery.findMany.mockImplementation(async ({ where, offset }) => offset ? [] : [{
      id: 9, resNum: `TR-${where.status}`, topUpRequestId: 'legacy-topup', status: where.status,
    }]);
    reviewCases.getOrCreateCase.mockResolvedValue({ created: true, reviewCase: { caseId: 'legacy' } });

    const result = await recovery.backfillLegacyCases(strapi, { apply: true });

    expect(result.mode).toBe('apply');
    expect(reviewCases.getOrCreateCase).toHaveBeenCalledWith(strapi,
      expect.objectContaining({ status: 'token_issued' }), 'NO_CALLBACK', { legacyStatus: 'token_issued' });
    expect(reviewCases.getOrCreateCase).toHaveBeenCalledWith(strapi,
      expect.objectContaining({ status: 'reverse_required' }), 'REVERSE_UNKNOWN', { legacyStatus: 'reverse_required' });
    expect(attemptQuery.update).not.toHaveBeenCalled();
  });
});

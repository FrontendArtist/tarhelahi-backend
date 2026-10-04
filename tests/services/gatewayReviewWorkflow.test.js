'use strict';
const { randomUUID } = require('node:crypto');
const { CASE, HISTORY, OPERATION, normalizeResolution, resolveReview, syncReview } = require('../../src/services/gatewayReviewWorkflow');
const ATTEMPT = 'api::gateway-payment-attempt.gateway-payment-attempt';

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === '$or') return value.some(item => matches(row, item));
    if (value && typeof value === 'object') return Object.entries(value).every(([op, target]) =>
      op === '$lt' ? row[key] < target : op === '$in' ? target.includes(row[key]) : op === '$notIn' ? !target.includes(row[key]) : op === '$notNull' ? row[key] != null : false);
    return value == null ? row[key] == null : row[key] === value;
  });
}

function database() {
  const rows = {
    [CASE]: [{ id: 1, caseId: 'case-1', clientReferenceCode: 'TR-1', reasonCode: 'NO_CALLBACK', status: 'open',
      revision: 1, notificationStatus: 'delivered', resolutionOperationId: null, resolvedAtUtc: null }],
    [HISTORY]: [], [OPERATION]: [], [ATTEMPT]: [{ id: 1, resNum: 'TR-1', recoveryLeaseUntilUtc: null }],
  };
  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  return { rows, db: { query: uid => ({
    findOne: async ({ where }) => clone(rows[uid].find(x => matches(x, where)) || null),
    findMany: async ({ where, limit }) => clone(rows[uid].filter(x => matches(x, where)).slice(0, limit || 1000)),
    count: async ({ where }) => rows[uid].filter(x => matches(x, where)).length,
    create: async ({ data }) => {
      if (data.operationId && rows[uid].some(x => x.operationId === data.operationId)) throw new Error('unique');
      const row = { id: rows[uid].length + 1, ...clone(data) }; rows[uid].push(row); return clone(row);
    },
    update: async ({ where, data }) => { const row = rows[uid].find(x => matches(x, where)); Object.assign(row, clone(data)); return clone(row); },
    updateMany: async ({ where, data }) => { const selected = rows[uid].filter(x => matches(x, where)); selected.forEach(x => Object.assign(x, clone(data))); return { count: selected.length }; },
  }) } };
}

const payload = () => ({ outcomeCode: 'NO_MATCHING_DEPOSIT', resolutionFinancialReferenceId: null, evidence: {
  operationId: randomUUID(), expectedRevision: 1, checkedReportDate: '2026-09-30', matchingDepositFound: false,
  note: 'بررسی گزارش بانک', depositReference: null, depositDate: null, depositAmountRial: null, manualRefundReference: null,
} });

describe('manual gateway review workflow', () => {
  let strapi, state, requests;
  beforeEach(() => {
    process.env.BYEMONEY_API_URL = 'http://financial.test';
    process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY = 's'.repeat(32);
    strapi = database(); requests = [];
    state = { caseId: 'case-1', clientReferenceCode: 'TR-1', topUpStatus: 'Pending', revision: 1,
      resolvedAtUtc: null, outcomeCode: null, audit: [] };
    global.fetch = jest.fn(async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/resolve')) {
        const request = JSON.parse(options.body);
        if (state.resolvedAtUtc || request.evidence.expectedRevision !== state.revision)
          return { ok: false, status: 409, json: async () => ({ code: 'REVIEW_CASE_CONFLICT' }) };
        state.resolvedAtUtc = '2026-10-04T10:00:00Z'; state.outcomeCode = request.outcomeCode;
        state.audit.push({ eventId: request.evidence.operationId, eventType: 'resolved', evidence: request.evidence });
      }
      if (url.endsWith('/reopen')) { state.revision++; state.resolvedAtUtc = null; state.outcomeCode = null; }
      return { ok: true, status: 200, json: async () => structuredClone(state) };
    });
  });
  afterEach(() => { delete global.fetch; });

  test('stores checked report and uses actor JWT; never submits a made-up bank result', async () => {
    const request = payload();
    const result = await resolveReview(strapi, strapi.rows[CASE][0], request, 'actor-jwt', 'actor-doc');
    expect(result.status).toBe('resolved');
    expect(strapi.rows[OPERATION][0]).toMatchObject({ status: 'applied', actorDocumentId: 'actor-doc', payload: request });
    expect(requests.find(x => x.url.endsWith('/resolve')).options.headers.Authorization).toBe('Bearer actor-jwt');
    expect(requests.some(x => x.url.endsWith('/gateway-results'))).toBe(false);
    expect(strapi.rows[ATTEMPT][0].recoveryLeaseUntilUtc).toBeNull();
  });

  test('double submission returns same result; changed actor or note conflicts', async () => {
    const request = payload();
    await resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor');
    await resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor');
    expect(requests.filter(x => x.url.endsWith('/resolve'))).toHaveLength(1);
    await expect(resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'other')).rejects.toMatchObject({ status: 409 });
    await expect(resolveReview(strapi, strapi.rows[CASE][0], { ...request, evidence: { ...request.evidence, note: 'تغییر' } }, 'jwt', 'actor')).rejects.toMatchObject({ status: 409 });
  });

  test('timeout after financial acceptance recovers without sending a second resolution', async () => {
    const original = global.fetch;
    global.fetch = jest.fn(async (url, options) => { const result = await original(url, options); if (url.endsWith('/resolve')) throw new Error('timeout'); return result; });
    const request = payload();
    await expect(resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor')).rejects.toMatchObject({ status: 503 });
    expect(strapi.rows[OPERATION][0].status).toBe('pending');
    const result = await syncReview(strapi, strapi.rows[CASE][0]);
    expect(result.status).toBe('resolved');
    expect(strapi.rows[OPERATION][0].status).toBe('applied');
    expect(requests.filter(x => x.url.endsWith('/resolve'))).toHaveLength(1);
  });

  test('new evidence reopens both sides and invalidates an old form', async () => {
    await resolveReview(strapi, strapi.rows[CASE][0], payload(), 'jwt', 'actor');
    strapi.rows[HISTORY].push({ id: 1, caseId: 'case-1', eventId: randomUUID(), syncStatus: 'pending' });
    const result = await syncReview(strapi, strapi.rows[CASE][0]);
    expect(result).toMatchObject({ status: 'open', revision: 2, resolvedAtUtc: null });
    expect(state.audit).toHaveLength(1);
    await expect(resolveReview(strapi, result, payload(), 'jwt', 'actor')).rejects.toMatchObject({ status: 409 });
  });

  test('retrying directly after a lost response recognizes the accepted audit before checking closed status', async () => {
    const original = global.fetch;
    let loseResponse = true;
    global.fetch = jest.fn(async (url, options) => {
      const result = await original(url, options);
      if (url.endsWith('/resolve') && loseResponse) { loseResponse = false; throw new Error('timeout'); }
      return result;
    });
    const request = payload();
    await expect(resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor')).rejects.toMatchObject({ status: 503 });
    const retried = await resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor');
    expect(retried.status).toBe('resolved');
    expect(strapi.rows[OPERATION][0].status).toBe('applied');
    expect(requests.filter(x => x.url.endsWith('/resolve'))).toHaveLength(1);
  });

  test('two staff cannot resolve different decisions concurrently', async () => {
    const results = await Promise.allSettled([
      resolveReview(strapi, structuredClone(strapi.rows[CASE][0]), payload(), 'jwt1', 'staff1'),
      resolveReview(strapi, structuredClone(strapi.rows[CASE][0]), payload(), 'jwt2', 'staff2'),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(state.audit).toHaveLength(1);
  });

  test('manual refund is allowed in payload only with its own reference', () => {
    const request = payload(); request.outcomeCode = 'MANUAL_REFUND';
    expect(() => normalizeResolution(request)).toThrow();
    request.evidence.manualRefundReference = 'refund-bank-id';
    expect(normalizeResolution(request).evidence.manualRefundReference).toBe('refund-bank-id');
  });

  test('active bank callback lease prevents manual closure and can be retried when released', async () => {
    strapi.rows[ATTEMPT][0].recoveryLeaseUntilUtc = new Date(Date.now() + 60000).toISOString();
    const request = payload();
    await expect(resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor'))
      .rejects.toMatchObject({ code: 'REVIEW_RESOLUTION_IN_PROGRESS' });
    expect(state.audit).toHaveLength(0);
    strapi.rows[ATTEMPT][0].recoveryLeaseUntilUtc = null;
    expect((await resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor')).status).toBe('resolved');
  });

  test('new evidence rejects a stale pending request and releases its case claim', async () => {
    strapi.rows[ATTEMPT][0].recoveryLeaseUntilUtc = new Date(Date.now() + 60000).toISOString();
    const request = payload();
    await expect(resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor')).rejects.toMatchObject({ status: 409 });
    strapi.rows[ATTEMPT][0].recoveryLeaseUntilUtc = null;
    strapi.rows[HISTORY].push({ id: 1, caseId: 'case-1', eventId: randomUUID(), syncStatus: 'pending' });
    await expect(resolveReview(strapi, strapi.rows[CASE][0], request, 'jwt', 'actor')).rejects.toMatchObject({ status: 409 });
    expect(strapi.rows[CASE][0].resolutionOperationId).toBeNull();
    expect(strapi.rows[OPERATION][0].status).toBe('rejected');
  });

  test.each([null, {}, { matchingDepositFound: false }, { checkedReportDate: '2026-02-30', matchingDepositFound: false }])('incomplete report cannot close: %p', evidence => {
    expect(() => normalizeResolution({ ...payload(), evidence })).toThrow();
  });
});

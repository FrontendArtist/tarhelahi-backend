'use strict';

const { getOrCreateCase } = require('../../src/services/gatewayReviewCases');

describe('gatewayReviewCases', () => {
  const attempt = { resNum: 'TR-00000001', topUpRequestId: 'topup-1' };
  const existing = { caseId: 'case-stable', clientReferenceCode: attempt.resNum,
    topUpRequestId: attempt.topUpRequestId, reasonCode: 'NO_CALLBACK' };

  it('returns the existing case on rerun without creating another history entry', async () => {
    const caseQuery = { findOne: jest.fn().mockResolvedValue(existing), create: jest.fn() };
    const historyQuery = { findOne: jest.fn().mockResolvedValue({ eventType: 'opened' }), create: jest.fn() };
    const eventQuery = { findMany: jest.fn().mockResolvedValue([]) };
    const strapi = { db: { query: jest.fn(uid => uid.includes('gateway-review-case-history') ? historyQuery :
      uid.includes('gateway-payment-event') ? eventQuery : caseQuery) } };

    const result = await getOrCreateCase(strapi, attempt, 'NO_CALLBACK');

    expect(result).toEqual({ reviewCase: existing, created: false });
    expect(caseQuery.create).not.toHaveBeenCalled();
    expect(historyQuery.create).not.toHaveBeenCalled();
  });

  it('converges on the already-created case when a concurrent insert hits the unique constraint', async () => {
    const caseQuery = { findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
      create: jest.fn().mockRejectedValue(new Error('unique constraint')) };
    const historyQuery = { findOne: jest.fn().mockResolvedValue({ eventType: 'opened' }), create: jest.fn() };
    const eventQuery = { findMany: jest.fn().mockResolvedValue([]) };
    const strapi = { db: { query: jest.fn(uid => uid.includes('gateway-review-case-history') ? historyQuery :
      uid.includes('gateway-payment-event') ? eventQuery : caseQuery) } };

    const result = await getOrCreateCase(strapi, attempt, 'NO_CALLBACK');

    expect(result).toEqual({ reviewCase: existing, created: false });
    expect(caseQuery.create).toHaveBeenCalledTimes(1);
    expect(caseQuery.findOne).toHaveBeenCalledTimes(2);
  });
});

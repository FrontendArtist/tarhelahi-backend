'use strict';

jest.mock('@strapi/strapi', () => ({ factories: { createCoreController: (_uid, factory) => factory } }));
jest.mock('../../../src/services/gatewayReviewCases', () => ({
  getOrCreateCase: jest.fn(), appendEvidence: jest.fn(), addHistory: jest.fn(),
}));

const controllerFactory = require('../../../src/api/gateway-payment-attempt/controllers/gateway-payment-attempt');
const reviewCases = require('../../../src/services/gatewayReviewCases');

describe('gateway outcomes after a review case has opened', () => {
  it('accepts a late callback and attaches it to the existing case without changing financial status', async () => {
    const attempt = { resNum: 'TR-00000001', topUpRequestId: 'topup-1', amountRial: 50000, status: 'token_issued' };
    const createdEvent = { eventId: 'evt-late', resNum: attempt.resNum, stage: 'callback', kind: 'Unknown',
      bankTransactionId: 'SEP-REF', bankReferenceNumber: 'RRN', occurredAtUtc: new Date().toISOString() };
    const attemptQuery = { findOne: jest.fn().mockResolvedValue(attempt), update: jest.fn() };
    const eventQuery = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(createdEvent) };
    const strapi = { db: { query: jest.fn(uid => uid.includes('gateway-payment-event') ? eventQuery : attemptQuery) } };
    const controller = controllerFactory({ strapi });
    const ctx = { request: { body: {
      resNum: attempt.resNum, eventId: 'evt-late', stage: 'callback', kind: 'Unknown',
      bankTransactionId: 'SEP-REF', bankReferenceNumber: 'RRN', rawPayload: { State: 'OK', Status: 2 },
    } } };

    await controller.recordOutcome(ctx);

    expect(ctx.status).toBeUndefined();
    expect(ctx.body.eventId).toBe('evt-late');
    expect(reviewCases.appendEvidence).toHaveBeenCalledWith(strapi, attempt, createdEvent);
    expect(attemptQuery.update).not.toHaveBeenCalled();
  });

  it('opens a Verify unknown case and records evidence for the same attempt', async () => {
    const attempt = { resNum: 'TR-00000002', topUpRequestId: 'topup-2', amountRial: 50000 };
    const event = { eventId: 'evt-verify', resNum: attempt.resNum, stage: 'verify', kind: 'Unknown',
      occurredAtUtc: new Date().toISOString() };
    const eventQuery = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(event) };
    const strapi = { db: { query: jest.fn(uid => uid.includes('gateway-payment-event') ? eventQuery : {
      findOne: jest.fn().mockResolvedValue(attempt),
    }) } };
    const controller = controllerFactory({ strapi });
    const ctx = { request: { body: { resNum: attempt.resNum, eventId: event.eventId, stage: 'verify', kind: 'Unknown' } } };

    await controller.recordOutcome(ctx);

    expect(reviewCases.getOrCreateCase).toHaveBeenCalledWith(strapi, attempt, 'VERIFY_UNKNOWN', {
      eventId: 'evt-verify', stage: 'verify', kind: 'Unknown',
    });
    expect(reviewCases.appendEvidence).toHaveBeenCalledWith(strapi, attempt, event);
  });
});

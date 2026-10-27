'use strict';

jest.mock('@strapi/strapi', () => ({ factories: { createCoreController: (_uid, factory) => factory } }));
jest.mock('../../../src/services/gatewayReviewCases', () => ({
  getOrCreateCase: jest.fn(), appendEvidence: jest.fn(), addHistory: jest.fn(),
}));
jest.mock('../../../src/services/gatewayReviewRecovery', () => ({
  sendPendingReviewOpens: jest.fn().mockResolvedValue({ sent: 1, pending: 0 }),
}));

const controllerFactory = require('../../../src/api/gateway-payment-attempt/controllers/gateway-payment-attempt');
const reviewCases = require('../../../src/services/gatewayReviewCases');
const recovery = require('../../../src/services/gatewayReviewRecovery');

describe('gateway outcomes after a review case has opened', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    expect(recovery.sendPendingReviewOpens).not.toHaveBeenCalled();
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
    expect(recovery.sendPendingReviewOpens).toHaveBeenCalledWith(strapi);
  });

  it('ثبت نتیجه تأیید ۲- بلافاصله پرونده را ساخته و فوراً به بایمانی ارسال می‌کند', async () => {
    const attempt = { resNum: 'TR-00000003', topUpRequestId: 'topup-3', amountRial: 50000 };
    const event = { eventId: 'evt-verify-neg2', resNum: attempt.resNum, stage: 'verify', kind: 'Unknown',
      bankResultCode: '-2', occurredAtUtc: new Date().toISOString() };
    const eventQuery = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(event) };
    const strapi = { db: { query: jest.fn(uid => uid.includes('gateway-payment-event') ? eventQuery : {
      findOne: jest.fn().mockResolvedValue(attempt),
    }) } };
    const controller = controllerFactory({ strapi });
    const ctx = { request: { body: { resNum: attempt.resNum, eventId: event.eventId, stage: 'verify', kind: 'Unknown', bankResultCode: '-2' } } };

    await controller.recordOutcome(ctx);

    expect(reviewCases.getOrCreateCase).toHaveBeenCalledWith(strapi, attempt, 'VERIFY_UNKNOWN', {
      eventId: 'evt-verify-neg2', stage: 'verify', kind: 'Unknown',
    });
    expect(reviewCases.appendEvidence).toHaveBeenCalledWith(strapi, attempt, event);
    expect(recovery.sendPendingReviewOpens).toHaveBeenCalledWith(strapi);
    expect(ctx.body.result.bankResultCode).toBe('-2');
  });

  it('ثبت نتیجه شکست برگشت پرونده را ساخته و فوراً به بایمانی ارسال می‌کند', async () => {
    const attempt = { resNum: 'TR-00000004', topUpRequestId: 'topup-4', amountRial: 50000 };
    const event = { eventId: 'evt-reverse-fail', resNum: attempt.resNum, stage: 'reverse', kind: 'ReverseFailed',
      bankResultCode: '-1', occurredAtUtc: new Date().toISOString() };
    const eventQuery = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(event) };
    const strapi = { db: { query: jest.fn(uid => uid.includes('gateway-payment-event') ? eventQuery : {
      findOne: jest.fn().mockResolvedValue(attempt),
    }) } };
    const controller = controllerFactory({ strapi });
    const ctx = { request: { body: { resNum: attempt.resNum, eventId: event.eventId, stage: 'reverse', kind: 'ReverseFailed', bankResultCode: '-1' } } };

    await controller.recordOutcome(ctx);

    expect(reviewCases.getOrCreateCase).toHaveBeenCalledWith(strapi, attempt, 'REVERSE_UNKNOWN', {
      eventId: 'evt-reverse-fail', stage: 'reverse', kind: 'ReverseFailed',
    });
    expect(reviewCases.appendEvidence).toHaveBeenCalledWith(strapi, attempt, event);
    expect(recovery.sendPendingReviewOpens).toHaveBeenCalledWith(strapi);
    expect(ctx.body.result.kind).toBe('ReverseFailed');
  });

  it('اگر ارسال فوری به بایمانی با خطا مواجه شود، نتیجه با موفقیت ثبت شده و فرآیند پرداخت مسدود نمی‌شود', async () => {
    recovery.sendPendingReviewOpens.mockRejectedValueOnce(new Error('ByeMoney network unavailable'));
    const attempt = { resNum: 'TR-00000005', topUpRequestId: 'topup-5', amountRial: 50000 };
    const event = { eventId: 'evt-verify-fail-delivery', resNum: attempt.resNum, stage: 'verify', kind: 'Unknown',
      bankResultCode: '-2', occurredAtUtc: new Date().toISOString() };
    const attemptQuery = { findOne: jest.fn().mockResolvedValue(attempt), update: jest.fn() };
    const eventQuery = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(event) };
    const strapi = {
      db: { query: jest.fn(uid => uid.includes('gateway-payment-event') ? eventQuery : attemptQuery) },
      log: { error: jest.fn() },
    };
    const controller = controllerFactory({ strapi });
    const ctx = { request: { body: { resNum: attempt.resNum, eventId: event.eventId, stage: 'verify', kind: 'Unknown', bankResultCode: '-2' } } };

    await controller.recordOutcome(ctx);

    expect(ctx.status).toBeUndefined();
    expect(ctx.body.eventId).toBe('evt-verify-fail-delivery');
    expect(reviewCases.getOrCreateCase).toHaveBeenCalledWith(strapi, attempt, 'VERIFY_UNKNOWN', expect.any(Object));
    expect(recovery.sendPendingReviewOpens).toHaveBeenCalledWith(strapi);
    expect(strapi.log.error).toHaveBeenCalledWith(expect.stringContaining('ByeMoney network unavailable'));
    expect(attemptQuery.update).not.toHaveBeenCalled();
  });
});

'use strict';

jest.mock('@strapi/strapi', () => ({ factories: { createCoreController: (_uid, factory) => factory } }));
jest.mock('../../../src/services/gatewayReviewWorkflow', () => ({
  ...jest.requireActual('../../../src/services/gatewayReviewWorkflow'),
  money: jest.fn(), syncReview: jest.fn(async (_s, row) => row), resolveReview: jest.fn(),
}));
const workflow = require('../../../src/services/gatewayReviewWorkflow');
const factory = require('../../../src/api/gateway-review-case/controllers/gateway-review-case');
const policy = require('../../../src/policies/has-financial-review-permission');

describe('financial review API authorization and translation', () => {
  beforeEach(() => jest.clearAllMocks());
  const context = () => ({ request: { headers: { authorization: 'Bearer staff-jwt' }, body: {} },
    state: { user: { documentId: 'staff-doc', role: { type: 'authenticated' } } }, params: { clientReferenceCode: 'TR-1' } });

  test('a financial permission works without an administrator Strapi role', async () => {
    workflow.money.mockResolvedValue({ canReviewTopUps: true });
    await expect(policy(context())).resolves.toBe(true);
    expect(workflow.money).toHaveBeenCalledWith('/api/admin/topups/permissions', { jwt: 'staff-jwt' });
  });
  test('a financial permission works with new Permission Matrix array format', async () => {
    workflow.money.mockResolvedValue({ permissions: ['TopUp.Review'], roles: ['Admin'] });
    await expect(policy(context())).resolves.toBe(true);
  });
  test('administrator role alone never grants financial permission', async () => {
    const ctx = context(); ctx.state.user.role.type = 'administrator';
    workflow.money.mockResolvedValue({ canReviewTopUps: false });
    await expect(policy(ctx)).resolves.toBe(false);
  });
  test('permission service outage denies access', async () => {
    workflow.money.mockRejectedValue(new Error('unavailable'));
    await expect(policy(context())).resolves.toBe(false);
  });
  test('unauthenticated caller is rejected before contacting ByeMoney', async () => {
    const ctx = context(); ctx.state.user = null;
    await expect(policy(ctx)).resolves.toBe(false);
    expect(workflow.money).not.toHaveBeenCalled();
  });
  test('resolve passes authenticated identity, never the body actor', async () => {
    const row = { caseId: 'case-1', clientReferenceCode: 'TR-1' };
    const strapi = { db: { query: () => ({ findOne: async () => row }) } };
    const controller = factory({ strapi });
    const ctx = context(); ctx.request.body = { actorDocumentId: 'forged' };
    workflow.resolveReview.mockRejectedValue(Object.assign(new Error(), { status: 422, code: 'REVIEW_MANUAL_REFUND_NOT_SUPPORTED' }));
    await controller.resolve(ctx);
    expect(workflow.resolveReview).toHaveBeenCalledWith(strapi, row, ctx.request.body, 'staff-jwt', 'staff-doc');
    expect(ctx.status).toBe(422);
    expect(ctx.body.code).toBe('REVIEW_MANUAL_REFUND_NOT_SUPPORTED');
  });
  test('all review routes require the financial permission policy', () => {
    const { routes } = require('../../../src/api/gateway-review-case/routes/gateway-review-case')({ strapi: {} });
    for (const route of routes) {
      expect(route.config.policies).toContain('global::has-financial-review-permission');
      expect(route.config.auth).not.toBe(false);
    }
  });
  test('list refreshes closed legacy status from ByeMoney', async () => {
    const stale = { caseId: 'case-1', status: 'resolved', outcomeCode: 'MANUAL_REFUND',
      resolutionTopUpStatus: 'Pending', manualRefundReference: 'refund-1' };
    const current = { ...stale, resolutionTopUpStatus: 'ManuallyRefunded' };
    const query = { findMany: jest.fn().mockResolvedValue([stale]), count: jest.fn().mockResolvedValue(1) };
    const strapi = { db: { query: () => query } };
    workflow.syncReview.mockResolvedValueOnce(current);
    const ctx = context(); ctx.query = {};

    await factory({ strapi }).find(ctx);

    expect(workflow.syncReview).toHaveBeenCalledWith(strapi, stale);
    expect(ctx.body.data[0].topUpStatus).toBe('ManuallyRefunded');
  });
  test('فهرست آخرین نتیجهٔ هر پرونده را همراه ترجمه با یک خواندن گروهی برمی‌گرداند', async () => {
    const rows = ['TR-1', 'TR-2', 'TR-3', 'TR-4'].map((reference, index) => ({
      caseId: `case-${index}`, clientReferenceCode: reference, status: 'open',
    }));
    const cases = { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(4) };
    const events = { findMany: jest.fn().mockResolvedValue([
      { resNum: 'TR-1', bankResultCode: '0', stage: 'verify' },
      { resNum: 'TR-2', bankResultCode: '-2', stage: 'reverse' },
      { resNum: 'TR-3', bankResultCode: '999', stage: 'verify' },
      { resNum: 'TR-1', bankResultCode: '-6', stage: 'verify' },
    ]) };
    const strapi = { db: { query: uid => uid.includes('gateway-payment-event') ? events : cases } };
    const ctx = context(); ctx.query = {};

    await factory({ strapi }).find(ctx);

    expect(ctx.body.data.map(row => [row.bankResultCode, row.bankResultDescription])).toEqual([
      ['0', 'موفق'], ['-2', 'تراکنش یافت نشد.'], ['999', null], [null, null],
    ]);
    expect(events.findMany).toHaveBeenCalledTimes(1);
    expect(events.findMany).toHaveBeenCalledWith({
      where: { resNum: { $in: ['TR-1', 'TR-2', 'TR-3', 'TR-4'] }, bankResultCode: { $notNull: true } },
      select: ['resNum', 'bankResultCode', 'stage'],
      orderBy: [{ occurredAtUtc: 'desc' }, { id: 'desc' }],
    });
    expect(workflow.money).not.toHaveBeenCalled();
  });
  test('پرونده با شناسه و وضعیت باز در فهرست ادمین نمایش داده می‌شود', async () => {
    const rows = [{
      id: 101,
      caseId: '550e8400-e29b-41d4-a716-446655440000',
      clientReferenceCode: 'TR-OPEN-1',
      topUpRequestId: 'topup-open-1',
      reasonCode: 'VERIFY_UNKNOWN',
      status: 'open',
      openedAtUtc: '2026-10-27T10:00:00.000Z',
    }];
    const cases = { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(1) };
    const events = { findMany: jest.fn().mockResolvedValue([
      { resNum: 'TR-OPEN-1', bankResultCode: '-2', stage: 'verify' },
    ]) };
    const strapi = { db: { query: uid => uid.includes('gateway-payment-event') ? events : cases } };
    const ctx = context(); ctx.query = { status: 'open' };

    await factory({ strapi }).find(ctx);

    expect(ctx.body.data).toHaveLength(1);
    expect(ctx.body.data[0]).toMatchObject({
      id: 101,
      caseId: '550e8400-e29b-41d4-a716-446655440000',
      clientReferenceCode: 'TR-OPEN-1',
      status: 'open',
      reasonCode: 'VERIFY_UNKNOWN',
      bankResultCode: '-2',
      bankResultDescription: 'تراکنش یافت نشد.',
      bankResultStage: 'verify',
    });
  });
  test('فهرست خالی رویدادهای پرداخت را نمی‌خواند', async () => {
    const cases = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    const strapi = { db: { query: jest.fn(() => cases) } };
    const ctx = context(); ctx.query = {};

    await factory({ strapi }).find(ctx);

    expect(ctx.body.data).toEqual([]);
    expect(strapi.db.query).not.toHaveBeenCalledWith('api::gateway-payment-event.gateway-payment-event');
  });

  const openCase = () => ({ caseId: 'case-1', clientReferenceCode: 'TR-1', status: 'open', revision: 1,
    outcomeCode: 'CONFIRMED_EXCEPTIONAL', notificationStatus: 'delivered' });
  const renderDetail = async (financial) => {
    workflow.money.mockResolvedValue(financial);
    const query = { findOne: jest.fn().mockResolvedValue(openCase()), findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0) };
    const ctx = context();
    await factory({ strapi: { db: { query: () => query } } }).findOne(ctx);
    return ctx.body.data;
  };

  test('فهرست برچسب فارسی نتیجهٔ استثنایی را برمی‌گرداند', async () => {
    const rows = [{ caseId: 'case-1', clientReferenceCode: 'TR-1', status: 'resolved',
      outcomeCode: 'CONFIRMED_EXCEPTIONAL', resolutionTopUpStatus: 'Confirmed' }];
    const cases = { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(1) };
    const events = { findMany: jest.fn().mockResolvedValue([]) };
    const strapi = { db: { query: uid => uid.includes('gateway-payment-event') ? events : cases } };
    const ctx = context(); ctx.query = {};

    await factory({ strapi }).find(ctx);

    expect(ctx.body.data[0].outcomeDescription).toBe('تأیید استثنایی و شارژ نور');
  });

  test('جزئیات پرونده امکان تأیید استثنایی را فقط بدون سابقهٔ بازپرداخت یا برگشت می‌دهد', async () => {
    const verified = { topUpStatus: 'Rejected', gatewayResultKind: 'Verified', refNum: 'EXT-1',
      rrn: 'RRN-1', amountRial: 100000, review: { audit: [], manualRefundReference: null } };

    const current = await renderDetail(verified);

    expect(current).toMatchObject({ outcomeDescription: 'تأیید استثنایی و شارژ نور', canCloseExceptional: true });
    const blocked = [{ audit: [{ outcomeCode: 'MANUAL_REFUND' }] },
      { audit: [], manualRefundReference: 'refund-1' },
      { audit: [{ eventType: 'ReverseSucceeded' }] }];
    for (const review of blocked)
      await expect(renderDetail({ ...verified, review })).resolves.toMatchObject({ canCloseExceptional: false });
    await expect(renderDetail({ ...verified, topUpStatus: 'Pending' })).resolves.toMatchObject({ canCloseExceptional: false });
  });

  test('خطای ۴۰۹ یا ۴۲۲ سرویس مالی با همان وضعیت به پنل برمی‌گردد', async () => {
    const row = { caseId: 'case-1', clientReferenceCode: 'TR-1' };
    const strapi = { db: { query: () => ({ findOne: async () => row }) } };
    const controller = factory({ strapi });
    for (const failure of [{ status: 409, code: 'REVIEW_STATE_MISMATCH' },
      { status: 422, code: 'TOPUP_AMOUNT_MISMATCH' }]) {
      const ctx = context();
      workflow.resolveReview.mockRejectedValueOnce(Object.assign(new Error(failure.code), failure));
      await controller.resolve(ctx);
      expect(ctx.status).toBe(failure.status);
      expect(ctx.body).toEqual({ code: failure.code });
    }
  });
});

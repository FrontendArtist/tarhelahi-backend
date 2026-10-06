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
});

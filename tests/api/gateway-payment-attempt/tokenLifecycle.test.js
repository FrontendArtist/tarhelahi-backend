'use strict';

const lifecycles = require('../../../src/api/gateway-payment-attempt/content-types/gateway-payment-attempt/lifecycles');
const controllerFactory = require('../../../src/api/gateway-payment-attempt/controllers/gateway-payment-attempt');

describe('gateway attempt SEP token timestamps', () => {
  const originalStrapi = global.strapi;

  afterEach(() => { global.strapi = originalStrapi; });

  it('ignores forged client timestamps on creation without a token', () => {
    const data = { status: 'created', tokenIssuedAtUtc: '2000-01-01T00:00:00Z',
      tokenExpiresAtUtc: '2099-01-01T00:00:00Z' };

    lifecycles.beforeCreate({ params: { data } });

    expect(data).toEqual({ status: 'created' });
  });

  it('stamps the server time and effective 20-minute SEP expiry on issuance', async () => {
    global.strapi = { db: { query: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue({ status: 'created' }) })) } };
    const data = { status: 'token_issued', tokenIssuedAtUtc: '2000-01-01T00:00:00Z',
      tokenExpiresAtUtc: '2099-01-01T00:00:00Z' };
    const before = Date.now();

    await lifecycles.beforeUpdate({ params: { data, where: { id: 42 } } });

    expect(Date.parse(data.tokenIssuedAtUtc)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(data.tokenIssuedAtUtc)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(data.tokenExpiresAtUtc) - Date.parse(data.tokenIssuedAtUtc)).toBe(20 * 60_000);
  });

  it('also stamps an attempt created directly in token_issued status', () => {
    const data = { status: 'token_issued', tokenIssuedAtUtc: '2000-01-01T00:00:00Z' };

    lifecycles.beforeCreate({ params: { data } });

    expect(Date.parse(data.tokenIssuedAtUtc)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
    expect(Date.parse(data.tokenExpiresAtUtc) - Date.parse(data.tokenIssuedAtUtc)).toBe(20 * 60_000);
  });

  it('does not replace timestamps on a repeated token-issued update', async () => {
    global.strapi = { db: { query: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue({ status: 'token_issued' }) })) } };
    const data = { status: 'token_issued', tokenIssuedAtUtc: '2000-01-01T00:00:00Z',
      tokenExpiresAtUtc: '2099-01-01T00:00:00Z' };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 42 } } });

    expect(data).toEqual({ status: 'token_issued' });
  });

  it('rejects bulk transitions that would bypass per-attempt stamping', () => {
    const data = { status: 'token_issued', tokenIssuedAtUtc: '2000-01-01T00:00:00Z' };
    expect(() => lifecycles.beforeUpdateMany({ params: { data } })).toThrow('صدور گروهی توکن پرداخت پشتیبانی نمی‌شود.');
    expect(data.tokenIssuedAtUtc).toBeUndefined();
  });

  it('discards even invalid client timestamps before Strapi validates create and update', async () => {
    const controller = controllerFactory({ strapi: { contentType: jest.fn().mockReturnValue({}) } });
    const baseCreate = jest.fn(async ctx => ctx.request.body.data);
    const baseUpdate = jest.fn(async ctx => ctx.request.body.data);
    Object.setPrototypeOf(controller, { create: baseCreate, update: baseUpdate });

    for (const action of ['create', 'update']) {
      const ctx = { request: { body: { data: { status: 'token_issued',
        tokenIssuedAtUtc: 'not-a-date', tokenExpiresAtUtc: 'not-a-date',
      } } } };
      await controller[action](ctx);
      expect(ctx.request.body.data).toEqual({ status: 'token_issued' });
    }
    expect(baseCreate).toHaveBeenCalledTimes(1);
    expect(baseUpdate).toHaveBeenCalledTimes(1);
  });
});

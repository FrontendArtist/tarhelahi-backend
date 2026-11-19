'use strict';

const { documentMiddleware } = require('../../src/services/shippingSettingMiddleware');
const byeMoneySettingsService = require('../../src/services/byeMoneySettingsService');

describe('shippingSettingMiddleware', () => {
  let middleware;
  let strapiMock;

  beforeEach(() => {
    strapiMock = {
      log: {
        warn: jest.fn(),
      },
    };
    middleware = documentMiddleware(strapiMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ignores other content types', async () => {
    const next = jest.fn().mockResolvedValue({ id: 1 });
    const context = {
      uid: 'api::product.product',
      action: 'findOne',
    };

    const result = await middleware(context, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 1 });
  });

  it('populates rialPerNoorForShipping from ByeMoney on findFirst/findOne', async () => {
    jest.spyOn(byeMoneySettingsService, 'getRialToNoorRate').mockResolvedValue(10);

    const next = jest.fn().mockResolvedValue({
      id: 1,
      costMode: 'fixed',
      rialPerNoorForShipping: '999',
    });
    const context = {
      uid: 'api::shipping-setting.shipping-setting',
      action: 'findFirst',
    };

    const result = await middleware(context, next);
    expect(result.rialPerNoorForShipping).toBe('10');
  });

  it('populates rialPerNoorForShipping on findMany for array of documents', async () => {
    jest.spyOn(byeMoneySettingsService, 'getRialToNoorRate').mockResolvedValue(10);

    const next = jest.fn().mockResolvedValue([
      { id: 1, costMode: 'fixed', rialPerNoorForShipping: '999' },
    ]);
    const context = {
      uid: 'api::shipping-setting.shipping-setting',
      action: 'findMany',
    };

    const result = await middleware(context, next);
    expect(result[0].rialPerNoorForShipping).toBe('10');
  });

  it('enforces rialPerNoorForShipping on create and update', async () => {
    jest.spyOn(byeMoneySettingsService, 'getRialToNoorRate').mockResolvedValue(10);

    const next = jest.fn().mockImplementation(async () => context.params.data);
    const context = {
      uid: 'api::shipping-setting.shipping-setting',
      action: 'update',
      params: {
        data: {
          costMode: 'postex',
          rialPerNoorForShipping: '123',
        },
      },
    };

    await middleware(context, next);
    expect(context.params.data.rialPerNoorForShipping).toBe('10');
  });
});

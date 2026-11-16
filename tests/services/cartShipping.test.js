'use strict';

const cartShipping = require('../../src/services/cartShipping');
const postexQuote = require('../../src/services/postexShippingQuote');

function settingsQuery(settings) {
  return {
    db: {
      query: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue(settings),
      }),
    },
  };
}

const product = (price, quantity = 1) => ({
  type: 'product',
  discountedUnitPriceInNoor: price,
  quantity,
});

describe('cartShipping (SHIP-COST-MODE)', () => {
  beforeEach(() => {
    postexQuote.resetCityCacheForTests();
    delete process.env.POSTEX_API_KEY;
  });

  it('returns zero for carts without physical items', async () => {
    const result = await cartShipping.calculate(settingsQuery({}), [{ type: 'course' }], null);
    expect(result).toEqual({ shippingAmountInNoor: 0, shippingRuleLabel: 'بدون ارسال' });
  });

  it('keeps fixed mode and free-shipping threshold', async () => {
    const strapi = settingsQuery({
      costMode: 'fixed',
      fixedAmountInNoor: 40,
      freeShippingThresholdInNoor: 100,
    });
    const free = await cartShipping.calculate(strapi, [product(60), product(50)], { city: 'تهران' });
    expect(free).toEqual({ shippingAmountInNoor: 0, shippingRuleLabel: 'ارسال رایگان' });

    const paid = await cartShipping.calculate(strapi, [product(30)], { city: 'تهران' });
    expect(paid).toEqual({ shippingAmountInNoor: 40, shippingRuleLabel: 'ارسال ثابت داخلی' });
  });

  it('defaults missing costMode to fixed', async () => {
    const strapi = settingsQuery({ fixedAmountInNoor: 25 });
    const result = await cartShipping.calculate(strapi, [product(10)], { city: 'مشهد' });
    expect(result).toEqual({ shippingAmountInNoor: 25, shippingRuleLabel: 'ارسال ثابت داخلی' });
  });

  it('quotes postex total_cost and ceilings to whole Noor', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('cities/all')) {
        return {
          ok: true,
          json: async () => [{ cities: [{ id: 1, name: 'تهران' }] }],
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ total_cost: 3342000 }),
      };
    });

    const strapi = settingsQuery({
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
      freeShippingThresholdInNoor: 1000,
    });

    const result = await cartShipping.calculate(
      strapi,
      [product(50)],
      { city: 'تهران', province: 'تهران' },
      { fetchImpl },
    );

    expect(result).toEqual({ shippingAmountInNoor: 335, shippingRuleLabel: 'برآورد پستکس' });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('skips postex call when free-shipping threshold is met', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn();
    const strapi = settingsQuery({
      costMode: 'postex',
      freeShippingThresholdInNoor: 100,
      rialPerNoorForShipping: 10000,
    });

    const result = await cartShipping.calculate(
      strapi,
      [product(120)],
      { city: 'تهران' },
      { fetchImpl },
    );

    expect(result).toEqual({ shippingAmountInNoor: 0, shippingRuleLabel: 'ارسال رایگان' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('conflicts when postex mode has no API key', async () => {
    const strapi = settingsQuery({ costMode: 'postex' });
    await expect(
      cartShipping.calculate(strapi, [product(10)], { city: 'تهران' }),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });

  it('conflicts when postex quote fails', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('cities/all')) {
        return {
          ok: true,
          json: async () => [{ cities: [{ id: 259, name: 'مشهد' }] }],
        };
      }
      return { ok: false, text: async () => JSON.stringify({ message: 'قطع موقت' }) };
    });
    const strapi = settingsQuery({ costMode: 'postex', rialPerNoorForShipping: 10000 });

    await expect(
      cartShipping.calculate(
        strapi,
        [product(10)],
        { city: 'مشهد', province: 'خراسان رضوی' },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });
});

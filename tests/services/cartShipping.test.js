'use strict';

const cartShipping = require('../../src/services/cartShipping');
const postexQuote = require('../../src/services/postexShippingQuote');
const postexBoxes = require('../../src/services/postexBoxes');

function settingsQuery(settings, cities = []) {
  return {
    db: {
      query(uid) {
        if (uid === 'api::city.city') {
          return {
            findOne: async ({ where } = {}) => cities.find((city) => city.documentId === where?.documentId) || null,
          };
        }
        return { findOne: async () => settings };
      },
    },
  };
}

const product = (price, quantity = 1, parcelFactors = {
  weightGrams: 250,
  lengthCm: 15,
  widthCm: 10,
  heightCm: 20,
  boxTypeId: 5,
  isFragile: false,
}) => ({
  type: 'product',
  externalId: `p-${price}-${quantity}`,
  discountedUnitPriceInNoor: price,
  quantity,
  parcelFactors,
});

describe('cartShipping (SHIP-BOX-TYPE)', () => {
  beforeEach(() => {
    postexQuote.resetCityCacheForTests();
    delete process.env.POSTEX_API_KEY;
  });

  it('returns zero for carts without physical items', async () => {
    const result = await cartShipping.calculate(settingsQuery({}), [{ type: 'course' }], null);
    expect(result).toEqual({ shippingAmountInNoor: 0, shippingRuleLabel: 'بدون ارسال', parcelQuotes: [] });
  });

  it('keeps fixed mode and free-shipping threshold', async () => {
    const strapi = settingsQuery({
      costMode: 'fixed',
      fixedAmountInNoor: 40,
      freeShippingThresholdInNoor: 100,
      rialPerNoorForShipping: 10000,
    });
    const free = await cartShipping.calculate(strapi, [product(60), product(50)], { city: 'تهران' });
    expect(free.shippingAmountInNoor).toBe(0);
    expect(free.shippingRuleLabel).toBe('ارسال رایگان');
    expect(free.parcelQuotes).toHaveLength(2);

    const paid = await cartShipping.calculate(strapi, [product(30)], { city: 'تهران' });
    expect(paid).toMatchObject({ shippingAmountInNoor: 40, shippingRuleLabel: 'ارسال ثابت داخلی' });
    expect(paid.parcelQuotes[0].declaredValueIrr).toBe(30 * 10000);
  });

  it('rejects a physical cart when the rial-per-noor rate is missing', async () => {
    const strapi = settingsQuery({ costMode: 'fixed', fixedAmountInNoor: 40 });
    await expect(
      cartShipping.calculate(strapi, [product(30)], { city: 'تهران' }),
    ).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: 'نرخ ریال به نور برای ارسال تنظیم نشده است.',
    });
  });

  it('rejects a declared value above the Iran Post maximum', async () => {
    const strapi = settingsQuery({
      costMode: 'fixed',
      fixedAmountInNoor: 40,
      rialPerNoorForShipping: 10000,
    });
    await expect(
      cartShipping.calculate(strapi, [product(700000)], { city: 'تهران' }),
    ).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: 'ارزش ریالی کالا از سقف شرکت پست (۵ میلیارد ریال) بیشتر است.',
    });
  });

  it('defaults missing costMode to postex', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 250_000 }),
    }));
    const strapi = settingsQuery(
      { fixedAmountInNoor: 25, rialPerNoorForShipping: 10000 },
      [{ documentId: 'city-mashhad', externalId: 200 }],
    );
    const result = await cartShipping.calculate(
      strapi,
      [product(10, 1, { weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 20, boxTypeId: 6 })],
      { city: 'مشهد', cityDocumentId: 'city-mashhad' },
      { fetchImpl, fromCityId: 573 },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.shippingAmountInNoor).toBe(25);
    expect(result.shippingRuleLabel).toBe('برآورد پستکس');
  });

  it('quotes the whole cart as one aggregated parcel', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 1_049_001 }),
    }));

    const strapi = settingsQuery({
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
      freeShippingThresholdInNoor: 1000,
    }, [{ documentId: 'city-tehran', externalId: 100 }]);

    const items = [
      product(50, 2, {
        weightGrams: 500,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 20,
        boxTypeId: 6,
        isFragile: true,
      }),
      product(30, 1, {
        weightGrams: 100,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 15,
        boxTypeId: 4,
        isFragile: false,
      }),
    ];

    const result = await cartShipping.calculate(
      strapi,
      items,
      { city: 'تهران', province: 'تهران', cityDocumentId: 'city-tehran' },
      { fetchImpl, fromCityId: 573 },
    );

    expect(result).toMatchObject({ shippingAmountInNoor: 105, shippingRuleLabel: 'برآورد پستکس' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.parcels).toHaveLength(1);
    const box = postexBoxes.resolve(7);
    expect(body.parcels[0].parcel_properties).toMatchObject({
      box_type_id: 7,
      total_weight: 600,
      length: box.lengthCm,
      width: box.widthCm,
      height: box.heightCm,
      total_value: 1_300_000,
      is_fragile: true,
    });
    expect(body.collection_type).toBe('courier_drop_off');
    expect(body.from_city_code).toBe(573);
    expect(body.parcels[0].to_city_code).toBe(100);

    expect(result.parcelQuotes).toEqual([
      {
        externalId: 'p-50-2',
        weightGrams: 500,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 20,
        boxTypeId: 6,
        isFragile: true,
        declaredValueIrr: 1_000_000,
      },
      {
        externalId: 'p-30-1',
        weightGrams: 100,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 15,
        boxTypeId: 4,
        isFragile: false,
        declaredValueIrr: 300_000,
      },
    ]);
  });

  it.each(['pick_up', 'postex_drop_off'])(
    'quotes with collection type %s from shipping-setting',
    async (collectionType) => {
      process.env.POSTEX_API_KEY = 'test-key';
      const fetchImpl = jest.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ total_cost: 1000 }),
      }));
      const strapi = settingsQuery({
        costMode: 'postex',
        rialPerNoorForShipping: 10000,
        collectionType,
      }, [{ documentId: 'city-tehran', externalId: 100 }]);

      await cartShipping.calculate(
        strapi,
        [product(10)],
        { city: 'تهران', cityDocumentId: 'city-tehran' },
        { fetchImpl, fromCityId: 573, collectionType: 'courier_drop_off' },
      );

      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(body.collection_type).toBe(collectionType);
    },
  );

  it('steps the shipment box up from the largest item box and quotes once', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 900_000 }),
    }));

    const strapi = settingsQuery({
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
    }, [{ documentId: 'city-tehran', externalId: 100 }]);

    const items = [
      product(10, 1, {
        weightGrams: 100,
        lengthCm: 15,
        widthCm: 10,
        heightCm: 20,
        boxTypeId: 5,
        isFragile: false,
      }),
      product(20, 1, {
        weightGrams: 200,
        lengthCm: 11,
        widthCm: 12,
        heightCm: 13,
        boxTypeId: 9,
        isFragile: false,
      }),
      product(40, 1, {
        weightGrams: 300,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 15,
        boxTypeId: 4,
        isFragile: false,
      }),
    ];

    const result = await cartShipping.calculate(
      strapi,
      items,
      { city: 'تهران', province: 'تهران', cityDocumentId: 'city-tehran' },
      { fetchImpl, fromCityId: 573, apiKey: 'test-key' },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const box = postexBoxes.resolve(10);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.parcels).toHaveLength(1);
    expect(body.parcels[0].parcel_properties).toMatchObject({
      box_type_id: 10,
      total_weight: 600,
      length: box.lengthCm,
      width: box.widthCm,
      height: box.heightCm,
      total_value: 700_000,
      is_fragile: false,
    });
    expect(result.shippingAmountInNoor).toBe(90);
    expect(result.parcelQuotes).toHaveLength(3);
    expect(result.parcelQuotes.map((quote) => quote.boxTypeId)).toEqual([5, 9, 4]);
    expect(result.parcelQuotes[1]).toMatchObject({ lengthCm: 11, widthCm: 12, heightCm: 13 });
  });

  it('rejects postex cart when box type is missing', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const strapi = settingsQuery({ costMode: 'postex', rialPerNoorForShipping: 10000 });
    await expect(
      cartShipping.calculate(
        strapi,
        [product(10, 1, null)],
        { city: 'تهران', cityDocumentId: 'city-tehran' },
        { fromCityId: 573 },
      ),
    ).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: 'جعبهٔ «p-10-1» برای ارسال تعیین نشده است.',
      lineError: {
        externalId: 'p-10-1',
        type: 'product',
        quantity: 1,
        reason: 'MISSING_BOX',
      },
    });
  });

  it('rejects a physical line with missing weight as MISSING_WEIGHT', async () => {
    const strapi = settingsQuery({
      costMode: 'fixed',
      fixedAmountInNoor: 40,
      rialPerNoorForShipping: 10000,
    });
    await expect(
      cartShipping.calculate(
        strapi,
        [product(10, 2, {
          weightGrams: 0,
          lengthCm: 15,
          widthCm: 10,
          heightCm: 20,
          boxTypeId: 5,
          isFragile: false,
        })],
        { city: 'تهران' },
      ),
    ).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: 'وزن «p-10-2» برای ارسال ثبت نشده است.',
      lineError: {
        externalId: 'p-10-2',
        type: 'product',
        quantity: 2,
        reason: 'MISSING_WEIGHT',
      },
    });
  });

  it('quotes with courier and service from shipping-setting and falls back when they are invalid', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ total_cost: 1000 }),
    }));
    const strapi = settingsQuery({
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
      courierCode: 'chapar',
      serviceType: 'not a service',
    }, [{ documentId: 'city-tehran', externalId: 100 }]);

    await cartShipping.calculate(
      strapi,
      [product(10)],
      { city: 'تهران', cityDocumentId: 'city-tehran' },
      { fetchImpl, fromCityId: 573, courierCode: 'IGNORED', serviceType: 'IGNORED' },
    );

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.courier).toEqual({ courier_code: 'CHAPAR', service_type: 'EXPRESS' });
  });

  it('rejects the physical cart after one postex error without a second quote', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'minimum value is 50000000' }),
    }));

    const strapi = settingsQuery({
      costMode: 'postex',
      rialPerNoorForShipping: 10000,
    }, [{ documentId: 'city-tehran', externalId: 100 }]);

    await expect(cartShipping.calculate(
      strapi,
      [product(10, 1)],
      { city: 'تهران', cityDocumentId: 'city-tehran' },
      { fetchImpl, fromCityId: 573 },
    )).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('skips postex call when free-shipping threshold is met but still returns factors', async () => {
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
      { fetchImpl, fromCityId: 259 },
    );

    expect(result.shippingAmountInNoor).toBe(0);
    expect(result.shippingRuleLabel).toBe('ارسال رایگان');
    expect(result.parcelQuotes[0].declaredValueIrr).toBe(1_200_000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('conflicts when postex mode has no API key', async () => {
    const strapi = settingsQuery({ costMode: 'postex' });
    await expect(
      cartShipping.calculate(strapi, [product(10)], { city: 'تهران' }, { fromCityId: 573 }),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });

  it('conflicts when postex mode has no fromCityId', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const strapi = settingsQuery({ costMode: 'postex' });
    await expect(
      cartShipping.calculate(strapi, [product(10)], { city: 'تهران' }),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });

  it('conflicts when the snapshot has no city in our table', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const strapi = settingsQuery({ costMode: 'postex', rialPerNoorForShipping: 10000 });
    await expect(
      cartShipping.calculate(
        strapi,
        [product(10)],
        { city: 'تهران', province: 'تهران', cityDocumentId: 'missing' },
        { fromCityId: 573 },
      ),
    ).rejects.toMatchObject({ code: 'CART_CONFLICT', status: 409 });
  });

  it('surfaces postex field validation details', async () => {
    process.env.POSTEX_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        title: 'One or more validation errors occurred.',
        errors: { 'Parcels[0].ParcelProperties.Length': ['The Length field is required.'] },
      }),
    }));
    const strapi = settingsQuery(
      { costMode: 'postex', rialPerNoorForShipping: 10000 },
      [{ documentId: 'city-mashhad', externalId: 259 }],
    );

    await expect(
      cartShipping.calculate(
        strapi,
        [product(10)],
        { city: 'مشهد', province: 'خراسان رضوی', cityDocumentId: 'city-mashhad' },
        { fetchImpl, fromCityId: 573 },
      ),
    ).rejects.toMatchObject({
      code: 'CART_CONFLICT',
      status: 409,
      message: expect.stringContaining('Length'),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads product weight times quantity and box dimensions', () => {
    const factors = cartShipping.readParcelFactors(
      { weight: 125.4, boxTypeId: 'box5: جعبه سایز 2 (15×10×20)', isFragile: true },
      2,
    );
    expect(factors).toEqual({
      weightGrams: 251,
      lengthCm: 15,
      widthCm: 10,
      heightCm: 20,
      boxTypeId: 5,
      isFragile: true,
    });
    expect(cartShipping.readParcelFactors({ weight: 10 }, 1)).toBeNull();
    expect(() => cartShipping.requireProductParcelOrConflict(
      { externalId: 'gold', type: 'product', quantity: 1, title: 'شمش' },
      { weight: 10 },
    )).toThrow('جعبهٔ «شمش» برای ارسال تعیین نشده است.');
  });
});

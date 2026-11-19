'use strict';

const shippingOrigins = require('../../src/services/shippingOrigins');

describe('shippingOrigins (SHIP-MULTI-ORIGIN)', () => {
  it('resolves a single shared origin from related city', () => {
    const origin = shippingOrigins.resolveCartOrigin([
      {
        shippingOrigin: {
          originId: 'mashhad',
          displayName: 'مشهد',
          city: { externalId: 259, name: 'مشهد' },
        },
      },
      {
        shippingOrigin: {
          originId: 'mashhad',
          displayName: 'مشهد',
          city: { externalId: 259, name: 'مشهد' },
        },
      },
    ]);

    expect(origin).toEqual({
      originId: 'mashhad',
      displayName: 'مشهد',
      cityId: 259,
      cityName: 'مشهد',
    });
  });

  it('reads locality id from city.externalId', () => {
    const origin = shippingOrigins.resolveCartOrigin([
      {
        shippingOrigin: {
          originId: 'mashhad',
          displayName: 'انبار مشهد',
          city: { externalId: 259, name: 'مشهد' },
        },
      },
    ]);

    expect(origin).toEqual({
      originId: 'mashhad',
      displayName: 'انبار مشهد',
      cityId: 259,
      cityName: 'مشهد',
    });
  });

  it('returns null when there are no physical products', () => {
    expect(shippingOrigins.resolveCartOrigin([])).toBeNull();
  });

  it('conflicts when a physical product has no origin', () => {
    expect(() => shippingOrigins.resolveCartOrigin([{ title: 'کالا' }])).toThrow(expect.objectContaining({
      code: 'CART_CONFLICT',
      status: 409,
      message: shippingOrigins.MISSING_ORIGIN_MESSAGE,
    }));
  });

  it('does not fall back when origin is null even if a default is supplied', () => {
    expect(() => shippingOrigins.resolveCartOrigin(
      [{ title: 'کالا', shippingOrigin: null }],
      {
        originId: 'ramsar',
        displayName: 'انبار رامسر',
        city: { externalId: 573, name: 'رامسر' },
      },
    )).toThrow(expect.objectContaining({
      code: 'CART_CONFLICT',
      status: 409,
      message: shippingOrigins.MISSING_ORIGIN_MESSAGE,
    }));
  });

  it('conflicts on a missing origin before comparing other origins', () => {
    expect(() =>
      shippingOrigins.resolveCartOrigin([
        { title: 'بدون مبدأ' },
        {
          shippingOrigin: {
            originId: 'mashhad',
            city: { externalId: 259, name: 'مشهد' },
          },
        },
      ]),
    ).toThrow(expect.objectContaining({
      code: 'CART_CONFLICT',
      status: 409,
      message: shippingOrigins.MISSING_ORIGIN_MESSAGE,
    }));
  });

  it('still resolves an explicit ramsar origin on the product', () => {
    const origin = shippingOrigins.resolveCartOrigin([
      {
        shippingOrigin: {
          originId: 'ramsar',
          displayName: 'رامسر',
          city: { externalId: 573, name: 'رامسر' },
        },
      },
    ]);

    expect(origin).toEqual({
      originId: 'ramsar',
      displayName: 'رامسر',
      cityId: 573,
      cityName: 'رامسر',
    });
  });

  it('conflicts when physical products use different origins', () => {
    expect(() =>
      shippingOrigins.resolveCartOrigin([
        {
          shippingOrigin: {
            originId: 'ramsar',
            city: { externalId: 573, name: 'رامسر' },
          },
        },
        {
          shippingOrigin: {
            originId: 'mashhad',
            city: { externalId: 259, name: 'مشهد' },
          },
        },
      ]),
    ).toThrow(expect.objectContaining({
      code: 'CART_CONFLICT',
      status: 409,
      message: 'اقلام فیزیکی سبد باید از یک مبدأ ارسال باشند.',
    }));
  });

  it('conflicts when origin city is missing or invalid', () => {
    expect(() =>
      shippingOrigins.resolveCartOrigin([
        { shippingOrigin: { originId: 'ramsar', displayName: 'رامسر' } },
      ]),
    ).toThrow(expect.objectContaining({
      code: 'CART_CONFLICT',
      status: 409,
      message: 'مبدأ ارسال کالای فیزیکی ناقص است.',
    }));
  });
});

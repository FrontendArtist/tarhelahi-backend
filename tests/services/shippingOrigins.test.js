'use strict';

const shippingOrigins = require('../../src/services/shippingOrigins');

describe('shippingOrigins (SHIP-MULTI-ORIGIN)', () => {
  it('resolves a single shared origin from product records', () => {
    const origin = shippingOrigins.resolveCartOrigin([
      {
        shippingOrigin: {
          originId: 'mashhad',
          displayName: 'مشهد',
          cityId: 259,
          cityName: 'مشهد',
        },
      },
      {
        shippingOrigin: {
          originId: 'mashhad',
          displayName: 'مشهد',
          cityId: 259,
          cityName: 'مشهد',
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

  it('returns null when there are no physical products', () => {
    expect(shippingOrigins.resolveCartOrigin([])).toBeNull();
  });

  it('conflicts when a product has no origin', () => {
    expect(() => shippingOrigins.resolveCartOrigin([{ title: 'کالا' }])).toThrow(
      expect.objectContaining({ code: 'CART_CONFLICT', status: 409 }),
    );
  });

  it('conflicts when physical products use different origins', () => {
    expect(() =>
      shippingOrigins.resolveCartOrigin([
        { shippingOrigin: { originId: 'ramsar', cityId: 573, cityName: 'رامسر' } },
        { shippingOrigin: { originId: 'mashhad', cityId: 259, cityName: 'مشهد' } },
      ]),
    ).toThrow(expect.objectContaining({ code: 'CART_CONFLICT', status: 409 }));
  });

  it('conflicts when origin cityId is invalid', () => {
    expect(() =>
      shippingOrigins.resolveCartOrigin([
        { shippingOrigin: { originId: 'ramsar', cityId: 0, cityName: 'رامسر' } },
      ]),
    ).toThrow(expect.objectContaining({ code: 'CART_CONFLICT', status: 409 }));
  });
});

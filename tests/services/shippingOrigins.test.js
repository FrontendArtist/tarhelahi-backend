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

  it('defaults to ramsar when a product has no origin', () => {
    const origin = shippingOrigins.resolveCartOrigin([{ title: 'کالا' }]);
    expect(origin).toEqual(shippingOrigins.FALLBACK_RAMSAR);
  });

  it('uses bootstrapped default origin when product has no origin', () => {
    const origin = shippingOrigins.resolveCartOrigin(
      [{ title: 'کالا' }],
      {
        originId: 'ramsar',
        displayName: 'انبار رامسر',
        city: { externalId: 573, name: 'رامسر' },
      },
    );
    expect(origin).toEqual({
      originId: 'ramsar',
      displayName: 'انبار رامسر',
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
    ).toThrow(expect.objectContaining({ code: 'CART_CONFLICT', status: 409 }));
  });

  it('conflicts when origin city is missing or invalid', () => {
    expect(() =>
      shippingOrigins.resolveCartOrigin([
        { shippingOrigin: { originId: 'ramsar', displayName: 'رامسر' } },
      ]),
    ).toThrow(expect.objectContaining({ code: 'CART_CONFLICT', status: 409 }));
  });
});

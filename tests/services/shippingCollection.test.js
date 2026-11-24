'use strict';

const shippingCollection = require('../../src/services/shippingCollection');

describe('shippingCollection', () => {
  it.each([
    ['pick_up', 'pick_up'],
    ['courier_drop_off', 'courier_drop_off'],
    ['postex_drop_off', 'postex_drop_off'],
    ['PICK_UP', 'pick_up'],
    ['', 'courier_drop_off'],
    [null, 'courier_drop_off'],
    ['office', 'courier_drop_off'],
  ])('normalizes %j to %s', (value, expected) => {
    expect(shippingCollection.normalizeCollectionType(value)).toBe(expected);
  });

  it('reads the stored collection type', async () => {
    const strapi = {
      db: {
        query: () => ({
          findOne: async () => ({ collectionType: 'postex_drop_off' }),
        }),
      },
    };
    await expect(shippingCollection.readCollectionType(strapi)).resolves.toBe('postex_drop_off');
  });

  it('fills a blank stored value with the approved default', async () => {
    const update = jest.fn().mockResolvedValue({});
    const strapi = {
      db: {
        query: () => ({
          findOne: async () => ({ id: 4, collectionType: null }),
          update,
        }),
      },
    };

    await shippingCollection.ensureCollectionType(strapi);

    expect(update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { collectionType: 'courier_drop_off' },
    });
  });

  it('leaves an allowed stored value unchanged', async () => {
    const update = jest.fn();
    const strapi = {
      db: {
        query: () => ({
          findOne: async () => ({ id: 4, collectionType: 'pick_up' }),
          update,
        }),
      },
    };

    await shippingCollection.ensureCollectionType(strapi);
    expect(update).not.toHaveBeenCalled();
  });
});

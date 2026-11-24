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

  it.each([
    ['IR_POST', 'IR_POST'],
    ['ir_post', 'IR_POST'],
    ['', 'IR_POST'],
    [null, 'IR_POST'],
    ['bad-courier', 'IR_POST'],
    ['CHAPAR', 'CHAPAR'],
  ])('normalizes courier %j to %s', (value, expected) => {
    expect(shippingCollection.normalizeCourierCode(value)).toBe(expected);
  });

  it.each([
    ['EXPRESS', 'EXPRESS'],
    ['priority', 'PRIORITY'],
    ['', 'EXPRESS'],
    ['bad service', 'EXPRESS'],
  ])('normalizes service %j to %s', (value, expected) => {
    expect(shippingCollection.normalizeServiceType(value)).toBe(expected);
  });

  it('reads courier and service with the collection type', async () => {
    const strapi = {
      db: {
        query: () => ({
          findOne: async () => ({
            collectionType: 'pick_up',
            courierCode: 'chapar',
            serviceType: '',
          }),
        }),
      },
    };
    await expect(shippingCollection.readDispatch(strapi)).resolves.toEqual({
      collectionType: 'pick_up',
      courierCode: 'CHAPAR',
      serviceType: 'EXPRESS',
    });
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
      data: {
        collectionType: 'courier_drop_off',
        courierCode: 'IR_POST',
        serviceType: 'EXPRESS',
      },
    });
  });

  it('leaves an allowed stored value unchanged', async () => {
    const update = jest.fn();
    const strapi = {
      db: {
        query: () => ({
          findOne: async () => ({
            id: 4,
            collectionType: 'pick_up',
            courierCode: 'IR_POST',
            serviceType: 'EXPRESS',
          }),
          update,
        }),
      },
    };

    await shippingCollection.ensureCollectionType(strapi);
    expect(update).not.toHaveBeenCalled();
  });
});

'use strict';

const shippingCollection = require('../../src/services/shippingCollection');

describe('shippingCollection', () => {
  it.each([
    ['fixed', 'fixed'],
    ['postex', 'postex'],
    ['نرخ ثابت', 'fixed'],
    ['پستکس (استعلام آنلاین)', 'postex'],
    ['', 'postex'],
    [null, 'postex'],
  ])('normalizes costMode %j to %s', (value, expected) => {
    expect(shippingCollection.normalizeCostMode(value)).toBe(expected);
  });

  it.each([
    ['pick_up', 'pick_up'],
    ['courier_drop_off', 'courier_drop_off'],
    ['postex_drop_off', 'postex_drop_off'],
    ['جمع‌آوری توسط پیک', 'pick_up'],
    ['تحویل توسط خودمان', 'courier_drop_off'],
    ['تحویل در دفتر پستی', 'postex_drop_off'],
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
          findOne: async () => ({ collectionType: 'تحویل در دفتر پستی' }),
        }),
      },
    };
    await expect(shippingCollection.readCollectionType(strapi)).resolves.toBe('postex_drop_off');
  });

  it.each([
    ['IR_POST', 'IR_POST'],
    ['ir_post', 'IR_POST'],
    ['شرکت ملی پست', 'IR_POST'],
    ['چاپار', 'CHAPAR'],
    ['دکاپست', 'DEKAPOST'],
    ['پست بار', 'POSTBAR'],
    ['پستکس وان (بین‌شهری)', 'POSTEX_EXPRESS'],
    ['پستکس وان (درون‌شهری و عادی)', 'COREPOSTING'],
    ['باراکسپرس', 'BAREXPRESS'],
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
    ['پست پیشتاز', 'EXPRESS'],
    ['پست ویژه', 'PRIORITY'],
    ['پست اکسپرس', 'POSTEXPRESS'],
    ['چاپار', 'CHAPAR'],
    ['باراکسپرس (ترمینال به درب)', 'T2D'],
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
            collectionType: 'جمع‌آوری توسط پیک',
            courierCode: 'چاپار',
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

  it('fills a blank or legacy stored value with the Persian enum defaults', async () => {
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
        costMode: 'پستکس (استعلام آنلاین)',
        collectionType: 'تحویل توسط خودمان',
        courierCode: 'شرکت ملی پست',
        serviceType: 'پست پیشتاز',
      },
    });
  });

  it('leaves an allowed Persian stored value unchanged', async () => {
    const update = jest.fn();
    const strapi = {
      db: {
        query: () => ({
          findOne: async () => ({
            id: 4,
            costMode: 'نرخ ثابت',
            collectionType: 'جمع‌آوری توسط پیک',
            courierCode: 'شرکت ملی پست',
            serviceType: 'پست پیشتاز',
          }),
          update,
        }),
      },
    };

    await shippingCollection.ensureCollectionType(strapi);
    expect(update).not.toHaveBeenCalled();
  });

  it('creates shipping-setting with approved defaults when none exists', async () => {
    const create = jest.fn().mockResolvedValue({});
    const strapi = {
      db: {
        query: () => ({
          findOne: async () => null,
          create,
        }),
      },
    };

    await shippingCollection.ensureCollectionType(strapi);

    expect(create).toHaveBeenCalledWith({
      data: {
        costMode: 'پستکس (استعلام آنلاین)',
        collectionType: 'تحویل توسط خودمان',
        courierCode: 'شرکت ملی پست',
        serviceType: 'پست پیشتاز',
        fixedAmountInNoor: '170000',
        rialPerNoorForShipping: '10',
      },
    });
  });
});

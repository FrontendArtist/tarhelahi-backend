'use strict';

const lifecycles = require('../../../src/api/address/content-types/address/lifecycles');
const localities = require('../../../src/services/localities');

function createStrapi() {
  const cities = [
    {
      id: 10,
      documentId: 'city-ramsar',
      name: 'رامسر',
      externalId: 573,
      province: { name: 'مازندران' },
    },
    {
      id: 12,
      documentId: 'city-rey',
      name: 'ری',
      externalId: 301,
      province: { name: 'تهران' },
    },
  ];

  const strapi = {
    db: {
      query(uid) {
        if (uid === localities.CITY_UID) {
          return {
            findOne: async ({ where, select } = {}) => {
              expect(select).toEqual(['id', 'documentId', 'name']);
              const row = cities.find((city) => (
                where.documentId ? city.documentId === where.documentId : city.id === where.id
              ));
              return row ? { ...row, province: { ...row.province } } : null;
            },
          };
        }
        throw new Error(`unexpected uid ${uid}`);
      },
    },
  };

  return { strapi, cities };
}

describe('address locality lifecycle', () => {
  const previous = global.strapi;

  afterEach(() => {
    global.strapi = previous;
  });

  it('links our city id on create and copies the official names', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = {
      cityLink: ' city-ramsar ',
      province: 'نام اشتباه',
      city: 'شهر اشتباه',
      postalCode: '1234567890',
      fullAddress: 'خیابان ساحلی',
      recipientName: 'مریم',
      recipientPhone: '09121111111',
      title: 'آدرس خانه',
    };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data).toEqual({
      cityLink: 10,
      province: 'مازندران',
      city: 'رامسر',
      postalCode: '1234567890',
      fullAddress: 'خیابان ساحلی',
      recipientName: 'مریم',
      recipientPhone: '09121111111',
      title: 'آدرس خانه',
    });
    expect(data.externalId).toBeUndefined();
  });

  it('accepts a relation object that already carries our document id', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { cityLink: { connect: [{ documentId: 'city-rey' }] }, fullAddress: 'خیابان ساحلی' };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.cityLink).toBe(12);
    expect(data.province).toBe('تهران');
    expect(data.city).toBe('ری');
  });

  it('rejects create without our city id and does not keep typed names', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { province: 'مازندران', city: 'رامسر', fullAddress: 'خیابان' };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toMatchObject({
      name: 'ValidationError',
      message: localities.CITY_REQUIRED_MESSAGE,
    });
    expect(data).toEqual({ province: 'مازندران', city: 'رامسر', fullAddress: 'خیابان' });
  });

  it('rejects an unknown city id', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { cityLink: 'missing-city', fullAddress: 'خیابان' };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toMatchObject({
      name: 'ValidationError',
      message: localities.CITY_REQUIRED_MESSAGE,
    });
    expect(data.fullAddress).toBe('خیابان');
  });

  it('rewrites names when the linked city changes', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { cityLink: 'city-rey', province: 'مازندران', city: 'رامسر', postalCode: '2222222222' };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } });

    expect(data).toEqual({
      cityLink: 12,
      province: 'تهران',
      city: 'ری',
      postalCode: '2222222222',
    });
  });

  it('rejects a name-only update', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { city: 'ری', recipientPhone: '09120000000' };

    await expect(lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } })).rejects.toMatchObject({
      name: 'ValidationError',
      message: localities.CITY_REQUIRED_MESSAGE,
    });
    expect(data).toEqual({ city: 'ری', recipientPhone: '09120000000' });
  });

  it('leaves an update of other address fields alone', async () => {
    global.strapi = {
      db: {
        query() {
          throw new Error('city table should not be read');
        },
      },
    };
    const data = { postalCode: '4444444444', fullAddress: 'فقط خیابان', recipientName: 'رضا' };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } });

    expect(data).toEqual({ postalCode: '4444444444', fullAddress: 'فقط خیابان', recipientName: 'رضا' });
  });

  it('rejects a short street address on create', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { cityLink: 'city-ramsar', fullAddress: 'مشهد' };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toMatchObject({
      name: 'ValidationError',
      message: 'نشانی باید حداقل ۱۰ نویسه باشد (خیابان، کوچه و پلاک).',
    });
  });

  it('rejects a short street address on update without reading the city table', async () => {
    global.strapi = {
      db: {
        query() {
          throw new Error('city table should not be read');
        },
      },
    };
    const data = { fullAddress: '  مشهد  ' };

    await expect(lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } })).rejects.toMatchObject({
      name: 'ValidationError',
      message: 'نشانی باید حداقل ۱۰ نویسه باشد (خیابان، کوچه و پلاک).',
    });
  });
});

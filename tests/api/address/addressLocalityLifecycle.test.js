'use strict';

const lifecycles = require('../../../src/api/address/content-types/address/lifecycles');
const localities = require('../../../src/services/localities');

function createStrapi() {
  const provinces = [
    { id: 1, name: 'مازندران' },
    { id: 2, name: 'تهران' },
  ];
  const cities = [
    { id: 10, name: 'رامسر', provinceId: 1 },
    { id: 11, name: 'ساری', provinceId: 1 },
    { id: 12, name: 'ری', provinceId: 2 },
  ];
  const addresses = [
    {
      id: 7,
      province: 'مازندران',
      city: 'رامسر',
      postalCode: '1111111111',
      fullAddress: 'خیابان قدیم',
      recipientName: 'علی',
      recipientPhone: '09120000000',
    },
  ];
  const calls = [];

  const strapi = {
    db: {
      query(uid) {
        if (uid === localities.PROVINCE_UID) {
          return {
            findMany: async ({ where } = {}) => {
              calls.push('province');
              return provinces.filter((row) => !where?.name || row.name === where.name);
            },
          };
        }
        if (uid === localities.CITY_UID) {
          return {
            findOne: async ({ where } = {}) => {
              calls.push('city');
              const ids = where?.province?.id?.$in || [];
              return cities.find((row) => row.name === where.name && ids.includes(row.provinceId)) || null;
            },
          };
        }
        if (uid === 'api::address.address') {
          return {
            findOne: async ({ where, select } = {}) => {
              calls.push(['address', where, select]);
              const row = addresses.find((item) => item.id === where.id) || null;
              if (!row) return null;
              if (!select) return { ...row };
              return Object.fromEntries(select.map((key) => [key, row[key]]));
            },
          };
        }
        throw new Error(`unexpected uid ${uid}`);
      },
    },
  };

  return { strapi, calls, addresses };
}

describe('address locality lifecycle', () => {
  const previous = global.strapi;

  afterEach(() => {
    global.strapi = previous;
  });

  it('trims and accepts an official pair on create without changing other fields', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = {
      province: '  مازندران  ',
      city: ' رامسر ',
      postalCode: '1234567890',
      fullAddress: 'خیابان ساحلی',
      recipientName: 'مریم',
      recipientPhone: '09121111111',
      title: 'آدرس خانه',
    };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data).toEqual({
      province: 'مازندران',
      city: 'رامسر',
      postalCode: '1234567890',
      fullAddress: 'خیابان ساحلی',
      recipientName: 'مریم',
      recipientPhone: '09121111111',
      title: 'آدرس خانه',
    });
  });

  it('rejects free-text province or city on create and leaves other fields unchanged', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = {
      province: ' استان آزاد ',
      city: ' شهر آزاد ',
      postalCode: '1234567890',
      fullAddress: 'خیابان آزاد',
      recipientName: 'مریم',
      recipientPhone: '09121111111',
    };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toMatchObject({
      name: 'ValidationError',
      message: localities.INVALID_PAIR_MESSAGE,
    });
    expect(data).toEqual({
      province: 'استان آزاد',
      city: 'شهر آزاد',
      postalCode: '1234567890',
      fullAddress: 'خیابان آزاد',
      recipientName: 'مریم',
      recipientPhone: '09121111111',
    });
  });

  it('rejects a city that belongs to another province', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { province: 'مازندران', city: 'ری', fullAddress: 'خیابان' };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(data.fullAddress).toBe('خیابان');
  });

  it('rejects non-string province or city values', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { province: 1, city: 'رامسر', fullAddress: 'خیابان' };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(data).toEqual({ province: 1, city: 'رامسر', fullAddress: 'خیابان' });
  });

  it('accepts an official pair on update and trims only those fields', async () => {
    const { strapi, calls } = createStrapi();
    global.strapi = strapi;
    const data = {
      province: ' تهران ',
      city: ' ری ',
      postalCode: '2222222222',
      fullAddress: 'خیابان جدید',
    };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } });

    expect(data).toEqual({
      province: 'تهران',
      city: 'ری',
      postalCode: '2222222222',
      fullAddress: 'خیابان جدید',
    });
    expect(calls.some((call) => Array.isArray(call) && call[0] === 'address')).toBe(false);
  });

  it('rejects a free-text city on update', async () => {
    const { strapi } = createStrapi();
    global.strapi = strapi;
    const data = { province: 'مازندران', city: 'نوشهر', recipientPhone: '09120000000' };

    await expect(lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } })).rejects.toMatchObject({
      name: 'ValidationError',
      message: localities.INVALID_PAIR_MESSAGE,
    });
    expect(data).toEqual({ province: 'مازندران', city: 'نوشهر', recipientPhone: '09120000000' });
  });

  it('checks a partial city change against the stored province and does not write the province back', async () => {
    const { strapi, calls } = createStrapi();
    global.strapi = strapi;
    const data = { city: ' ساری ', postalCode: '3333333333' };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } });

    expect(data).toEqual({ city: 'ساری', postalCode: '3333333333' });
    expect(calls).toContainEqual(['address', { id: 7 }, ['province', 'city']]);
  });

  it('rejects a partial city change that does not belong to the stored province', async () => {
    const { strapi, addresses } = createStrapi();
    global.strapi = strapi;
    const data = { city: 'ری' };

    await expect(lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } })).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(data).toEqual({ city: 'ری' });
    expect(addresses[0].province).toBe('مازندران');
    expect(addresses[0].fullAddress).toBe('خیابان قدیم');
  });

  it('leaves an update of other address fields alone', async () => {
    global.strapi = {
      db: {
        query() {
          throw new Error('locality tables should not be read');
        },
      },
    };
    const data = { postalCode: '4444444444', fullAddress: 'فقط خیابان', recipientName: 'رضا' };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 7 } } });

    expect(data).toEqual({ postalCode: '4444444444', fullAddress: 'فقط خیابان', recipientName: 'رضا' });
  });
});

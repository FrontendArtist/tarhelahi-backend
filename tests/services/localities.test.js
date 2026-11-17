'use strict';

const localities = require('../../src/services/localities');

function compareFa(left, right) {
  return left.localeCompare(right, 'fa');
}

describe('localities', () => {
  it('returns an empty catalog when the tables have no provinces', async () => {
    const findMany = jest.fn(async () => []);
    const strapi = { db: { query: () => ({ findMany }) } };

    await expect(localities.listPublic(strapi)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      select: ['name'],
      populate: { cities: { select: ['documentId', 'name'] } },
    });
  });

  it('returns sorted names and our city id, without the carrier id', async () => {
    const findMany = jest.fn(async () => [
      {
        id: 8,
        externalId: 2,
        name: ' تهران ',
        cities: [
          { id: 3, documentId: 'city-rey', externalId: 100, name: 'ری' },
          { id: 4, documentId: 'city-tehran', externalId: 101, name: ' تهران ' },
          { id: 5, documentId: 'city-blank', externalId: 102, name: '   ' },
        ],
      },
      {
        id: 1,
        externalId: 9,
        name: 'آذربایجان شرقی',
        cities: [{ id: 9, documentId: 'city-tabriz', externalId: 200, name: 'تبریز' }],
      },
      { id: 4, externalId: 4, name: '   ', cities: [{ id: 1, documentId: 'city-x', externalId: 1, name: 'بی‌نام' }] },
    ]);
    const strapi = { db: { query: () => ({ findMany }) } };

    const result = await localities.listPublic(strapi);

    expect(result).toEqual([
      { name: 'آذربایجان شرقی', cities: [{ documentId: 'city-tabriz', name: 'تبریز' }] },
      {
        name: 'تهران',
        cities: [
          { documentId: 'city-tehran', name: 'تهران' },
          { documentId: 'city-rey', name: 'ری' },
        ],
      },
    ]);
    expect(result.map((row) => row.name)).toEqual([...result.map((row) => row.name)].sort(compareFa));
    expect(result[1].cities.map((city) => city.name)).toEqual(
      [...result[1].cities.map((city) => city.name)].sort(compareFa),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('externalId');
    expect(serialized).not.toContain('"id"');
  });

  it('accepts an official province/city pair and rejects every other combination', async () => {
    const provinces = [
      { id: 1, name: 'مازندران', externalId: 2 },
      { id: 2, name: 'تهران', externalId: 8 },
      { id: 3, name: 'تهران', externalId: 18 },
    ];
    const cities = [
      { id: 10, name: 'رامسر', provinceId: 1, externalId: 573 },
      { id: 11, name: 'ساری', provinceId: 1, externalId: 555 },
      { id: 12, name: 'ری', provinceId: 3, externalId: 301 },
    ];
    const strapi = {
      db: {
        query(uid) {
          if (uid === localities.PROVINCE_UID) {
            return {
              findMany: async ({ where, select } = {}) => {
                expect(select).toEqual(['id']);
                return provinces.filter((row) => row.name === where.name);
              },
            };
          }
          if (uid === localities.CITY_UID) {
            return {
              findOne: async ({ where, select } = {}) => {
                expect(select).toEqual(['id']);
                const ids = where.province.id.$in;
                return cities.find((row) => row.name === where.name && ids.includes(row.provinceId)) || null;
              },
            };
          }
          throw new Error(`unexpected uid ${uid}`);
        },
      },
    };

    await expect(localities.assertOfficialPair(strapi, '  مازندران  ', ' رامسر ')).resolves.toBeUndefined();
    await expect(localities.assertOfficialPair(strapi, 'تهران', 'ری')).resolves.toBeUndefined();
    await expect(localities.matchesOfficialPair(strapi, 'مازندران', 'تهران')).resolves.toBe(false);
    await expect(localities.assertOfficialPair(strapi, 'مازندران', 'تهران')).rejects.toMatchObject({
      name: 'ValidationError',
      message: localities.INVALID_PAIR_MESSAGE,
    });
    await expect(localities.assertOfficialPair(strapi, 'گیلان', 'رشت')).rejects.toMatchObject({
      name: 'ValidationError',
    });
    await expect(localities.matchesOfficialPair(strapi, '   ', 'رامسر')).resolves.toBe(false);
    await expect(localities.matchesOfficialPair(strapi, 2, 'رامسر')).resolves.toBe(false);
  });

  it('reads the carrier code from our city id and does not fall back to a name', async () => {
    const findOne = jest.fn(async ({ where }) => (
      where.documentId === 'city-ramsar' ? { externalId: 573 } : null
    ));
    const strapi = { db: { query: () => ({ findOne, findMany: async () => [{ externalId: 1 }] }) } };

    await expect(localities.carrierCityCode(strapi, { cityDocumentId: ' city-ramsar ' })).resolves.toBe(573);
    await expect(localities.carrierCityCode(strapi, {
      cityDocumentId: 'missing',
      province: 'مازندران',
      city: 'رامسر',
    })).resolves.toBeNull();
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('reads the carrier code from one exact name pair for an old address', async () => {
    const strapi = {
      db: {
        query(uid) {
          if (uid === localities.PROVINCE_UID) {
            return { findMany: async () => [{ id: 1 }] };
          }
          return {
            findMany: async () => [{ externalId: 573 }],
          };
        },
      },
    };

    await expect(localities.carrierCityCode(strapi, { province: ' مازندران ', city: ' رامسر ' })).resolves.toBe(573);
  });

  it('returns no carrier code when the exact name matches more than one row', async () => {
    const strapi = {
      db: {
        query(uid) {
          if (uid === localities.PROVINCE_UID) {
            return { findMany: async () => [{ id: 1 }, { id: 2 }] };
          }
          return { findMany: async () => [{ externalId: 10 }, { externalId: 11 }] };
        },
      },
    };

    await expect(localities.carrierCityCode(strapi, { province: 'تهران', city: 'تهران' })).resolves.toBeNull();
    await expect(localities.carrierCityCode(strapi, { province: ' ', city: 'رامسر' })).resolves.toBeNull();
  });
});

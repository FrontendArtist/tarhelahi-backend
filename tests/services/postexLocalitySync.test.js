'use strict';

const postexLocality = require('../../src/services/postexLocalitySync');

describe('postexLocalitySync', () => {
  it('upserts provinces and cities with externalId from cities/all payload', async () => {
    const provinces = new Map();
    const cities = new Map();
    let provinceSeq = 1;
    let citySeq = 1;

    const strapi = {
      db: {
        query: (uid) => ({
          findOne: jest.fn(async ({ where }) => {
            if (uid === postexLocality.PROVINCE_UID) {
              return [...provinces.values()].find((row) => row.externalId === where.externalId) || null;
            }
            return [...cities.values()].find((row) => row.externalId === where.externalId) || null;
          }),
          create: jest.fn(async ({ data }) => {
            if (uid === postexLocality.PROVINCE_UID) {
              const row = { id: provinceSeq++, ...data };
              provinces.set(row.id, row);
              return row;
            }
            const row = { id: citySeq++, ...data };
            cities.set(row.id, row);
            return row;
          }),
          update: jest.fn(async ({ where, data }) => {
            if (uid === postexLocality.PROVINCE_UID) {
              const row = { ...provinces.get(where.id), ...data };
              provinces.set(where.id, row);
              return row;
            }
            const row = { ...cities.get(where.id), ...data };
            cities.set(where.id, row);
            return row;
          }),
        }),
      },
    };

    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => [
        {
          id: 2,
          name: 'مازندران',
          cities: [
            { id: 573, name: 'رامسر' },
            { id: 555, name: 'ساری' },
          ],
        },
      ],
    }));

    const result = await postexLocality.syncFromPostex(strapi, {
      apiKey: 'test-key',
      fetchImpl,
    });

    expect(result).toEqual({ provinces: 1, cities: 2 });
    expect(provinces.size).toBe(1);
    expect(cities.get(1)).toMatchObject({ externalId: 573, name: 'رامسر' });
    expect(cities.get(2)).toMatchObject({ externalId: 555, name: 'ساری' });
    expect(fetchImpl).toHaveBeenCalled();
    const calledUrl = fetchImpl.mock.calls[0][0];
    expect(calledUrl).toContain('/api/v1/locality/cities/all');
  });

  it('creates ramsar city when missing', async () => {
    const created = [];
    const strapi = {
      db: {
        query: () => ({
          findOne: jest.fn(async () => null),
          create: jest.fn(async ({ data }) => {
            const row = { id: 1, ...data };
            created.push(row);
            return row;
          }),
        }),
      },
    };

    const city = await postexLocality.ensureRamsarCity(strapi);
    expect(city).toEqual({
      id: 1,
      externalId: postexLocality.RAMSAR_CITY_ID,
      name: postexLocality.RAMSAR_CITY_NAME,
    });
    expect(created).toHaveLength(1);
  });

  it('bootstraps full sync when provinces empty even if a city already exists', async () => {
    const provinces = new Map();
    const cities = new Map([
      [1, { id: 1, externalId: 573, name: 'رامسر' }],
    ]);
    let provinceSeq = 1;
    let citySeq = 2;

    const strapi = {
      db: {
        query: (uid) => ({
          count: jest.fn(async () => (
            uid === postexLocality.PROVINCE_UID ? provinces.size : cities.size
          )),
          findOne: jest.fn(async ({ where }) => {
            if (uid === postexLocality.PROVINCE_UID) {
              return [...provinces.values()].find((row) => row.externalId === where.externalId) || null;
            }
            return [...cities.values()].find((row) => row.externalId === where.externalId) || null;
          }),
          create: jest.fn(async ({ data }) => {
            if (uid === postexLocality.PROVINCE_UID) {
              const row = { id: provinceSeq++, ...data };
              provinces.set(row.id, row);
              return row;
            }
            const row = { id: citySeq++, ...data };
            cities.set(row.id, row);
            return row;
          }),
          update: jest.fn(async ({ where, data }) => {
            if (uid === postexLocality.PROVINCE_UID) {
              const row = { ...provinces.get(where.id), ...data };
              provinces.set(where.id, row);
              return row;
            }
            const row = { ...cities.get(where.id), ...data };
            cities.set(where.id, row);
            return row;
          }),
        }),
        connection: null,
      },
    };

    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => [
        {
          id: 2,
          name: 'مازندران',
          cities: [{ id: 573, name: 'رامسر' }, { id: 555, name: 'ساری' }],
        },
      ],
    }));

    await postexLocality.ensureLocalityBootstrap(strapi, {
      apiKey: 'test-key',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalled();
    expect(provinces.size).toBe(1);
    expect(cities.size).toBe(2);
  });
});



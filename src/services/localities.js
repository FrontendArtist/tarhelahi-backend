'use strict';

/**
 * Public province/city catalog and the address link to our city row.
 * Carrier ids stay on the city row and are read only when calling the carrier.
 */

const { errors } = require('@strapi/utils');

const PROVINCE_UID = 'api::province.province';
const CITY_UID = 'api::city.city';
const INVALID_PAIR_MESSAGE = 'استان و شهر باید دقیقاً مطابق فهرست رسمی باشند.';
const CITY_REQUIRED_MESSAGE = 'شهر باید از فهرست شهرها انتخاب شود.';

function compareFa(left, right) {
  return left.localeCompare(right, 'fa');
}

function trimmedName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function carrierCode(value) {
  const code = Number(value);
  if (!Number.isSafeInteger(code) || code < 1) return null;
  return code;
}

function cityRef(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return { id: value };
  }
  if (typeof value === 'string') {
    const documentId = value.trim();
    return documentId ? { documentId } : null;
  }
  if (!value || typeof value !== 'object') return null;
  if (typeof value.documentId === 'string' && value.documentId.trim()) {
    return { documentId: value.documentId.trim() };
  }
  if (typeof value.id === 'number' && Number.isInteger(value.id) && value.id > 0) {
    return { id: value.id };
  }
  if (typeof value.id === 'string' && value.id.trim() && !/^\d+$/.test(value.id.trim())) {
    return { documentId: value.id.trim() };
  }
  const nested = value.set ?? value.connect;
  if (Array.isArray(nested)) return nested.length === 1 ? cityRef(nested[0]) : null;
  if (nested != null) return cityRef(nested);
  return null;
}

async function listPublic(strapi) {
  const rows = await strapi.db.query(PROVINCE_UID).findMany({
    select: ['name'],
    populate: {
      cities: {
        select: ['documentId', 'name'],
      },
    },
  });

  return (Array.isArray(rows) ? rows : [])
    .map((province) => {
      const name = trimmedName(province?.name);
      if (!name) return null;
      const cities = (Array.isArray(province.cities) ? province.cities : [])
        .map((city) => {
          const cityName = trimmedName(city?.name);
          const documentId = trimmedName(city?.documentId);
          if (!cityName || !documentId) return null;
          return { documentId, name: cityName };
        })
        .filter(Boolean)
        .sort((left, right) => compareFa(left.name, right.name));
      return { name, cities };
    })
    .filter(Boolean)
    .sort((left, right) => compareFa(left.name, right.name));
}

async function loadLinkedCity(strapi, value) {
  const ref = cityRef(value);
  if (!ref) return null;

  const city = await strapi.db.query(CITY_UID).findOne({
    where: ref.documentId ? { documentId: ref.documentId } : { id: ref.id },
    select: ['id', 'documentId', 'name'],
    populate: { province: { select: ['name'] } },
  });
  const documentId = trimmedName(city?.documentId);
  const name = trimmedName(city?.name);
  const provinceName = trimmedName(city?.province?.name);
  if (!city?.id || !documentId || !name || !provinceName) return null;
  return { id: city.id, documentId, name, provinceName };
}

async function carrierCityCode(strapi, input = {}) {
  const documentId = trimmedName(input.cityDocumentId);
  if (documentId) {
    const city = await strapi.db.query(CITY_UID).findOne({
      where: { documentId },
      select: ['externalId'],
    });
    return carrierCode(city?.externalId);
  }

  const province = trimmedName(input.province);
  const cityName = trimmedName(input.city);
  if (!province || !cityName) return null;

  const provinces = await strapi.db.query(PROVINCE_UID).findMany({
    where: { name: province },
    select: ['id'],
  });
  const provinceIds = (Array.isArray(provinces) ? provinces : [])
    .map((row) => row?.id)
    .filter((id) => id != null);
  if (provinceIds.length === 0) return null;

  const cities = await strapi.db.query(CITY_UID).findMany({
    where: {
      name: cityName,
      province: { id: { $in: provinceIds } },
    },
    select: ['externalId'],
  });
  if (!Array.isArray(cities) || cities.length !== 1) return null;
  return carrierCode(cities[0]?.externalId);
}

async function matchesOfficialPair(strapi, provinceName, cityName) {
  const province = trimmedName(provinceName);
  const city = trimmedName(cityName);
  if (!province || !city) return false;

  const provinces = await strapi.db.query(PROVINCE_UID).findMany({
    where: { name: province },
    select: ['id'],
  });
  const provinceIds = (Array.isArray(provinces) ? provinces : [])
    .map((row) => row?.id)
    .filter((id) => id != null);
  if (provinceIds.length === 0) return false;

  const match = await strapi.db.query(CITY_UID).findOne({
    where: {
      name: city,
      province: { id: { $in: provinceIds } },
    },
    select: ['id'],
  });
  return Boolean(match);
}

async function assertOfficialPair(strapi, provinceName, cityName) {
  const matches = await matchesOfficialPair(strapi, provinceName, cityName);
  if (!matches) {
    throw new errors.ValidationError(INVALID_PAIR_MESSAGE);
  }
}

module.exports = {
  PROVINCE_UID,
  CITY_UID,
  INVALID_PAIR_MESSAGE,
  CITY_REQUIRED_MESSAGE,
  listPublic,
  loadLinkedCity,
  carrierCityCode,
  matchesOfficialPair,
  assertOfficialPair,
};

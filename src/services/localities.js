'use strict';

/**
 * Public province/city catalog and exact name-pair checks for buyer addresses.
 * Output and checks use names only; carrier ids are not part of this module's result.
 */

const { errors } = require('@strapi/utils');

const PROVINCE_UID = 'api::province.province';
const CITY_UID = 'api::city.city';
const INVALID_PAIR_MESSAGE = 'استان و شهر باید دقیقاً مطابق فهرست رسمی باشند.';

function compareFa(left, right) {
  return left.localeCompare(right, 'fa');
}

function trimmedName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function listPublic(strapi) {
  const rows = await strapi.db.query(PROVINCE_UID).findMany({
    select: ['name'],
    populate: {
      cities: {
        select: ['name'],
      },
    },
  });

  return (Array.isArray(rows) ? rows : [])
    .map((province) => {
      const name = trimmedName(province?.name);
      if (!name) return null;
      const cities = (Array.isArray(province.cities) ? province.cities : [])
        .map((city) => trimmedName(city?.name))
        .filter((cityName) => cityName.length > 0)
        .sort(compareFa);
      return { name, cities };
    })
    .filter(Boolean)
    .sort((left, right) => compareFa(left.name, right.name));
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
  listPublic,
  matchesOfficialPair,
  assertOfficialPair,
};

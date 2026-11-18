'use strict';

const { errors } = require('@strapi/utils');
const localities = require('../../../../services/localities');
const fullAddressRule = require('../../../../services/fullAddressRule');

function has(data, key) {
  return Object.prototype.hasOwnProperty.call(data, key);
}

async function applyCityLink(data) {
  const city = await localities.loadLinkedCity(strapi, data.cityLink);
  if (!city) {
    throw new errors.ValidationError(localities.CITY_REQUIRED_MESSAGE);
  }
  data.cityLink = city.id;
  data.province = city.provinceName;
  data.city = city.name;
}

module.exports = {
  async beforeCreate(event) {
    const data = event?.params?.data;
    if (!data || typeof data !== 'object') {
      throw new errors.ValidationError(localities.CITY_REQUIRED_MESSAGE);
    }
    await applyCityLink(data);
    data.fullAddress = fullAddressRule.assertFullAddress(data.fullAddress);
  },

  async beforeUpdate(event) {
    const data = event?.params?.data;
    if (!data || typeof data !== 'object') return;

    if (has(data, 'fullAddress')) {
      data.fullAddress = fullAddressRule.assertFullAddress(data.fullAddress);
    }

    const touchesLink = has(data, 'cityLink');
    const touchesNames = has(data, 'province') || has(data, 'city');
    if (!touchesLink && !touchesNames) return;
    if (!touchesLink) {
      throw new errors.ValidationError(localities.CITY_REQUIRED_MESSAGE);
    }
    await applyCityLink(data);
  },
};

'use strict';

const localities = require('../../../../services/localities');

const ADDRESS_UID = 'api::address.address';

function has(data, key) {
  return Object.prototype.hasOwnProperty.call(data, key);
}

module.exports = {
  async beforeCreate(event) {
    const data = event?.params?.data;
    if (!data || typeof data !== 'object') {
      await localities.assertOfficialPair(strapi, '', '');
      return;
    }
    if (typeof data.province === 'string') data.province = data.province.trim();
    if (typeof data.city === 'string') data.city = data.city.trim();
    await localities.assertOfficialPair(strapi, data.province, data.city);
  },

  async beforeUpdate(event) {
    const data = event?.params?.data;
    if (!data || typeof data !== 'object') return;

    const touchesProvince = has(data, 'province');
    const touchesCity = has(data, 'city');
    if (!touchesProvince && !touchesCity) return;

    if (touchesProvince && typeof data.province === 'string') data.province = data.province.trim();
    if (touchesCity && typeof data.city === 'string') data.city = data.city.trim();

    let provinceName = touchesProvince ? data.province : undefined;
    let cityName = touchesCity ? data.city : undefined;
    if (!touchesProvince || !touchesCity) {
      const existing = await strapi.db.query(ADDRESS_UID).findOne({
        where: event.params.where,
        select: ['province', 'city'],
      });
      if (!touchesProvince) provinceName = existing?.province;
      if (!touchesCity) cityName = existing?.city;
    }

    await localities.assertOfficialPair(strapi, provinceName, cityName);
  },
};

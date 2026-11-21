'use strict';

const { errors } = require('@strapi/utils');
const shippingOrigins = require('../../../../services/shippingOrigins');

const EMPTY_ORIGIN_MESSAGE = 'مبدأ ارسال کالا نمی‌تواند خالی باشد.';
const MISSING_DEFAULT_MESSAGE = 'مبدأ پیش‌فرض رامسر پیدا نشد.';

function asList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function hasRelationTarget(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.some(hasRelationTarget);
  if (typeof value !== 'object') return false;
  if (value.id || value.documentId) return true;
  if (Object.prototype.hasOwnProperty.call(value, 'set')) {
    return value.set != null && asList(value.set).some(hasRelationTarget);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'connect')) {
    return asList(value.connect).some(hasRelationTarget);
  }
  return false;
}

// فرم ادمین رابطهٔ دست‌نخورده را با connect/disconnect خالی می‌فرستد؛ این پاک‌کردن نیست.
function isUntouchedRelationDiff(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'set') || value.id || value.documentId) return false;
  const hasConnect = Object.prototype.hasOwnProperty.call(value, 'connect');
  const hasDisconnect = Object.prototype.hasOwnProperty.call(value, 'disconnect');
  if (!hasConnect && !hasDisconnect) return false;
  const connect = hasConnect ? asList(value.connect) : [];
  const disconnect = hasDisconnect ? asList(value.disconnect) : [];
  return !connect.some(hasRelationTarget) && !disconnect.some(hasRelationTarget);
}

async function defaultOriginId() {
  const row = await strapi.db.query(shippingOrigins.UID).findOne({
    where: { originId: shippingOrigins.DEFAULT_ORIGIN_ID },
    select: ['id'],
  });
  return row?.id ?? null;
}

module.exports = {
  EMPTY_ORIGIN_MESSAGE,
  MISSING_DEFAULT_MESSAGE,
  hasRelationTarget,
  isUntouchedRelationDiff,
  async beforeCreate(event) {
    const data = event?.params?.data;
    if (!data || typeof data !== 'object') {
      throw new errors.ValidationError(EMPTY_ORIGIN_MESSAGE);
    }
    if (hasRelationTarget(data.shippingOrigin)) return;

    const id = await defaultOriginId();
    if (!id) {
      throw new errors.ValidationError(MISSING_DEFAULT_MESSAGE);
    }
    data.shippingOrigin = { set: [{ id }] };
  },
  async beforeUpdate(event) {
    const data = event?.params?.data;
    if (!data || typeof data !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(data, 'shippingOrigin')) return;
    if (isUntouchedRelationDiff(data.shippingOrigin)) return;
    if (!hasRelationTarget(data.shippingOrigin)) {
      throw new errors.ValidationError(EMPTY_ORIGIN_MESSAGE);
    }
  },
};

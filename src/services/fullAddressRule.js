'use strict';

const { errors } = require('@strapi/utils');

/** کوتاه‌تر از این را پستکس به‌عنوان نشانی مقصد نمی‌پذیرد. */
const MIN_FULL_ADDRESS_LENGTH = 10;
const SHORT_FULL_ADDRESS_MESSAGE = 'نشانی باید حداقل ۱۰ نویسه باشد (خیابان، کوچه و پلاک).';

function isFullAddressLongEnough(value) {
  return typeof value === 'string' && value.trim().length >= MIN_FULL_ADDRESS_LENGTH;
}

function assertFullAddress(value) {
  if (!isFullAddressLongEnough(value)) {
    throw new errors.ValidationError(SHORT_FULL_ADDRESS_MESSAGE);
  }
  return value.trim();
}

module.exports = {
  MIN_FULL_ADDRESS_LENGTH,
  SHORT_FULL_ADDRESS_MESSAGE,
  isFullAddressLongEnough,
  assertFullAddress,
};

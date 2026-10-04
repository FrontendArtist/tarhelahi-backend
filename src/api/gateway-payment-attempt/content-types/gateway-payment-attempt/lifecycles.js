'use strict';

const ATTEMPT = 'api::gateway-payment-attempt.gateway-payment-attempt';
// طبق سند SEP نسخهٔ ۳٫۶، اعتبار توکن بدون TokenExpiryInMin برابر ۲۰ دقیقه است.
const SEP_DEFAULT_TOKEN_EXPIRY_MINUTES = 20;

function stampToken(data) {
  const issuedAt = new Date();
  data.tokenIssuedAtUtc = issuedAt.toISOString();
  data.tokenExpiresAtUtc = new Date(issuedAt.getTime() + SEP_DEFAULT_TOKEN_EXPIRY_MINUTES * 60_000).toISOString();
}

module.exports = {
  beforeCreate(event) {
    const data = event.params.data || {};
    delete data.tokenIssuedAtUtc;
    delete data.tokenExpiresAtUtc;
    if (data.status === 'token_issued') stampToken(data);
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    if (!data) return;
    delete data.tokenIssuedAtUtc;
    delete data.tokenExpiresAtUtc;
    if (data.status !== 'token_issued') return;

    const existing = await strapi.db.query(ATTEMPT).findOne({ where });
    if (existing?.status === 'created') stampToken(data);
  },

  beforeUpdateMany(event) {
    const data = event.params.data || {};
    delete data.tokenIssuedAtUtc;
    delete data.tokenExpiresAtUtc;
    if (data.status === 'token_issued')
      throw new Error('صدور گروهی توکن پرداخت پشتیبانی نمی‌شود.');
  },
};

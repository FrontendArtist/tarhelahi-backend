'use strict';

module.exports = {
  routes: [{
    method: 'POST',
    path: '/gateway-payment-attempts/claim',
    handler: 'gateway-payment-attempt.claim',
    config: { auth: { scope: ['api::gateway-payment-attempt.gateway-payment-attempt.update'] } },
  }, {
    method: 'POST',
    path: '/gateway-payment-attempts/outcomes',
    handler: 'gateway-payment-attempt.recordOutcome',
    config: { auth: { scope: ['api::gateway-payment-attempt.gateway-payment-attempt.update'] } },
  }, {
    method: 'POST',
    path: '/gateway-payment-attempts/outcomes/delivered',
    handler: 'gateway-payment-attempt.markOutcomeDelivered',
    config: { auth: { scope: ['api::gateway-payment-attempt.gateway-payment-attempt.update'] } },
  }],
};

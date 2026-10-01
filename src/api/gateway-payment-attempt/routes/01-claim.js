'use strict';

module.exports = {
  routes: [{
    method: 'POST',
    path: '/gateway-payment-attempts/claim',
    handler: 'gateway-payment-attempt.claim',
    config: { auth: { scope: ['api::gateway-payment-attempt.gateway-payment-attempt.update'] } },
  }],
};

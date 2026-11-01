'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/byemoney-carts/:cartId/address',
      handler: 'byemoney-cart.address',
      // scope خالی مانع افزودن خودکار scope نقش می‌شود؛ کنترلر ادمین‌بودن را الزام می‌کند.
      config: { auth: { scope: [] } },
    },
  ],
};

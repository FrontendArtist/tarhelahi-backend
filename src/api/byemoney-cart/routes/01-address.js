'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/byemoney-carts/:cartId/address',
      handler: 'byemoney-cart.address',
      // توکن custom باید دقیقاً همین action را داشته باشد؛ full-access هم عبور می‌کند.
      // توکن read-only فقط find/findOne دارد و این مسیر را نمی‌گیرد. ادمین‌بودن کاربر در کنترلر الزام می‌شود.
      config: { auth: { scope: ['api::byemoney-cart.byemoney-cart.address'] } },
    },
  ],
};

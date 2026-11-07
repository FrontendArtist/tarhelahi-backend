'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/auth/token/refresh',
      handler: 'auth-token.refresh',
      // فقط توکن API سرور Next (BND-08). JWT کاربر این مسیر را نمی‌گیرد، پس توکن دزدیده‌شده از مرورگر قابل تمدید نیست.
      // توکن custom باید دقیقاً همین action را داشته باشد؛ full-access هم عبور می‌کند.
      config: { auth: { strategies: ['api-token'], scope: ['api::auth-token.auth-token.refresh'] } },
    },
  ],
};

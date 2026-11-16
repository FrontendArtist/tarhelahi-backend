'use strict';

/**
 * همگام‌سازی فهرست استان/شهر از حامل فعلی؛ فقط کاربر لاگین‌شده.
 * کلید حامل در پاسخ برنمی‌گردد.
 */
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/cities/sync-localities',
      handler: 'city.syncLocalities',
      config: {
        policies: ['global::is-authenticated-user'],
      },
    },
  ],
};

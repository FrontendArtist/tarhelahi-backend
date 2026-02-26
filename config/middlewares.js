// path: ./config/middlewares.js
module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  // --- اصلاح بخش سشن ---
  {
    name: 'strapi::session',
    config: {
      proxy: true, // این خط کلید حل معما در Strapi 5 است!
      cookie: {
        secure: true, // چون لیارا HTTPS است
        sameSite: 'lax',
        httpOnly: true,
      },
    },
  },
  // ----------------------
  'strapi::favicon',
  'strapi::public',
];
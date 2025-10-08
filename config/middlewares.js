// path: ./config/middlewares.js

module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      enabled: true,
      headers: '*',
      // IMPORTANT: Add your Vercel frontend URL here
      origin: [
        'http://localhost:3000', // Your local frontend
        'http://localhost:1337', // Your local Strapi
        'https://tarhelahi.vercel.app', // <-- ⚠️ **اینجا را با آدرس Vercel خود جایگزین کن**
          'https://www.tarhelahi.vercel.app' // <-- ⚠️ اگر دامنه شخصی داری، اینجا اضافه کن
      ],
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
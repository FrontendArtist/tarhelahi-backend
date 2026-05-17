// path: ./config/middlewares.js

module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',

  {
    name: 'strapi::cors',
    config: {
      origin: [
        'http://localhost:3000',
        'http://localhost:1337',
        'https://tarhelahi.vercel.app',
        'https://www.tarhelahi.vercel.app'
      ],
      headers: '*',
    },
  },

  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

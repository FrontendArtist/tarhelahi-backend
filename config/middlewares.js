// path: ./config/middlewares.js
module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  // بخش سشن را به این صورت اصلاح کن:
  {
    name: 'strapi::session',
    config: {
      cookie: {
        secure: env('NODE_ENV') === 'production', // در پروداکشن حتما true باشد
        sameSite: 'lax',
        httpOnly: true,
      },
    },
  },
  'strapi::favicon',
  'strapi::public',
];
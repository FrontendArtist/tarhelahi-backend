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
      origin: [
        'http://localhost:3000', 
        'http://localhost:1337',
        // آدرس‌های جدید لیارا (فرانت و بک)
        'https://tarhelahi-nodejs.liara.run', 
        'https://tarhelahi.liara.run' // <-- این احتمالا آدرس فرانت‌اِند آینده توست
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
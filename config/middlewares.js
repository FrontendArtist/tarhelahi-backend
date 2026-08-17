// path: backend/config/middlewares.js

module.exports = ({ env }) => {
  const isProduction = env('NODE_ENV') === 'production';

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': [
              "'self'",
              'data:',
              'blob:',
              'https:',
              'dl.tarhelahi.ir',
              '*.tarhelahi.ir',
              'storage.c2.liara.site',
              `${env('LIARA_BUCKET')}.storage.c2.liara.site`,
            ],
            'media-src': [
              "'self'",
              'data:',
              'blob:',
              'https:',
              'dl.tarhelahi.ir',
              '*.tarhelahi.ir',
              'storage.c2.liara.site',
              `${env('LIARA_BUCKET')}.storage.c2.liara.site`,
            ],
            'frame-ancestors': ["'self'"],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    'strapi::cors',
    'strapi::poweredBy',
    'strapi::query',
    'strapi::body',
    'strapi::favicon',
    'strapi::public',
    {
      name: 'strapi::session',
      config: {
        proxy: true,
        rolling: false,
        cookie: {
          secure: isProduction,
          httpOnly: true,
          sameSite: 'lax',
        },
      },
    },
  ];
};
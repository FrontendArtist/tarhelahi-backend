// path: backend/config/middlewares.js

module.exports = ({ env }) => {
  const isProduction = env('NODE_ENV') === 'production';
  const bucketName = env('LIARA_BUCKET', 'tarhelahicloud');
  const customCorsOrigins = env('CORS_ORIGINS')
    ? env('CORS_ORIGINS').split(',').map((item) => item.trim()).filter(Boolean)
    : [];

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:', 'http:', 'ws:', 'wss:'],
            'img-src': [
              "'self'",
              'data:',
              'blob:',
              'https:',
              'http:',
              'dl.tarhelahi.ir',
              'api.tarhelahi.ir',
              'tarhelahi.ir',
              '*.tarhelahi.ir',
              'storage.c2.liara.site',
              `${bucketName}.storage.c2.liara.site`,
            ],
            'media-src': [
              "'self'",
              'data:',
              'blob:',
              'https:',
              'http:',
              'dl.tarhelahi.ir',
              'api.tarhelahi.ir',
              'tarhelahi.ir',
              '*.tarhelahi.ir',
              'storage.c2.liara.site',
              `${bucketName}.storage.c2.liara.site`,
            ],
            'frame-ancestors': ["'self'"],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: 'strapi::cors',
      config: {
        origin: [
          'http://localhost:3000',
          'http://localhost:1337',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:1337',
          'https://tarhelahi.ir',
          'https://www.tarhelahi.ir',
          'https://api.tarhelahi.ir',
          'https://tarhelahi.vercel.app',
          'https://www.tarhelahi.vercel.app',
          ...customCorsOrigins,
        ],
        headers: '*',
      },
    },
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
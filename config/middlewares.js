// path: backend/config/middlewares.js

const PROD_DEFAULT_ORIGINS = [
  'https://tarhelahi.ir',
  'https://www.tarhelahi.ir',
  'https://api.tarhelahi.ir',
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:1337',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:1337',
  'https://tarhelahi.vercel.app',
  'https://www.tarhelahi.vercel.app',
];

module.exports = ({ env }) => {
  const isProduction = env('NODE_ENV') === 'production';
  const bucketName = env('LIARA_BUCKET', 'tarhelahicloud');
  const customCorsOrigins = env('CORS_ORIGINS')
    ? env('CORS_ORIGINS')
        .split(',')
        .map((item) => item.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : [];

  const corsOrigins = isProduction
    ? customCorsOrigins.length > 0
      ? customCorsOrigins
      : PROD_DEFAULT_ORIGINS
    : [...new Set([...DEV_ORIGINS, ...PROD_DEFAULT_ORIGINS, ...customCorsOrigins])];

  const connectSrc = isProduction
    ? ["'self'", 'https:', 'wss:']
    : ["'self'", 'https:', 'http:', 'ws:', 'wss:'];

  const mediaImgProtocols = isProduction
    ? ["'self'", 'data:', 'blob:', 'https:']
    : ["'self'", 'data:', 'blob:', 'https:', 'http:'];

  const trustedMediaHosts = [
    'dl.tarhelahi.ir',
    'api.tarhelahi.ir',
    'tarhelahi.ir',
    '*.tarhelahi.ir',
    'storage.c2.liara.site',
    `${bucketName}.storage.c2.liara.site`,
  ];

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': connectSrc,
            'img-src': [...mediaImgProtocols, ...trustedMediaHosts],
            'media-src': [...mediaImgProtocols, ...trustedMediaHosts],
            'frame-ancestors': ["'self'"],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: 'strapi::cors',
      config: {
        origin: corsOrigins,
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

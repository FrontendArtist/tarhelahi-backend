// path: ./config/middlewares.js
module.exports = ({ env }) => {
  const isProduction = env('NODE_ENV') === 'production';

  return [
    'strapi::logger',
    'strapi::errors',

    // Security / CSP — relaxed connect-src so Admin login XHR isn't blocked
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': ["'self'", 'data:', 'blob:', 'https:'],
            'media-src': ["'self'", 'data:', 'blob:'],
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

    // Session — Koa-level app.proxy is set via src/index.js register(),
    // so ctx.secure resolves correctly from X-Forwarded-Proto: https.
    // proxy: true here is belt-and-suspenders for the session middleware itself.
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
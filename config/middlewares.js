// path: ./config/middlewares.js
module.exports = ({ env }) => {
  const isProduction = env('NODE_ENV') === 'production';

  return [
    'strapi::logger',
    'strapi::errors',

    // ─── Security / CSP ────────────────────────────────────────────────────
    // contentSecurityPolicy is configured to allow the Admin UI assets and
    // connections. Without relaxing connect-src and frame-ancestors the
    // browser can block the Admin login XHR even though the server responds.
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

    // ─── Session ───────────────────────────────────────────────────────────
    // proxy: true  → the session middleware will read X-Forwarded-Proto to
    //                determine whether the connection is secure.
    // secure cookie → only sent over HTTPS, but because proxy: true is set
    //                 above, Koa correctly resolves ctx.secure = true when
    //                 X-Forwarded-Proto: https is present.
    {
      name: 'strapi::session',
      config: {
        proxy: true,
        rolling: false,
        cookie: {
          secure: isProduction, // true in production, false in local dev
          httpOnly: true,
          sameSite: 'lax',
          // maxAge: 86400000, // 1 day in ms (optional)
        },
      },
    },
  ];
};
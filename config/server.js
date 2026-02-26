// path: ./config/server.js

module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('STRAPI_ADMIN_BACKEND_URL', 'https://tarhelahi-nodejs.liara.run'),
  proxy: true,
  app: {
    keys: env.array('APP_KEYS'),
  },

  admin: {
    auth: {
      secret: env('ADMIN_JWT_SECRET'),
    },

    options: {
      isSSO: false,
    },
  },
});
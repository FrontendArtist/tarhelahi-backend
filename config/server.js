// path: ./config/server.js
module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'https://tarhelahi-nodejs.liara.run'),

  // Tells Strapi it's behind a reverse proxy (used for URL generation etc.)
  // The actual Koa-level app.proxy = true is set in src/index.js register().
  proxy: true,

  app: {
    keys: env.array('APP_KEYS'),
  },
});
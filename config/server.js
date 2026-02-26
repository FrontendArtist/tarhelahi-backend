// path: ./config/server.js
module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'https://tarhelahi-nodejs.liara.run'),

  // Tell Strapi that it is running behind a trusted reverse proxy.
  // This enables reading X-Forwarded-* headers (Proto, For, Host).
  proxy: true,

  app: {
    keys: env.array('APP_KEYS'),
  },

  // ─── Koa-level proxy trust ────────────────────────────────────────────────
  // Strapi v5 exposes the underlying Koa app configuration here.
  // Setting app.proxy = true at this level makes Koa itself recognize
  // X-Forwarded-Proto: https and mark ctx.secure = true, which is what
  // the session middleware checks before setting a Secure cookie.
  // Without this block the session middleware sees an insecure connection
  // even though proxy: true is set in the session config.
  koa: {
    proxy: true,
  },
});
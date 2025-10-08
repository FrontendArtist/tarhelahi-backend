// path: ./config/server.js

module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // highlight-start
  url: env('PUBLIC_URL', 'https://tarhelahi.vercel.app'), // ⚠️ این خط مهم است
  // highlight-end
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});
// path: ./config/server.js

module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),

  url: env('PUBLIC_URL', 'https://tarhelahi.vercel.app'),

  app: {
    keys: env.array('APP_KEYS', [
      'key1_super_secret_123456',
      'key2_super_secret_987654'
    ]),
  },

  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});

// path: backend/config/server.js
const cronTasks = require('./cron-tasks');

module.exports = ({ env }) => {
  const isProduction = env('NODE_ENV') === 'production';

  return {
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
    url: env('PUBLIC_URL', 'http://localhost:1337'),
    proxy: env.bool('IS_PROXIED', true),
    app: {
      keys: isProduction
        ? env.array('APP_KEYS')
        : env.array('APP_KEYS', [
            'key1_super_secret_123456',
            'key2_super_secret_987654',
          ]),
    },
    webhooks: {
      populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
    },
    cron: {
      enabled: true,
      tasks: cronTasks,
    },
  };
};

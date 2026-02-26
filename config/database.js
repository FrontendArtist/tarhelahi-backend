// path: backend/config/database.js

module.exports = ({ env }) => ({
  connection: {
    client: 'postgres',
    connection: {
      // Strapi v5 با استفاده از connectionString مستقیم به URI وصل می‌شود
      connectionString: env('DATABASE_URL'),
      ssl: false, // چون شبکه عمومی لیارا فعلاً بدون گواهی مستقیم است
    },
    debug: false,
  },
});
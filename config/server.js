// path: ./config/server.js

module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('STRAPI_ADMIN_BACKEND_URL', 'https://tarhelahi-nodejs.liara.run'),
  // این خط حیاتی است: به استراپی می‌گوید که پشت پروکسی لیارا است
  proxy: env.bool('IS_PROXIED', true), 
  app: {
    keys: env.array('APP_KEYS'),
  },
  admin: {
    auth: {
      events: {
        onConnectionError(e) {
          console.error(e);
        },
      },
    },
    // تنظیمات کوکی برای محیط پروداکشن
    forgotPassword: {
      from: 'no-reply@tarhelahi.ir',
      replyTo: 'support@tarhelahi.ir',
    },
  },
});
module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  // اضافه کردن این بخش برای حل مشکل Session در لیارا
  forgotPassword: {
    from: 'no-reply@tarhelahi.ir',
    replyTo: 'support@tarhelahi.ir',
  },
  options: {
    // اطمینان از اینکه استراپی کوکی‌ها را در حالت امن مدیریت می‌کند
    isSSO: false,
  },
});
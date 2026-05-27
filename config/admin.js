module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
    sessions: {
      // تعداد ثانیه: 7 روز * 24 ساعت * 60 دقیقه * 60 ثانیه
      maxRefreshTokenLifespan: 604800, 
      // تعداد ثانیه: 30 روز * 24 ساعت * 60 دقیقه * 60 ثانیه
      maxSessionLifespan: 2592000,      
    },
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
});
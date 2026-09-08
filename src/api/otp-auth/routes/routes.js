// F:\tarhelahi\backend\src\api\otp-auth\routes\routes.js

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/auth/otp/send',
      handler: 'otp-auth.send',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/otp/verify',
      handler: 'otp-auth.verify',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/check-phone',
      handler: 'otp-auth.checkPhone',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/password/login',
      handler: 'otp-auth.passwordLogin',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/password/register',
      handler: 'otp-auth.passwordRegister',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
// F:\tarhelahi\backend\src\api\otp-auth\routes\routes.js

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/auth/otp/send',
      handler: 'otp-auth.send',
      config: {
        auth: false,
        policies: [],
        middlewares: [
          {
            name: 'global::rate-limit',
            config: {
              keyPrefix: 'otp-send',
              windowMs: FIFTEEN_MINUTES_MS,
              max: 15,
              phoneMax: 5,
            },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/auth/otp/verify',
      handler: 'otp-auth.verify',
      config: {
        auth: false,
        policies: [],
        middlewares: [
          {
            name: 'global::rate-limit',
            config: {
              keyPrefix: 'otp-verify',
              windowMs: FIFTEEN_MINUTES_MS,
              max: 20,
              phoneMax: 10,
            },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/auth/check-phone',
      handler: 'otp-auth.checkPhone',
      config: {
        auth: false,
        policies: [],
        middlewares: [
          {
            name: 'global::rate-limit',
            config: {
              keyPrefix: 'check-phone',
              windowMs: FIFTEEN_MINUTES_MS,
              max: 30,
            },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/auth/password/login',
      handler: 'otp-auth.passwordLogin',
      config: {
        auth: false,
        policies: [],
        middlewares: [
          {
            name: 'global::rate-limit',
            config: {
              keyPrefix: 'pwd-login',
              windowMs: FIFTEEN_MINUTES_MS,
              max: 20,
              phoneMax: 10,
            },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/auth/password/register',
      handler: 'otp-auth.passwordRegister',
      config: {
        auth: false,
        policies: [],
        middlewares: [
          {
            name: 'global::rate-limit',
            config: {
              keyPrefix: 'pwd-register',
              windowMs: FIFTEEN_MINUTES_MS,
              max: 10,
              phoneMax: 5,
            },
          },
        ],
      },
    },
  ],
};

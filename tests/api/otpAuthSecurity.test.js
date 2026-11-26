'use strict';

const phoneUtils = require('../../src/utils/phoneUtils');
const smsService = require('../../src/services/smsService');
const otpController = require('../../src/api/otp-auth/controllers/otp-auth');

describe('OTP Auth, PhoneUtils, SMS Service Security (M3, M4, M5, M11)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('M3: isTestPhoneNumber is disabled in production and restricted to OTP_TEST_PHONES in dev', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTP_TEST_PHONES = '09121112233';
    expect(phoneUtils.isTestPhoneNumber('T09121112233')).toBe(true);
    expect(phoneUtils.isTestPhoneNumber('T09129998877')).toBe(false);

    process.env.NODE_ENV = 'production';
    expect(phoneUtils.isTestPhoneNumber('T09121112233')).toBe(false);
    expect(phoneUtils.isIranianPhoneNumber('T09121112233')).toBe(false);
  });

  test('M11: smsService throws in production when SMSIR_API_KEY is missing (no silent mock)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SMSIR_API_KEY;

    await expect(smsService.sendOtp('09121112233', '123456')).rejects.toThrow(/production/i);
    await expect(smsService.sendDirectSms('09121112233', 'hello')).rejects.toThrow(/production/i);
  });

  test('M3 + M5: send stores HMAC-hashed OTP, enforces cooldown, verify invalidates after 5 failures and blocks blocked users', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SMSIR_API_KEY;
    process.env.JWT_SECRET = 'test-jwt-secret';

    let userRecord = null;
    const mockStrapi = {
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      db: {
        query: jest.fn((uid) => {
          if (uid === 'plugin::users-permissions.role') {
            return { findOne: jest.fn(async () => ({ id: 1, type: 'authenticated' })) };
          }
          if (uid === 'plugin::users-permissions.user') {
            return {
              findOne: jest.fn(async () => userRecord),
              create: jest.fn(async ({ data }) => {
                userRecord = { id: 10, documentId: 'u-10', role: { id: 1, type: 'authenticated' }, ...data };
                return userRecord;
              }),
              update: jest.fn(async ({ data }) => {
                userRecord = { ...userRecord, ...data };
                return userRecord;
              }),
            };
          }
          return {};
        }),
      },
      plugins: {
        'users-permissions': {
          services: { jwt: { issue: jest.fn(() => 'signed-jwt-token') } },
        },
      },
    };
    global.strapi = mockStrapi;

    // 1. Send OTP
    const sendCtx = {
      request: { body: { phoneNumber: '09123456789' } },
      send: jest.fn((body) => body),
      forbidden: jest.fn(),
    };
    await otpController.send(sendCtx);
    expect(userRecord.otpCode).toMatch(/^hmac:[a-f0-9]{64}$/);
    expect(userRecord.otpAttempts).toBe(0);

    // 2. Resend immediately -> 429 cooldown
    const resendCtx = {
      request: { body: { phoneNumber: '09123456789' } },
      send: jest.fn((body) => body),
      forbidden: jest.fn(),
      status: 200,
    };
    await otpController.send(resendCtx);
    expect(resendCtx.status).toBe(429);

    // 3. Five wrong verify attempts invalidate the OTP
    for (let i = 1; i <= 5; i++) {
      const badVerifyCtx = {
        request: { body: { phoneNumber: '09123456789', otpCode: '000000' } },
        send: jest.fn(),
        forbidden: jest.fn(),
      };
      await expect(otpController.verify(badVerifyCtx)).rejects.toThrow();
    }
    expect(userRecord.otpCode).toBeNull();
    expect(userRecord.otpExpiresAt).toBeNull();
    expect(userRecord.otpAttempts).toBe(5);

    // 4. Blocked user is rejected on verify (M5) and send
    userRecord.blocked = true;
    const blockedVerifyCtx = {
      request: { body: { phoneNumber: '09123456789', otpCode: '123456' } },
      send: jest.fn(),
      forbidden: jest.fn((msg) => ({ status: 403, msg })),
    };
    await otpController.verify(blockedVerifyCtx);
    expect(blockedVerifyCtx.forbidden).toHaveBeenCalledTimes(1);

    const blockedSendCtx = {
      request: { body: { phoneNumber: '09123456789' } },
      send: jest.fn(),
      forbidden: jest.fn((msg) => ({ status: 403, msg })),
    };
    await otpController.send(blockedSendCtx);
    expect(blockedSendCtx.forbidden).toHaveBeenCalledTimes(1);
  });

  test('M4: passwordRegister rejects Iranian numbers without OTP and sets isMobileVerified=false for foreign numbers', async () => {
    process.env.NODE_ENV = 'development';
    let userRecord = null;
    const mockAdd = jest.fn(async (data) => ({ id: 55, documentId: 'u-55', ...data }));

    global.strapi = {
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      db: {
        query: jest.fn((uid) => {
          if (uid === 'plugin::users-permissions.role') {
            return { findOne: jest.fn(async () => ({ id: 1, type: 'authenticated' })) };
          }
          if (uid === 'plugin::users-permissions.user') {
            return {
              findOne: jest.fn(async () => userRecord),
            };
          }
          return {};
        }),
      },
      plugin: jest.fn(() => ({
        service: jest.fn(() => ({ add: mockAdd, edit: jest.fn() })),
      })),
      plugins: {
        'users-permissions': {
          services: { jwt: { issue: jest.fn(() => 'foreign-jwt') } },
        },
      },
    };

    const iranCtx = {
      request: { body: { phoneNumber: '09123456789', password: 'Password123!' } },
      send: jest.fn(),
    };
    await expect(otpController.passwordRegister(iranCtx)).rejects.toThrow(/OTP/i);

    const foreignCtx = {
      request: { body: { phoneNumber: '+14155552671', password: 'Password123!' } },
      send: jest.fn((body) => body),
    };
    const res = await otpController.passwordRegister(foreignCtx);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        isMobileVerified: false,
        is_foreigner: true,
      })
    );
    expect(res.jwt).toBe('foreign-jwt');
  });
});

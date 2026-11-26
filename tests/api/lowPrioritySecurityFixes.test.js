'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const uploadPath = require('../../src/utils/uploadPath');
const middlewaresConfig = require('../../config/middlewares');

const mockValidateAndCalculate = jest.fn();
const mockConsumeCoupon = jest.fn();
const mockStrapiLogError = jest.fn();

jest.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: (_uid, customizer) =>
      customizer({
        strapi: {
          log: { error: mockStrapiLogError, warn: jest.fn(), info: jest.fn() },
          service: () => ({
            validateAndCalculate: mockValidateAndCalculate,
            consumeCoupon: mockConsumeCoupon,
          }),
        },
      }),
  },
}));

const couponController = require('../../src/api/coupon/controllers/coupon');

describe('M14, M15, M16, and HF09 Security & Hygiene Fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('M14: S3 upload path allowlist', () => {
    const { sanitizeUploadPath, resolveFilePath, asyncLocalStorage } = uploadPath;

    test('allows only whitelisted folder prefixes and blocks traversal/arbitrary paths', () => {
      expect(sanitizeUploadPath('receipts')).toBe('receipts');
      expect(sanitizeUploadPath('/media/courses/')).toBe('media/courses');
      expect(sanitizeUploadPath('media/voices')).toBe('media/voices');

      expect(sanitizeUploadPath('../secrets')).toBeNull();
      expect(sanitizeUploadPath('media/../../etc')).toBeNull();
      expect(sanitizeUploadPath('public/evil')).toBeNull();
      expect(sanitizeUploadPath('media\\products')).toBeNull();
      expect(sanitizeUploadPath('custom/folder')).toBeNull();
    });

    test('resolveFilePath ignores disallowed request body.path and falls back safely to media', async () => {
      const mockStrapi = { log: { warn: jest.fn() } };
      const fakeCtx = { request: { body: { path: '../../evil-bucket-path' }, headers: {} } };

      const resolved = await asyncLocalStorage.run(fakeCtx, () =>
        resolveFilePath({ name: 'photo.jpg', mime: 'image/jpeg' }, mockStrapi)
      );

      expect(resolved).toBe('media');
      expect(mockStrapi.log.warn).toHaveBeenCalled();

      const allowedCtx = { request: { body: { path: 'receipts' }, headers: {} } };
      const resolvedReceipt = await asyncLocalStorage.run(allowedCtx, () =>
        resolveFilePath({ name: 'receipt.jpg', mime: 'image/jpeg' }, mockStrapi)
      );
      expect(resolvedReceipt).toBe('receipts');
    });
  });

  describe('M15: Production CORS & CSP restrictions', () => {
    function makeEnv(values) {
      const env = (key, def) => (values[key] !== undefined ? values[key] : def);
      env.bool = (key, def) => (values[key] !== undefined ? Boolean(values[key]) : def);
      return env;
    }

    test('in production removes http:/ws: from CSP and excludes localhost/vercel from CORS', () => {
      const config = middlewaresConfig({
        env: makeEnv({
          NODE_ENV: 'production',
          CORS_ORIGINS: 'https://tarhelahi.ir/, https://admin.tarhelahi.ir',
        }),
      });

      const security = config.find((m) => typeof m === 'object' && m.name === 'strapi::security');
      const cors = config.find((m) => typeof m === 'object' && m.name === 'strapi::cors');

      const csp = security.config.contentSecurityPolicy.directives;
      expect(csp['connect-src']).not.toContain('http:');
      expect(csp['connect-src']).not.toContain('ws:');
      expect(csp['img-src']).not.toContain('http:');
      expect(csp['media-src']).not.toContain('http:');

      expect(cors.config.origin).toEqual(['https://tarhelahi.ir', 'https://admin.tarhelahi.ir']);
      expect(cors.config.origin).not.toContain('http://localhost:3000');
      expect(cors.config.origin).not.toContain('https://tarhelahi.vercel.app');
    });

    test('in production without CORS_ORIGINS falls back only to official production domains', () => {
      const config = middlewaresConfig({
        env: makeEnv({ NODE_ENV: 'production' }),
      });
      const cors = config.find((m) => typeof m === 'object' && m.name === 'strapi::cors');
      expect(cors.config.origin).toEqual([
        'https://tarhelahi.ir',
        'https://www.tarhelahi.ir',
        'https://api.tarhelahi.ir',
      ]);
    });

    test('in development keeps localhost origins and http:/ws: for local dev', () => {
      const config = middlewaresConfig({
        env: makeEnv({ NODE_ENV: 'development' }),
      });
      const security = config.find((m) => typeof m === 'object' && m.name === 'strapi::security');
      const cors = config.find((m) => typeof m === 'object' && m.name === 'strapi::cors');

      expect(security.config.contentSecurityPolicy.directives['connect-src']).toContain('http:');
      expect(security.config.contentSecurityPolicy.directives['connect-src']).toContain('ws:');
      expect(cors.config.origin).toContain('http://localhost:3000');
    });
  });

  describe('M16: Coupon controller hides internal error messages', () => {
    test('validate and consume do not expose err.message in 500 responses', async () => {
      mockValidateAndCalculate.mockRejectedValueOnce(new Error('PG_INTERNAL_SECRET_DETAIL'));
      const validateCtx = {
        request: { body: { code: 'TEST10' } },
        badRequest: jest.fn(),
        send: jest.fn(),
        throw: jest.fn((status, msg) => {
          throw new Error(`${status}:${msg}`);
        }),
      };

      await expect(couponController.validate(validateCtx)).rejects.toThrow('500:خطا در بررسی کد تخفیف');
      expect(validateCtx.throw).not.toHaveBeenCalledWith(
        500,
        expect.stringContaining('PG_INTERNAL_SECRET_DETAIL')
      );
      expect(mockStrapiLogError).toHaveBeenCalled();

      mockConsumeCoupon.mockRejectedValueOnce(new Error('DB_DEADLOCK_SECRET_TRACE'));
      const consumeCtx = {
        request: { body: { code: 'TEST10' } },
        badRequest: jest.fn(),
        send: jest.fn(),
        throw: jest.fn((status, msg) => {
          throw new Error(`${status}:${msg}`);
        }),
      };

      await expect(couponController.consume(consumeCtx)).rejects.toThrow('500:خطا در ثبت استفاده از کد تخفیف');
      expect(consumeCtx.throw).not.toHaveBeenCalledWith(
        500,
        expect.stringContaining('DB_DEADLOCK_SECRET_TRACE')
      );
    });
  });

  describe('HF09: scripts/set-bucket-cors.js syntax check', () => {
    test('passes node --check without syntax errors', () => {
      const scriptPath = path.resolve(__dirname, '../../scripts/set-bucket-cors.js');
      expect(() => execFileSync(process.execPath, ['--check', scriptPath])).not.toThrow();
    });
  });
});

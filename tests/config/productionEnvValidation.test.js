'use strict';

const fs = require('fs');
const path = require('path');
const { validateProductionEnv, REQUIRED_PRODUCTION_VARS } = require('../../src/utils/validateProductionEnv');

describe('Production Env Validation & Packaging Exclusions (M11, M12, SEC-06)', () => {
  test('validateProductionEnv skips validation outside production', () => {
    expect(validateProductionEnv({ NODE_ENV: 'development' })).toEqual({
      ok: true,
      skipped: true,
    });
  });

  test('validateProductionEnv throws when any required production var is missing or insecure', () => {
    const validEnv = {
      NODE_ENV: 'production',
      APP_KEYS: 'real_key_one_abc,real_key_two_xyz',
      JWT_SECRET: 'strong_jwt_secret_value',
      ADMIN_JWT_SECRET: 'strong_admin_jwt_secret',
      API_TOKEN_SALT: 'strong_api_token_salt',
      TRANSFER_TOKEN_SALT: 'strong_transfer_salt',
      DATABASE_PASSWORD: 'strong_db_password',
      SMSIR_API_KEY: 'real_smsir_api_key',
    };

    expect(validateProductionEnv(validEnv)).toEqual({ ok: true, skipped: false });

    for (const key of REQUIRED_PRODUCTION_VARS) {
      const missingEnv = { ...validEnv };
      delete missingEnv[key];
      expect(() => validateProductionEnv(missingEnv)).toThrow(new RegExp(key));
    }

    expect(() =>
      validateProductionEnv({ ...validEnv, DATABASE_PASSWORD: '123456' })
    ).toThrow(/DATABASE_PASSWORD/);

    expect(() =>
      validateProductionEnv({ ...validEnv, APP_KEYS: 'key1_super_secret_123456,other' })
    ).toThrow(/APP_KEYS/);
  });

  test('test-sms.js is removed and .liaraignore excludes dev/test/export paths', () => {
    const testSmsPath = path.resolve(__dirname, '../../test-sms.js');
    expect(fs.existsSync(testSmsPath)).toBe(false);

    const liaraIgnore = fs.readFileSync(path.resolve(__dirname, '../../.liaraignore'), 'utf8');
    for (const entry of [
      'tests/',
      'scripts/',
      '.strapi/',
      'exports/',
      'storage/exports/',
      'public/uploads/exports/',
      'test-sms.js',
      'course_data.json',
      '.env.*',
    ]) {
      expect(liaraIgnore).toContain(entry);
    }
  });
});

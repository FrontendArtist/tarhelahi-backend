const jwt = require('jsonwebtoken');
const pluginsConfig = require('../../config/plugins');

const makeEnv = (vars) => (key, def) => (key in vars ? vars[key] : def);

describe('users-permissions JWT config (BND-02)', () => {
  const modes = {
    local: { JWT_SECRET: 's3cret' },
    liara: {
      JWT_SECRET: 's3cret',
      NODE_ENV: 'production',
      LIARA_ACCESS_KEY_ID: 'a',
      LIARA_ACCESS_SECRET: 'b',
    },
  };

  test.each(Object.keys(modes))('%s: tokens carry issuer, audience and 30d expiry', (mode) => {
    const vars = { ...modes[mode], JWT_ISSUER: 'tarhelahi-strapi', JWT_AUDIENCE: 'byemoney' };
    const { jwtSecret, jwt: jwtOptions } = pluginsConfig({ env: makeEnv(vars) })['users-permissions'].config;
    const decoded = jwt.verify(jwt.sign({ id: 1 }, jwtSecret, jwtOptions), jwtSecret, {
      issuer: 'tarhelahi-strapi',
      audience: 'byemoney',
    });
    expect(decoded.exp - decoded.iat).toBe(30 * 24 * 60 * 60);
  });

  test('issuer/audience come from env', () => {
    const cfg = pluginsConfig({ env: makeEnv({ JWT_SECRET: 's', JWT_ISSUER: 'x', JWT_AUDIENCE: 'y' }) });
    expect(cfg['users-permissions'].config.jwt).toMatchObject({ issuer: 'x', audience: 'y' });
  });
});

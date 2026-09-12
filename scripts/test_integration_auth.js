'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const policy = require('../src/policies/is-service-authenticated');
const controller = require('../src/api/integration/controllers/integration');
const routes = require('../src/api/integration/routes/integration');

async function runTests() {
  console.log('--- Starting ByeMoney <-> TarhElahi Integration Verification ---\n');

  const TEST_SECRET = '9b44c258951660be75798fec5f7d885361a89b4e9ebaa6145a93eced40c22f56';
  process.env.BYEMONEY_SERVICE_KEY = TEST_SECRET;

  // Test 1: Redundant files removal check
  console.log('1. Verifying redundant files removal...');
  const redundantMwPath = path.join(__dirname, '..', 'src', 'middlewares', 'service-auth.js');
  const redundantPolicyPath = path.join(__dirname, '..', 'src', 'api', 'integration', 'policies', 'is-service-authenticated.js');
  assert(!fs.existsSync(redundantMwPath), 'src/middlewares/service-auth.js must not exist');
  assert(!fs.existsSync(redundantPolicyPath), 'src/api/integration/policies/is-service-authenticated.js must not exist');
  console.log('✓ Redundant middleware and duplicate policy files are cleanly removed');

  // Test 2: Route configuration verification
  console.log('\n2. Verifying Versioned Route Configuration (/api/integrations/byemoney/v1/)...');
  assert(Array.isArray(routes.routes), 'Routes should be an array');
  assert.strictEqual(routes.routes.length, 2, 'Should have 2 routes');

  const userRoute = routes.routes.find((r) => r.path === '/integrations/byemoney/v1/users/:externalUserId');
  const courseRoute = routes.routes.find((r) => r.path === '/integrations/byemoney/v1/courses/:externalId');

  assert(userRoute, 'User route /integrations/byemoney/v1/users/:externalUserId must exist');
  assert.strictEqual(userRoute.method, 'GET');
  assert.strictEqual(userRoute.config.auth, false, 'User route auth must be false');
  assert(userRoute.config.policies.includes('global::is-service-authenticated'), 'User route must have is-service-authenticated policy');

  assert(courseRoute, 'Course route /integrations/byemoney/v1/courses/:externalId must exist');
  assert.strictEqual(courseRoute.method, 'GET');
  assert.strictEqual(courseRoute.config.auth, false, 'Course route auth must be false');
  assert(courseRoute.config.policies.includes('global::is-service-authenticated'), 'Course route must have is-service-authenticated policy');
  console.log('✓ Versioned routes and policies verified successfully');

  // Test 3: Policy validation with SHA256 timingSafeEqual
  console.log('\n3. Verifying Policy Authentication & 401 Rejections...');

  // 3a. Missing header
  let errorCaught = false;
  try {
    const mockCtx = {
      get: (h) => null,
      request: { headers: {} },
    };
    policy(mockCtx);
  } catch (err) {
    errorCaught = true;
    assert.strictEqual(err.name, 'UnauthorizedError', 'Should throw UnauthorizedError');
  }
  assert(errorCaught, 'Policy should reject missing header with 401');

  // 3b. Invalid key (different length)
  errorCaught = false;
  try {
    const mockCtx = {
      get: (h) => (h.toLowerCase() === 'x-service-key' ? 'short_key' : null),
      request: { headers: { 'x-service-key': 'short_key' } },
    };
    policy(mockCtx);
  } catch (err) {
    errorCaught = true;
    assert.strictEqual(err.name, 'UnauthorizedError', 'Should throw UnauthorizedError');
  }
  assert(errorCaught, 'Policy should reject different-length key with 401');

  // 3c. Invalid key (same length, different characters)
  errorCaught = false;
  try {
    const wrongKey = '9b44c258951660be75798fec5f7d885361a89b4e9ebaa6145a93eced40c22f57';
    const mockCtx = {
      get: (h) => (h.toLowerCase() === 'x-service-key' ? wrongKey : null),
      request: { headers: { 'x-service-key': wrongKey } },
    };
    policy(mockCtx);
  } catch (err) {
    errorCaught = true;
    assert.strictEqual(err.name, 'UnauthorizedError', 'Should throw UnauthorizedError');
  }
  assert(errorCaught, 'Policy should reject mismatched key with 401');

  // 3d. Valid key
  const validCtx = {
    get: (h) => (h.toLowerCase() === 'x-service-key' ? TEST_SECRET : null),
    request: { headers: { 'x-service-key': TEST_SECRET } },
  };
  const policyResult = policy(validCtx);
  assert.strictEqual(policyResult, true, 'Policy should return true on valid key');
  console.log('✓ SHA256 constant-time comparison securely validates correct key and rejects invalid keys');

  // Mock Database Setup
  const mockUserInDb = {
    id: 101,
    documentId: 'usr_doc_987654321',
    username: '09121234567',
    email: 'integration_user@example.com',
    phoneNumber: '09121234567',
    firstName: 'Mohammad',
    lastName: 'Ahmadi',
    password: '$2a$10$very_secret_hashed_password',
    resetPasswordToken: 'private_reset_token',
    confirmationToken: 'private_confirm_token',
    otpCode: '998877',
    otpExpiresAt: '2026-09-08T12:00:00.000Z',
    cartData: { items: [1, 2] },
    confirmed: true,
    blocked: false,
    isMobileVerified: true,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-02T10:00:00.000Z',
  };

  const mockCourseInDb = {
    id: 202,
    documentId: 'crs_doc_123456789',
    title: 'Fullstack Development',
    slug: 'fullstack-development',
    description: [{ type: 'paragraph', children: [{ text: 'Course details' }] }],
    price: 3500000,
    publishedAt: '2026-01-01T10:00:00.000Z',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-02T10:00:00.000Z',
    content: 'rich text internal content',
    telegramLink: 'https://t.me/secret_group',
  };

  global.strapi = {
    db: {
      query: (uid) => ({
        findOne: async ({ where }) => {
          if (uid === 'plugin::users-permissions.user') {
            // Strict check: only match by documentId
            if (where.documentId === mockUserInDb.documentId) {
              return mockUserInDb;
            }
          }
          if (uid === 'api::course.course') {
            // Strict check: only match by documentId
            if (where.documentId === mockCourseInDb.documentId) {
              return mockCourseInDb;
            }
          }
          return null;
        },
      }),
    },
  };

  // Test 4: Controller - getUser (ExternalUserId = documentId)
  console.log('\n4. Verifying Controller: getUser with stable ExternalUserId...');
  let userResponse = null;
  const mockUserCtx = {
    params: { externalUserId: 'usr_doc_987654321' },
    send: (data) => {
      userResponse = data;
      return data;
    },
    notFound: (msg) => {
      throw new Error(`404: ${msg}`);
    },
    badRequest: (msg) => {
      throw new Error(`400: ${msg}`);
    },
  };

  await controller.getUser(mockUserCtx);

  assert(userResponse, 'User response must exist');
  assert.strictEqual(userResponse.externalUserId, 'usr_doc_987654321', 'externalUserId must match documentId');
  assert.strictEqual(userResponse.phoneNumber, '09121234567');
  assert.strictEqual(userResponse.email, 'integration_user@example.com');
  assert.strictEqual(userResponse.firstName, 'Mohammad');
  assert.strictEqual(userResponse.lastName, 'Ahmadi');
  assert.strictEqual(userResponse.confirmed, true);
  assert.strictEqual(userResponse.blocked, false);
  assert.strictEqual(userResponse.isMobileVerified, true);
  assert.strictEqual(userResponse.createdAt, '2026-01-01T10:00:00.000Z');
  assert.strictEqual(userResponse.updatedAt, '2026-01-02T10:00:00.000Z');

  // Verify sensitive fields NEVER leak
  assert.strictEqual(userResponse.password, undefined, 'password must NOT leak');
  assert.strictEqual(userResponse.resetPasswordToken, undefined, 'resetPasswordToken must NOT leak');
  assert.strictEqual(userResponse.confirmationToken, undefined, 'confirmationToken must NOT leak');
  assert.strictEqual(userResponse.otpCode, undefined, 'otpCode must NOT leak');
  assert.strictEqual(userResponse.otpExpiresAt, undefined, 'otpExpiresAt must NOT leak');
  assert.strictEqual(userResponse.cartData, undefined, 'cartData must NOT leak');

  const expectedUserKeys = [
    'externalUserId',
    'phoneNumber',
    'email',
    'firstName',
    'lastName',
    'confirmed',
    'blocked',
    'isMobileVerified',
    'createdAt',
    'updatedAt',
  ].sort();
  assert.deepStrictEqual(Object.keys(userResponse).sort(), expectedUserKeys, 'User DTO keys must strictly match contract');
  console.log('✓ getUser returned strict whitelist DTO with stable externalUserId and zero credential leaks');

  // Test 5: Verify numeric database ID is NOT accepted for User lookup
  console.log('\n5. Verifying numeric database IDs are NOT accepted as User external identity...');
  let numericUser404 = false;
  try {
    await controller.getUser({
      params: { externalUserId: '101' }, // Numeric DB ID of the user
      notFound: () => {
        numericUser404 = true;
      },
      badRequest: () => {},
      send: () => {},
    });
  } catch (e) {}
  assert(numericUser404, 'Passing numeric DB ID (101) must return 404 (strict documentId lookup required)');
  console.log('✓ Strict lookup confirmed: numeric DB IDs are rejected for User');

  // Test 6: Controller - getCourse (Authoritative catalog DTO)
  console.log('\n6. Verifying Controller: getCourse with authoritative catalog DTO...');
  let courseResponse = null;
  const mockCourseCtx = {
    params: { externalId: 'crs_doc_123456789' },
    send: (data) => {
      courseResponse = data;
      return data;
    },
    notFound: (msg) => {
      throw new Error(`404: ${msg}`);
    },
    badRequest: (msg) => {
      throw new Error(`400: ${msg}`);
    },
  };

  await controller.getCourse(mockCourseCtx);

  assert(courseResponse, 'Course response must exist');
  assert.strictEqual(courseResponse.source, 'tarh_elahi');
  assert.strictEqual(courseResponse.type, 'course');
  assert.strictEqual(courseResponse.externalId, 'crs_doc_123456789');
  assert.strictEqual(courseResponse.parentExternalId, null);
  assert.strictEqual(courseResponse.title, 'Fullstack Development');
  assert.strictEqual(courseResponse.slug, 'fullstack-development');
  assert.strictEqual(courseResponse.priceRial, 3500000, 'priceRial must be authoritative number');
  assert.strictEqual(courseResponse.published, true);
  assert.strictEqual(courseResponse.available, true, 'available must reflect publication status');
  assert.strictEqual(courseResponse.updatedAt, '2026-01-02T10:00:00.000Z');

  const expectedCourseKeys = [
    'source',
    'type',
    'externalId',
    'parentExternalId',
    'title',
    'slug',
    'priceRial',
    'published',
    'available',
    'updatedAt',
  ].sort();
  assert.deepStrictEqual(Object.keys(courseResponse).sort(), expectedCourseKeys, 'Course DTO keys must strictly match catalog contract');
  console.log('✓ getCourse returned authoritative catalog DTO with priceRial and truthful published/available flags');

  // Test 7: Verify numeric database ID is NOT accepted for Course lookup
  console.log('\n7. Verifying numeric database IDs are NOT accepted as Course external identity...');
  let numericCourse404 = false;
  try {
    await controller.getCourse({
      params: { externalId: '202' }, // Numeric DB ID of the course
      notFound: () => {
        numericCourse404 = true;
      },
      badRequest: () => {},
      send: () => {},
    });
  } catch (e) {}
  assert(numericCourse404, 'Passing numeric DB ID (202) must return 404 (strict documentId lookup required)');
  console.log('✓ Strict lookup confirmed: numeric DB IDs are rejected for Course');

  // Test 8: 404 behavior for unknown IDs
  console.log('\n8. Verifying 404 behavior for non-existent entities...');
  let user404 = false;
  try {
    await controller.getUser({
      params: { externalUserId: 'non_existent_doc_id' },
      notFound: () => {
        user404 = true;
      },
      badRequest: () => {},
      send: () => {},
    });
  } catch (e) {}
  assert(user404, 'Non-existent user must trigger 404');

  let course404 = false;
  try {
    await controller.getCourse({
      params: { externalId: 'non_existent_doc_id' },
      notFound: () => {
        course404 = true;
      },
      badRequest: () => {},
      send: () => {},
    });
  } catch (e) {}
  assert(course404, 'Non-existent course must trigger 404');
  console.log('✓ 404 handled properly for missing entities');

  console.log('\n============================================================');
  console.log('🎉 ALL INTEGRATION TESTS (INCLUDING STRICT LOOKUP) PASSED!');
  console.log('============================================================');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

'use strict';

const assert = require('assert');
const syncService = require('../src/services/byeMoneySyncService');
const usersPermissionsExtension = require('../src/extensions/users-permissions/strapi-server');

async function runTests() {
  console.log('=== Starting ByeMoney Force Sync on Profile Update Verification ===\n');

  // -------------------------------------------------------------
  // Test 1: hasIdentityFieldsInPayload
  // -------------------------------------------------------------
  console.log('1. Verifying hasIdentityFieldsInPayload detection...');
  assert.strictEqual(syncService.hasIdentityFieldsInPayload(null), false);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload(undefined), false);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload({}), false);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload({ cartData: { items: [1, 2] } }), false);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload({ notifications: [] }), false);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload({ light: 100 }), false);

  assert.strictEqual(syncService.hasIdentityFieldsInPayload({ phoneNumber: '09121234567' }), true);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload({ firstName: 'Ali' }), true);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload({ lastName: 'Rezaei' }), true);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload({ email: 'ali@example.com' }), true);
  assert.strictEqual(syncService.hasIdentityFieldsInPayload({ cartData: {}, phoneNumber: '09121234567' }), true);
  console.log('✓ Payload detection accurately identifies presence of identity fields vs unrelated fields');

  // -------------------------------------------------------------
  // Test 2: hasIdentityFieldsChanged
  // -------------------------------------------------------------
  console.log('\n2. Verifying hasIdentityFieldsChanged logic...');
  const baseUser = {
    id: 10,
    documentId: 'doc_user_10',
    firstName: 'Mohammad',
    lastName: 'Ahmadi',
    phoneNumber: '09121234567',
    email: 'mohammad@example.com',
    cartData: { items: [1] },
  };

  // 2a. Unrelated fields
  assert.strictEqual(
    syncService.hasIdentityFieldsChanged(baseUser, { cartData: { items: [1, 2] } }),
    false,
    'Updating cartData must NOT be detected as identity change'
  );

  // 2b. Identity fields passed but unchanged
  assert.strictEqual(
    syncService.hasIdentityFieldsChanged(baseUser, {
      firstName: 'Mohammad',
      lastName: 'Ahmadi',
      phoneNumber: '09121234567',
      email: 'mohammad@example.com',
    }),
    false,
    'Passing identical identity values must return false'
  );

  // 2c. Whitespace or email casing differences
  assert.strictEqual(
    syncService.hasIdentityFieldsChanged(baseUser, {
      firstName: '  Mohammad  ',
      email: 'MOHAMMAD@example.com',
    }),
    false,
    'Whitespace-trimmed and case-insensitive email must not trigger change'
  );

  // 2d. Phone number changed
  assert.strictEqual(
    syncService.hasIdentityFieldsChanged(baseUser, { phoneNumber: '09129999999' }),
    true,
    'Phone number change must return true'
  );

  // 2e. First name changed
  assert.strictEqual(
    syncService.hasIdentityFieldsChanged(baseUser, { firstName: 'Hossein' }),
    true,
    'First name change must return true'
  );

  // 2f. Last name changed
  assert.strictEqual(
    syncService.hasIdentityFieldsChanged(baseUser, { lastName: 'Karimi' }),
    true,
    'Last name change must return true'
  );

  // 2g. Email changed
  assert.strictEqual(
    syncService.hasIdentityFieldsChanged(baseUser, { email: 'newemail@example.com' }),
    true,
    'Email change must return true'
  );

  // 2h. Cart changed along with phone number
  assert.strictEqual(
    syncService.hasIdentityFieldsChanged(baseUser, {
      cartData: { items: [5] },
      phoneNumber: '09129999999',
    }),
    true,
    'Changing cartData and phoneNumber together must return true'
  );

  console.log('✓ Identity field change detection works with exact precision');

  // -------------------------------------------------------------
  // Test 3: Dedicated sync service module (syncUser)
  // -------------------------------------------------------------
  console.log('\n3. Verifying dedicated sync service module (syncUser)...');

  const issuedTokens = [];
  const logEntries = { info: [], warn: [], error: [] };

  // Setup mock strapi
  global.strapi = {
    log: {
      info: (msg) => logEntries.info.push(msg),
      warn: (msg) => logEntries.warn.push(msg),
      error: (msg) => logEntries.error.push(msg),
    },
    plugin: (name) => {
      if (name === 'users-permissions') {
        return {
          service: (sName) => {
            if (sName === 'jwt') {
              return {
                issue: (payload) => {
                  issuedTokens.push(payload);
                  return `mock_jwt_token_for_${payload.documentId || payload.id}`;
                },
              };
            }
            if (sName === 'user') {
              return {
                fetch: async (id) => {
                  return { ...baseUser, id };
                },
              };
            }
          },
        };
      }
    },
  };

  // 3a. Success case: Mock fetch returning 200 OK
  let capturedFetch = null;
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    capturedFetch = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
    };
  };

  await syncService.syncUser(baseUser, { baseUrl: 'http://byemoney-test:5000' });

  assert(capturedFetch, 'fetch must have been called');
  assert.strictEqual(
    capturedFetch.url,
    'http://byemoney-test:5000/api/auth/sync',
    'Must target /api/auth/sync'
  );
  assert.strictEqual(capturedFetch.options.method, 'POST');
  assert.strictEqual(
    capturedFetch.options.headers['Authorization'],
    'Bearer mock_jwt_token_for_doc_user_10',
    'Must include Bearer token'
  );
  assert.strictEqual(
    capturedFetch.options.body,
    JSON.stringify({ forceSync: true }),
    'Must send forceSync: true'
  );
  assert.strictEqual(issuedTokens.length, 1);
  assert.deepStrictEqual(issuedTokens[0], {
    id: 10,
    documentId: 'doc_user_10',
  });
  assert(
    logEntries.info.some((m) => m.includes('Successfully triggered sync for user doc_user_10')),
    'Must log success info'
  );
  console.log('✓ Success case: Correct JWT issued with documentId, correct headers, body, and URL');

  // 3b. Non-2xx response without throwing
  global.fetch = async (url, options) => {
    return {
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    };
  };

  let threw = false;
  try {
    await syncService.syncUser(baseUser, { baseUrl: 'http://byemoney-test:5000' });
  } catch (err) {
    threw = true;
  }
  assert.strictEqual(threw, false, 'Non-2xx response must not throw');
  assert(
    logEntries.warn.some((m) => m.includes('failed with status 500')),
    'Must log warning for non-2xx'
  );
  console.log('✓ Non-2xx response logged as warning without throwing');

  // 3c. Network error without throwing
  global.fetch = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5000');
  };

  threw = false;
  try {
    await syncService.syncUser(baseUser, { baseUrl: 'http://byemoney-test:5000' });
  } catch (err) {
    threw = true;
  }
  assert.strictEqual(threw, false, 'Network error must not throw');
  assert(
    logEntries.error.some((m) => m.includes('ECONNREFUSED')),
    'Must log network error'
  );
  console.log('✓ Network error logged without throwing');

  // 3d. Timeout via AbortController
  global.fetch = async (url, options) => {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  threw = false;
  try {
    await syncService.syncUser(baseUser, {
      baseUrl: 'http://byemoney-test:5000',
      timeoutMs: 50,
    });
  } catch (err) {
    threw = true;
  }
  assert.strictEqual(threw, false, 'Timeout must not throw');
  assert(
    logEntries.warn.some((m) => m.includes('timed out')),
    'Must log warning on timeout'
  );
  console.log('✓ Timeout handled via AbortController and logged without throwing');

  // Restore fetch
  global.fetch = originalFetch;

  // -------------------------------------------------------------
  // Test 4: strapi-server.js extension wrapping
  // -------------------------------------------------------------
  console.log('\n4. Verifying strapi-server.js plugin extension wrapping...');

  let originalUpdateCalled = 0;
  let syncUserCalled = 0;
  let lastSyncedUser = null;

  // Mock syncService.syncUser inside test
  const originalSyncUser = syncService.syncUser;
  syncService.syncUser = async (user) => {
    syncUserCalled++;
    lastSyncedUser = user;
  };

  const mockPlugin = {
    controllers: {
      user: {
        update: async function (ctx) {
          originalUpdateCalled++;
          ctx.status = 200;
          ctx.body = {
            id: ctx.params.id,
            ...ctx.request.body,
          };
          ctx.send = function (data) {
            this.body = data;
          };
        },
      },
    },
  };

  const extendedPlugin = usersPermissionsExtension(mockPlugin);

  // 4a. Update unrelated field (cartData) -> No sync
  originalUpdateCalled = 0;
  syncUserCalled = 0;
  const ctxCart = {
    params: { id: 10 },
    request: { body: { cartData: { items: [99] } } },
    status: 200,
  };

  await extendedPlugin.controllers.user.update(ctxCart);
  assert.strictEqual(originalUpdateCalled, 1, 'Original update controller must be called');
  assert.strictEqual(syncUserCalled, 0, 'Sync must NOT be called when only cartData is updated');
  assert.deepStrictEqual(ctxCart.body, { id: 10, cartData: { items: [99] } });
  console.log('✓ Unrelated field update (cartData) leaves response intact and does not trigger sync');

  // 4b. Update identity field with identical value -> No sync
  originalUpdateCalled = 0;
  syncUserCalled = 0;
  const ctxSamePhone = {
    params: { id: 10 },
    request: { body: { phoneNumber: '09121234567' } },
    status: 200,
  };

  await extendedPlugin.controllers.user.update(ctxSamePhone);
  assert.strictEqual(originalUpdateCalled, 1);
  assert.strictEqual(syncUserCalled, 0, 'Sync must NOT be called when phoneNumber did not change');
  console.log('✓ Unchanged identity field does not trigger sync');

  // 4c. Update identity field (phoneNumber changed) -> Fire-and-forget sync triggered!
  originalUpdateCalled = 0;
  syncUserCalled = 0;
  const ctxNewPhone = {
    params: { id: 10 },
    request: { body: { phoneNumber: '09129999999' } },
    status: 200,
  };

  await extendedPlugin.controllers.user.update(ctxNewPhone);
  assert.strictEqual(originalUpdateCalled, 1);
  // Wait a small tick for fire-and-forget promise to execute
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(syncUserCalled, 1, 'Sync MUST be triggered when phoneNumber changed');
  assert.strictEqual(lastSyncedUser.id, 10);
  assert.strictEqual(lastSyncedUser.documentId, 'doc_user_10');
  assert.deepStrictEqual(ctxNewPhone.body, { id: 10, phoneNumber: '09129999999' });
  console.log('✓ Changed identity field (phoneNumber) triggers background sync with correct user');

  // 4d. Original update controller error (e.g. 400 validation error) -> No sync
  originalUpdateCalled = 0;
  syncUserCalled = 0;
  extendedPlugin.controllers.user.update = usersPermissionsExtension({
    controllers: {
      user: {
        update: async function (ctx) {
          originalUpdateCalled++;
          throw new Error('Validation failed');
        },
      },
    },
  }).controllers.user.update;

  let errorThrown = false;
  try {
    await extendedPlugin.controllers.user.update({
      params: { id: 10 },
      request: { body: { phoneNumber: '09128888888' } },
    });
  } catch (e) {
    errorThrown = true;
  }
  assert.strictEqual(errorThrown, true, 'Error must bubble up to client');
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(syncUserCalled, 0, 'Sync must NOT be triggered when update fails');
  console.log('✓ Controller errors bubble up to client without triggering sync');

  // Restore syncUser
  syncService.syncUser = originalSyncUser;

  console.log('\n============================================================');
  console.log('🎉 ALL FORCE SYNC VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('============================================================');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../src/services/byeMoneySyncService', () => ({
  hasIdentityFieldsInPayload: jest.fn(() => false),
  hasIdentityFieldsChanged: jest.fn(() => false),
  syncUser: jest.fn(async () => {}),
}));

const usersPermissionsExtension = require('../../src/extensions/users-permissions/strapi-server');

describe('Users-Permissions Security Lockdown (M1)', () => {
  let mockPlugin;
  let originalUpdate;
  let originalCreate;
  let originalFind;
  let originalFindOne;
  let originalDestroy;
  let originalCount;
  let extended;

  beforeEach(() => {
    originalUpdate = jest.fn(async (ctx) => {
      ctx.body = { id: ctx.params.id, ...ctx.request.body };
    });
    originalCreate = jest.fn(async (ctx) => {
      ctx.body = { id: 99 };
    });
    originalFind = jest.fn(async (ctx) => {
      ctx.body = [{ id: 1 }, { id: 2 }];
    });
    originalFindOne = jest.fn(async (ctx) => {
      ctx.body = { id: ctx.params.id };
    });
    originalDestroy = jest.fn(async (ctx) => {
      ctx.body = { deleted: true };
    });
    originalCount = jest.fn(async (ctx) => {
      ctx.body = 2;
    });

    mockPlugin = {
      controllers: {
        user: {
          update: originalUpdate,
          create: originalCreate,
          find: originalFind,
          findOne: originalFindOne,
          destroy: originalDestroy,
          count: originalCount,
        },
        auth: {
          register: jest.fn(),
        },
      },
      routes: {
        'content-api': { routes: [] },
      },
    };

    extended = usersPermissionsExtension(mockPlugin);
  });

  test('dead un-loaded override file content-types/strapi-server.js has been removed', () => {
    const deadFile = path.resolve(
      __dirname,
      '../../src/extensions/users-permissions/content-types/strapi-server.js'
    );
    expect(fs.existsSync(deadFile)).toBe(false);
  });

  test('normal user cannot update another user (403)', async () => {
    const ctx = {
      params: { id: '20' },
      state: { user: { id: 10, role: { type: 'authenticated' } } },
      request: { body: { firstName: 'Ali' } },
      forbidden: jest.fn((msg) => ({ status: 403, msg })),
      badRequest: jest.fn(),
    };

    await extended.controllers.user.update(ctx);
    expect(ctx.forbidden).toHaveBeenCalledTimes(1);
    expect(originalUpdate).not.toHaveBeenCalled();
  });

  test.each([
    ['courses', { courses: [1, 2] }],
    ['role', { role: 1 }],
    ['password', { password: 'hacked123' }],
    ['phoneNumber', { phoneNumber: '09120000000' }],
    ['enrolledChapters', { enrolledChapters: [99] }],
    ['enrolledChapterIntegrationIds', { enrolledChapterIntegrationIds: ['uuid'] }],
    ['blocked', { blocked: false }],
    ['isMobileVerified', { isMobileVerified: true }],
  ])('normal user cannot update sensitive field %s on self (403)', async (_field, body) => {
    const ctx = {
      params: { id: '10' },
      state: { user: { id: 10, role: { type: 'authenticated' } } },
      request: { body },
      forbidden: jest.fn((msg) => ({ status: 403, msg })),
      badRequest: jest.fn(),
    };

    await extended.controllers.user.update(ctx);
    expect(ctx.forbidden).toHaveBeenCalledTimes(1);
    expect(originalUpdate).not.toHaveBeenCalled();
  });

  test('normal user can update allowed profile fields (firstName, lastName, email) on self', async () => {
    const ctx = {
      params: { id: '10' },
      state: { user: { id: 10, role: { type: 'authenticated' } } },
      request: { body: { firstName: 'Reza', lastName: 'Ahmadi', email: 'reza@example.com' } },
      forbidden: jest.fn(),
      badRequest: jest.fn(),
    };

    await extended.controllers.user.update(ctx);
    expect(ctx.forbidden).not.toHaveBeenCalled();
    expect(originalUpdate).toHaveBeenCalledTimes(1);
    expect(ctx.request.body).toEqual({
      firstName: 'Reza',
      lastName: 'Ahmadi',
      email: 'reza@example.com',
    });
  });

  test('normal user gets 403 on find, destroy, count, and findOne for another user', async () => {
    const baseUserState = { user: { id: 10, role: { type: 'authenticated' } } };

    for (const action of ['find', 'destroy', 'count']) {
      const ctx = {
        state: baseUserState,
        query: {},
        params: { id: '10' },
        forbidden: jest.fn(),
      };
      await extended.controllers.user[action](ctx);
      expect(ctx.forbidden).toHaveBeenCalledTimes(1);
    }

    const findOneOtherCtx = {
      state: baseUserState,
      params: { id: '99' },
      forbidden: jest.fn(),
    };
    await extended.controllers.user.findOne(findOneOtherCtx);
    expect(findOneOtherCtx.forbidden).toHaveBeenCalledTimes(1);
    expect(originalFindOne).not.toHaveBeenCalled();
  });

  test('normal user can findOne their own record', async () => {
    const ctx = {
      state: { user: { id: 10, role: { type: 'authenticated' } } },
      params: { id: 10 },
      forbidden: jest.fn(),
    };

    await extended.controllers.user.findOne(ctx);
    expect(ctx.forbidden).not.toHaveBeenCalled();
    expect(originalFindOne).toHaveBeenCalledTimes(1);
  });

  test('administrator and api-token can find, findOne, and update any user/field', async () => {
    const privilegedStates = [
      { user: { id: 1, role: { type: 'administrator' } } },
      { auth: { strategy: { name: 'api-token' } } },
    ];

    for (const state of privilegedStates) {
      const findCtx = { state, query: {}, forbidden: jest.fn() };
      await extended.controllers.user.find(findCtx);
      expect(findCtx.forbidden).not.toHaveBeenCalled();

      const findOneCtx = { state, params: { id: '99' }, forbidden: jest.fn() };
      await extended.controllers.user.findOne(findOneCtx);
      expect(findOneCtx.forbidden).not.toHaveBeenCalled();

      const updateCtx = {
        state,
        params: { id: '99' },
        request: { body: { courses: [1], blocked: true } },
        forbidden: jest.fn(),
        badRequest: jest.fn(),
      };
      await extended.controllers.user.update(updateCtx);
      expect(updateCtx.forbidden).not.toHaveBeenCalled();
    }
  });
});

'use strict';

const usersPermissionsExtension = require('../../src/extensions/users-permissions/strapi-server');

describe('Users-Permissions Light Deprecation Guard', () => {
  let mockPlugin;
  let originalUpdate;
  let originalCreate;
  let originalRegister;
  let extendedPlugin;

  beforeEach(() => {
    originalUpdate = jest.fn();
    originalCreate = jest.fn();
    originalRegister = jest.fn();

    mockPlugin = {
      controllers: {
        user: {
          update: originalUpdate,
          create: originalCreate,
          find: jest.fn(),
        },
        auth: {
          register: originalRegister,
        },
      },
      routes: {
        'content-api': {
          routes: [],
        },
      },
    };

    extendedPlugin = usersPermissionsExtension(mockPlugin);
  });

  describe('user.update', () => {
    it('should reject request when payload contains light field', async () => {
      const ctx = {
        params: { id: 1 },
        request: {
          body: {
            username: 'testuser',
            light: 100,
          },
        },
        badRequest: jest.fn(),
      };

      await extendedPlugin.controllers.user.update(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith(
        'The "light" field on Users-Permissions is deprecated and blocked.'
      );
      expect(originalUpdate).not.toHaveBeenCalled();
    });
  });

  describe('user.create', () => {
    it('should reject request when payload contains light field', async () => {
      const ctx = {
        request: {
          body: {
            username: 'newuser',
            light: 50,
          },
        },
        badRequest: jest.fn(),
      };

      await extendedPlugin.controllers.user.create(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith(
        'The "light" field on Users-Permissions is deprecated and blocked.'
      );
      expect(originalCreate).not.toHaveBeenCalled();
    });
  });

  describe('auth.register', () => {
    it('should reject registration when payload contains light field', async () => {
      const ctx = {
        request: {
          body: {
            username: 'reguser',
            password: 'secretPassword123',
            light: 20,
          },
        },
        badRequest: jest.fn(),
      };

      await extendedPlugin.controllers.auth.register(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith(
        'The "light" field on Users-Permissions is deprecated and blocked.'
      );
      expect(originalRegister).not.toHaveBeenCalled();
    });
  });
});

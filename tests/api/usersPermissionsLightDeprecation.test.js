'use strict';

const userPermissionsExtension = require('../../src/extensions/users-permissions/strapi-server');

describe('Users-Permissions Light Field Deprecation', () => {
  let plugin;

  beforeEach(() => {
    plugin = {
      controllers: {
        user: {
          update: jest.fn(),
          create: jest.fn(),
          find: jest.fn(),
        },
        auth: {
          register: jest.fn(),
        },
      },
      routes: {
        'content-api': {
          routes: [],
        },
      },
    };
  });

  describe('update controller', () => {
    it('should return badRequest if "light" is in body', async () => {
      const originalUpdate = jest.fn();
      plugin.controllers.user.update = originalUpdate;

      const extendedPlugin = userPermissionsExtension(plugin);
      const ctx = {
        params: { id: 1 },
        request: { body: { light: true, username: 'test' } },
        badRequest: jest.fn((msg) => ({ status: 400, message: msg })),
      };

      await extendedPlugin.controllers.user.update(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith(
        'The "light" field on Users-Permissions is deprecated and blocked.'
      );
      expect(originalUpdate).not.toHaveBeenCalled();
    });

    it('should proceed if "light" is not in body', async () => {
      const originalUpdate = jest.fn();
      plugin.controllers.user.update = originalUpdate;

      const extendedPlugin = userPermissionsExtension(plugin);
      const ctx = {
        params: { id: 1 },
        request: { body: { username: 'test' } },
        badRequest: jest.fn(),
      };

      await extendedPlugin.controllers.user.update(ctx);

      expect(ctx.badRequest).not.toHaveBeenCalled();
      expect(originalUpdate).toHaveBeenCalled();
    });
  });

  describe('create controller', () => {
    it('should return badRequest if "light" is in body', async () => {
      const originalCreate = jest.fn();
      plugin.controllers.user.create = originalCreate;

      const extendedPlugin = userPermissionsExtension(plugin);
      const ctx = {
        request: { body: { light: 1 } },
        badRequest: jest.fn((msg) => ({ status: 400, message: msg })),
      };

      await extendedPlugin.controllers.user.create(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith(
        'The "light" field on Users-Permissions is deprecated and blocked.'
      );
      expect(originalCreate).not.toHaveBeenCalled();
    });
  });

  describe('register controller', () => {
    it('should return badRequest if "light" is in body', async () => {
      const originalRegister = jest.fn();
      plugin.controllers.auth.register = originalRegister;

      const extendedPlugin = userPermissionsExtension(plugin);
      const ctx = {
        request: { body: { light: false } },
        badRequest: jest.fn((msg) => ({ status: 400, message: msg })),
      };

      await extendedPlugin.controllers.auth.register(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith(
        'The "light" field on Users-Permissions is deprecated and blocked.'
      );
      expect(originalRegister).not.toHaveBeenCalled();
    });
  });

  describe('blocked routes', () => {
    it('should prepend blocked routes for /users/light and /users/:id/light', () => {
      const extendedPlugin = userPermissionsExtension(plugin);
      const routes = extendedPlugin.routes['content-api'].routes;

      const lightRoutes = routes.filter(
        (r) => r.path === '/users/light' || r.path === '/users/:id/light'
      );
      expect(lightRoutes.length).toBe(10); // 5 methods * 2 paths

      const ctx = {
        badRequest: jest.fn((msg) => msg),
      };
      lightRoutes[0].handler(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(
        'The "light" route on Users-Permissions is deprecated and blocked.'
      );
    });
  });
});

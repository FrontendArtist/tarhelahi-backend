'use strict';

module.exports = {
  /**
   * The register hook runs before the application is fully initialized.
   * We use it to directly set app.proxy = true on the underlying Koa instance
   * so that Koa reads X-Forwarded-Proto: https from Liara's reverse proxy and
   * marks ctx.secure = true. Without this, koa-session throws:
   *   "Cannot send secure cookie over unencrypted connection"
   * even when proxy: true is set inside the session middleware config.
   */
  register({ strapi }) {
    // strapi.server.app is the raw Koa Application instance.
    // Setting proxy = true here is the canonical imperative fix for
    // Strapi v5 running behind an SSL-terminating reverse proxy.
    strapi.server.app.proxy = true;
  },

  bootstrap(/*{ strapi }*/) { },
};

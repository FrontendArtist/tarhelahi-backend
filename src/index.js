// path: backend/src/index.js
'use strict';

module.exports = {
  /**
   * The register hook runs before the application is fully initialized.
   * Sets app.proxy = true on Koa instance so it trusts X-Forwarded-Proto headers.
   */
  register({ strapi }) {
    strapi.server.app.proxy = true;
  },

  bootstrap(/*{ strapi }*/) {},
};
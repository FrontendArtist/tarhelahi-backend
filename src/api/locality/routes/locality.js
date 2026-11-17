'use strict';

/**
 * Read-only public catalog. This API has no content-type, so core province/city CRUD stays closed.
 */
module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/localities',
      handler: 'locality.list',
      config: {
        auth: false,
      },
    },
  ],
};

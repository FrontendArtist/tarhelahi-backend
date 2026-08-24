'use strict';

/**
 * Custom routes for Order API (Excel Export & Revenue Analytics)
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/orders/export-excel',
      handler: 'order.exportExcel',
      config: {
        auth: false, // Set to true or customize permissions as needed
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/orders/revenue-stats',
      handler: 'order.revenueStats',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/orders/sync-excel',
      handler: 'order.syncExcel',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};

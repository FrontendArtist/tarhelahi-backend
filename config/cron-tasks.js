'use strict';

const { recoverGatewayTopUps } = require('../src/services/gatewayTopUpRecovery');
let isRunning = false;

module.exports = {
  retryGatewayTopUps: {
    task: async ({ strapi }) => {
      if (isRunning) {
        strapi.log.warn('Gateway TopUp retry task is already running. Skipping this run.');
        return;
      }

      if (!process.env.BYEMONEY_API_URL || !process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY) {
        strapi.log.warn('Gateway TopUp recovery skipped: ByeMoney delivery is not configured.');
        return;
      }

      isRunning = true;
      try {
        await recoverGatewayTopUps(strapi);
      } catch (error) {
        strapi.log.error(`Gateway TopUp retry failed: ${error.message}`);
      } finally {
        isRunning = false;
      }
    },
    options: { rule: '0 * * * * *' },
  },
};

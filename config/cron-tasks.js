'use strict';

const { recoverGatewayTopUps } = require('../src/services/gatewayTopUpRecovery');
const { recoverGatewayReviews } = require('../src/services/gatewayReviewRecovery');
let isRunning = false;

module.exports = {
  retryGatewayTopUps: {
    task: async ({ strapi }) => {
      if (isRunning) {
        strapi.log.warn('Gateway TopUp retry task is already running. Skipping this run.');
        return;
      }

      isRunning = true;
      try {
        await recoverGatewayReviews(strapi);
        if (process.env.BYEMONEY_API_URL && process.env.STRAPI_TO_BYEMONEY_SERVICE_KEY)
          await recoverGatewayTopUps(strapi);
      } catch (error) {
        strapi.log.error(`Gateway payment recovery failed: ${error.message}`);
      } finally {
        isRunning = false;
      }
    },
    options: { rule: '0 * * * * *' },
  },
};

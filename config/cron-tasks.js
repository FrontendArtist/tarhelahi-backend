'use strict';

let isRunning = false;

module.exports = {
  retryGatewayTopUps: {
    task: async ({ strapi }) => {
      if (isRunning) {
        strapi.log.warn('Gateway TopUp retry task is already running. Skipping this run.');
        return;
      }

      const baseUrl = process.env.NEXT_FRONTEND_URL;
      const key = process.env.BYEMONEY_SERVICE_KEY;
      if (!baseUrl || !key) {
        strapi.log.warn('Gateway TopUp retry skipped: NEXT_FRONTEND_URL or BYEMONEY_SERVICE_KEY is not configured.');
        return;
      }

      isRunning = true;
      try {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/payment/retry-topups`, {
          method: 'POST',
          headers: { 'X-Service-Key': key },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          strapi.log.error(`Gateway TopUp retry returned ${response.status}: ${text}`);
        }
      } catch (error) {
        strapi.log.error(`Gateway TopUp retry failed: ${error.message}`);
      } finally {
        isRunning = false;
      }
    },
    options: { rule: '0 * * * * *' },
  },
};

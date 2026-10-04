'use strict';

const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');
const { backfillLegacyCases } = require('../src/services/gatewayReviewRecovery');

async function main() {
  const apply = process.argv.includes('--apply');
  const app = await createStrapi({ distDir: path.resolve(__dirname, '..') }).load();
  try {
    const report = await backfillLegacyCases(app, { apply });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

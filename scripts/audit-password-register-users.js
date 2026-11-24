'use strict';

/**
 * M4 Remediation Script:
 * Identifies Iranian-phone accounts created via legacy unverified passwordRegister
 * (provider = 'local' and password IS NOT NULL) and optionally resets their password
 * so they must re-verify ownership via OTP on next login.
 *
 * Usage:
 *   node scripts/audit-password-register-users.js          # dry-run (default)
 *   node scripts/audit-password-register-users.js --apply  # clears password & sets isMobileVerified=false
 */

const path = require('path');
const { createStrapi } = require('@strapi/strapi');

const applyChanges = process.argv.includes('--apply');

function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return '***';
  return `${s.slice(0, 4)}***${s.slice(-3)}`;
}

async function main() {
  let app = null;
  try {
    app = await createStrapi({ distDir: path.resolve(__dirname, '..') }).load();
    const knex = app.db.connection;
    const userMeta = app.db.metadata.get('plugin::users-permissions.user');
    const tableName = userMeta?.tableName || 'up_users';

    const candidates = await knex(tableName)
      .where({ provider: 'local' })
      .whereNotNull('password')
      .andWhere(function () {
        this.where('is_foreigner', false).orWhereNull('is_foreigner');
      })
      .select('id', 'phone_number', 'username', 'is_mobile_verified', 'created_at');

    const iranianCandidates = candidates.filter((row) => {
      const phone = String(row.phone_number || row.username || '').trim();
      return /^09\d{9}$/.test(phone);
    });

    console.log(`[M4 Audit] Found ${iranianCandidates.length} Iranian local-password account(s).`);
    for (const row of iranianCandidates) {
      console.log(
        `  - userId=${row.id}, phone=${maskPhone(row.phone_number || row.username)}, verified=${Boolean(row.is_mobile_verified)}`
      );
    }

    if (!applyChanges) {
      console.log('[M4 Audit] Dry-run complete. Re-run with --apply to clear passwords and force OTP re-verification.');
      return;
    }

    if (iranianCandidates.length > 0) {
      const ids = iranianCandidates.map((r) => r.id);
      const updated = await knex(tableName)
        .whereIn('id', ids)
        .update({
          password: null,
          is_mobile_verified: false,
          updated_at: new Date(),
        });
      console.log(`[M4 Audit] Reset password & is_mobile_verified=false for ${updated} account(s).`);
    }
  } finally {
    if (app) {
      await app.destroy();
    }
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[M4 Audit] Error:', err);
  process.exit(1);
});

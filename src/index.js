// path: backend/src/index.js
'use strict';

const { resolveFilePath, asyncLocalStorage } = require('./utils/uploadPath');

module.exports = {
  /**
   * The register hook runs before the application is fully initialized.
   */
  register({ strapi }) {
    strapi.documents.use(require('./services/physicalStockMiddleware').documentMiddleware(strapi));
    strapi.documents.use(require('./services/chapterIdentity').documentMiddleware(strapi));
    strapi.documents.use(require('./services/chapterDeletionGuard').documentMiddleware(strapi));
    strapi.documents.use(require('./services/productBoxTypeMiddleware').documentMiddleware(strapi));
    strapi.documents.use(require('./services/shippingSettingMiddleware').documentMiddleware(strapi));
    // فقط سفارش تازه نور می‌گیرد؛ انتشار مجدد یا ویرایش سابقه، واحد قدیمی را تغییر نمی‌دهد.
    strapi.documents.use(async (context, next) => {
      if (context.uid === 'api::order.order' && ['create', 'clone'].includes(context.action)) {
        context.params.data = {
          ...context.params.data,
          currency: 'noor',
        };
      }

      return next();
    });
    strapi.documents.use(require('./services/financialEnums').documentMiddleware(strapi));

    strapi.server.app.proxy = true;

    // ثبت middleware سراسری برای نگه‌داری context درخواست به صورت async-safe
    strapi.server.use((ctx, next) => {
      return asyncLocalStorage.run(ctx, next);
    });
  },

  /**
   * Bootstrap: آماده‌سازی upload provider و اعمال مسیر اختصاصی
   */
  async bootstrap({ strapi }) {
    require('./utils/validateProductionEnv').validateProductionEnv();

    const { revokeSensitivePublicPermissions } = require('./services/securityPermissions');
    await revokeSensitivePublicPermissions(strapi);

    const { migrateFinancialEnums, registerDbLifecycles } = require('./services/financialEnums');
    await migrateFinancialEnums(strapi);
    registerDbLifecycles(strapi);

    const { getThresholdMinutes } = require('./services/gatewayReviewRecovery');
    await getThresholdMinutes(strapi);

    // فقط اثرانگشت؛ کلید و نشانی خام لاگ نمی‌شوند و مسیر HTTP ندارند.
    require('./services/postexShippingQuote').logConfigFingerprint(strapi);

    try {
      const postexLocality = require('./services/postexLocalitySync');
      const { ensureDefaultOrigin } = require('./services/shippingOrigins');
      const { ensureShippingCmLabels } = require('./services/shippingCmLabels');
      const { syncShippingSettingRate } = require('./services/byeMoneySettingsService');
      const { ensureCollectionType } = require('./services/shippingCollection');
      await postexLocality.ensureLocalityBootstrap(strapi);
      await ensureDefaultOrigin(strapi);
      await syncShippingSettingRate(strapi);
      await ensureCollectionType(strapi);
      await ensureShippingCmLabels(strapi);
    } catch (error) {
      strapi.log.warn(
        `[ShippingOrigin] locality/origin bootstrap skipped: ${error instanceof Error ? error.message : error}`,
      );
    }

    const uploadPlugin = strapi.plugin('upload');
    if (!uploadPlugin) return;

    const providerName = strapi.config.get('plugin::upload.provider', '');
    if (providerName !== 'aws-s3') {
      strapi.log.info('[Storage] Local upload provider detected, skipping S3 path middleware.');
      return;
    }

    const provider = uploadPlugin.provider;
    if (!provider) {
      strapi.log.warn('[Storage] Upload provider not initialized yet.');
      return;
    }

    const originalUpload = provider.upload?.bind(provider);
    const originalUploadStream = provider.uploadStream?.bind(provider);

    async function ensureFilePath(file) {
      const resolvedPath = await resolveFilePath(file, strapi);
      if (resolvedPath !== file.path) {
        file.path = resolvedPath;
      }
    }

    if (originalUpload) {
      provider.upload = async (file, customParams = {}) => {
        await ensureFilePath(file);
        return originalUpload(file, customParams);
      };
    }

    if (originalUploadStream) {
      provider.uploadStream = async (file, customParams = {}) => {
        await ensureFilePath(file);
        return originalUploadStream(file, customParams);
      };
    }

    strapi.log.info('[Storage] Enhanced upload path middleware registered with referer & voice detection.');
  },
};

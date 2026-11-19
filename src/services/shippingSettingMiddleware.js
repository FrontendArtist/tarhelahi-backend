'use strict';

const { getRialToNoorRate } = require('./byeMoneySettingsService');

const SHIPPING_SETTING_UID = 'api::shipping-setting.shipping-setting';

function documentMiddleware(strapi) {
  return async (context, next) => {
    if (context.uid !== SHIPPING_SETTING_UID) {
      return next();
    }

    // در زمان ایجاد، ویرایش یا کلون، مقدار نرخ ارسال همواره با نرخ بای‌مانی هماهنگ باشد
    if (['create', 'update', 'clone'].includes(context.action)) {
      try {
        const rate = await getRialToNoorRate();
        if (rate) {
          context.params = context.params || {};
          context.params.data = {
            ...(context.params.data || {}),
            rialPerNoorForShipping: String(rate),
          };
        }
      } catch (err) {
        strapi.log?.warn?.(
          `[ShippingSettingMiddleware] Failed to enforce ByeMoney rate on ${context.action}: ${err.message}`,
        );
      }
    }

    const result = await next();

    // در زمان خواندن (از جمله صفحه ادمین کانتنت‌منیجر)، نرخ مستقیماً از بای‌مانی نمایش داده شود
    if (['findFirst', 'findMany', 'findOne'].includes(context.action)) {
      try {
        const rate = await getRialToNoorRate();
        if (rate) {
          const rateStr = String(rate);
          if (Array.isArray(result)) {
            result.forEach((item) => {
              if (item && typeof item === 'object') {
                item.rialPerNoorForShipping = rateStr;
              }
            });
          } else if (result && typeof result === 'object') {
            result.rialPerNoorForShipping = rateStr;
          }
        }
      } catch (err) {
        strapi.log?.warn?.(
          `[ShippingSettingMiddleware] Failed to attach ByeMoney rate on ${context.action}: ${err.message}`,
        );
      }
    }

    return result;
  };
}

module.exports = { documentMiddleware };

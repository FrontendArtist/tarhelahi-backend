'use strict';

module.exports = {
  async afterCreate(event) {
    try {
      const { result } = event;
      const targetId = result?.id || result?.documentId;
      if (targetId) {
        await strapi
          .service('api::notification.notification')
          ?.syncMessageNotification(targetId, 'api::message.message');
      }
    } catch (err) {
      console.error('[Message Lifecycle afterCreate Error]:', err?.message || err);
    }
  },

  async afterUpdate(event) {
    try {
      const { result } = event;
      const targetId = result?.id || result?.documentId;
      if (targetId) {
        await strapi
          .service('api::notification.notification')
          ?.syncMessageNotification(targetId, 'api::message.message');
      }
    } catch (err) {
      console.error('[Message Lifecycle afterUpdate Error]:', err?.message || err);
    }
  },
};


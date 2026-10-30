'use strict';

module.exports = {
  async afterCreate(event) {
    try {
      const { result } = event;
      const targetId = result?.id || result?.documentId;
      if (targetId) {
        await strapi
          .service('api::notification.notification')
          ?.syncMessageNotification(targetId, 'api::contact-message.contact-message');
      }
    } catch (err) {
      console.error('[ContactMessage Lifecycle afterCreate Error]:', err?.message || err);
    }
  },

  async afterUpdate(event) {
    try {
      const { result } = event;
      const targetId = result?.id || result?.documentId;
      if (targetId) {
        await strapi
          .service('api::notification.notification')
          ?.syncMessageNotification(targetId, 'api::contact-message.contact-message');
      }
    } catch (err) {
      console.error('[ContactMessage Lifecycle afterUpdate Error]:', err?.message || err);
    }
  },
};


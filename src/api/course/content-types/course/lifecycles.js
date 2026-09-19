'use strict';

const crypto = require('crypto');

/**
 * Ensures all chapters in the array have a stable integrationId (UUID).
 * If a chapter already has a valid integrationId, it is preserved.
 * If missing, it reuses existing from DB (if matching component id exists) or generates a new randomUUID.
 *
 * @param {Array<object>} chapters - Array of chapter components
 * @param {Array<object>} [existingChapters=[]] - Pre-existing chapters from DB
 * @returns {Array<object>}
 */
function ensureChapterIntegrationIds(chapters, existingChapters = []) {
  if (!Array.isArray(chapters)) return chapters;

  const existingMap = new Map();
  for (const ch of existingChapters) {
    if (ch?.id && ch?.integrationId) {
      existingMap.set(Number(ch.id), ch.integrationId);
    }
  }

  return chapters.map((chapter) => {
    if (!chapter || typeof chapter !== 'object') return chapter;

    if (typeof chapter.integrationId === 'string' && chapter.integrationId.trim()) {
      return {
        ...chapter,
        integrationId: chapter.integrationId.trim(),
      };
    }

    if (chapter.id && existingMap.has(Number(chapter.id))) {
      return {
        ...chapter,
        integrationId: existingMap.get(Number(chapter.id)),
      };
    }

    return {
      ...chapter,
      integrationId: crypto.randomUUID(),
    };
  });
}

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    if (!data || !Array.isArray(data.chapters)) return;

    data.chapters = ensureChapterIntegrationIds(data.chapters);
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    if (!data || !Array.isArray(data.chapters)) return;

    let existingChapters = [];
    try {
      if (where) {
        const existingCourse = await strapi.db.query('api::course.course').findOne({
          where,
          populate: ['chapters'],
        });
        existingChapters = existingCourse?.chapters || [];
      }
    } catch {
      // Fallback: continue without existing chapters map
    }

    data.chapters = ensureChapterIntegrationIds(data.chapters, existingChapters);
  },
};

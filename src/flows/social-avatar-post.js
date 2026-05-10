// src/flows/social-avatar-post.js
// Use case 2 — Genère une video avatar courte (15-30s) pour les réseaux sociaux.
// Sélectionne un template depuis data/zm-video-calendar.json (rotation hebdo)
// puis appelle HeyGen. Le cron poll-renders prendra le relais pour télécharger,
// uploader Supabase, et publier (Buffer/Meta).

const path = require('path');
const fs = require('fs');
const heygen = require('../lib/heygen');

const CALENDAR_PATH = path.join(__dirname, '..', '..', 'data', 'zm-video-calendar.json');

function _loadCalendar() {
  try {
    return JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf-8'));
  } catch (e) {
    console.warn(`[heygen:social] cannot load calendar: ${e.message}`);
    return { templates: [] };
  }
}

function _weekIndex(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = (date - start) / 86400000;
  return Math.floor(diff / 7);
}

function pickTemplate(calendar, override) {
  if (!calendar?.templates?.length) return null;
  if (override?.template_id) {
    return calendar.templates.find(t => t.id === Number(override.template_id)) || null;
  }
  const idx = _weekIndex() % calendar.templates.length;
  return calendar.templates[idx];
}

/**
 * Génère un post social avatar.
 * @param {object} [opts]
 * @param {number} [opts.template_id]   Force un template spécifique (sinon rotation hebdo)
 * @param {string} [opts.platform]      'instagram' | 'tiktok' | 'facebook' (sinon premier supporté)
 * @returns {Promise<{ok, video_id?, template_id?, platform?, error?}>}
 */
async function generateSocialAvatarPost(opts = {}) {
  const avatarId = process.env.HEYGEN_DEFAULT_AVATAR_ID;
  const voiceId = process.env.HEYGEN_DEFAULT_VOICE_ID;
  const backgroundUrl = process.env.HEYGEN_BACKGROUND_URL || undefined;

  if (!avatarId || !voiceId) {
    return { ok: false, error: 'HEYGEN_DEFAULT_AVATAR_ID or HEYGEN_DEFAULT_VOICE_ID missing' };
  }

  const calendar = _loadCalendar();
  const tpl = pickTemplate(calendar, opts);
  if (!tpl) return { ok: false, error: 'no template available' };

  const platform = opts.platform || (tpl.platform && tpl.platform[0]) || 'instagram';

  const gen = await heygen.generateVideo({
    avatarId,
    voiceId,
    script: tpl.script,
    dimension: '9:16',
    backgroundUrl,
    avatarType: process.env.HEYGEN_AVATAR_TYPE || 'talking_photo',
    title: `ZM social ${tpl.season} #${tpl.id}`,
    test: process.env.HEYGEN_TEST_MODE === 'true',
  });

  if (!gen.ok) {
    console.warn(`[heygen:social tpl=${tpl.id}] generateVideo failed: ${gen.error}`);
    return gen;
  }

  const rec = await heygen.recordRender({
    videoId: gen.video_id,
    useCase: 'social_post',
    bookingId: null,
    socialMeta: {
      template_id: tpl.id,
      season: tpl.season,
      moto_id: tpl.moto_id,
      platform,
      caption: tpl.caption,
      hashtags: tpl.hashtags,
      scheduled_for: new Date().toISOString(),
    },
    script: tpl.script,
  });

  if (!rec.ok) {
    console.warn(`[heygen:social tpl=${tpl.id}] recordRender failed: ${rec.error}`);
  }

  console.log(`[heygen:social] queued template=${tpl.id} (${tpl.season}) → ${platform} | video_id=${gen.video_id}`);
  return { ok: true, video_id: gen.video_id, template_id: tpl.id, platform };
}

module.exports = { generateSocialAvatarPost, pickTemplate, _loadCalendar };

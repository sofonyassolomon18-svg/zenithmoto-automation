const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── TELEGRAM TIKTOK DIGEST ──────────────────────────────────────────────────
// Buffer ne supporte pas l'API TikTok text-only (token OIDC invalide pour API v1).
// Fallback : on accumule les scripts TikTok du jour et on envoie un digest Telegram
// à la fin du batch — copier-coller 1-clic pour publication manuelle.
const _tiktokQueue = [];

async function flushTikTokTelegram() {
  const TG_BOT  = process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG_BOT || !TG_CHAT || _tiktokQueue.length === 0) return;

  const date = new Date().toLocaleDateString('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
  const header = `*ZenithMoto — Scripts TikTok du ${date}*\n_Copie-colle directement sur TikTok (${_tiktokQueue.length} moto${_tiktokQueue.length > 1 ? 's' : ''})_\n`;

  const blocks = _tiktokQueue.map((item, i) =>
    `\n*${i + 1}. ${item.moto}*\n${item.script}`
  );

  const text = header + blocks.join('\n\n---');

  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
      chat_id: TG_CHAT,
      text,
      parse_mode: 'Markdown',
    }, { timeout: 10000 });
    console.log(`    [TikTok] Digest Telegram envoyé (${_tiktokQueue.length} scripts)`);
    _tiktokQueue.length = 0;
  } catch (e) {
    console.warn(`    [TikTok] Telegram digest failed: ${e.message}`);
  }
}

const PUBLISH_LOG = path.join(__dirname, '..', 'logs', 'publish.csv');

function logPublish(moto, platform, status, postId = '') {
  if (!fs.existsSync(PUBLISH_LOG)) {
    fs.writeFileSync(PUBLISH_LOG, 'Date,Moto,Platform,Status,PostId\n');
  }
  fs.appendFileSync(PUBLISH_LOG, `${new Date().toISOString()},${moto},${platform},${status},${postId}\n`);
}

// ─── FACEBOOK ────────────────────────────────────────────────────────────────

async function publishFacebook(text, moto) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !token) {
    console.log('    ⏭️  Facebook: clés manquantes (FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN)');
    logPublish(moto, 'facebook', 'SKIPPED_NO_KEY');
    return null;
  }

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/feed`,
      { message: text, access_token: token }
    );
    logPublish(moto, 'facebook', 'OK', res.data.id);
    return res.data.id;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.error(`    ❌ Facebook error: ${msg}`);
    logPublish(moto, 'facebook', 'ERROR');
    return null;
  }
}

// ─── INSTAGRAM ───────────────────────────────────────────────────────────────

async function publishInstagram(caption, imageUrl, moto) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !token) {
    console.log('    ⏭️  Instagram: clés manquantes (INSTAGRAM_USER_ID / INSTAGRAM_ACCESS_TOKEN)');
    logPublish(moto, 'instagram', 'SKIPPED_NO_KEY');
    return null;
  }

  if (!imageUrl) {
    console.log('    ⏭️  Instagram: pas d\'image URL pour cette moto');
    logPublish(moto, 'instagram', 'SKIPPED_NO_IMAGE');
    return null;
  }

  try {
    // Step 1: create media container
    const container = await axios.post(
      `https://graph.facebook.com/v19.0/${userId}/media`,
      { image_url: imageUrl, caption, access_token: token }
    );

    // Step 2: publish
    const publish = await axios.post(
      `https://graph.facebook.com/v19.0/${userId}/media_publish`,
      { creation_id: container.data.id, access_token: token }
    );

    logPublish(moto, 'instagram', 'OK', publish.data.id);
    return publish.data.id;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.error(`    ❌ Instagram error: ${msg}`);
    logPublish(moto, 'instagram', 'ERROR');
    return null;
  }
}

// ─── MAIN PUBLISH ─────────────────────────────────────────────────────────────

async function publishPost({ moto, posts, imageUrl }) {
  const results = {};

  // Facebook — text seul, fonctionne sans image
  if (posts.facebook) {
    process.stdout.write('    📘 Facebook...');
    const id = await publishFacebook(posts.facebook, moto);
    console.log(id ? ` ✅ (${id})` : '');
    results.facebook = id;
  }

  // Instagram — besoin d'une image
  if (posts.instagram) {
    process.stdout.write('    📸 Instagram...');
    const id = await publishInstagram(posts.instagram, imageUrl, moto);
    console.log(id ? ` ✅ (${id})` : '');
    results.instagram = id;
  }

  // TikTok — Buffer API invalide (OIDC token) : on accumule le script dans la queue
  // Telegram digest envoyé après le dernier post du batch (voir flushTikTokTelegram)
  if (posts.tiktok) {
    _tiktokQueue.push({ moto, script: posts.tiktok });
    logPublish(moto, 'tiktok', 'QUEUED_TELEGRAM');
    process.stdout.write('    🎵 TikTok... queued for Telegram digest\n');
  }

  return results;
}

// ─── INSTAGRAM REELS (video) ─────────────────────────────────────────────────
// Pour les avatars HeyGen — publication d'une video 9:16 vers Reels.
// Doc Meta : https://developers.facebook.com/docs/instagram-api/guides/content-publishing
async function publishInstagramReel(caption, videoUrl, moto = 'avatar-post') {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!userId || !token) {
    logPublish(moto, 'instagram-reel', 'SKIPPED_NO_KEY');
    return null;
  }
  if (!videoUrl) {
    logPublish(moto, 'instagram-reel', 'SKIPPED_NO_VIDEO');
    return null;
  }
  try {
    // Step 1: create REELS container
    const container = await axios.post(
      `https://graph.facebook.com/v19.0/${userId}/media`,
      { media_type: 'REELS', video_url: videoUrl, caption, access_token: token },
      { timeout: 30000 }
    );
    const creationId = container.data.id;
    // Step 2: poll status until FINISHED (Meta needs 30-90s to ingest video)
    let attempts = 0;
    while (attempts < 20) {
      await new Promise(r => setTimeout(r, 5000));
      const st = await axios.get(
        `https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${token}`,
        { timeout: 10000 }
      );
      if (st.data.status_code === 'FINISHED') break;
      if (st.data.status_code === 'ERROR') throw new Error('Meta ingest ERROR');
      attempts++;
    }
    // Step 3: publish
    const publish = await axios.post(
      `https://graph.facebook.com/v19.0/${userId}/media_publish`,
      { creation_id: creationId, access_token: token },
      { timeout: 30000 }
    );
    logPublish(moto, 'instagram-reel', 'OK', publish.data.id);
    return publish.data.id;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.error(`    ❌ Instagram Reel error: ${msg}`);
    logPublish(moto, 'instagram-reel', 'ERROR');
    return null;
  }
}

// Facebook video post (uses Page video endpoint)
async function publishFacebookVideo(caption, videoUrl, moto = 'avatar-post') {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!pageId || !token) {
    logPublish(moto, 'facebook-video', 'SKIPPED_NO_KEY');
    return null;
  }
  try {
    const r = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/videos`,
      { file_url: videoUrl, description: caption, access_token: token },
      { timeout: 60000 }
    );
    logPublish(moto, 'facebook-video', 'OK', r.data.id);
    return r.data.id;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.error(`    ❌ Facebook video error: ${msg}`);
    logPublish(moto, 'facebook-video', 'ERROR');
    return null;
  }
}

module.exports = { publishPost, flushTikTokTelegram, publishInstagramReel, publishFacebookVideo };

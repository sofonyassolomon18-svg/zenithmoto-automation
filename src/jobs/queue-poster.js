const fs = require('fs');
const path = require('path');
const axios = require('axios');

// State stored in Railway persistent volume (/app/var/) so deploys don't reset it
const VAR_DIR = process.env.RAILWAY_ENVIRONMENT
  ? '/app/var'
  : path.join(__dirname, '../../var');
fs.mkdirSync(VAR_DIR, { recursive: true });

const QUEUE_STATE_PATH = path.join(VAR_DIR, 'post-queue-state.json');
const QUEUE_TEMPLATE_PATH = path.join(__dirname, '../../data/post-queue.json');

function loadQueue() {
  // State file exists → use it (persists across deploys)
  if (fs.existsSync(QUEUE_STATE_PATH)) {
    try { return JSON.parse(fs.readFileSync(QUEUE_STATE_PATH, 'utf8')); }
    catch { /* corrupted — fall through to template */ }
  }
  // First run: copy template to persistent location
  if (!fs.existsSync(QUEUE_TEMPLATE_PATH)) {
    // Template missing → return empty queue rather than crash
    const empty = { posts: [] };
    fs.writeFileSync(QUEUE_STATE_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  const template = JSON.parse(fs.readFileSync(QUEUE_TEMPLATE_PATH, 'utf8'));
  fs.writeFileSync(QUEUE_STATE_PATH, JSON.stringify(template, null, 2));
  return template;
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_STATE_PATH, JSON.stringify(queue, null, 2));
}

function logPost(moto, platform, status, postId = '') {
  const LOG = path.join(__dirname, '../../logs/social-posts.csv');
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'Date,Moto,Platform,Status,PostId\n');
  fs.appendFileSync(LOG, `${new Date().toISOString()},${moto},${platform},${status},${postId}\n`);
}

async function postPhotoFacebook(imageUrl, caption, moto) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) {
    console.log('    ⏭️  FB photo: FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN manquants');
    logPost(moto, 'facebook', 'SKIPPED_NO_KEY');
    return null;
  }
  try {
    const res = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
      url: imageUrl,
      caption,
      access_token: token,
    });
    logPost(moto, 'facebook', 'OK', res.data.id);
    console.log(`    ✅ FB photo posted: ${res.data.id}`);
    return res.data.id;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.error(`    ❌ FB photo error: ${msg}`);
    logPost(moto, 'facebook', 'ERROR');
    return null;
  }
}

async function postPhotoInstagram(imageUrl, caption, moto) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!userId || !token) {
    console.log('    ⏭️  IG: INSTAGRAM_USER_ID manquant — lier compte IG à la Page FB d\'abord');
    logPost(moto, 'instagram', 'SKIPPED_NO_IG');
    return null;
  }
  try {
    const container = await axios.post(`https://graph.facebook.com/v19.0/${userId}/media`, {
      image_url: imageUrl, caption, access_token: token,
    });
    const publish = await axios.post(`https://graph.facebook.com/v19.0/${userId}/media_publish`, {
      creation_id: container.data.id, access_token: token,
    });
    logPost(moto, 'instagram', 'OK', publish.data.id);
    console.log(`    ✅ IG photo posted: ${publish.data.id}`);
    return publish.data.id;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.error(`    ❌ IG photo error: ${msg}`);
    logPost(moto, 'instagram', 'ERROR');
    return null;
  }
}

async function notifyTelegram(text) {
  const TG_BOT  = process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG_BOT || !TG_CHAT) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`,
      { chat_id: TG_CHAT, text, parse_mode: 'Markdown' }, { timeout: 8000 });
  } catch (e) { console.warn('[queue-poster] TG failed:', e.message); }
}

async function runQueuePoster() {
  console.log('\n[queue-poster] Lecture post-queue.json...');
  let queue;
  try {
    queue = loadQueue();
  } catch (e) {
    console.error('[queue-poster] loadQueue failed:', e.message);
    await notifyTelegram(`❌ *Queue poster* : impossible de charger la queue — ${e.message}`);
    return;
  }

  const pending = queue.posts.filter(p => !p.posted);

  if (pending.length === 0) {
    console.log('[queue-poster] Queue vide — tous les posts publiés');
    return;
  }

  const post = pending[0];
  console.log(`[queue-poster] Post #${post.id} — ${post.moto}`);

  const results = {};
  results.fb = await postPhotoFacebook(post.image_url, post.caption, post.moto);
  results.ig = await postPhotoInstagram(post.image_url, post.caption, post.moto);

  const idx = queue.posts.findIndex(p => p.id === post.id);
  queue.posts[idx].posted = true;
  queue.posts[idx].posted_at = new Date().toISOString();
  queue.posts[idx].results = results;
  saveQueue(queue);

  const remaining = pending.length - 1;
  const fbOk = !!results.fb;
  const igOk = !!results.ig;
  console.log(`[queue-poster] ✅ Terminé. ${remaining} posts restants dans la queue.`);

  // Telegram summary
  const statusLine = `FB: ${fbOk ? '✅ ' + results.fb : '⚠️ skip/err'} · IG: ${igOk ? '✅ ' + results.ig : '⚠️ skip/err'}`;
  await notifyTelegram(
    `📸 *Queue poster* : ${post.moto}\n${statusLine}\n${remaining} post${remaining !== 1 ? 's' : ''} restant${remaining !== 1 ? 's' : ''}`
  );

  return results;
}

module.exports = { runQueuePoster };

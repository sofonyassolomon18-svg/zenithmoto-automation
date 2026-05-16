const fs = require('fs');
const path = require('path');
const axios = require('axios');

const QUEUE_PATH = path.join(__dirname, '../../data/post-queue.json');

function loadQueue() {
  return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
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

async function runQueuePoster() {
  console.log('\n[queue-poster] Lecture post-queue.json...');
  const queue = loadQueue();
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
  console.log(`[queue-poster] ✅ Terminé. ${remaining} posts restants dans la queue.`);
  return results;
}

module.exports = { runQueuePoster };

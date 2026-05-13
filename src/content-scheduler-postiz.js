// content-scheduler-postiz.js — Weekly Sunday 18h: schedule 1 IG+FB post/moto/week via Postiz.
// Photos rotated from Supabase storage `zenithmoto-content/flotte/<slug>/`.
// Caption generated via ask-llm --task=caption with moto specs.
// Skip silently if POSTIZ_API_URL or POSTIZ_API_KEY absent.
require('dotenv').config();
const axios = require('axios');
const { spawn } = require('child_process');

const SUPA_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const POSTIZ_URL = process.env.POSTIZ_API_URL;
const POSTIZ_KEY = process.env.POSTIZ_API_KEY;
const TG_BOT  = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

const FLEET = [
  { slug: 'yamaha-tracer-700', label: 'Yamaha Tracer 700', specs: 'roadster sport 689cc, 75ch, dès 120 CHF/jour' },
  { slug: 'yamaha-tmax-530',   label: 'Yamaha TMAX 530',   specs: 'scooter premium 530cc, sportif, dès 100 CHF/jour' },
  { slug: 'honda-x-adv-750',   label: 'Honda X-ADV 750',   specs: 'adventure scooter 745cc, DCT, dès 120 CHF/jour' },
  { slug: 'yamaha-x-max-300',  label: 'Yamaha X-Max 300',  specs: 'scooter 292cc polyvalent, dès 80 CHF/jour' },
  { slug: 'yamaha-x-max-125',  label: 'Yamaha X-Max 125',  specs: 'scooter 125cc, permis B7, dès 65 CHF/jour' },
];

async function listMotoPhotos(slug) {
  if (!SUPA_KEY) return [];
  try {
    const r = await axios.post(
      `${SUPA_URL}/storage/v1/object/list/zenithmoto-content`,
      { prefix: `flotte/${slug}/`, limit: 50 },
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    return (r.data || [])
      .filter(o => /\.(jpg|jpeg|png|webp)$/i.test(o.name))
      .map(o => `${SUPA_URL}/storage/v1/object/public/zenithmoto-content/flotte/${slug}/${o.name}`);
  } catch (e) {
    console.warn(`[content-scheduler] list ${slug} failed:`, e.message);
    return [];
  }
}

function generateCaptionFallback(moto) {
  // Used if ask-llm CLI unavailable
  return `🏍️ ${moto.label} — ${moto.specs}\n\nLouez-la à Bienne sur zenithmoto.ch\nLivraison possible · Casque inclus\n\n#zenithmoto #motolocation #bienne #biel #suisse #moto #ride #yamaha #honda #motorcycle #motolife #weekend #adventure #escape #freedom`;
}

async function generateCaption(moto) {
  return new Promise((resolve) => {
    try {
      const prompt = `Génère une caption Instagram FR pour location moto ${moto.label} (${moto.specs}). Ton premium aventurier. 3 phrases courtes + 12-15 hashtags suisses pertinents. CTA réservation zenithmoto.ch.`;
      const proc = spawn('ask-llm', ['--task=caption', prompt], { shell: true });
      let out = '';
      let timer = setTimeout(() => { proc.kill(); resolve(generateCaptionFallback(moto)); }, 15000);
      proc.stdout.on('data', d => out += d.toString());
      proc.on('close', () => { clearTimeout(timer); resolve(out.trim() || generateCaptionFallback(moto)); });
      proc.on('error', () => { clearTimeout(timer); resolve(generateCaptionFallback(moto)); });
    } catch (e) {
      resolve(generateCaptionFallback(moto));
    }
  });
}

async function schedulePost({ caption, imageUrl, publishAt, platforms }) {
  // Postiz API: POST /api/public/v1/posts (depends on Postiz version)
  // Schema: { date, posts: [{ integration: {id}, value: [{ content, image: [{url}] }] }] }
  // Here we use a generic shape; user maps to actual integration IDs via POSTIZ_INTEGRATION_IDS env (comma-sep).
  const integrationIds = (process.env.POSTIZ_INTEGRATION_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (integrationIds.length === 0) {
    return { skipped: true, reason: 'POSTIZ_INTEGRATION_IDS empty' };
  }
  const payload = {
    type: 'schedule',
    date: publishAt,
    posts: integrationIds.map(id => ({
      integration: { id },
      value: [{ content: caption, image: imageUrl ? [{ url: imageUrl }] : [] }],
    })),
  };
  try {
    const r = await axios.post(
      `${POSTIZ_URL.replace(/\/$/, '')}/api/public/v1/posts`,
      payload,
      { headers: { Authorization: POSTIZ_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return { ok: true, data: r.data };
  } catch (e) {
    return { ok: false, error: e.response?.data || e.message };
  }
}

function pickRotating(arr, weekIdx) {
  if (!arr.length) return null;
  return arr[weekIdx % arr.length];
}

function isoWeek(d = new Date()) {
  const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = a.getUTCDay() || 7;
  a.setUTCDate(a.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(a.getUTCFullYear(), 0, 1));
  return Math.ceil((((a - yearStart) / 86400000) + 1) / 7);
}

async function runContentSchedulerPostiz() {
  if (!POSTIZ_URL || !POSTIZ_KEY) {
    console.warn('[content-scheduler] POSTIZ_API_URL/KEY absents — skip');
    return { status: 'skipped', reason: 'no-postiz-config' };
  }

  const weekIdx = isoWeek();
  const results = [];
  // Schedule one post per moto, spread Mon-Fri 11h Europe/Zurich
  const baseMonday = new Date();
  const dayOfWeek = baseMonday.getDay();
  const daysUntilMonday = (8 - dayOfWeek) % 7 || 7;
  baseMonday.setDate(baseMonday.getDate() + daysUntilMonday);
  baseMonday.setHours(11, 0, 0, 0);

  for (let i = 0; i < FLEET.length; i++) {
    const moto = FLEET[i];
    const photos = await listMotoPhotos(moto.slug);
    const photo = pickRotating(photos, weekIdx);
    const caption = await generateCaption(moto);
    const publishAt = new Date(baseMonday.getTime() + i * 86400000).toISOString();
    const r = await schedulePost({ caption, imageUrl: photo, publishAt });
    results.push({ moto: moto.label, photo: !!photo, ok: !!r.ok, error: r.error || r.reason });
  }

  const summary = results.map(r =>
    `${r.ok ? '✅' : '❌'} ${r.moto}${r.error ? ` (${JSON.stringify(r.error).slice(0,80)})` : ''}`
  ).join('\n');
  if (TG_BOT && TG_CHAT) {
    try {
      await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`,
        { chat_id: TG_CHAT, text: `📅 *Content scheduler Postiz — semaine ${weekIdx}*\n${summary}`, parse_mode: 'Markdown' },
        { timeout: 8000 });
    } catch (e) { console.warn('[content-scheduler] TG failed:', e.message); }
  }
  return { status: 'ok', week: weekIdx, results };
}

module.exports = { runContentSchedulerPostiz };

if (require.main === module) {
  runContentSchedulerPostiz().then(r => { console.log(r); process.exit(0); });
}

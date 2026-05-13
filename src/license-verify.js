// license-verify.js — cron 1h: scan pending licenses, notify operator with preview + inline actions
const axios = require('axios');
const { select, upsert } = require('./lib/supabase');
const { notify } = require('./lib/telegram');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const BUCKET = 'zenithmoto-content';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_OPERATOR_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

function signedUrl(filePath, expiresSec = 3600) {
  // Build a Supabase signed URL via REST
  return axios.post(
    `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${filePath}`,
    { expiresIn: expiresSec },
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
      timeout: 8000,
    }
  ).then(r => `${SUPABASE_URL}/storage/v1${r.data.signedURL || r.data.signedUrl}`).catch(() => null);
}

async function sendOperatorAlert(lic) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const url = await signedUrl(lic.file_path);
  const caption = `🪪 Permis À VÉRIFIER\nBooking: ${lic.booking_id}\nFichier: ${lic.file_path.split('/').pop()}\nUploaded: ${lic.uploaded_at || lic.created_at}`;
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `license:approve:${lic.booking_id}` },
      { text: '❌ Reject', callback_data: `license:reject:${lic.booking_id}` },
    ]],
  };

  const isImage = /\.(jpe?g|png|webp|heic)$/i.test(lic.file_path);
  try {
    if (isImage && url) {
      await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
        chat_id: TG_CHAT,
        photo: url,
        caption,
        reply_markup: keyboard,
      }, { timeout: 8000 });
    } else {
      const text = url ? `${caption}\n${url}` : caption;
      await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        chat_id: TG_CHAT,
        text,
        reply_markup: keyboard,
      }, { timeout: 8000 });
    }
    await upsert('licenses', {
      booking_id: lic.booking_id,
      notified_at: new Date().toISOString(),
    }, { onConflict: 'booking_id' });
  } catch (e) {
    console.warn('[license-verify] notify error', e.message);
  }
}

async function scanPending() {
  const pending = await select(
    'licenses',
    `status=eq.pending&notified_at=is.null&select=*&limit=50`
  );
  if (!pending || !pending.length) return { count: 0 };
  for (const lic of pending) {
    await sendOperatorAlert(lic);
  }
  await notify(`Permis review: ${pending.length} uploaded, awaiting approval`, 'info', { project: 'zenithmoto' });
  return { count: pending.length };
}

// Express callback handler — to wire on webhook server: app.post('/telegram/callback', handleCallback)
async function handleCallback(callbackQuery) {
  // callback_data format: license:approve:<booking_id>
  const data = callbackQuery.data || '';
  const m = data.match(/^license:(approve|reject):(.+)$/);
  if (!m) return null;
  const [, action, bookingId] = m;
  const status = action === 'approve' ? 'approved' : 'rejected';

  await upsert('licenses', {
    booking_id: bookingId,
    status,
    verified_at: new Date().toISOString(),
    verifier_note: `via Telegram by ${callbackQuery.from?.username || callbackQuery.from?.id}`,
  }, { onConflict: 'booking_id' });

  await notify(
    `Permis ${status.toUpperCase()} booking ${bookingId}`,
    status === 'approved' ? 'success' : 'warn',
    { project: 'zenithmoto' }
  );
  return { bookingId, status };
}

if (require.main === module) {
  scanPending().then(r => {
    console.log('[license-verify]', r);
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { scanPending, handleCallback };

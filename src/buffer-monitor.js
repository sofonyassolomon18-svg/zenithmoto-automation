// Buffer access token health check
// Buffer tokens n'ont pas d'auto-refresh. On ping /1/user.json quotidiennement
// et on alerte Telegram si 401/403 (token expiré ou révoqué).

const axios = require('axios');

const BUFFER_API = 'https://api.bufferapp.com/1';
const TG_BOT  = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

async function notifyTelegram(text) {
  if (!TG_BOT || !TG_CHAT) {
    console.warn('[buffer-monitor] TELEGRAM non configuré — alerte non envoyée');
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`,
      { chat_id: TG_CHAT, text, parse_mode: 'Markdown' },
      { timeout: 5000 });
  } catch (e) {
    console.error('[buffer-monitor] Telegram failed:', e.message);
  }
}

async function runBufferMonitor() {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    console.warn('[buffer-monitor] BUFFER_ACCESS_TOKEN absent — skip');
    return { status: 'skipped', reason: 'no-token' };
  }

  try {
    const r = await axios.get(`${BUFFER_API}/user.json`, {
      params: { access_token: token },
      timeout: 10000,
      validateStatus: () => true, // on gère le status nous-mêmes
    });

    if (r.status === 200) {
      const userId = r.data?.id || 'unknown';
      console.log(`[buffer-monitor] OK · userId=${userId}`);
      return { status: 'ok', userId };
    }

    if (r.status === 401 || r.status === 403) {
      const msg = `🚨 *Buffer token expiré/révoqué* (HTTP ${r.status})\n` +
                  `Service : ZenithMoto Automation V1\n` +
                  `Action : régénérer un access token sur https://buffer.com/developers/apps\n` +
                  `Puis mettre à jour \`BUFFER_ACCESS_TOKEN\` sur Railway et redeploy.`;
      console.error(`[buffer-monitor] TOKEN INVALIDE (${r.status}):`, r.data);
      await notifyTelegram(msg);
      return { status: 'expired', httpStatus: r.status };
    }

    // Autre code (5xx, 429, ...) — on log mais on n'alerte pas (transient)
    console.warn(`[buffer-monitor] HTTP ${r.status} (transient?):`, r.data);
    return { status: 'transient', httpStatus: r.status };
  } catch (e) {
    console.error('[buffer-monitor] request failed:', e.message);
    return { status: 'error', error: e.message };
  }
}

module.exports = { runBufferMonitor };

// Buffer access token health check (GraphQL).
// REST v1 (bufferapp.com/1/user.json) rejette les tokens OIDC depuis 2024-2025.
// Migration vers api.buffer.com/graphql qui accepte le Bearer OIDC.

const axios = require('axios');
const buffer = require('./publishers/buffer');

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
    const account = await buffer.ping();
    if (account?.id) {
      console.log(`[buffer-monitor] OK · accountId=${account.id}`);
      return { status: 'ok', accountId: account.id };
    }
    console.warn('[buffer-monitor] account vide — réponse inattendue');
    return { status: 'transient', reason: 'empty-account' };
  } catch (e) {
    const msg = e.message || '';
    const isAuth = /401|403|unauthorized|forbidden|token/i.test(msg);
    if (isAuth) {
      const alert = `🚨 *Buffer token expiré/révoqué* (GraphQL)\n` +
                    `Service : ZenithMoto Automation V1\n` +
                    `Action : régénérer un access token sur https://buffer.com/developers/apps\n` +
                    `Puis mettre à jour \`BUFFER_ACCESS_TOKEN\` sur Railway et redeploy.`;
      console.error('[buffer-monitor] TOKEN INVALIDE:', msg);
      await notifyTelegram(alert);
      return { status: 'expired', error: msg };
    }
    console.warn('[buffer-monitor] erreur transitoire:', msg);
    return { status: 'transient', error: msg };
  }
}

module.exports = { runBufferMonitor };

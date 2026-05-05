// lib/telegram.js — wrapper unifié notifications (Telegram + Slack + Discord)
// Partagé WebMake / ZenithMoto. Dépendance : axios (déjà installé).
const axios = require('axios');

const ICONS = {
  info: 'ℹ️',
  success: '✅',
  warn: '⚠️',
  warning: '⚠️',
  error: '❌',
  money: '💰',
};

async function notify(text, level = 'info', opts = {}) {
  const icon = ICONS[level] || ICONS.info;
  const project = opts.project || process.env.NOTIFY_PROJECT || 'app';
  const message = `${icon} *${project}* — ${text}`;
  const calls = [];

  if (process.env.SLACK_WEBHOOK_URL) {
    calls.push(
      axios.post(process.env.SLACK_WEBHOOK_URL, { text: message }, { timeout: 5000 })
        .catch(e => console.warn('[telegram-lib:slack]', e.message))
    );
  }
  if (process.env.DISCORD_WEBHOOK_URL) {
    calls.push(
      axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message }, { timeout: 5000 })
        .catch(e => console.warn('[telegram-lib:discord]', e.message))
    );
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    calls.push(
      axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        { chat_id: process.env.TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' },
        { timeout: 5000 }
      ).catch(e => console.warn('[telegram-lib:telegram]', e.message))
    );
  }
  await Promise.all(calls);
}

module.exports = { notify };

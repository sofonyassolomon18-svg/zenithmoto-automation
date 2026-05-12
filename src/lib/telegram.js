// lib/telegram.js — unified notifications (Telegram + Slack + Discord) + funnel_events dual-write
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const ICONS = {
  info: 'ℹ️',
  success: '✅',
  warn: '⚠️',
  warning: '⚠️',
  error: '❌',
  money: '💰',
};

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

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

// Maps funnel event kind to emoji for Telegram message
const KIND_EMOJI = {
  prospect: '🔔',
  checkout: '💳',
  paid: '✅',
  failed: '❌',
  cancelled: '⚠️',
};

/**
 * trackEvent — dual-write: Telegram alert + Supabase funnel_events INSERT
 *
 * Schema (funnel_events):
 *   kind          funnel_event_kind  NOT NULL  — 'prospect'|'checkout'|'paid'|'failed'|'cancelled'
 *   occurred_at   timestamptz        DEFAULT now()
 *   source        text               DEFAULT 'v1'
 *   booking_id    text
 *   customer      text               — customer first name or full name
 *   moto          text               — moto slug or display name
 *   amount_chf    numeric(10,2)
 *   meta          jsonb              DEFAULT '{}'
 */
async function trackEvent({ kind, booking_id, customer, moto, amount_chf, meta, source } = {}) {
  const emoji = KIND_EMOJI[kind] || '📌';
  const amt = amount_chf ? ` CHF ${amount_chf}` : '';
  const msg = `${emoji} ${(kind || 'event').toUpperCase()}: ${customer || '?'} ${moto || ''}${amt}`.trim();

  // Fire Telegram (non-blocking, never throws)
  notify(msg, 'info', { project: 'zenithmoto' }).catch(() => {});

  // Insert into funnel_events (non-blocking, never throws)
  if (supabase) {
    supabase
      .from('funnel_events')
      .insert({
        kind,
        booking_id: booking_id || null,
        customer: customer || null,
        moto: moto || null,
        amount_chf: amount_chf || null,
        meta: meta || {},
        source: source || 'v1',
      })
      .then(({ error }) => {
        if (error) console.warn('[funnel] insert failed:', error.message);
      })
      .catch(e => console.warn('[funnel] insert error:', e.message));
  }
}

module.exports = { notify, trackEvent };

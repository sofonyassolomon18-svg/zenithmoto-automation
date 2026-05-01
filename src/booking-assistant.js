// ZenithMoto Booking Assistant — IMAP polling + Gemini reply + SMTP send
// Replaces the broken Make.com scenario 5491229.
// Runs every 15 minutes via node-cron in scheduler.js.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const axios = require('axios');

const SMTP_USER = process.env.SMTP_EMAIL || 'zenithmoto.ch@gmail.com';
const APP_PASS  = process.env.GMAIL_APP_PASSWORD;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TG_BOT  = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

const IMAP_CONFIG = {
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: { user: SMTP_USER, pass: APP_PASS },
  logger: false,
  tls: { rejectUnauthorized: false },
};

const SKIP_FROM_PATTERNS = [
  /noreply/i, /no-reply/i, /donotreply/i, /mailer-daemon/i, /postmaster/i,
  /notifications?@/i, /alert/i, /support@stripe/i, /github\.com$/i,
  /facebook\.com$/i, /instagram\.com$/i, /linkedin\.com$/i, /booking\.com/i,
  new RegExp(SMTP_USER.replace(/[.@]/g, '\\$&'), 'i'),
];

function shouldSkip(fromEmail, subject, headers) {
  if (!fromEmail) return 'no-from';
  if (SKIP_FROM_PATTERNS.some(re => re.test(fromEmail))) return 'skip-pattern';
  if (headers && (headers['auto-submitted'] || headers['x-auto-response-suppress'])) return 'auto-submitted';
  if (subject && /^(out of office|absence|abwesenheit|undeliverable|delivery status)/i.test(subject)) return 'auto-reply';
  return null;
}

async function generateReply(email) {
  const prompt = `Tu es l'assistant ZenithMoto (location de motos à Bienne, Suisse).

Email reçu :
De      : ${email.fromName} <${email.fromEmail}>
Sujet   : ${email.subject}
Message :
${email.bodyText}

Écris une réponse professionnelle et chaleureuse, en français OU allemand selon la langue du client.
Catalogue (CHF/jour · CHF/weekend) : Tracer 700 120/216 · TMAX 530 100/180 · X-ADV 750 120/216 · X-Max 300 80/144 · X-Max 125 65/117.
Réservations → zenithmoto.ch
Si question hors-sujet (spam, autre service), réponds poliment qu'on ne peut pas aider.

Réponse en TEXTE BRUT uniquement, sans markdown, sans préambule.`;

  // Free-tier safe order: 2.5-flash-lite (free) → 2.0-flash (often quota-out) → gemma-3-12b
  const models = ['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemma-3-12b-it', 'gemini-2.5-flash'];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
          { contents: [{ parts: [{ text: prompt }] }] },
          { timeout: 30000 }
        );
        const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
        throw new Error('Gemini empty response');
      } catch (e) {
        lastErr = e;
        const code = e.response?.status;
        if (code === 429 || (code >= 500 && code < 600)) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        break; // non-retriable for this model
      }
    }
  }
  throw lastErr || new Error('Gemini all models failed');
}

async function sendReply(toEmail, subject, body) {
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SMTP_USER, pass: APP_PASS },
  });
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  await transport.sendMail({
    from: `"ZenithMoto" <${SMTP_USER}>`,
    to: toEmail,
    subject: replySubject,
    text: `${body}\n\n--\nZenithMoto | https://zenithmoto.ch`,
  });
}

async function logToSupabase(payload, status, error) {
  if (!SUPABASE_KEY) return;
  try {
    await axios.post(`${SUPABASE_URL}/rest/v1/automations_log`, {
      project: 'zenithmoto', scenario: 'booking_assistant',
      status, payload, error: error || null,
    }, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      timeout: 10000,
    });
  } catch (_) { /* swallow log errors */ }
}

async function notifyTelegram(text) {
  if (!TG_BOT || !TG_CHAT) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`,
      { chat_id: TG_CHAT, text }, { timeout: 5000 });
  } catch (_) {}
}

async function runBookingAssistant() {
  if (!APP_PASS || !GEMINI_KEY) {
    console.warn('[booking] missing GMAIL_APP_PASSWORD or GEMINI_API_KEY — skip');
    return { processed: 0, replied: 0, skipped: 0 };
  }

  const stats = { processed: 0, replied: 0, skipped: 0, errors: 0 };
  const client = new ImapFlow(IMAP_CONFIG);
  await client.connect();

  try {
    await client.mailboxOpen('INBOX');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h
    const uids = await client.search({ seen: false, since }, { uid: true });
    if (uids.length === 0) return stats;

    const toFetch = uids.slice(-10); // cap at 10 per cycle
    console.log(`[booking] ${toFetch.length} unread emails (last 24h)`);

    for (const uid of toFetch) {
      stats.processed++;
      try {
        const dl = await client.download(`${uid}`, null, { uid: true });
        const chunks = [];
        for await (const chunk of dl.content) chunks.push(chunk);
        const parsed = await simpleParser(Buffer.concat(chunks));

        const fromEmail = parsed.from?.value?.[0]?.address || '';
        const fromName  = parsed.from?.value?.[0]?.name || '';
        const subject   = parsed.subject || '';
        const bodyText  = (parsed.text || '').slice(0, 2500);

        const skip = shouldSkip(fromEmail, subject, parsed.headers);
        if (skip) {
          console.log(`[booking] uid ${uid} — skip (${skip}): ${fromEmail}`);
          await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
          stats.skipped++;
          continue;
        }

        const reply = await generateReply({ fromName, fromEmail, subject, bodyText });
        await sendReply(fromEmail, subject, reply);
        await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
        await logToSupabase({ uid, fromEmail, subject }, 'success');
        stats.replied++;
        console.log(`[booking] uid ${uid} — replied → ${fromEmail}`);
      } catch (e) {
        stats.errors++;
        console.error(`[booking] uid ${uid} ERR:`, e.message);
        await logToSupabase({ uid }, 'error', e.message);
      }
    }
  } finally {
    await client.logout();
  }

  if (stats.replied > 0) {
    await notifyTelegram(`[ZenithMoto] Booking Assistant: ${stats.replied} reply(ies) sent (${stats.skipped} skipped, ${stats.errors} errors)`);
  }
  return stats;
}

module.exports = { runBookingAssistant };

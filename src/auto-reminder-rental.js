// auto-reminder-rental.js — Hourly check for rentals starting in next 24-48h.
// Sends Telegram alert to operator + email pickup checklist to client.
// SMS skipped: Twilio not configured (cost-gated per spec).
// Dedupe via Supabase column `reminder_h24_sent` (boolean).
require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const TG_BOT   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
}

async function notifyTelegram(text) {
  if (!TG_BOT || !TG_CHAT) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`,
      { chat_id: TG_CHAT, text, parse_mode: 'Markdown' }, { timeout: 5000 });
  } catch (e) { console.warn('[auto-reminder] TG failed:', e.message); }
}

function getTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

function emailPickup(b) {
  const moto = b.moto || b.motorcycle || 'votre moto';
  return {
    to: b.client_email,
    subject: `⏰ J-1 : préparez votre ${moto} — ZenithMoto`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:20px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span><span style="color:#f0a500">.</span>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 16px">C'est demain ! 🏍️</h2>
    <p>Bonjour <strong>${b.client_name || 'cher client'}</strong>,</p>
    <p>Votre location de la <strong>${moto}</strong> commence <strong>${fmtDate(b.start_date)}</strong>.</p>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:14px;margin:18px 0">
      <p style="margin:0;font-weight:600">📋 Checklist :</p>
      <ul style="margin:8px 0;line-height:1.8">
        <li>Permis de conduire valide (cat. A / AM)</li>
        <li>Pièce d'identité</li>
        <li>Moyen de paiement (carte ou TWINT) — pas de caution demandée</li>
        <li>Veste + gants recommandés</li>
      </ul>
    </div>
    <p>Une question ? Répondez à cet email ou WhatsApp <a href="https://wa.me/41782655108">+41 78 265 51 08</a>.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <p style="color:#666;font-size:13px">ZenithMoto — Bienne · zenithmoto.ch</p>
  </div>
</div>`,
  };
}

async function fetchUpcomingRentals() {
  if (!SUPA_URL || !SUPA_KEY) return null;
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
  const in48h = new Date(now.getTime() + 48 * 3600 * 1000);
  const from = in24h.toISOString();
  const to = in48h.toISOString();
  try {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/bookings?select=*&start_date=gte.${from}&start_date=lte.${to}&status=neq.cancelled&reminder_h24_sent=is.null`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    if (!res.ok) {
      console.warn('[auto-reminder] supabase HTTP', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[auto-reminder] fetch failed:', e.message);
    return null;
  }
}

async function markReminderSent(id) {
  try {
    await fetch(`${SUPA_URL}/rest/v1/bookings?id=eq.${id}`, {
      method: 'PATCH',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
                 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ reminder_h24_sent: true }),
    });
  } catch (e) { console.warn('[auto-reminder] mark failed:', e.message); }
}

async function runAutoReminder() {
  const rentals = await fetchUpcomingRentals();
  if (!rentals) return { status: 'skipped', count: 0 };
  if (rentals.length === 0) return { status: 'ok', count: 0 };

  let sent = 0, errors = 0;
  for (const b of rentals) {
    try {
      const moto = b.moto || b.motorcycle || b.moto_id;
      // Telegram operator alert
      await notifyTelegram(
        `🏍️ *Location dans 24-48h*\n` +
        `Client: ${b.client_name}\n` +
        `Moto: ${moto}\n` +
        `Début: ${fmtDate(b.start_date)} ${fmtTime(b.start_date)}\n` +
        `Email: ${b.client_email}`
      );
      // Client email pickup checklist
      if (b.client_email && process.env.SMTP_EMAIL && process.env.GMAIL_APP_PASSWORD) {
        await getTransport().sendMail({
          from: `"ZenithMoto" <${process.env.SMTP_EMAIL}>`,
          ...emailPickup(b),
        });
      }
      await markReminderSent(b.id);
      sent++;
      console.log(`[auto-reminder] ✅ ${b.client_name} — ${moto}`);
    } catch (e) {
      errors++;
      console.error(`[auto-reminder] ❌ ${b.id}: ${e.message}`);
    }
  }
  return { status: 'ok', count: rentals.length, sent, errors };
}

module.exports = { runAutoReminder };

if (require.main === module) {
  runAutoReminder().then(r => { console.log(r); process.exit(0); });
}

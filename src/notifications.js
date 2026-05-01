require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const BOOKINGS_FILE = path.join(__dirname, '..', 'data', 'bookings.json');

function getTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

function loadBookings() {
  if (!fs.existsSync(BOOKINGS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8')); } catch { return []; }
}

function saveBookings(bookings) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
}

function emailConfirmation(booking) {
  return {
    to: booking.client_email,
    subject: `✅ Réservation confirmée — ${booking.motorcycle} · ZenithMoto`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 20px">Votre réservation est confirmée 🎉</h2>
    <p>Bonjour <strong>${booking.client_name}</strong>,</p>
    <p>Nous avons bien reçu votre réservation. Voici le récapitulatif :</p>
    <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin:20px 0">
      <p style="margin:8px 0">🏍️ <strong>Moto :</strong> ${booking.motorcycle}</p>
      <p style="margin:8px 0">📅 <strong>Début :</strong> ${formatDate(booking.start_date)}</p>
      <p style="margin:8px 0">📅 <strong>Fin :</strong> ${formatDate(booking.end_date)}</p>
      ${booking.price ? `<p style="margin:8px 0">💰 <strong>Montant :</strong> CHF ${booking.price}</p>` : ''}
      ${booking.booking_id ? `<p style="margin:8px 0">🔖 <strong>N° réservation :</strong> ${booking.booking_id}</p>` : ''}
    </div>
    <p><strong>Informations importantes :</strong></p>
    <ul style="line-height:2">
      <li>Présentez-vous avec votre permis de conduire valide</li>
      <li>Un dépôt de garantie sera demandé à la prise en charge</li>
      <li>Casque fourni inclus dans la location</li>
    </ul>
    <p>En cas de question, répondez simplement à cet email.</p>
    <p>Bonne route ! 🛣️</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#666;font-size:13px">L'équipe ZenithMoto<br>zenithmoto.ch@gmail.com · zenithmoto.ch</p>
  </div>
</div>`,
  };
}

function emailReminder(booking) {
  return {
    to: booking.client_email,
    subject: `⏰ Rappel : votre location ${booking.motorcycle} commence demain — ZenithMoto`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 20px">C'est demain ! 🏍️</h2>
    <p>Bonjour <strong>${booking.client_name}</strong>,</p>
    <p>Votre location de la <strong>${booking.motorcycle}</strong> commence demain le <strong>${formatDate(booking.start_date)}</strong>.</p>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin:20px 0">
      <p style="margin:0;font-weight:600">📋 Checklist avant de venir :</p>
      <ul style="margin:8px 0;line-height:2">
        <li>✅ Permis de conduire valide (catégorie A ou AM selon la moto)</li>
        <li>✅ Pièce d'identité</li>
        <li>✅ Carte de crédit pour le dépôt de garantie</li>
        <li>✅ Tenue adaptée (veste, gants recommandés)</li>
      </ul>
    </div>
    <p>On vous attend demain. À bientôt ! 👋</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#666;font-size:13px">L'équipe ZenithMoto<br>zenithmoto.ch@gmail.com · zenithmoto.ch</p>
  </div>
</div>`,
  };
}

function emailFollowUp(booking) {
  return {
    to: booking.client_email,
    subject: `⭐ Comment s'est passée votre location ? — ZenithMoto`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 20px">Merci d'avoir choisi ZenithMoto ! 🙏</h2>
    <p>Bonjour <strong>${booking.client_name}</strong>,</p>
    <p>Nous espérons que votre location de la <strong>${booking.motorcycle}</strong> s'est parfaitement déroulée.</p>
    <p>Votre avis nous aide à nous améliorer et permet à d'autres motards de nous découvrir. Si vous avez eu une bonne expérience, un avis Google prend 30 secondes et fait toute la différence :</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://www.google.com/search?q=ZenithMoto+Bienne+avis" style="background:#f0a500;color:#1a1a2e;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;display:inline-block">⭐ Laisser un avis Google</a>
    </div>
    <p>On espère vous revoir bientôt sur la route ! 🛣️</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#666;font-size:13px">L'équipe ZenithMoto<br>zenithmoto.ch@gmail.com · zenithmoto.ch</p>
  </div>
</div>`,
  };
}

async function sendNotification(emailData) {
  const transport = getTransport();
  await transport.sendMail({
    from: `"ZenithMoto" <${process.env.SMTP_EMAIL}>`,
    ...emailData,
  });
}

// Daily cron: check bookings for J-1 reminders
async function checkAndSendReminders() {
  const bookings = loadBookings();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  for (const booking of bookings) {
    if (booking.reminder_sent) continue;
    const startStr = new Date(booking.start_date).toISOString().split('T')[0];
    if (startStr === tomorrowStr) {
      try {
        await sendNotification(emailReminder(booking));
        booking.reminder_sent = true;
        console.log(`⏰ Rappel J-1 envoyé → ${booking.client_name}`);
      } catch (e) {
        console.error(`Rappel error: ${e.message}`);
      }
    }
  }
  saveBookings(bookings);
}

function createWebhookServer() {
  const app = express();
  // Capture raw body for HMAC verification — must be before express.json
  app.use('/webhook/booking', express.raw({ type: 'application/json' }));
  app.use(express.json());

  // HMAC SHA-256 verification : protège contre webhooks forgés
  // Header attendu : X-Lovable-Signature: sha256=<hex>
  // Le secret est dans LOVABLE_WEBHOOK_SECRET (générer via crypto.randomBytes(32).toString('hex'))
  function verifyWebhookSignature(req) {
    const secret = process.env.LOVABLE_WEBHOOK_SECRET;
    if (!secret) return true; // dev mode : pas de secret = pas de verif (log warning ailleurs)
    const sig = req.headers['x-lovable-signature'] || '';
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body), 'utf8');
    const crypto = require('crypto');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
    catch { return false; }
  }

  app.post('/webhook/booking', async (req, res) => {
    if (!verifyWebhookSignature(req)) {
      console.warn('[webhook] HMAC invalide — rejet');
      return res.status(401).json({ error: 'invalid signature' });
    }
    // Body est en raw Buffer ici, on le parse manuellement
    let body;
    try { body = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(400).json({ error: 'JSON invalide' }); }
    const { event, booking } = body;
    if (!event || !booking) return res.status(400).json({ error: 'event et booking requis' });

    console.log(`📨 Webhook reçu: ${event} → ${booking.client_name || 'unknown'}`);

    try {
      if (event === 'booking_created') {
        await sendNotification(emailConfirmation(booking));
        console.log(`✅ Confirmation envoyée → ${booking.client_email}`);

        const bookings = loadBookings();
        bookings.push({ ...booking, reminder_sent: false, followup_sent: false });
        saveBookings(bookings);
      }

      if (event === 'booking_completed') {
        await sendNotification(emailFollowUp(booking));
        console.log(`⭐ Follow-up avis envoyé → ${booking.client_email}`);

        const bookings = loadBookings();
        const b = bookings.find(b => b.booking_id === booking.booking_id);
        if (b) b.followup_sent = true;
        saveBookings(bookings);
      }

      res.json({ success: true, event });
    } catch (e) {
      console.error('Webhook error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Health check basique (utilisé par Railway healthcheck)
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ZenithMoto Notifications' }));

  // Health enrichi : check les services critiques (env vars, fichiers, dernier ping booking-assistant)
  app.get('/health/full', (req, res) => {
    const fs = require('fs');
    const checks = {
      gmail_smtp: !!(process.env.SMTP_EMAIL && process.env.GMAIL_APP_PASSWORD),
      gmail_imap: !!(process.env.SMTP_EMAIL && process.env.GMAIL_APP_PASSWORD),
      gemini: !!process.env.GEMINI_API_KEY,
      supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY),
      telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      lovable_webhook_secret: !!process.env.LOVABLE_WEBHOOK_SECRET,
    };

    // Bookings file accessible ?
    let bookingsCount = null;
    try {
      const bp = require('path').join(__dirname, '..', 'data', 'bookings.json');
      if (fs.existsSync(bp)) {
        const data = JSON.parse(fs.readFileSync(bp, 'utf8'));
        bookingsCount = Array.isArray(data) ? data.length : Object.keys(data).length;
      }
    } catch (_) {}

    const allOk = checks.gmail_smtp && checks.gemini;
    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      service: 'ZenithMoto Notifications',
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      checks,
      bookings_count: bookingsCount,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

module.exports = { createWebhookServer, checkAndSendReminders };

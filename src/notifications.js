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

// Fetch tomorrow's bookings from Supabase REST API (no SDK needed, Node 18+ fetch)
async function fetchTomorrowsBookingsFromSupabase(tomorrowStr) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/bookings?select=*&start_date=eq.${tomorrowStr}&status=neq.cancelled`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[reminders] Supabase fetch failed:', e.message);
    return null;
  }
}

// Fetch yesterday's confirmed bookings without review request from Supabase
async function fetchYesterdaysBookingsFromSupabase(yesterdayStr) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/bookings?select=*&end_date=eq.${yesterdayStr}&review_request_sent=is.null`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const bookings = await res.json();
    return bookings.filter(b => b.status === 'confirmed' || b.status === 'pending');
  } catch (e) {
    console.warn('[post-rental] Supabase fetch failed:', e.message);
    return null;
  }
}

// Mark booking as review request sent
async function markReviewRequestSent(bookingId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  try {
    await fetch(
      `${url}/rest/v1/bookings?id=eq.${bookingId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ review_request_sent: true }),
      }
    );
  } catch (e) {
    console.warn('[post-rental] Supabase PATCH failed:', e.message);
  }
}

function emailPostRentalReview(booking) {
  const name = booking.client_name || 'cher client';
  const moto = booking.moto || booking.motorcycle || 'votre moto';
  return {
    to: booking.client_email,
    subject: `Comment s'est passée votre location ? — ZenithMoto`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 20px">Merci d'avoir roulé avec nous !</h2>
    <p>Bonjour <strong>${name}</strong>,</p>
    <p>Nous espérons que votre location de la <strong>${moto}</strong> s'est parfaitement déroulée et que vous avez passé un excellent moment sur la route.</p>
    <p>Votre retour compte beaucoup pour nous — et un avis Google prend moins de 30 secondes. Si vous avez été satisfait, ce petit geste fait toute la différence pour ZenithMoto :</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://search.google.com/local/writereview?placeid=ChIJPZ4xF6aAaQy8yQ9N80Kljg" style="background:#f0a500;color:#1a1a2e;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;display:inline-block">Laisser un avis Google</a>
    </div>
    <p>Une question, un commentaire ? Vous pouvez aussi nous écrire directement sur WhatsApp :</p>
    <div style="text-align:center;margin:20px 0">
      <a href="https://wa.me/41782655108" style="background:#25d366;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;display:inline-block">Nous écrire sur WhatsApp</a>
    </div>
    <p>On espère vous revoir bientôt sur la route !</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#666;font-size:13px">L'équipe ZenithMoto<br>zenithmoto.ch@gmail.com · zenithmoto.ch</p>
  </div>
</div>`,
  };
}

// Daily cron: send Google Review request to clients whose rental ended yesterday
async function checkAndSendPostRentalReview() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const bookings = await fetchYesterdaysBookingsFromSupabase(yesterdayStr);
  if (bookings === null) {
    console.warn('[post-rental] Supabase non disponible — skip');
    return;
  }

  for (const booking of bookings) {
    try {
      const mapped = {
        client_name: booking.client_name,
        client_email: booking.client_email,
        moto: booking.moto || booking.motorcycle,
        booking_id: booking.id,
      };
      await sendNotification(emailPostRentalReview(mapped));
      console.log(`[post-rental] Avis envoyé → ${booking.client_name}`);
      try {
        await markReviewRequestSent(booking.id);
      } catch (e) {
        console.warn(`[post-rental] Impossible de marquer review_request_sent (colonne absente ?) : ${e.message}`);
      }
    } catch (e) {
      console.error(`[post-rental] Erreur envoi → ${booking.client_email} : ${e.message}`);
    }
  }
}

// Daily cron: check bookings for J-1 reminders
async function checkAndSendReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Try Supabase first — single source of truth for bookings
  const supabaseBookings = await fetchTomorrowsBookingsFromSupabase(tomorrowStr);

  if (supabaseBookings !== null) {
    // Supabase path: bookings already filtered for tomorrow
    for (const booking of supabaseBookings) {
      try {
        const mapped = {
          client_name: booking.client_name,
          client_email: booking.client_email,
          motorcycle: booking.moto,
          start_date: booking.start_date,
          end_date: booking.end_date,
          booking_id: booking.id,
        };
        await sendNotification(emailReminder(mapped));
        console.log(`⏰ Rappel J-1 (Supabase) envoyé → ${booking.client_name}`);
      } catch (e) {
        console.error(`Rappel error: ${e.message}`);
      }
    }
    return;
  }

  // Fallback: local file (dev / migration window)
  const bookings = loadBookings();
  for (const booking of bookings) {
    if (booking.reminder_sent) continue;
    const startStr = new Date(booking.start_date).toISOString().split('T')[0];
    if (startStr === tomorrowStr) {
      try {
        await sendNotification(emailReminder(booking));
        booking.reminder_sent = true;
        console.log(`⏰ Rappel J-1 (local) envoyé → ${booking.client_name}`);
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

  // HMAC SHA-256 verification : protège contre webhooks forgés.
  // Header attendu : X-Hub-Signature-256: sha256=<hex>  (compat. GitHub-style)
  // Secret dans WEBHOOK_SECRET (généré via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
  // Si WEBHOOK_SECRET est vide → on log un warning et on accepte (mode dev local).
  // Si WEBHOOK_SECRET est défini ET signature absente/invalide → 401.
  const crypto = require('crypto');
  let _warnedNoSecret = false;
  function verifyWebhookSignature(req) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      if (!_warnedNoSecret) {
        console.warn('[webhook] ⚠️ WEBHOOK_SECRET non défini — vérification HMAC désactivée (DEV MODE)');
        _warnedNoSecret = true;
      }
      return { ok: true, devMode: true };
    }
    const sig = req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'] || '';
    if (!sig) return { ok: false, reason: 'missing signature header' };
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body), 'utf8');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return { ok: false, reason: 'signature length mismatch' };
    try {
      return crypto.timingSafeEqual(a, b)
        ? { ok: true }
        : { ok: false, reason: 'signature mismatch' };
    } catch {
      return { ok: false, reason: 'signature compare error' };
    }
  }

  app.post('/webhook/booking', async (req, res) => {
    const v = verifyWebhookSignature(req);
    if (!v.ok) {
      console.warn(`[webhook] HMAC invalide → rejet (${v.reason})`);
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
      webhook_secret: !!process.env.WEBHOOK_SECRET,
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

module.exports = { createWebhookServer, checkAndSendReminders, checkAndSendPostRentalReview };

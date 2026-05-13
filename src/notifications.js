require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '[no-email]';
  return email.replace(/(.{2}).*(@.*)/, '$1***$2');
}

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

function emailCalendlyLink(booking, calendlyUrl) {
  const name = booking.client_name || 'cher client';
  const firstName = name.split(/\s+/)[0] || name;
  const moto = booking.motorcycle || booking.moto || booking.moto_id || 'votre moto';
  return {
    to: booking.client_email,
    subject: `Réservez votre créneau de récupération — ${moto} · ZenithMoto`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 20px">Dernière étape : choisissez votre créneau</h2>
    <p>Bonjour <strong>${firstName}</strong>,</p>
    <p>Merci pour votre réservation <strong>${moto}</strong> — le paiement est bien reçu.</p>
    <p>Pour finaliser, sélectionnez votre créneau de récupération des clés :</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${calendlyUrl}" style="background:#f0a500;color:#1a1a2e;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;display:inline-block">Choisir mon créneau</a>
    </div>
    <p style="font-size:13px;color:#666;text-align:center;margin:0 0 24px">ou copier ce lien : <a href="${calendlyUrl}" style="color:#1a1a2e">${calendlyUrl}</a></p>
    <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin:20px 0">
      <p style="margin:0 0 8px;font-weight:600">À apporter le jour J :</p>
      <ul style="margin:8px 0;line-height:2">
        <li>Permis de conduire valide</li>
        <li>Pièce d'identité</li>
        <li>Carte de crédit pour la caution</li>
      </ul>
      <p style="margin:12px 0 0"><strong>Adresse :</strong> ZenithMoto, 2502 Bienne (BE) — l'adresse précise vous sera confirmée après la sélection du créneau.</p>
    </div>
    <p>Une question ? Répondez simplement à cet email.</p>
    <p>À très vite sur la route !</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#666;font-size:13px">Sofonyas — ZenithMoto<br>zenithmoto.ch@gmail.com · zenithmoto.ch</p>
  </div>
</div>`,
  };
}

// Persist generated link in bookings table (best-effort, swallow errors)
async function patchBookingCalendlyUrl(bookingId, calendlyUrl) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key || !bookingId) return;
  try {
    await fetch(`${url}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ calendly_url: calendlyUrl }),
    });
  } catch (e) {
    console.warn('[calendly] Supabase PATCH failed:', e.message);
  }
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
    <p style="color:#666;font-size:13px">L'équipe ZenithMoto<br>zenithmoto.ch@gmail.com · zenithmoto.ch<br>Rue Centrale 1, 2502 Bienne (BE), Suisse</p>
    <p style="color:#aaa;font-size:11px;margin-top:8px">Vous recevez cet email suite à votre location chez ZenithMoto. Pour ne plus recevoir ce type de message : <a href="mailto:zenithmoto.ch@gmail.com?subject=Désabonnement" style="color:#aaa;">Se désinscrire</a></p>
  </div>
</div>`,
  };
}

// Daily cron: send Google Review request to clients whose rental ended 2 days ago (J+2)
async function checkAndSendPostRentalReview() {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const yesterdayStr = twoDaysAgo.toISOString().split('T')[0];

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

  // ── Sécurité : helmet (headers HTTP) ──────────────────────────────
  app.use(helmet({
    strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true },
    contentSecurityPolicy: false, // API JSON, pas de rendu HTML
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'no-referrer' },
  }));

  // ── CORS strict : zenithmoto.ch + lovable.dev uniquement ──────────
  app.use(cors({
    origin: [
      'https://zenithmoto.ch',
      'https://www.zenithmoto.ch',
      /lovable\.dev$/,
    ],
    credentials: false,
  }));

  // ── Rate-limit global : 100 req / 15 min par IP ───────────────────
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
  });
  app.use(globalLimiter);

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
      // En production (NODE_ENV=production), refuser si WEBHOOK_SECRET absent — pas de fallback silencieux.
      // En dev local uniquement : accepter avec warning.
      if (process.env.NODE_ENV === 'production') {
        return { ok: false, reason: 'WEBHOOK_SECRET non configuré en production — refus sécurisé' };
      }
      if (!_warnedNoSecret) {
        console.warn('[webhook] ⚠️ WEBHOOK_SECRET non défini — vérification HMAC désactivée (DEV MODE uniquement)');
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

    // Validation du schema payload
    const VALID_EVENTS = ['booking_created', 'booking_completed', 'booking_cancelled'];
    const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/;

    if (!event || !booking) {
      return res.status(400).json({ error: 'event et booking requis' });
    }
    if (!VALID_EVENTS.includes(event)) {
      return res.status(400).json({ error: `event invalide — valeurs acceptées: ${VALID_EVENTS.join(', ')}` });
    }
    if (!booking.client_email || !EMAIL_RE.test(booking.client_email)) {
      return res.status(400).json({ error: 'booking.client_email invalide ou manquant' });
    }
    if (!booking.moto_id || typeof booking.moto_id !== 'string') {
      return res.status(400).json({ error: 'booking.moto_id manquant (string requis)' });
    }
    if (!booking.start_date || !ISO_DATE_RE.test(booking.start_date)) {
      return res.status(400).json({ error: 'booking.start_date invalide (ISO 8601 requis, ex: 2025-06-15)' });
    }
    if (!booking.end_date || !ISO_DATE_RE.test(booking.end_date)) {
      return res.status(400).json({ error: 'booking.end_date invalide (ISO 8601 requis, ex: 2025-06-20)' });
    }

    console.log(`📨 Webhook reçu: ${event} → ${booking.client_name || 'unknown'}`);

    const { trackEvent } = require('./lib/telegram');
    const customerName = (booking.client_name || '').split(/\s+/)[0] || booking.client_name;

    try {
      if (event === 'booking_created') {
        await sendNotification(emailConfirmation(booking));
        console.log(`✅ Confirmation envoyée → ${maskEmail(booking.client_email)}`);

        const bookings = loadBookings();
        bookings.push({ ...booking, reminder_sent: false, followup_sent: false });
        saveBookings(bookings);

        // Funnel event: prospect → paid lifecycle (booking_created = paid if via webhook)
        trackEvent({
          kind: 'paid',
          booking_id: booking.booking_id || booking.id,
          customer: customerName,
          moto: booking.moto_id || booking.motorcycle,
          amount_chf: booking.price || null,
          meta: { email: booking.client_email, start_date: booking.start_date },
        });

        // VIP detection (3e+ location) : notif Telegram async, ne bloque pas la réponse webhook
        try {
          const { notifyVipOnNewBooking } = require('./retention');
          notifyVipOnNewBooking(booking).catch(e => console.warn('[webhook] VIP check failed:', e.message));
        } catch (e) { /* module loading guarded */ }

        // Referral : si le filleul réserve, déclencher la récompense parrain (async)
        try {
          const { processRefereeBooking } = require('./referral');
          processRefereeBooking(booking.client_email).catch(e => console.warn('[webhook] referral check failed:', e.message));
        } catch (e) { /* guard */ }

        // Calendly single-use link generation + email pickup-slot booking
        try {
          const { createSchedulingLink } = require('./lib/calendly');
          const motoSlug = booking.moto_slug || booking.moto_id || booking.motorcycle;
          const cal = await createSchedulingLink(motoSlug, 1);
          if (cal.url) {
            await sendNotification(emailCalendlyLink(booking, cal.url));
            console.log(`📅 Calendly link sent → ${maskEmail(booking.client_email)} : ${cal.url}`);
            const { notify } = require('./lib/telegram');
            if (typeof notify === 'function') {
              notify(`📅 Calendly link sent to ${customerName} (${booking.moto_id || motoSlug}): ${cal.url}`)
                .catch(e => console.warn('[calendly] telegram notify failed:', e.message));
            }
            await patchBookingCalendlyUrl(booking.booking_id || booking.id, cal.url);
          } else {
            console.warn(`[calendly] link gen failed for ${motoSlug}: ${JSON.stringify(cal).slice(0,200)}`);
            try {
              const { notify } = require('./lib/telegram');
              if (typeof notify === 'function') {
                notify(`⚠️ Calendly link gen failed for ${motoSlug}: ${JSON.stringify(cal).slice(0,200)}`)
                  .catch(() => {});
              }
            } catch (_) {}
          }
        } catch (e) {
          console.warn('[calendly] integration error:', e.message);
        }
      }

      if (event === 'booking_completed') {
        trackEvent({
          kind: 'completed',
          booking_id: booking.booking_id || booking.id,
          customer: customerName,
          moto: booking.moto_id || booking.motorcycle,
          meta: { email: booking.client_email },
        });
        await sendNotification(emailFollowUp(booking));
        console.log(`⭐ Follow-up avis envoyé → ${maskEmail(booking.client_email)}`);

        const bookings = loadBookings();
        const b = bookings.find(b => b.booking_id === booking.booking_id);
        if (b) b.followup_sent = true;
        saveBookings(bookings);

        // Loyalty : +1 point sur location terminée (async, non bloquant)
        try {
          const { awardPoint } = require('./loyalty');
          const lang = (booking.lang || 'fr').toLowerCase().startsWith('de') ? 'de' : 'fr';
          awardPoint(booking.client_email, lang).catch(e => console.warn('[webhook] loyalty award failed:', e.message));
        } catch (e) { /* guard */ }
      }

      if (event === 'booking_cancelled') {
        trackEvent({
          kind: 'cancelled',
          booking_id: booking.booking_id || booking.id,
          customer: customerName,
          moto: booking.moto_id || booking.motorcycle,
          meta: { email: booking.client_email },
        });
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

    // Reliability snapshot : circuit states + DLQ count
    let circuits = {}, dlqCount = 0;
    try {
      const { circuitStatus, deadLetter } = require('./lib/circuit-breaker');
      circuits = circuitStatus();
      dlqCount = deadLetter.count();
    } catch (_) {}

    const allOk = checks.gmail_smtp && checks.gemini;
    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      service: 'ZenithMoto Notifications',
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      checks,
      bookings_count: bookingsCount,
      circuits,
      dead_letter_count: dlqCount,
      timestamp: new Date().toISOString(),
    });
  });

  // Read-only DLQ inspection (admin only — Bearer token en header, jamais en query param)
  app.get('/admin/dlq', (req, res) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const { deadLetter } = require('./lib/circuit-breaker');
      const limit = Math.min(200, parseInt(req.query.limit) || 50);
      res.json({ count: deadLetter.count(), items: deadLetter.read(limit) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── HeyGen admin endpoints ────────────────────────────────────────────────
  function _heygenAuth(req, res) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  app.get('/api/heygen/avatars', async (_req, res) => {
    const heygen = require('./lib/heygen');
    const r = await heygen.listAvatars();
    res.status(r.ok ? 200 : 502).json(r);
  });

  app.get('/api/heygen/voices', async (req, res) => {
    const heygen = require('./lib/heygen');
    const r = await heygen.listVoices(req.query.lang || 'fr');
    res.status(r.ok ? 200 : 502).json(r);
  });

  app.get('/api/heygen/renders', async (req, res) => {
    const heygen = require('./lib/heygen');
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const r = await heygen.listRenders({ limit, useCase: req.query.use_case });
    res.json(r);
  });

  app.post('/api/heygen/test-render', async (req, res) => {
    if (!_heygenAuth(req, res)) return;
    try {
      const { generateSocialAvatarPost } = require('./flows/social-avatar-post');
      const r = await generateSocialAvatarPost({
        template_id: req.body?.template_id,
        platform: req.body?.platform,
      });
      res.status(r.ok ? 200 : 502).json(r);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/heygen/poll', async (req, res) => {
    if (!_heygenAuth(req, res)) return;
    try {
      const { pollRenders } = require('./poll-renders');
      const r = await pollRenders();
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Growth/loyalty/referral/NPS endpoints
  try {
    const { mountLoyaltyRoutes } = require('./loyalty');
    const { mountReferralRoutes } = require('./referral');
    const { mountNpsRoutes } = require('./nps-rental');
    mountLoyaltyRoutes(app);
    mountReferralRoutes(app);
    mountNpsRoutes(app);
  } catch (e) {
    console.warn('[routes:growth]', e.message);
  }

  return app;
}

module.exports = { createWebhookServer, checkAndSendReminders, checkAndSendPostRentalReview, maskEmail };

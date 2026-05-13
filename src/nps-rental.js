// src/nps-rental.js — NPS post-location ZenithMoto
// 3 jours après retour : email enquête 0-10 + question ouverte.
// Stockage : rental_nps(booking_id, score, comment).
// Coordination avec post-rental-review (J+2 module dans notifications.js) :
// - NPS envoie J+3 et n'ajoute PAS un 2e CTA "avis Google" (déjà géré J+2).
// - Si score >=9 : NOTE positive (Google review déjà demandée).
// - Si score <=6 : alerte Telegram opérateur pour outreach manuel.

const axios = require('axios');
const nodemailer = require('nodemailer');
const { notify } = require('./lib/telegram');

const SUPA_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const NPS_PUBLIC_URL = process.env.NPS_PUBLIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'zenithmoto-automation-production.up.railway.app'}`;

function _h(extra = {}) {
  return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', ...extra };
}

async function fetchBookingsForNPS(targetDate) {
  if (!SUPA_KEY) return [];
  try {
    const r = await axios.get(
      `${SUPA_URL}/rest/v1/bookings?end_date=eq.${targetDate}&status=in.(confirmed,completed,paid)&nps_sent=is.null&select=*`,
      { headers: _h(), timeout: 15000 }
    );
    return r.data || [];
  } catch (e) {
    console.warn('[nps:fetch]', e.message);
    return [];
  }
}

async function markNpsSent(bookingId) {
  try {
    await axios.patch(
      `${SUPA_URL}/rest/v1/bookings?id=eq.${bookingId}`,
      { nps_sent: true },
      { headers: _h({ Prefer: 'return=minimal' }), timeout: 5000 }
    );
  } catch (e) { /* swallow */ }
}

function emailNPS(booking, lang = 'fr') {
  const isDE = lang === 'de';
  const bid = encodeURIComponent(booking.id || booking.booking_id || '');
  const buttons = Array.from({ length: 11 }, (_, i) => {
    const color = i <= 6 ? '#c0392b' : i <= 8 ? '#e67e22' : '#27ae60';
    return `<a href="${NPS_PUBLIC_URL}/api/nps/submit?bid=${bid}&score=${i}" style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;background:${color};color:#fff;border-radius:50%;text-decoration:none;font-weight:700;margin:2px">${i}</a>`;
  }).join('');
  return {
    subject: isDE
      ? `Wie war Ihre Erfahrung? — ZenithMoto`
      : `Comment était votre expérience ? — ZenithMoto`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e">${isDE ? 'Eine kurze Frage' : 'Une question rapide'}</h2>
    <p>${isDE
      ? 'Wie wahrscheinlich würden Sie ZenithMoto einem Freund weiterempfehlen?'
      : 'Sur une échelle de 0 à 10, recommanderiez-vous ZenithMoto à un ami ?'}
    </p>
    <div style="text-align:center;margin:20px 0">${buttons}</div>
    <p style="color:#666;font-size:13px;text-align:center">${isDE ? '0 = sehr unwahrscheinlich · 10 = sehr wahrscheinlich' : '0 = pas du tout · 10 = absolument'}</p>
    <p style="margin-top:24px">${isDE ? 'Möchten Sie etwas Konkretes hinzufügen?' : 'Un commentaire à ajouter ?'} <a href="mailto:zenithmoto.ch@gmail.com?subject=${isDE ? 'Mein%20Feedback' : 'Mon%20retour'}">${isDE ? 'Antworten Sie auf diese E-Mail' : 'Répondez à ce mail'}</a>.</p>
  </div>
</div>`,
  };
}

// Cron daily : pick bookings ended 3 days ago
async function runNpsDaily() {
  if (!process.env.SMTP_EMAIL || !process.env.GMAIL_APP_PASSWORD) return { skipped: 'no SMTP' };
  const d = new Date();
  d.setDate(d.getDate() - 3);
  const target = d.toISOString().slice(0, 10);
  const bookings = await fetchBookingsForNPS(target);
  if (!bookings.length) return { sent: 0, date: target };

  const t = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
  let sent = 0;
  for (const b of bookings) {
    if (!b.client_email) continue;
    try {
      const lang = (b.lang || 'fr').toLowerCase().startsWith('de') ? 'de' : 'fr';
      const { subject, html } = emailNPS(b, lang);
      await t.sendMail({
        from: `"ZenithMoto" <${process.env.SMTP_EMAIL}>`,
        to: b.client_email,
        subject,
        html,
      });
      await markNpsSent(b.id);
      sent++;
      await new Promise(r => setTimeout(r, 250));
    } catch (e) { console.warn('[nps:send]', b.client_email, e.message); }
  }
  if (sent > 0) console.log(`[nps] sent=${sent} date=${target}`);
  return { sent, date: target, total: bookings.length };
}

async function saveScore(bookingId, score, comment) {
  if (!SUPA_KEY || !bookingId) return null;
  try {
    await axios.post(
      `${SUPA_URL}/rest/v1/rental_nps`,
      {
        booking_id: bookingId,
        score: Number(score),
        comment: comment || null,
        created_at: new Date().toISOString(),
      },
      { headers: _h({ Prefer: 'return=minimal' }), timeout: 5000 }
    );
  } catch (e) { console.warn('[nps:save]', e.response?.data || e.message); }

  const s = Number(score);
  if (s <= 6) {
    await notify(`⚠️ NPS détracteur : booking ${bookingId} score ${s} — outreach manuel requis`, 'warn', { project: 'zenithmoto' });
  } else if (s >= 9) {
    // Coordination : post-rental-review module gère déjà la demande Google review J+2.
    await notify(`🌟 NPS promoteur : booking ${bookingId} score ${s} (Google review déjà demandée J+2)`, 'success', { project: 'zenithmoto' });
  }
}

function mountNpsRoutes(app) {
  // GET pour récupérer score depuis bouton dans email
  app.get('/api/nps/submit', async (req, res) => {
    const { bid, score, comment } = req.query;
    if (!bid || score == null) return res.status(400).send('missing bid/score');
    const s = Number(score);
    if (!Number.isInteger(s) || s < 0 || s > 10) return res.status(400).send('invalid score');
    await saveScore(bid, s, comment || null);
    res.send(`<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:64px"><h2>Merci !</h2><p>Votre retour a bien été enregistré.</p></body></html>`);
  });
  // POST pour formulaire enrichi (commentaire)
  app.post('/api/nps/submit', async (req, res) => {
    const { booking_id, score, comment } = req.body || {};
    if (!booking_id || score == null) return res.status(400).json({ error: 'booking_id + score required' });
    const s = Number(score);
    if (!Number.isInteger(s) || s < 0 || s > 10) return res.status(400).json({ error: 'invalid score' });
    await saveScore(booking_id, s, comment);
    res.json({ ok: true });
  });
}

module.exports = { runNpsDaily, saveScore, mountNpsRoutes };

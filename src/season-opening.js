// src/season-opening.js — Cron Mar 1 + Mar 15 + Apr 1
// Email FR/DE à tous les anciens clients "Saison ouverte, réservez tôt -15%"
// + auto-Stripe coupon SEASON-OPENING-YYYY valide jusqu'au 30 avril.

const axios = require('axios');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { notify } = require('./lib/telegram');

const SUPA_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function _h() { return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }; }

async function fetchPastCustomers() {
  if (!SUPA_KEY) return [];
  try {
    const r = await axios.get(
      `${SUPA_URL}/rest/v1/bookings?select=client_email,client_name,lang&status=in.(confirmed,completed,paid)`,
      { headers: _h(), timeout: 15000 }
    );
    const seen = new Set();
    const out = [];
    for (const b of r.data || []) {
      if (!b.client_email || seen.has(b.client_email)) continue;
      seen.add(b.client_email);
      out.push(b);
    }
    return out;
  } catch (e) {
    console.warn('[season:fetch]', e.message);
    return [];
  }
}

async function ensureSeasonCoupon(year) {
  if (!stripe) return null;
  const code = `SEASON-OPENING-${year}`;
  try {
    // try retrieve
    try {
      const existing = await stripe.promotionCodes.list({ code, limit: 1 });
      if (existing.data?.length) return code;
    } catch (_) { /* ignore */ }

    const coupon = await stripe.coupons.create({
      percent_off: 15,
      duration: 'once',
      name: code,
      redeem_by: Math.floor(new Date(`${year}-04-30T23:59:59Z`).getTime() / 1000),
    });
    await stripe.promotionCodes.create({
      coupon: coupon.id,
      code,
      max_redemptions: 500,
    });
    return code;
  } catch (e) {
    console.warn('[season:coupon]', e.message);
    return code;
  }
}

function emailBody(name, code, lang = 'fr') {
  const isDE = lang === 'de';
  return {
    subject: isDE
      ? '🏍️ Saison ist offen — Frühbucher-Rabatt 15% bei ZenithMoto'
      : '🏍️ La saison est ouverte — Réservez tôt -15% chez ZenithMoto',
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e">${isDE ? 'Hallo' : 'Bonjour'} ${name || ''},</h2>
    <p>${isDE
      ? 'Die Saison ist offen — und die besten Daten gehen schnell weg. Mit dem Code unten erhalten Sie 15 % Rabatt auf Ihre nächste Buchung:'
      : 'La saison est ouverte — et les meilleures dates partent vite. Avec le code ci-dessous, vous obtenez 15 % de remise sur votre prochaine location :'}
    </p>
    <p style="text-align:center;font-size:22px;color:#f0a500;font-weight:800;margin:24px 0">${code}</p>
    <p style="color:#666;font-size:13px">${isDE ? 'Gültig bis 30. April.' : 'Valable jusqu\'au 30 avril.'}</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://zenithmoto.ch/reserver" style="background:#f0a500;color:#1a1a2e;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none">${isDE ? 'Jetzt buchen' : 'Réserver'}</a>
    </div>
  </div>
</div>`,
  };
}

async function sendSeasonOpening() {
  if (!process.env.SMTP_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
    return { skipped: 'no SMTP' };
  }
  const year = new Date().getFullYear();
  const code = await ensureSeasonCoupon(year);
  const customers = await fetchPastCustomers();
  if (!customers.length) {
    await notify(`Season opening : aucun client à toucher`, 'warn', { project: 'zenithmoto' });
    return { sent: 0, code };
  }
  const t = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
  let sent = 0, failed = 0;
  for (const c of customers) {
    try {
      const lang = (c.lang || 'fr').toLowerCase().startsWith('de') ? 'de' : 'fr';
      const { subject, html } = emailBody(c.client_name || '', code, lang);
      await t.sendMail({
        from: `"ZenithMoto" <${process.env.SMTP_EMAIL}>`,
        to: c.client_email,
        subject,
        html,
      });
      sent++;
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      failed++;
      console.warn('[season:send]', c.client_email, e.message);
    }
  }
  await notify(`Season opening ${year} : ${sent} envoyés, ${failed} échecs · code ${code}`, 'success', { project: 'zenithmoto' });
  return { sent, failed, code, total: customers.length };
}

module.exports = { sendSeasonOpening };

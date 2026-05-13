// src/offseason-promo.js — Cron Oct 15 + Nov 15
// Envoie email FR/DE à tous les anciens clients pour promouvoir les cours moto hiver.
const axios = require('axios');
const nodemailer = require('nodemailer');
const { notify } = require('./lib/telegram');

const SUPA_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

function _h() {
  return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
}

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
    console.warn('[offseason:fetch]', e.message);
    return [];
  }
}

function emailBody(name, lang = 'fr') {
  const isDE = lang === 'de';
  return {
    subject: isDE
      ? '❄️ Bleiben Sie diesen Winter fit — Motorrad-Kurse bei ZenithMoto'
      : '❄️ Restez prêt cet hiver — Cours moto chez ZenithMoto',
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e">${isDE ? 'Hallo' : 'Bonjour'} ${name || ''},</h2>
    <p>${isDE
      ? 'Saison vorbei? Nicht für uns. Während andere ihr Motorrad einlagern, bieten wir Ihnen drei Winterkurse:'
      : 'La saison est finie ? Pas chez nous. Pendant que d\'autres rangent leur moto, nous vous proposons trois cours hiver :'}
    </p>
    <ul style="line-height:2">
      <li><strong>${isDE ? 'Mechanik-Grundlagen' : 'Mécanique de base'}</strong> — CHF 90</li>
      <li><strong>${isDE ? 'Sicherheits-Workshop' : 'Atelier sécurité'}</strong> — CHF 180</li>
      <li><strong>${isDE ? 'Theorie Führerschein A' : 'Théorie permis A'}</strong> — CHF 350</li>
    </ul>
    <div style="text-align:center;margin:28px 0">
      <a href="https://zenithmoto.ch/cours" style="background:#f0a500;color:#1a1a2e;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none">${isDE ? 'Jetzt anmelden' : 'M\'inscrire'}</a>
    </div>
    <p style="color:#666;font-size:13px">${isDE ? 'Begrenzte Plätze.' : 'Places limitées.'}</p>
  </div>
</div>`,
  };
}

async function sendOffseasonPromo() {
  if (!process.env.SMTP_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
    return { skipped: 'no SMTP' };
  }
  const customers = await fetchPastCustomers();
  if (!customers.length) return { sent: 0 };
  const t = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
  let sent = 0, failed = 0;
  for (const c of customers) {
    try {
      const lang = (c.lang || 'fr').toLowerCase().startsWith('de') ? 'de' : 'fr';
      const { subject, html } = emailBody(c.client_name || '', lang);
      await t.sendMail({
        from: `"ZenithMoto" <${process.env.SMTP_EMAIL}>`,
        to: c.client_email,
        subject,
        html,
      });
      sent++;
      // 300ms gap
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      failed++;
      console.warn('[offseason:send]', c.client_email, e.message);
    }
  }
  await notify(`Offseason promo : ${sent} envoyés, ${failed} échecs`, 'info', { project: 'zenithmoto' });
  return { sent, failed, total: customers.length };
}

module.exports = { sendOffseasonPromo };

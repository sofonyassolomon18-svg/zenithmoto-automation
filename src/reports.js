require('dotenv').config();
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

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
}

function buildReport(bookings) {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentBookings = bookings.filter(b => new Date(b.created_at || b.start_date) >= oneWeekAgo);
  const upcomingBookings = bookings.filter(b => new Date(b.start_date) >= now)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
    .slice(0, 10);

  // Count rentals per motorcycle
  const motoCount = {};
  for (const b of recentBookings) {
    motoCount[b.motorcycle] = (motoCount[b.motorcycle] || 0) + 1;
  }
  const topMotos = Object.entries(motoCount).sort((a, b) => b[1] - a[1]);

  // Total revenue
  const totalRevenue = recentBookings.reduce((sum, b) => sum + (Number(b.price) || 0), 0);

  const motoRows = topMotos.length > 0
    ? topMotos.map(([moto, count]) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eee">🏍️ ${moto}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;text-align:center"><strong>${count}</strong></td>
      </tr>`).join('')
    : `<tr><td colspan="2" style="padding:10px;color:#999;text-align:center">Aucune location cette semaine</td></tr>`;

  const upcomingRows = upcomingBookings.length > 0
    ? upcomingBookings.map(b => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eee">${b.client_name}</td>
        <td style="padding:10px;border-bottom:1px solid #eee">${b.motorcycle}</td>
        <td style="padding:10px;border-bottom:1px solid #eee">${formatDate(b.start_date)}</td>
        <td style="padding:10px;border-bottom:1px solid #eee">${formatDate(b.end_date)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="padding:10px;color:#999;text-align:center">Aucune réservation à venir</td></tr>`;

  return `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:680px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
    <span style="color:rgba(255,255,255,0.6);font-size:13px;margin-left:12px">Rapport hebdomadaire — semaine du ${formatDate(oneWeekAgo.toISOString())}</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 24px">📊 Résumé de la semaine</h2>

    <div style="display:flex;gap:16px;margin-bottom:32px">
      <div style="flex:1;background:#f8f8f8;border-radius:8px;padding:20px;text-align:center">
        <div style="font-size:32px;font-weight:800;color:#1a1a2e">${recentBookings.length}</div>
        <div style="color:#666;font-size:14px">Locations cette semaine</div>
      </div>
      <div style="flex:1;background:#f8f8f8;border-radius:8px;padding:20px;text-align:center">
        <div style="font-size:32px;font-weight:800;color:#f0a500">CHF ${totalRevenue.toFixed(0)}</div>
        <div style="color:#666;font-size:14px">Revenus estimés</div>
      </div>
      <div style="flex:1;background:#f8f8f8;border-radius:8px;padding:20px;text-align:center">
        <div style="font-size:32px;font-weight:800;color:#1a1a2e">${upcomingBookings.length}</div>
        <div style="color:#666;font-size:14px">Réservations à venir</div>
      </div>
    </div>

    <h3 style="color:#1a1a2e;border-bottom:2px solid #f0a500;padding-bottom:8px">🏆 Motos les plus louées</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:32px">
      <thead>
        <tr style="background:#f8f8f8">
          <th style="padding:10px;text-align:left">Moto</th>
          <th style="padding:10px;text-align:center">Locations</th>
        </tr>
      </thead>
      <tbody>${motoRows}</tbody>
    </table>

    <h3 style="color:#1a1a2e;border-bottom:2px solid #f0a500;padding-bottom:8px">📅 Prochaines réservations</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#f8f8f8">
          <th style="padding:10px;text-align:left">Client</th>
          <th style="padding:10px;text-align:left">Moto</th>
          <th style="padding:10px;text-align:left">Début</th>
          <th style="padding:10px;text-align:left">Fin</th>
        </tr>
      </thead>
      <tbody>${upcomingRows}</tbody>
    </table>
  </div>
  <div style="background:#f5f5f5;padding:12px 32px;text-align:center;font-size:11px;color:#999;border-radius:0 0 8px 8px">
    ZenithMoto Automation · Généré le ${now.toLocaleDateString('fr-CH')} à ${now.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}
  </div>
</div>`;
}

async function sendWeeklyReport() {
  console.log('📊 Génération du rapport hebdomadaire...');
  const bookings = loadBookings();
  const html = buildReport(bookings);

  const transport = getTransport();
  await transport.sendMail({
    from: `"ZenithMoto Automation" <${process.env.SMTP_EMAIL}>`,
    to: process.env.SMTP_EMAIL,
    subject: `📊 Rapport hebdomadaire ZenithMoto — ${new Date().toLocaleDateString('fr-CH')}`,
    html,
  });
  console.log(`✅ Rapport envoyé à ${process.env.SMTP_EMAIL}`);
}

// ── Daily KPI Telegram ────────────────────────────────────────────
// Push quotidien : nb bookings dernier 24h, revenu, prochaines arrivées du jour
async function sendDailyKpiTelegram() {
  const TG_BOT  = process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG_BOT || !TG_CHAT) return; // pas configuré → skip silencieux

  try {
    const bookings = loadBookings();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const today = now.toISOString().slice(0, 10);

    const newToday = bookings.filter((b) => {
      const d = b.created_at || b.start_date;
      return d && new Date(d) >= yesterday;
    });
    const startingToday = bookings.filter((b) => (b.start_date || "").slice(0, 10) === today);
    const endingToday = bookings.filter((b) => (b.end_date || "").slice(0, 10) === today);
    const revenue24h = newToday.reduce((s, b) => s + (Number(b.price) || 0), 0);

    const lines = [
      `🌅 *ZenithMoto — Daily Brief* ${now.toLocaleDateString("fr-CH", { weekday: "long", day: "2-digit", month: "long" })}`,
      "",
      `📥 ${newToday.length} nouvelle${newToday.length > 1 ? "s" : ""} réservation${newToday.length > 1 ? "s" : ""} (24h)`,
      `💰 Revenu 24h : CHF ${revenue24h}`,
      `🏍️ Départs aujourd'hui : ${startingToday.length}`,
      `🏁 Retours aujourd'hui : ${endingToday.length}`,
    ];

    if (startingToday.length > 0) {
      lines.push("", "*Départs du jour :*");
      for (const b of startingToday.slice(0, 5)) {
        lines.push(`• ${b.client_name || "?"} — ${b.motorcycle || "?"}`);
      }
    }
    if (endingToday.length > 0) {
      lines.push("", "*Retours du jour :*");
      for (const b of endingToday.slice(0, 5)) {
        lines.push(`• ${b.client_name || "?"} — ${b.motorcycle || "?"}`);
      }
    }

    const text = lines.join("\n");
    const axios = require("axios");
    await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
      chat_id: TG_CHAT,
      text,
      parse_mode: "Markdown",
    }, { timeout: 8000 });
    console.log(`[reports] Daily KPI envoyé (${newToday.length} new, ${startingToday.length} dep, ${endingToday.length} ret)`);
  } catch (e) {
    console.warn("[reports] Daily KPI échec :", e.message);
  }
}

// ── Rapport KPI hebdomadaire avancé Telegram (dimanche 20h) ────────
// Utilise lib/analytics → revenue / occupation / repeat rate / WoW
async function sendWeeklyKpiTelegram() {
  const TG_BOT  = process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG_BOT || !TG_CHAT) return;

  try {
    const { weeklyKpis } = require('./lib/analytics');
    const k = await weeklyKpis();

    const wowEmoji = k.wow_pct == null ? '–' : (k.wow_pct >= 0 ? `📈 +${k.wow_pct.toFixed(0)}%` : `📉 ${k.wow_pct.toFixed(0)}%`);
    const occEmoji = k.occupation_pct >= 70 ? '🟢' : (k.occupation_pct >= 40 ? '🟡' : '🔴');

    const lines = [
      `📊 *ZenithMoto — Rapport hebdo* (${k.period_start} → ${k.period_end})`,
      "",
      `💰 Revenu : *CHF ${k.revenue}*  ${wowEmoji}`,
      `📥 Bookings : ${k.bookings_count}`,
      `${occEmoji} Occupation : ${k.occupation_pct}% (${k.rented_days}j sur ${k.fleet_size}×7)`,
      `🔁 Repeat rate : ${k.repeat_rate_pct}% (${k.repeat_bookings}/${k.bookings_count})`,
    ];
    if (k.top_moto) lines.push(`🏆 Top moto : ${k.top_moto.name} (${k.top_moto.count} loc.)`);

    const axios = require('axios');
    await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
      chat_id: TG_CHAT,
      text: lines.join('\n'),
      parse_mode: 'Markdown',
    }, { timeout: 8000 });
    console.log(`[reports] Weekly KPI envoyé (revenue=${k.revenue}, occ=${k.occupation_pct}%, repeat=${k.repeat_rate_pct}%)`);
  } catch (e) {
    console.warn('[reports] Weekly KPI échec :', e.message);
  }
}

module.exports = { sendWeeklyReport, sendDailyKpiTelegram, sendWeeklyKpiTelegram };

if (require.main === module) {
  sendWeeklyReport().catch(console.error);
}

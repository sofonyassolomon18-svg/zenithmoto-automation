// retention.js — Customer retention + abandon cart recovery
// 2 fonctions appelées par le scheduler :
//   - notifyVipOnNewBooking(booking) : si client revient pour la 3e+ location → notif Telegram
//   - recoverAbandonedBookings()     : cron 30min, détecte bookings pending > 1h → email incentive 5%

const nodemailer = require('nodemailer');
const { isVipCustomer, findAbandonedBookings } = require('./lib/analytics');
const { notify } = require('./lib/telegram');
const { upsert, select } = require('./lib/supabase');
const { retry, deadLetter } = require('./lib/circuit-breaker');

const SMTP_USER = process.env.SMTP_EMAIL || 'zenithmoto.ch@gmail.com';
const APP_PASS  = process.env.GMAIL_APP_PASSWORD;

function _transport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SMTP_USER, pass: APP_PASS },
  });
}

// ─── VIP detection ────────────────────────────────────────────────
// Appelé après création d'un booking via webhook /webhook/booking
async function notifyVipOnNewBooking(booking) {
  if (!booking?.client_email) return;
  const v = await isVipCustomer(booking.client_email);
  if (!v.vip) return;
  const msg = `[ZenithMoto VIP] ${v.name || booking.client_name} revient pour sa ${v.count}e location ! Total dépensé : CHF ${v.totalSpent}. → ${booking.motorcycle || booking.moto} ${booking.start_date}`;
  await notify(msg, 'success', { project: 'zenithmoto' });

  // Tag le client en VIP dans Supabase pour suivre dans le futur
  await upsert('customers', {
    email: (booking.client_email || '').toLowerCase().trim(),
    name: v.name || booking.client_name,
    rental_count: v.count,
    total_spent: v.totalSpent,
    is_vip: true,
    last_booking_at: new Date().toISOString(),
  }, { onConflict: 'email' });

  return { notified: true, count: v.count };
}

// ─── Abandon cart recovery ────────────────────────────────────────
function emailAbandonedCart(booking) {
  const moto = booking.moto || booking.motorcycle || 'votre moto';
  const name = booking.client_name || 'cher motard';
  const link = `https://zenithmoto.ch/checkout?b=${booking.id}&promo=COMEBACK5`;
  return {
    to: booking.client_email,
    subject: `Vous avez oublié quelque chose — 5% sur votre location ZenithMoto`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 20px">Encore quelques secondes…</h2>
    <p>Bonjour <strong>${name}</strong>,</p>
    <p>Nous avons remarqué que vous étiez sur le point de réserver le <strong>${moto}</strong> mais que vous n'avez pas finalisé.</p>
    <p>Pour vous aider à franchir le pas, voici un code <strong>−5%</strong> valable 24h :</p>
    <div style="text-align:center;margin:28px 0">
      <div style="display:inline-block;background:#f0a500;color:#1a1a2e;padding:14px 32px;border-radius:8px;font-size:20px;font-weight:800;letter-spacing:2px">COMEBACK5</div>
    </div>
    <div style="text-align:center;margin:28px 0">
      <a href="${link}" style="background:#1a1a2e;color:#fff;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;display:inline-block">Finaliser ma réservation</a>
    </div>
    <p style="color:#666">Une question ? Répondez simplement à cet email, on revient vers vous dans la journée.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#666;font-size:13px">L'équipe ZenithMoto<br>zenithmoto.ch@gmail.com · zenithmoto.ch<br>Rue Centrale 1, 2502 Bienne (BE), Suisse</p>
    <p style="color:#aaa;font-size:11px;margin-top:8px">Vous recevez cet email suite à une tentative de réservation chez ZenithMoto. <a href="mailto:zenithmoto.ch@gmail.com?subject=Désabonnement" style="color:#aaa;">Se désinscrire</a></p>
  </div>
</div>`,
  };
}

// Option B : la colonne bookings.recovery_email_sent est dans le projet Lovable (zesestjrccumdpuesszl)
// inaccessible via ce PAT. On stocke l'état dans automations_state (même projet edcvmgpcllhszxvthdzx).
async function _markRecoverySent(bookingId, clientEmail) {
  await upsert('automations_state', {
    scope: 'recovery_email_sent',
    key: String(bookingId),
    value: { sent_at: new Date().toISOString(), email: clientEmail || null },
  }, { onConflict: 'scope,key' });
}

// Retourne Set des booking IDs pour lesquels un email recovery a déjà été envoyé.
async function _getSentRecoveryIds() {
  const rows = await select('automations_state', "scope=eq.recovery_email_sent&select=key");
  if (!Array.isArray(rows)) return new Set();
  return new Set(rows.map(r => String(r.key)));
}

async function recoverAbandonedBookings() {
  if (!APP_PASS) return { skipped: 'no-smtp' };
  // findAbandonedBookings filtre status=pending + filtre b.recovery_email_sent (côté Lovable DB).
  // On complète ici avec notre propre idempotence via automations_state.
  const candidates = await findAbandonedBookings({ thresholdMin: 60, maxAgeHours: 24 });
  if (candidates.length === 0) return { count: 0, sent: 0 };

  const alreadySent = await _getSentRecoveryIds();
  const abandoned = candidates.filter(b => b.id != null && !alreadySent.has(String(b.id)));
  if (abandoned.length === 0) return { count: 0, sent: 0, skipped: candidates.length };

  const transport = _transport();
  let sent = 0;
  for (const b of abandoned) {
    if (!b.client_email) continue;
    const msg = emailAbandonedCart(b);
    try {
      await retry(() => transport.sendMail({
        from: `"ZenithMoto" <${SMTP_USER}>`,
        ...msg,
      }), { tries: 3, baseMs: 500, maxMs: 4000 });
      await _markRecoverySent(b.id, b.client_email);
      sent++;
      console.log(`[retention] recovery email → ${b.client_email}`);
    } catch (e) {
      console.error(`[retention] recovery FAIL → ${b.client_email}: ${e.message}`);
      deadLetter.push({ kind: 'recovery_email', booking_id: b.id, email: b.client_email, error: e.message });
    }
  }
  if (sent > 0) {
    await notify(`${sent} email(s) de récupération envoyés (${abandoned.length} bookings abandonnés détectés)`, 'info', { project: 'zenithmoto' });
  }
  return { count: abandoned.length, sent };
}

module.exports = { notifyVipOnNewBooking, recoverAbandonedBookings, emailAbandonedCart };

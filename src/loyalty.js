// src/loyalty.js — programme fidélité ZenithMoto
// Levels : bronze (<5), silver (5-9), gold (10+)
// +1 point par location terminée. Récompenses à 5 (-10%) et 10 (1 jour offert).
// Auto-email FR/DE level-up + auto-Stripe coupon.

const axios = require('axios');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { notify } = require('./lib/telegram');
const { upsert, select } = require('./lib/supabase');

const SUPA_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function _h() {
  return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };
}

function levelFromPoints(p) {
  if (p >= 10) return 'gold';
  if (p >= 5) return 'silver';
  return 'bronze';
}

async function getLoyalty(email) {
  if (!SUPA_KEY) return null;
  try {
    const r = await axios.get(
      `${SUPA_URL}/rest/v1/loyalty_points?customer_id=eq.${encodeURIComponent(email)}&select=*`,
      { headers: _h(), timeout: 8000 }
    );
    return Array.isArray(r.data) && r.data.length ? r.data[0] : null;
  } catch (e) {
    console.warn('[loyalty:get]', e.message);
    return null;
  }
}

async function setLoyalty(email, points, level) {
  if (!SUPA_KEY) return null;
  try {
    await axios.post(
      `${SUPA_URL}/rest/v1/loyalty_points?on_conflict=customer_id`,
      { customer_id: email, points, level, updated_at: new Date().toISOString() },
      { headers: { ..._h(), Prefer: 'resolution=merge-duplicates,return=minimal' }, timeout: 8000 }
    );
  } catch (e) {
    console.warn('[loyalty:set]', e.message);
  }
}

async function createStripeCoupon(percent, name) {
  if (!stripe) return null;
  try {
    const c = await stripe.coupons.create({
      percent_off: percent,
      duration: 'once',
      name,
      max_redemptions: 1,
    });
    return c.id;
  } catch (e) {
    console.warn('[loyalty:coupon]', e.message);
    return null;
  }
}

function emailLevelUp(email, level, points, couponCode, lang = 'fr') {
  const isDE = lang === 'de';
  const subject = isDE
    ? `🏆 Sie sind jetzt ${level.toUpperCase()} — ZenithMoto Treueprogramm`
    : `🏆 Vous êtes maintenant ${level.toUpperCase()} — Programme fidélité ZenithMoto`;
  const couponBlock = couponCode
    ? (isDE
      ? `<p>Ihr persönlicher Gutscheincode: <strong style="font-size:18px;color:#f0a500">${couponCode}</strong></p>`
      : `<p>Votre code promo personnel : <strong style="font-size:18px;color:#f0a500">${couponCode}</strong></p>`)
    : '';
  const reward = level === 'gold'
    ? (isDE ? '1 Tag gratis bei Ihrer nächsten Buchung' : '1 jour offert sur votre prochaine location')
    : (isDE ? '10 % Rabatt auf Ihre nächste Buchung' : '10 % de remise sur votre prochaine location');
  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e">${isDE ? 'Glückwunsch!' : 'Félicitations !'}</h2>
    <p>${isDE ? 'Sie haben das Level' : 'Vous venez de débloquer le niveau'} <strong>${level.toUpperCase()}</strong> ${isDE ? 'erreicht' : ''} (${points} ${isDE ? 'Punkte' : 'points'}).</p>
    <p>${isDE ? 'Ihre Belohnung' : 'Votre récompense'} : <strong>${reward}</strong>.</p>
    ${couponBlock}
    <p style="color:#666;font-size:13px;margin-top:24px">${isDE ? 'Gültig 6 Monate.' : 'Valable 6 mois.'}</p>
  </div>
</div>`;
  return { subject, html };
}

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_EMAIL || !process.env.GMAIL_APP_PASSWORD) return;
  const t = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
  await t.sendMail({ from: `"ZenithMoto" <${process.env.SMTP_EMAIL}>`, to, subject, html });
}

async function awardPoint(email, lang = 'fr') {
  if (!email) return null;
  const cur = await getLoyalty(email);
  const oldPoints = cur?.points || 0;
  const newPoints = oldPoints + 1;
  const oldLevel = cur?.level || 'bronze';
  const newLevel = levelFromPoints(newPoints);
  await setLoyalty(email, newPoints, newLevel);

  let couponCode = null;
  let levelUp = oldLevel !== newLevel;
  let thresholdHit = false;

  if (newPoints === 5) {
    couponCode = await createStripeCoupon(10, `LOYALTY-SILVER-${email}-${Date.now()}`);
    thresholdHit = true;
  } else if (newPoints === 10) {
    couponCode = await createStripeCoupon(100, `LOYALTY-GOLD-${email}-${Date.now()}`);
    thresholdHit = true;
  }

  if (levelUp || thresholdHit) {
    try {
      const { subject, html } = emailLevelUp(email, newLevel, newPoints, couponCode, lang);
      await sendEmail(email, subject, html);
    } catch (e) {
      console.warn('[loyalty:email]', e.message);
    }
    await notify(`🏆 ${email} → ${newLevel.toUpperCase()} (${newPoints} pts) ${couponCode ? '· coupon ' + couponCode : ''}`, 'success', { project: 'zenithmoto' });
  }

  return { email, points: newPoints, level: newLevel, levelUp, couponCode };
}

// Cron : scan locations terminées dernières 24h
async function runLoyaltyDaily() {
  if (!SUPA_KEY) return { processed: 0 };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  let bookings = [];
  try {
    const r = await axios.get(
      `${SUPA_URL}/rest/v1/bookings?end_date=eq.${since}&status=in.(confirmed,completed,paid)&loyalty_awarded=is.null&select=*`,
      { headers: _h(), timeout: 10000 }
    );
    bookings = r.data || [];
  } catch (e) {
    console.warn('[loyalty:scan]', e.message);
    return { processed: 0, error: e.message };
  }

  let awarded = 0;
  for (const b of bookings) {
    if (!b.client_email) continue;
    const lang = (b.lang || b.locale || 'fr').toLowerCase().startsWith('de') ? 'de' : 'fr';
    await awardPoint(b.client_email, lang);
    // mark
    try {
      await axios.patch(
        `${SUPA_URL}/rest/v1/bookings?id=eq.${b.id}`,
        { loyalty_awarded: true },
        { headers: { ..._h(), Prefer: 'return=minimal' }, timeout: 5000 }
      );
    } catch (e) { /* swallow */ }
    awarded++;
  }
  if (awarded > 0) {
    await notify(`Loyalty daily : ${awarded} points attribués`, 'info', { project: 'zenithmoto' });
  }
  return { processed: bookings.length, awarded };
}

// Endpoint helper
function mountLoyaltyRoutes(app) {
  app.get('/api/loyalty/:email', async (req, res) => {
    const email = req.params.email;
    const data = await getLoyalty(email);
    const points = data?.points || 0;
    const level = data?.level || 'bronze';
    const nextReward = points < 5
      ? { at: 5, reward: '10% off', remaining: 5 - points }
      : points < 10
      ? { at: 10, reward: '1 jour offert', remaining: 10 - points }
      : { at: null, reward: 'max', remaining: 0 };
    res.json({ email, points, level, next: nextReward });
  });
}

module.exports = { awardPoint, runLoyaltyDaily, getLoyalty, mountLoyaltyRoutes, levelFromPoints };

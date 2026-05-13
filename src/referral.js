// src/referral.js — programme parrainage ZenithMoto
// Table : referrals(referrer_email, referee_email, status, reward_issued, coupon_code, created_at)
// Endpoint POST /api/referral { referrer_email, referee_email }
// Quand le filleul réserve : auto-Stripe coupon 20% pour le parrain + email.

const axios = require('axios');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { notify } = require('./lib/telegram');

const SUPA_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function _h(extra = {}) {
  return { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', ...extra };
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

async function createReferral(referrer_email, referee_email) {
  if (!SUPA_KEY) return { ok: false, error: 'no_supabase' };
  if (!EMAIL_RE.test(referrer_email) || !EMAIL_RE.test(referee_email)) {
    return { ok: false, error: 'invalid_email' };
  }
  if (referrer_email.toLowerCase() === referee_email.toLowerCase()) {
    return { ok: false, error: 'self_referral' };
  }
  try {
    await axios.post(
      `${SUPA_URL}/rest/v1/referrals`,
      {
        referrer_email,
        referee_email,
        status: 'pending',
        reward_issued: false,
        created_at: new Date().toISOString(),
      },
      { headers: _h({ Prefer: 'return=minimal' }), timeout: 8000 }
    );
    return { ok: true };
  } catch (e) {
    console.warn('[referral:create]', e.response?.data || e.message);
    return { ok: false, error: e.message };
  }
}

async function findPendingReferralForReferee(referee_email) {
  if (!SUPA_KEY) return null;
  try {
    const r = await axios.get(
      `${SUPA_URL}/rest/v1/referrals?referee_email=eq.${encodeURIComponent(referee_email)}&status=eq.pending&reward_issued=is.false&select=*`,
      { headers: _h(), timeout: 8000 }
    );
    return Array.isArray(r.data) && r.data.length ? r.data[0] : null;
  } catch (e) {
    console.warn('[referral:find]', e.message);
    return null;
  }
}

async function createStripeCoupon20(name) {
  if (!stripe) return null;
  try {
    const c = await stripe.coupons.create({
      percent_off: 20,
      duration: 'once',
      name,
      max_redemptions: 1,
    });
    return c.id;
  } catch (e) {
    console.warn('[referral:coupon]', e.message);
    return null;
  }
}

async function sendReferralReward(referrer_email, couponCode) {
  if (!process.env.SMTP_EMAIL || !process.env.GMAIL_APP_PASSWORD) return;
  const t = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e">🎁 Votre parrainage a payé !</h2>
    <p>Merci d'avoir recommandé ZenithMoto. Votre filleul a réservé — voici votre récompense :</p>
    <p style="text-align:center;font-size:22px;color:#f0a500;font-weight:800;margin:24px 0">${couponCode}</p>
    <p>20 % de remise sur votre prochaine location, valable 6 mois.</p>
    <p style="color:#666;font-size:13px">Danke / Thank you / Merci</p>
  </div>
</div>`;
  await t.sendMail({
    from: `"ZenithMoto" <${process.env.SMTP_EMAIL}>`,
    to: referrer_email,
    subject: '🎁 Votre récompense parrainage — ZenithMoto',
    html,
  });
}

// À appeler depuis le webhook booking_created ou paid
async function processRefereeBooking(referee_email) {
  const ref = await findPendingReferralForReferee(referee_email);
  if (!ref) return null;
  const couponCode = await createStripeCoupon20(`REFERRAL-${ref.referrer_email}-${Date.now()}`);
  // mark issued
  try {
    await axios.patch(
      `${SUPA_URL}/rest/v1/referrals?id=eq.${ref.id}`,
      { status: 'rewarded', reward_issued: true, coupon_code: couponCode, rewarded_at: new Date().toISOString() },
      { headers: _h({ Prefer: 'return=minimal' }), timeout: 5000 }
    );
  } catch (e) { console.warn('[referral:patch]', e.message); }
  try {
    await sendReferralReward(ref.referrer_email, couponCode);
  } catch (e) { console.warn('[referral:email]', e.message); }
  await notify(`🎁 Parrainage : ${ref.referrer_email} → coupon ${couponCode}`, 'success', { project: 'zenithmoto' });
  return { referrer_email: ref.referrer_email, couponCode };
}

function mountReferralRoutes(app) {
  app.post('/api/referral', async (req, res) => {
    const { referrer_email, referee_email } = req.body || {};
    if (!referrer_email || !referee_email) {
      return res.status(400).json({ error: 'referrer_email and referee_email required' });
    }
    const r = await createReferral(referrer_email, referee_email);
    if (!r.ok) return res.status(400).json(r);
    res.json({ ok: true });
  });
}

module.exports = { createReferral, processRefereeBooking, mountReferralRoutes };

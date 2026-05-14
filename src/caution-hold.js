// caution-hold.js — Stripe security deposit (caution) lifecycle for ZenithMoto
// Flow: holdCaution() on booking confirmed → releaseCaution() on clean return
//       OR captureCaution() on damage.
const Stripe = require('stripe');
const { upsert, select } = require('./lib/supabase');
const { notify } = require('./lib/telegram');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

const TABLE = 'caution_holds';
const DEFAULT_CAUTION_CHF = Number(process.env.CAUTION_DEFAULT_CHF || 1500);

function chfToCents(amount) {
  return Math.round(Number(amount) * 100);
}

async function _getBooking(bookingId) {
  const rows = await select('bookings', `id=eq.${bookingId}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}

async function _getHold(bookingId) {
  const rows = await select(TABLE, `booking_id=eq.${bookingId}&select=*&order=created_at.desc&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

async function holdCaution(bookingId, amountCHF = DEFAULT_CAUTION_CHF) {
  // ZenithMoto policy 2026-05-14 — rentals offered without security deposit.
  // Hold creation is disabled. Damage charges, if any, are billed directly
  // via Stripe invoice after the rental ends.
  if (process.env.CAUTION_ENABLED !== '1') {
    console.log(`[caution] disabled by policy — skipping hold for booking ${bookingId}`);
    return { paymentIntentId: null, status: 'disabled', skipped: true };
  }
  if (!stripe) throw new Error('STRIPE_SECRET_KEY missing');
  if (!bookingId) throw new Error('bookingId required');

  const existing = await _getHold(bookingId);
  if (existing && ['requires_capture', 'hold_active'].includes(existing.status)) {
    return { paymentIntentId: existing.payment_intent_id, status: existing.status, reused: true };
  }

  const booking = await _getBooking(bookingId);
  const customerStripeId = booking?.stripe_customer_id || null;
  const paymentMethodId = booking?.stripe_payment_method_id || null;

  const intentParams = {
    amount: chfToCents(amountCHF),
    currency: 'chf',
    capture_method: 'manual',
    confirm: !!paymentMethodId,
    metadata: { booking_id: String(bookingId), kind: 'caution_hold' },
    description: `ZenithMoto caution booking ${bookingId}`,
  };
  if (customerStripeId) intentParams.customer = customerStripeId;
  if (paymentMethodId) {
    intentParams.payment_method = paymentMethodId;
    intentParams.off_session = true;
  }

  const intent = await stripe.paymentIntents.create(intentParams);

  await upsert(TABLE, {
    booking_id: bookingId,
    payment_intent_id: intent.id,
    status: intent.status, // 'requires_capture' on success
    hold_amount: amountCHF,
    captured_amount: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'booking_id' });

  await notify(
    `Caution hold CHF ${amountCHF} booking ${bookingId} → ${intent.status} (${intent.id})`,
    intent.status === 'requires_capture' ? 'success' : 'warn',
    { project: 'zenithmoto' }
  );

  return { paymentIntentId: intent.id, status: intent.status, clientSecret: intent.client_secret };
}

async function releaseCaution(bookingId) {
  if (!stripe) throw new Error('STRIPE_SECRET_KEY missing');
  const hold = await _getHold(bookingId);
  if (!hold) throw new Error(`No caution hold for booking ${bookingId}`);
  if (hold.status === 'released' || hold.status === 'canceled') {
    return { status: 'already_released', paymentIntentId: hold.payment_intent_id };
  }

  const intent = await stripe.paymentIntents.cancel(hold.payment_intent_id, {
    cancellation_reason: 'requested_by_customer',
  });

  await upsert(TABLE, {
    booking_id: bookingId,
    payment_intent_id: intent.id,
    status: 'released',
    released_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'booking_id' });

  await notify(
    `Caution RELEASED booking ${bookingId} (CHF ${hold.hold_amount} returned)`,
    'success',
    { project: 'zenithmoto' }
  );

  return { status: 'released', paymentIntentId: intent.id };
}

async function captureCaution(bookingId, amountCHF) {
  if (!stripe) throw new Error('STRIPE_SECRET_KEY missing');
  const hold = await _getHold(bookingId);
  if (!hold) throw new Error(`No caution hold for booking ${bookingId}`);
  if (hold.status === 'captured' || hold.status === 'partial_captured') {
    return { status: 'already_captured', paymentIntentId: hold.payment_intent_id };
  }

  const captureAmt = amountCHF ? chfToCents(amountCHF) : chfToCents(hold.hold_amount);
  const maxAmt = chfToCents(hold.hold_amount);
  const finalAmt = Math.min(captureAmt, maxAmt);
  const partial = finalAmt < maxAmt;

  const intent = await stripe.paymentIntents.capture(hold.payment_intent_id, {
    amount_to_capture: finalAmt,
  });

  await upsert(TABLE, {
    booking_id: bookingId,
    payment_intent_id: intent.id,
    status: partial ? 'partial_captured' : 'captured',
    captured_amount: finalAmt / 100,
    captured_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'booking_id' });

  await notify(
    `Caution CAPTURED CHF ${finalAmt / 100}${partial ? ` partial (max ${hold.hold_amount})` : ''} booking ${bookingId}`,
    'warn',
    { project: 'zenithmoto' }
  );

  return { status: partial ? 'partial_captured' : 'captured', amountCHF: finalAmt / 100, paymentIntentId: intent.id };
}

/**
 * chargeDamage — bill the customer for damage after a no-deposit rental.
 * Strategy:
 *   1. Try an off-session PaymentIntent against the stored PaymentMethod
 *      (recorded from the original booking checkout). Best UX, near-instant.
 *   2. If no PM on file, the off-session charge fails, or 3DS authentication
 *      is required, fall back to a hosted Stripe Invoice emailed to the
 *      customer. Always works; legal trail; ~24h to settle.
 * Persists the outcome in `damage_charges` table and notifies via Telegram.
 */
const MAX_DAMAGE_CHF = Number(process.env.MAX_DAMAGE_CHF || 5000);
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a Resend-friendly HTML email with damage photos + amount + payment link.
 */
function _buildDamageEmail({ customerName, bookingId, amount, reason, photos, paymentLink, kind }) {
  const photosHtml = (photos || []).slice(0, 8).map((url) => `
    <td style="padding:4px"><img src="${url}" alt="dommage" style="width:130px;height:130px;object-fit:cover;border-radius:6px;border:1px solid #eee"/></td>
  `).join('');
  const payHtml = paymentLink
    ? `<div style="text-align:center;margin:28px 0">
         <a href="${paymentLink}" style="background:#f0a500;color:#1a1a2e;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;display:inline-block">Régler ${amount} CHF</a>
       </div>
       <p style="font-size:12px;color:#666;text-align:center;margin:0 0 24px">Lien sécurisé Stripe — paiement carte / TWINT / SEPA. Valide 14 jours.</p>`
    : `<div style="background:#e7f5ee;border:1px solid #2da06b;border-radius:8px;padding:14px;margin:24px 0">
         <p style="margin:0;color:#155c3b;font-weight:600">✅ Paiement de ${amount} CHF prélevé sur la carte enregistrée lors de votre réservation.</p>
       </div>`;
  const firstName = (customerName || 'cher client').split(/\s+/)[0];
  return {
    to: undefined, // injected by caller
    subject: paymentLink
      ? `Constat de dommage et facture — réservation ZM-${bookingId} · ${amount} CHF`
      : `Constat de dommage et paiement — réservation ZM-${bookingId} · ${amount} CHF`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <h2 style="color:#1a1a2e;margin:0 0 20px">Constat de dommage</h2>
    <p>Bonjour <strong>${firstName}</strong>,</p>
    <p>Suite à la restitution de votre location <strong>(réservation ZM-${bookingId})</strong>, des dommages ont été constatés. Vous trouverez ci-dessous le détail et les photos.</p>
    <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin:20px 0">
      <p style="margin:8px 0">📄 <strong>Description :</strong> ${reason || '—'}</p>
      <p style="margin:8px 0">💰 <strong>Montant :</strong> CHF ${amount}</p>
      <p style="margin:8px 0;font-size:12px;color:#666">${kind === 'invoice_sent' ? 'Une facture Stripe vous a également été envoyée séparément (lien hosted Stripe).' : 'Reçu Stripe envoyé séparément.'}</p>
    </div>
    ${photosHtml ? `<p style="margin:16px 0 8px;font-weight:600">📸 Photos :</p><table cellpadding="0" cellspacing="0" border="0"><tr>${photosHtml}</tr></table>` : ''}
    ${payHtml}
    <p>Conformément à nos conditions générales, le locataire est responsable des dommages causés au véhicule dans la limite de la franchise (CHF 2'000). Pour toute contestation ou question, répondez simplement à cet email — nous reviendrons vers vous dans la journée.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#666;font-size:13px">L'équipe ZenithMoto<br>zenithmoto.ch@gmail.com · zenithmoto.ch</p>
  </div>
</div>`,
  };
}

/**
 * Send damage email via Resend HTTPS API (avoids SMTP blocked on Railway).
 * No-op if RESEND_API_KEY missing or no recipient.
 */
async function _sendDamageEmail(to, payload) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return { skipped: true, reason: !key ? 'no_resend_key' : 'no_recipient' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'ZenithMoto <noreply@zenithmoto.ch>',
        to,
        subject: payload.subject,
        html: payload.html,
      }),
    });
    const json = await res.json().catch(() => ({}));
    return { sent: res.ok, id: json.id, status: res.status };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

async function chargeDamage(bookingId, amountCHF, reason = 'rental damage', options = {}) {
  if (!stripe) throw new Error('STRIPE_SECRET_KEY missing');
  if (!bookingId) throw new Error('bookingId required');
  const amount = Number(amountCHF);
  if (!amount || amount <= 0) throw new Error('amountCHF must be > 0');
  if (amount > MAX_DAMAGE_CHF) {
    throw new Error(`amountCHF ${amount} exceeds MAX_DAMAGE_CHF=${MAX_DAMAGE_CHF}. Set env var to raise cap.`);
  }

  // Idempotency: skip if an identical charge for the same booking landed in last 5 min
  try {
    const recent = await select(
      'damage_charges',
      `booking_id=eq.${bookingId}&amount_chf=eq.${amount}&order=created_at.desc&limit=1`
    );
    if (recent && recent[0]) {
      const ageMs = Date.now() - new Date(recent[0].created_at).getTime();
      if (ageMs < IDEMPOTENCY_WINDOW_MS && ['succeeded', 'sent'].includes(recent[0].status)) {
        return {
          status: 'duplicate_skipped',
          method: recent[0].method,
          paymentIntentId: recent[0].payment_intent_id,
          invoiceId: recent[0].invoice_id,
          amountCHF: amount,
          existingId: recent[0].id,
        };
      }
    }
  } catch (_) { /* table missing or transient — proceed */ }

  const booking = await _getBooking(bookingId);
  if (!booking) throw new Error(`booking ${bookingId} not found`);

  const customerEmail = booking.customer_email || booking.client_email;
  const customerName = booking.customer_name || booking.client_name || '';
  let customerStripeId = booking.stripe_customer_id || null;
  const paymentMethodId = booking.stripe_payment_method_id || null;

  // Ensure we have a Stripe Customer (needed for both paths)
  if (!customerStripeId && customerEmail) {
    const customer = await stripe.customers.create({
      email: customerEmail,
      name: customerName || undefined,
      metadata: { project: 'zenithmoto', booking_id: String(bookingId) },
    });
    customerStripeId = customer.id;
  }

  const baseRecord = {
    booking_id: bookingId,
    amount_chf: amount,
    reason,
    created_at: new Date().toISOString(),
  };

  // Path A — off-session charge against stored PaymentMethod
  if (paymentMethodId && customerStripeId) {
    try {
      const intent = await stripe.paymentIntents.create({
        amount: chfToCents(amount),
        currency: 'chf',
        customer: customerStripeId,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        description: `ZenithMoto — ${reason} (booking ${bookingId})`,
        metadata: { project: 'zenithmoto', booking_id: String(bookingId), kind: 'damage_charge' },
      });

      if (intent.status === 'succeeded') {
        await upsert('damage_charges', {
          ...baseRecord,
          method: 'off_session_pi',
          payment_intent_id: intent.id,
          status: 'succeeded',
        });
        await notify(
          `💳 Damage charged CHF ${amount} booking ${bookingId} (off-session OK)`,
          'warn',
          { project: 'zenithmoto' }
        );

        // Custom email with photos + amount (payment already settled — no link).
        const emailPayload = _buildDamageEmail({
          customerName,
          bookingId,
          amount,
          reason,
          photos: options.photos || [],
          paymentLink: null,
          kind: 'pi_succeeded',
        });
        const emailResult = await _sendDamageEmail(customerEmail, emailPayload);

        return {
          status: 'succeeded',
          method: 'off_session_pi',
          paymentIntentId: intent.id,
          amountCHF: amount,
          email: emailResult,
        };
      }
      // requires_action (3DS) — falls through to invoice path
    } catch (err) {
      // Authentication required, card declined, etc. — fall through to invoice
      await notify(
        `⚠️ Off-session charge failed booking ${bookingId} (${err.code || err.message}). Falling back to invoice.`,
        'warn',
        { project: 'zenithmoto' }
      );
    }
  }

  // Path B — hosted Stripe Invoice emailed to customer
  if (!customerStripeId) throw new Error('cannot create invoice: no customer/email on booking');

  const invoiceItem = await stripe.invoiceItems.create({
    customer: customerStripeId,
    amount: chfToCents(amount),
    currency: 'chf',
    description: `ZenithMoto — ${reason} (réservation ${bookingId})`,
    metadata: { project: 'zenithmoto', booking_id: String(bookingId), kind: 'damage_charge' },
  });

  const invoice = await stripe.invoices.create({
    customer: customerStripeId,
    collection_method: 'send_invoice',
    days_until_due: 14,
    description: `Facture de dommages — réservation ZenithMoto #${bookingId}`,
    metadata: { project: 'zenithmoto', booking_id: String(bookingId), kind: 'damage_charge' },
    auto_advance: true,
  });

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(invoice.id);
  const hostedInvoiceUrl = finalized.hosted_invoice_url || invoice.hosted_invoice_url || null;

  await upsert('damage_charges', {
    ...baseRecord,
    method: 'stripe_invoice',
    invoice_id: invoice.id,
    invoice_item_id: invoiceItem.id,
    status: 'sent',
  });

  await notify(
    `📧 Damage invoice sent CHF ${amount} booking ${bookingId} (${customerEmail}). Due in 14 days.`,
    'warn',
    { project: 'zenithmoto' }
  );

  // Custom email with photos + damage details + Stripe payment link.
  const emailPayload = _buildDamageEmail({
    customerName,
    bookingId,
    amount,
    reason,
    photos: options.photos || [],
    paymentLink: hostedInvoiceUrl,
    kind: 'invoice_sent',
  });
  const emailResult = await _sendDamageEmail(customerEmail, emailPayload);

  return {
    status: 'invoice_sent',
    method: 'stripe_invoice',
    invoiceId: invoice.id,
    invoiceUrl: hostedInvoiceUrl,
    amountCHF: amount,
    email: emailResult,
  };
}

module.exports = { holdCaution, releaseCaution, captureCaution, chargeDamage, DEFAULT_CAUTION_CHF };

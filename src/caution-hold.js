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

async function chargeDamage(bookingId, amountCHF, reason = 'rental damage') {
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
        return { status: 'succeeded', method: 'off_session_pi', paymentIntentId: intent.id, amountCHF: amount };
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

  await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(invoice.id);

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

  return { status: 'invoice_sent', method: 'stripe_invoice', invoiceId: invoice.id, amountCHF: amount };
}

module.exports = { holdCaution, releaseCaution, captureCaution, chargeDamage, DEFAULT_CAUTION_CHF };

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

module.exports = { holdCaution, releaseCaution, captureCaution, DEFAULT_CAUTION_CHF };

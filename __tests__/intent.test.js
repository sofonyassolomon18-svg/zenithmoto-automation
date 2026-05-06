// Tests intent extraction
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeEmail, detectIntent, detectMoto, detectDates, estimateQuote } = require('../src/lib/intent');

test('detect cancellation intent FR', () => {
  const r = detectIntent("Bonjour, je dois annuler ma réservation prévue.");
  assert.equal(r.intent, 'cancellation');
  assert.ok(r.confidence > 0.5);
});

test('detect cancellation intent DE', () => {
  const r = detectIntent("Ich möchte stornieren.");
  assert.equal(r.intent, 'cancellation');
});

test('detect booking request', () => {
  const r = detectIntent("Bonjour, je voudrais louer un TMAX pour le weekend du 18 juin.");
  assert.equal(r.intent, 'booking_request');
});

test('detect pricing question', () => {
  const r = detectIntent("Combien coûte la location du Tracer 700 ?");
  assert.equal(r.intent, 'pricing_question');
});

test('detect TMAX motorcycle', () => {
  const r = detectMoto("Je veux louer un TMAX 530 ce weekend");
  assert.equal(r.key, 'tmax_530');
  assert.equal(r.daily, 100);
});

test('detect Tracer fallback', () => {
  const r = detectMoto("Disponibilité Tracer ?");
  assert.equal(r.key, 'tracer_700');
});

test('detect dates DD/MM format', () => {
  const dates = detectDates("Je voudrais réserver du 18/06 au 19/06");
  assert.ok(dates.length === 2);
  assert.match(dates[0], /-06-18$/);
  assert.match(dates[1], /-06-19$/);
});

test('detect dates "12 mai" format', () => {
  const dates = detectDates("Disponible le 12 juin et le 13 juin ?");
  assert.ok(dates.length >= 2);
  assert.match(dates[0], /-06-12$/);
  assert.match(dates[1], /-06-13$/);
});

test('analyzeEmail returns canQuote when booking + 2 dates + moto', () => {
  const r = analyzeEmail({
    subject: 'Réservation TMAX',
    bodyText: "Bonjour, je voudrais louer le TMAX du 18/06 au 19/06.",
  });
  assert.equal(r.intent, 'booking_request');
  assert.equal(r.moto.key, 'tmax_530');
  assert.equal(r.dates.length, 2);
  assert.equal(r.canQuote, true);
});

test('estimateQuote weekend tariff for sat-sun', () => {
  const moto = { daily: 100, weekend: 180 };
  // 2026-06-13 = sat, 2026-06-14 = sun
  const q = estimateQuote(moto, '2026-06-13', '2026-06-14');
  assert.equal(q.days, 2);
  assert.equal(q.total, 180);
});

test('estimateQuote weekly multi-days', () => {
  const moto = { daily: 100, weekend: 180 };
  const q = estimateQuote(moto, '2026-06-15', '2026-06-19'); // 5 jours mon-fri
  assert.equal(q.days, 5);
  assert.equal(q.total, 500);
});

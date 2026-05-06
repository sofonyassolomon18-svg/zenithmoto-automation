// Tests analytics : customer lifetime, VIP detection, abandoned bookings, weekly KPIs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Désactive Supabase pour forcer le fallback fichier local
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;
delete process.env.SUPABASE_SERVICE_KEY;

// Setup fichier bookings.json fixture pour les tests
const bookingsFile = path.join(__dirname, '..', 'data', 'bookings.json');
const backup = fs.existsSync(bookingsFile) ? fs.readFileSync(bookingsFile, 'utf8') : null;

const today = new Date();
const daysAgo = (n) => new Date(today.getTime() - n * 86400000).toISOString();

const fixture = [
  // Client A : 3 locations (VIP)
  { client_email: 'alice@test.ch', client_name: 'Alice', moto: 'TMAX 530', start_date: daysAgo(40), end_date: daysAgo(39), price: 180, status: 'completed', created_at: daysAgo(45) },
  { client_email: 'alice@test.ch', client_name: 'Alice', moto: 'Tracer 700', start_date: daysAgo(20), end_date: daysAgo(19), price: 216, status: 'completed', created_at: daysAgo(25) },
  { client_email: 'ALICE@test.ch', client_name: 'Alice', moto: 'X-Max 300', start_date: daysAgo(3), end_date: daysAgo(2), price: 144, status: 'completed', created_at: daysAgo(5) },
  // Client B : 1 location
  { client_email: 'bob@test.ch', client_name: 'Bob', moto: 'TMAX 530', start_date: daysAgo(2), end_date: daysAgo(1), price: 180, status: 'completed', created_at: daysAgo(4) },
  // Cancelled doit être exclu
  { client_email: 'carl@test.ch', client_name: 'Carl', moto: 'TMAX 530', start_date: daysAgo(1), end_date: daysAgo(0), price: 180, status: 'cancelled', created_at: daysAgo(3) },
  // Booking abandonné (pending depuis 2h, sans recovery_email_sent)
  { id: 'pending-1', client_email: 'dora@test.ch', client_name: 'Dora', moto: 'X-ADV 750', start_date: daysAgo(-5), end_date: daysAgo(-4), price: 216, status: 'pending', created_at: new Date(Date.now() - 2 * 3600000).toISOString() },
  // Booking pending mais récent (< 1h) → ne pas recover
  { id: 'pending-2', client_email: 'eve@test.ch', client_name: 'Eve', moto: 'X-ADV 750', start_date: daysAgo(-7), end_date: daysAgo(-6), price: 216, status: 'pending', created_at: new Date(Date.now() - 30 * 60000).toISOString() },
];

fs.mkdirSync(path.dirname(bookingsFile), { recursive: true });
fs.writeFileSync(bookingsFile, JSON.stringify(fixture, null, 2));

const { customerLifetime, isVipCustomer, findAbandonedBookings, weeklyKpis, normalizeEmail } = require('../src/lib/analytics');

test.after(() => {
  if (backup !== null) fs.writeFileSync(bookingsFile, backup);
  else fs.unlinkSync(bookingsFile);
});

test('customerLifetime aggregates by lowercase email', async () => {
  const map = await customerLifetime();
  const alice = map.get('alice@test.ch');
  assert.ok(alice, 'alice trouvée');
  assert.equal(alice.count, 3, '3 locations agrégées (case insensitive)');
  assert.equal(alice.totalSpent, 540);
});

test('isVipCustomer returns true at 3 rentals', async () => {
  const v = await isVipCustomer('alice@test.ch');
  assert.equal(v.vip, true);
  assert.equal(v.count, 3);
});

test('isVipCustomer returns false at 1 rental', async () => {
  const v = await isVipCustomer('bob@test.ch');
  assert.equal(v.vip, false);
  assert.equal(v.count, 1);
});

test('findAbandonedBookings returns only pending > 60min, not the recent one', async () => {
  const ab = await findAbandonedBookings({ thresholdMin: 60 });
  const ids = ab.map(b => b.id);
  assert.ok(ids.includes('pending-1'), 'pending-1 (2h) inclus');
  assert.ok(!ids.includes('pending-2'), 'pending-2 (30min) exclu');
});

test('weeklyKpis returns a sane shape', async () => {
  const k = await weeklyKpis();
  assert.ok(typeof k.bookings_count === 'number');
  assert.ok(typeof k.revenue === 'number');
  assert.ok(typeof k.occupation_pct === 'number');
  assert.ok(typeof k.repeat_rate_pct === 'number');
  assert.ok(k.fleet_size === 5);
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Foo@BAR.CH  '), 'foo@bar.ch');
  assert.equal(normalizeEmail(undefined), '');
});

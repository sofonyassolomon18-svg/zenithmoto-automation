// Tests retention : VIP notifier + abandon cart recovery (avec mock SMTP/Telegram/Supabase)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

// ─── Setup ENV avant require ──────────────────────────────────────
process.env.GMAIL_APP_PASSWORD = 'fake-pass';
process.env.SMTP_EMAIL = 'zenithmoto.ch@gmail.com';
process.env.TELEGRAM_BOT_TOKEN = 'fake-bot';
process.env.TELEGRAM_CHAT_ID = '-1001';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;
delete process.env.SUPABASE_SERVICE_KEY;

// ─── Fixture bookings local ───────────────────────────────────────
const bookingsFile = path.join(__dirname, '..', 'data', 'bookings.json');
const backup = fs.existsSync(bookingsFile) ? fs.readFileSync(bookingsFile, 'utf8') : null;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const fixture = [
  // Vip Bob : déjà 3 locations historiques
  { client_email: 'bob@vip.ch', client_name: 'Bob', moto: 'TMAX 530', start_date: daysAgo(60), end_date: daysAgo(59), price: 180, status: 'completed', created_at: daysAgo(65) },
  { client_email: 'bob@vip.ch', client_name: 'Bob', moto: 'TMAX 530', start_date: daysAgo(40), end_date: daysAgo(39), price: 180, status: 'completed', created_at: daysAgo(45) },
  { client_email: 'bob@vip.ch', client_name: 'Bob', moto: 'TMAX 530', start_date: daysAgo(20), end_date: daysAgo(19), price: 180, status: 'completed', created_at: daysAgo(25) },
  // Newbie Charlie
  { client_email: 'charlie@new.ch', client_name: 'Charlie', moto: 'X-Max 125', start_date: daysAgo(2), end_date: daysAgo(1), price: 117, status: 'completed', created_at: daysAgo(5) },
  // Booking pending abandonné
  { id: 'abandoned-1', client_email: 'dora@cart.ch', client_name: 'Dora', moto: 'X-ADV 750', start_date: daysAgo(-5), end_date: daysAgo(-4), price: 216, status: 'pending', created_at: new Date(Date.now() - 2 * 3600000).toISOString() },
];
fs.mkdirSync(path.dirname(bookingsFile), { recursive: true });
fs.writeFileSync(bookingsFile, JSON.stringify(fixture, null, 2));

// ─── Mocks ────────────────────────────────────────────────────────
let state;
function reset() { state = { sentMail: [], telegramCalls: [], supabaseCalls: [] }; }

function injectMock(name, exportsObj) {
  const resolved = require.resolve(name, { paths: [path.join(__dirname, '..', 'src')] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const nodemailerMock = {
  createTransport: () => ({
    sendMail: async (p) => { state.sentMail.push(p); return { messageId: 'm-' + Date.now() }; },
  }),
};
const axiosMock = {
  post: async (url, body) => {
    if (url.includes('telegram')) state.telegramCalls.push({ url, body });
    if (url.includes('supabase.co')) state.supabaseCalls.push({ url, body });
    return { data: {}, status: 200 };
  },
  get: async () => ({ data: {}, status: 200 }),
};

injectMock('nodemailer', nodemailerMock);
injectMock('axios', axiosMock);

const { notifyVipOnNewBooking, recoverAbandonedBookings } = require('../src/retention');

test.after(() => {
  if (backup !== null) fs.writeFileSync(bookingsFile, backup);
  else if (fs.existsSync(bookingsFile)) fs.unlinkSync(bookingsFile);
});

test('notifyVipOnNewBooking notifies Telegram for VIP (3+ rentals)', async () => {
  reset();
  const r = await notifyVipOnNewBooking({
    client_email: 'bob@vip.ch', client_name: 'Bob', motorcycle: 'X-ADV 750', start_date: daysAgo(-1),
  });
  assert.equal(r.notified, true);
  assert.equal(r.count, 3);
  assert.ok(state.telegramCalls.length >= 1, 'telegram appelé');
  assert.match(state.telegramCalls[0].body.text, /VIP/);
  assert.match(state.telegramCalls[0].body.text, /Bob/);
});

test('notifyVipOnNewBooking ignores non-VIP (1 rental)', async () => {
  reset();
  const r = await notifyVipOnNewBooking({
    client_email: 'charlie@new.ch', client_name: 'Charlie', motorcycle: 'X-Max 125',
  });
  assert.equal(r, undefined, 'no notification returned');
  assert.equal(state.telegramCalls.length, 0);
});

test('recoverAbandonedBookings sends email -5% to abandoned', async () => {
  reset();
  const r = await recoverAbandonedBookings();
  assert.ok(r.count >= 1, 'au moins 1 abandoned détecté');
  assert.ok(r.sent >= 1, 'au moins 1 email envoyé');
  assert.equal(state.sentMail[0].to, 'dora@cart.ch');
  assert.match(state.sentMail[0].subject, /5%/);
  assert.match(state.sentMail[0].html, /COMEBACK5/);
});

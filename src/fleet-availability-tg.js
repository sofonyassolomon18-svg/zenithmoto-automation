// fleet-availability-tg.js — Daily 8h Telegram digest: which motos available/booked next 7 days.
// Reads Supabase `bookings` table, cross-references with FLEET list.
require('dotenv').config();
const axios = require('axios');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const TG_BOT   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

const FLEET = [
  { slug: 'yamaha-tracer-700', label: 'Tracer 700' },
  { slug: 'yamaha-tmax-530',   label: 'TMAX 530' },
  { slug: 'honda-x-adv-750',   label: 'X-ADV 750' },
  { slug: 'yamaha-x-max-300',  label: 'X-Max 300' },
  { slug: 'yamaha-x-max-125',  label: 'X-Max 125' },
];

function dateStr(d) { return d.toISOString().split('T')[0]; }

async function fetchBookingsNext7Days() {
  if (!SUPA_URL || !SUPA_KEY) return null;
  const today = new Date();
  const in7 = new Date(today.getTime() + 7 * 86400 * 1000);
  try {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/bookings?select=moto_id,moto,motorcycle,start_date,end_date,client_name,status&end_date=gte.${dateStr(today)}&start_date=lte.${dateStr(in7)}&status=neq.cancelled`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[fleet-avail] fetch failed:', e.message);
    return null;
  }
}

function matchMoto(slug, label, booking) {
  const h = (booking.moto_id || booking.moto || booking.motorcycle || '').toLowerCase();
  return h.includes(slug) || h.includes(label.toLowerCase().replace(/\s+/g, '-'))
      || h.includes(label.toLowerCase());
}

async function runFleetAvailability() {
  const bookings = await fetchBookingsNext7Days();
  if (bookings === null) {
    console.warn('[fleet-avail] supabase indisponible — skip');
    return { status: 'skipped' };
  }

  const lines = ['🏍️ *Dispo flotte — 7 prochains jours*', ''];
  for (const m of FLEET) {
    const motoBookings = bookings.filter(b => matchMoto(m.slug, m.label, b));
    if (motoBookings.length === 0) {
      lines.push(`✅ *${m.label}* — libre 7j`);
    } else {
      const ranges = motoBookings
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .map(b => `${b.start_date.slice(5)}→${b.end_date.slice(5)}${b.client_name ? ` (${b.client_name.split(' ')[0]})` : ''}`)
        .join(', ');
      lines.push(`📅 *${m.label}* — ${ranges}`);
    }
  }
  lines.push('');
  lines.push(`Total réservations: ${bookings.length}`);

  const text = lines.join('\n');
  if (TG_BOT && TG_CHAT) {
    try {
      await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`,
        { chat_id: TG_CHAT, text, parse_mode: 'Markdown' }, { timeout: 8000 });
    } catch (e) { console.warn('[fleet-avail] TG failed:', e.message); }
  } else {
    console.log(text);
  }
  return { status: 'ok', bookings: bookings.length };
}

module.exports = { runFleetAvailability };

if (require.main === module) {
  runFleetAvailability().then(r => { console.log(r); process.exit(0); });
}

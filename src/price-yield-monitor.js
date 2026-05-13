// price-yield-monitor.js — Weekly: occupancy/yield per moto over last 4 weeks.
// <40% → suggest -10%. >85% → suggest +10%. Telegram digest only (advisory, no auto-apply).
require('dotenv').config();
const axios = require('axios');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const TG_BOT   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

// Current rates CHF/day (mid-tier from fleet memory)
const FLEET = [
  { slug: 'yamaha-tracer-700', label: 'Tracer 700', day: 120 },
  { slug: 'yamaha-tmax-530',   label: 'TMAX 530',   day: 100 },
  { slug: 'honda-x-adv-750',   label: 'X-ADV 750',  day: 120 },
  { slug: 'yamaha-x-max-300',  label: 'X-Max 300',  day: 80 },
  { slug: 'yamaha-x-max-125',  label: 'X-Max 125',  day: 65 },
];

function dateStr(d) { return d.toISOString().split('T')[0]; }

function matchMoto(slug, label, booking) {
  const h = (booking.moto_id || booking.moto || booking.motorcycle || '').toLowerCase();
  return h.includes(slug) || h.includes(label.toLowerCase());
}

function bookingDays(b, from, to) {
  // Days within [from,to] that this booking covers
  const s = new Date(Math.max(new Date(b.start_date).getTime(), from.getTime()));
  const e = new Date(Math.min(new Date(b.end_date).getTime(), to.getTime()));
  if (e < s) return 0;
  return Math.max(0, Math.round((e - s) / 86400000) + 1);
}

async function fetchBookings4w() {
  if (!SUPA_URL || !SUPA_KEY) return null;
  const today = new Date();
  const from = new Date(today.getTime() - 28 * 86400 * 1000);
  try {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/bookings?select=moto_id,moto,motorcycle,start_date,end_date,status,price&end_date=gte.${dateStr(from)}&start_date=lte.${dateStr(today)}&status=neq.cancelled`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    if (!res.ok) return null;
    return { bookings: await res.json(), from, to: today };
  } catch (e) {
    console.warn('[price-yield] fetch failed:', e.message);
    return null;
  }
}

async function runPriceYieldMonitor() {
  const data = await fetchBookings4w();
  if (!data) return { status: 'skipped' };
  const { bookings, from, to } = data;
  const totalDays = Math.round((to - from) / 86400000) + 1;

  const lines = ['💰 *Price/yield monitor — 4 dernières semaines*', `Période: ${dateStr(from)} → ${dateStr(to)} (${totalDays}j)`, ''];
  const suggestions = [];

  for (const m of FLEET) {
    const mb = bookings.filter(b => matchMoto(m.slug, m.label, b));
    const occupied = mb.reduce((sum, b) => sum + bookingDays(b, from, to), 0);
    const pct = Math.round((occupied / totalDays) * 100);
    const revenue = occupied * m.day;

    let flag = '';
    if (pct < 40) {
      const newPrice = Math.round(m.day * 0.9);
      flag = ` 🔻 *suggérer ${m.day}→${newPrice} CHF (-10%)*`;
      suggestions.push(`${m.label}: ${pct}% → -10% (${m.day}→${newPrice})`);
    } else if (pct > 85) {
      const newPrice = Math.round(m.day * 1.1);
      flag = ` 🔺 *suggérer ${m.day}→${newPrice} CHF (+10%)*`;
      suggestions.push(`${m.label}: ${pct}% → +10% (${m.day}→${newPrice})`);
    }
    lines.push(`${m.label}: ${occupied}/${totalDays}j (${pct}%) · ~${revenue} CHF${flag}`);
  }

  if (suggestions.length === 0) {
    lines.push('');
    lines.push('✅ Tous les prix dans la zone normale (40-85% occupation).');
  }

  const text = lines.join('\n');
  if (TG_BOT && TG_CHAT) {
    try {
      await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`,
        { chat_id: TG_CHAT, text, parse_mode: 'Markdown' }, { timeout: 8000 });
    } catch (e) { console.warn('[price-yield] TG failed:', e.message); }
  } else {
    console.log(text);
  }
  return { status: 'ok', suggestions };
}

module.exports = { runPriceYieldMonitor };

if (require.main === module) {
  runPriceYieldMonitor().then(r => { console.log(r); process.exit(0); });
}

// jobs/morning-brief.js — daily 8h00 ZenithMoto digest (pickups, returns, MTD revenue)
const { createClient } = require('@supabase/supabase-js');
const { notify } = require('../lib/telegram');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

/** Escape MarkdownV2 reserved chars per Telegram spec */
function esc(s) {
  return String(s == null ? '' : s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/** Format YYYY-MM-DD in Europe/Zurich */
function todayCH() {
  const fmt = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

/** Friendly French date label */
function frDate(iso) {
  const d = new Date(iso + 'T08:00:00+02:00');
  return d.toLocaleDateString('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

/** Run the morning brief job */
async function runMorningBrief() {
  if (!SUPABASE_KEY) {
    console.warn('[morning-brief] SUPABASE_SERVICE_KEY missing — skip');
    return { ok: false, reason: 'no_key' };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const today = todayCH();
  const firstOfMonth = today.slice(0, 8) + '01';

  // Pickups today
  const { data: pickups = [], error: e1 } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_first_name, moto, moto_slug, start_date, start_time, status')
    .eq('start_date', today)
    .in('status', ['confirmed', 'paid', 'active']);

  if (e1) console.warn('[morning-brief] pickups err:', e1.message);

  // Returns today
  const { data: returns = [], error: e2 } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_first_name, moto, moto_slug, end_date, end_time, status')
    .eq('end_date', today)
    .in('status', ['confirmed', 'paid', 'active']);

  if (e2) console.warn('[morning-brief] returns err:', e2.message);

  // Revenue MTD
  const { data: mtd = [], error: e3 } = await supabase
    .from('bookings')
    .select('amount_total, total_amount, total_chf, status')
    .gte('start_date', firstOfMonth)
    .in('status', ['confirmed', 'paid', 'active', 'completed']);

  if (e3) console.warn('[morning-brief] mtd err:', e3.message);

  const revenueMTD = (mtd || []).reduce((s, b) => s + Number(b.amount_total || b.total_amount || b.total_chf || 0), 0);
  const countMTD = (mtd || []).length;

  const totalEvents = (pickups?.length || 0) + (returns?.length || 0);
  const header = `☀️ *ZenithMoto* · ${esc(frDate(today))}`;

  if (totalEvents === 0 && countMTD === 0) {
    await notify(`${header}\nAucune activité prévue\\.`, 'info', { project: 'zenithmoto' });
    return { ok: true, pickups: 0, returns: 0, revenue: 0 };
  }

  const fmtRow = (b, timeField) => {
    const name = b.customer_first_name || b.customer_name || '?';
    const moto = b.moto || b.moto_slug || '?';
    const t = b[timeField] || '';
    return `• ${esc(name)} — ${esc(moto)}${t ? ' · ' + esc(t) : ''}`;
  };

  const lines = [header];
  lines.push(`🏍️ Pickups today \\(${pickups.length}\\):`);
  if (pickups.length) pickups.forEach(b => lines.push(fmtRow(b, 'start_time')));
  else lines.push('• —');

  lines.push(`🏁 Returns today \\(${returns.length}\\):`);
  if (returns.length) returns.forEach(b => lines.push(fmtRow(b, 'end_time')));
  else lines.push('• —');

  lines.push(`💰 Revenue MTD: CHF ${esc(revenueMTD.toFixed(0))} \\(${countMTD} bookings\\)`);

  await notify(lines.join('\n'), 'info', { project: 'zenithmoto' });
  return { ok: true, pickups: pickups.length, returns: returns.length, revenue: revenueMTD };
}

module.exports = { runMorningBrief };

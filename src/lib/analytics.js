// lib/analytics.js — KPIs / rapports / detection clients récurrents
// Source : Supabase REST `bookings` table (single source of truth depuis migration Lovable)
// Fallback : data/bookings.json (dev local).

const fs = require('fs');
const path = require('path');
const { select } = require('./supabase');

const BOOKINGS_FILE = path.join(__dirname, '..', '..', 'data', 'bookings.json');

function _loadLocal() {
  try { return fs.existsSync(BOOKINGS_FILE) ? JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8')) : []; }
  catch { return []; }
}

// Récupère les bookings via Supabase, fallback fichier local.
// `whereSince` : ISO date string (start_date >= since) ou null pour tout.
async function fetchBookings({ since } = {}) {
  const supaUrl = process.env.SUPABASE_URL;
  if (supaUrl && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY)) {
    let q = 'select=*&order=start_date.desc&limit=2000';
    if (since) q += `&start_date=gte.${since}`;
    const data = await select('bookings', q);
    if (Array.isArray(data)) return data;
  }
  // Fallback local
  const all = _loadLocal();
  if (since) {
    const sinceDate = new Date(since);
    return all.filter(b => new Date(b.start_date) >= sinceDate);
  }
  return all;
}

// Normalise un email (lowercase, trim) pour matcher les clients récurrents
function normalizeEmail(e) {
  return (e || '').toLowerCase().trim();
}

// Compte le nombre de locations par client (basé sur email).
// Retourne map email → { count, totalSpent, lastDate, name }
async function customerLifetime({ since } = {}) {
  const bookings = await fetchBookings({ since });
  const map = new Map();
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    const email = normalizeEmail(b.client_email);
    if (!email) continue;
    const cur = map.get(email) || { count: 0, totalSpent: 0, lastDate: null, name: b.client_name, motorcycles: new Set() };
    cur.count++;
    cur.totalSpent += Number(b.price) || 0;
    if (b.moto || b.motorcycle) cur.motorcycles.add(b.moto || b.motorcycle);
    const d = b.start_date || b.created_at;
    if (d && (!cur.lastDate || d > cur.lastDate)) cur.lastDate = d;
    if (b.client_name) cur.name = b.client_name;
    map.set(email, cur);
  }
  return map;
}

// Détecte les clients qui viennent de passer à 3+ locations (VIP).
// `currentBooking` = booking qui vient d'être ajouté → est-ce sa 3e+ ?
async function isVipCustomer(email) {
  const map = await customerLifetime();
  const c = map.get(normalizeEmail(email));
  if (!c) return { vip: false, count: 0 };
  return { vip: c.count >= 3, count: c.count, totalSpent: c.totalSpent, name: c.name };
}

// Bookings considérés "abandonnés" : status pending depuis > thresholdMin minutes
async function findAbandonedBookings({ thresholdMin = 60, maxAgeHours = 24 } = {}) {
  const since = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const bookings = await fetchBookings({ since });
  const cutoff = new Date(Date.now() - thresholdMin * 60 * 1000);
  return bookings.filter(b => {
    if (b.status !== 'pending') return false;
    if (b.recovery_email_sent) return false;
    const created = new Date(b.created_at || b.start_date);
    return created < cutoff;
  });
}

// KPIs hebdomadaires (last 7 days)
async function weeklyKpis() {
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000);
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400000);
  const allBookings = await fetchBookings({ since: fourWeeksAgo.toISOString().slice(0, 10) });

  const thisWeek = allBookings.filter(b => new Date(b.created_at || b.start_date) >= oneWeekAgo && b.status !== 'cancelled');
  const lastWeek = allBookings.filter(b => {
    const d = new Date(b.created_at || b.start_date);
    return d < oneWeekAgo && d >= new Date(oneWeekAgo.getTime() - 7 * 86400000) && b.status !== 'cancelled';
  });

  const revThis = thisWeek.reduce((s, b) => s + (Number(b.price) || 0), 0);
  const revLast = lastWeek.reduce((s, b) => s + (Number(b.price) || 0), 0);
  const wow = revLast > 0 ? ((revThis - revLast) / revLast * 100) : null;

  // Taux d'occupation (sur 5 motos) : jours loués cette semaine / (5 motos × 7 jours)
  let rentedDays = 0;
  for (const b of thisWeek) {
    if (b.start_date && b.end_date) {
      const start = new Date(b.start_date);
      const end = new Date(b.end_date);
      const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
      rentedDays += days;
    }
  }
  const fleetSize = 5;
  const occupation = Math.round((rentedDays / (fleetSize * 7)) * 100);

  // Repeat rate : % bookings de cette semaine qui viennent de clients ayant déjà loué
  const lifetime = await customerLifetime({ since: fourWeeksAgo.toISOString().slice(0, 10) });
  const repeatBookings = thisWeek.filter(b => {
    const c = lifetime.get(normalizeEmail(b.client_email));
    return c && c.count > 1;
  });
  const repeatRate = thisWeek.length > 0 ? Math.round((repeatBookings.length / thisWeek.length) * 100) : 0;

  // Top moto cette semaine
  const motoCount = {};
  for (const b of thisWeek) {
    const k = b.moto || b.motorcycle;
    if (k) motoCount[k] = (motoCount[k] || 0) + 1;
  }
  const topMoto = Object.entries(motoCount).sort((a, b) => b[1] - a[1])[0];

  return {
    period_start: oneWeekAgo.toISOString().slice(0, 10),
    period_end: new Date().toISOString().slice(0, 10),
    bookings_count: thisWeek.length,
    revenue: revThis,
    revenue_last_week: revLast,
    wow_pct: wow,
    rented_days: rentedDays,
    occupation_pct: occupation,
    repeat_rate_pct: repeatRate,
    repeat_bookings: repeatBookings.length,
    top_moto: topMoto ? { name: topMoto[0], count: topMoto[1] } : null,
    fleet_size: fleetSize,
  };
}

module.exports = {
  fetchBookings,
  customerLifetime,
  isVipCustomer,
  findAbandonedBookings,
  weeklyKpis,
  normalizeEmail,
};

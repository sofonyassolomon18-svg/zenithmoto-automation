// damage-report.js â€” Express router + helpers for pre/post rental inspection
// Mounts: POST /damage-report  |  GET /booking/:id/inspection  |  POST /booking/:id/inspection/:phase
const crypto = require('crypto');
const express = require('express');
const { upsert, select } = require('./lib/supabase');
const { notify } = require('./lib/telegram');
const { captureCaution, chargeDamage } = require('./caution-hold');

const router = express.Router();

// HTML-escape helper — prevents XSS when interpolating untrusted data into HTML
function he(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[']/g, '&#x27;');
}

// Middleware: require ADMIN_TOKEN Bearer header (timing-safe comparison)
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'ADMIN_TOKEN not configured' });
  const authHeader = req.headers['authorization'] || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) return res.status(401).json({ error: 'unauthorized' });
  next();
}


const SUPABASE_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';

// POST /damage-report  body { booking_id, photos:[urls], notes }
router.post('/damage-report', requireAdmin, express.json({ limit: '2mb' }), async (req, res) => {
  const { booking_id, photos = [], notes = '', amount_chf } = req.body || {};
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  await upsert('damage_reports', {
    booking_id,
    photos,
    notes,
    amount_chf: amount_chf || null,
    reported_at: new Date().toISOString(),
    status: 'flagged',
  }, { onConflict: 'booking_id' });

  await notify(
    `ðŸš¨ DAMAGE flagged booking ${booking_id}${amount_chf ? ` (CHF ${amount_chf})` : ''}\nNotes: ${notes.slice(0, 200)}\nPhotos: ${photos.length}`,
    'error',
    { project: 'zenithmoto' }
  );

  if (amount_chf && Number(amount_chf) > 0) {
    try {
      // Default no-caution policy â†’ bill via chargeDamage (off-session PI then Invoice fallback).
      // If CAUTION_ENABLED=1, fall back to legacy captureCaution.
      const charge = process.env.CAUTION_ENABLED === '1'
        ? await captureCaution(booking_id, Number(amount_chf))
        : await chargeDamage(booking_id, Number(amount_chf), notes ? `dommage: ${notes.slice(0, 80)}` : 'rental damage');
      return res.json({ ok: true, charge });
    } catch (e) {
      await notify(`Damage charge failed booking ${booking_id}: ${e.message}`, 'error', { project: 'zenithmoto' });
      return res.json({ ok: true, charge_error: e.message });
    }
  }

  res.json({ ok: true });
});

// GET /booking/:id/inspection?phase=pre|post  â€” mobile-first HTML form for staff
router.get('/booking/:id/inspection', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const phase = req.query.phase === 'post' ? 'post' : 'pre';
  const booking = (await select('bookings', `id=eq.${id}&select=*`))?.[0];
  const motoName = he(booking?.moto_name || booking?.moto || 'Moto');
  const safeId = he(id);
  const safePhase = he(phase);
  const checklist = [
    'Carrosserie avant', 'Carrosserie arriÃ¨re', 'CÃ´tÃ© gauche', 'CÃ´tÃ© droit',
    'Pneu avant', 'Pneu arriÃ¨re', 'Selle / siÃ¨ge', 'CarÃ©nage',
    'Phare avant', 'Feu arriÃ¨re', 'RÃ©tro gauche', 'RÃ©tro droit',
    'Niveau essence', 'KilomÃ©trage compteur',
  ];

  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inspection ${safePhase.toUpperCase()} â€” ${motoName}</title>
<style>
*{box-sizing:border-box;font-family:system-ui,sans-serif}
body{margin:0;padding:16px;background:#0a0a0a;color:#f5f5f5;max-width:540px;margin:auto}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#888;font-size:13px;margin-bottom:20px}
.item{background:#1a1a1a;padding:12px;border-radius:10px;margin-bottom:10px}
.item label{display:block;font-size:14px;margin-bottom:8px;font-weight:500}
input[type=file],input[type=text],textarea{width:100%;padding:10px;background:#0a0a0a;color:#fff;border:1px solid #333;border-radius:6px;font-size:14px}
textarea{min-height:80px}
button{width:100%;padding:14px;background:#d4a017;color:#0a0a0a;border:0;border-radius:8px;font-size:16px;font-weight:600;margin-top:16px;cursor:pointer}
.badge{display:inline-block;padding:3px 8px;background:#d4a017;color:#0a0a0a;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase}
</style></head><body>
<h1>Inspection <span class="badge">${safePhase}</span></h1>
<div class="sub">Booking ${safeId} â€” ${motoName}</div>
<form method="post" action="/booking/${safeId}/inspection/${safePhase}" enctype="multipart/form-data">
${checklist.map((c, i) => `
<div class="item">
  <label>${c}</label>
  <input type="file" name="photo_${i}" accept="image/*" capture="environment">
</div>`).join('')}
<div class="item">
  <label>KilomÃ©trage (km)</label>
  <input type="text" name="mileage" inputmode="numeric">
</div>
<div class="item">
  <label>Notes / dommages observÃ©s</label>
  <textarea name="notes" placeholder="RAS / rayures / impact..."></textarea>
</div>
<button type="submit">Valider inspection ${safePhase}</button>
</form>
</body></html>`);
});

// POST /booking/:id/inspection/:phase  â€” receives form. Photos uploaded to Supabase by frontend OR here.
router.post('/booking/:id/inspection/:phase', requireAdmin, express.urlencoded({ extended: true, limit: '20mb' }), async (req, res) => {
  const { id, phase } = req.params;
  const isPost = phase === 'post';

  const photoCount = Object.keys(req.body || {}).filter(k => k.startsWith('photo_')).length;
  const notes = (req.body?.notes || '').slice(0, 2000);
  const mileage = req.body?.mileage || null;

  await upsert('inspections', {
    booking_id: id,
    phase,
    photo_count: photoCount,
    mileage: mileage ? Number(mileage) : null,
    notes,
    submitted_at: new Date().toISOString(),
  }, { onConflict: 'booking_id,phase' });

  // Auto-compare on post: if photo count differs significantly OR notes mention damage keyword â†’ flag
  if (isPost) {
    const pre = (await select('inspections', `booking_id=eq.${id}&phase=eq.pre&select=*`))?.[0];
    const damageKeywords = /rayure|impact|cass|dommage|chute|accident|fissure|enfonce/i;
    const flag = damageKeywords.test(notes) || (pre && Math.abs((pre.photo_count || 0) - photoCount) > 2);
    if (flag) {
      await notify(
        `ðŸš¨ Post-inspection ${id}: dommage potentiel\nNotes: ${notes.slice(0, 200)}\nPhotos pre/post: ${pre?.photo_count || 0}/${photoCount}`,
        'error',
        { project: 'zenithmoto' }
      );
      await upsert('damage_reports', {
        booking_id: id,
        notes,
        photos: [],
        reported_at: new Date().toISOString(),
        status: 'auto_flagged',
      }, { onConflict: 'booking_id' });
    } else {
      await notify(`âœ… Post-inspection ${id} OK (${photoCount} photos)`, 'success', { project: 'zenithmoto' });
    }
  } else {
    await notify(`Pre-inspection ${id} done (${photoCount} photos)`, 'info', { project: 'zenithmoto' });
  }

  res.set('Content-Type', 'text/html; charset=utf-8')
    .send(`<html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#fff;text-align:center"><h2>âœ… Inspection ${he(phase)} enregistree</h2><p>Booking ${he(id)}</p></body></html>`);
});

module.exports = router;

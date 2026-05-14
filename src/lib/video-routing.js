// src/lib/video-routing.js — Routing HeyGen → Higgsfield fallback (V1 backend).
//
// Dormant tant que V1 n'a pas de handler Stripe webhook checkout.session.completed.
// Quand handler ajouté, appeler :
//
//   const { createVideo } = require('./lib/video-routing');
//   await createVideo({
//     useCase: 'booking_confirm',
//     bookingId: session.metadata?.booking_id || session.id,
//     scriptText: `Bonjour ${name}, votre réservation ${motoSlug} pour le ${date} est confirmée. Merci !`,
//   });
//
// Skip si pending row existe déjà pour ce booking_id.
//
// Pattern source : zenithmoto-dashboard/lib/video.ts (TS canonical).

const HEYGEN_BASE = 'https://api.heygen.com';
const QUOTA_THRESHOLD = 5;

function _supaUrl() {
  return process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
}
function _supaKey() {
  return (
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    null
  );
}

async function _fetchJson(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch {}
    return { ok: r.ok, status: r.status, body: j, raw: text };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function _heygenQuota(apiKey) {
  const r = await _fetchJson(`${HEYGEN_BASE}/v2/user/remaining_quota`, {
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const q = r.body?.data?.remaining_quota;
  return typeof q === 'number' ? q : null;
}

async function _findExistingPending(bookingId) {
  const supaKey = _supaKey();
  if (!supaKey || !bookingId) return null;
  const url =
    `${_supaUrl()}/rest/v1/heygen_renders?booking_id=eq.${encodeURIComponent(bookingId)}` +
    `&use_case=eq.booking_confirm&status=in.(pending,pending_manual,processing)&select=id&limit=1`;
  const r = await _fetchJson(url, {
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
  });
  if (!r.ok) return null;
  const row = Array.isArray(r.body) ? r.body[0] : null;
  return row?.id || null;
}

async function _insertRender({ provider, videoId, job, status, fallbackReason }) {
  const supaKey = _supaKey();
  if (!supaKey) return { ok: false, error: 'supabase env missing' };

  const r = await _fetchJson(
    `${_supaUrl()}/rest/v1/heygen_renders`,
    {
      method: 'POST',
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        provider,
        heygen_video_id: videoId,
        use_case: job.useCase,
        booking_id: job.bookingId || null,
        script: job.scriptText,
        status,
        fallback_reason: fallbackReason || null,
      }),
    },
  );
  if (!r.ok) return { ok: false, error: r.body?.message || r.raw || `HTTP ${r.status}` };
  const row = Array.isArray(r.body) ? r.body[0] : r.body;
  return { ok: true, id: row?.id || null };
}

async function _heygenGenerate(job, apiKey) {
  const avatarId = process.env.HEYGEN_DEFAULT_AVATAR_ID;
  const voiceId = process.env.HEYGEN_DEFAULT_VOICE_ID_FR;
  if (!avatarId || !voiceId) {
    return { ok: false, error: 'HEYGEN_DEFAULT_AVATAR_ID / VOICE_ID missing' };
  }
  const body = {
    test: false,
    caption: false,
    title: `ZM ${job.useCase} ${new Date().toISOString().slice(0, 10)}`,
    dimension: { width: 720, height: 1280 },
    video_inputs: [{
      character: { type: 'talking_photo', talking_photo_id: avatarId, talking_photo_style: 'square', talking_style: 'expressive', expression: 'default' },
      voice: { type: 'text', input_text: job.scriptText.trim(), voice_id: voiceId },
      background: { type: 'color', value: '#0F2A3F' },
    }],
  };
  const r = await _fetchJson(`${HEYGEN_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 15000);
  if (!r.ok) return { ok: false, error: r.body?.message || `heygen HTTP ${r.status}` };
  const videoId = r.body?.data?.video_id || r.body?.video_id;
  if (!videoId) return { ok: false, error: 'no video_id' };
  return { ok: true, videoId };
}

async function createVideo(job) {
  if (!job?.scriptText?.trim()) return { ok: false, provider: 'skipped', error: 'scriptText required' };

  // Dedup booking_confirm
  if (job.useCase === 'booking_confirm' && job.bookingId) {
    const existing = await _findExistingPending(job.bookingId);
    if (existing) {
      return { ok: true, provider: 'skipped', jobId: existing, reason: 'already_pending' };
    }
  }

  // Reels et product_demo → free providers rotation (Luma → Hailuo → Kling) puis Higgsfield manual
  if (job.useCase !== 'booking_confirm') {
    try {
      // Lazy require to keep ZM standalone (WebMake pipeline may not be installed locally)
      // eslint-disable-next-line global-require
      const { generateVideo } = require('../../../WebMake/pipeline/src/automation/free-video-gen');
      const free = await generateVideo({
        prompt: job.scriptText,
        duration_s: job.duration_s || 6,
        aspect: '9:16',
      });
      if (free?.ok) {
        const ins = await _insertRender({
          provider: free.provider,
          videoId: free.video_url,
          job,
          status: 'completed',
          fallbackReason: null,
        });
        return { ok: ins.ok, provider: free.provider, jobId: ins.id, video_url: free.video_url, error: ins.error };
      }
    } catch (e) {
      // free providers exhausted or unavailable → fallback Higgsfield manual
    }
    const ins = await _insertRender({
      provider: 'higgsfield',
      videoId: null,
      job,
      status: 'pending_manual',
      fallbackReason: `${job.useCase}_free_exhausted_fallback_higgsfield`,
    });
    return { ok: ins.ok, provider: 'higgsfield_manual', jobId: ins.id, error: ins.error };
  }

  // booking_confirm
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    const ins = await _insertRender({ provider: 'higgsfield', videoId: null, job, status: 'pending_manual', fallbackReason: 'heygen_key_missing' });
    return { ok: ins.ok, provider: 'higgsfield_manual', jobId: ins.id, error: ins.error };
  }

  const quota = await _heygenQuota(apiKey);
  if (quota === null || quota <= QUOTA_THRESHOLD) {
    const reason = quota === null ? 'heygen_quota_check_failed' : `heygen_quota_low_${quota}`;
    const ins = await _insertRender({ provider: 'higgsfield', videoId: null, job, status: 'pending_manual', fallbackReason: reason });
    return { ok: ins.ok, provider: 'higgsfield_manual', jobId: ins.id, reason, error: ins.error };
  }

  const gen = await _heygenGenerate(job, apiKey);
  if (!gen.ok) {
    const ins = await _insertRender({ provider: 'higgsfield', videoId: null, job, status: 'pending_manual', fallbackReason: `heygen_generate_failed:${gen.error}` });
    return { ok: ins.ok, provider: 'higgsfield_manual', jobId: ins.id, error: gen.error };
  }
  const ins = await _insertRender({ provider: 'heygen', videoId: gen.videoId, job, status: 'pending' });
  return { ok: ins.ok, provider: 'heygen', jobId: gen.videoId, error: ins.error };
}

module.exports = { createVideo };

// src/lib/heygen.js — Wrapper API HeyGen + mirror Supabase Storage (REST).
// Clone de zenithmoto-automation-v4/server/src/lib/heygen.js mais sans
// dépendance @supabase/supabase-js : on utilise fetch natif Node 18+ sur l'API
// REST Supabase Storage (PUT object → public URL via /storage/v1/object/public).
//
// Toutes les fonctions retournent { ok, ... } sans throw : si la clé manque,
// l'API down ou Supabase indispo, on renvoie { ok:false, error } proprement.
//
// Docs : https://docs.heygen.com/reference

const HEYGEN_BASE = 'https://api.heygen.com';
const SUPA_BUCKET = 'zenithmoto-content';
const SUPA_PREFIX = 'heygen';

function _key() {
  return process.env.HEYGEN_API_KEY || null;
}

function _supaUrl() {
  return process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
}

function _supaKey() {
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || null;
}

function _headers() {
  return {
    'X-Api-Key': _key(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function _missingKey() {
  return { ok: false, error: 'HEYGEN_API_KEY missing — get one at dashboard.heygen.com' };
}

async function _fetch(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok) {
      return { ok: false, status: res.status, error: json?.message || json?.error?.message || text || `HTTP ${res.status}` };
    }
    return { ok: true, data: json ?? text };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function generateVideo({
  avatarId,
  voiceId,
  script,
  dimension = '9:16',
  backgroundUrl,
  avatarType = 'talking_photo',
  title,
  test = false,
}) {
  if (!_key()) return _missingKey();
  if (!avatarId) return { ok: false, error: 'avatarId required' };
  if (!voiceId) return { ok: false, error: 'voiceId required' };
  if (!script || !script.trim()) return { ok: false, error: 'script required' };

  const dims = {
    '9:16': { width: 720, height: 1280 },
    '16:9': { width: 1280, height: 720 },
    '1:1': { width: 1080, height: 1080 },
  };
  const d = dims[dimension] || dims['9:16'];

  const character = avatarType === 'talking_photo'
    ? { type: 'talking_photo', talking_photo_id: avatarId, talking_photo_style: 'square', talking_style: 'expressive', expression: 'default' }
    : { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' };

  const body = {
    test,
    caption: false,
    title: title || `ZenithMoto ${new Date().toISOString().slice(0, 10)}`,
    dimension: d,
    video_inputs: [
      {
        character,
        voice: { type: 'text', input_text: script.trim(), voice_id: voiceId },
        background: backgroundUrl
          ? { type: 'image', url: backgroundUrl }
          : { type: 'color', value: '#0F2A3F' },
      },
    ],
  };

  const r = await _fetch(`${HEYGEN_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: _headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;

  const videoId = r.data?.data?.video_id || r.data?.video_id;
  if (!videoId) return { ok: false, error: 'no video_id in response', raw: r.data };
  return { ok: true, video_id: videoId };
}

async function getVideoStatus(videoId) {
  if (!_key()) return _missingKey();
  if (!videoId) return { ok: false, error: 'videoId required' };

  const r = await _fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    method: 'GET',
    headers: _headers(),
  });
  if (!r.ok) return r;

  const d = r.data?.data || r.data || {};
  const apiStatus = (d.status || '').toLowerCase();
  const status = apiStatus === 'completed' ? 'completed'
    : apiStatus === 'failed' ? 'failed'
    : apiStatus === 'processing' || apiStatus === 'rendering' ? 'processing'
    : 'pending';

  return {
    ok: true,
    status,
    video_url: d.video_url || null,
    gif_url: d.gif_url || null,
    thumbnail_url: d.thumbnail_url || null,
    duration: d.duration || null,
    credits_used: d.credits_used || null,
    error: d.error?.message || d.error || null,
    raw: d,
  };
}

async function listAvatars() {
  if (!_key()) return _missingKey();
  const [r1, r2] = await Promise.all([
    _fetch(`${HEYGEN_BASE}/v2/avatars`, { method: 'GET', headers: _headers() }),
    _fetch(`${HEYGEN_BASE}/v1/talking_photo.list`, { method: 'GET', headers: _headers() }).catch(() => ({ ok: false })),
  ]);
  return {
    ok: r1.ok || r2.ok,
    avatars: r1.ok ? (r1.data?.data?.avatars || r1.data?.avatars || []) : [],
    talking_photos: r2.ok ? (r2.data?.data || r2.data?.talking_photos || []) : [],
    error: !r1.ok && !r2.ok ? (r1.error || r2.error) : undefined,
  };
}

async function listVoices(language = 'fr') {
  if (!_key()) return _missingKey();
  const r = await _fetch(`${HEYGEN_BASE}/v2/voices`, { method: 'GET', headers: _headers() });
  if (!r.ok) return r;
  const all = r.data?.data?.voices || r.data?.voices || [];
  const lang = (language || '').toLowerCase();
  const filtered = lang
    ? all.filter(v => (v.language || '').toLowerCase().includes(lang) || (v.locale || '').toLowerCase().startsWith(lang))
    : all;
  return { ok: true, voices: filtered, total: all.length };
}

/**
 * Download HeyGen video and mirror to Supabase Storage via REST.
 * @returns {Promise<{ok, public_url?, path?, error?}>}
 */
async function downloadAndMirror(videoUrl, useCase, videoId) {
  if (!videoUrl) return { ok: false, error: 'videoUrl required' };
  const supaUrl = _supaUrl();
  const supaKey = _supaKey();
  if (!supaKey) return { ok: false, error: 'SUPABASE_SERVICE_KEY missing' };

  const dl = await fetch(videoUrl);
  if (!dl.ok) return { ok: false, error: `download failed: HTTP ${dl.status}` };
  const buf = Buffer.from(await dl.arrayBuffer());

  const safeUseCase = (useCase || 'misc').replace(/[^a-z0-9_-]/gi, '_');
  const path = `${SUPA_PREFIX}/${safeUseCase}/${videoId}.mp4`;

  // PUT to Supabase Storage REST (upsert)
  const upUrl = `${supaUrl}/storage/v1/object/${SUPA_BUCKET}/${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(upUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supaKey}`,
        'Content-Type': 'video/mp4',
        'x-upsert': 'true',
        'Cache-Control': '604800',
      },
      body: buf,
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { ok: false, error: `supabase upload HTTP ${r.status}: ${text}` };
    }
  } catch (e) {
    return { ok: false, error: `supabase upload: ${e.message}` };
  } finally {
    clearTimeout(t);
  }

  const publicUrl = `${supaUrl}/storage/v1/object/public/${SUPA_BUCKET}/${path}`;
  return { ok: true, public_url: publicUrl, path };
}

async function recordRender({ videoId, useCase, bookingId = null, socialMeta = null, script }) {
  const supaUrl = _supaUrl();
  const supaKey = _supaKey();
  if (!supaKey) return { ok: false, error: 'supabase env missing' };
  const r = await _fetch(`${supaUrl}/rest/v1/heygen_renders`, {
    method: 'POST',
    headers: {
      apikey: supaKey,
      Authorization: `Bearer ${supaKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      heygen_video_id: videoId,
      use_case: useCase,
      booking_id: bookingId,
      social_post_meta: socialMeta,
      script,
      status: 'pending',
    }),
  }, 8000);
  if (!r.ok) return r;
  return { ok: true, row: Array.isArray(r.data) ? r.data[0] : r.data };
}

async function updateRender(videoId, patch) {
  const supaUrl = _supaUrl();
  const supaKey = _supaKey();
  if (!supaKey) return { ok: false, error: 'supabase env missing' };
  return _fetch(`${supaUrl}/rest/v1/heygen_renders?heygen_video_id=eq.${encodeURIComponent(videoId)}`, {
    method: 'PATCH',
    headers: {
      apikey: supaKey,
      Authorization: `Bearer ${supaKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  }, 8000);
}

async function listPendingRenders(limit = 50) {
  const supaUrl = _supaUrl();
  const supaKey = _supaKey();
  if (!supaKey) return { ok: false, error: 'supabase env missing', renders: [] };
  const q = `status=in.(pending,processing)&order=created_at.asc&limit=${limit}`;
  const r = await _fetch(`${supaUrl}/rest/v1/heygen_renders?${q}`, {
    method: 'GET',
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
  }, 8000);
  if (!r.ok) return { ...r, renders: [] };
  return { ok: true, renders: r.data || [] };
}

async function listRenders({ limit = 20, useCase } = {}) {
  const supaUrl = _supaUrl();
  const supaKey = _supaKey();
  if (!supaKey) return { ok: false, error: 'supabase env missing', renders: [] };
  const filters = [`order=created_at.desc`, `limit=${limit}`];
  if (useCase) filters.push(`use_case=eq.${encodeURIComponent(useCase)}`);
  const r = await _fetch(`${supaUrl}/rest/v1/heygen_renders?${filters.join('&')}`, {
    method: 'GET',
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
  }, 8000);
  if (!r.ok) return { ...r, renders: [] };
  return { ok: true, renders: r.data || [] };
}

module.exports = {
  generateVideo,
  getVideoStatus,
  listAvatars,
  listVoices,
  downloadAndMirror,
  recordRender,
  updateRender,
  listPendingRenders,
  listRenders,
  _BASE: HEYGEN_BASE,
  _BUCKET: SUPA_BUCKET,
};

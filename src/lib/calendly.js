// Calendly API client — generate single-use scheduling links for moto pickup
// Each moto has its own Calendly event type (5 total).
// Env vars expected on Railway:
//   CALENDLY_TOKEN
//   CALENDLY_EVT_YAMAHA_TMAX, CALENDLY_EVT_HONDA_X_ADV, CALENDLY_EVT_YAMAHA_TRACER,
//   CALENDLY_EVT_YAMAHA_X_MAX_300, CALENDLY_EVT_YAMAHA_X_MAX_125

const TOKEN = process.env.CALENDLY_TOKEN;
const BASE = 'https://api.calendly.com';

// Map moto slug → event type URI (from env)
function buildEvtMap() {
  return {
    'yamaha-tmax': process.env.CALENDLY_EVT_YAMAHA_TMAX,
    'yamaha-tmax-530': process.env.CALENDLY_EVT_YAMAHA_TMAX,
    'honda-x-adv': process.env.CALENDLY_EVT_HONDA_X_ADV,
    'honda-x-adv-750': process.env.CALENDLY_EVT_HONDA_X_ADV,
    'yamaha-tracer': process.env.CALENDLY_EVT_YAMAHA_TRACER,
    'yamaha-tracer-700': process.env.CALENDLY_EVT_YAMAHA_TRACER,
    'yamaha-x-max-300': process.env.CALENDLY_EVT_YAMAHA_X_MAX_300,
    'yamaha-x-max-125': process.env.CALENDLY_EVT_YAMAHA_X_MAX_125,
  };
}

// Normalize raw moto identifier (id, label, slug) to canonical slug key
function normalizeSlug(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return raw
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

async function createSchedulingLink(motoSlug, maxEventCount = 1) {
  if (!TOKEN) return { error: 'NO_CALENDLY_TOKEN' };
  const slug = normalizeSlug(motoSlug);
  const map = buildEvtMap();
  const eventTypeUri = map[slug];
  if (!eventTypeUri) return { error: 'UNKNOWN_MOTO_SLUG', slug };

  try {
    const r = await fetch(`${BASE}/scheduling_links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        max_event_count: maxEventCount,
        owner: eventTypeUri,
        owner_type: 'EventType',
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.resource && j.resource.booking_url) {
      return { url: j.resource.booking_url };
    }
    return { error: 'CALENDLY_API_ERROR', status: r.status, detail: j };
  } catch (e) {
    return { error: 'CALENDLY_FETCH_FAILED', detail: e.message };
  }
}

module.exports = { createSchedulingLink, buildEvtMap, normalizeSlug };

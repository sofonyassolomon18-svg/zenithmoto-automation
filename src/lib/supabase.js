// lib/supabase.js — wrapper minimal REST Supabase (pas de SDK, juste axios)
// Partagé WebMake / ZenithMoto.
const axios = require('axios');

const DEFAULT_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';

function _key() {
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
}

function _headers(extra = {}) {
  const k = _key();
  return {
    apikey: k,
    Authorization: `Bearer ${k}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function upsert(table, row, opts = {}) {
  if (!_key()) return null;
  const conflict = opts.onConflict ? `?on_conflict=${opts.onConflict}` : '';
  try {
    const r = await axios.post(
      `${DEFAULT_URL}/rest/v1/${table}${conflict}`,
      row,
      {
        headers: _headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        timeout: opts.timeout || 8000,
      }
    );
    return r.data;
  } catch (e) {
    console.warn(`[supabase-lib:upsert ${table}] ${e.code || e.response?.status || 'net'}`);
    return null;
  }
}

async function select(table, query = '') {
  if (!_key()) return null;
  try {
    const r = await axios.get(`${DEFAULT_URL}/rest/v1/${table}${query ? '?' + query : ''}`, {
      headers: _headers(),
      timeout: 8000,
    });
    return r.data;
  } catch (e) {
    console.warn(`[supabase-lib:select ${table}] ${e.code || e.response?.status || 'net'}`);
    return null;
  }
}

async function logAutomation({ project, scenario, status, payload, error, durationMs }) {
  if (!_key()) return;
  try {
    await axios.post(
      `${DEFAULT_URL}/rest/v1/automations_log`,
      {
        project: project || 'app',
        scenario,
        status,
        payload: payload || null,
        error: error || null,
        duration_ms: durationMs || null,
      },
      { headers: _headers({ Prefer: 'return=minimal' }), timeout: 5000 }
    );
  } catch (e) {
    console.warn(`[supabase-lib:logAutomation] ${e.code || e.response?.status || 'net'}`);
  }
}

module.exports = { upsert, select, logAutomation, _url: DEFAULT_URL };

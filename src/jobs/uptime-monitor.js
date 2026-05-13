// jobs/uptime-monitor.js — ping critical endpoints every 5min, alert after 3 consecutive failures
const axios = require('axios');
const { notify } = require('../lib/telegram');

const ENDPOINTS = [
  { name: 'v4-server', url: 'https://zenithmoto-server-production.up.railway.app/api/health' },
  { name: 'dashboard', url: 'https://zenithmoto-dashboard-production.up.railway.app/api/health' },
  { name: 'site', url: 'https://zenithmoto.ch/' },
];

// In-memory state, persists between cron ticks in the same process
const state = new Map(); // name -> { fails: number, down: boolean }

/** Probe one endpoint, return status code or 0 on network error */
async function probe(url) {
  try {
    const r = await axios.get(url, { timeout: 10000, validateStatus: () => true });
    return r.status;
  } catch (e) {
    return 0;
  }
}

/** Run uptime monitor tick */
async function runUptimeMonitor() {
  for (const ep of ENDPOINTS) {
    const s = state.get(ep.name) || { fails: 0, down: false };
    const code = await probe(ep.url);
    const isUp = code >= 200 && code < 400;

    if (!isUp) {
      s.fails += 1;
      if (s.fails === 3 && !s.down) {
        s.down = true;
        await notify(`🚨 DOWN: ${ep.url} · status=${code} · failed 3x`, 'error', { project: 'zenithmoto' });
      }
    } else {
      if (s.down) {
        await notify(`✅ RECOVERED: ${ep.url}`, 'success', { project: 'zenithmoto' });
      }
      s.fails = 0;
      s.down = false;
    }
    state.set(ep.name, s);
  }
  return { ok: true };
}

module.exports = { runUptimeMonitor };

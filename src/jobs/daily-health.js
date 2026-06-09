// jobs/daily-health.js — daily 08:15 ZenithMoto V1 health digest
'use strict';

const { notify } = require('../lib/telegram');
const { execFileSync } = require('child_process');

// In-memory counters — persist as long as the process is alive.
// Reset at midnight via resetDailyCounters() called from scheduler.
const state = {
  cronErrors: 0,
  lastBookingCheckAt: null, // ISO timestamp
  processStartAt: Date.now(),
};

/** Called by scheduler's cronError() on every failure */
function incrementCronError() {
  state.cronErrors += 1;
}

/** Called after each booking-assistant tick */
function markBookingCheck() {
  state.lastBookingCheckAt = new Date().toISOString();
}

/** Called at midnight to reset daily counters */
function resetDailyCounters() {
  state.cronErrors = 0;
  state.lastBookingCheckAt = null;
}

/** Format milliseconds → "Xh Ym" */
function fmtUptime(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Format ISO timestamp → "HH:MM" (Europe/Zurich) */
function fmtTime(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleTimeString('fr-CH', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Probe Postiz API reachability and last scheduled post age */
async function checkPostiz() {
  const apiKey = process.env.POSTIZ_API_KEY;
  if (!apiKey) return { ok: false, reason: 'POSTIZ_API_KEY not set' };

  try {
    const result = execFileSync('curl', [
      '-s', '-o', '/dev/null', '-w', '%{http_code}',
      '-m', '5',
      '-H', `Authorization: ${apiKey}`,
      'https://api.postiz.com/public/v1/posts',
    ], { encoding: 'utf8', timeout: 8000 }).trim();
    const code = parseInt(result, 10);
    // 200 or 401 = API reachable; 401 means key invalid
    if (code === 401) return { ok: false, reason: `API key invalid (401)` };
    if (code >= 200 && code < 500) return { ok: true, code };
    return { ok: false, reason: `HTTP ${code}` };
  } catch {
    return { ok: false, reason: 'timeout/network' };
  }
}

/** Send the daily health digest to Telegram */
async function runDailyHealth() {
  const uptimeMs = Date.now() - state.processStartAt;
  const errorEmoji = state.cronErrors === 0 ? '🟢' : (state.cronErrors < 5 ? '🟡' : '🔴');

  const postiz = await checkPostiz();
  const postizLine = postiz.ok
    ? `Postiz API: 🟢 reachable`
    : `Postiz API: 🔴 ${postiz.reason}`;

  const lines = [
    `🟢 *ZenithMoto V1 — daily health*`,
    ``,
    `Uptime: ${fmtUptime(uptimeMs)}`,
    `Cron errors today: ${errorEmoji} ${state.cronErrors}`,
    `Last booking check: ${fmtTime(state.lastBookingCheckAt)}`,
    `Railway: OK`,
    postizLine,
  ];

  const message = lines.join('\n');

  await notify(message, 'info', { project: 'zenithmoto' });
  return { ok: true, cronErrors: state.cronErrors, uptimeMs };
}

module.exports = { runDailyHealth, incrementCronError, markBookingCheck, resetDailyCounters };

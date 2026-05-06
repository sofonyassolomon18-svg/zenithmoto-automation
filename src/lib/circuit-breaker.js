// lib/circuit-breaker.js — Circuit breaker + retry/backoff + dead letter queue
// Léger, sans dépendance, partagé par tous les modules ZenithMoto.
//
// Usage :
//   const { withCircuit, retry, deadLetter } = require('./lib/circuit-breaker');
//   const result = await withCircuit('gemini', () => callGemini(...), { failureThreshold: 5 });
//   const result = await retry(() => callApi(...), { tries: 3, baseMs: 500 });
//   await deadLetter.push({ kind: 'email', payload, error });
//
// Circuit breaker states :
//   - closed   : appels normaux. Si N échecs consécutifs → open.
//   - open     : tous les appels rejetés instantanément avec CircuitOpenError.
//                Après cooldownMs → half-open.
//   - half-open: 1 appel test autorisé. Succès → closed. Échec → open.
//
// Pas de dépendance externe (axios, etc.) → utilisable depuis lib/ sans cycle.

const fs = require('fs');
const path = require('path');

class CircuitOpenError extends Error {
  constructor(name) { super(`circuit ${name} is open`); this.name = 'CircuitOpenError'; this.code = 'CIRCUIT_OPEN'; }
}

const _circuits = new Map();

function _getCircuit(name, opts = {}) {
  let c = _circuits.get(name);
  if (!c) {
    c = {
      name,
      state: 'closed',
      failures: 0,
      lastFailureAt: 0,
      openedAt: 0,
      failureThreshold: opts.failureThreshold ?? 5,
      cooldownMs: opts.cooldownMs ?? 60_000,
    };
    _circuits.set(name, c);
  } else if (opts.failureThreshold || opts.cooldownMs) {
    if (opts.failureThreshold) c.failureThreshold = opts.failureThreshold;
    if (opts.cooldownMs) c.cooldownMs = opts.cooldownMs;
  }
  return c;
}

async function withCircuit(name, fn, opts = {}) {
  const c = _getCircuit(name, opts);
  const now = Date.now();

  if (c.state === 'open') {
    if (now - c.openedAt >= c.cooldownMs) {
      c.state = 'half-open';
      console.log(`[circuit:${name}] cooldown expired → half-open`);
    } else {
      throw new CircuitOpenError(name);
    }
  }

  try {
    const result = await fn();
    if (c.state === 'half-open') {
      c.state = 'closed';
      c.failures = 0;
      console.log(`[circuit:${name}] half-open success → closed`);
    } else {
      c.failures = 0;
    }
    return result;
  } catch (err) {
    c.failures++;
    c.lastFailureAt = now;
    if (c.state === 'half-open' || c.failures >= c.failureThreshold) {
      c.state = 'open';
      c.openedAt = now;
      console.warn(`[circuit:${name}] OPEN after ${c.failures} failures (cooldown ${c.cooldownMs}ms)`);
    }
    throw err;
  }
}

function circuitStatus() {
  const out = {};
  for (const [k, v] of _circuits) {
    out[k] = { state: v.state, failures: v.failures, openedAt: v.openedAt || null };
  }
  return out;
}

// Retry helper avec exponential backoff + jitter.
// Stoppe immédiatement si l'erreur est CircuitOpenError ou si shouldRetry retourne false.
async function retry(fn, opts = {}) {
  const tries = opts.tries ?? 3;
  const baseMs = opts.baseMs ?? 400;
  const maxMs = opts.maxMs ?? 8000;
  const shouldRetry = opts.shouldRetry || (() => true);
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (e?.code === 'CIRCUIT_OPEN') throw e;
      if (i === tries - 1) break;
      if (!shouldRetry(e, i)) break;
      const delay = Math.min(maxMs, baseMs * Math.pow(2, i)) * (0.7 + 0.6 * Math.random());
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw last;
}

// Dead Letter Queue persistante : append-only JSON lines dans data/dead-letter.jsonl
const DLQ_FILE = path.join(__dirname, '..', '..', 'data', 'dead-letter.jsonl');

const deadLetter = {
  push(entry) {
    try {
      fs.mkdirSync(path.dirname(DLQ_FILE), { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
      fs.appendFileSync(DLQ_FILE, line);
    } catch (e) { console.warn('[dlq] write failed:', e.message); }
  },
  read(limit = 50) {
    try {
      if (!fs.existsSync(DLQ_FILE)) return [];
      const lines = fs.readFileSync(DLQ_FILE, 'utf8').split('\n').filter(Boolean);
      return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  },
  count() {
    try {
      if (!fs.existsSync(DLQ_FILE)) return 0;
      return fs.readFileSync(DLQ_FILE, 'utf8').split('\n').filter(Boolean).length;
    } catch { return 0; }
  },
  // Pour tests : reset path runtime
  _setPath(p) { /* eslint-disable-next-line no-import-assign */ Object.defineProperty(deadLetter, '_path', { value: p, writable: true }); },
};

module.exports = { withCircuit, retry, deadLetter, circuitStatus, CircuitOpenError };

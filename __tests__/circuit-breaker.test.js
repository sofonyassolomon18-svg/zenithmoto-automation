// Tests unitaires circuit-breaker + retry + DLQ
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Path de test isolé pour DLQ
const tmpDlq = path.join(__dirname, '..', 'data', 'dead-letter-test.jsonl');
if (fs.existsSync(tmpDlq)) fs.unlinkSync(tmpDlq);

const { withCircuit, retry, deadLetter, circuitStatus, CircuitOpenError } = require('../src/lib/circuit-breaker');

test('circuit opens after N failures and rejects subsequent calls', async () => {
  let calls = 0;
  const fn = async () => { calls++; throw new Error('boom'); };
  const name = 'test-open-' + Date.now();
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => withCircuit(name, fn, { failureThreshold: 3, cooldownMs: 5000 }));
  }
  // 4e appel : circuit open → rejected sans appeler fn
  await assert.rejects(
    () => withCircuit(name, fn, { failureThreshold: 3, cooldownMs: 5000 }),
    e => e instanceof CircuitOpenError
  );
  assert.equal(calls, 3, 'fn appelée 3× seulement (4e rejetée par breaker)');
  const st = circuitStatus()[name];
  assert.equal(st.state, 'open');
});

test('circuit half-open then close on success', async () => {
  const name = 'test-recover-' + Date.now();
  let calls = 0;
  const fnFail = async () => { calls++; throw new Error('x'); };
  const fnOk = async () => { calls++; return 'ok'; };

  // Force open avec cooldown très court
  for (let i = 0; i < 2; i++) {
    await assert.rejects(() => withCircuit(name, fnFail, { failureThreshold: 2, cooldownMs: 30 }));
  }
  await new Promise(r => setTimeout(r, 50)); // wait cooldown
  const r = await withCircuit(name, fnOk, { failureThreshold: 2, cooldownMs: 30 });
  assert.equal(r, 'ok');
  assert.equal(circuitStatus()[name].state, 'closed');
});

test('retry retries N times with backoff', async () => {
  let calls = 0;
  const fn = async () => { calls++; if (calls < 3) throw new Error('flaky'); return 'done'; };
  const r = await retry(fn, { tries: 5, baseMs: 5, maxMs: 50 });
  assert.equal(r, 'done');
  assert.equal(calls, 3);
});

test('retry stops on CircuitOpenError', async () => {
  let calls = 0;
  const fn = async () => { calls++; throw new CircuitOpenError('x'); };
  await assert.rejects(() => retry(fn, { tries: 5, baseMs: 1 }));
  assert.equal(calls, 1, 'pas de retry sur CIRCUIT_OPEN');
});

test('deadLetter push then read', () => {
  // Reset DLQ par défaut pour ce test
  const realDlq = path.join(__dirname, '..', 'data', 'dead-letter.jsonl');
  if (fs.existsSync(realDlq)) fs.unlinkSync(realDlq);
  deadLetter.push({ kind: 'email', to: 'foo@bar', error: 'SMTP timeout' });
  deadLetter.push({ kind: 'telegram', chat_id: '123', error: 'rate limited' });
  const items = deadLetter.read();
  assert.ok(items.length >= 2);
  assert.equal(items[items.length - 2].kind, 'email');
  assert.equal(items[items.length - 1].kind, 'telegram');
  assert.ok(items[items.length - 1].ts);
});

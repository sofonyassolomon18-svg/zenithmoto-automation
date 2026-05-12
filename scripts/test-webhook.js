#!/usr/bin/env node
/**
 * scripts/test-webhook.js
 *
 * Démontre comment signer un payload pour le webhook /webhook/booking
 * (HMAC SHA-256 sur le body brut, secret = WEBHOOK_SECRET).
 *
 * Usage :
 *   # Mode dev (pas de WEBHOOK_SECRET défini → accepté sans signature)
 *   node scripts/test-webhook.js
 *
 *   # Mode prod (WEBHOOK_SECRET défini en .env, à la fois côté client + côté serveur)
 *   WEBHOOK_SECRET=mon_secret node scripts/test-webhook.js
 *
 *   # Cibler une URL différente
 *   WEBHOOK_URL=https://zenithmoto-automation.up.railway.app/webhook/booking node scripts/test-webhook.js
 *
 * Pour générer un secret 256-bit :
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3001/webhook/booking';
const SECRET = process.env.WEBHOOK_SECRET || '';

const samplePayload = {
  event: 'booking_created',
  booking: {
    booking_id: 'TEST-' + Date.now(),
    client_name: 'Jean Test',
    client_email: 'test@example.com',
    motorcycle: 'Yamaha Tracer 700',
    start_date: new Date(Date.now() + 86400000).toISOString(),
    end_date: new Date(Date.now() + 3 * 86400000).toISOString(),
    price: 360,
  },
};

function signPayload(rawBody, secret) {
  // Format identique à GitHub : "sha256=" + hex(HMAC-SHA256(secret, body))
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function postWebhook(url, rawBody, signature) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(rawBody),
    };
    if (signature) headers['X-Hub-Signature-256'] = signature;

    const req = lib.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

(async () => {
  const rawBody = JSON.stringify(samplePayload);
  const signature = SECRET ? signPayload(rawBody, SECRET) : null;

  console.log('=== Test Webhook ZenithMoto ===');
  console.log('URL              :', WEBHOOK_URL);
  console.log('Mode             :', SECRET ? 'PROD (signé)' : 'DEV (sans signature)');
  if (signature) console.log('X-Hub-Signature-256 :', signature);
  console.log('Body             :', rawBody);
  console.log();

  // 1. Test signé (ou non si pas de secret)
  try {
    const r1 = await postWebhook(WEBHOOK_URL, rawBody, signature);
    console.log(`→ [OK] status=${r1.status}  body=${r1.body}`);
  } catch (e) {
    console.error('→ [ERR] envoi échoué :', e.message);
    process.exit(1);
  }

  // 2. Si secret défini : démo qu'une mauvaise signature est rejetée
  if (SECRET) {
    console.log('\n--- Test négatif : mauvaise signature ---');
    try {
      const r2 = await postWebhook(WEBHOOK_URL, rawBody, 'sha256=deadbeef');
      console.log(`→ status=${r2.status} (attendu 401)  body=${r2.body}`);
    } catch (e) {
      console.error('→ [ERR]:', e.message);
    }
  }
})();

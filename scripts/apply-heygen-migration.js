/* Apply HeyGen migration to Supabase project edcvmgpcllhszxvthdzx */
require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const https = require('https');

const URL = process.env.SUPABASE_URL || process.env.ZENITHMOTO_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const sqlPath = path.join(__dirname, '..', 'migrations', '2026-05-10-heygen-renders.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

// Use Postgres REST via pg-meta query endpoint of Supabase
const u = new URL(URL);
const body = JSON.stringify({ query: sql });
const req = https.request({
  hostname: u.hostname,
  port: 443,
  path: '/pg/query', // not standard — try multiple endpoints
  method: 'POST',
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    console.log(`HTTP ${res.statusCode}`);
    console.log(data.slice(0, 1000));
  });
});
req.on('error', (e) => console.error('ERR', e.message));
req.write(body);
req.end();

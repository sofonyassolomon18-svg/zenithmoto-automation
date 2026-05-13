// jobs/backup-db.js — nightly 02h00 export of main tables to Supabase Storage bucket "backups"
const { createClient } = require('@supabase/supabase-js');
const { notify } = require('../lib/telegram');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const BUCKET = 'backups';
const TABLES = ['bookings', 'customers', 'motos', 'contracts'];

/** Export each table to a single JSON blob, upload + prune >30d */
async function runBackupDb() {
  if (!SUPABASE_KEY) {
    console.warn('[backup-db] SUPABASE_SERVICE_KEY missing — skip');
    return { ok: false, reason: 'no_key' };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const date = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
  const path = `db/${date}.json`;

  const dump = { exported_at: new Date().toISOString(), tables: {} };
  let totalRows = 0;
  const missing = [];

  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select('*').limit(50000);
    if (error) {
      // table may not exist — track but don't abort
      missing.push(`${t}(${error.code || 'err'})`);
      dump.tables[t] = null;
      continue;
    }
    dump.tables[t] = data || [];
    totalRows += (data || []).length;
  }

  const body = Buffer.from(JSON.stringify(dump));

  const { error: upErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, body, { contentType: 'application/json', upsert: true });

  if (upErr) {
    await notify(`backup-db FAIL upload: ${upErr.message}`, 'error', { project: 'zenithmoto' });
    return { ok: false, error: upErr.message };
  }

  // Prune older than 30d
  let pruned = 0;
  try {
    const { data: listing } = await supabase.storage.from(BUCKET).list('db', { limit: 1000 });
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const toDelete = (listing || [])
      .filter(f => {
        const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name);
        if (!m) return false;
        return new Date(m[1]).getTime() < cutoff;
      })
      .map(f => `db/${f.name}`);
    if (toDelete.length) {
      await supabase.storage.from(BUCKET).remove(toDelete);
      pruned = toDelete.length;
    }
  } catch (e) {
    console.warn('[backup-db] prune warn:', e.message);
  }

  await notify(
    `backup-db OK · ${path} · rows=${totalRows} pruned=${pruned}${missing.length ? ' · skipped=' + missing.join(',') : ''}`,
    'success',
    { project: 'zenithmoto' }
  );
  return { ok: true, path, rows: totalRows, pruned };
}

module.exports = { runBackupDb };

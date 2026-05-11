#!/usr/bin/env node
/**
 * Moto Photos Fetch + Upload — pipeline complet.
 *
 * 1. Read manifest data/moto-photos-manifest.json
 * 2. Download HD photos depuis Yamaha/Honda press CDN
 * 3. Upload to Supabase bucket `zenithmoto-content/flotte/<slug>/`
 * 4. Save URLs publiques dans data/photos-uploaded.json
 *
 * Free alternative when Higgsfield AI gen quota épuisé.
 *
 * Usage:
 *   node scripts/moto-photos-fetch-upload.js                # dry-run
 *   node scripts/moto-photos-fetch-upload.js --commit       # upload Supabase
 *   node scripts/moto-photos-fetch-upload.js --moto=honda-x-adv-750 --commit
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'moto-photos-manifest.json');
const OUTPUT_LOG = path.join(__dirname, '..', 'data', 'photos-uploaded.json');
const TEMP_DIR = path.join(__dirname, '..', 'tmp', 'moto-photos');
fs.mkdirSync(TEMP_DIR, { recursive: true });

const BUCKET = 'zenithmoto-content';

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.replace(/^--/, '').split('=');
    if (v !== undefined) args[k] = v;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
    else args[k] = true;
  }
  return args;
}

function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const get = (u, redirects = 0) => {
      https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 ZenithMoto Press Kit Fetch' } }, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && redirects < 5) {
          file.close();
          fs.unlinkSync(filePath);
          const newPath = filePath;
          const newFile = fs.createWriteStream(newPath);
          newFile.on('finish', () => resolve({ size: fs.statSync(newPath).size }));
          newFile.on('error', reject);
          return get(resp.headers.location, redirects + 1);
        }
        if (resp.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(filePath); } catch {}
          return reject(new Error(`HTTP ${resp.statusCode}`));
        }
        resp.pipe(file);
        file.on('finish', () => { file.close(); resolve({ size: fs.statSync(filePath).size }); });
        file.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

async function uploadToSupabase(sb, localPath, remotePath) {
  const fileBuffer = fs.readFileSync(localPath);
  const ext = path.extname(remotePath).slice(1) || 'jpg';
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const { data, error } = await sb.storage.from(BUCKET).upload(remotePath, fileBuffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message);
  const { data: pubData } = sb.storage.from(BUCKET).getPublicUrl(remotePath);
  return pubData.publicUrl;
}

async function main() {
  const args = parseArgs();
  const commit = args.commit === true;
  const motoFilter = args.moto;

  console.log(`\n🏍️ MOTO PHOTOS PIPELINE — fetch HD + upload Supabase`);
  console.log(`   Commit: ${commit}`);
  if (motoFilter) console.log(`   Filter: ${motoFilter}\n`);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const sb = commit ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) : null;

  const uploadLog = fs.existsSync(OUTPUT_LOG) ? JSON.parse(fs.readFileSync(OUTPUT_LOG, 'utf8')) : { uploads: [] };

  const stats = { tried: 0, downloaded: 0, uploaded: 0, failed: 0, skipped_html: 0 };

  for (const [slug, fleet] of Object.entries(manifest.fleet)) {
    if (motoFilter && slug !== motoFilter) continue;

    console.log(`\n━━━ ${slug.toUpperCase()} (${fleet.year}) ━━━`);

    for (const photo of fleet.photos) {
      stats.tried++;

      if (photo.url.endsWith('.html') || photo._note?.includes('Page HTML')) {
        process.stdout.write(`  ⊘ ${photo.filename} (HTML page, skip — manual extraction needed)\n`);
        stats.skipped_html++;
        continue;
      }

      const localPath = path.join(TEMP_DIR, photo.filename);
      const remotePath = `${fleet.supabase_folder}${photo.filename}`;

      process.stdout.write(`  [${photo.angle.padEnd(20)}] ${photo.color.slice(0, 20).padEnd(20)} ... `);

      try {
        // Download
        const dl = await downloadFile(photo.url, localPath);
        const sizeMB = (dl.size / 1024 / 1024).toFixed(2);
        stats.downloaded++;
        process.stdout.write(`DL ${sizeMB}MB `);

        if (commit) {
          const publicUrl = await uploadToSupabase(sb, localPath, remotePath);
          stats.uploaded++;
          process.stdout.write(`→ Supabase ✅\n`);
          uploadLog.uploads.push({
            slug,
            angle: photo.angle,
            color: photo.color,
            year: photo.year,
            local_filename: photo.filename,
            supabase_url: publicUrl,
            source_url: photo.url,
            uploaded_at: new Date().toISOString(),
          });
        } else {
          process.stdout.write(`(dry-run, no upload)\n`);
        }
      } catch (e) {
        stats.failed++;
        process.stdout.write(`❌ ${e.message.slice(0, 60)}\n`);
      }
    }
  }

  if (commit) {
    fs.writeFileSync(OUTPUT_LOG, JSON.stringify(uploadLog, null, 2));
  }

  console.log(`\n📊 RESULTS:`);
  console.log(`   Tried:        ${stats.tried}`);
  console.log(`   Downloaded:   ${stats.downloaded}`);
  console.log(`   Skipped HTML: ${stats.skipped_html}`);
  console.log(`   Failed:       ${stats.failed}`);
  if (commit) console.log(`   ✅ Uploaded Supabase: ${stats.uploaded}`);
  else console.log(`   (DRY RUN — add --commit)`);
  if (commit) console.log(`\n📋 Log saved: ${OUTPUT_LOG}`);
}

main().catch(e => { console.error('[fetch-upload]', e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Moto Images Fetch — multi-source aggregator pour ZenithMoto.
 *
 * Sources cascade :
 * 1. Supabase bucket `zenithmoto-content` (existant flotte)
 * 2. Unsplash API (50 req/h free, photos pro moto)
 * 3. Pexels API (illimité free)
 * 4. Pixabay API (5k/h free)
 * 5. fal.ai Flux.1 ($0.003/image generation IA si rien trouvé)
 *
 * Usage:
 *   node scripts/moto-images-fetch.js --query="TMAX 530 sunset" --count=5
 *   node scripts/moto-images-fetch.js --moto=tracer-700 --download
 *   node scripts/moto-images-fetch.js --query="X-ADV 750 alpine" --generate-ai
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.join(__dirname, '..', 'media', 'moto-fetch');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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

async function searchUnsplash(query, count = 5) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return { source: 'unsplash', error: 'no API key' };
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;
  const resp = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
  if (!resp.ok) return { source: 'unsplash', error: `HTTP ${resp.status}` };
  const data = await resp.json();
  return {
    source: 'unsplash',
    results: (data.results || []).map(r => ({
      url: r.urls.regular,
      hd: r.urls.full,
      author: r.user.name,
      author_url: r.user.links.html,
      license: 'Unsplash License (free commercial)',
      width: r.width,
      height: r.height,
      description: r.description || r.alt_description,
    })),
  };
}

async function searchPexels(query, count = 5) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return { source: 'pexels', error: 'no API key' };
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;
  const resp = await fetch(url, { headers: { Authorization: key } });
  if (!resp.ok) return { source: 'pexels', error: `HTTP ${resp.status}` };
  const data = await resp.json();
  return {
    source: 'pexels',
    results: (data.photos || []).map(p => ({
      url: p.src.large,
      hd: p.src.original,
      author: p.photographer,
      author_url: p.photographer_url,
      license: 'Pexels License (free commercial, no attribution required)',
      width: p.width,
      height: p.height,
      description: p.alt,
    })),
  };
}

async function searchPixabay(query, count = 5) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return { source: 'pixabay', error: 'no API key' };
  const url = `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&per_page=${count}&image_type=photo&orientation=horizontal&safesearch=true`;
  const resp = await fetch(url);
  if (!resp.ok) return { source: 'pixabay', error: `HTTP ${resp.status}` };
  const data = await resp.json();
  return {
    source: 'pixabay',
    results: (data.hits || []).map(h => ({
      url: h.webformatURL,
      hd: h.largeImageURL,
      author: h.user,
      author_url: `https://pixabay.com/users/${h.user}-${h.user_id}/`,
      license: 'Pixabay License (free commercial)',
      width: h.imageWidth,
      height: h.imageHeight,
      description: h.tags,
    })),
  };
}

async function generateFluxAi(prompt) {
  const falKey = process.env.FAL_API_KEY;
  if (!falKey) return { source: 'fal.ai-flux', error: 'no FAL_API_KEY' };
  const url = 'https://fal.run/fal-ai/flux/schnell';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: 'landscape_16_9', num_inference_steps: 4 }),
  });
  if (!resp.ok) return { source: 'fal.ai-flux', error: `HTTP ${resp.status}` };
  const data = await resp.json();
  return {
    source: 'fal.ai-flux',
    results: (data.images || []).map(img => ({
      url: img.url,
      hd: img.url,
      author: 'fal.ai Flux.1 schnell',
      license: 'Generated AI — commercial OK',
      description: prompt,
    })),
  };
}

async function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filename);
    https.get(url, (resp) => {
      resp.pipe(file);
      file.on('finish', () => { file.close(); resolve(filename); });
    }).on('error', (err) => { fs.unlink(filename, () => {}); reject(err); });
  });
}

async function main() {
  const args = parseArgs();
  const query = args.query || (args.moto ? `Yamaha ${args.moto.replace(/-/g, ' ')} motorcycle photo` : 'motorcycle Switzerland alpine');
  const count = parseInt(args.count, 10) || 5;
  const download = args.download === true;
  const generateAi = args['generate-ai'] === true;

  console.log(`\n🏍️ MOTO IMAGES FETCH`);
  console.log(`   Query: "${query}"`);
  console.log(`   Count: ${count}`);
  console.log(`   Download: ${download}\n`);

  const sources = await Promise.all([
    searchUnsplash(query, count),
    searchPexels(query, count),
    searchPixabay(query, count),
  ]);

  let allResults = [];
  for (const s of sources) {
    console.log(`\n=== ${s.source.toUpperCase()} ===`);
    if (s.error) { console.log(`   ❌ ${s.error}`); continue; }
    console.log(`   ✅ ${s.results.length} results`);
    s.results.forEach((r, i) => {
      console.log(`   ${i+1}. ${r.url}`);
      console.log(`      Author: ${r.author} (${r.license})`);
      allResults.push({ ...r, source: s.source });
    });
  }

  if (generateAi) {
    console.log(`\n=== AI GENERATION (fal.ai Flux.1) ===`);
    const ai = await generateFluxAi(query);
    if (ai.error) console.log(`   ❌ ${ai.error}`);
    else {
      console.log(`   ✅ ${ai.results.length} AI images`);
      ai.results.forEach((r, i) => {
        console.log(`   ${i+1}. ${r.url}`);
        allResults.push({ ...r, source: ai.source });
      });
    }
  }

  if (download && allResults.length) {
    console.log(`\n💾 DOWNLOADING to ${OUTPUT_DIR}...`);
    for (let i = 0; i < allResults.length; i++) {
      const r = allResults[i];
      const filename = path.join(OUTPUT_DIR, `${r.source}-${i}-${query.slice(0, 30).replace(/[^a-z0-9]/gi, '_')}.jpg`);
      try {
        await downloadImage(r.hd, filename);
        console.log(`   ✅ ${path.basename(filename)}`);
      } catch (e) {
        console.log(`   ❌ ${e.message}`);
      }
    }
  }

  // Save manifest JSON
  const manifestPath = path.join(OUTPUT_DIR, `_manifest-${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify({ query, count, generatedAt: new Date(), results: allResults }, null, 2));
  console.log(`\n📋 Manifest: ${manifestPath}`);

  console.log(`\n🎯 Total: ${allResults.length} images across ${sources.filter(s => !s.error).length} sources`);
}

main().catch(e => { console.error('[fetch]', e.message); process.exit(1); });

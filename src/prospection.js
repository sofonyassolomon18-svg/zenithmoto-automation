require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const LOG_FILE = path.join(__dirname, '..', 'logs', 'prospection.csv');
const SEARCH_QUERIES = [
  'hôtel Bienne', 'hôtel Biel', 'auberge jeunesse Bienne',
  'office du tourisme Bienne', 'agence voyage Bienne',
  'entreprise transport Bienne', 'concessionnaire moto Bienne',
];

function getTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

function alreadyContacted(name) {
  if (!fs.existsSync(LOG_FILE)) return false;
  return fs.readFileSync(LOG_FILE, 'utf8').includes(name.replace(/,/g, ''));
}

function logContact(name, email, status) {
  const line = `${new Date().toISOString()},${name.replace(/,/g, '')},${email},${status}\n`;
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, 'Date,Nom,Email,Statut\n');
  }
  fs.appendFileSync(LOG_FILE, line);
}

function guessEmail(name, website) {
  if (website) {
    try {
      const domain = new URL(website.startsWith('http') ? website : `https://${website}`)
        .hostname.replace(/^www\./, '');
      return `info@${domain}`;
    } catch {}
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
  return `info@${slug}.ch`;
}

function buildEmail(prospect) {
  return {
    subject: `Partenariat ZenithMoto × ${prospect.name} — Location de motos pour vos clients`,
    html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c2c2c">
  <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:800">ZenithMoto</span>
    <span style="color:#f0a500;font-size:22px">.</span>
    <span style="color:rgba(255,255,255,0.6);font-size:13px;margin-left:8px">Location de motos — Bienne</span>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none">
    <p>Bonjour,</p>
    <p>Je me permets de vous contacter au sujet d'un partenariat potentiellement avantageux pour <strong>${prospect.name}</strong> et ses clients.</p>
    <p>Je suis <strong>ZenithMoto</strong>, agence de location de motos basée à Bienne. Notre flotte comprend :</p>
    <ul style="line-height:2">
      <li>🏍️ <strong>Tracer 700 2024</strong> — Roadster sport pour les amateurs de sensations</li>
      <li>🛵 <strong>X-ADV 2025</strong> — Adventure scooter pour explorer la région</li>
      <li>🛵 <strong>T-Max</strong> — Scooter premium pour voyageurs exigeants</li>
      <li>🛵 <strong>X-Max 300 & 125</strong> — Pour tous les profils</li>
    </ul>
    <p><strong>Ce que nous proposons à vos clients :</strong></p>
    <ul style="line-height:2">
      <li>✅ Tarifs préférentiels pour vos clients (remise partenaire)</li>
      <li>✅ Commission attractive pour chaque réservation référencée</li>
      <li>✅ Flyers et QR codes à disposition dans vos locaux</li>
      <li>✅ Service de livraison/reprise possible sur Bienne</li>
    </ul>
    <p>La région de Bienne et ses environs (Jura, lac de Bienne, cols alpins) se prêtent parfaitement à la découverte à moto. Vos clients/collaborateurs apprécieront cette offre unique.</p>
    <p>Seriez-vous disponible pour un court échange téléphonique ou un café cette semaine ?</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#666;font-size:13px">Cordialement,<br>
    <strong style="color:#2c2c2c">ZenithMoto</strong><br>
    zenithmoto.ch@gmail.com | zenithmoto.ch<br>
    Bienne (Biel), Suisse</p>
  </div>
  <div style="background:#f5f5f5;padding:12px 32px;text-align:center;font-size:11px;color:#999;border-radius:0 0 8px 8px">
    © 2026 ZenithMoto · Bienne, Suisse
  </div>
</div>`,
  };
}

async function searchProspects() {
  const results = [];
  const seen = new Set();

  for (const query of SEARCH_QUERIES) {
    try {
      const res = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
        params: { query, key: MAPS_KEY, language: 'fr' },
      });
      for (const place of res.data.results || []) {
        if (!seen.has(place.place_id)) {
          seen.add(place.place_id);
          results.push({
            name: place.name,
            address: place.formatted_address,
            website: place.website || null,
          });
        }
      }
    } catch (e) {
      console.error(`Maps error for "${query}":`, e.message);
    }
  }
  return results;
}

async function runProspection() {
  console.log('📍 Recherche de partenaires via Google Maps...\n');
  const prospects = await searchProspects();
  console.log(`✅ ${prospects.length} partenaires potentiels trouvés\n`);

  const transport = getTransport();
  let sent = 0, skipped = 0;

  for (const p of prospects) {
    if (alreadyContacted(p.name)) {
      skipped++;
      continue;
    }
    const email = guessEmail(p.name, p.website);
    const { subject, html } = buildEmail(p);
    try {
      await transport.sendMail({
        from: `"ZenithMoto" <${process.env.SMTP_EMAIL}>`,
        to: email,
        subject,
        html,
      });
      logContact(p.name, email, 'SENT');
      console.log(`✅ ${p.name} → ${email}`);
      sent++;
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      logContact(p.name, email, 'ERROR');
      console.log(`❌ ${p.name}: ${e.message}`);
    }
  }

  console.log(`\n📊 ${sent} emails envoyés, ${skipped} déjà contactés\n`);
}

module.exports = { runProspection };

if (require.main === module) {
  runProspection().catch(console.error);
}

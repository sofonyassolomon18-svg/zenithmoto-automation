// contract-pdf.js — generate rental contract PDF (FR/DE) + email-token e-signature (B2C <2000 CHF, légalement valide CH)
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const { upsert, select } = require('./lib/supabase');
const { notify } = require('./lib/telegram');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://edcvmgpcllhszxvthdzx.supabase.co';
const BUCKET = 'zenithmoto-content';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://zenithmoto.ch';

const I18N = {
  fr: {
    title: 'CONTRAT DE LOCATION',
    parties: 'PARTIES',
    lessor: 'Loueur',
    lessor_addr: 'ZenithMoto — Bienne, Suisse',
    lessee: 'Locataire',
    vehicle: 'VÉHICULE',
    period: 'PÉRIODE',
    from: 'Du',
    to: 'Au',
    price: 'PRIX & CAUTION',
    rental: 'Prix location',
    caution: 'Caution',
    terms: 'CONDITIONS GÉNÉRALES',
    terms_body: '1. Le locataire confirme détenir un permis valide pour le véhicule.\n2. Le véhicule est rendu dans l\'état initial, plein d\'essence.\n3. Aucune caution n\'est prélevée. En cas de dommage, le locataire est responsable dans la limite de la franchise et facturé séparément.\n4. Toute infraction routière est à la charge du locataire.\n5. Annulation gratuite >72h. 24-72h : 50% retenu. <24h : 100%.\n6. Assurance RC incluse, casco partielle. Franchise: CHF 2\'000.\n7. Litiges: for à Bienne, droit suisse.',
    sign: 'SIGNATURE ÉLECTRONIQUE',
    sign_pending: 'En attente de signature électronique par email.',
  },
  de: {
    title: 'MIETVERTRAG',
    parties: 'PARTEIEN',
    lessor: 'Vermieter',
    lessor_addr: 'ZenithMoto — Biel/Bienne, Schweiz',
    lessee: 'Mieter',
    vehicle: 'FAHRZEUG',
    period: 'ZEITRAUM',
    from: 'Von',
    to: 'Bis',
    price: 'PREIS & KAUTION',
    rental: 'Mietpreis',
    caution: 'Kaution',
    terms: 'ALLGEMEINE BEDINGUNGEN',
    terms_body: '1. Der Mieter bestätigt einen gültigen Führerschein.\n2. Das Fahrzeug wird im Anfangszustand und vollgetankt zurückgegeben.\n3. Bei Schäden wird die Kaution belastet (max. blockierter Betrag).\n4. Verkehrsverstösse gehen zu Lasten des Mieters.\n5. Kostenlose Stornierung >48h. <48h: 50%. No-Show: 100%.\n6. HP-Versicherung inkl., Teilkasko. Selbstbehalt: CHF 2\'000.\n7. Gerichtsstand: Biel, Schweizer Recht.',
    sign: 'ELEKTRONISCHE UNTERSCHRIFT',
    sign_pending: 'Wartet auf E-Mail-Signatur.',
  },
};

function buildPdf(booking, lang = 'fr') {
  const t = I18N[lang] || I18N.fr;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).fillColor('#0a0a0a').text(t.title, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#666').text(`Contrat #${booking.id} — ${new Date().toLocaleDateString(lang === 'de' ? 'de-CH' : 'fr-CH')}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(12).fillColor('#d4a017').text(t.parties);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#0a0a0a')
      .text(`${t.lessor}: ${t.lessor_addr}`)
      .text(`${t.lessee}: ${booking.customer_name || ''} — ${booking.customer_email || ''}`)
      .text(`Tél: ${booking.customer_phone || '—'}`);
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor('#d4a017').text(t.vehicle);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#0a0a0a').text(booking.moto_name || booking.moto || '');
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor('#d4a017').text(t.period);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#0a0a0a')
      .text(`${t.from}: ${booking.start_date || ''}`)
      .text(`${t.to}: ${booking.end_date || ''}`);
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor('#d4a017').text(t.price);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#0a0a0a')
      .text(`${t.rental}: CHF ${booking.amount_chf || 0}`)
      .text(`${t.caution}: CHF 0`);
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor('#d4a017').text(t.terms);
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#0a0a0a').text(t.terms_body, { align: 'justify' });
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#d4a017').text(t.sign);
    doc.moveDown(0.3);
    if (booking.signed_at) {
      doc.fontSize(10).fillColor('#0a0a0a')
        .text(`✓ Signé le ${new Date(booking.signed_at).toLocaleString(lang === 'de' ? 'de-CH' : 'fr-CH')}`)
        .text(`IP: ${booking.signed_ip || '—'}`)
        .text(`Token: ${(booking.sign_token || '').slice(0, 12)}…`);
    } else {
      doc.fontSize(10).fillColor('#888').text(t.sign_pending);
    }

    doc.end();
  });
}

async function uploadPdf(bookingId, buffer) {
  const filePath = `contracts/${bookingId}/contract-${Date.now()}.pdf`;
  try {
    await axios.post(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`,
      buffer,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/pdf',
          'x-upsert': 'true',
        },
        timeout: 15000,
        maxBodyLength: Infinity,
      }
    );
    return filePath;
  } catch (e) {
    console.warn('[contract-pdf:upload]', e.response?.status, e.message);
    return null;
  }
}

async function sendSignEmail(booking, signUrl) {
  if (!process.env.RESEND_API_KEY) return;
  const lang = booking.lang === 'de' ? 'de' : 'fr';
  const subject = lang === 'de' ? 'Mietvertrag unterschreiben — ZenithMoto' : 'Signer votre contrat de location — ZenithMoto';
  const body = lang === 'de'
    ? `<p>Hallo ${booking.customer_name || ''},</p><p>Bitte unterzeichnen Sie Ihren Mietvertrag:</p><p><a href="${signUrl}" style="background:#d4a017;color:#0a0a0a;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600">Vertrag unterschreiben</a></p><p>Mit einem Klick akzeptieren Sie die AGB.</p>`
    : `<p>Bonjour ${booking.customer_name || ''},</p><p>Merci de signer électroniquement votre contrat de location :</p><p><a href="${signUrl}" style="background:#d4a017;color:#0a0a0a;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600">Signer le contrat</a></p><p>Un clic vaut acceptation des CGV.</p>`;
  try {
    await axios.post('https://api.resend.com/emails', {
      from: 'ZenithMoto <contact@zenithmoto.ch>',
      to: booking.customer_email,
      subject,
      html: body,
    }, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      timeout: 10000,
    });
  } catch (e) {
    console.warn('[contract-pdf:email]', e.response?.status, e.message);
  }
}

async function generateContract(bookingId) {
  const booking = (await select('bookings', `id=eq.${bookingId}&select=*`))?.[0];
  if (!booking) throw new Error(`booking ${bookingId} not found`);
  const lang = booking.lang === 'de' ? 'de' : 'fr';

  const token = crypto.randomBytes(24).toString('hex');
  const pdfBuf = await buildPdf({ ...booking, sign_token: token }, lang);
  const filePath = await uploadPdf(bookingId, pdfBuf);

  await upsert('contracts', {
    booking_id: bookingId,
    file_path: filePath,
    sign_token: token,
    status: 'pending_signature',
    lang,
    created_at: new Date().toISOString(),
  }, { onConflict: 'booking_id' });

  const signUrl = `${PUBLIC_BASE_URL}/contract/sign?token=${token}`;
  await sendSignEmail(booking, signUrl);
  await notify(`📄 Contrat envoyé booking ${bookingId} → ${booking.customer_email}`, 'info', { project: 'zenithmoto' });

  return { filePath, token, signUrl };
}

// Express handler: GET /contract/sign?token=...  — display + accept button
//                  POST /contract/sign           — finalize
function mountRoutes(app) {
  app.get('/contract/sign', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token manquant');
    const ct = (await select('contracts', `sign_token=eq.${token}&select=*`))?.[0];
    if (!ct) return res.status(404).send('Contrat introuvable');
    if (ct.status === 'signed') {
      return res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>✅ Déjà signé</h2></body></html>`);
    }
    res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signer le contrat</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;max-width:520px;margin:auto;background:#0a0a0a;color:#f5f5f5}
button{width:100%;padding:16px;background:#d4a017;color:#0a0a0a;border:0;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;margin-top:24px}
.box{background:#1a1a1a;padding:20px;border-radius:10px;margin-top:16px}</style></head>
<body><h1>Signature électronique</h1>
<div class="box"><p>Booking: <strong>${ct.booking_id}</strong></p><p>En cliquant "J'accepte", vous reconnaissez avoir lu le contrat et les CGV. Conforme au droit suisse B2C (<CHF 2'000).</p></div>
<form method="post" action="/contract/sign">
<input type="hidden" name="token" value="${token}">
<button type="submit">J'accepte et je signe</button>
</form></body></html>`);
  });

  app.post('/contract/sign', express.urlencoded({ extended: true }), async (req, res) => {
    const token = req.body?.token;
    if (!token) return res.status(400).send('Token manquant');
    const ct = (await select('contracts', `sign_token=eq.${token}&select=*`))?.[0];
    if (!ct) return res.status(404).send('Contrat introuvable');

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const ua = req.headers['user-agent'] || '';

    await upsert('contracts', {
      booking_id: ct.booking_id,
      sign_token: token,
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_ip: ip,
      signed_ua: ua,
    }, { onConflict: 'booking_id' });

    await notify(`✍️ Contrat SIGNÉ booking ${ct.booking_id} IP ${ip}`, 'success', { project: 'zenithmoto' });

    res.set('Content-Type', 'text/html; charset=utf-8').send(`<html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#fff;text-align:center"><h2>✅ Contrat signé</h2><p>Merci, vous allez recevoir une copie par email.</p></body></html>`);
  });
}

module.exports = { generateContract, mountRoutes, buildPdf };

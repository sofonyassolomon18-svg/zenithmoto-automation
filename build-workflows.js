const fs = require('fs');

const SMTP_CRED = { smtp: { id: 'smtp-zenithmoto', name: 'ZenithMoto Gmail SMTP' } };

// ── WORKFLOW 1: Content Generation ──────────────────────────────────────────
const w1 = {
  name: 'ZenithMoto — Génération Posts Réseaux Sociaux',
  nodes: [
    {
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * *' }] } },
      id: 'zm-sched-01', name: 'Chaque jour à 9h',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.1, position: [240, 300]
    },
    {
      parameters: {
        jsCode: [
          'const fleet = [',
          '  {name:"Tracer 700 2024",type:"roadster sport",style:"aventure liberté"},',
          '  {name:"X-ADV 2025",type:"adventure scooter",style:"exploration urbaine"},',
          '  {name:"T-Max",type:"scooter premium",style:"luxe prestige"},',
          '  {name:"X-Max 300",type:"scooter",style:"polyvalence élégance"},',
          '  {name:"X-Max 125",type:"scooter accessible",style:"liberté urbaine"}',
          '];',
          'const plats = [',
          '  {p:"Instagram",s:"esthétique lifestyle, 3-4 phrases percutantes, 15 hashtags FR/CH, CTA réserver zenithmoto.ch"},',
          '  {p:"TikTok",s:"punchy Gen-Z, 1 accroche choc + 3 phrases max + CTA, plein emojis"},',
          '  {p:"Facebook",s:"informatif professionnel, présentation + avantages + à partir CHF 120/jour + 6 hashtags + CTA zenithmoto.ch"}',
          '];',
          'const items = [];',
          'for (const m of fleet) {',
          '  for (const {p,s} of plats) {',
          '    items.push({json:{moto:m.name, platform:p,',
          '      prompt:"Community manager ZenithMoto Bienne. Post "+p+" en français pour "+m.name+" ("+m.type+", "+m.style+"). Style: "+s+".",',
          '    }});',
          '  }',
          '}',
          'return items;',
        ].join('\n')
      },
      id: 'zm-code-01', name: 'Préparer 15 Prompts',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300]
    },
    {
      parameters: { batchSize: 1, options: {} },
      id: 'zm-split-01', name: 'Boucle 1 par 1',
      type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [680, 300]
    },
    {
      parameters: {
        method: 'POST',
        url: '=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={{ $env.GEMINI_API_KEY }}',
        sendBody: true, contentType: 'raw', rawContentType: 'application/json',
        body: '={"contents":[{"parts":[{"text":"{{ $json.prompt }}"}]}]}',
        options: {}
      },
      id: 'zm-http-01', name: 'Gemini AI',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.1, position: [900, 300]
    },
    {
      parameters: {
        jsCode: [
          'const text = $input.item.json.candidates?.[0]?.content?.parts?.[0]?.text || "Erreur génération";',
          'const loop = $("Boucle 1 par 1").item.json;',
          'return [{json: {moto: loop.moto, platform: loop.platform, post: text}}];',
        ].join('\n')
      },
      id: 'zm-extract-01', name: 'Extraire Post',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [1120, 300]
    },
    {
      parameters: { aggregate: 'aggregateAllItemData', options: {} },
      id: 'zm-agg-01', name: 'Agréger Tous Posts',
      type: 'n8n-nodes-base.aggregate', typeVersion: 1, position: [1340, 300]
    },
    {
      parameters: {
        jsCode: [
          'const posts = $input.item.json.data;',
          'let html = "<h2 style=\\"color:#1a1a2e\\">Posts ZenithMoto — " + new Date().toLocaleDateString("fr-CH") + "</h2>";',
          'for (const p of posts) {',
          '  html += "<hr><h3>" + p.platform + " — " + p.moto + "</h3><p>" + p.post.replace(/\\n/g,"<br>") + "</p>";',
          '}',
          'return [{json: {html}}];',
        ].join('\n')
      },
      id: 'zm-format-01', name: 'Formater Email',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [1560, 300]
    },
    {
      parameters: {
        fromEmail: 'zenithmoto.ch@gmail.com',
        toEmail: 'zenithmoto.ch@gmail.com',
        subject: '📱 Posts ZenithMoto — Aujourd\'hui',
        emailFormat: 'html',
        message: '={{ $json.html }}',
        options: {}
      },
      id: 'zm-email-01', name: 'Envoyer Posts',
      type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [1780, 300],
      credentials: SMTP_CRED
    }
  ],
  connections: {
    'Chaque jour à 9h': { main: [[{ node: 'Préparer 15 Prompts', type: 'main', index: 0 }]] },
    'Préparer 15 Prompts': { main: [[{ node: 'Boucle 1 par 1', type: 'main', index: 0 }]] },
    'Boucle 1 par 1': { main: [
      [{ node: 'Gemini AI', type: 'main', index: 0 }],
      [{ node: 'Agréger Tous Posts', type: 'main', index: 0 }]
    ]},
    'Gemini AI': { main: [[{ node: 'Extraire Post', type: 'main', index: 0 }]] },
    'Extraire Post': { main: [[{ node: 'Boucle 1 par 1', type: 'main', index: 0 }]] },
    'Agréger Tous Posts': { main: [[{ node: 'Formater Email', type: 'main', index: 0 }]] },
    'Formater Email': { main: [[{ node: 'Envoyer Posts', type: 'main', index: 0 }]] }
  },
  settings: { timezone: 'Europe/Zurich' }, active: false
};

// ── WORKFLOW 3: Booking Notifications ────────────────────────────────────────
const w3 = {
  name: 'ZenithMoto — Notifications Réservations',
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'zenithmoto-booking', responseMode: 'lastNode', options: {} },
      id: 'zm-webhook-03', name: 'Webhook Lovable',
      type: 'n8n-nodes-base.webhook', typeVersion: 1.1, position: [240, 300],
      webhookId: 'zm-lovable-booking'
    },
    {
      parameters: {
        mode: 'rules',
        rules: { values: [
          {
            conditions: { conditions: [{ leftValue: '={{ $json.body.event }}', rightValue: 'booking_created', operator: { type: 'string', operation: 'equals' } }] },
            renameOutput: true, outputKey: 'Confirmation'
          },
          {
            conditions: { conditions: [{ leftValue: '={{ $json.body.event }}', rightValue: 'booking_completed', operator: { type: 'string', operation: 'equals' } }] },
            renameOutput: true, outputKey: 'Suivi'
          }
        ]},
        options: {}
      },
      id: 'zm-switch-03', name: 'Type Événement',
      type: 'n8n-nodes-base.switch', typeVersion: 3, position: [460, 300]
    },
    {
      parameters: {
        fromEmail: 'zenithmoto.ch@gmail.com',
        toEmail: '={{ $json.body.booking.client_email }}',
        subject: '=✅ Réservation confirmée — {{ $json.body.booking.motorcycle }} · ZenithMoto',
        emailFormat: 'html',
        message: '=<div style="font-family:Arial,sans-serif;max-width:580px"><div style="background:#1a1a2e;padding:20px 28px;border-radius:8px 8px 0 0"><span style="color:#fff;font-size:20px;font-weight:800">ZenithMoto</span><span style="color:#f0a500">.</span></div><div style="background:#fff;padding:28px;border:1px solid #eee;border-top:none"><h2 style="color:#1a1a2e">Réservation confirmée 🎉</h2><p>Bonjour <strong>{{ $json.body.booking.client_name }}</strong>,</p><div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:16px 0"><p>🏍️ <strong>{{ $json.body.booking.motorcycle }}</strong></p><p>📅 Du {{ $json.body.booking.start_date }} au {{ $json.body.booking.end_date }}</p><p>💰 CHF {{ $json.body.booking.price }}</p></div><p>Permis de conduire + pièce d\'identité requis. Casque fourni.</p><p style="color:#666;font-size:13px">ZenithMoto · zenithmoto.ch</p></div></div>',
        options: {}
      },
      id: 'zm-confirm-03', name: 'Email Confirmation',
      type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [700, 160],
      credentials: SMTP_CRED
    },
    {
      parameters: { amount: 24, unit: 'hours' },
      id: 'zm-wait-03', name: 'Attendre 24h',
      type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [940, 160],
      webhookId: 'zm-wait-24h-03'
    },
    {
      parameters: {
        fromEmail: 'zenithmoto.ch@gmail.com',
        toEmail: '={{ $json.body.booking.client_email }}',
        subject: '=⏰ C\'est demain ! {{ $json.body.booking.motorcycle }} — ZenithMoto',
        emailFormat: 'html',
        message: '=<div style="font-family:Arial,sans-serif;max-width:580px"><div style="background:#1a1a2e;padding:20px 28px;border-radius:8px 8px 0 0"><span style="color:#fff;font-size:20px;font-weight:800">ZenithMoto</span><span style="color:#f0a500">.</span></div><div style="background:#fff;padding:28px;border:1px solid #eee;border-top:none"><h2 style="color:#1a1a2e">C\'est demain ! 🏍️</h2><p>Bonjour <strong>{{ $json.body.booking.client_name }}</strong>, votre <strong>{{ $json.body.booking.motorcycle }}</strong> commence demain.</p><div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px"><p><strong>📋 N\'oubliez pas :</strong> Permis de conduire · Pièce d\'identité · Carte de crédit</p></div><p style="color:#666;font-size:13px">ZenithMoto · zenithmoto.ch</p></div></div>',
        options: {}
      },
      id: 'zm-reminder-03', name: 'Email Rappel J-1',
      type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [1180, 160],
      credentials: SMTP_CRED
    },
    {
      parameters: {
        fromEmail: 'zenithmoto.ch@gmail.com',
        toEmail: '={{ $json.body.booking.client_email }}',
        subject: '=⭐ Merci {{ $json.body.booking.client_name }} — Votre avis compte !',
        emailFormat: 'html',
        message: '=<div style="font-family:Arial,sans-serif;max-width:580px"><div style="background:#1a1a2e;padding:20px 28px;border-radius:8px 8px 0 0"><span style="color:#fff;font-size:20px;font-weight:800">ZenithMoto</span><span style="color:#f0a500">.</span></div><div style="background:#fff;padding:28px;border:1px solid #eee;border-top:none"><h2 style="color:#1a1a2e">Merci ! 🙏</h2><p>Bonjour <strong>{{ $json.body.booking.client_name }}</strong>, merci pour votre location de la <strong>{{ $json.body.booking.motorcycle }}</strong> !</p><p>Un avis Google prend 30 secondes et nous aide énormément :</p><div style="text-align:center;margin:24px 0"><a href="https://www.google.com/search?q=ZenithMoto+Bienne+avis" style="background:#f0a500;color:#1a1a2e;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none">⭐ Laisser un avis Google</a></div><p style="color:#666;font-size:13px">ZenithMoto · zenithmoto.ch</p></div></div>',
        options: {}
      },
      id: 'zm-followup-03', name: 'Email Suivi Avis',
      type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [700, 460],
      credentials: SMTP_CRED
    },
    {
      parameters: { respondWith: 'json', responseBody: '{"success":true}' },
      id: 'zm-respond-03', name: 'Répondre OK',
      type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [940, 460]
    }
  ],
  connections: {
    'Webhook Lovable': { main: [[{ node: 'Type Événement', type: 'main', index: 0 }]] },
    'Type Événement': { main: [
      [{ node: 'Email Confirmation', type: 'main', index: 0 }],
      [{ node: 'Email Suivi Avis', type: 'main', index: 0 }]
    ]},
    'Email Confirmation': { main: [[{ node: 'Attendre 24h', type: 'main', index: 0 }]] },
    'Attendre 24h': { main: [[{ node: 'Email Rappel J-1', type: 'main', index: 0 }]] },
    'Email Suivi Avis': { main: [[{ node: 'Répondre OK', type: 'main', index: 0 }]] }
  },
  settings: { timezone: 'Europe/Zurich' }, active: false
};

fs.writeFileSync('./n8n-workflows/01-content-generation.json', JSON.stringify(w1, null, 2));
fs.writeFileSync('./n8n-workflows/03-booking-notifications.json', JSON.stringify(w3, null, 2));
console.log('✅ 01-content-generation.json');
console.log('✅ 03-booking-notifications.json');
console.log('✅ 02-prospection.json (déjà créé)');
console.log('✅ 04-weekly-report.json (déjà créé)');

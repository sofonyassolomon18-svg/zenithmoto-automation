require('dotenv').config();

const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
  });
}

const { createWebhookServer } = require('./src/notifications');
const { startScheduler } = require('./src/scheduler');

const PORT = process.env.PORT || process.env.WEBHOOK_PORT || 3001;

function checkEnv() {
  const required = ['GMAIL_APP_PASSWORD', 'SMTP_EMAIL'];
  const critical = [
    // Without these, the majority of crons silently skip or degrade
    'SUPABASE_URL', 'SUPABASE_SERVICE_KEY',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  ];
  const optional = [
    'GEMINI_API_KEY', 'GOOGLE_MAPS_API_KEY',
    'WEBHOOK_SECRET', 'STRIPE_SECRET_KEY',
    'FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN',
    'INSTAGRAM_USER_ID', 'INSTAGRAM_ACCESS_TOKEN',
    'BUFFER_ACCESS_TOKEN',
    'POSTIZ_API_URL', 'POSTIZ_API_KEY', 'POSTIZ_INTEGRATION_IDS',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ Variables manquantes dans .env:', missing.join(', '));
    process.exit(1);
  }
  const missingCritical = critical.filter(k => !process.env[k]);
  if (missingCritical.length) {
    console.error('❌ Variables critiques manquantes (crons Supabase/Telegram désactivés):', missingCritical.join(', '));
    // Non-fatal: service can still handle webhooks, but alert loudly
  }
  const missingOpt = optional.filter(k => !process.env[k]);
  if (missingOpt.length) {
    console.warn('⚠️  Optionnelles manquantes (certains crons désactivés):', missingOpt.join(', '));
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID absents — toutes les alertes Telegram seront silencieuses');
  }
  if (!process.env.WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
    console.error('❌ WEBHOOK_SECRET requis en production (sécurité webhook HMAC)');
    process.exit(1);
  }
}

async function main() {
  console.log('\n🏍️  ZenithMoto Automation — Démarrage\n');
  checkEnv();

  // Webhook server (Lovable → notifications)
  const app = createWebhookServer();

  // Mount new feature routes
  try {
    const { mountReferralRoutes } = require('./src/referral');
    mountReferralRoutes(app);
    console.log('[boot] referral routes mounted');
  } catch (e) { console.warn('[boot] referral mount failed:', e.message); }

  try {
    const damageRouter = require('./src/damage-report');
    app.use('/api', damageRouter);
    console.log('[boot] damage-report routes mounted at /api');
  } catch (e) { console.warn('[boot] damage-report mount failed:', e.message); }

  try {
    const { mountRoutes: mountContractRoutes } = require('./src/contract-pdf');
    mountContractRoutes(app);
    console.log('[boot] contract-pdf routes mounted');
  } catch (e) { console.warn('[boot] contract-pdf mount failed:', e.message); }

  try {
    const { mountLoyaltyRoutes } = require('./src/loyalty');
    mountLoyaltyRoutes(app);
    console.log('[boot] loyalty routes mounted');
  } catch (e) { console.warn('[boot] loyalty mount failed:', e.message); }

  try {
    const { mountNpsRoutes } = require('./src/nps-rental');
    mountNpsRoutes(app);
    console.log('[boot] nps routes mounted');
  } catch (e) { console.warn('[boot] nps-rental mount failed:', e.message); }

  try {
    const express = require('express');
    const { handleCallback: licenseCallback } = require('./src/license-verify');
    app.post('/webhook/license-verify', express.json(), async (req, res) => {
      try {
        const { bookingId, status } = req.body;
        if (!bookingId || !status) return res.status(400).json({ error: 'missing bookingId or status' });
        const r = await licenseCallback(bookingId, status);
        res.json(r);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    console.log('[boot] license-verify callback mounted at /webhook/license-verify');
  } catch (e) { console.warn('[boot] license-verify mount failed:', e.message); }

  app.listen(PORT, async () => {
    console.log(`🌐 Webhook en écoute sur http://localhost:${PORT}/webhook/booking`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health\n`);

    // Startup Telegram notification
    try {
      const { notify } = require('./src/lib/telegram');
      const domain = process.env.RAILWAY_PUBLIC_DOMAIN || `localhost:${PORT}`;
      await notify(
        `🚀 *ZenithMoto Automation démarré*\nEnv: ${process.env.NODE_ENV || 'development'}\nURL: https://${domain}`,
        'success',
        { project: 'zenithmoto' }
      );
    } catch (_) {}
  });

  // Cron jobs
  startScheduler();

  console.log('✅ Système ZenithMoto opérationnel\n');
}

main().catch(e => {
  console.error('\n❌ Erreur fatale:', e.message);
  if (process.env.SENTRY_DSN) Sentry.captureException(e);
  process.exit(1);
});

process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e.message);
  if (process.env.SENTRY_DSN) Sentry.captureException(e);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e?.message || e);
});

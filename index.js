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
  const optional = ['GEMINI_API_KEY', 'GOOGLE_MAPS_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ Variables manquantes dans .env:', missing.join(', '));
    process.exit(1);
  }
  const missingOpt = optional.filter(k => !process.env[k]);
  if (missingOpt.length) {
    console.warn('⚠️  Optionnelles manquantes (certains crons désactivés):', missingOpt.join(', '));
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

  app.listen(PORT, () => {
    console.log(`🌐 Webhook en écoute sur http://localhost:${PORT}/webhook/booking`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health\n`);
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

require('dotenv').config();

const { createWebhookServer } = require('./src/notifications');
const { startScheduler } = require('./src/scheduler');

const PORT = process.env.PORT || process.env.WEBHOOK_PORT || 3001;

function checkEnv() {
  const required = ['GEMINI_API_KEY', 'GOOGLE_MAPS_API_KEY', 'GMAIL_APP_PASSWORD', 'SMTP_EMAIL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ Variables manquantes dans .env:', missing.join(', '));
    process.exit(1);
  }
}

async function main() {
  console.log('\n🏍️  ZenithMoto Automation — Démarrage\n');
  checkEnv();

  // Webhook server (Lovable → notifications)
  const app = createWebhookServer();
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
  process.exit(1);
});

// Prevent unhandled errors from crashing the server
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e?.message || e);
});

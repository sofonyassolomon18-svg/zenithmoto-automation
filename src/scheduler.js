const cron = require('node-cron');
const axios = require('axios');
const { generateAllPosts } = require('./content-generator');
const { runProspection } = require('./prospection');
const { checkAndSendReminders } = require('./notifications');
const { sendWeeklyReport, sendDailyKpiTelegram } = require('./reports');
const { runBookingAssistant } = require('./booking-assistant');

function startScheduler() {
  console.log('⏱️  Scheduler démarré\n');

  // Keep-alive — ping /health toutes les 4 min pour éviter le sleep Railway
  const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/health`
    : `http://localhost:${process.env.PORT || 3001}/health`;

  // Track keep-alive failures pour détecter Railway down sans flooder les logs
  let keepAliveFails = 0;
  cron.schedule('*/4 * * * *', async () => {
    try {
      await axios.get(selfUrl, { timeout: 5000 });
      if (keepAliveFails > 0) {
        console.log(`[keep-alive] récupéré après ${keepAliveFails} échecs`);
        keepAliveFails = 0;
      }
    } catch (e) {
      keepAliveFails++;
      // Log toutes les 3 fails (12 min) pour pas spammer mais détecter incident
      if (keepAliveFails % 3 === 1) {
        console.warn(`[keep-alive] échec #${keepAliveFails} (${selfUrl}): ${e.message}`);
      }
    }
  });

  // Génération contenu — tous les jours à 9h00
  cron.schedule('0 9 * * *', async () => {
    console.log('\n[CRON] Génération des posts réseaux sociaux...');
    try { await generateAllPosts(); } catch (e) { console.error('CRON content error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Rappels J-1 — tous les jours à 10h00
  cron.schedule('0 10 * * *', async () => {
    console.log('\n[CRON] Vérification rappels J-1...');
    try { await checkAndSendReminders(); } catch (e) { console.error('CRON reminder error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Daily KPI Telegram — tous les jours à 8h00 (briefing matinal)
  cron.schedule('0 8 * * *', async () => {
    try { await sendDailyKpiTelegram(); }
    catch (e) { console.error('CRON daily KPI error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Prospection partenaires — tous les lundis à 9h30
  cron.schedule('30 9 * * 1', async () => {
    console.log('\n[CRON] Prospection partenaires...');
    try { await runProspection(); } catch (e) { console.error('CRON prospection error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Rapport hebdomadaire — tous les lundis à 8h00
  cron.schedule('0 8 * * 1', async () => {
    console.log('\n[CRON] Envoi rapport hebdomadaire...');
    try { await sendWeeklyReport(); } catch (e) { console.error('CRON report error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Booking Assistant — toutes les 15 min (remplace Make.com 5491229)
  cron.schedule('*/15 * * * *', async () => {
    try {
      const r = await runBookingAssistant();
      if (r.processed > 0) console.log(`[CRON booking] processed=${r.processed} replied=${r.replied} skipped=${r.skipped} errors=${r.errors}`);
    } catch (e) { console.error('CRON booking error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  console.log('📅 Tâches programmées :');
  console.log('   🏍️  Posts réseaux sociaux  → tous les jours à 09:00');
  console.log('   ⏰  Rappels J-1             → tous les jours à 10:00');
  console.log('   🤝  Prospection partenaires → lundis à 09:30');
  console.log('   📊  Rapport hebdomadaire    → lundis à 08:00');
  console.log('   ✉️  Booking Assistant       → toutes les 15 minutes\n');
}

module.exports = { startScheduler };

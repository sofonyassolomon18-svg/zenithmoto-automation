const cron = require('node-cron');
const axios = require('axios');
const { generateAllPosts } = require('./content-generator');
const { runProspection } = require('./prospection');
const { checkAndSendReminders, checkAndSendPostRentalReview } = require('./notifications');
const { sendWeeklyReport, sendDailyKpiTelegram, sendWeeklyKpiTelegram } = require('./reports');
const { runBookingAssistant } = require('./booking-assistant');
const { runBufferMonitor } = require('./buffer-monitor');
const { recoverAbandonedBookings } = require('./retention');

function startScheduler() {
  console.log('⏱️  Scheduler démarré\n');

  // ─── Keep-alive Railway DÉSACTIVÉ ────────────────────────────
  // Railway plan payant = pas de sleep, le keep-alive interne (ping /health toutes les 4 min)
  // est inutile et fait juste tourner le CPU pour rien. Le healthcheck de Railway suffit.
  // Si on retombe sur un plan free / hibernate → ré-activer le bloc ci-dessous.
  //
  // const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
  //   ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/health`
  //   : `http://localhost:${process.env.PORT || 3001}/health`;
  // let keepAliveFails = 0;
  // cron.schedule('*/4 * * * *', async () => {
  //   try {
  //     await axios.get(selfUrl, { timeout: 5000 });
  //     if (keepAliveFails > 0) { console.log(`[keep-alive] récupéré après ${keepAliveFails} échecs`); keepAliveFails = 0; }
  //   } catch (e) {
  //     keepAliveFails++;
  //     if (keepAliveFails % 3 === 1) console.warn(`[keep-alive] échec #${keepAliveFails} (${selfUrl}): ${e.message}`);
  //   }
  // });

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

  // Follow-up avis Google post-location J+2 — tous les jours à 10h05
  // Cible les locations dont end_date = il y a 2 jours (J+2 après la fin)
  cron.schedule('5 10 * * *', async () => {
    console.log('\n[CRON] Follow-up avis Google post-location J+2...');
    try { await checkAndSendPostRentalReview(); } catch (e) { console.error('CRON post-rental error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Daily KPI Telegram — tous les jours à 8h00 (briefing matinal)
  cron.schedule('0 8 * * *', async () => {
    try { await sendDailyKpiTelegram(); }
    catch (e) { console.error('CRON daily KPI error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Buffer token health check — tous les jours à 8h05 (silencieux si OK)
  cron.schedule('5 8 * * *', async () => {
    try { await runBufferMonitor(); }
    catch (e) { console.error('CRON buffer-monitor error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Rappel J-1 ZenithMoto site (Lovable Supabase) — tous les jours à 17h00
  // Trigger l'edge function send-reminder-d1 qui envoie les emails de rappel J-1
  // (pour les bookings avec start_date = demain)
  cron.schedule('0 17 * * *', async () => {
    const supaUrl = process.env.ZENITHMOTO_SUPABASE_URL;
    const supaAnon = process.env.ZENITHMOTO_SUPABASE_ANON_KEY;
    if (!supaUrl || !supaAnon) {
      console.warn('[CRON reminder-d1] ZENITHMOTO_SUPABASE_URL/ANON_KEY non configurés — skip');
      return;
    }
    try {
      const res = await axios.post(`${supaUrl}/functions/v1/send-reminder-d1`, {}, {
        headers: { Authorization: `Bearer ${supaAnon}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      console.log(`[CRON reminder-d1] OK : ${res.data.sent}/${res.data.total} envoyés pour ${res.data.date}`);
    } catch (e) {
      console.error('CRON reminder-d1 error:', e.response?.data || e.message);
    }
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

  // Abandon cart recovery — toutes les 30 min, 9h-21h (pas la nuit)
  cron.schedule('*/30 9-21 * * *', async () => {
    try {
      const r = await recoverAbandonedBookings();
      if (r?.sent > 0) console.log(`[CRON retention] abandoned=${r.count} recovered=${r.sent}`);
    } catch (e) { console.error('CRON retention error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  // Weekly KPI report Telegram — dimanche 20h00 (debrief de fin de semaine)
  cron.schedule('0 20 * * 0', async () => {
    console.log('\n[CRON] Rapport KPI hebdomadaire Telegram...');
    try { await sendWeeklyKpiTelegram(); } catch (e) { console.error('CRON weekly-kpi error:', e.message); }
  }, { timezone: 'Europe/Zurich' });

  console.log('📅 Tâches programmées :');
  console.log('   🏍️  Posts réseaux sociaux  → tous les jours à 09:00');
  console.log('   ⏰  Rappels J-1             → tous les jours à 10:00');
  console.log('   🤝  Prospection partenaires → lundis à 09:30');
  console.log('   📊  Rapport hebdomadaire    → lundis à 08:00');
  console.log('   ⭐  Avis Google post-loc.   → tous les jours à 10:05 (J+2 après fin location)');
  console.log('   ✉️  Booking Assistant       → toutes les 15 minutes');
  console.log('   🔑  Buffer token check      → tous les jours à 08:05');
  console.log('   🛒  Abandon cart recovery   → toutes les 30 min (9h-21h)');
  console.log('   📊  KPI hebdo Telegram      → dimanche 20:00\n');
}

module.exports = { startScheduler };

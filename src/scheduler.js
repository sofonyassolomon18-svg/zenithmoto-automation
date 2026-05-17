const cron = require('node-cron');
const axios = require('axios');
const Sentry = require('@sentry/node');

function cronError(name, e) {
  console.error(`CRON ${name} error:`, e.message);
  if (process.env.SENTRY_DSN) Sentry.captureException(e, { tags: { cron: name } });
}
const { generateAllPosts } = require('./content-generator');
const { runProspection } = require('./prospection');
const { checkAndSendReminders, checkAndSendPostRentalReview } = require('./notifications');
const { sendWeeklyReport, sendDailyKpiTelegram, sendWeeklyKpiTelegram } = require('./reports');
const { runBookingAssistant } = require('./booking-assistant');
const { runBufferMonitor } = require('./buffer-monitor');
const { recoverAbandonedBookings } = require('./retention');
const { pollRenders } = require('./poll-renders');
const { generateSocialAvatarPost } = require('./flows/social-avatar-post');
const { runAutoReminder } = require('./auto-reminder-rental');
const { runFleetAvailability } = require('./fleet-availability-tg');
const { runPriceYieldMonitor } = require('./price-yield-monitor');
const { runContentSchedulerPostiz } = require('./content-scheduler-postiz');
const { runMorningBrief } = require('./jobs/morning-brief');
const { runBackupDb } = require('./jobs/backup-db');
const { runUptimeMonitor } = require('./jobs/uptime-monitor');
const { runLoyaltyDaily } = require('./loyalty');
const { sendOffseasonPromo } = require('./offseason-promo');
const { sendSeasonOpening } = require('./season-opening');
const { runNpsDaily } = require('./nps-rental');
const { runQueuePoster } = require('./jobs/queue-poster');
const { notify } = require('./lib/telegram');

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
    try { await generateAllPosts(); } catch (e) { cronError('content', e); }
  }, { timezone: 'Europe/Zurich' });

  // Post photo queue FB + IG — tous les jours à 9h30
  cron.schedule('30 9 * * *', async () => {
    console.log('\n[CRON] Queue poster FB/IG...');
    try { await runQueuePoster(); } catch (e) { cronError('queue-poster', e); }
  }, { timezone: 'Europe/Zurich' });

  // Rappels J-1 — tous les jours à 10h00
  cron.schedule('0 10 * * *', async () => {
    console.log('\n[CRON] Vérification rappels J-1...');
    try { await checkAndSendReminders(); } catch (e) { cronError('reminder', e); }
  }, { timezone: 'Europe/Zurich' });

  // Follow-up avis Google post-location J+2 — tous les jours à 10h05
  // Cible les locations dont end_date = il y a 2 jours (J+2 après la fin)
  cron.schedule('5 10 * * *', async () => {
    console.log('\n[CRON] Follow-up avis Google post-location J+2...');
    try { await checkAndSendPostRentalReview(); } catch (e) { cronError('post-rental', e); }
  }, { timezone: 'Europe/Zurich' });

  // Daily KPI Telegram — tous les jours à 8h00 (briefing matinal)
  cron.schedule('0 8 * * *', async () => {
    try { await sendDailyKpiTelegram(); }
    catch (e) { cronError('daily-kpi', e); }
  }, { timezone: 'Europe/Zurich' });

  // NOTE: morning-brief staggeré à 8h02 pour éviter collision avec daily-kpi (8h00).

  // Buffer token health check — tous les jours à 8h05 (silencieux si OK)
  cron.schedule('5 8 * * *', async () => {
    try { await runBufferMonitor(); }
    catch (e) { cronError('buffer-monitor', e); }
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
      cronError('reminder-d1', e);
    }
  }, { timezone: 'Europe/Zurich' });

  // Prospection partenaires — tous les lundis à 9h30
  cron.schedule('30 9 * * 1', async () => {
    console.log('\n[CRON] Prospection partenaires...');
    try { await runProspection(); } catch (e) { cronError('prospection', e); }
  }, { timezone: 'Europe/Zurich' });

  // Rapport hebdomadaire — tous les lundis à 8h00
  cron.schedule('0 8 * * 1', async () => {
    console.log('\n[CRON] Envoi rapport hebdomadaire...');
    try { await sendWeeklyReport(); } catch (e) { cronError('report', e); }
  }, { timezone: 'Europe/Zurich' });

  // Booking Assistant — toutes les 15 min (remplace Make.com 5491229)
  cron.schedule('*/15 * * * *', async () => {
    try {
      const r = await runBookingAssistant();
      if (r.processed > 0) console.log(`[CRON booking] processed=${r.processed} replied=${r.replied} skipped=${r.skipped} errors=${r.errors}`);
    } catch (e) { cronError('booking', e); }
  }, { timezone: 'Europe/Zurich' });

  // Abandon cart recovery — toutes les 30 min, 9h-21h (pas la nuit)
  cron.schedule('*/30 9-21 * * *', async () => {
    try {
      const r = await recoverAbandonedBookings();
      if (r?.sent > 0) console.log(`[CRON retention] abandoned=${r.count} recovered=${r.sent}`);
    } catch (e) { cronError('retention', e); }
  }, { timezone: 'Europe/Zurich' });

  // HeyGen poll-renders — toutes les 2 min (download mp4, deliver email/social)
  cron.schedule('*/2 * * * *', async () => {
    try {
      await pollRenders();
    } catch (e) { cronError('poll-renders', e); }
  }, { timezone: 'Europe/Zurich' });

  // HeyGen avatar social post — mercredi 10h (configurable HEYGEN_SOCIAL_CRON)
  // Cron par défaut : `0 10 * * 3` = mercredi 10h
  cron.schedule(process.env.HEYGEN_SOCIAL_CRON || '0 10 * * 3', async () => {
    if (process.env.HEYGEN_SOCIAL_ENABLED !== 'true') {
      console.log('[CRON heygen-social] disabled (set HEYGEN_SOCIAL_ENABLED=true)');
      return;
    }
    console.log('\n[CRON] Génération avatar social post hebdo...');
    try {
      const r = await generateSocialAvatarPost();
      console.log(`[CRON heygen-social] ${r.ok ? '✅' : '❌'} ${r.ok ? `video_id=${r.video_id} tpl=${r.template_id}` : r.error}`);
    } catch (e) { cronError('heygen-social', e); }
  }, { timezone: 'Europe/Zurich' });

  // Auto-reminder H-24/48 — toutes les heures, dédupliqué via reminder_h24_sent
  cron.schedule('0 * * * *', async () => {
    try {
      const r = await runAutoReminder();
      if (r.sent > 0) console.log(`[CRON auto-reminder] sent=${r.sent} errors=${r.errors}`);
    } catch (e) { cronError('auto-reminder', e); }
  }, { timezone: 'Europe/Zurich' });

  // Fleet availability digest — tous les jours à 8h10
  cron.schedule('10 8 * * *', async () => {
    try { await runFleetAvailability(); }
    catch (e) { cronError('fleet-avail', e); }
  }, { timezone: 'Europe/Zurich' });

  // Price/yield monitor — lundis à 9h00
  cron.schedule('0 9 * * 1', async () => {
    try { await runPriceYieldMonitor(); }
    catch (e) { cronError('price-yield', e); }
  }, { timezone: 'Europe/Zurich' });

  // Content scheduler Postiz — dimanche 18h (planifie semaine suivante)
  cron.schedule('0 18 * * 0', async () => {
    try { await runContentSchedulerPostiz(); }
    catch (e) { cronError('content-scheduler-postiz', e); }
  }, { timezone: 'Europe/Zurich' });

  // Weekly KPI report Telegram — dimanche 20h00 (debrief de fin de semaine)
  cron.schedule('0 20 * * 0', async () => {
    console.log('\n[CRON] Rapport KPI hebdomadaire Telegram...');
    try { await sendWeeklyKpiTelegram(); } catch (e) { cronError('weekly-kpi', e); }
  }, { timezone: 'Europe/Zurich' });

  // Daily morning brief — tous les jours à 08:02 (pickups, returns, MTD revenue)
  // Staggeré 2 min après daily-kpi (8h00) pour éviter saturation event loop.
  cron.schedule('2 8 * * *', async () => {
    try { await runMorningBrief(); }
    catch (e) {
      cronError('morning-brief', e);
      notify(`morning-brief crashed: ${e.message}`, 'error', { project: 'zenithmoto' }).catch(() => {});
    }
  }, { timezone: 'Europe/Zurich' });

  // Nightly DB backup — 02:00 tous les jours (export JSON → bucket "backups")
  cron.schedule('0 2 * * *', async () => {
    try { await runBackupDb(); }
    catch (e) {
      cronError('backup-db', e);
      notify(`backup-db crashed: ${e.message}`, 'error', { project: 'zenithmoto' }).catch(() => {});
    }
  }, { timezone: 'Europe/Zurich' });

  // Uptime self-ping — toutes les 5 min (alerte après 3 échecs consécutifs)
  cron.schedule('*/5 * * * *', async () => {
    try { await runUptimeMonitor(); }
    catch (e) {
      cronError('uptime-monitor', e);
    }
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
  console.log('   📊  KPI hebdo Telegram      → dimanche 20:00');
  console.log('   🎬  HeyGen poll-renders     → toutes les 2 min');
  console.log(`   👤  HeyGen avatar social    → ${process.env.HEYGEN_SOCIAL_CRON || '0 10 * * 3'} ${process.env.HEYGEN_SOCIAL_ENABLED === 'true' ? '(actif)' : '(désactivé)'}`);
  console.log('   🕐  Auto-reminder H-24/48   → toutes les heures');
  console.log('   🏍️  Fleet availability TG   → tous les jours à 08:10');
  console.log('   💰  Price/yield monitor     → lundis à 09:00');
  console.log('   📅  Content scheduler Postiz→ dimanche à 18:00');
  console.log('   ☀️  Morning brief            → tous les jours à 08:00');
  console.log('   💾  DB backup nightly        → tous les jours à 02:00');
  console.log('   🩺  Uptime self-ping         → toutes les 5 minutes');

  // Loyalty daily — tous les jours à 11h
  cron.schedule('0 11 * * *', async () => {
    try {
      const r = await runLoyaltyDaily();
      if (r.awarded > 0) console.log(`[CRON loyalty] awarded=${r.awarded}`);
    } catch (e) { cronError('loyalty', e); }
  }, { timezone: 'Europe/Zurich' });

  // NPS daily — tous les jours à 10h30 (J+3 post-return, après Google review J+2 à 10h05)
  cron.schedule('30 10 * * *', async () => {
    try {
      const r = await runNpsDaily();
      if (r?.sent > 0) console.log(`[CRON nps] sent=${r.sent} date=${r.date}`);
    } catch (e) { cronError('nps', e); }
  }, { timezone: 'Europe/Zurich' });

  // Offseason promo cours hiver — 15 oct + 15 nov à 9h
  cron.schedule('0 9 15 10,11 *', async () => {
    try {
      const r = await sendOffseasonPromo();
      console.log(`[CRON offseason] sent=${r.sent || 0}`);
    } catch (e) { cronError('offseason', e); }
  }, { timezone: 'Europe/Zurich' });

  // Season opening campaign — 1 mars + 15 mars + 1 avril à 9h
  cron.schedule('0 9 1,15 3 *', async () => {
    try {
      const r = await sendSeasonOpening();
      console.log(`[CRON season] sent=${r.sent || 0} code=${r.code}`);
    } catch (e) { cronError('season', e); }
  }, { timezone: 'Europe/Zurich' });
  cron.schedule('0 9 1 4 *', async () => {
    try {
      const r = await sendSeasonOpening();
      console.log(`[CRON season-apr] sent=${r.sent || 0}`);
    } catch (e) { cronError('season-apr', e); }
  }, { timezone: 'Europe/Zurich' });

  console.log('   🏆  Loyalty daily            → tous les jours à 11:00');
  console.log('   📊  NPS post-rental          → tous les jours à 10:30 (J+3)');
  console.log('   ❄️  Offseason promo          → 15 oct + 15 nov à 09:00');
  console.log('   🌷  Season opening           → 1+15 mars + 1 avril à 09:00\n');
}

module.exports = { startScheduler };

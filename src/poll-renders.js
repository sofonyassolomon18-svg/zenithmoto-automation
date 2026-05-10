// src/poll-renders.js — Cron */2 * * * * (toutes les 2 min)
//
// Pour chaque heygen_renders.status IN ('pending','processing'):
//   1. Poll HeyGen /v1/video_status.get
//   2. Si completed : download → upload Supabase → trigger delivery
//   3. Si failed : update + Telegram notif
//   4. Si pending depuis >30 min : mark failed (timeout)
//
// Delivery par use_case :
//   - booking_confirmation : email Resend (HTML + thumbnail clickable)
//   - social_post           : Instagram Reels via publisher.js + Facebook video
//
// Idempotent : status='completed' n'est jamais re-traité (filter status IN pending/processing).

const heygen = require('./lib/heygen');
const axios = require('axios');

const TIMEOUT_MIN = 30;

async function _telegramAlert(text) {
  const TG_BOT = process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG_BOT || !TG_CHAT) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
      chat_id: TG_CHAT,
      text,
      parse_mode: 'Markdown',
    }, { timeout: 8000 });
  } catch { /* silent */ }
}

async function _sendBookingEmail(render, mirrorUrl, thumbnailUrl) {
  // Resend API direct (V1 n'a pas la dep installée — fallback REST)
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[poll-renders] RESEND_API_KEY missing — skip email delivery');
    return { ok: false, error: 'no resend key' };
  }
  const meta = render.social_post_meta || {};
  const to = meta.customer_email;
  const customerName = (meta.customer_name || 'Toi').split(' ')[0];
  if (!to) return { ok: false, error: 'no customer_email' };

  const fromAddr = process.env.RESEND_FROM || 'ZenithMoto <bonjour@zenithmoto.ch>';
  const subject = `${customerName}, ta vidéo de confirmation ZenithMoto est prête`;
  const moto = meta.moto_name || 'Ta moto';
  const dates = `${meta.start_date} → ${meta.end_date}`;

  const html = `
<!doctype html>
<html lang="fr"><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0F2A3F">
  <div style="max-width:560px;margin:0 auto;background:white;padding:32px 24px">
    <h1 style="font-size:22px;margin:0 0 8px">Bonjour ${customerName},</h1>
    <p style="font-size:16px;line-height:1.5;color:#444">
      Ta réservation pour <strong>${moto}</strong> est confirmée — <em>${dates}</em>.
      <br>J'ai enregistré une petite vidéo pour toi pour récapituler les infos pratiques.
    </p>
    <a href="${mirrorUrl}" style="display:block;margin:24px 0;text-decoration:none">
      <div style="position:relative;border-radius:12px;overflow:hidden;background:#0F2A3F;aspect-ratio:9/16;max-width:280px;margin:0 auto">
        ${thumbnailUrl ? `<img src="${thumbnailUrl}" alt="Aperçu vidéo" style="width:100%;display:block;opacity:0.85" />` : ''}
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;color:#0F2A3F">▶</div>
      </div>
      <div style="text-align:center;margin-top:12px">
        <span style="display:inline-block;background:#0F2A3F;color:white;padding:12px 24px;border-radius:8px;font-weight:600">Voir le rappel (30s)</span>
      </div>
    </a>
    <p style="font-size:14px;color:#666;line-height:1.5">
      Une question d'ici-là ? Réponds simplement à cet email ou WhatsApp <a href="https://wa.me/41782655108">+41 78 265 51 08</a>.
    </p>
    <p style="font-size:13px;color:#999;border-top:1px solid #eee;padding-top:16px;margin-top:24px">
      ZenithMoto — Bienne. Bonne route.<br>
      <a href="https://zenithmoto.ch" style="color:#0F2A3F">zenithmoto.ch</a>
    </p>
  </div>
</body></html>`.trim();

  try {
    const r = await axios.post('https://api.resend.com/emails', {
      from: fromAddr,
      to,
      subject,
      html,
    }, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });
    return { ok: true, id: r.data?.id };
  } catch (e) {
    return { ok: false, error: e.response?.data?.message || e.message };
  }
}

async function _publishSocialVideo(render, mirrorUrl) {
  const meta = render.social_post_meta || {};
  const platform = meta.platform || 'instagram';
  const caption = `${meta.caption || ''}\n\n${(meta.hashtags || []).join(' ')}`.trim();

  let publisher;
  try {
    publisher = require('./publisher');
  } catch (e) {
    return { ok: false, error: `publisher load: ${e.message}` };
  }

  const results = {};
  if (platform === 'instagram' || platform === 'all') {
    results.instagram = await publisher.publishInstagramReel(caption, mirrorUrl, `social-${meta.template_id}`);
  }
  if (platform === 'facebook' || platform === 'all') {
    results.facebook = await publisher.publishFacebookVideo(caption, mirrorUrl, `social-${meta.template_id}`);
  }
  if (platform === 'tiktok') {
    // TikTok via Buffer/Ayrshare nécessite config → fallback Telegram digest
    await _telegramAlert(`[heygen:tiktok] Video prête à poster manuellement\n${mirrorUrl}\n\n${caption}`);
    results.tiktok = 'manual_telegram';
  }
  return { ok: true, results };
}

/**
 * Poll all pending/processing renders and progress them.
 */
async function pollRenders() {
  const list = await heygen.listPendingRenders(50);
  if (!list.ok) {
    console.warn(`[poll-renders] supabase list failed: ${list.error}`);
    return { processed: 0, error: list.error };
  }
  if (!list.renders.length) return { processed: 0 };

  let processed = 0;
  let completed = 0;
  let failed = 0;

  for (const r of list.renders) {
    processed++;
    const ageMin = (Date.now() - new Date(r.created_at).getTime()) / 60000;

    // Timeout safeguard
    if (ageMin > TIMEOUT_MIN) {
      await heygen.updateRender(r.heygen_video_id, {
        status: 'failed',
        error_message: `timeout after ${Math.round(ageMin)}min`,
        completed_at: new Date().toISOString(),
      });
      failed++;
      await _telegramAlert(`[heygen] Timeout ${r.use_case} after ${Math.round(ageMin)}min — video_id=${r.heygen_video_id}`);
      continue;
    }

    const st = await heygen.getVideoStatus(r.heygen_video_id);
    if (!st.ok) {
      console.warn(`[poll-renders ${r.heygen_video_id}] status fetch failed: ${st.error}`);
      continue;
    }

    if (st.status === 'processing' && r.status !== 'processing') {
      await heygen.updateRender(r.heygen_video_id, { status: 'processing' });
      continue;
    }

    if (st.status === 'failed') {
      await heygen.updateRender(r.heygen_video_id, {
        status: 'failed',
        error_message: st.error || 'heygen reported failed',
        completed_at: new Date().toISOString(),
      });
      failed++;
      await _telegramAlert(`[heygen] Render failed ${r.use_case} — ${st.error || 'unknown'}\nvideo_id=${r.heygen_video_id}`);
      continue;
    }

    if (st.status !== 'completed') continue;

    // ─── Mirror to Supabase Storage ─────────────────────────
    const mirror = await heygen.downloadAndMirror(st.video_url, r.use_case, r.heygen_video_id);
    if (!mirror.ok) {
      console.warn(`[poll-renders ${r.heygen_video_id}] mirror failed: ${mirror.error}`);
      // We still update with the HeyGen URL so it's not lost (HeyGen URLs expire after 7d)
      await heygen.updateRender(r.heygen_video_id, {
        status: 'completed',
        video_url: st.video_url,
        gif_url: st.gif_url,
        thumbnail_url: st.thumbnail_url,
        duration_sec: st.duration,
        credits_used: st.credits_used,
        error_message: `mirror_failed: ${mirror.error}`,
        completed_at: new Date().toISOString(),
      });
      continue;
    }

    await heygen.updateRender(r.heygen_video_id, {
      status: 'completed',
      video_url: mirror.public_url,
      gif_url: st.gif_url,
      thumbnail_url: st.thumbnail_url,
      duration_sec: st.duration,
      credits_used: st.credits_used,
      completed_at: new Date().toISOString(),
    });

    // ─── Delivery ──────────────────────────────────────────
    let delivery = { ok: false };
    if (r.use_case === 'booking_confirmation') {
      delivery = await _sendBookingEmail(r, mirror.public_url, st.thumbnail_url);
    } else if (r.use_case === 'social_post') {
      delivery = await _publishSocialVideo(r, mirror.public_url);
    }

    if (delivery.ok) {
      await heygen.updateRender(r.heygen_video_id, { delivered_at: new Date().toISOString() });
      completed++;
      console.log(`[poll-renders] ✅ ${r.use_case} delivered — video_id=${r.heygen_video_id}`);
    } else {
      console.warn(`[poll-renders] delivery failed ${r.use_case} — ${delivery.error}`);
      await _telegramAlert(`[heygen] Delivery failed ${r.use_case}: ${delivery.error}\nvideo_id=${r.heygen_video_id}\nURL: ${mirror.public_url}`);
    }
  }

  if (processed > 0) {
    console.log(`[poll-renders] processed=${processed} completed=${completed} failed=${failed}`);
  }
  return { processed, completed, failed };
}

module.exports = { pollRenders };

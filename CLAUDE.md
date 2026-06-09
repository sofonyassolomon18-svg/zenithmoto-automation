# ZenithMoto Automation — V1 (Legacy)

> **V1 = legacy**. Logique booking principale migrée vers V4 (`zenithmoto-automation-v4`).  
> Contexte global ZM : voir `zenithmoto-site/.claude/CLAUDE.md`.  
> Ne pas réintroduire features ici — développer dans V4.

## Qui
Sofonyas Solomon — projet **ZenithMoto**, agence de location de motos à Bienne/Biel, Suisse.
Email : zenithmoto.ch@gmail.com | Site : zenithmoto.ch (Lovable)

## Ce que fait ce projet
Automatisation complète pour ZenithMoto :
- Notifications email clients (confirmation résa, rappel J-1, avis Google)
- Génération quotidienne de posts social media (Instagram, TikTok, Facebook)
- Prospection partenaires (hôtels, offices du tourisme) par email
- Rapport hebdomadaire revenus + motos les plus louées

## Lancer le projet
```bash
cd /c/Users/kudus/zenithmoto-automation
npm start   # Démarre serveur webhook (port 3001) + tous les cron jobs
```

## Architecture
```
src/
  content-generator.js  → Gemini 2.0 Flash → 15 posts/jour (5 motos × 3 plateformes)
  prospection.js        → Google Maps → hôtels/tourisme → email partenariat
  notifications.js      → Webhook Express + emails clients + rappels J-1
  reports.js            → Rapport hebdo revenus depuis bookings.json
  scheduler.js          → Orchestrateur cron jobs (node-cron)
data/
  bookings.json         → Réservations reçues via webhook
n8n-workflows/          → Versions n8n des mêmes automatisations
logs/
  prospection.csv       → Historique contacts partenaires
```

## Cron jobs critiques (timezone: Europe/Zurich)

28 crons actifs. Les 6 plus importants :

| Schedule | Nom | Rôle |
|----------|-----|------|
| `*/15 * * * *` | booking-assistant | IMAP → répond demandes résa entrantes |
| `0 17 * * *` | reminder-d1 | Email rappel J-1 aux clients (via Supabase edge fn) |
| `0 8 * * *` | daily-kpi | Brief matinal Telegram (revenus, bookings) |
| `15 8 * * *` | daily-health | Digest santé Telegram (cron errors, uptime) |
| `0 18 * * 0` | content-scheduler-postiz | Planifie posts semaine suivante via Postiz |
| `0 20 * * 0` | weekly-kpi | Rapport hebdo Telegram |

Tous les crons ont `try/catch` → erreur = `cronError()` → Telegram alert + compteur daily-health.

## Dead code (intentionnel)
- `src/flows/social-avatar-post.js` — HeyGen social, désactivé par env (`HEYGEN_SOCIAL_ENABLED !== 'true'`), ne pas supprimer
- Buffer publisher — **supprimé** (commit 3bd5ebd). Token expiré, service mort.

## Webhook Lovable
- Endpoint : `POST /webhook/booking`
- Events : `booking_created` → confirmation | `booking_completed` → avis Google
- Format : `{ event, booking: { booking_id, client_name, client_email, motorcycle, start_date, end_date, price } }`

## Flotte
Tracer 700 2024 · X-ADV 2025 · T-Max · X-Max 300 · X-Max 125
Tarif : à partir CHF 120/jour

## APIs utilisées
| Variable | Service |
|----------|---------|
| `GEMINI_API_KEY` | Gemini 2.0 Flash — génère posts |
| `GOOGLE_MAPS_API_KEY` | Prospection partenaires |
| `GMAIL_APP_PASSWORD` | SMTP Gmail |
| `SMTP_EMAIL` | zenithmoto.ch@gmail.com |
| `FACEBOOK_PAGE_ID` | Publication auto Facebook |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Publication auto Facebook |
| `INSTAGRAM_USER_ID` | Publication auto Instagram |
| `INSTAGRAM_ACCESS_TOKEN` | Publication auto Instagram |
| `IMG_TRACER_700` ... `IMG_XMAX125` | Photos motos pour Instagram |

## Publication sociale (src/publisher.js)
- Facebook : publie texte via Graph API → besoin FACEBOOK_PAGE_* dans .env
- Instagram : publie image+caption → besoin INSTAGRAM_* + IMG_* dans .env
- TikTok : scripts sauvegardés dans posts/ pour publication manuelle
- Logs : logs/publish.csv — historique toutes publications

## Deploy production
Railway — `railway.json` + `Procfile` + `nixpacks.toml`
Push git → deploy automatique

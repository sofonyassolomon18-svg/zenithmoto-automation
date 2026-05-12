# ZenithMoto Automation — Contexte Complet

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

## Cron jobs (timezone: Europe/Zurich)
- `0 8 * * 1`   → Lundi 08h00 → rapport hebdomadaire
- `0 9 * * *`   → Chaque jour 09h00 → génération posts social media
- `30 9 * * 1`  → Lundi 09h30 → prospection partenaires
- `0 10 * * *`  → Chaque jour 10h00 → rappels réservation J-1
- `*/4 * * * *` → Toutes 4min → keep-alive Railway

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

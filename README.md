# ZenithMoto Automation

Système d'automatisation complet pour ZenithMoto — agence de location de motos à Bienne.

## Fonctionnalités

| Module | Description | Fréquence |
|--------|-------------|-----------|
| `content-generator.js` | Génère des posts IG/TikTok/Facebook via Claude AI | Chaque jour 09:00 |
| `prospection.js` | Emails partenariat aux hôtels/offices du tourisme | Chaque lundi 09:30 |
| `notifications.js` | Confirmation, rappel J-1, demande avis Google | Sur webhook Lovable |
| `reports.js` | Rapport hebdo revenus + motos les plus louées | Chaque lundi 08:00 |

---

## Installation

```bash
cd zenithmoto-automation
npm install
```

## Configuration

Remplis le fichier `.env` :

```env
ANTHROPIC_API_KEY=sk-ant-...        # Claude AI (anthropic.com)
GOOGLE_MAPS_API_KEY=AIzaSy...       # Google Cloud Console → Places API
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx  # myaccount.google.com/apppasswords
SMTP_EMAIL=zenithmoto.ch@gmail.com
```

## Démarrage

```bash
npm start
```

Le système démarre :
- Le serveur webhook sur `http://localhost:3001`
- Tous les cron jobs automatiques

---

## Configurer le webhook Lovable

1. Dans ton projet Lovable, va dans **Settings → Integrations → Webhooks**
2. Ajoute l'URL : `http://TON_IP:3001/webhook/booking`
3. Sélectionne les événements : `booking_created`, `booking_completed`

### Si tu es en local (développement)

Utilise [ngrok](https://ngrok.com) pour exposer le port :

```bash
ngrok http 3001
```

Copie l'URL HTTPS fournie (ex: `https://abc123.ngrok.io`) et colle-la dans Lovable.

### Format du webhook Lovable

Lovable doit envoyer ce format JSON :

```json
{
  "event": "booking_created",
  "booking": {
    "booking_id": "RES-001",
    "client_name": "Jean Dupont",
    "client_email": "jean@example.com",
    "motorcycle": "Tracer 700 2024",
    "start_date": "2026-05-01T10:00:00Z",
    "end_date": "2026-05-03T18:00:00Z",
    "price": 360
  }
}
```

Événements supportés :
- `booking_created` → email de confirmation immédiat
- `booking_completed` → email demande d'avis Google

---

## Tester manuellement

```bash
# Générer les posts réseaux sociaux maintenant
node src/content-generator.js

# Lancer la prospection maintenant
node src/prospection.js

# Envoyer le rapport maintenant
node src/reports.js

# Tester le webhook (curl)
curl -X POST http://localhost:3001/webhook/booking \
  -H "Content-Type: application/json" \
  -d '{"event":"booking_created","booking":{"booking_id":"TEST-001","client_name":"Test Client","client_email":"ton@email.com","motorcycle":"T-Max","start_date":"2026-05-10T10:00:00Z","end_date":"2026-05-12T18:00:00Z","price":280}}'
```

---

## Structure des fichiers

```
zenithmoto-automation/
├── index.js              ← point d'entrée (npm start)
├── .env                  ← variables d'environnement
├── src/
│   ├── content-generator.js
│   ├── prospection.js
│   ├── notifications.js
│   ├── reports.js
│   └── scheduler.js
├── posts/                ← posts générés (JSON par moto/date)
├── logs/
│   └── prospection.csv   ← historique emails partenaires
└── data/
    └── bookings.json     ← réservations (pour rappels J-1)
```

---

## Flotte ZenithMoto

- 🏍️ **Tracer 700 2024** — Roadster sport
- 🛵 **X-ADV 2025** — Adventure scooter
- 🛵 **T-Max** — Scooter premium
- 🛵 **X-Max 300** — Scooter intermédiaire
- 🛵 **X-Max 125** — Scooter accessible
